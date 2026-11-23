// 可达性扫描编排:全量 B 角矩阵、单角增量重算、压板影响分析
import * as THREE from 'three';
import { store } from './store';
import { ReachEngine, FeatureProbe, ProbeResult } from '../core/reachEngine';
import { buildInstanceMeshes, InstanceMesh } from '../core/layout';
import { angleSequence, isAlignedToSpindle, recommendAngles, spindleAlignmentAngle } from '../core/reachMath';
import { resolveFeatureWorld } from './demo';
import type {
  FixtureComponentDef,
  FixtureSetup,
  MachiningFeature,
  ReachCell,
  ReachMatrix,
  ToolDef,
  WorkpieceDef,
} from '../types';

export interface ScanProgress {
  angleIndex: number;
  angleCount: number;
  currentAngle: number;
}

let engine: ReachEngine | null = null;

export function getEngine(): ReachEngine {
  if (!engine) engine = new ReachEngine();
  return engine;
}

function instanceLabels(meshes: InstanceMesh[], compDefs: FixtureComponentDef[], wpDefs: WorkpieceDef[]): Map<string, string> {
  const labels = new Map<string, string>();
  const compNames = new Map(compDefs.map((d) => [d.id, d.name]));
  const wpNames = new Map(wpDefs.map((d) => [d.id, d.name]));
  for (const m of meshes) {
    if (m.kind === 'column') labels.set(m.instanceId, '塔柱');
    else if (m.kind === 'component') labels.set(m.instanceId, compNames.get(m.defId) ?? '夹具元件');
    else labels.set(m.instanceId, wpNames.get(m.defId) ?? '相邻工件');
  }
  return labels;
}

function buildProbes(
  setup: FixtureSetup,
  features: MachiningFeature[],
  tools: ToolDef[],
  compDefs: FixtureComponentDef[],
  wpDefs: WorkpieceDef[],
  angleDeg: number,
): { probes: FeatureProbe[]; skipped: { feature: MachiningFeature; alignAngle: number }[] } {
  const world = resolveFeatureWorld(setup, compDefs, wpDefs, features);
  // B=0 时 F0 面(+Z)特征自然对齐主轴(-Z);转台正向旋转 B 角,世界向量按 +Y 旋转变换
  const rot = new THREE.Matrix4().makeRotationY(THREE.MathUtils.degToRad(angleDeg));
  const toolMap = new Map(tools.map((t) => [t.id, t]));
  const probes: FeatureProbe[] = [];
  const skipped: { feature: MachiningFeature; alignAngle: number }[] = [];

  for (const f of features) {
    if (!setup.featureIds.includes(f.id)) continue;
    const w = world.get(f.id);
    if (!w) continue;
    const dirR = w.direction.clone().transformDirection(rot);
    const align = spindleAlignmentAngle(dirR.x, dirR.y, dirR.z);
    if (!isAlignedToSpindle(align)) {
      skipped.push({ feature: f, alignAngle: align });
      continue;
    }
    const posR = w.position.clone().applyMatrix4(rot);
    const attached = f.toolIds.map((id) => toolMap.get(id)).filter((t): t is ToolDef => !!t);
    probes.push({
      feature: f,
      tools: attached,
      position: posR,
      direction: dirR.clone().normalize(),
      excludeInstanceId: w.workpieceInstanceId,
    });
  }
  return { probes, skipped };
}

function toCell(angle: number, r: ProbeResult): ReachCell {
  return {
    angle,
    featureId: r.featureId,
    reachable: r.reachable,
    reason: r.reason,
    minToolLength: r.minToolLength,
    holderCollision: r.holderCollision,
    nearestClearance: Number.isFinite(r.clearances.shank) ? r.clearances.shank : Number.POSITIVE_INFINITY,
    blockerId: r.clearances.blockerId,
    blockerLabel: r.clearances.blockerLabel,
    elapsedMs: r.elapsedMs,
  };
}

/** 单个 B 角重算(增量,目标 <100ms) */
export function computeAngle(
  setup: FixtureSetup,
  angleDeg: number,
  opts?: { affectedFeatureIds?: Set<string> },
): ReachCell[] {
  const eng = getEngine();
  if (!eng.isReady) throw new Error(eng.error ?? 'GPU 未就绪');
  const { components, tools, workpieces, features } = store.state;
  const meshes = buildInstanceMeshes(setup, components, workpieces);
  eng.setObstacles(meshes, instanceLabels(meshes, components, workpieces));
  eng.setTableAngle(angleDeg);

  const { probes, skipped } = buildProbes(setup, features, tools, components, workpieces, angleDeg);
  const cells: ReachCell[] = [];
  for (const p of probes) {
    if (opts?.affectedFeatureIds && !opts.affectedFeatureIds.has(p.feature.id)) continue;
    cells.push(toCell(angleDeg, eng.probe(p)));
  }
  for (const s of skipped) {
    if (opts?.affectedFeatureIds && !opts.affectedFeatureIds.has(s.feature.id)) continue;
    cells.push({
      angle: angleDeg,
      featureId: s.feature.id,
      reachable: false,
      reason: `加工方向与主轴夹角 ${s.alignAngle.toFixed(0)}°,该 B 角下无法对刀`,
      minToolLength: null,
      holderCollision: false,
      nearestClearance: Number.POSITIVE_INFINITY,
      blockerId: null,
      blockerLabel: null,
      elapsedMs: 0,
    });
  }
  return cells;
}

/** 全量 0..360 扫描,异步分块,带进度回调 */
export async function fullScan(
  setup: FixtureSetup,
  onProgress?: (p: ScanProgress) => void,
): Promise<ReachMatrix> {
  const angles = angleSequence(setup.angleStep);
  const all: ReachCell[] = [];
  const t0 = performance.now();
  for (let i = 0; i < angles.length; i++) {
    const cells = computeAngle(setup, angles[i]);
    all.push(...cells);
    onProgress?.({ angleIndex: i + 1, angleCount: angles.length, currentAngle: angles[i] });
    // 每 8 角让出一次事件循环,避免阻塞 UI
    if (i % 8 === 7) await new Promise((r) => setTimeout(r, 0));
  }
  const matrix: ReachMatrix = {
    setupId: setup.id,
    version: Date.now(),
    angles,
    cells: all,
    recommendations: recommendAngles(angles, all),
    computedAt: Date.now(),
  };
  await store.putMatrix(matrix);
  const elapsed = performance.now() - t0;
  console.info(`[reach] 全量扫描 ${angles.length} 角 / ${all.length} 单元格,耗时 ${elapsed.toFixed(0)}ms`);
  return matrix;
}

/** 用单角结果更新已存矩阵(增量重算路径) */
export async function patchMatrix(setup: FixtureSetup, angleDeg: number, cells: ReachCell[]): Promise<ReachMatrix> {
  const existing = store.state.matrices.find((m) => m.setupId === setup.id);
  const angles = existing?.angles ?? angleSequence(setup.angleStep);
  const kept = (existing?.cells ?? []).filter((c) => c.angle !== angleDeg);
  const merged = [...kept, ...cells];
  const matrix: ReachMatrix = {
    setupId: setup.id,
    version: Date.now(),
    angles,
    cells: merged,
    recommendations: recommendAngles(angles, merged),
    computedAt: Date.now(),
  };
  await store.putMatrix(matrix);
  return matrix;
}

/** 压板/元件移动后:找出受影响的特征(同面 + 几何邻近 CPU 预筛) */
export function findAffectedFeatures(
  setup: FixtureSetup,
  movedInstanceId: string,
  compDefs: FixtureComponentDef[],
  wpDefs: WorkpieceDef[],
): Set<string> {
  const inst = setup.components.find((c) => c.id === movedInstanceId);
  const affected = new Set<string>();
  if (!inst) return affected;
  const meshes = buildInstanceMeshes(setup, compDefs, wpDefs);
  const moved = meshes.find((m) => m.instanceId === movedInstanceId);
  if (!moved) return affected;

  // 膨胀 AABB:压板臂长 + 工件尺寸量级的邻域
  const pad = 220;
  const zone = moved.box.clone().expandByVector(new THREE.Vector3(pad, pad, pad));
  const world = resolveFeatureWorld(setup, compDefs, wpDefs, store.state.features);
  for (const [fid, w] of world) {
    if (zone.containsPoint(w.position)) affected.add(fid);
  }
  // 同面特征全部纳入(压板转动可能改变相邻角度结果)
  for (const f of store.state.features) {
    if (f.workpieceId && setup.workpieces.some((w) => w.faceIndex === inst.faceIndex && w.id === f.workpieceId)) {
      affected.add(f.id);
    }
  }
  return affected;
}

/** 某元件当前挡住了哪些特征(读取最近一次矩阵结果) */
export function featuresBlockedBy(setupId: string, instanceId: string): ReachCell[] {
  const m = store.state.matrices.find((x) => x.setupId === setupId);
  if (!m) return [];
  return m.cells.filter((c) => c.blockerId === instanceId);
}

export function cellAt(matrix: ReachMatrix | null, angle: number, featureId: string): ReachCell | undefined {
  return matrix?.cells.find((c) => c.angle === angle && c.featureId === featureId);
}

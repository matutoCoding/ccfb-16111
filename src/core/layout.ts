// 装夹布局:塔面坐标架、网格吸附、实例世界变换、3-2-1 定位校验
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type {
  ComponentInstance,
  FixtureComponentDef,
  FixtureSetup,
  WorkpieceDef,
  WorkpieceInstance,
} from '../types';
import { buildComponentParts, buildWorkpieceParts } from './geometry';
import { degToRad } from './mathUtils';

export interface FaceFrame {
  n: THREE.Vector3; // 面外法向
  u: THREE.Vector3; // 面内切向(网格 U 方向)
  v: THREE.Vector3; // 面内竖直(网格 V 方向,世界 +Y)
}

const FACE_NORMALS: [number, number, number][] = [
  [0, 0, 1],
  [1, 0, 0],
  [0, 0, -1],
  [-1, 0, 0],
];
const FACE_TANGENTS: [number, number, number][] = [
  [1, 0, 0],
  [0, 0, -1],
  [-1, 0, 0],
  [0, 0, 1],
];

export function faceFrame(faceIndex: number): FaceFrame {
  const f = ((faceIndex % 4) + 4) % 4;
  return {
    n: new THREE.Vector3(...FACE_NORMALS[f]),
    u: new THREE.Vector3(...FACE_TANGENTS[f]),
    v: new THREE.Vector3(0, 1, 0),
  };
}

export function columnCenter(setup: FixtureSetup): THREE.Vector3 {
  return new THREE.Vector3(0, setup.tableHeight + setup.columnHeight / 2, 0);
}

export function faceSurfacePoint(
  setup: FixtureSetup,
  faceIndex: number,
  slotU: number,
  slotV: number,
  pitch: number,
  offset: [number, number, number] = [0, 0, 0],
): THREE.Vector3 {
  const { n, u } = faceFrame(faceIndex);
  const c = columnCenter(setup);
  const half = setup.columnSize / 2;
  const p = c.clone().addScaledVector(n, half + 0.5);
  p.addScaledVector(u, slotU * pitch + offset[0]);
  p.y += slotV * pitch + offset[1];
  p.addScaledVector(n, offset[2]);
  return p;
}

/** 元件实例的世界矩阵:局部 +Y(伸出方向)对齐面法向,局部 +Z 对齐 U 切向 */
export function componentMatrix(
  setup: FixtureSetup,
  inst: ComponentInstance,
  def: FixtureComponentDef,
): THREE.Matrix4 {
  const { n, u, v } = faceFrame(inst.faceIndex);
  const pos = faceSurfacePoint(setup, inst.faceIndex, inst.slotU, inst.slotV, def.snapPitch, inst.offset);
  const xAxis = v.clone(); // 局部 X -> 竖直
  const yAxis = n.clone(); // 局部 Y -> 法向
  const zAxis = u.clone(); // 局部 Z -> 切向
  const basis = new THREE.Matrix4().makeBasis(xAxis, yAxis, zAxis);
  const rot = new THREE.Matrix4().makeRotationY(degToRad(inst.rotation));
  const m = basis.clone().multiply(rot);
  m.setPosition(pos);
  return m;
}

/** 工件实例矩阵:工件 -Y(安装脚/主定位面)贴塔面,+Y 沿面法向朝外;
 *  工件 X 沿面内切向 U(阀体主阀孔水平),工件 Z 沿面内竖直 V */
export function workpieceMatrix(
  setup: FixtureSetup,
  inst: WorkpieceInstance,
  def: WorkpieceDef,
): THREE.Matrix4 {
  const { n, u, v } = faceFrame(inst.faceIndex);
  const depthHalf = def.envelope.size[1] / 2;
  const p = faceSurfacePoint(setup, inst.faceIndex, inst.slotU, inst.slotV, 50, inst.offset);
  p.addScaledVector(n, depthHalf);
  // 局部 X -> 切向 U;局部 Y -> 法向 N;局部 Z -> 竖直 V(右手系:U×N=V)
  const xAxis = u.clone();
  const yAxis = n.clone();
  const zAxis = v.clone();
  const basis = new THREE.Matrix4().makeBasis(xAxis, yAxis, zAxis);
  const rot = new THREE.Matrix4().makeRotationY(degToRad(inst.rotation));
  const m = basis.clone().multiply(rot);
  m.setPosition(p);
  return m;
}

export interface InstanceMesh {
  instanceId: string;
  defId: string;
  faceIndex: number;
  kind: 'column' | 'component' | 'workpiece';
  mesh: THREE.Mesh;
  box: THREE.Box3;
}

function mergeParts(parts: { geometry: THREE.BufferGeometry; transform?: THREE.Matrix4 }[]): THREE.BufferGeometry {
  const geos = parts.map((part) => {
    const g = part.geometry.clone();
    if (part.transform) g.applyMatrix4(part.transform);
    if (!g.getAttribute('normal')) g.computeVertexNormals();
    return g;
  });
  return mergeGeometries(geos, false)!;
}

/** 构建塔柱 + 全部元件 + 全部工件的独立网格(每个实例一个 mesh,便于 ID 编码与拾取) */
export function buildInstanceMeshes(
  setup: FixtureSetup,
  compDefs: FixtureComponentDef[],
  wpDefs: WorkpieceDef[],
): InstanceMesh[] {
  const out: InstanceMesh[] = [];
  const compMap = new Map(compDefs.map((d) => [d.id, d]));
  const wpMap = new Map(wpDefs.map((d) => [d.id, d]));

  // 塔柱
  const columnDef = compDefs.find((d) => d.id === setup.columnDefId);
  if (columnDef) {
    const geo = mergeParts(buildComponentParts(columnDef));
    const mesh = new THREE.Mesh(geo);
    mesh.position.copy(columnCenter(setup));
    const box = new THREE.Box3().setFromBufferAttribute(geo.getAttribute('position') as THREE.BufferAttribute);
    box.applyMatrix4(mesh.matrixWorld);
    mesh.updateMatrixWorld(true);
    out.push({ instanceId: 'column', defId: columnDef.id, faceIndex: -1, kind: 'column', mesh, box });
  }

  for (const inst of setup.components) {
    const def = compMap.get(inst.defId);
    if (!def) continue;
    const geo = mergeParts(buildComponentParts(def));
    const mesh = new THREE.Mesh(geo);
    mesh.matrixAutoUpdate = false;
    mesh.matrix.copy(componentMatrix(setup, inst, def));
    mesh.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(mesh);
    out.push({ instanceId: inst.id, defId: def.id, faceIndex: inst.faceIndex, kind: 'component', mesh, box });
  }

  for (const inst of setup.workpieces) {
    const def = wpMap.get(inst.defId);
    if (!def) continue;
    const geo = mergeParts(buildWorkpieceParts(def));
    const mesh = new THREE.Mesh(geo);
    mesh.matrixAutoUpdate = false;
    mesh.matrix.copy(workpieceMatrix(setup, inst, def));
    mesh.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(mesh);
    out.push({ instanceId: inst.id, defId: def.id, faceIndex: inst.faceIndex, kind: 'workpiece', mesh, box });
  }
  return out;
}

export interface LocationCheck {
  ok: boolean;
  messages: { level: 'ok' | 'warn' | 'fail'; text: string }[];
}

/**
 * 3-2-1 定位校验:
 * 主定位面(3 点)由塔面贴合提供;次定位(2 点)需 footprint 内有圆柱定位销;
 * 第三定位(1 点)需 footprint 内有第二枚定位销/支承钉。
 */
export function validate321(
  setup: FixtureSetup,
  compDefs: FixtureComponentDef[],
  wpDefs: WorkpieceDef[],
): LocationCheck[] {
  const compMap = new Map(compDefs.map((d) => [d.id, d]));
  const wpMap = new Map(wpDefs.map((d) => [d.id, d]));
  const result: LocationCheck[] = [];

  for (const wp of setup.workpieces) {
    const def = wpMap.get(wp.defId);
    const messages: LocationCheck['messages'] = [];
    if (!def) continue;
    const { n, u } = faceFrame(wp.faceIndex);
    const depthHalf = def.envelope.size[1] / 2;
    const center = faceSurfacePoint(setup, wp.faceIndex, wp.slotU, wp.slotV, 50, wp.offset).addScaledVector(n, depthHalf);

    // 工件在面内 2D footprint(沿 u 半宽 = envelope.z/2,沿 v 半高 = envelope.x/2)
    const halfU = def.envelope.size[2] / 2;
    const halfV = def.envelope.size[0] / 2;

    let primaryPins = 0;
    let secondaryPins = 0;
    let tertiaryPins = 0;
    for (const c of setup.components) {
      if (c.faceIndex !== wp.faceIndex) continue;
      const cdef = compMap.get(c.defId);
      if (!cdef) continue;
      const cp = faceSurfacePoint(setup, c.faceIndex, c.slotU, c.slotV, cdef.snapPitch, c.offset);
      const du = cp.clone().sub(center).dot(u);
      const dv = cp.y - center.y;
      const inside = Math.abs(du) <= halfU + 4 && Math.abs(dv) <= halfV + 4;
      if (!inside) continue;
      if (cdef.type === 'locatingPin') {
        if (secondaryPins === 0) secondaryPins++;
        else tertiaryPins++;
      } else if (cdef.type === 'supportPin') {
        primaryPins++;
      } else if (cdef.type === 'hydraulicCylinder') {
        primaryPins++;
      }
    }

    messages.push({ level: 'ok', text: '主定位面(3点):工件定位面与塔柱面贴合,约束 3 个自由度' });
    if (secondaryPins >= 1) {
      messages.push({ level: 'ok', text: '次定位(2点): footprint 内有圆柱定位销,约束 2 个自由度' });
    } else {
      messages.push({ level: 'fail', text: '次定位(2点)未满足:该工件 footprint 内缺少定位销,存在平移/转动自由度' });
    }
    if (tertiaryPins >= 1 || primaryPins >= 1) {
      messages.push({ level: 'ok', text: '第三定位(1点): footprint 内有菱形销/支承钉,约束最后 1 个自由度' });
    } else {
      messages.push({ level: 'warn', text: '第三定位(1点)未满足:建议在 footprint 内增加第二枚定位销或支承钉' });
    }
    const ok = !messages.some((m) => m.level === 'fail');
    result.push({ ok, messages });
  }
  return result;
}

/** 计算工件上某点(工件坐标系)在装夹世界坐标中的位置/方向 */
export function featureWorldTransform(
  setup: FixtureSetup,
  wpInst: WorkpieceInstance,
  def: WorkpieceDef,
  localPos: [number, number, number],
  localDir: [number, number, number],
): { position: THREE.Vector3; direction: THREE.Vector3; matrix: THREE.Matrix4 } {
  const m = workpieceMatrix(setup, wpInst, def);
  const position = new THREE.Vector3(...localPos).applyMatrix4(m);
  const direction = new THREE.Vector3(...localDir).transformDirection(m).normalize();
  return { position, direction, matrix: m };
}

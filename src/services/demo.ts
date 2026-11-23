// 演示场景生成:四面 × 三阀体(共 12 个)+ 两块故意遮挡孔位的压板
import * as THREE from 'three';
import { store } from './store';
import { SEED_COMPONENTS, SEED_TOOLS, makeValveBodyDef } from '../data/seed';
import { buildInstanceMeshes, featureWorldTransform } from '../core/layout';
import { getWorkpieceAnchors } from '../core/geometry';
import { ID_PREF, uid } from '../types';
import type {
  ComponentInstance,
  FixtureComponentDef,
  FixtureSetup,
  MachiningFeature,
  WorkpieceDef,
  WorkpieceInstance,
} from '../types';

const DEF = {
  column: 'def_column_320',
  pin: 'def_pin_d16',
  diamondPin: 'def_pin_d12',
  support: 'def_support_d12',
  clamp: 'def_clamp_120',
};

export async function generateDemoSetup(): Promise<FixtureSetup> {
  // 1. 确保库数据存在
  if (store.state.components.length === 0) {
    await store.save('components', SEED_COMPONENTS);
  }
  if (store.state.tools.length === 0) {
    await store.save('tools', SEED_TOOLS);
  }

  // 2. 生成 12 个相同参数的阀体定义实例(每面 3 个,共 4 面)
  const wpDefs: WorkpieceDef[] = [];
  const wpInstances: WorkpieceInstance[] = [];
  const allFeatures: MachiningFeature[] = [];
  const compInstances: ComponentInstance[] = [];

  // 每面 3 个工件的网格 V 坐标(塔柱高 600,节距 50)
  const vSlots = [-3, 0, 3];

  for (let face = 0; face < 4; face++) {
    for (const v of vSlots) {
      const def = makeValveBodyDef();
      def.name = `阀体 F${face}-V${v}`;
      wpDefs.push(def);
      const wpInst: WorkpieceInstance = {
        id: uid('wpi'),
        defId: def.id,
        faceIndex: face,
        slotU: 0,
        slotV: v,
        offset: [0, 0, 0],
        rotation: 0,
      };
      wpInstances.push(wpInst);

      // 每个工件按锚点生成 6 个特征,挂常用刀
      const anchors = getWorkpieceAnchors(def);
      for (const a of anchors) {
        const toolIds = pickTools(a.type);
        allFeatures.push({
          id: uid(ID_PREF.feat),
          workpieceId: wpInst.id,
          type: a.type,
          name: `${def.name}-${a.name}`,
          position: a.position,
          direction: a.direction,
          diameter: a.diameter,
          depth: a.depth,
          toolIds,
        });
      }

      // 每工件:1 圆柱销 + 1 菱形销 + 2 支承钉(满足 3-2-1)
      compInstances.push(
        pin(DEF.pin, face, -1, v - 1),
        pin(DEF.diamondPin, face, 1, v - 1),
        pin(DEF.support, face, -1, v + 1),
        pin(DEF.support, face, 1, v + 1),
      );
    }
  }

  // 3. 两块"问题压板":F0 面上下两个工件
  //    offset[0]=9 把压头对到阀盖孔中心面内位置;offset[2]=100 让压臂悬在孔口前方,
  //    刀具沿 -Z 进刀时先撞上压头(物理遮挡),可达性必须判挡住
  for (const v of [-3, 3]) {
    compInstances.push({
      id: uid('cmi'),
      defId: DEF.clamp,
      faceIndex: 0,
      slotU: 0,
      slotV: v,
      offset: [9, 0, 100],
      rotation: 0,
    });
  }
  // 对照:后 F2 面的正常压板(贴工件顶面,不挡水平孔)
  compInstances.push({ id: uid('cmi'), defId: DEF.clamp, faceIndex: 2, slotU: 0, slotV: 0, offset: [0, 30, 0], rotation: 90 });

  const setup: FixtureSetup = {
    id: uid(ID_PREF.setup),
    name: '演示:四面十二阀体(含挡孔压板)',
    columnDefId: DEF.column,
    columnSize: 320,
    columnHeight: 600,
    tableHeight: 100,
    components: compInstances,
    workpieces: wpInstances,
    featureIds: allFeatures.map((f) => f.id),
    angleStep: 5,
  };

  // 4. 落库
  await store.save('workpieces', [...store.state.workpieces, ...wpDefs]);
  await store.save('features', [...store.state.features, ...allFeatures]);
  await store.upsert('setups', setup);
  await store.setCurrentSetup(setup.id);
  return setup;
}

function pickTools(type: MachiningFeature['type']): string[] {
  switch (type) {
    case 'hole':
      return ['tool_d3', 'tool_d8'];
    case 'tappedHole':
      return ['tool_m10'];
    case 'counterbore':
      return ['tool_d12', 'tool_d20'];
    case 'face':
      return ['tool_f32'];
  }
}

function pin(defId: string, face: number, u: number, v: number): ComponentInstance {
  return { id: uid('cmi'), defId, faceIndex: face, slotU: u, slotV: v, offset: [0, 0, 0], rotation: 0 };
}

/** 计算特征在世界坐标中的位置与方向(供扫描服务复用) */
export function resolveFeatureWorld(
  setup: FixtureSetup,
  compDefs: FixtureComponentDef[],
  wpDefs: WorkpieceDef[],
  features: MachiningFeature[],
): Map<string, { position: THREE.Vector3; direction: THREE.Vector3; workpieceInstanceId: string }> {
  const out = new Map();
  const wpMap = new Map(wpDefs.map((d) => [d.id, d]));
  const wpInstById = new Map(setup.workpieces.map((w) => [w.id, w]));
  for (const f of features) {
    if (!setup.featureIds.includes(f.id)) continue;
    const wpInst = wpInstById.get(f.workpieceId);
    const def = wpInst ? wpMap.get(wpInst.defId) : undefined;
    if (!wpInst || !def) continue;
    const t = featureWorldTransform(setup, wpInst, def, f.position, f.direction);
    out.set(f.id, { position: t.position, direction: t.direction, workpieceInstanceId: wpInst.id });
  }
  return out;
}

/** 供外部预检查:返回压板与特征孔位的几何关系(用于验证演示场景确实会报警) */
export function auditDemoClamps(
  setup: FixtureSetup,
  compDefs: FixtureComponentDef[],
  wpDefs: WorkpieceDef[],
  features: MachiningFeature[],
): { clampId: string; featureId: string; gap: number }[] {
  const meshes = buildInstanceMeshes(setup, compDefs, wpDefs);
  const clampBoxes = meshes.filter((m) => m.kind === 'component');
  const world = resolveFeatureWorld(setup, compDefs, wpDefs, features);
  const hits: { clampId: string; featureId: string; gap: number }[] = [];
  for (const f of features) {
    const w = world.get(f.id);
    if (!w) continue;
    const end = w.position.clone().addScaledVector(w.direction, 60);
    for (const box of clampBoxes) {
      const seg = new THREE.Line3(w.position, end);
      const closest = new THREE.Vector3();
      seg.closestPointToPoint(box.box.getCenter(new THREE.Vector3()), true, closest);
      const d = closest.distanceTo(box.box.clampPoint(closest, new THREE.Vector3()));
      if (d < 5) hits.push({ clampId: box.instanceId, featureId: f.id, gap: d });
    }
  }
  return hits;
}

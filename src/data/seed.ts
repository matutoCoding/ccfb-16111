// 初始种子数据:标准塔柱、定位销、压板、支承钉、液压缸与常用刀具
import type { FixtureComponentDef, ToolDef, WorkpieceDef } from '../types';
import { uid, ID_PREF } from '../types';

export const SEED_COMPONENTS: FixtureComponentDef[] = [
  {
    id: 'def_column_320',
    type: 'column',
    name: '四面方箱塔柱 320×600',
    snapMode: 'grid',
    snapPitch: 50,
    params: { size: 320, height: 600, gridPitch: 50, holeDiameter: 12 },
  },
  {
    id: 'def_pin_d16',
    type: 'locatingPin',
    name: '圆柱定位销 D16',
    snapMode: 'grid',
    snapPitch: 50,
    params: { diameter: 16, height: 20, baseDiameter: 28, baseHeight: 8 },
  },
  {
    id: 'def_pin_d12',
    type: 'locatingPin',
    name: '菱形定位销 D12',
    snapMode: 'grid',
    snapPitch: 50,
    params: { diameter: 12, height: 16, baseDiameter: 24, baseHeight: 8 },
  },
  {
    id: 'def_clamp_120',
    type: 'clamp',
    name: 'T 型槽压板 120',
    snapMode: 'tSlot',
    snapPitch: 50,
    params: { width: 24, thickness: 16, armLength: 120, boltDiameter: 12, standoffHeight: 40 },
  },
  {
    id: 'def_clamp_160',
    type: 'clamp',
    name: '加长压板 160',
    snapMode: 'tSlot',
    snapPitch: 50,
    params: { width: 28, thickness: 18, armLength: 160, boltDiameter: 14, standoffHeight: 44 },
  },
  {
    id: 'def_support_d12',
    type: 'supportPin',
    name: '可调支承钉 D12',
    snapMode: 'grid',
    snapPitch: 50,
    params: { diameter: 12, height: 16, baseDiameter: 24 },
  },
  {
    id: 'def_hydro_50',
    type: 'hydraulicCylinder',
    name: '转角液压缸 D50',
    snapMode: 'grid',
    snapPitch: 50,
    params: { bodyDiameter: 50, bodyHeight: 80, rodDiameter: 16, rodStroke: 30, jawWidth: 28, armLength: 90 },
  },
];

export const SEED_TOOLS: ToolDef[] = [
  { id: 'tool_d3', name: 'Φ3 整体硬质合金钻', toolNumber: 'T01', diameter: 3, fluteLength: 40, holderDiameter: 20, holderLength: 35 },
  { id: 'tool_d8', name: 'Φ8 麻花钻', toolNumber: 'T02', diameter: 8, fluteLength: 60, holderDiameter: 25, holderLength: 40 },
  { id: 'tool_d12', name: 'Φ12 麻花钻', toolNumber: 'T03', diameter: 12, fluteLength: 70, holderDiameter: 28, holderLength: 45 },
  { id: 'tool_d20', name: 'Φ20 镗刀', toolNumber: 'T04', diameter: 20, fluteLength: 80, holderDiameter: 32, holderLength: 50 },
  { id: 'tool_m10', name: 'M10 丝锥', toolNumber: 'T05', diameter: 8.5, fluteLength: 50, holderDiameter: 22, holderLength: 38 },
  { id: 'tool_f32', name: 'Φ32 面铣刀', toolNumber: 'T06', diameter: 32, fluteLength: 30, holderDiameter: 40, holderLength: 55 },
];

export function makeValveBodyDef(): WorkpieceDef {
  return {
    id: uid(ID_PREF.wp),
    name: '参数化阀体 120×80×90',
    kind: 'valveBody',
    envelope: { size: [120, 90, 80] },
    params: {
      length: 120, width: 80, height: 90,
      flangeWidth: 26, flangeThickness: 14,
      bossDiameter: 30, bossHeight: 12,
    },
    locatingFaces: { primary: [0, -1, 0], secondary: [0, 0, -1], tertiary: [-1, 0, 0] },
  };
}

export function makePumpHousingDef(): WorkpieceDef {
  return {
    id: uid(ID_PREF.wp),
    name: '参数化泵壳 D110×100',
    kind: 'pumpHousing',
    envelope: { size: [100, 110, 110] },
    params: {
      diameter: 110, length: 100,
      flangeDiameter: 138, flangeThickness: 16, portDiameter: 28,
    },
    locatingFaces: { primary: [0, -1, 0], secondary: [0, 0, -1], tertiary: [-1, 0, 0] },
  };
}

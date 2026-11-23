// 全局数据模型 —— 夹具元件、工件、刀具、特征、装夹、可达性结果

export type Vec3 = [number, number, number];

export type ComponentType = 'column' | 'locatingPin' | 'clamp' | 'supportPin' | 'hydraulicCylinder';
export type WorkpieceKind = 'valveBody' | 'pumpHousing' | 'stl';
export type FeatureType = 'hole' | 'face' | 'tappedHole' | 'counterbore';
export type SnapMode = 'tSlot' | 'grid';

/** 参数化夹具元件定义(库内模板) */
export interface FixtureComponentDef {
  id: string;
  type: ComponentType;
  name: string;
  /** 参数名 -> 毫米(角度参数用度) */
  params: Record<string, number>;
  /** T 型槽间距 / 网格孔距,毫米 */
  snapPitch: number;
  snapMode: SnapMode;
}

/** 装夹场景内的元件实例 */
export interface ComponentInstance {
  id: string;
  defId: string;
  /** 所属塔柱面 0..3(塔柱自身为 -1) */
  faceIndex: number;
  /** 吸附槽位/孔位序号(沿该面网格坐标) */
  slotU: number;
  slotV: number;
  /** 相对吸附点的微调,毫米 */
  offset: Vec3;
  /** 绕法线旋转,度 */
  rotation: number;
}

export interface ToolDef {
  id: string;
  name: string;
  /** 刀具切削直径 mm */
  diameter: number;
  /** 刀杆长度(刃长)mm */
  fluteLength: number;
  /** 刀柄直径 mm */
  holderDiameter: number;
  /** 刀柄长度 mm */
  holderLength: number;
  /** 编号,如 T03 */
  toolNumber: string;
}

export interface MachiningFeature {
  id: string;
  workpieceId: string;
  type: FeatureType;
  name: string;
  /** 特征在工件坐标系下的位置 */
  position: Vec3;
  /** 加工进刀方向(单位向量,工件坐标系) */
  direction: Vec3;
  /** 孔径/特征直径 mm;面特征用直径表示加工区域 */
  diameter: number;
  /** 孔深 mm(面特征为 0) */
  depth: number;
  /** 挂载的刀具 id 列表,一个特征可挂多把刀 */
  toolIds: string[];
  /** 3-2-1 定位约束标记,仅用于展示 */
  locatorRole?: 'primary' | 'secondary' | 'tertiary';
}

export interface WorkpieceDef {
  id: string;
  name: string;
  kind: WorkpieceKind;
  /** 参数化工件尺寸包络;STL 工件用实际包络 */
  envelope: { size: Vec3 };
  params: Record<string, number>;
  /** 定位面:主定位面(3点)、次(2点)、第三(1点),法向(工件坐标系) */
  locatingFaces: {
    primary: Vec3;
    secondary: Vec3;
    tertiary: Vec3;
  };
  /** STL 二进制缓存的 IndexedDB key,参数化工件为空 */
  stlBlobKey?: string;
  stlTriangleCount?: number;
}

export interface WorkpieceInstance {
  id: string;
  defId: string;
  faceIndex: number;
  /** 塔面网格坐标 */
  slotU: number;
  slotV: number;
  offset: Vec3;
  /** 绕面法线旋转(度),用于调整定位面朝向 */
  rotation: number;
}

export interface FixtureSetup {
  id: string;
  name: string;
  columnDefId: string;
  /** 塔柱边长 mm */
  columnSize: number;
  /** 塔柱高度 mm */
  columnHeight: number;
  /** 转台安装高度 */
  tableHeight: number;
  components: ComponentInstance[];
  workpieces: WorkpieceInstance[];
  featureIds: string[];
  /** B 角扫描步进,度 */
  angleStep: number;
}

/** 单个 (B角, 特征) 的可达性判定 */
export interface ReachCell {
  angle: number;
  featureId: string;
  reachable: boolean;
  /** 判定依据明细 */
  reason: string;
  /** 最短不干涉刀长 mm(可达时给出) */
  minToolLength: number | null;
  /** 当前刀长下是否干涉 */
  holderCollision: boolean;
  /** 最近障碍距离 mm(刀轴方向,从特征面起算) */
  nearestClearance: number;
  /** 造成遮挡的元件实例 id(压板/工件/塔柱) */
  blockerId: string | null;
  blockerLabel: string | null;
  /** 计算耗时 ms */
  elapsedMs: number;
}

export interface ReachMatrix {
  setupId: string;
  /** 数据版本:装夹变更后自增,旧结果作废 */
  version: number;
  angles: number[];
  cells: ReachCell[];
  /** 推荐的一次装夹多特征加工角度 */
  recommendations: AngleRecommendation[];
  computedAt: number;
}

export interface AngleRecommendation {
  angle: number;
  featureCount: number;
  featureIds: string[];
}

export interface ProcessStep {
  angle: number;
  featureId: string;
  featureName: string;
  toolNumber: string;
  toolName: string;
  minToolLength: number;
}

export interface ProcessCard {
  id: string;
  setupId: string;
  name: string;
  createdAt: number;
  /** 按 B 角分工步 */
  groups: { angle: number; steps: ProcessStep[]; screenshot?: string }[];
}

export interface DBSchema {
  components: FixtureComponentDef[];
  tools: ToolDef[];
  workpieces: WorkpieceDef[];
  features: MachiningFeature[];
  setups: FixtureSetup[];
  matrices: ReachMatrix[];
  cards: ProcessCard[];
  stlBlobs: { key: string; data: ArrayBuffer }[];
  meta: { key: string; value: unknown }[];
}

export type StoreName = keyof DBSchema;

export const ID_PREF = {
  comp: 'cmp',
  tool: 'tol',
  wp: 'wkp',
  feat: 'fea',
  setup: 'set',
  card: 'crd',
} as const;

export function uid(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

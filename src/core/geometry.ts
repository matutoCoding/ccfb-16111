// 参数化几何构建:夹具元件、阀体/泵壳、特征标记
import * as THREE from 'three';
import type { FixtureComponentDef, WorkpieceDef, MachiningFeature, FeatureType } from '../types';

export interface MeshPart {
  geometry: THREE.BufferGeometry;
  /** 局部变换(相对元件/工件组) */
  transform?: THREE.Matrix4;
}

function box(w: number, h: number, d: number, x = 0, y = 0, z = 0): MeshPart {
  const g = new THREE.BoxGeometry(w, h, d);
  const m = new THREE.Matrix4().makeTranslation(x, y, z);
  return { geometry: g, transform: m };
}

function cyl(radius: number, height: number, x = 0, y = 0, z = 0, axis: 'y' | 'z' | 'x' = 'y', seg = 24): MeshPart {
  const g = new THREE.CylinderGeometry(radius, radius, height, seg);
  const m = new THREE.Matrix4();
  if (axis === 'z') m.makeRotationX(Math.PI / 2);
  else if (axis === 'x') m.makeRotationZ(-Math.PI / 2);
  m.setPosition(x, y, z);
  return { geometry: g, transform: m };
}

/** 塔柱:方箱 + 四面 T 型槽凹槽视觉 + 网格孔位(用暗色小圆片表示) */
function buildColumn(p: Record<string, number>): MeshPart[] {
  const size = p.size ?? 200;
  const height = p.height ?? 600;
  const parts: MeshPart[] = [box(size, height, size)];
  const pitch = p.gridPitch ?? 50;
  const holeR = (p.holeDiameter ?? 12) / 2;
  const half = size / 2;
  const rows = Math.floor((height - 100) / pitch);
  const cols = Math.max(1, Math.floor((size - 40) / pitch));
  const y0 = -height / 2 + 80;
  for (let f = 0; f < 4; f++) {
    const angle = (f * Math.PI) / 2;
    const nx = Math.sin(angle);
    const nz = Math.cos(angle);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const u = (c - (cols - 1) / 2) * pitch;
        const y = y0 + r * pitch;
        const g = new THREE.CylinderGeometry(holeR, holeR, 2, 16);
        const m = new THREE.Matrix4();
        const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2, 0, angle));
        m.makeRotationFromQuaternion(q);
        m.setPosition(nx * (half + 0.6), y, nz * (half + 0.6));
        // 沿面切向偏移 u
        const tx = Math.cos(angle);
        const tz = -Math.sin(angle);
        const pos = new THREE.Vector3(nx * (half + 0.6), y, nz * (half + 0.6));
        pos.addScaledVector(new THREE.Vector3(tx, 0, tz), u);
        m.setPosition(pos);
        parts.push({ geometry: g, transform: m });
      }
    }
  }
  return parts;
}

/** 定位销:底座 + 销体,局部 +Y 为伸出方向 */
function buildLocatingPin(p: Record<string, number>): MeshPart[] {
  const d = p.diameter ?? 16;
  const h = p.height ?? 20;
  const baseD = p.baseDiameter ?? d * 1.8;
  const baseH = p.baseHeight ?? 8;
  return [
    cyl(baseD / 2, baseH, 0, baseH / 2, 0),
    cyl(d / 2, h, 0, baseH + h / 2 - 1, 0),
  ];
}

/** 压板:垫高跟 + 螺栓 + 横梁(压头),横梁沿局部 Z 方向伸出 */
function buildClamp(p: Record<string, number>): MeshPart[] {
  const width = p.width ?? 24;
  const thickness = p.thickness ?? 16;
  const armLength = p.armLength ?? 120;
  const boltD = p.boltDiameter ?? 12;
  const standoff = p.standoffHeight ?? 40;
  return [
    // 支撑垫块
    box(width * 1.4, standoff, width * 1.4, 0, standoff / 2, -armLength * 0.35),
    // 横梁
    box(width, thickness, armLength, 0, standoff + thickness / 2, armLength * 0.1),
    // 螺栓
    cyl(boltD / 2, standoff + thickness + 10, 0, (standoff + thickness + 10) / 2, -armLength * 0.35),
    // 压头(前端接触工件处)
    cyl(width * 0.45, 6, 0, standoff - 3, armLength * 0.55),
  ];
}

/** 支承钉:底座 + 钉头 */
function buildSupportPin(p: Record<string, number>): MeshPart[] {
  const d = p.diameter ?? 12;
  const h = p.height ?? 16;
  const baseD = p.baseDiameter ?? d * 2;
  return [cyl(baseD / 2, 6, 0, 3, 0), cyl(d / 2, h, 0, 6 + h / 2 - 1, 0)];
}

/** 液压缸:缸体 + 活塞杆 + 压臂 */
function buildHydraulicCylinder(p: Record<string, number>): MeshPart[] {
  const bodyD = p.bodyDiameter ?? 50;
  const bodyH = p.bodyHeight ?? 80;
  const rodD = p.rodDiameter ?? 16;
  const stroke = p.rodStroke ?? 30;
  const jawW = p.jawWidth ?? 28;
  const armLen = p.armLength ?? 90;
  const top = bodyH + stroke;
  return [
    cyl(bodyD / 2, bodyH, 0, bodyH / 2, 0),
    cyl(rodD / 2, stroke + 10, 0, bodyH + stroke / 2, 0),
    box(jawW, 14, armLen, 0, top + 7, armLen * 0.35),
    cyl(jawW * 0.4, 8, 0, top - 4, armLen * 0.7),
  ];
}

export function buildComponentParts(def: FixtureComponentDef): MeshPart[] {
  switch (def.type) {
    case 'column':
      return buildColumn(def.params);
    case 'locatingPin':
      return buildLocatingPin(def.params);
    case 'clamp':
      return buildClamp(def.params);
    case 'supportPin':
      return buildSupportPin(def.params);
    case 'hydraulicCylinder':
      return buildHydraulicCylinder(def.params);
  }
}

/** 参数化阀体:主阀体 + 两侧法兰 + 顶部阀盖 + 四周凸台 */
function buildValveBody(p: Record<string, number>): MeshPart[] {
  const L = p.length ?? 120;
  const W = p.width ?? 80;
  const H = p.height ?? 90;
  const flangeW = p.flangeWidth ?? 26;
  const flangeT = p.flangeThickness ?? 14;
  const bossD = p.bossDiameter ?? 30;
  const bossH = p.bossHeight ?? 12;
  const parts: MeshPart[] = [box(L, H, W)];
  // 两端法兰(沿 X)
  parts.push(box(flangeT, H * 0.72, W * 0.8, -L / 2 - flangeT / 2 + 1, 0, 0));
  parts.push(box(flangeT, H * 0.72, W * 0.8, L / 2 + flangeT / 2 - 1, 0, 0));
  // 顶部阀盖凸台
  parts.push(cyl(bossD / 2, bossH, 0, H / 2 + bossH / 2 - 1, 0, 'y'));
  parts.push(box(flangeW, 10, flangeW, 0, H / 2 + bossH + 4, 0));
  // 前后两侧凸台(沿 Z)
  parts.push(cyl(bossD * 0.42, bossH, 0, H * 0.12, W / 2 + bossH / 2 - 1, 'z'));
  parts.push(cyl(bossD * 0.42, bossH, 0, H * 0.12, -W / 2 - bossH / 2 + 1, 'z'));
  // 底部安装脚
  parts.push(box(L * 0.8, 10, W * 0.9, 0, -H / 2 - 4, 0));
  return parts;
}

/** 参数化泵壳:筒身 + 法兰盘 + 进出口凸台 + 支脚 */
function buildPumpHousing(p: Record<string, number>): MeshPart[] {
  const D = p.diameter ?? 110;
  const L = p.length ?? 100;
  const flangeD = p.flangeDiameter ?? D * 1.25;
  const flangeT = p.flangeThickness ?? 16;
  const portD = p.portDiameter ?? 28;
  const parts: MeshPart[] = [
    cyl(D / 2, L, 0, 0, 0, 'x', 32),
    cyl(flangeD / 2, flangeT, -L / 2 - flangeT / 2 + 1, 0, 0, 'x', 32),
    cyl(flangeD * 0.42, flangeT, L / 2 + flangeT / 2 - 1, 0, 0, 'x', 28),
    // 顶部进出口
    cyl(portD / 2, 26, 0, D / 2 + 12, 0, 'y', 24),
    cyl(portD * 0.8, 10, 0, D / 2 + 30, 0, 'y', 24),
    // 侧面凸台
    cyl(portD * 0.45, 18, 0, 0, D / 2 + 8, 'z', 20),
    // 支脚
    box(L * 0.7, 14, D * 0.5, 0, -D / 2 - 8, 0),
  ];
  return parts;
}

export function buildWorkpieceParts(def: WorkpieceDef): MeshPart[] {
  if (def.kind === 'pumpHousing') return buildPumpHousing(def.params);
  return buildValveBody(def.params);
}

/** 工件上的默认特征锚点(工件坐标系),用于自动生成加工特征 */
export interface FeatureAnchor {
  name: string;
  type: FeatureType;
  position: [number, number, number];
  direction: [number, number, number];
  diameter: number;
  depth: number;
}

export function getWorkpieceAnchors(def: WorkpieceDef): FeatureAnchor[] {
  if (def.kind === 'pumpHousing') {
    const D = def.params.diameter ?? 110;
    const L = def.params.length ?? 100;
    const portD = def.params.portDiameter ?? 28;
    return [
      { name: '进口法兰孔', type: 'counterbore', position: [-L / 2 - 14, 0, 0], direction: [-1, 0, 0], diameter: portD * 0.7, depth: 30 },
      { name: '出口端面', type: 'face', position: [0, D / 2 + 36, 0], direction: [0, 1, 0], diameter: portD, depth: 0 },
      { name: '出口螺纹孔', type: 'tappedHole', position: [0, D / 2 + 36, 0], direction: [0, 1, 0], diameter: portD * 0.55, depth: 22 },
      { name: '侧孔', type: 'hole', position: [0, 0, D / 2 + 16], direction: [0, 0, 1], diameter: 10, depth: 24 },
      { name: '后端盖孔', type: 'hole', position: [L / 2 + 14, 0, 0], direction: [1, 0, 0], diameter: 12, depth: 20 },
    ];
  }
  const L = def.params.length ?? 120;
  const W = def.params.width ?? 80;
  const H = def.params.height ?? 90;
  const bossD = def.params.bossDiameter ?? 30;
  const flangeT = def.params.flangeThickness ?? 14;
  return [
    { name: '主阀孔', type: 'hole', position: [-L / 2 - flangeT, 0, 0], direction: [-1, 0, 0], diameter: 20, depth: 40 },
    { name: '右端沉孔', type: 'counterbore', position: [L / 2 + flangeT, 0, 0], direction: [1, 0, 0], diameter: 24, depth: 16 },
    { name: '阀盖螺纹孔', type: 'tappedHole', position: [0, H / 2 + 26, 0], direction: [0, 1, 0], diameter: bossD * 0.45, depth: 18 },
    { name: '顶面', type: 'face', position: [0, H / 2 + 27, 0], direction: [0, 1, 0], diameter: bossD, depth: 0 },
    { name: '前侧孔', type: 'hole', position: [0, H * 0.12, W / 2 + 10], direction: [0, 0, 1], diameter: 8, depth: 20 },
    { name: '后侧孔', type: 'hole', position: [0, H * 0.12, -W / 2 - 10], direction: [0, 0, -1], diameter: 8, depth: 20 },
  ];
}

/** 特征方向标记:圆环 + 方向箭头 */
export function buildFeatureMarker(feature: MachiningFeature): THREE.Group {
  const g = new THREE.Group();
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(Math.max(feature.diameter / 2, 2), 0.8, 8, 28),
    new THREE.MeshBasicMaterial({ color: 0x37e6b5, depthTest: false }),
  );
  const arrow = new THREE.ArrowHelper(
    new THREE.Vector3(...feature.direction).normalize(),
    new THREE.Vector3(...feature.position),
    18,
    0x37e6b5,
    6,
    4,
  );
  const lineMat = arrow.line.material as THREE.LineBasicMaterial;
  lineMat.depthTest = false;
  (arrow.cone.material as THREE.MeshBasicMaterial).depthTest = false;
  g.add(ring, arrow);
  g.renderOrder = 999;
  return g;
}

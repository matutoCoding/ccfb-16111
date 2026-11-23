import * as THREE from 'three';
import type { Vec3 } from '../types';

export const v3 = (x = 0, y = 0, z = 0): THREE.Vector3 => new THREE.Vector3(x, y, z);
export const fromVec = (a: Vec3): THREE.Vector3 => new THREE.Vector3(a[0], a[1], a[2]);
export const toVec = (a: THREE.Vector3): Vec3 => [a.x, a.y, a.z];

export function normalize(a: Vec3): Vec3 {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
}

export function add(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}
export function sub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}
export function scale(a: Vec3, s: number): Vec3 {
  return [a[0] * s, a[1] * s, a[2] * s];
}
export function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}
export function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
export function len(a: Vec3): number {
  return Math.hypot(a[0], a[1], a[2]);
}
export function dist(a: Vec3, b: Vec3): number {
  return len(sub(a, b));
}

/** 线段(胶囊)与轴对齐包围盒相交测试,返回最小距离(不相交返回 Infinity) */
export function segmentAABBDistance(p0: THREE.Vector3, p1: THREE.Vector3, min: THREE.Vector3, max: THREE.Vector3): number {
  // 把 AABB 转为中心+半尺寸,用标准胶囊-盒距离
  const center = min.clone().add(max).multiplyScalar(0.5);
  const half = max.clone().sub(min).multiplyScalar(0.5);
  const a = p0.clone().sub(center);
  const b = p1.clone().sub(center);
  const d = b.clone().sub(a);

  // 点到线段参数
  const t0 = THREE.MathUtils.clamp(-a.dot(d) / (d.lengthSq() || 1), 0, 1);
  const closestOnSeg = a.clone().add(d.multiplyScalar(t0));
  const q = closestOnSeg.clone().clamp(
    new THREE.Vector3(-half.x, -half.y, -half.z),
    half,
  );
  return closestOnSeg.distanceTo(q);
}

/** 世界坐标 -> 绕 Y 轴旋转 angle 度后的转台局部坐标 */
export function worldToTable(world: THREE.Vector3, angleDeg: number): THREE.Vector3 {
  return world.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), -THREE.MathUtils.degToRad(angleDeg));
}

export function degToRad(d: number): number {
  return THREE.MathUtils.degToRad(d);
}
export function radToDeg(r: number): number {
  return THREE.MathUtils.radToDeg(r);
}

export function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}

/** 角度归一化到 [0, 360) */
export function normAngle(deg: number): number {
  return ((deg % 360) + 360) % 360;
}

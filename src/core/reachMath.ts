// 可达性纯数学判定(无 GPU 依赖,可在 Node 下单测)
import type { AngleRecommendation, MachiningFeature, ReachCell, ToolDef } from '../types';
import { normAngle } from './mathUtils';

/** 判定阈值(毫米):用户硬性要求 —— 0.5mm 间隙判可达,0.2mm 侵入判挡住 */
export const SAFE_GAP = 0.5;
export const BLOCK_INTRUSION = 0.2;
/** 细级联像素级安全余量(细图约 0.04mm/像素,取 0.05) */
export const SUB_PIXEL_EPS = 0.05;

export type ClearanceVerdict = 'safe' | 'critical' | 'collision';

export function classifyGap(gap: number): ClearanceVerdict {
  if (gap <= -BLOCK_INTRUSION) return 'collision';
  if (gap >= SAFE_GAP) return 'safe';
  return 'critical';
}

export interface EnvelopeClearances {
  /** 刀杆半径内最近障碍距特征面的距离(mm),无障碍为 Infinity */
  shank: number;
  /** 刀柄半径内最近障碍距特征面的距离(mm) */
  holder: number;
  blockerId: string | null;
  blockerLabel: string | null;
}

export interface LengthFeasibility {
  /** 可达 = 存在满足条件的刀长 */
  reachable: boolean;
  /** 推荐最短不干涉刀长(含安全间隙),不可行时为 null */
  minToolLength: number | null;
  /** 可行刀长区间上限(超过会撞刀杆障碍) */
  maxToolLength: number | null;
  shankGap: number;
  holderGap: number;
  reason: string;
}

/**
 * 由两级深度图的清除距离推导刀长可行区间。
 * 刀杆(半径 rTool,长 L)需在 rTool 柱体内深入到 L;
 * 刀柄(半径 rHolder,长 lh)占据深度 0..L-lh 的 rHolder 柱体。
 */
export function evaluateToolLength(
  c: EnvelopeClearances,
  tool: ToolDef,
  feature: MachiningFeature,
): LengthFeasibility {
  const L = tool.fluteLength + tool.holderLength;
  const lh = tool.holderLength;
  const requiredReach = feature.depth + 5; // 刃尖至少越过特征面 5mm 余量

  const shankGap = Number.isFinite(c.shank) ? c.shank - L : Infinity;
  const holderFront = L - lh; // 刀柄前端相对特征面的深度
  const holderGap = Number.isFinite(c.holder) ? c.holder - holderFront : Infinity;

  const shankVerdict = classifyGap(shankGap);
  const holderVerdict = classifyGap(holderGap);

  if (shankVerdict === 'collision') {
    return {
      reachable: false,
      minToolLength: null,
      maxToolLength: null,
      shankGap,
      holderGap,
      reason: `刀杆被${c.blockerLabel ?? '障碍'}遮挡(侵入 ${(-shankGap).toFixed(2)}mm)`,
    };
  }
  if (holderVerdict === 'collision') {
    return {
      reachable: false,
      minToolLength: null,
      maxToolLength: null,
      shankGap,
      holderGap,
      reason: `刀柄与${c.blockerLabel ?? '障碍'}干涉(侵入 ${(-holderGap).toFixed(2)}mm),需加长刀具`,
    };
  }

  // 最短刀长:满足加工深度且刀柄前方留出安全间隙
  const minLength = Math.max(requiredReach, Number.isFinite(c.holder) ? c.holder + lh + SAFE_GAP : requiredReach);
  // 刀杆侧允许的最大刀长
  const maxLength = Number.isFinite(c.shank) ? c.shank + BLOCK_INTRUSION - SUB_PIXEL_EPS : null;

  if (maxLength !== null && minLength > maxLength) {
    return {
      reachable: false,
      minToolLength: null,
      maxToolLength: maxLength,
      shankGap,
      holderGap,
      reason: `刀长可行区间为空:最短需 ${minLength.toFixed(1)}mm,但超过 ${maxLength.toFixed(1)}mm 刀杆即撞${c.blockerLabel ?? '障碍'}`,
    };
  }

  const warn =
    shankVerdict === 'critical' || holderVerdict === 'critical'
      ? '(临界,间隙小于 0.5mm,建议复核)'
      : '';
  return {
    reachable: true,
    minToolLength: round1(minLength),
    maxToolLength: maxLength === null ? null : round1(maxLength),
    shankGap,
    holderGap,
    reason: `可达,最短不干涉刀长 ${round1(minLength)}mm ${warn}`,
  };
}

function round1(x: number): number {
  return Math.round(x * 10) / 10;
}

/** 特征加工方向(转台局部系)与主轴方向(0,0,-1)的夹角,度 */
export function spindleAlignmentAngle(dirX: number, dirY: number, dirZ: number): number {
  const l = Math.hypot(dirX, dirY, dirZ) || 1;
  const cosA = -dirZ / l;
  return (Math.acos(Math.max(-1, Math.min(1, cosA))) * 180) / Math.PI;
}

/** 角度对齐容差:B 角 5° 步进、四面塔 90° 分布,给 20° */
export const ALIGN_TOLERANCE_DEG = 20;

export function isAlignedToSpindle(angleDeg: number): boolean {
  return angleDeg <= ALIGN_TOLERANCE_DEG;
}

/**
 * 从可达矩阵推荐一次装夹加工特征最多的角度组。
 * 贪心集合覆盖:每轮选覆盖剩余特征最多的角度,返回前 3 个。
 */
export function recommendAngles(angles: number[], cells: ReachCell[], topK = 3): AngleRecommendation[] {
  const reachable = new Map<number, Set<string>>();
  for (const a of angles) reachable.set(a, new Set());
  for (const cell of cells) {
    if (cell.reachable) reachable.get(cell.angle)?.add(cell.featureId);
  }
  const covered = new Set<string>();
  const out: AngleRecommendation[] = [];
  for (let k = 0; k < topK; k++) {
    let bestAngle = -1;
    let bestGain = 0;
    for (const a of angles) {
      const ids = [...(reachable.get(a) ?? [])].filter((id) => !covered.has(id));
      if (ids.length > bestGain) {
        bestGain = ids.length;
        bestAngle = a;
      }
    }
    if (bestAngle < 0 || bestGain === 0) break;
    const allIds = [...(reachable.get(bestAngle) ?? [])];
    out.push({ angle: bestAngle, featureCount: allIds.length, featureIds: allIds });
    for (const id of allIds) covered.add(id);
  }
  return out;
}

/** B 角扫描序列 0..360(不含 360) */
export function angleSequence(step: number): number[] {
  const n = Math.round(360 / step);
  return Array.from({ length: n }, (_, i) => normAngle(i * step));
}

/** 工具几何签名(同半径/长度的刀只渲染一次) */
export function toolSignature(t: ToolDef): string {
  return `${t.diameter.toFixed(2)}|${t.holderDiameter.toFixed(2)}|${t.holderLength.toFixed(1)}|${t.fluteLength.toFixed(1)}`;
}

// Node 自测:验证可达判定的硬性精度边界与角度推荐逻辑
// 运行:npm run selftest
import { classifyGap, evaluateToolLength, recommendAngles, angleSequence, SAFE_GAP, BLOCK_INTRUSION } from '../src/core/reachMath';
import type { MachiningFeature, ReachCell, ToolDef } from '../src/types';

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, detail = ''): void {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.error(`  ✗ ${name} ${detail}`); }
}

const tool: ToolDef = {
  id: 't', name: '测试刀', toolNumber: 'T1',
  diameter: 3, fluteLength: 40, holderDiameter: 20, holderLength: 35,
};
const feature: MachiningFeature = {
  id: 'f', workpieceId: 'w', type: 'hole', name: 'Φ3 小孔',
  position: [0, 0, 0], direction: [0, 0, 1], diameter: 3, depth: 12, toolIds: ['t'],
};

console.log('1) 间隙分类阈值');
check('间隙 0.5mm 判 safe', classifyGap(SAFE_GAP) === 'safe');
check('间隙 0.6mm 判 safe', classifyGap(0.6) === 'safe');
check('侵入 0.2mm 判 collision', classifyGap(-BLOCK_INTRUSION) === 'collision');
check('侵入 0.3mm 判 collision', classifyGap(-0.3) === 'collision');
check('间隙 0.1mm 判 critical(不误判)', classifyGap(0.1) === 'critical');
check('侵入 0.1mm 判 critical(不误判)', classifyGap(-0.1) === 'critical');
check('零间隙判 critical', classifyGap(0) === 'critical');

console.log('2) 刀杆包络:3mm 孔边 0.5mm 间隙必须可达');
{
  // 刀长 L=75(40+35),刀杆柱内障碍在 75.5mm 处 -> 间隙 0.5
  const r = evaluateToolLength({ shank: 75.5, holder: Infinity, blockerId: null, blockerLabel: null }, tool, feature);
  check('0.5mm 间隙可达', r.reachable === true, r.reason);
}
{
  // 障碍在 74.8mm 处 -> 侵入 0.2mm,必须判挡住
  const r = evaluateToolLength({ shank: 74.8, holder: Infinity, blockerId: 'c', blockerLabel: '压板' }, tool, feature);
  check('0.2mm 侵入判挡住', r.reachable === false && r.reason.includes('刀杆'), r.reason);
  check('挡住时给出障碍名称', r.reason.includes('压板'));
}

console.log('3) 刀柄包络:刀柄干涉时给出最短不干涉刀长');
{
  // 刀杆侧无障碍,刀柄半径内 60mm 处有压板;刀柄前端深度 = L-lh = 40
  // 刀柄间隙 = 60-40 = 20mm(安全),应可达,最短刀长 = max(17, 60+35+0.5)=95.5
  const r = evaluateToolLength({ shank: Infinity, holder: 60, blockerId: 'c', blockerLabel: '压板' }, tool, feature);
  check('刀柄前方有间隙可达', r.reachable === true, r.reason);
  check('最短刀长=95.5', r.minToolLength === 95.5, `实际 ${r.minToolLength}`);
}
{
  // 障碍在 35mm,刀柄前端 40 -> 侵入 5mm,当前刀不可行
  const r = evaluateToolLength({ shank: Infinity, holder: 35, blockerId: 'c', blockerLabel: '压板' }, tool, feature);
  check('刀柄干涉当前刀判不可达', r.reachable === false && r.reason.includes('刀柄'), r.reason);
}

console.log('4) 刀长可行区间为空的情形');
{
  // 刀杆侧 80mm 处有障碍(允许的最长刀 ~79.9mm),刀柄侧障碍在 90mm
  // -> 刀柄要求最短刀长 90+35+0.5=125.5mm,远超刀杆上限,区间为空
  const r = evaluateToolLength({ shank: 80, holder: 90, blockerId: 'c', blockerLabel: '压板' }, tool, feature);
  check('区间为空判不可达', r.reachable === false && r.reason.includes('区间为空'), r.reason);
  check('给出刀长上限', r.maxToolLength !== null && r.maxToolLength < 90, `实际 ${r.maxToolLength}`);
}

console.log('5) 无障碍场景');
{
  const r = evaluateToolLength({ shank: Infinity, holder: Infinity, blockerId: null, blockerLabel: null }, tool, feature);
  check('完全无障碍可达', r.reachable === true);
  check('最短刀长满足孔深+5mm 余量=17', r.minToolLength === 17, `实际 ${r.minToolLength}`);
}

console.log('6) B 角序列与推荐角度(贪心集合覆盖)');
{
  const angles = angleSequence(5);
  check('5° 步进生成 72 个角度', angles.length === 72);
  check('角度从 0 开始且不含 360', angles[0] === 0 && angles[angles.length - 1] === 355);
  const fids = ['f1', 'f2', 'f3', 'f4'];
  const cells: ReachCell[] = [];
  for (const a of angles) {
    for (const fid of fids) {
      // 90° 覆盖 f1/f2/f3,180° 覆盖 f3/f4,0° 只覆盖 f1
      const reachable =
        (a === 90 && ['f1', 'f2', 'f3'].includes(fid)) ||
        (a === 180 && ['f3', 'f4'].includes(fid)) ||
        (a === 0 && fid === 'f1');
      cells.push({ angle: a, featureId: fid, reachable, reason: '', minToolLength: 20, holderCollision: false, nearestClearance: 10, blockerId: null, blockerLabel: null, elapsedMs: 0 });
    }
  }
  const recs = recommendAngles(angles, cells, 3);
  check('首选角度为覆盖最多的 90°', recs[0]?.angle === 90 && recs[0].featureCount === 3);
  check('次选 180° 补全 f4', recs[1]?.angle === 180);
  check('两个角度覆盖全部 4 特征', new Set(recs.flatMap((r) => r.featureIds)).size === 4);
}

console.log('7) 扫描性能预算估算(几何参数核验)');
{
  // 细级联:128px,半宽 rTool+0.8。Φ3 刀 rTool=1.5 -> 半宽 2.3mm -> 0.036mm/像素
  const pxMm = (2 * (1.5 + 0.8)) / 128;
  check('细级联分辨率 ≤0.05mm/像素', pxMm <= 0.05, `实际 ${pxMm.toFixed(4)}`);
  // 0.5mm 间隙对应像素数
  check('0.5mm 间隙 ≥10 像素(不会被邻域淹没)', 0.5 / pxMm >= 10);
  // 0.2mm 侵入对应像素数
  check('0.2mm 侵入 ≥4 像素(必然被检出)', 0.2 / pxMm >= 4);
}

console.log(`\n结果:${pass} 通过,${fail} 失败`);
if (fail > 0) process.exit(1);

// 可达性校验页面:B 角×特征矩阵热力图、推荐角度、压板影响、最短刀长
import { store } from '../services/store';
import { clear, fmt, h, toast } from '../ui/dom';
import { computeAngle, featuresBlockedBy, patchMatrix } from '../services/reachService';
import type { App } from '../app';
import type { ReachCell, ReachMatrix } from '../types';

export function renderReachPage(panel: HTMLElement, app: App): void {
  clear(panel);
  const setup = store.currentSetup;
  const wrap = h('div', { class: 'page-body' });
  wrap.append(h('h3', { text: '可达性校验(两级级联正交深度图:刀杆级 ~0.04mm/像素 + 刀柄级环形包络)' }));
  if (!setup) { panel.append(wrap); return; }

  const matrix = store.currentMatrix;
  wrap.append(h('div', { class: 'row gap wrap' },
    h('button', {
      class: 'btn btn-primary btn-sm',
      onclick: () => app.runFullScan(),
    }, app.scanning ? '扫描中…' : `全量扫描 0~360°(步进 ${setup.angleStep}°)`),
    h('button', {
      class: 'btn btn-ghost btn-sm',
      onclick: () => recomputeCurrent(app),
    }, `仅重算当前 B=${app.angle}°`),
    h('span', { class: 'muted small' }, '判定阈值:间隙 ≥0.5mm 判可达;侵入 ≥0.2mm 判挡住;中间为临界需复核'),
  ));

  if (!matrix) {
    wrap.append(h('div', { class: 'empty-hint' }, '尚未计算,点击「全量扫描」生成可达矩阵。'));
    panel.append(wrap);
    return;
  }

  wrap.append(recommendations(matrix, app));
  wrap.append(heatmap(matrix, app));
  wrap.append(detailPanel(matrix, app));
  wrap.append(blockerPanel(setup.id, app));
  panel.append(wrap);
}

function recommendations(m: ReachMatrix, app: App): HTMLElement {
  const box = h('div', { class: 'card' }, h('div', { class: 'card-head' }, h('strong', { text: '推荐加工角度(贪心集合覆盖,一次装夹覆盖最多特征)' })));
  const row = h('div', { class: 'row gap wrap' });
  for (const r of m.recommendations) {
    row.append(h('button', {
      class: 'btn btn-primary',
      title: r.featureIds.map((id) => store.state.features.find((f) => f.id === id)?.name ?? id).join('\n'),
      onclick: () => app.setAngle(r.angle),
    }, `B=${r.angle}° · ${r.featureCount} 特征`));
  }
  if (!m.recommendations.length) row.append(h('span', { class: 'muted' }, '当前无任何可达角度,请检查装夹'));
  box.append(row);
  return box;
}

function heatmap(m: ReachMatrix, app: App): HTMLElement {
  const features = store.state.features.filter((f) => store.currentSetup?.featureIds.includes(f.id));
  const box = h('div', { class: 'card' },
    h('div', { class: 'card-head' }, h('strong', { text: `可达矩阵(绿=可达,红=挡住,灰=方向不对;点击单元格跳转 B 角)` })));
  const scroll = h('div', { class: 'matrix-scroll' });
  const tbl = h('table', { class: 'matrix' });

  const head = h('tr', {}, h('th', { class: 'mh-corner', text: '特征 \\ B角' }));
  for (const a of m.angles) head.append(h('th', { class: `mh ${a === app.angle ? 'mh-cur' : ''}`, onclick: () => app.setAngle(a), text: `${a}` }));
  tbl.append(h('thead', {}, head));

  const tb = h('tbody', {});
  for (const f of features) {
    const tr = h('tr', {}, h('th', { class: 'mh-row', text: f.name }));
    for (const a of m.angles) {
      const cell = m.cells.find((c) => c.featureId === f.id && c.angle === a);
      const cls = !cell ? 'mc mc-empty' : cell.reachable ? 'mc mc-ok' : cell.blockerId ? 'mc mc-block' : 'mc mc-miss';
      const td = h('td', { class: `${cls} ${a === app.angle ? 'mc-cur' : ''}` });
      if (cell) {
        td.title = `${f.name} @B=${a}°\n${cell.reason}\n最近间隙:${fmt(cell.nearestClearance, 2)}mm${cell.blockerLabel ? `\n障碍:${cell.blockerLabel}` : ''}`;
        td.textContent = cell.reachable ? '✓' : cell.blockerId ? '✗' : '·';
        td.addEventListener('click', () => {
          app.setAngle(a);
          app.selectedFeatureId = f.id;
          app.renderPanel();
        });
      }
      tr.append(td);
    }
    tb.append(tr);
  }
  tbl.append(tb);
  scroll.append(tbl);
  box.append(scroll);
  return box;
}

function detailPanel(m: ReachMatrix, app: App): HTMLElement {
  const box = h('div', { class: 'card' }, h('div', { class: 'card-head' }, h('strong', { text: `当前 B=${app.angle}° 明细` })));
  const cells = m.cells.filter((c) => c.angle === app.angle);
  const tbl = h('table', { class: 'tbl' },
    h('thead', {}, h('tr', {}, ...['特征', '结论', '最近间隙', '最短刀长', '障碍', '判定依据'].map((t) => h('th', { text: t })))),
    h('tbody', {}, ...cells.map((c) => cellRow(c, app))));
  box.append(tbl);
  const timings = cells.filter((c) => c.elapsedMs > 0).map((c) => c.elapsedMs);
  if (timings.length) {
    const avg = timings.reduce((a, b) => a + b, 0) / timings.length;
    const max = Math.max(...timings);
    box.append(h('div', { class: 'muted small perf-line' }, `本角 GPU 探针:${timings.length} 特征,单特征均值 ${avg.toFixed(2)}ms,峰值 ${max.toFixed(2)}ms`));
  }
  return box;
}

function cellRow(c: ReachCell, app: App): HTMLElement {
  const f = store.state.features.find((x) => x.id === c.featureId);
  return h('tr', { class: app.selectedFeatureId === c.featureId ? 'sel' : '', onclick: () => { app.selectedFeatureId = c.featureId; app.renderPanel(); } },
    h('td', { text: f?.name ?? c.featureId }),
    h('td', {}, h('span', { class: `tag ${c.reachable ? 'tag-ok' : 'tag-fail'}` }, c.reachable ? '可达' : '不可达')),
    h('td', { text: fmt(c.nearestClearance, 2) }),
    h('td', { text: c.minToolLength === null ? '—' : `${fmt(c.minToolLength)}mm` }),
    h('td', { text: c.blockerLabel ?? '—' }),
    h('td', { class: 'muted small reason-cell', text: c.reason }),
  );
}

function blockerPanel(setupId: string, app: App): HTMLElement {
  const box = h('div', { class: 'card' }, h('div', { class: 'card-head' }, h('strong', { text: '压板/元件遮挡关系(挪动后自动重算)' })));
  const blockerIds = new Set(store.currentMatrix?.cells.filter((c) => c.blockerId).map((c) => c.blockerId!) ?? []);
  if (!blockerIds.size) {
    box.append(h('div', { class: 'muted' }, '当前矩阵中没有元件造成遮挡。'));
    return box;
  }
  for (const id of blockerIds) {
    const cells = featuresBlockedBy(setupId, id);
    const inst = store.currentSetup?.components.find((c) => c.id === id);
    const def = store.state.components.find((d) => d.id === inst?.defId);
    const featureNames = [...new Set(cells.map((c) => store.state.features.find((f) => f.id === c.featureId)?.name ?? c.featureId))];
    box.append(h('div', { class: 'blocker-row' },
      h('button', { class: 'btn btn-warn btn-sm', onclick: () => { app.selectedInstanceId = id; app.view.highlightInstance(id); app.route('setup'); } }, `定位:${def?.name ?? id}`),
      h('span', { class: 'muted small' }, `挡住 ${featureNames.length} 个特征:${featureNames.slice(0, 4).join('、')}${featureNames.length > 4 ? ' 等' : ''}`),
    ));
  }
  return box;
}

async function recomputeCurrent(app: App): Promise<void> {
  const setup = store.currentSetup;
  if (!setup) return;
  const t0 = performance.now();
  const cells = computeAngle(setup, app.angle);
  await patchMatrix(setup, app.angle, cells);
  const ms = performance.now() - t0;
  toast(`B=${app.angle}° 重算完成:${cells.length} 特征,耗时 ${ms.toFixed(1)}ms`);
  app.refreshView();
  app.renderPanel();
}

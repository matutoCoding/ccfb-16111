// 工艺卡页面:按 B 角分工步,特征/刀号/最短刀长,附三维截图,可导出
import { store } from '../services/store';
import { clear, download, fmt, h, toast } from '../ui/dom';
import type { App } from '../app';
import type { ProcessCard, ProcessStep, ReachMatrix } from '../types';
import { uid } from '../types';

export function renderCardPage(panel: HTMLElement, app: App): void {
  clear(panel);
  const setup = store.currentSetup;
  const wrap = h('div', { class: 'page-body' });
  wrap.append(h('h3', { text: '工艺卡(按推荐 B 角分工步,含刀号与最短不干涉刀长)' }));
  if (!setup) { panel.append(wrap); return; }
  const matrix = store.currentMatrix;
  if (!matrix) {
    wrap.append(h('div', { class: 'empty-hint' }, '请先在「可达性校验」完成扫描。'));
    panel.append(wrap);
    return;
  }

  const saved = store.state.cards.filter((c) => c.setupId === setup.id);
  wrap.append(h('div', { class: 'row gap' },
    h('button', { class: 'btn btn-primary btn-sm', onclick: () => generateCard(setup.id, matrix, app) }, '生成工艺卡(含三维截图)'),
    ...saved.map((c) => h('button', { class: 'btn btn-ghost btn-sm', onclick: () => exportCard(c) }, `导出:${c.name}`)),
    ...saved.map((c) => h('button', { class: 'btn btn-danger btn-sm', onclick: async () => store.remove('cards', c.id) }, `删除:${c.name}`)),
  ));

  if (saved.length) {
    for (const card of saved) wrap.append(cardView(card));
  } else {
    wrap.append(previewCard(matrix, app));
  }
  panel.append(wrap);
}

function buildSteps(matrix: ReachMatrix): ProcessCard['groups'] {
  // 按推荐角度顺序,每个特征取其可达角度中推荐顺序最靠前的
  const picked = new Map<string, number>();
  for (const rec of matrix.recommendations) {
    for (const fid of rec.featureIds) if (!picked.has(fid)) picked.set(fid, rec.angle);
  }
  const groups = new Map<number, ProcessStep[]>();
  for (const [fid, angle] of picked) {
    const cell = matrix.cells.find((c) => c.featureId === fid && c.angle === angle);
    const feature = store.state.features.find((f) => f.id === fid);
    if (!cell || !feature) continue;
    const steps: ProcessStep[] = [];
    const tools = feature.toolIds.map((id) => store.state.tools.find((t) => t.id === id)).filter(Boolean);
    const list = tools.length ? tools : [undefined];
    for (const tool of list) {
      steps.push({
        angle,
        featureId: fid,
        featureName: feature.name,
        toolNumber: tool?.toolNumber ?? '—',
        toolName: tool?.name ?? '未指定刀具',
        minToolLength: cell.minToolLength ?? 0,
      });
    }
    if (!groups.has(angle)) groups.set(angle, []);
    groups.get(angle)!.push(...steps);
  }
  return [...groups.entries()].sort((a, b) => a[0] - b[0]).map(([angle, steps]) => ({ angle, steps }));
}

function previewCard(matrix: ReachMatrix, app: App): HTMLElement {
  const groups = buildSteps(matrix);
  const box = h('div', { class: 'card' }, h('div', { class: 'card-head' }, h('strong', { text: '工艺卡预览(保存后附三维截图)' })));
  for (const g of groups) box.append(stepTable(g.angle, g.steps, null));
  const uncovered = new Set(matrix.cells.filter((c) => !c.reachable).map((c) => c.featureId));
  if (uncovered.size) {
    box.append(h('div', { class: 'loc-fail pad' }, `⚠ 另有 ${uncovered.size} 个特征在全部 B 角均不可达,未纳入工艺卡,需调整装夹。`));
  }
  return box;
}

async function generateCard(setupId: string, matrix: ReachMatrix, app: App): Promise<void> {
  const groups = buildSteps(matrix);
  for (const g of groups) {
    app.setAngle(g.angle);
    await new Promise((r) => setTimeout(r, 120)); // 等渲染帧
    g.screenshot = app.view.screenshot();
  }
  const card: ProcessCard = {
    id: uid('crd'), setupId,
    name: `工艺卡 ${new Date().toLocaleString('zh-CN', { hour12: false })}`,
    createdAt: Date.now(),
    groups: groups as ProcessCard['groups'],
  };
  await store.upsert('cards', card);
  toast('工艺卡已生成并保存到 IndexedDB');
  app.renderPanel();
}

function cardView(card: ProcessCard): HTMLElement {
  const box = h('div', { class: 'card card-out' }, h('div', { class: 'card-head' }, h('strong', { text: card.name })));
  for (const g of card.groups) {
    const body = h('div', { class: 'shot-row' }, stepTable(g.angle, g.steps, null));
    if (g.screenshot) {
      body.append(h('div', { class: 'shot-box' },
        h('img', { src: g.screenshot, alt: `B=${g.angle} 三维截图` }),
        h('div', { class: 'muted small center' }, `B=${g.angle}° 工位三维截图`)));
    }
    box.append(body);
  }
  return box;
}

function stepTable(angle: number, steps: ProcessStep[], _: unknown): HTMLElement {
  const tbl = h('table', { class: 'tbl step-tbl' },
    h('thead', {}, h('tr', {}, ...[`工步(B=${angle}°)`, '特征', '刀号', '刀具', '最短刀长 mm'].map((t) => h('th', { text: t })))));
  const tb = h('tbody', {});
  steps.forEach((s, i) => {
    tb.append(h('tr', {},
      h('td', { text: `${angle}-${String(i + 1).padStart(2, '0')}` }),
      h('td', { text: s.featureName }),
      h('td', {}, h('span', { class: 'tag tag-blue' }, s.toolNumber)),
      h('td', { text: s.toolName }),
      h('td', { text: s.minToolLength ? fmt(s.minToolLength) : '—' }),
    ));
  });
  tbl.append(tb);
  return tbl;
}

function exportCard(card: ProcessCard): void {
  const payload = {
    name: card.name,
    createdAt: new Date(card.createdAt).toISOString(),
    groups: card.groups.map((g) => ({
      angle: g.angle,
      steps: g.steps.map((s) => ({ feature: s.featureName, toolNumber: s.toolNumber, tool: s.toolName, minToolLength: s.minToolLength })),
      screenshot: g.screenshot ? '[base64 PNG 已内嵌于 IndexedDB 记录]' : undefined,
    })),
  };
  download(`${card.name.replace(/[\\/:*?"<>|]/g, '_')}.json`, JSON.stringify(payload, null, 2), 'application/json');
}

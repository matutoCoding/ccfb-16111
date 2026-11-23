// 加工特征页面:特征列表、点选拾取、加工方向、多刀具挂载
import { store } from '../services/store';
import { clear, field, fmt, h, numInput, toast } from '../ui/dom';
import { getWorkpieceAnchors } from '../core/geometry';
import type { App } from '../app';
import type { FeatureType, FixtureSetup, MachiningFeature } from '../types';
import { uid } from '../types';

const FEATURE_LABEL: Record<FeatureType, string> = {
  hole: '孔',
  face: '端面',
  tappedHole: '螺纹孔',
  counterbore: '沉孔',
};
const DIR_PRESETS: [string, [number, number, number]][] = [
  ['+X', [1, 0, 0]], ['-X', [-1, 0, 0]],
  ['+Y', [0, 1, 0]], ['-Y', [0, -1, 0]],
  ['+Z', [0, 0, 1]], ['-Z', [0, 0, -1]],
];

export function renderFeaturesPage(panel: HTMLElement, app: App): void {
  clear(panel);
  const setup = store.currentSetup;
  const wrap = h('div', { class: 'page-body' });
  wrap.append(h('h3', { text: '加工特征(在三维视图中点选特征标记,或按工件锚点批量生成)' }));
  if (!setup) { panel.append(wrap); return; }

  const features = store.state.features.filter((f) => setup.featureIds.includes(f.id));

  wrap.append(h('div', { class: 'row gap wrap' },
    h('button', { class: 'btn btn-primary btn-sm', onclick: () => generateAnchors(setup, app) }, '按工件锚点自动生成特征'),
    h('button', { class: 'btn btn-ghost btn-sm', onclick: () => addManualFeature(setup, app) }, '+ 手动添加特征'),
  ));

  const tbl = h('table', { class: 'tbl' });
  tbl.append(h('thead', {}, h('tr', {}, ...['特征', '类型', '位置(工件系)', '方向', '直径', '孔深', '挂载刀具', '状态'].map((t) => h('th', { text: t })))));
  const tb = h('tbody', {});
  const matrix = store.currentMatrix;
  for (const f of features) {
    const cell = matrix?.cells.find((c) => c.angle === app.angle && c.featureId === f.id);
    const status = cell ? (cell.reachable ? h('span', { class: 'tag tag-ok' }, `可达 · 刀长≥${cell.minToolLength ?? '?'}mm`) : h('span', { class: 'tag tag-fail' }, cell.blockerLabel ? `被${cell.blockerLabel}挡` : '不可达')) : h('span', { class: 'tag' }, '未计算');
    tb.append(h('tr', { class: app.selectedFeatureId === f.id ? 'sel' : '', onclick: () => { app.selectedFeatureId = f.id; app.route('reach'); } },
      h('td', { text: f.name }),
      h('td', { text: FEATURE_LABEL[f.type] }),
      h('td', { text: f.position.map((v) => fmt(v, 0)).join(', ') }),
      h('td', { text: dirText(f.direction) }),
      h('td', { text: `${fmt(f.diameter)}` }),
      h('td', { text: fmt(f.depth) }),
      h('td', {}, toolChips(f)),
      h('td', {}, status),
    ));
  }
  tbl.append(tb);
  wrap.append(tbl);

  const selected = features.find((f) => f.id === app.selectedFeatureId);
  if (selected) wrap.append(editor(selected, setup, app));
  panel.append(wrap);
}

function dirText(d: [number, number, number]): string {
  const i = DIR_PRESETS.findIndex(([, v]) => v.every((x, k) => Math.abs(x - d[k]) < 0.01));
  return i >= 0 ? DIR_PRESETS[i][0] : d.map((x) => fmt(x, 2)).join(',');
}

function toolChips(f: MachiningFeature): HTMLElement {
  const box = h('div', { class: 'chip-row' });
  for (const t of store.state.tools) {
    const on = f.toolIds.includes(t.id);
    box.append(h('button', {
      class: `chip ${on ? 'chip-on' : ''}`,
      title: `${t.name} Φ${t.diameter} 刀柄Φ${t.holderDiameter}`,
      onclick: async (e: Event) => {
        e.stopPropagation();
        f.toolIds = on ? f.toolIds.filter((id) => id !== t.id) : [...f.toolIds, t.id];
        await store.upsert('features', f);
      },
    }, t.toolNumber));
  }
  return box;
}

function editor(f: MachiningFeature, setup: FixtureSetup, app: App): HTMLElement {
  const save = async () => { await store.upsert('features', f); app.refreshView(); app.renderPanel(); };
  const box = h('div', { class: 'card' }, h('div', { class: 'card-head' }, h('strong', { text: `编辑:${f.name}` })));
  box.append(h('div', { class: 'param-grid' },
    field('名称', (() => { const i = h('input', { class: 'inp', value: f.name }) as HTMLInputElement; i.addEventListener('change', () => { f.name = i.value; save(); }); return i; })()),
    field('直径 mm', numInput(f.diameter, 0.5, (v) => { f.diameter = v; save(); })),
    field('孔深 mm', numInput(f.depth, 1, (v) => { f.depth = v; save(); })),
  ));
  const typeSel = h('select', { class: 'inp' }, ...(Object.keys(FEATURE_LABEL) as FeatureType[]).map((t) => h('option', { value: t, text: FEATURE_LABEL[t], selected: t === f.type }))) as HTMLSelectElement;
  typeSel.addEventListener('change', () => { f.type = typeSel.value as FeatureType; save(); });
  box.append(field('特征类型', typeSel));

  const dirRow = h('div', { class: 'row gap' });
  for (const [label, dir] of DIR_PRESETS) {
    dirRow.append(h('button', {
      class: `btn btn-sm ${dirText(f.direction) === label ? 'btn-primary' : 'btn-ghost'}`,
      onclick: () => { f.direction = [...dir]; save(); },
    }, label));
  }
  box.append(field('加工方向(工件坐标系)', dirRow));
  box.append(h('div', { class: 'muted small' }, '一个特征可挂载多把刀:可达性按最粗刀杆/刀柄包络判定,并分别给出每把刀的最短不干涉刀长。'));
  return box;
}

async function generateAnchors(setup: FixtureSetup, app: App): Promise<void> {
  const added: MachiningFeature[] = [];
  for (const wpInst of setup.workpieces) {
    const def = store.state.workpieces.find((d) => d.id === wpInst.defId);
    if (!def || def.kind === 'stl') continue;
    const exists = new Set(store.state.features.filter((f) => f.workpieceId === wpInst.id).map((f) => f.name));
    for (const a of getWorkpieceAnchors(def)) {
      const name = `${def.name}-${a.name}`;
      if (exists.has(name)) continue;
      added.push({
        id: uid('fea'), workpieceId: wpInst.id, type: a.type, name,
        position: a.position, direction: a.direction, diameter: a.diameter, depth: a.depth,
        toolIds: defaultTools(a.type),
      });
    }
  }
  if (!added.length) { toast('特征已存在,无新增', 'warn'); return; }
  await store.save('features', [...store.state.features, ...added]);
  setup.featureIds = [...new Set([...setup.featureIds, ...added.map((f) => f.id)])];
  await store.upsert('setups', setup);
  toast(`已生成 ${added.length} 个加工特征`);
  app.refreshView();
}

function defaultTools(type: FeatureType): string[] {
  switch (type) {
    case 'hole': return ['tool_d3', 'tool_d8'];
    case 'tappedHole': return ['tool_m10'];
    case 'counterbore': return ['tool_d12', 'tool_d20'];
    case 'face': return ['tool_f32'];
  }
}

async function addManualFeature(setup: FixtureSetup, app: App): Promise<void> {
  const wp = setup.workpieces[0];
  if (!wp) { toast('请先布置工件', 'warn'); return; }
  const f: MachiningFeature = {
    id: uid('fea'), workpieceId: wp.id, type: 'hole', name: `手动特征 ${store.state.features.length + 1}`,
    position: [0, 40, 0], direction: [0, 1, 0], diameter: 6, depth: 15, toolIds: ['tool_d8'],
  };
  await store.upsert('features', f);
  setup.featureIds.push(f.id);
  await store.upsert('setups', setup);
  app.selectedFeatureId = f.id;
  app.refreshView();
  app.renderPanel();
}

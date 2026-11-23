// 元件库页面:夹具元件参数化、刀具库、工件定义与 STL 导入
import * as THREE from 'three';
import { store } from '../services/store';
import { clear, field, fmt, h, numInput, textInput, toast } from '../ui/dom';
import { makePumpHousingDef, makeValveBodyDef } from '../data/seed';
import { putBlob } from '../core/db';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import type { App } from '../app';
import type { ComponentType, FixtureComponentDef, ToolDef, WorkpieceDef } from '../types';
import { uid } from '../types';

const TYPE_LABEL: Record<ComponentType, string> = {
  column: '塔柱',
  locatingPin: '定位销',
  clamp: '压板',
  supportPin: '支承钉',
  hydraulicCylinder: '液压缸',
};

export function renderLibraryPage(panel: HTMLElement, app: App): void {
  clear(panel);
  const tabs = h('div', { class: 'tabs' });
  const bodies = h('div', {});
  const tabDefs = [
    ['fixture', '夹具元件'],
    ['tool', '刀具库'],
    ['workpiece', '工件定义 / STL'],
  ] as const;
  let active = (panel.dataset.tab as (typeof tabDefs)[number][0]) ?? 'fixture';

  const draw = () => {
    panel.dataset.tab = active;
    tabs.replaceChildren(
      ...tabDefs.map(([key, label]) =>
        h('button', { class: `tab ${active === key ? 'on' : ''}`, onclick: () => { active = key; draw(); } }, label),
      ),
    );
    clear(bodies);
    if (active === 'fixture') bodies.append(fixtureTab(app));
    if (active === 'tool') bodies.append(toolTab(app));
    if (active === 'workpiece') bodies.append(workpieceTab(app));
  };
  panel.append(tabs, bodies);
  draw();
}

function fixtureTab(app: App): HTMLElement {
  const wrap = h('div', { class: 'page-body' });
  wrap.append(
    h('div', { class: 'row between' },
      h('h3', { text: '夹具元件库(尺寸参数化,T 型槽/网格孔位吸附)' }),
      h('button', {
        class: 'btn btn-primary',
        onclick: () => addComponent(app),
      }, '+ 新建元件'),
    ),
  );
  const grid = h('div', { class: 'card-grid' });
  for (const def of store.state.components) grid.append(componentCard(def, app));
  wrap.append(grid);
  return wrap;
}

function componentCard(def: FixtureComponentDef, app: App): HTMLElement {
  const params = h('div', { class: 'param-grid' });
  for (const [k, v] of Object.entries(def.params)) {
    params.append(field(k, numInput(v, 0.5, async (nv) => {
      def.params[k] = nv;
      await store.upsert('components', def);
      app.refreshView();
    })));
  }
  return h('div', { class: 'card' },
    h('div', { class: 'card-head' },
      h('span', { class: 'tag' }, TYPE_LABEL[def.type]),
      textInput(def.name, async (v) => { def.name = v; await store.upsert('components', def); }),
    ),
    h('div', { class: 'muted small' }, `吸附:${def.snapMode === 'tSlot' ? 'T 型槽' : '网格孔位'} · 节距 ${def.snapPitch}mm`),
    params,
    h('div', { class: 'row gap' },
      field('吸附节距', numInput(def.snapPitch, 5, async (nv) => { def.snapPitch = nv; await store.upsert('components', def); })),
      def.type === 'column'
        ? h('span', {})
        : h('button', { class: 'btn btn-danger btn-sm', onclick: async () => { await store.remove('components', def.id); toast('已删除'); } }, '删除'),
    ),
  );
}

async function addComponent(app: App): Promise<void> {
  const type = prompt('元件类型:column / locatingPin / clamp / supportPin / hydraulicCylinder', 'clamp') as ComponentType | null;
  if (!type) return;
  const def: FixtureComponentDef = {
    id: uid('cmp'),
    type,
    name: `自定义${TYPE_LABEL[type] ?? type}`,
    snapMode: type === 'clamp' ? 'tSlot' : 'grid',
    snapPitch: 50,
    params: defaultParams(type),
  };
  await store.upsert('components', def);
  app.refreshView();
}

function defaultParams(type: ComponentType): Record<string, number> {
  switch (type) {
    case 'column': return { size: 320, height: 600, gridPitch: 50, holeDiameter: 12 };
    case 'locatingPin': return { diameter: 16, height: 20, baseDiameter: 28, baseHeight: 8 };
    case 'clamp': return { width: 24, thickness: 16, armLength: 120, boltDiameter: 12, standoffHeight: 40 };
    case 'supportPin': return { diameter: 12, height: 16, baseDiameter: 24 };
    case 'hydraulicCylinder': return { bodyDiameter: 50, bodyHeight: 80, rodDiameter: 16, rodStroke: 30, jawWidth: 28, armLength: 90 };
  }
}

function toolTab(app: App): HTMLElement {
  const wrap = h('div', { class: 'page-body' });
  wrap.append(
    h('div', { class: 'row between' }, h('h3', { text: '刀具库(含刀柄回转尺寸,用于包络干涉判定)' }),
      h('button', { class: 'btn btn-primary', onclick: () => addTool(app) }, '+ 新刀具')),
    h('table', { class: 'tbl' },
      h('thead', {}, h('tr', {}, ...['刀号', '名称', '直径', '刃长', '刀柄直径', '刀柄长', '操作'].map((t) => h('th', { text: t })))),
      h('tbody', {}, ...store.state.tools.map((t) => toolRow(t, app))),
    ),
  );
  return wrap;
}

function toolRow(t: ToolDef, app: App): HTMLElement {
  const cell = (v: number, key: keyof ToolDef) => numInput(v, 0.5, async (nv) => { (t[key] as number) = nv; await store.upsert('tools', t); });
  return h('tr', {},
    h('td', {}, textInput(t.toolNumber, async (v) => { t.toolNumber = v; await store.upsert('tools', t); })),
    h('td', {}, textInput(t.name, async (v) => { t.name = v; await store.upsert('tools', t); })),
    h('td', {}, cell(t.diameter, 'diameter')),
    h('td', {}, cell(t.fluteLength, 'fluteLength')),
    h('td', {}, cell(t.holderDiameter, 'holderDiameter')),
    h('td', {}, cell(t.holderLength, 'holderLength')),
    h('td', {}, h('button', { class: 'btn btn-danger btn-sm', onclick: async () => store.remove('tools', t.id) }, '删')),
  );
}

async function addTool(app: App): Promise<void> {
  const t: ToolDef = {
    id: uid('tol'), name: '新刀具', toolNumber: `T${String(store.state.tools.length + 1).padStart(2, '0')}`,
    diameter: 10, fluteLength: 50, holderDiameter: 25, holderLength: 40,
  };
  await store.upsert('tools', t);
  app.renderPanel();
}

function workpieceTab(app: App): HTMLElement {
  const wrap = h('div', { class: 'page-body' });
  wrap.append(
    h('div', { class: 'row gap' },
      h('button', { class: 'btn btn-primary', onclick: async () => { await store.upsert('workpieces', makeValveBodyDef()); toast('已生成参数化阀体'); } }, '生成参数化阀体'),
      h('button', { class: 'btn btn-primary', onclick: async () => { await store.upsert('workpieces', makePumpHousingDef()); toast('已生成参数化泵壳'); } }, '生成参数化泵壳'),
      stlButton(),
    ),
    h('h3', { text: `工件定义(${store.state.workpieces.length})` }),
    h('div', { class: 'card-grid' }, ...store.state.workpieces.map((d) => wpCard(d, app))),
  );
  return wrap;
}

function stlButton(): HTMLElement {
  const inp = h('input', { type: 'file', accept: '.stl', style: 'display:none' }) as HTMLInputElement;
  inp.addEventListener('change', async () => {
    const file = inp.files?.[0];
    if (!file) return;
    try {
      const buf = await file.arrayBuffer();
      const geo = new STLLoader().parse(buf);
      geo.computeBoundingBox();
      const bb = geo.boundingBox!;
      const size = bb.getSize(new THREE.Vector3());
      const key = uid('stl');
      await putBlob(key, buf);
      const def: WorkpieceDef = {
        id: uid('wkp'), name: file.name.replace(/\.stl$/i, ''), kind: 'stl',
        envelope: { size: [size.x, size.y, size.z] },
        params: { triangles: geo.attributes.position.count / 3 },
        locatingFaces: { primary: [0, -1, 0], secondary: [0, 0, -1], tertiary: [-1, 0, 0] },
        stlBlobKey: key, stlTriangleCount: geo.attributes.position.count / 3,
      };
      await store.upsert('workpieces', def);
      toast(`STL 导入成功:${def.stlTriangleCount} 三角面,包络 ${fmt(size.x)}×${fmt(size.y)}×${fmt(size.z)}mm`);
    } catch (e) {
      toast(`STL 解析失败:${(e as Error).message}`, 'error');
    }
  });
  return h('label', { class: 'btn btn-ghost' }, '导入 STL…', inp);
}

function wpCard(d: WorkpieceDef, app: App): HTMLElement {
  const [sx, sy, sz] = d.envelope.size;
  const params = h('div', { class: 'param-grid' });
  if (d.kind !== 'stl') {
    for (const [k, v] of Object.entries(d.params)) {
      params.append(field(k, numInput(v, 1, async (nv) => {
        d.params[k] = nv;
        await store.upsert('workpieces', d);
        app.refreshView();
      })));
    }
  }
  return h('div', { class: 'card' },
    h('div', { class: 'card-head' }, h('span', { class: 'tag tag-blue' }, d.kind === 'stl' ? 'STL' : d.kind === 'pumpHousing' ? '泵壳' : '阀体'),
      textInput(d.name, async (v) => { d.name = v; await store.upsert('workpieces', d); })),
    h('div', { class: 'muted small' }, `包络 ${fmt(sx)}×${fmt(sy)}×${fmt(sz)}mm${d.stlTriangleCount ? ` · ${d.stlTriangleCount} 三角面` : ''}`),
    d.kind !== 'stl' ? params : h('div', { class: 'muted small' }, 'STL 几何不可参数化,仅支持整体替换'),
    h('button', { class: 'btn btn-danger btn-sm', onclick: async () => store.remove('workpieces', d.id) }, '删除'),
  );
}

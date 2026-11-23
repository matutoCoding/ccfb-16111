// 装夹布置页面:新建方案、元件/工件吸附布置、微调、3-2-1 校验、增量重算联动
import { store } from '../services/store';
import { clear, field, h, numInput, toast } from '../ui/dom';
import { validate321 } from '../core/layout';
import type { App } from '../app';
import type { ComponentInstance, FixtureComponentDef, FixtureSetup, WorkpieceInstance } from '../types';
import { uid } from '../types';

const FACE_NAMES = ['F0(前)', 'F1(右)', 'F2(后)', 'F3(左)'];

async function createSetup(app: App): Promise<void> {
  const column = store.state.components.find((c) => c.type === 'column');
  if (!column) { toast('元件库中缺少塔柱定义', 'error'); return; }
  const setup: FixtureSetup = {
    id: uid('set'),
    name: `装夹方案 ${store.state.setups.length + 1}`,
    columnDefId: column.id,
    columnSize: column.params.size ?? 320,
    columnHeight: column.params.height ?? 600,
    tableHeight: 100,
    components: [],
    workpieces: [],
    featureIds: [],
    angleStep: 5,
  };
  await store.upsert('setups', setup);
  await store.setCurrentSetup(setup.id);
  app.refreshView();
  toast('新装夹已创建,从下方吸附元件/工件开始布置');
}

export function renderSetupPage(panel: HTMLElement, app: App): void {
  clear(panel);
  const setup = store.currentSetup;
  const wrap = h('div', { class: 'page-body' });

  const deleteBtn = setup
    ? h('button', {
        class: 'btn btn-ghost btn-sm',
        onclick: async () => {
          if (confirm(`删除装夹「${setup.name}」?`)) {
            await store.remove('setups', setup.id);
            await store.setCurrentSetup(store.state.setups[0]?.id ?? null);
          }
        },
      }, '删除当前')
    : h('span', {});
  wrap.append(h('div', { class: 'row between' }, h('h3', { text: '装夹布置' }),
    h('div', { class: 'row gap' }, h('button', { class: 'btn btn-primary', onclick: () => createSetup(app) }, '+ 新建装夹'), deleteBtn)));

  if (!setup) {
    panel.append(wrap);
    return;
  }

  wrap.append(setupMeta(setup, app));
  wrap.append(addBars(setup, app));
  wrap.append(locationSection(setup, app));
  wrap.append(instanceLists(setup, app));
  panel.append(wrap);
}

function setupMeta(setup: FixtureSetup, app: App): HTMLElement {
  const update = async (patch: Partial<FixtureSetup>) => {
    Object.assign(setup, patch);
    await store.upsert('setups', setup);
    app.refreshView();
  };
  return h('div', { class: 'card' },
    h('div', { class: 'card-head' }, h('strong', { text: '塔柱与转台' })),
    h('div', { class: 'param-grid' },
      field('塔柱边长 mm', numInput(setup.columnSize, 10, (v) => update({ columnSize: v }))),
      field('塔柱高度 mm', numInput(setup.columnHeight, 10, (v) => update({ columnHeight: v }))),
      field('转台高度 mm', numInput(setup.tableHeight, 10, (v) => update({ tableHeight: v }))),
      field('B 角步进 °', numInput(setup.angleStep, 1, (v) => update({ angleStep: Math.max(1, v) }))),
    ),
  );
}

function addBars(setup: FixtureSetup, app: App): HTMLElement {
  const compSel = h('select', { class: 'inp' }) as HTMLSelectElement;
  for (const d of store.state.components.filter((d) => d.type !== 'column')) compSel.append(h('option', { value: d.id, text: d.name }));
  const wpSel = h('select', { class: 'inp' }) as HTMLSelectElement;
  for (const d of store.state.workpieces) wpSel.append(h('option', { value: d.id, text: d.name }));
  const faceSel = h('select', { class: 'inp' }, ...FACE_NAMES.map((n, i) => h('option', { value: i, text: n }))) as HTMLSelectElement;
  const uInp = numInput(0, 1, () => {});
  const vInp = numInput(0, 1, () => {});

  return h('div', { class: 'card' },
    h('div', { class: 'card-head' }, h('strong', { text: '吸附布置(T 型槽 / 网格孔位,节距见元件库)' })),
    h('div', { class: 'param-grid' },
      h('label', { class: 'field' }, h('span', { class: 'field-label', text: '塔面' }), faceSel),
      h('label', { class: 'field' }, h('span', { class: 'field-label', text: '槽位 U(节距倍数)' }), uInp),
      h('label', { class: 'field' }, h('span', { class: 'field-label', text: '槽位 V' }), vInp),
    ),
    h('div', { class: 'row gap' },
      h('button', { class: 'btn btn-primary btn-sm', onclick: async () => {
        const inst: ComponentInstance = {
          id: uid('cmi'), defId: compSel.value, faceIndex: Number(faceSel.value),
          slotU: Number(uInp.value), slotV: Number(vInp.value), offset: [0, 0, 0], rotation: 0,
        };
        setup.components.push(inst);
        await store.upsert('setups', setup);
        app.refreshView();
      } }, '吸附装元件'),
      h('button', { class: 'btn btn-primary btn-sm', onclick: async () => {
        if (!wpSel.options.length) { toast('请先在元件库生成或导入工件', 'warn'); return; }
        const inst: WorkpieceInstance = {
          id: uid('wpi'), defId: wpSel.value, faceIndex: Number(faceSel.value),
          slotU: Number(uInp.value), slotV: Number(vInp.value), offset: [0, 0, 0], rotation: 0,
        };
        setup.workpieces.push(inst);
        setup.featureIds = [...new Set([...setup.featureIds, ...store.state.features.filter((f) => f.workpieceId === inst.id).map((f) => f.id)])];
        await store.upsert('setups', setup);
        app.refreshView();
      } }, '吸附装工件(定位面自动贴合)'),
    ),
    h('div', { class: 'muted small' }, '提示:在三维视图中点击元件可在下方微调;移动压板后当前 B 角自动增量重算。'),
  );
}

function locationSection(setup: FixtureSetup, app: App): HTMLElement {
  const checks = validate321(setup, store.state.components, store.state.workpieces);
  const box = h('div', { class: 'card' }, h('div', { class: 'card-head' }, h('strong', { text: '3-2-1 定位校验' })));
  if (checks.length === 0) box.append(h('div', { class: 'muted' }, '尚无工件'));
  for (const [i, c] of checks.entries()) {
    const wp = setup.workpieces[i];
    const def = store.state.workpieces.find((d) => d.id === wp?.defId);
    box.append(h('div', { class: `loc-block ${c.ok ? '' : 'loc-fail'}` },
      h('div', { class: 'row between' }, h('strong', { text: def?.name ?? '工件' }), h('span', { class: `tag ${c.ok ? 'tag-ok' : 'tag-fail'}` }, c.ok ? '定位完整' : '定位不足')),
      ...c.messages.map((m) => h('div', { class: `loc-msg loc-${m.level}` }, `${m.level === 'ok' ? '✓' : m.level === 'warn' ? '△' : '✗'} ${m.text}`)),
    ));
  }
  return box;
}

function instanceLists(setup: FixtureSetup, app: App): HTMLElement {
  const box = h('div', { class: 'card' }, h('div', { class: 'card-head' }, h('strong', { text: '实例列表与微调(点击视图中的元件也可选中)' })));
  const compDefMap = new Map(store.state.components.map((d) => [d.id, d]));
  const wpDefMap = new Map(store.state.workpieces.map((d) => [d.id, d]));

  const rows: HTMLElement[] = [];
  setup.components.forEach((inst) => {
    const def = compDefMap.get(inst.defId);
    if (!def) return;
    rows.push(instanceRow(inst.id, `${TYPE(def.type)} · ${def.name}`, FACE_NAMES[inst.faceIndex], inst, setup, app, false));
  });
  setup.workpieces.forEach((inst) => {
    const def = wpDefMap.get(inst.defId);
    rows.push(instanceRow(inst.id, `工件 · ${def?.name ?? ''}`, FACE_NAMES[inst.faceIndex], inst, setup, app, true));
  });
  box.append(h('div', { class: 'instance-list' }, ...rows));
  return box;
}

function TYPE(t: FixtureComponentDef['type']): string {
  return { column: '塔柱', locatingPin: '定位销', clamp: '压板', supportPin: '支承钉', hydraulicCylinder: '液压缸' }[t];
}

function instanceRow(
  id: string,
  title: string,
  face: string,
  inst: ComponentInstance | WorkpieceInstance,
  setup: FixtureSetup,
  app: App,
  isWorkpiece: boolean,
): HTMLElement {
  const selected = app.selectedInstanceId === id;
  const persist = async (triggerRecompute: boolean) => {
    await store.upsert('setups', setup);
    app.refreshView();
    if (triggerRecompute && !isWorkpiece) await app.invalidateComponent(id);
  };
  const detail = h('div', { class: `inst-detail ${selected ? '' : 'hidden'}` });
  detail.append(
    h('div', { class: 'param-grid' },
      field('槽位 U', numInput(inst.slotU, 1, (v) => { inst.slotU = v; persist(true); })),
      field('槽位 V', numInput(inst.slotV, 1, (v) => { inst.slotV = v; persist(true); })),
      field('微调 X(mm)', numInput(inst.offset[0], 0.5, (v) => { inst.offset[0] = v; persist(true); })),
      field('微调 Y(mm)', numInput(inst.offset[1], 0.5, (v) => { inst.offset[1] = v; persist(true); })),
      field('微调 Z/法向(mm)', numInput(inst.offset[2], 0.5, (v) => { inst.offset[2] = v; persist(true); })),
      field('绕法线旋转 °', numInput(inst.rotation, 5, (v) => { inst.rotation = v; persist(true); })),
    ),
  );
  return h('div', { class: `inst-row ${selected ? 'sel' : ''}`, onclick: () => { app.selectedInstanceId = id; app.view.highlightInstance(id); app.renderPanel(); } },
    h('div', { class: 'row between' },
      h('div', {}, h('strong', { text: title }), h('span', { class: 'muted small' }, ` ${face} · U=${inst.slotU} V=${inst.slotV}`)),
      h('button', {
        class: 'btn btn-danger btn-sm',
        onclick: async (e: Event) => {
          e.stopPropagation();
          if (isWorkpiece) {
            setup.workpieces = setup.workpieces.filter((w) => w.id !== id);
            setup.featureIds = setup.featureIds.filter((fid) => !store.state.features.some((f) => f.id === fid && f.workpieceId === id));
          } else {
            setup.components = setup.components.filter((c) => c.id !== id);
          }
          await store.upsert('setups', setup);
          app.refreshView();
          if (!isWorkpiece) await app.invalidateComponent(id);
        },
      }, '移除'),
    ),
    detail,
  );
}

// 应用主控制器:页面路由、共享三维视图、B 角联动、增量重算调度
import * as THREE from 'three';
import { store } from './services/store';
import { View3D, ViewPick } from './ui/view3d';
import { clear, h, toast } from './ui/dom';
import { renderLibraryPage } from './pages/libraryPage';
import { renderSetupPage } from './pages/setupPage';
import { renderFeaturesPage } from './pages/featuresPage';
import { renderReachPage } from './pages/reachPage';
import { renderCardPage } from './pages/cardPage';
import { computeAngle, findAffectedFeatures, fullScan, patchMatrix } from './services/reachService';
import { resolveFeatureWorld } from './services/demo';
import { SEED_COMPONENTS, SEED_TOOLS } from './data/seed';
import type { PageName } from './pages/types';
import type { MachiningFeature, ReachCell } from './types';

export class App {
  view!: View3D;
  page: PageName = 'library';
  angle = 0;
  scanning = false;
  selectedInstanceId: string | null = null;
  selectedFeatureId: string | null = null;
  private recomputing = false;
  private dirtySetupId: string | null = null;
  private panel: HTMLElement;

  constructor() {
    this.panel = document.getElementById('page-panel')!;
  }

  async start(): Promise<void> {
    await store.load();
    if (store.state.components.length === 0) {
      await store.save('components', SEED_COMPONENTS);
      await store.save('tools', SEED_TOOLS);
    }
    this.view = new View3D(document.getElementById('viewport')!);
    this.view.onPick((p) => this.handlePick(p));
    this.bindChrome();
    store.subscribe(() => this.onStoreChange());
    this.route('library');
    this.refreshView();
  }

  private bindChrome(): void {
    document.querySelectorAll<HTMLElement>('.nav-item').forEach((a) => {
      a.addEventListener('click', () => this.route(a.dataset.page as PageName));
    });
    const slider = document.getElementById('angle-slider') as HTMLInputElement;
    slider.addEventListener('input', () => this.setAngle(Number(slider.value)));
    document.getElementById('shadow-toggle')!.addEventListener('change', (e) => {
      this.view.setShadow((e.target as HTMLInputElement).checked);
    });
    document.getElementById('envelope-toggle')!.addEventListener('change', (e) => {
      if (!(e.target as HTMLInputElement).checked) this.view.clearEnvelope();
      else this.showSelectedEnvelope();
    });
    document.getElementById('btn-demo')!.addEventListener('click', () => this.runDemo());
    document.getElementById('btn-reset')!.addEventListener('click', async () => {
      if (!confirm('确认清空 IndexedDB 中的全部夹具/工件/刀具/工艺卡数据?')) return;
      await store.wipeAll();
      await store.save('components', SEED_COMPONENTS);
      await store.save('tools', SEED_TOOLS);
      toast('已清空并恢复默认元件库与刀具库');
      this.refreshView();
    });
    const sel = document.getElementById('setup-select') as HTMLSelectElement;
    sel.addEventListener('change', () => store.setCurrentSetup(sel.value || null));
  }

  route(page: PageName): void {
    this.page = page;
    document.querySelectorAll('.nav-item').forEach((a) => a.classList.toggle('active', (a as HTMLElement).dataset.page === page));
    this.renderPanel();
  }

  renderPanel(): void {
    const setup = store.currentSetup;
    switch (this.page) {
      case 'library':
        renderLibraryPage(this.panel, this);
        break;
      case 'setup':
        renderSetupPage(this.panel, this);
        break;
      case 'features':
        renderFeaturesPage(this.panel, this);
        break;
      case 'reach':
        renderReachPage(this.panel, this);
        break;
      case 'card':
        renderCardPage(this.panel, this);
        break;
    }
    if (!setup) this.panel.prepend(h('div', { class: 'empty-hint' }, '当前没有装夹方案,请先到「装夹布置」新建,或点击左下「生成演示夹具」。'));
  }

  /** 装夹数据变更后的统一刷新入口 */
  onStoreChange(): void {
    this.syncSetupSelect();
    this.refreshView();
    this.renderPanel();
  }

  syncSetupSelect(): void {
    const sel = document.getElementById('setup-select') as HTMLSelectElement;
    const cur = store.currentSetup?.id ?? '';
    if (sel.dataset.busy === '1') return;
    sel.dataset.busy = '1';
    clear(sel);
    for (const s of store.state.setups) sel.append(h('option', { value: s.id, text: s.name, selected: s.id === cur }));
    sel.dataset.busy = '0';
  }

  refreshView(): void {
    const setup = store.currentSetup;
    if (!setup) {
      this.view.rebuild(
        { id: '__empty__', name: '', columnDefId: '', columnSize: 1, columnHeight: 1, tableHeight: 100, components: [], workpieces: [], featureIds: [], angleStep: 5 },
        store.state.components,
        store.state.workpieces,
        [],
      );
      return;
    }
    const status = this.featureStatusMap(setup.id);
    this.view.rebuild(setup, store.state.components, store.state.workpieces, store.state.features, status);
    this.view.setBAngle(this.angle);
    this.updateAlarmBanner();
  }

  featureStatusMap(setupId: string): Map<string, 'reachable' | 'blocked' | 'unknown'> {
    const m = store.state.matrices.find((x) => x.setupId === setupId);
    const map = new Map<string, 'reachable' | 'blocked' | 'unknown'>();
    if (!m) return map;
    for (const c of m.cells) {
      if (c.angle !== this.angle) continue;
      map.set(c.featureId, c.reachable ? 'reachable' : 'blocked');
    }
    return map;
  }

  setAngle(deg: number): void {
    this.angle = deg;
    (document.getElementById('angle-value')!).textContent = `${deg}°`;
    const slider = document.getElementById('angle-slider') as HTMLInputElement;
    if (Number(slider.value) !== deg) slider.value = String(deg);
    this.view.setBAngle(deg);
    this.view.setFeatureStatus(this.featureStatusMap(store.currentSetup?.id ?? ''));
    this.updateAlarmBanner();
    if (this.page === 'reach' || this.page === 'features') this.renderPanel();
    if ((document.getElementById('envelope-toggle') as HTMLInputElement).checked) this.showSelectedEnvelope();
  }

  async runDemo(): Promise<void> {
    const { generateDemoSetup } = await import('./services/demo');
    const setup = await generateDemoSetup();
    this.angle = 0;
    this.setAngle(0);
    toast('演示夹具已生成:12 个阀体、两块挡孔压板,开始全量扫描…', 'warn');
    await this.runFullScan(setup.id);
  }

  async runFullScan(setupId?: string): Promise<void> {
    const setup = store.state.setups.find((s) => s.id === (setupId ?? store.currentSetup?.id));
    if (!setup) return;
    this.scanning = true;
    const perf = document.getElementById('perf')!;
    const t0 = performance.now();
    try {
      await fullScan(setup, (p) => {
        perf.textContent = `扫描中 ${p.angleIndex}/${p.angleCount} · B=${p.currentAngle}°`;
      });
      const ms = performance.now() - t0;
      perf.textContent = `扫描完成 ${ms.toFixed(0)}ms · 单角均值 ${(ms / 72).toFixed(1)}ms`;
      const blocked = this.countBlocked(setup.id);
      toast(blocked > 0 ? `扫描完成:发现 ${blocked} 个不可达特征/角度组合,红色标记` : '扫描完成:全部可达', blocked > 0 ? 'warn' : 'info');
    } catch (e) {
      toast(`扫描失败:${(e as Error).message}`, 'error');
    } finally {
      this.scanning = false;
      this.refreshView();
      this.renderPanel();
    }
  }

  private countBlocked(setupId: string): number {
    const m = store.state.matrices.find((x) => x.setupId === setupId);
    if (!m) return 0;
    const ids = new Set(store.currentSetup?.featureIds ?? []);
    return new Set(m.cells.filter((c) => !c.reachable && ids.has(c.featureId)).map((c) => c.featureId)).size;
  }

  /** 元件移动后的增量重算:当前角立即重算(<100ms 目标),其余角度后台补扫 */
  async invalidateComponent(instanceId: string): Promise<void> {
    const setup = store.currentSetup;
    if (!setup || this.recomputing) {
      this.dirtySetupId = setup?.id ?? null;
      return;
    }
    this.recomputing = true;
    const perf = document.getElementById('perf')!;
    try {
      const affected = findAffectedFeatures(setup, instanceId, store.state.components, store.state.workpieces);
      const t0 = performance.now();
      const cells = computeAngle(setup, this.angle, { affectedFeatureIds: affected });
      await patchMatrix(setup, this.angle, cells);
      const ms = performance.now() - t0;
      perf.textContent = `增量重算 ${cells.length} 特征 · ${ms.toFixed(1)}ms`;
      const blocked = cells.filter((c) => c.blockerId === instanceId);
      if (blocked.length) {
        toast(`该压板/元件挡住了 ${new Set(blocked.map((c) => c.featureId)).size} 个特征`, 'warn');
      }
      this.refreshView();
      this.renderPanel();
      this.scheduleBackgroundRescan(setup.id);
    } finally {
      this.recomputing = false;
      if (this.dirtySetupId) {
        const id = this.dirtySetupId;
        this.dirtySetupId = null;
        if (id === setup.id) this.invalidateComponent(instanceId);
      }
    }
  }

  private rescanTimer: ReturnType<typeof setTimeout> | null = null;
  private scheduleBackgroundRescan(setupId: string): void {
    if (this.rescanTimer) clearTimeout(this.rescanTimer);
    this.rescanTimer = setTimeout(() => {
      const setup = store.state.setups.find((s) => s.id === setupId);
      if (setup && !this.scanning) this.runFullScan(setupId);
    }, 1500);
  }

  handlePick(p: ViewPick): void {
    if (p.kind === 'feature' && p.featureId) {
      this.selectedFeatureId = p.featureId;
      this.selectedInstanceId = null;
      this.view.highlightInstance(null);
      if (this.page !== 'features' && this.page !== 'reach') this.route('reach');
      else this.renderPanel();
      this.showSelectedEnvelope();
      return;
    }
    this.selectedInstanceId = p.instanceId || null;
    this.selectedFeatureId = null;
    this.view.highlightInstance(this.selectedInstanceId);
    if (this.page === 'setup' || this.page === 'reach') this.renderPanel();
  }

  showSelectedEnvelope(): void {
    const setup = store.currentSetup;
    const f = store.state.features.find((x) => x.id === this.selectedFeatureId);
    if (!setup || !f) return;
    const world = resolveFeatureWorld(setup, store.state.components, store.state.workpieces, store.state.features);
    const w = world.get(f.id);
    if (!w) return;
    const rot = new THREE.Matrix4().makeRotationY(THREE.MathUtils.degToRad(this.angle));
    const pos = w.position.clone().applyMatrix4(rot);
    const dir = w.direction.clone().transformDirection(rot).normalize();
    const tool = store.state.tools.find((t) => f.toolIds.includes(t.id));
    this.view.showEnvelope(f, tool, pos, dir);
  }

  cellsAtCurrentAngle(): ReachCell[] {
    const m = store.currentMatrix;
    if (!m) return [];
    return m.cells.filter((c) => c.angle === this.angle);
  }

  featureById(id: string): MachiningFeature | undefined {
    return store.state.features.find((f) => f.id === id);
  }

  private updateAlarmBanner(): void {
    const banner = document.getElementById('alarm-banner')!;
    const cells = this.cellsAtCurrentAngle();
    const blocked = cells.filter((c) => !c.reachable);
    if (blocked.length === 0) {
      banner.classList.add('hidden');
      banner.textContent = '';
      return;
    }
    banner.classList.remove('hidden');
    const names = blocked.slice(0, 3).map((c) => this.featureById(c.featureId)?.name ?? c.featureId).join('、');
    banner.textContent = `⚠ B=${this.angle}° 有 ${blocked.length} 个特征不可达:${names}${blocked.length > 3 ? ' 等' : ''}`;
  }
}

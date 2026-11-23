// 全局状态仓库:IndexedDB 持久化 + 订阅通知
import * as db from '../core/db';
import type {
  DBSchema,
  FixtureComponentDef,
  FixtureSetup,
  MachiningFeature,
  ProcessCard,
  ReachMatrix,
  StoreName,
  ToolDef,
  WorkpieceDef,
} from '../types';

type Listener = () => void;

interface State {
  components: FixtureComponentDef[];
  tools: ToolDef[];
  workpieces: WorkpieceDef[];
  features: MachiningFeature[];
  setups: FixtureSetup[];
  matrices: ReachMatrix[];
  cards: ProcessCard[];
  currentSetupId: string | null;
  loaded: boolean;
}

class Store {
  state: State = {
    components: [],
    tools: [],
    workpieces: [],
    features: [],
    setups: [],
    matrices: [],
    cards: [],
    currentSetupId: null,
    loaded: false,
  };
  private listeners = new Set<Listener>();

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  private emit(): void {
    for (const fn of this.listeners) fn();
  }

  async load(): Promise<void> {
    const [components, tools, workpieces, features, setups, matrices, cards] = await Promise.all([
      db.getAll('components'),
      db.getAll('tools'),
      db.getAll('workpieces'),
      db.getAll('features'),
      db.getAll('setups'),
      db.getAll('matrices'),
      db.getAll('cards'),
    ]);
    this.state.components = components;
    this.state.tools = tools;
    this.state.workpieces = workpieces;
    this.state.features = features;
    this.state.setups = setups;
    this.state.matrices = matrices;
    this.state.cards = cards;
    this.state.currentSetupId = (await db.getMeta<string>('currentSetupId')) ?? setups[0]?.id ?? null;
    this.state.loaded = true;
    this.emit();
  }

  async save<K extends StoreName>(storeName: K, rows: DBSchema[K]): Promise<void> {
    await db.putAll(storeName, rows as never);
    (this.state as unknown as Record<string, unknown>)[storeName] = rows as unknown;
    this.emit();
  }

  async upsert<K extends StoreName>(store: K, row: unknown): Promise<void> {
    await db.putOne(store, row);
    await this.refresh(store);
  }

  async remove(store: StoreName, id: string): Promise<void> {
    await db.deleteOne(store, id);
    await this.refresh(store);
  }

  private async refresh(storeName: StoreName): Promise<void> {
    const rows = await db.getAll(storeName);
    (this.state as unknown as Record<string, unknown>)[storeName] = rows;
    this.emit();
  }

  async setCurrentSetup(id: string | null): Promise<void> {
    this.state.currentSetupId = id;
    await db.setMeta('currentSetupId', id);
    this.emit();
  }

  get currentSetup(): FixtureSetup | null {
    return this.state.setups.find((s) => s.id === this.state.currentSetupId) ?? this.state.setups[0] ?? null;
  }

  get currentMatrix(): ReachMatrix | null {
    const s = this.currentSetup;
    if (!s) return null;
    return this.state.matrices.find((m) => m.setupId === s.id) ?? null;
  }

  /** 矩阵版本自增并落库 */
  async putMatrix(matrix: ReachMatrix): Promise<void> {
    const idx = this.state.matrices.findIndex((m) => m.setupId === matrix.setupId);
    if (idx >= 0) this.state.matrices[idx] = matrix;
    else this.state.matrices.push(matrix);
    await db.putAll('matrices', this.state.matrices);
    this.emit();
  }

  async wipeAll(): Promise<void> {
    await db.clearAll();
    await this.load();
  }
}

export const store = new Store();

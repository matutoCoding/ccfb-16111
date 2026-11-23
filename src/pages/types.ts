import type { App } from '../app';

export type PageName = 'library' | 'setup' | 'features' | 'reach' | 'card';
export type PageRenderer = (panel: HTMLElement, app: App) => void;

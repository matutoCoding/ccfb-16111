// DOM 构建与通用 UI 工具
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number | boolean | EventListener | undefined> = {},
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === false) continue;
    if (k === 'class') el.className = String(v);
    else if (k === 'text') el.textContent = String(v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
    else if (k === 'value') (el as HTMLInputElement).value = String(v);
    else el.setAttribute(k, String(v));
  }
  for (const c of children) el.append(typeof c === 'string' ? document.createTextNode(c) : c);
  return el;
}

export function clear(el: HTMLElement): void {
  el.replaceChildren();
}

export function toast(msg: string, kind: 'info' | 'warn' | 'error' = 'info'): void {
  const layer = document.getElementById('toast-layer')!;
  const t = h('div', { class: `toast toast-${kind}` }, msg);
  layer.append(t);
  setTimeout(() => {
    t.classList.add('fade');
    setTimeout(() => t.remove(), 400);
  }, 3200);
}

export function field(label: string, input: HTMLElement): HTMLElement {
  return h('label', { class: 'field' }, h('span', { class: 'field-label' }, label), input);
}

export function numInput(value: number, step = 1, fn: (v: number) => void): HTMLInputElement {
  const inp = h('input', { type: 'number', class: 'inp inp-num', value, step }) as HTMLInputElement;
  inp.addEventListener('change', () => fn(Number(inp.value)));
  return inp;
}

export function textInput(value: string, fn: (v: string) => void): HTMLInputElement {
  const inp = h('input', { type: 'text', class: 'inp' }) as HTMLInputElement;
  inp.value = value;
  inp.addEventListener('change', () => fn(inp.value));
  return inp;
}

export function badge(text: string, cls = 'badge'): HTMLElement {
  return h('span', { class: cls }, text);
}

export function fmt(n: number, digits = 1): string {
  if (!Number.isFinite(n)) return '∞';
  return n.toFixed(digits);
}

export function download(filename: string, content: string, mime = 'text/plain'): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: filename }) as HTMLAnchorElement;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

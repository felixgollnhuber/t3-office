import { S } from './i18n/board';

export interface BoardItem {
  id: string;
  /** name of the status column; empty for items without a status */
  status: string;
  title: string;
  number?: number;
  url?: string;
  repo?: string;
  state?: string;
  kind: 'issue' | 'pr' | 'draft';
  labels: { name: string; color: string }[];
  assignees: string[];
  updatedAt: string;
}
export interface BoardProject {
  id: string;
  title?: string;
  url?: string;
  columns?: { name: string; color: string }[];
  items?: BoardItem[];
  /** 'not-found', or 'gh' with the gh CLI's own message in errorDetail */
  error?: string;
  errorDetail?: string;
}
export interface BoardData {
  configured: boolean;
  fetchedAt: string;
  projects: BoardProject[];
  demo?: boolean;
}

/** GitHub's named option colors, mapped onto the office palette */
export const COLUMN_COLOR: Record<string, string> = {
  GRAY: '#9a9aa2', BLUE: '#4f8fd8', GREEN: '#4fae6e', YELLOW: '#e8c25a', ORANGE: '#e8894f', RED: '#d9534f', PINK: '#e87fb0', PURPLE: '#9b6fd8',
};

const DEMO: BoardData = {
  configured: false,
  demo: true,
  fetchedAt: new Date().toISOString(),
  projects: [
    {
      id: 'demo/1',
      title: 'T3 Office',
      columns: [{ name: 'Backlog', color: 'GRAY' }, { name: 'Ready', color: 'BLUE' }, { name: 'In progress', color: 'ORANGE' }, { name: 'Done', color: 'GREEN' }],
      items: ['Backlog', 'Backlog', 'Ready', 'Ready', 'In progress', 'Done', 'Done', 'Done'].map((status, i) => ({
        id: `d${i}`, status, title: S.demoNotes[i], number: 40 + i, kind: 'issue' as const, labels: [], assignees: [], updatedAt: '',
      })),
    },
  ],
};

export class BoardSource {
  data: BoardData = DEMO;
  loading = false;
  private listeners: (() => void)[] = [];
  private t = 0;

  constructor(private mode: 'live' | 'demo') {
    void this.refresh();
  }

  onChange(fn: () => void) {
    this.listeners.push(fn);
  }

  async refresh(force = false) {
    // demo mode is for screenshots: the real board is as private as the threads, so it is never fetched
    if (this.mode === 'demo' || this.loading) return;
    this.loading = true;
    this.emit();
    try {
      const res = await fetch(`/api/board${force ? '?refresh=1' : ''}`);
      if (!res.ok) throw new Error(String(res.status));
      const d = (await res.json()) as BoardData;
      this.data = d.configured ? d : DEMO;
    } catch {
      // static build or no dev server: keep what we have
    }
    this.loading = false;
    this.emit();
  }

  update(dt: number) {
    this.t += dt;
    if (this.t > 90) {
      this.t = 0;
      void this.refresh();
    }
  }

  private emit() {
    for (const fn of this.listeners) fn();
  }
}

export function columnsOf(p: BoardProject) {
  const cols = (p.columns ?? []).map((c) => ({ ...c, items: [] as BoardItem[] }));
  for (const it of p.items ?? []) {
    const name = it.status || S.noStatus;
    let col = cols.find((c) => c.name === name);
    if (!col) cols.push((col = { name, color: 'GRAY', items: [] }));
    col.items.push(it);
  }
  return cols;
}

const PAPER = { issue: ['#fff1a8', '#ffe07a', '#ffd0dc', '#d8f2c4'], pr: ['#cfe4ff'], draft: ['#f2efe8'] };

/** The cork board as it hangs on the wall: tiny paper notes per column, no text. */
export function paintPinboard(g: CanvasRenderingContext2D, p: BoardProject | undefined) {
  const { width: w, height: h } = g.canvas;
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  g.fillStyle = '#c9a26b';
  g.fillRect(0, 0, w, h);
  for (let i = 0; i < (w * h) / 6; i++) {
    g.fillStyle = rnd() < 0.5 ? '#b88f58' : '#d8b47c';
    g.fillRect(Math.floor(rnd() * w), Math.floor(rnd() * h), 1, 1);
  }
  // wooden frame
  g.fillStyle = '#6b4a2f';
  g.fillRect(0, 0, w, 2);
  g.fillRect(0, h - 2, w, 2);
  g.fillRect(0, 0, 2, h);
  g.fillRect(w - 2, 0, 2, h);
  g.fillStyle = '#8a6240';
  g.fillRect(1, 1, w - 2, 1);
  if (!p) return;
  const cols = columnsOf(p);
  if (!cols.length) return;
  const x0 = 4, y0 = 4, iw = w - 8, ih = h - 8;
  const cw = Math.floor(iw / cols.length);
  const nw = cw >= 18 ? 7 : 5, nh = 5, perRow = Math.max(1, Math.floor((cw - 1) / (nw + 1)));
  const rows = Math.floor((ih - 5) / (nh + 1));
  cols.forEach((c, ci) => {
    const cx = x0 + ci * cw;
    g.fillStyle = COLUMN_COLOR[c.color] ?? '#9a9aa2';
    g.fillRect(cx + 1, y0, cw - 3, 2);
    if (ci > 0) {
      g.fillStyle = 'rgba(80,50,20,0.25)';
      g.fillRect(cx - 1, y0 + 3, 1, ih - 3);
    }
    const cap = perRow * rows;
    c.items.slice(0, cap).forEach((it, k) => {
      const nx = cx + 1 + (k % perRow) * (nw + 1);
      const ny = y0 + 5 + Math.floor(k / perRow) * (nh + 1) + (k % 3 === 1 ? 1 : 0);
      const pal = PAPER[it.kind];
      const paper = it.labels[0] ? `#${it.labels[0].color}` : pal[(it.number ?? k) % pal.length];
      g.fillStyle = 'rgba(60,35,10,0.35)';
      g.fillRect(nx + 1, ny + 1, nw, nh);
      g.fillStyle = it.state === 'CLOSED' || it.state === 'MERGED' ? '#ece6d6' : it.kind === 'issue' ? PAPER.issue[(it.number ?? k) % 4] : pal[0];
      g.fillRect(nx, ny, nw, nh);
      g.fillStyle = paper;
      g.fillRect(nx, ny + nh - 1, nw, 1);
      g.fillStyle = 'rgba(40,40,60,0.45)';
      g.fillRect(nx + 1, ny + 2, nw - 2 - (k % 2), 1);
      g.fillStyle = ['#d9423b', '#3d6ad8', '#2a8a5a'][k % 3];
      g.fillRect(nx + (nw >> 1), ny, 1, 1);
    });
    if (c.items.length > cap) {
      g.fillStyle = '#f6f2ea';
      g.fillRect(cx + 1, y0 + ih - 2, Math.min(cw - 3, 2 + c.items.length - cap), 1);
    }
  });
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const ago = (iso: string) => {
  const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  return s < 60 ? S.agoSeconds(Math.round(s)) : s < 3600 ? S.agoMinutes(Math.round(s / 60)) : s < 86400 ? S.agoHours(Math.round(s / 3600)) : S.agoDays(Math.round(s / 86400));
};
const ink = (hex: string) => {
  const n = parseInt(hex, 16);
  return ((n >> 16) * 299 + ((n >> 8) & 255) * 587 + (n & 255) * 114) / 1000 > 140 ? '#1d1c22' : '#f6f2ea';
};

/** The board up close: real cards, clickable through to GitHub. */
export class PinboardView {
  project = 0;
  private hideDone = false;

  constructor(private src: BoardSource) {}

  get current() {
    return this.src.data.projects[this.project % Math.max(1, this.src.data.projects.length)];
  }

  render(el: HTMLElement) {
    const d = this.src.data;
    const p = this.current;
    const cols = p ? columnsOf(p) : [];
    el.classList.remove('quota-view');
    el.classList.add('pin-view');
    el.innerHTML = `
      <header>
        <span class="kicker">${S.title}</span>
        <nav class="tabs">${d.projects
          .map((q, i) => `<button data-p="${i}" class="${i === this.project ? 'on' : ''}">${esc(q.title ?? q.id)} <b>${q.items?.length ?? '!'}</b></button>`)
          .join('')}</nav>
        <span class="sp"></span>
        <button data-a="done" class="${this.hideDone ? 'on' : ''}">${this.hideDone ? S.showDone : S.hideDone}</button>
        <button data-a="refresh" class="${this.src.loading ? 'busy' : ''}">↻ ${this.src.loading ? S.loading : ago(d.fetchedAt)}</button>
        ${p?.url ? `<a class="btn" href="${p.url}" target="_blank" rel="noopener">GitHub ↗</a>` : ''}
        <button data-a="close" title="${S.back}">✕</button>
      </header>
      ${d.demo ? `<p class="cfg">${S.demoHint}</p>` : ''}
      ${p?.error ? `<p class="cfg err">${esc(p.error === 'not-found' ? S.projectNotFound(p.id) : p.errorDetail || p.error)}</p>` : ''}
      <div class="cols">${cols
        .filter((c) => !(this.hideDone && /^done$/i.test(c.name)))
        .map(
          (c) => `<section style="--col:${COLUMN_COLOR[c.color] ?? '#9a9aa2'}"><h4><i></i>${esc(c.name)}<b>${c.items.length}</b></h4><ol>${c.items
            .map((it, k) => {
              const closed = it.state === 'CLOSED' || it.state === 'MERGED';
              return `<li><a class="note k-${it.kind}${closed ? ' closed' : ''} t${k % 3}" ${it.url ? `href="${it.url}" target="_blank" rel="noopener"` : ''}>
                <span class="pin"></span>
                <span class="ref">${it.kind === 'pr' ? 'PR ' : ''}${it.number ? `#${it.number}` : S.draft}${it.repo ? ` · ${esc(it.repo.split('/')[1])}` : ''}</span>
                <span class="tt">${esc(it.title)}</span>
                ${it.labels.length || it.assignees.length ? `<span class="meta">${it.labels
                  .slice(0, 3)
                  .map((l) => `<em style="background:#${l.color};color:${ink(l.color)}">${esc(l.name.replace(/^(priority|area):/, ''))}</em>`)
                  .join('')}${it.assignees.map((a) => `<u title="${esc(a)}">${esc(a.slice(0, 2).toUpperCase())}</u>`).join('')}</span>` : ''}
              </a></li>`;
            })
            .join('')}</ol></section>`,
        )
        .join('')}</div>`;
  }

  /** returns true when the view asked to close */
  click(el: HTMLElement, t: HTMLElement) {
    const tab = t.closest<HTMLElement>('[data-p]');
    const a = t.closest<HTMLElement>('[data-a]')?.dataset.a;
    if (tab) this.project = Number(tab.dataset.p);
    else if (a === 'close') return true;
    else if (a === 'done') this.hideDone = !this.hideDone;
    else if (a === 'refresh') void this.src.refresh(true);
    else return false;
    this.render(el);
    return false;
  }
}

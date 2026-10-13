import * as THREE from 'three';
import type { Office } from './office';
import { resetIn, type Pool, type UsageGroup, type UsageSource } from './usage';
import { localeTag } from './i18n';
import { S } from './i18n/quota';

const W = 140, H = 59;
const ICON: Record<string, string> = { codex: '◎', claude: '✳', cursor: '◆', gemini: '✦' };

const pct = (v: number) => `${Math.round(v * 100)}%`;
/** pool labels and account names come straight from T3 Code's provider caches */
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const trendIcon = (p: Pool) => (p.trend === 'up' ? '↗' : p.trend === 'down' ? '↘' : p.trend === 'session' ? '◔' : '');

/** The quota board on the boss-office wall: real HTML, mapped onto the 3D wall with an affine transform. */
export class QuotaWall {
  private el: HTMLElement;
  private v = new THREE.Vector3();
  private renderT = 99;
  /** the interactive close-up, while the camera is parked in front of the wall */
  view: HTMLElement | null = null;
  private tab = 'all';
  private expanded = new Set<string>();

  live = S.demo;

  constructor(private office: Office, private usage: UsageSource, onOpen: () => void) {
    const host = document.getElementById('wall')!;
    this.el = document.createElement('div');
    this.el.className = 'quota-wall';
    this.el.style.width = `${W}px`;
    this.el.style.height = `${H}px`;
    host.appendChild(this.el);
    this.el.addEventListener('click', (e) => {
      e.stopPropagation();
      onOpen();
    });
  }

  set hidden(on: boolean) {
    this.el.style.visibility = on ? 'hidden' : '';
  }

  private renderWall(groups: UsageGroup[]) {
    this.el.innerHTML = `
      <header><span>${S.title.toUpperCase()}</span><em>live</em></header>
      <div class="cols">${groups
        .filter((g) => g.pools.length)
        .map((g) => {
          const worst = g.pools.reduce((m, p) => (p.left < m.left ? p : m));
          return `<section class="p-${g.provider}"><h4>${g.label}</h4><div class="big${worst.left < 0.25 ? ' low' : ''}">${pct(worst.left)}</div><div class="sub">${S.poolOnWall(worst.label)}</div>${g.pools
            .map((p) => `<div class="mini${p.left < 0.25 ? ' low' : ''}"><i style="width:${Math.max(4, p.left * 100)}%"></i></div>`)
            .join('')}</section>`;
        })
        .join('')}</div>
      <div class="glass"></div>`;
  }

  renderView(el: HTMLElement) {
    this.view = el;
    const groups = this.usage.groups();
    const cells = (left: number, provider: string) => {
      const n = Math.round(left * 20);
      return `<span class="cells p-${provider}${left < 0.25 ? ' low' : ''}">${Array.from({ length: 20 }, (_, i) => `<i class="${i < n ? 'f' : ''}"></i>`).join('')}</span>`;
    };
    const when = (at: number) => new Date(at).toLocaleString(localeTag, { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
    el.classList.remove('pin-view');
    el.classList.add('quota-view');
    el.innerHTML = `
      <header>
        <span class="kicker">${S.title}</span>
        <nav class="tabs"><button data-t="all" class="${this.tab === 'all' ? 'on' : ''}">${S.all}</button>${groups
          .map((g) => `<button data-t="${g.provider}" class="${this.tab === g.provider ? 'on' : ''}">${ICON[g.provider] ?? ''} ${g.label}</button>`)
          .join('')}</nav>
        <span class="sp"></span><span class="live">${this.live}</span>
        <button data-a="close" title="${S.back}">✕</button>
      </header>
      <div class="groups">${groups
        .filter((g) => this.tab === 'all' || this.tab === g.provider)
        .map(
          (g) => `<section class="p-${g.provider}"><h3><b>${ICON[g.provider] ?? '•'}</b>${g.label}</h3>${g.pools
            .map((p) => {
              const key = `${g.provider}:${p.id}`;
              const open = this.expanded.has(key);
              return `<div class="card${open ? ' open' : ''}" data-k="${key}">
                <div class="top"><span class="lbl">${esc(p.label)}</span><span class="big${p.left < 0.25 ? ' low' : ''}">${pct(p.left)}</span></div>
                <div class="sub">${S.left} ${trendIcon(p)} ${p.delta ? `<em>${p.delta}</em>` : ''}<span class="sp"></span>↻ ${resetIn(p.resetAt)}</div>
                ${p.accounts
                  ? p.accounts.map((a) => `<div class="acct"><span>${esc(a.name)}${a.badge ? ` <u>${a.badge}</u>` : ''}</span>${cells(a.left, g.provider)}<b>${pct(a.left)}</b></div>`).join('')
                  : cells(p.left, g.provider)}
                ${open ? `<div class="more">Reset ${when(p.resetAt)}${p.accounts ? p.accounts.map((a) => `<br>${esc(a.name)}: ${when(a.resetAt)}`).join('') : ''}</div>` : ''}
                ${p.note ? `<p>${p.note}</p>` : ''}
              </div>`;
            })
            .join('')}</section>`,
        )
        .join('')}</div>`;
  }

  /** returns true when the view asked to close */
  click(el: HTMLElement, t: HTMLElement) {
    const tab = t.closest<HTMLElement>('[data-t]')?.dataset.t;
    const card = t.closest<HTMLElement>('[data-k]')?.dataset.k;
    if (t.closest('[data-a="close"]')) return true;
    if (tab) this.tab = tab;
    else if (card) this.expanded.has(card) ? this.expanded.delete(card) : this.expanded.add(card);
    else return false;
    this.renderView(el);
    return false;
  }

  update(dt: number, camera: THREE.Camera, w: number, h: number, people: THREE.Box3[]) {
    this.renderT += dt;
    if (this.renderT > 1) {
      this.renderT = 0;
      this.renderWall(this.usage.groups());
      if (this.view) this.renderView(this.view);
    }
    const S = this.office.wallScreen;
    const proj = (p: THREE.Vector3) => {
      this.v.copy(p).project(camera);
      return { x: (this.v.x * 0.5 + 0.5) * w, y: (-this.v.y * 0.5 + 0.5) * h };
    };
    const p0 = proj(S.tl);
    const p1 = proj(S.tl.clone().add(S.right));
    const p2 = proj(S.tl.clone().add(S.down));
    const a = (p1.x - p0.x) / W, b = (p1.y - p0.y) / W, c = (p2.x - p0.x) / H, d = (p2.y - p0.y) / H;
    this.el.style.transform = `matrix(${a},${b},${c},${d},${p0.x},${p0.y})`;

    // cut out everything standing between the camera and the wall
    const det = a * d - b * c;
    const toLocal = (x: number, y: number) => {
      const dx = x - p0.x, dy = y - p0.y;
      return [(d * dx - c * dy) / det, (-b * dx + a * dy) / det];
    };
    let path = `M0 0H${W}V${H}H0Z`;
    for (const box of [...this.office.occluders, ...people]) {
      const pts: [number, number][] = [];
      for (let i = 0; i < 8; i++) {
        const q = proj(new THREE.Vector3(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z));
        pts.push(toLocal(q.x, q.y) as [number, number]);
      }
      if (pts.every((p) => p[0] < 0) || pts.every((p) => p[0] > W) || pts.every((p) => p[1] < 0) || pts.every((p) => p[1] > H)) continue;
      const hull = convexHull(pts);
      path += `M${hull.map((p) => `${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join('L')}Z`;
    }
    this.el.style.clipPath = `path(evenodd, "${path}")`;
  }
}

function convexHull(pts: [number, number][]) {
  const p = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o: number[], a: number[], b: number[]) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: [number, number][] = [];
  for (const q of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop();
    lower.push(q);
  }
  const upper: [number, number][] = [];
  for (const q of p.reverse()) {
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop();
    upper.push(q);
  }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

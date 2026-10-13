/** The big receipt: T3 Code's Usage page (cost / tokens per provider, model, day) printed on thermal paper. */
import { num } from './i18n';
import { S, compact as tok, money as usd, share as pct } from './i18n/costs';

type Kind = 'claude' | 'codex' | 'grok' | 'cursor' | 'opencode' | 'antigravity';
type Range = '24h' | '7d' | '30d' | '90d';
type Metric = 'cost' | 'tokens';
type Tab = 'model' | 'time' | 'project' | 'thread';
/** the server stays language-neutral and names its failures */
type ErrorCode = 'costs_unreadable' | 'threads_unreadable' | 'db_missing';

interface Cell {
  costUsd: number;
  totalTokens: number;
}

export interface CostData {
  ok: boolean;
  /** set when ok is false: what went wrong, as a code; the text is made here */
  code?: ErrorCode;
  detail?: string;
  source: 't3' | 'demo';
  range: Range;
  readAt: string;
  cacheAt: string | null;
  liveFiles: number;
  resolution: 'day' | 'hour';
  sinceDay: string;
  untilDay: string;
  sinceTime?: string;
  untilTime?: string;
  totals: {
    costUsd: number;
    totalTokens: number;
    uncachedInputTokens: number;
    cachedInputTokens: number;
    cacheCreationTokens: number;
    outputTokens: number;
    sessions: number;
    cacheSavingsUsd: number;
    unpricedShare: number;
  };
  categoryCost: { input: number; cacheRead: number; cacheWrite: number; output: number; unsplit: number };
  speedCost: { standard: number; fast: number; ultrafast: number; premium: number };
  providers: { provider: Kind; label: string; costUsd: number; totalTokens: number; sessions: number; costShare: number; tokenShare: number }[];
  models: { provider: Kind; model: string; costUsd: number; totalTokens: number; costShare: number; tokenShare: number; unpriced: boolean; perMillion: number | null; cacheHit: number | null }[];
  series: (Cell & { key: string; byProvider: Partial<Record<Kind, Cell>> })[];
  t3:
    | { ok: false; code: ErrorCode; detail?: string }
    | {
        ok: true;
        costUsd: number;
        count: number;
        projects: { id: string; title: string; threads: number; costUsd: number; totalTokens: number; providers: Partial<Record<Kind, number>> }[];
        threads: { id: string; title: string; project: string; provider: Kind; model: string; costUsd: number; totalTokens: number; turns: number; lastAt: number; parentId: string | null; url: string | null }[];
      };
}

const RANGES: { id: Range; label: string; key: string }[] = [
  { id: '24h', label: S.range24h, key: '1' },
  { id: '7d', label: S.range7d, key: '2' },
  { id: '30d', label: S.range30d, key: '3' },
  { id: '90d', label: S.range90d, key: '4' },
];
const ORDER: Kind[] = ['claude', 'codex', 'grok', 'cursor', 'opencode', 'antigravity'];
const LABEL: Record<Kind, string> = { claude: 'Claude Code', codex: 'Codex', grok: 'Grok Build', cursor: 'Cursor', opencode: 'OpenCode', antigravity: 'Antigravity' };
const ICON: Record<Kind, string> = { claude: '✳', codex: '◎', grok: '✕', cursor: '◆', opencode: '▣', antigravity: '✦' };
const TTL = 45_000;
const UNIT = 6;
const CHART_UNITS = 24;

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const errorText = (code: string | undefined, detail = '') =>
  code === 'costs_unreadable' ? S.errCosts(detail) : code === 'threads_unreadable' ? S.errThreads(detail) : code === 'db_missing' ? S.errNoDb : [code, detail].filter(Boolean).join(': ');
const dayDate = (key: string) => {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
};
const dayLabel = (key: string) => S.day(dayDate(key));
const hourLabel = (iso: string) => `${String(new Date(iso).getHours()).padStart(2, '0')}:${String(new Date(iso).getMinutes()).padStart(2, '0')}`;
const hhmm = (iso: string | null) => (iso ? hourLabel(iso) : '–');

/** Deterministic noise for the demo receipt and the barcode. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class CostView {
  private root: HTMLElement;
  private sheet!: HTMLElement;
  private range: Range = (localStorage.getItem('office.costs.range') as Range) || '30d';
  private metric: Metric = (localStorage.getItem('office.costs.metric') as Metric) || 'cost';
  private tab: Tab = 'model';
  private data = new Map<Range, { at: number; d: CostData }>();
  private loading: Range | null = null;
  private error = '';
  isOpen = false;

  constructor(private mode: 'live' | 'demo', private onThread: (id: string, url: string | null, title: string) => void) {
    if (!RANGES.some((r) => r.id === this.range)) this.range = '30d';
    if (this.metric !== 'cost' && this.metric !== 'tokens') this.metric = 'cost';
    this.root = document.createElement('div');
    this.root.id = 'costs';
    this.root.innerHTML = `<div class="cv-sheet"><div class="cv-printer"><i></i><span>${S.printer}</span><b></b></div><article class="cv-paper"></article></div>`;
    document.body.appendChild(this.root);
    this.sheet = this.root.querySelector<HTMLElement>('.cv-paper')!;
    // the office below must not see drags, wheel zoom or hover picks through the overlay
    for (const ev of ['pointerdown', 'pointermove', 'pointerup', 'wheel', 'dblclick', 'contextmenu'] as const) this.root.addEventListener(ev, (e) => e.stopPropagation());
    this.root.addEventListener('click', (e) => this.click(e.target as HTMLElement));
    this.root.addEventListener('mouseover', (e) => this.hover(e.target as HTMLElement));
    window.addEventListener('keydown', (e) => this.key(e), true);
  }

  open() {
    if (this.isOpen) return;
    this.isOpen = true;
    this.root.classList.remove('out');
    this.root.classList.add('on');
    document.body.classList.add('costs-open');
    this.render();
    void this.load(this.range);
  }

  close() {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.root.classList.add('out');
    document.body.classList.remove('costs-open');
    setTimeout(() => {
      if (!this.isOpen) this.root.classList.remove('on', 'out');
    }, 220);
  }

  toggle() {
    if (this.isOpen) this.close();
    else this.open();
  }

  private key(e: KeyboardEvent) {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (!this.isOpen) {
      if (e.key === 'b' && !document.body.classList.contains('focused')) {
        e.stopImmediatePropagation();
        this.open();
      }
      return;
    }
    // while the receipt is up, the office keys stay quiet
    e.stopImmediatePropagation();
    const r = RANGES.find((x) => x.key === e.key);
    if (e.key === 'Escape' || e.key === 'b') this.close();
    else if (r) this.setRange(r.id);
    else if (e.key === 'c') this.setMetric('cost');
    else if (e.key === 't') this.setMetric('tokens');
  }

  private setRange(r: Range) {
    this.range = r;
    localStorage.setItem('office.costs.range', r);
    this.render();
    void this.load(r);
  }

  private setMetric(m: Metric) {
    this.metric = m;
    localStorage.setItem('office.costs.metric', m);
    this.render();
  }

  private async load(r: Range, force = false) {
    const hit = this.data.get(r);
    if (!force && hit && Date.now() - hit.at < TTL) return;
    if (this.mode === 'demo') {
      this.data.set(r, { at: Date.now(), d: demo(r) });
      this.render();
      return;
    }
    this.loading = r;
    this.error = '';
    this.render();
    try {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const res = await fetch(`/api/t3/costs?range=${r}&tz=${encodeURIComponent(tz)}${force ? '&force=1' : ''}`);
      const d = (await res.json()) as CostData;
      if (!d.ok) throw new Error(errorText(d.code, d.detail) || `HTTP ${res.status}`);
      this.data.set(r, { at: Date.now(), d });
    } catch (e) {
      this.error = (e as Error).message;
    } finally {
      if (this.loading === r) this.loading = null;
      this.render();
    }
  }

  private click(t: HTMLElement) {
    const a = t.closest<HTMLElement>('[data-a]')?.dataset.a;
    const range = t.closest<HTMLElement>('[data-range]')?.dataset.range as Range | undefined;
    const metric = t.closest<HTMLElement>('[data-metric]')?.dataset.metric as Metric | undefined;
    const tab = t.closest<HTMLElement>('[data-tab]')?.dataset.tab as Tab | undefined;
    const thread = t.closest<HTMLElement>('[data-thread]');
    if (a === 'close' || t === this.root) return this.close();
    if (a === 'refresh') return void this.load(this.range, true);
    if (range) return this.setRange(range);
    if (metric) return this.setMetric(metric);
    if (tab) {
      this.tab = tab;
      return this.render();
    }
    if (thread) this.onThread(thread.dataset.thread!, thread.dataset.url || null, thread.dataset.title ?? '');
  }

  /** chart readout follows the column under the pointer without re-rendering */
  private hover(t: HTMLElement) {
    const col = t.closest<HTMLElement>('.cv-col');
    const out = this.sheet.querySelector<HTMLElement>('.cv-readout');
    const d = this.data.get(this.range)?.d;
    if (!out || !d) return;
    const i = col ? Number(col.dataset.i) : -1;
    this.sheet.querySelectorAll('.cv-col.hot').forEach((c) => c.classList.remove('hot'));
    col?.classList.add('hot');
    out.innerHTML = this.readout(d, i >= 0 ? i : this.peak(d));
  }

  private value(c: Cell | undefined) {
    return this.metric === 'cost' ? (c?.costUsd ?? 0) : (c?.totalTokens ?? 0);
  }

  private fmt(v: number) {
    return this.metric === 'cost' ? usd(v) : tok(v);
  }

  private peak(d: CostData) {
    let best = d.series.length - 1;
    d.series.forEach((s, i) => {
      if (this.value(s) > this.value(d.series[best])) best = i;
    });
    return best;
  }

  private readout(d: CostData, i: number) {
    const s = d.series[i];
    if (!s) return '';
    const when = d.resolution === 'hour' ? S.hour(hourLabel(s.key)) : dayLabel(s.key);
    const parts = ORDER.filter((k) => this.value(s.byProvider[k]) > 0).map((k) => `<span><i class="sw p-${k}"></i>${this.fmt(this.value(s.byProvider[k]))}</span>`);
    return `<b>${when}</b><em>${this.fmt(this.value(s))}</em>${parts.join('')}`;
  }

  private render() {
    if (!this.isOpen) return;
    const entry = this.data.get(this.range);
    const d = entry?.d;
    const busy = this.loading === this.range;
    const tabs = RANGES.map((r) => `<button data-range="${r.id}" class="${r.id === this.range ? 'on' : ''}" title="${S.keyHint(r.key)}">${r.label}</button>`).join('');
    const metric = `<button data-metric="cost" class="${this.metric === 'cost' ? 'on' : ''}" title="${S.keyHint('c')}">${S.metricCost}</button><button data-metric="tokens" class="${this.metric === 'tokens' ? 'on' : ''}" title="${S.keyHint('t')}">${S.metricTokens}</button>`;
    const head = `
      <header class="cv-head">
        <div class="cv-brand"><span class="kicker">${S.kicker}</span><h2>${S.title}</h2></div>
        <span class="sp"></span>
        <nav class="cv-tabs">${tabs}</nav>
        <nav class="cv-tabs">${metric}</nav>
        <button class="cv-icon${busy ? ' busy' : ''}" data-a="refresh" title="${S.refresh}">↻</button>
        <button class="cv-icon" data-a="close" title="${S.close}">✕</button>
      </header>`;
    if (!d) {
      this.sheet.innerHTML = `${head}<div class="cv-empty">${this.error ? `<b>${S.printFailed}</b><span>${esc(this.error)}</span>` : `<b>${S.printing}<i class="cv-caret">_</i></b><span>${S.printingSub}</span>`}</div>`;
      return;
    }
    const scroll = this.sheet.scrollTop;
    const hourly = d.resolution === 'hour';
    const period = hourly
      ? S.periodHours(hourLabel(d.sinceTime!), hourLabel(d.untilTime!))
      : S.period(dayLabel(d.sinceDay), dayLabel(d.untilDay));
    const meta =
      d.source === 'demo'
        ? `${period} · <b class="cv-stamp">${S.demoStamp}</b> ${S.demoRest}`
        : `${period} · ${S.asOf(hhmm(d.readAt))} · ${S.scan(hhmm(d.cacheAt))}${d.liveFiles ? S.liveFiles(String(d.liveFiles)) : ''}${busy ? ` · <b>${S.busy}</b>` : ''}`;
    const total = this.metric === 'cost' ? d.totals.costUsd : d.totals.totalTokens;
    const kinds = ORDER.filter((k) => d.providers.some((p) => p.provider === k));

    const providers = d.providers
      .map((p) => {
        const share = this.metric === 'cost' ? p.costShare : p.tokenShare;
        const n = Math.round(share * 20);
        return `<li>
          <div class="row"><span class="nm"><i class="sw p-${p.provider}"></i>${ICON[p.provider]} ${esc(p.label || LABEL[p.provider])}<small>${S.sessions(num(p.sessions), p.sessions === 1)}</small></span><b>${this.metric === 'cost' ? usd(p.costUsd) : tok(p.totalTokens)}</b></div>
          <span class="cells p-${p.provider}">${Array.from({ length: 20 }, (_, i) => `<i class="${i < n ? 'f' : ''}"></i>`).join('')}</span>
          <small>${this.metric === 'cost' ? S.shareOfCost(pct(share), tok(p.totalTokens)) : S.shareOfTokens(pct(share), usd(p.costUsd))}</small>
        </li>`;
      })
      .join('');

    const max = Math.max(...d.series.map((s) => this.value(s)), 0);
    const every = hourly ? 3 : d.series.length > 60 ? 14 : d.series.length > 14 ? 5 : 1;
    const today = d.untilDay;
    const cols = d.series
      .map((s, i) => {
        const units = max > 0 ? Math.round((this.value(s) / max) * CHART_UNITS) : 0;
        const vals = kinds.map((k) => this.value(s.byProvider[k]));
        const sum = vals.reduce((a, b) => a + b, 0);
        // split the column into whole blocks per provider, largest remainder first
        const raw = vals.map((v) => (sum > 0 ? (v / sum) * Math.max(units, this.value(s) > 0 ? 1 : 0) : 0));
        const blocks = raw.map(Math.floor);
        let left = Math.max(units, this.value(s) > 0 ? 1 : 0) - blocks.reduce((a, b) => a + b, 0);
        for (const j of raw.map((v, j) => [v - Math.floor(v), j]).sort((a, b) => b[0] - a[0]).map((x) => x[1])) if (left-- > 0) blocks[j]++;
        const segs = kinds.map((k, j) => (blocks[j] ? `<i class="p-${k}" style="height:${blocks[j] * UNIT}px"></i>` : '')).join('');
        const label = i % every === (hourly ? 1 : (d.series.length - 1) % every) ? `<u>${hourly ? hourLabel(s.key).slice(0, 2) : S.dayShort(dayDate(s.key))}</u>` : '';
        return `<div class="cv-col${!hourly && s.key === today ? ' today' : ''}" data-i="${i}"><span>${segs}</span>${label}</div>`;
      })
      .join('');

    const sumRow = (label: string, value: string, strong = false) => `<li class="${strong ? 'strong' : ''}"><span>${label}</span><i></i><b>${value}</b></li>`;
    const totals = [
      sumRow(S.processedTokens, tok(d.totals.totalTokens)),
      sumRow(S.cachedInput, tok(d.totals.cachedInputTokens)),
      sumRow(S.uncachedInput, tok(d.totals.uncachedInputTokens)),
      sumRow(S.output, tok(d.totals.outputTokens)),
      sumRow(S.cacheSavings, usd(d.totals.cacheSavingsUsd)),
    ].join('');

    const bar = (title: string, segs: { label: string; v: number; cls: string }[], fmt: (n: number) => string, aside = '') => {
      const all = segs.reduce((s, x) => s + x.v, 0);
      const shown = segs.filter((x) => x.v > 0);
      return `<div class="cv-bar"><h4>${title}${aside}</h4><div class="track">${shown.map((x) => `<i class="${x.cls}" style="flex-grow:${x.v}" title="${x.label}: ${fmt(x.v)}"></i>`).join('')}</div><ul>${shown
        .map((x) => `<li><i class="sw ${x.cls}"></i>${x.label}<b>${fmt(x.v)}</b><small>${pct(all ? x.v / all : 0)}</small></li>`)
        .join('')}</ul></div>`;
    };
    const splits =
      d.totals.totalTokens > 0
        ? this.metric === 'tokens'
          ? bar(S.tokensByType, [
              { label: S.input, v: d.totals.uncachedInputTokens, cls: 'c-input' },
              { label: S.cacheRead, v: d.totals.cachedInputTokens, cls: 'c-read' },
              { label: S.cacheWrite, v: d.totals.cacheCreationTokens, cls: 'c-write' },
              { label: S.output, v: d.totals.outputTokens, cls: 'c-out' },
            ], tok)
          : bar(S.costByType, [
              { label: S.input, v: d.categoryCost.input, cls: 'c-input' },
              { label: S.cacheRead, v: d.categoryCost.cacheRead, cls: 'c-read' },
              { label: S.cacheWrite, v: d.categoryCost.cacheWrite, cls: 'c-write' },
              { label: S.output, v: d.categoryCost.output, cls: 'c-out' },
              { label: S.other, v: d.categoryCost.unsplit, cls: 'c-other' },
            ], usd) +
            (d.speedCost.fast + d.speedCost.ultrafast > 0
              ? bar(S.costBySpeed, [
                  { label: S.speedStandard, v: d.speedCost.standard, cls: 's-std' },
                  { label: S.speedFast, v: d.speedCost.fast, cls: 's-fast' },
                  { label: S.speedUltrafast, v: d.speedCost.ultrafast, cls: 's-ultra' },
                ], usd, `<small>${S.surcharge} <b>${usd(d.speedCost.premium)}</b></small>`)
              : '')
        : '';

    const breakTabs = (
      [
        ['model', S.tabModel],
        ['time', hourly ? S.tabHour : S.tabDay],
        ['project', S.tabProject],
        ['thread', S.tabThreads],
      ] as [Tab, string][]
    )
      .map(([id, label]) => `<button data-tab="${id}" class="${this.tab === id ? 'on' : ''}">${label}</button>`)
      .join('');

    this.sheet.innerHTML = `${head}
      <p class="cv-meta">${meta}</p>
      <section class="cv-top">
        <div class="cv-left">
          <div class="cv-total"><span>${this.metric === 'cost' ? usd(total) : tok(total)}</span><small>${(this.metric === 'cost' ? S.totalCost : S.totalTokens)(num(d.totals.sessions), d.totals.sessions === 1)}${
            this.metric === 'cost' && d.totals.unpricedShare > 0 ? ` · <em title="${S.unpricedTitle(pct(d.totals.unpricedShare))}">${S.unpricedShare(pct(d.totals.unpricedShare))}</em>` : ''
          }</small></div>
          <ol class="cv-providers">${providers || `<li class="none">${S.none}</li>`}</ol>
        </div>
        <div class="cv-chart">
          <h3>${this.metric === 'cost' ? (hourly ? S.chartHourlyCost : S.chartDailyCost) : hourly ? S.chartHourlyTokens : S.chartDailyTokens}</h3>
          <div class="cv-plot" style="--h:${CHART_UNITS * UNIT}px"><em class="cv-max">${max > 0 ? this.fmt(max) : ''}</em>${cols}</div>
          <div class="cv-readout">${this.readout(d, this.peak(d))}</div>
        </div>
      </section>
      <hr>
      <section class="cv-sums"><h3>${S.sums}</h3><ul>${totals}</ul></section>
      ${splits ? `<section class="cv-splits">${splits}</section>` : ''}
      <hr>
      <section class="cv-break">
        <header><h3>${S.breakdown}</h3><nav class="cv-tabs small">${breakTabs}</nav></header>
        ${this.breakdown(d)}
      </section>
      ${this.footer(d)}`;
    this.sheet.scrollTop = scroll;
  }

  private breakdown(d: CostData) {
    const m = this.metric;
    const v = (c: Cell) => (m === 'cost' ? c.costUsd : c.totalTokens);
    if (this.tab === 'model') {
      const rows = [...d.models].sort((a, b) => v(b) - v(a) || b.totalTokens - a.totalTokens);
      const top = Math.max(...rows.map(v), 0);
      if (!rows.length) return `<p class="cv-none">${S.none}</p>`;
      return `<table class="cv-table"><thead><tr><th>#</th><th class="l">${S.colModel}</th><th>${S.colCost}</th><th>${S.colShare}</th><th>${S.colTokens}</th><th class="hide">${S.colPerMillion}</th><th class="hide">${S.colCacheHit}</th></tr></thead><tbody>${rows
        .map(
          (r, i) => `<tr><td class="n">${i + 1}</td><td class="l"><span class="mdl">${ICON[r.provider]} ${esc(r.model)}</span><span class="mini p-${r.provider}"><i style="width:${top > 0 && v(r) > 0 ? Math.max(3, (v(r) / top) * 100) : 0}%"></i></span></td><td>${
            r.unpriced ? `<em>${S.unpriced}</em>` : usd(r.costUsd)
          }</td><td>${pct(m === 'cost' ? r.costShare : r.tokenShare)}</td><td>${tok(r.totalTokens)}</td><td class="hide">${r.perMillion === null ? '–' : usd(r.perMillion)}</td><td class="hide">${r.cacheHit === null ? '–' : pct(r.cacheHit)}</td></tr>`,
        )
        .join('')}</tbody></table>`;
    }
    if (this.tab === 'time') {
      const kinds = ORDER.filter((k) => d.providers.some((p) => p.provider === k));
      const rows = [...d.series].reverse().filter((s) => s.totalTokens > 0);
      if (!rows.length) return `<p class="cv-none">${S.none}</p>`;
      return `<table class="cv-table"><thead><tr><th class="l">${d.resolution === 'hour' ? S.tabHour : S.tabDay}</th>${kinds.map((k) => `<th>${ICON[k]} ${LABEL[k]}</th>`).join('')}<th>${S.colCost}</th><th>${S.colTokens}</th></tr></thead><tbody>${rows
        .map(
          (s) => `<tr><td class="l">${d.resolution === 'hour' ? S.hour(hourLabel(s.key)) : dayLabel(s.key)}</td>${kinds.map((k) => `<td class="dim">${m === 'cost' ? usd(s.byProvider[k]?.costUsd ?? 0) : tok(s.byProvider[k]?.totalTokens ?? 0)}</td>`).join('')}<td>${usd(
            s.costUsd,
          )}</td><td class="dim">${tok(s.totalTokens)}</td></tr>`,
        )
        .join('')}</tbody></table>`;
    }
    if (!d.t3.ok) return `<p class="cv-none">${esc(errorText(d.t3.code, d.t3.detail))}</p>`;
    const t3 = d.t3;
    const note = `<p class="cv-note">${S.t3Note(num(t3.count), usd(t3.costUsd), usd(d.totals.costUsd))}</p>`;
    if (this.tab === 'project') {
      const rows = t3.projects.filter((p) => p.costUsd > 0 || p.totalTokens > 0);
      const top = Math.max(...rows.map(v), 0);
      if (!rows.length) return `${note}<p class="cv-none">${S.noThreads}</p>`;
      return `${note}<table class="cv-table"><thead><tr><th>#</th><th class="l">${S.colProject}</th><th>${S.colThreads}</th><th>${S.colCost}</th><th>${S.colShare}</th><th>${S.colTokens}</th></tr></thead><tbody>${rows
        .map((p, i) => {
          const kinds = ORDER.filter((k) => (p.providers[k] ?? 0) > 0);
          return `<tr><td class="n">${i + 1}</td><td class="l"><span class="mdl">${esc(p.title || S.unknownProject)}</span><span class="mini stack" style="width:${top > 0 ? Math.max(3, (v(p) / top) * 100) : 0}%">${kinds
            .map((k) => `<i class="p-${k}" style="flex-grow:${p.providers[k]}"></i>`)
            .join('')}</span></td><td class="dim">${num(p.threads)}</td><td>${usd(p.costUsd)}</td><td>${pct(t3.costUsd ? p.costUsd / t3.costUsd : 0)}</td><td class="dim">${tok(p.totalTokens)}</td></tr>`;
        })
        .join('')}</tbody></table>`;
    }
    const rows = [...t3.threads].sort((a, b) => v(b) - v(a)).slice(0, 20);
    if (!rows.length) return `${note}<p class="cv-none">${S.noThreads}</p>`;
    return `${note}<table class="cv-table threads"><thead><tr><th>#</th><th class="l">${S.colThread}</th><th>${S.colCost}</th><th>${S.colTokens}</th><th class="hide">${S.colTurns}</th><th></th></tr></thead><tbody>${rows
      .map(
        (t, i) => `<tr class="go" data-thread="${esc(t.id)}" data-url="${esc(t.url ?? '')}" data-title="${esc(t.title || S.untitled)}" title="${S.openInT3}"><td class="n">${i + 1}</td><td class="l"><span class="mdl">${t.parentId ? '↳ ' : ''}${esc(t.title || S.untitled)}</span><small>${ICON[t.provider]} ${esc(t.project || S.unknownProject)} · ${esc(t.model || LABEL[t.provider])}</small></td><td>${usd(
          t.costUsd,
        )}</td><td class="dim">${tok(t.totalTokens)}</td><td class="dim hide">${num(t.turns)}</td><td class="arrow">↗</td></tr>`,
      )
      .join('')}</tbody></table>`;
  }

  private footer(d: CostData) {
    const r = rng(Math.round(d.totals.costUsd * 100) + d.series.length);
    let x = 0;
    const bars: string[] = [];
    while (x < 236) {
      const w = 1 + Math.floor(r() * 3), gap = 1 + Math.floor(r() * 3);
      bars.push(`<i style="left:${x}px;width:${w * 2}px"></i>`);
      x += (w + gap) * 2;
    }
    const code = `${d.range.toUpperCase()}-${d.untilDay.replace(/-/g, '')}-${String(Math.round(d.totals.costUsd * 100)).padStart(7, '0')}`;
    return `<footer class="cv-foot">
      <ul><li class="strong"><span>${S.footTotal}</span><i></i><b>${usd(d.totals.costUsd)}</b></li>
      ${d.speedCost.premium > 0 ? `<li><span>${S.footFast}</span><i></i><b>${usd(d.speedCost.premium)}</b></li>` : ''}
      <li><span>${S.footCoffee(usd(0.4))}</span><i></i><b>${num(Math.round(d.totals.costUsd / 0.4))}</b></li></ul>
      <p>${S.footEstimate}<br>${d.source === 'demo' ? S.footDemo : S.footSource}</p>
      <div class="cv-barcode">${bars.join('')}</div>
      <small>${code}</small>
      <p class="thanks">${S.thanks}</p>
    </footer>`;
  }
}

/** Plausible numbers for ?source=demo: same shape as /api/t3/costs. */
function demo(range: Range): CostData {
  const days = { '24h': 1, '7d': 7, '30d': 30, '90d': 90 }[range];
  const hourly = days === 1;
  const r = rng(days * 7919);
  const now = new Date();
  const key = (t: Date) => `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
  const models: { provider: Kind; model: string; rate: number; weight: number }[] = [
    { provider: 'claude', model: 'claude-opus-5-5', rate: 0.62, weight: 0.38 },
    { provider: 'codex', model: 'gpt-6.1-sol', rate: 0.31, weight: 0.33 },
    { provider: 'codex', model: 'gpt-5.6-sol', rate: 0.42, weight: 0.12 },
    { provider: 'claude', model: 'claude-sonnet-5-5', rate: 0.33, weight: 0.08 },
    { provider: 'cursor', model: 'composer-2.5', rate: 0.18, weight: 0.07 },
    { provider: 'claude', model: 'claude-haiku-5-5', rate: 0.05, weight: 0.02 },
  ];
  const keys: string[] = [];
  const untilMs = Math.floor(now.valueOf() / 60_000) * 60_000;
  if (hourly) for (let i = 0; i < 24; i++) keys.push(new Date(untilMs - (24 - i) * 3_600_000).toISOString());
  else for (let i = days - 1; i >= 0; i--) keys.push(key(new Date(now.getFullYear(), now.getMonth(), now.getDate() - i)));
  const series = keys.map((k) => {
    const t = hourly ? new Date(k) : dayDate(k);
    const busy = hourly ? (t.getHours() >= 9 && t.getHours() <= 23 ? 1 : 0.15) : t.getDay() === 0 || t.getDay() === 6 ? 0.45 : 1;
    const base = (hourly ? 14 : 180) * busy * (0.55 + r() * 0.9);
    const byProvider: Partial<Record<Kind, Cell>> = {};
    for (const m of models) {
      const c = base * m.weight * (0.6 + r() * 0.8);
      const cell = (byProvider[m.provider] ??= { costUsd: 0, totalTokens: 0 });
      cell.costUsd += c;
      cell.totalTokens += (c / m.rate) * 1e6;
    }
    const vals = Object.values(byProvider) as Cell[];
    return { key: k, costUsd: vals.reduce((s, x) => s + x.costUsd, 0), totalTokens: vals.reduce((s, x) => s + x.totalTokens, 0), byProvider };
  });
  const costUsd = series.reduce((s, x) => s + x.costUsd, 0);
  const totalTokens = series.reduce((s, x) => s + x.totalTokens, 0);
  const prov = ORDER.map((k) => ({ k, c: series.reduce((s, x) => s + (x.byProvider[k]?.costUsd ?? 0), 0), t: series.reduce((s, x) => s + (x.byProvider[k]?.totalTokens ?? 0), 0) })).filter((p) => p.t > 0);
  const wsum = models.reduce((s, m) => s + m.weight, 0);
  const projects = S.demoProjects;
  const titles = S.demoThreads;
  const t3Share = 0.72;
  const threads = titles.map((title, i) => {
    const m = models[i % models.length];
    const c = costUsd * t3Share * (0.28 / (i + 1.2)) * (0.8 + r() * 0.4);
    return { id: `demo-${i}`, title, project: projects[i % projects.length], provider: m.provider, model: m.model, costUsd: c, totalTokens: (c / m.rate) * 1e6, turns: 4 + Math.floor(r() * 40), lastAt: Date.now() - i * 3_600_000, parentId: null, url: null };
  });
  const t3Cost = threads.reduce((s, t) => s + t.costUsd, 0);
  return {
    ok: true,
    source: 'demo',
    range,
    readAt: now.toISOString(),
    cacheAt: null,
    liveFiles: 0,
    resolution: hourly ? 'hour' : 'day',
    sinceDay: hourly ? key(new Date(untilMs - 86_400_000)) : keys[0],
    untilDay: key(now),
    ...(hourly ? { sinceTime: new Date(untilMs - 86_400_000).toISOString(), untilTime: new Date(untilMs).toISOString() } : {}),
    totals: {
      costUsd,
      totalTokens,
      cachedInputTokens: totalTokens * 0.9,
      uncachedInputTokens: totalTokens * 0.07,
      cacheCreationTokens: totalTokens * 0.02,
      outputTokens: totalTokens * 0.01,
      sessions: Math.round(days * 23 + r() * 10),
      cacheSavingsUsd: costUsd * 8.4,
      unpricedShare: 0,
    },
    categoryCost: { input: costUsd * 0.13, cacheRead: costUsd * 0.6, cacheWrite: costUsd * 0.11, output: costUsd * 0.16, unsplit: 0 },
    speedCost: { standard: costUsd * 0.86, fast: costUsd * 0.14, ultrafast: 0, premium: costUsd * 0.07 },
    providers: prov
      .map((p) => ({ provider: p.k, label: LABEL[p.k], costUsd: p.c, totalTokens: p.t, sessions: Math.max(1, Math.round((p.c / costUsd) * days * 23)), costShare: p.c / costUsd, tokenShare: p.t / totalTokens }))
      .sort((a, b) => b.costUsd - a.costUsd),
    models: models
      .map((m) => {
        const c = (costUsd * m.weight) / wsum, t = (c / m.rate) * 1e6;
        return { provider: m.provider, model: m.model, costUsd: c, totalTokens: t, costShare: c / costUsd, tokenShare: t / totalTokens, unpriced: false, perMillion: m.rate, cacheHit: 0.9 };
      })
      .sort((a, b) => b.costUsd - a.costUsd),
    series,
    t3: {
      ok: true,
      costUsd: t3Cost,
      count: 40 + Math.floor(days * 3.5),
      projects: projects.map((title) => {
        const mine = threads.filter((t) => t.project === title);
        const providers: Partial<Record<Kind, number>> = {};
        for (const t of mine) providers[t.provider] = (providers[t.provider] ?? 0) + t.costUsd;
        return { id: title, title, threads: mine.length * 3, costUsd: mine.reduce((s, t) => s + t.costUsd, 0), totalTokens: mine.reduce((s, t) => s + t.totalTokens, 0), providers };
      }).sort((a, b) => b.costUsd - a.costUsd),
      threads,
    },
  };
}

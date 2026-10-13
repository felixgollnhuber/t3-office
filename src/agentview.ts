import type { T3Thread } from './t3source';
import * as THREE from 'three';
import { PROVIDERS, TEAMS, type Status } from './data';
import type { ToolKind } from './desk';
import type { AgentSource, Thread, TranscriptItem } from './source';
import type { World, Worker } from './workers';
import { date, num, usd } from './i18n';
import { S } from './i18n/agent';
import './thread.css';

/** 3x5 pixel glyphs, rows top to bottom, 3 bits each */
const GLYPHS: Record<string, number[]> = {
  A: [2, 5, 7, 5, 5], B: [6, 5, 6, 5, 6], C: [3, 4, 4, 4, 3], D: [6, 5, 5, 5, 6], E: [7, 4, 6, 4, 7], F: [7, 4, 6, 4, 4],
  G: [3, 4, 5, 5, 3], H: [5, 5, 7, 5, 5], I: [7, 2, 2, 2, 7], J: [1, 1, 1, 5, 2], K: [5, 5, 6, 5, 5], L: [4, 4, 4, 4, 7],
  M: [5, 7, 7, 5, 5], N: [6, 5, 5, 5, 5], O: [2, 5, 5, 5, 2], P: [6, 5, 6, 4, 4], Q: [2, 5, 5, 6, 3], R: [6, 5, 6, 5, 5],
  S: [3, 4, 2, 1, 6], T: [7, 2, 2, 2, 2], U: [5, 5, 5, 5, 7], V: [5, 5, 5, 5, 2], W: [5, 5, 7, 7, 5], X: [5, 5, 2, 5, 5],
  Y: [5, 5, 2, 2, 2], Z: [7, 1, 2, 4, 7], '0': [7, 5, 5, 5, 7], '1': [2, 6, 2, 2, 7], '2': [6, 1, 2, 4, 7], '3': [6, 1, 2, 1, 6],
  '4': [5, 5, 7, 1, 1], '5': [7, 4, 6, 1, 6], '6': [3, 4, 7, 5, 7], '7': [7, 1, 2, 2, 2], '8': [7, 5, 7, 5, 7], '9': [7, 5, 7, 1, 6],
  '.': [0, 0, 0, 0, 2], ',': [0, 0, 0, 2, 4], ':': [0, 2, 0, 2, 0], '-': [0, 0, 7, 0, 0], '+': [0, 2, 7, 2, 0], '/': [1, 1, 2, 4, 4],
  '?': [6, 1, 2, 0, 2], '!': [2, 2, 2, 0, 2], '#': [5, 7, 5, 7, 5], '%': [5, 1, 2, 4, 5], '>': [4, 2, 1, 2, 4], '<': [1, 2, 4, 2, 1],
  '(': [1, 2, 2, 2, 1], ')': [4, 2, 2, 2, 4], '_': [0, 0, 0, 0, 7], '"': [5, 5, 0, 0, 0], "'": [2, 2, 0, 0, 0], '=': [0, 7, 0, 7, 0],
  '*': [0, 5, 2, 5, 0], '@': [7, 5, 7, 4, 7], '$': [3, 6, 2, 3, 6], '&': [2, 5, 2, 5, 3], '[': [3, 2, 2, 2, 3], ']': [6, 2, 2, 2, 6],
};
const fold = (s: string) => s.toUpperCase().replace(/Ä/g, 'A').replace(/Ö/g, 'O').replace(/Ü/g, 'U').replace(/ß/g, 'SS').replace(/[·…]/g, '.');

function text(g: CanvasRenderingContext2D, s: string, x: number, y: number, max = 99) {
  let cx = x;
  for (const ch of fold(s).slice(0, max)) {
    const gl = GLYPHS[ch];
    if (gl) for (let r = 0; r < 5; r++) for (let c = 0; c < 3; c++) if (gl[r] & (4 >> c)) g.fillRect(cx + c, y + r, 1, 1);
    cx += 4;
  }
  return cx;
}

const ACCENT: Record<string, string> = { claude: '#d9774f', codex: '#10a37f', cursor: '#5b63d6', gemini: '#3f86e0' };
const TOOL_COLOR: Record<ToolKind, string> = { terminal: '#7ee0b5', search: '#8fd3ff', edit: '#ffd27a', web: '#c39bff', test: '#b8f29a' };
const TOOL_LABEL: Record<ToolKind, string> = S.tool;
const STATUS_ORDER: Record<Thread['status'], number> = { waiting: 0, failed: 1, running: 2, completed: 3, idle: 4 };
const STATUS_LABEL: Record<Status, string> = S.status;

interface LogLine {
  at: Date;
  kind: ToolKind | 'status' | 'start' | 'compact' | 'done';
  text: string;
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const hhmm = (d: Date) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
const dur = (s: number) => (s < 60 ? `${Math.round(s)} s` : s < 3600 ? `${Math.round(s / 60)} min` : `${num(s / 3600, 1)} h`);

/** a message as HTML: escaped, with code blocks, `code` and **bold** kept readable; everything else stays plain text */
function prose(text: string) {
  const parts = text.replace(/\n{3,}/g, '\n\n').split(/```[^\n]*\n?/);
  return parts
    .map((part, i) =>
      i % 2
        ? `<pre>${esc(part.replace(/\n+$/, ''))}</pre>`
        : esc(part)
            .replace(/`([^`\n]+)`/g, '<code>$1</code>')
            .replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>')
            .replace(/^#{1,4} +(.+)$/gm, '<b>$1</b>'),
    )
    .join('');
}

/** what the reader knows about one thread's conversation */
interface Convo {
  items: TranscriptItem[];
  /** performance.now() of the last fetch */
  at: number;
  busy: boolean;
  loaded: boolean;
  error: boolean;
}

/** how often an open thread is fetched again, in ms */
const READ_EVERY = 3000;
/** this close to the end counts as "reading the newest": new items keep the view at the bottom */
const STICK_PX = 28;

/** Everything about one agent up close: the side sheet and the live picture on its monitor. */
export class AgentInspector {
  private log = new Map<string, LogLine[]>();
  private since = new Map<string, number>();
  private canvas = document.createElement('canvas');
  private g: CanvasRenderingContext2D;
  readonly tex: THREE.CanvasTexture;
  private paintT = 0;
  private reveal = 0;
  private lastTop = '';
  /** which side of the sheet is open; stays when you go from agent to agent */
  private tab: 'info' | 'thread' = 'info';
  private shown = '';
  private bound = new WeakSet<HTMLElement>();
  private painted = new WeakMap<Element, string>();
  private convos = new Map<string, Convo>();

  constructor(private source: AgentSource, private world: World, private now: () => Date) {
    this.canvas.width = 64;
    this.canvas.height = 36;
    this.g = this.canvas.getContext('2d')!;
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.magFilter = this.tex.minFilter = THREE.NearestFilter;
    this.tex.colorSpace = THREE.SRGBColorSpace;
    for (const t of source.threads()) {
      this.since.set(t.id, performance.now());
      this.push(t.id, 'start', t.title);
    }
    source.subscribe((e) => {
      if (e.type === 'add') {
        this.since.set(e.thread.id, performance.now());
        this.push(e.thread.id, 'start', e.thread.title);
      } else if (e.type === 'tool') this.push(e.id, e.kind, e.label);
      else if (e.type === 'status') {
        this.since.set(e.id, performance.now());
        this.push(e.id, 'status', STATUS_LABEL[e.to]);
      } else if (e.type === 'compact') this.push(e.id, 'compact', S.contextCompacted);
      else if (e.type === 'settle') this.push(e.id, 'done', S.packingUp);
    });
  }

  private push(id: string, kind: LogLine['kind'], text: string) {
    const l = this.log.get(id) ?? [];
    l.push({ at: this.now(), kind, text });
    if (l.length > 40) l.shift();
    this.log.set(id, l);
  }

  worker(id: string) {
    return this.world.workers.get(id);
  }

  thread(id: string): Thread | undefined {
    const boss = this.source.boss?.();
    return this.source.threads().find((t) => t.id === id) ?? this.world.workers.get(id)?.thread ?? (boss?.id === id ? boss : undefined);
  }

  /** what the person is physically doing right now, in words */
  private activity(w: Worker) {
    const t = w.thread;
    if (w.mode === 'seated') {
      if (t.status === 'running') return S.typing(Math.round(t.tps));
      if (t.status === 'waiting') return S.seatedWaiting;
      if (t.status === 'failed') return S.seatedFailed;
      if (t.status === 'completed') return S.seatedDone;
      return S.seated;
    }
    if (w.mode === 'walk') return w.doing || S.walking;
    if (w.mode === 'unpack') return S.unpacking;
    if (w.mode === 'pack') return S.packingUp;
    if (w.mode === 'leaving') return S.leaving;
    if (w.mode === 'wc') return S.restroom;
    return w.doing || S.out;
  }

  /** the sheet's own buttons (tabs, jump to newest); close, open and agent links are handled by the caller */
  private bind(el: HTMLElement) {
    if (this.bound.has(el)) return;
    this.bound.add(el);
    el.addEventListener('click', (ev) => {
      if (!el.classList.contains('agent-view')) return;
      const a = (ev.target as HTMLElement).closest<HTMLElement>('[data-a]')?.dataset.a;
      if (a === 'tab-info' || a === 'tab-thread') {
        this.tab = a === 'tab-thread' ? 'thread' : 'info';
        this.render(el, this.shown);
      } else if (a === 'newest') {
        const box = el.querySelector<HTMLElement>('.thread-scroll');
        if (box) box.scrollTop = box.scrollHeight;
      }
    });
  }

  /** writes one part of the sheet, and only when it changed: buttons stay clickable and the thread keeps its scroll position */
  private part(el: HTMLElement, name: string, html: string) {
    const node = el.querySelector<HTMLElement>(`[data-part="${name}"]`);
    if (!node || this.painted.get(node) === html) return;
    this.painted.set(node, html);
    node.innerHTML = html;
  }

  render(el: HTMLElement, id: string) {
    const w = this.worker(id);
    const t = this.thread(id);
    this.bind(el);
    this.shown = id;
    el.classList.remove('quota-view', 'pin-view');
    el.classList.add('agent-view');
    if (!t) {
      el.dataset.sheet = '';
      el.classList.remove('reading');
      el.innerHTML = `<header><b>${S.gone}</b><span class="sp"></span><button data-a="close">✕</button></header>`;
      return;
    }
    const p = PROVIDERS[t.provider];
    const team = TEAMS[t.team];
    const kids = [...this.world.workers.values()].filter((x) => x.thread.parentId === id);
    const parent = t.parentId ? this.thread(t.parentId) : undefined;
    const manager = !t.parentId && t.managerId ? this.thread(t.managerId) : undefined;
    const reports = [...this.world.workers.values()].filter((x) => x.thread.managerId === id && !x.intern).map((x) => x.thread);
    const isBoss = this.source.boss?.()?.id === id;
    const log = (this.log.get(id) ?? []).slice(-9).reverse();
    const since = (performance.now() - (this.since.get(id) ?? performance.now())) / 1000;
    el.style.setProperty('--acc', ACCENT[t.provider]);
    const live = t as Partial<T3Thread>;
    const tab = this.source.transcript ? this.tab : 'info';

    // the frame is built once per agent and tab; after that only the parts that changed are rewritten
    const sheet = `${tab}:${id}`;
    if (el.dataset.sheet !== sheet || !el.querySelector('[data-part="top"]')) {
      el.dataset.sheet = sheet;
      el.classList.toggle('reading', tab === 'thread');
      el.innerHTML = `
        <div class="part" data-part="top"></div>
        ${
          this.source.transcript
            ? `<nav class="sheet-tabs"><button data-a="tab-info" class="${tab === 'info' ? 'on' : ''}">${S.tabOverview}</button><button data-a="tab-thread" class="${tab === 'thread' ? 'on' : ''}">${S.tabThread}</button></nav>`
            : ''
        }
        ${
          tab === 'thread'
            ? `<section class="thread"><div class="thread-scroll"><ol data-part="thread"></ol></div><button class="thread-jump" data-a="newest">${S.newest}</button></section>`
            : `<div class="part" data-part="body"></div><div class="part" data-part="links"></div>`
        }
        <footer><button data-a="open" class="primary">${S.openInT3}</button></footer>`;
      const box = el.querySelector<HTMLElement>('.thread-scroll');
      box?.addEventListener('scroll', () => this.jumpHint(el), { passive: true });
    }

    this.part(
      el,
      'top',
      `<header>
        <span class="av">${esc(t.name.slice(0, 2).toUpperCase())}</span>
        <span class="who"><b>${esc(t.name)}</b><small>${esc(live.providerLabel ?? p.label)} · ${esc(t.model)}${t.parentId ? ` · ${S.subagent}` : isBoss ? ` · ${S.boss}` : ''}</small></span>
        <span class="sp"></span>
        <button data-a="close" title="${S.back}">✕</button>
      </header>
      <div class="st s-${t.status}"><i></i>${STATUS_LABEL[t.status]}<em>${S.since(dur(since))}</em></div>`,
    );
    if (tab === 'thread') {
      this.read(el, id);
      this.fill(el, id);
      return;
    }
    this.part(
      el,
      'body',
      `<section><h5>${S.task}</h5><p class="task">${esc(t.title)}</p>${team ? `<p class="team" style="--team:${team.color}">${esc(live.project ?? team.name)}</p>` : ''}</section>
      <section><h5>${S.rightNow}</h5><p>${esc(live.activity || (w ? this.activity(w) : ''))}</p>${live.message ? `<p class="bubble-q">${S.quote(esc(live.message))}</p>` : w?.bubble && w.bubble.until > this.world.time ? `<p class="bubble-q">${S.quote(esc(w.bubble.text))}</p>` : ''}</section>
      <div class="stats">
        <div><b>${t.toolCalls}</b><small>${S.toolCalls}</small></div>
        <div><b>${t.files}</b><small>${S.files}</small></div>
        <div><b>${usd(t.cost)}</b><small>${S.cost}</small></div>
        <div class="ctx"><b>${Math.round(t.context)}%</b><small>${S.context}</small><span><i style="width:${Math.min(100, t.context)}%"></i></span></div>
      </div>
      <section class="log"><h5>${S.history}</h5><ol>${log
        .map((l) => `<li class="k-${l.kind}"><time>${hhmm(l.at)}</time><i></i>${esc(l.kind in TOOL_LABEL ? `${TOOL_LABEL[l.kind as ToolKind]}: ${l.text}` : l.text)}</li>`)
        .join('')}</ol></section>`,
    );
    this.part(
      el,
      'links',
      `${
        parent || kids.length
          ? `<section><h5>${parent ? S.belongsTo : S.subagents}</h5><div class="kids">${(parent ? [parent] : kids.map((k) => k.thread))
              .map((k) => `<button data-agent="${k.id}">${esc(k.name)} <small>${STATUS_LABEL[k.status]}</small></button>`)
              .join('')}</div></section>`
          : ''
      }
      ${manager ? `<section><h5>${S.workingFor}</h5><div class="kids"><button data-agent="${manager.id}">${esc(manager.name)} <small>${STATUS_LABEL[manager.status]}</small></button></div></section>` : ''}
      ${
        reports.length
          ? `<section><h5>${S.runsThreads(reports.length)}</h5><div class="kids">${reports
              .sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status])
              .map((k) => `<button data-agent="${k.id}" class="s-${k.status}">${esc(k.name)} <small>${STATUS_LABEL[k.status]}</small></button>`)
              .join('')}</div></section>`
          : ''
      }`,
    );
  }

  // ------------------------------------------------------------ thread reader

  /** fetches the open thread again every few seconds; driven by render(), so it stops when the sheet closes */
  private read(el: HTMLElement, id: string) {
    let c = this.convos.get(id);
    if (!c) {
      c = { items: [], at: -READ_EVERY, busy: false, loaded: false, error: false };
      this.convos.set(id, c);
      // only the last few threads you looked at are kept
      for (const old of this.convos.keys()) if (this.convos.size > 6 && old !== id) this.convos.delete(old);
    }
    const convo = c;
    if (convo.busy || performance.now() - convo.at < READ_EVERY) return;
    convo.busy = true;
    convo.at = performance.now();
    this.source.transcript!(id)
      .then((items) => {
        // the server sends a window of the newest items; what scrolled out of it stays readable here
        const fresh = new Set(items.map((i) => i.id));
        const first = items[0]?.at ?? Infinity;
        convo.items = [...convo.items.filter((i) => !fresh.has(i.id) && i.at <= first), ...items].slice(-300);
        convo.loaded = true;
        convo.error = false;
      })
      .catch(() => (convo.error = true))
      .finally(() => {
        convo.busy = false;
        if (this.shown === id && this.tab === 'thread' && el.isConnected && el.classList.contains('agent-view')) this.fill(el, id);
      });
  }

  private line(i: TranscriptItem, name: string) {
    const time = `<time>${hhmm(new Date(i.at))}</time>`;
    if (i.role === 'tool') {
      const state = i.state === 'failed' ? `<em>${S.failed}</em>` : i.state === 'running' ? `<em>${S.stillRunning}</em>` : '';
      return `<p class="k-${i.kind ?? 'terminal'}${i.state ? ` s-${i.state}` : ''}"><i></i><span>${esc(i.text)}</span>${state}${time}</p>`;
    }
    if (i.role === 'note') return `<li class="t-note${i.kind === 'error' ? ' t-err' : ''}"><span>${esc(i.kind === 'compact' ? S.contextCompacted : i.text)}</span>${time}</li>`;
    const who = i.role === 'assistant' ? name : i.by === 'agent' ? S.otherAgent : S.you;
    return `<li class="t-msg ${i.role === 'assistant' ? 't-bot' : `t-user${i.by === 'agent' ? ' by-agent' : ''}`}"><div class="t-who"><b>${esc(who)}</b>${time}</div><div class="t-text">${prose(i.text)}${i.more ? `<span class="t-more">${S.cutOff}</span>` : ''}</div></li>`;
  }

  /** the conversation as a list: bubbles for messages, runs of tool calls as one compact block, a rule where the day changes */
  private fill(el: HTMLElement, id: string) {
    const box = el.querySelector<HTMLElement>('.thread-scroll');
    const list = el.querySelector<HTMLElement>('[data-part="thread"]');
    if (!box || !list) return;
    const c = this.convos.get(id);
    const name = this.thread(id)?.name ?? '';
    let html = '';
    if (!c || (!c.loaded && !c.error)) html = `<li class="t-empty">${S.loading}</li>`;
    else if (!c.items.length) html = `<li class="t-empty">${c.error ? S.threadError : S.threadEmpty}</li>`;
    else {
      let day = '', tools = '';
      const flush = () => {
        if (tools) html += `<li class="t-tools">${tools}</li>`;
        tools = '';
      };
      for (const i of c.items) {
        const d = new Date(i.at).toDateString();
        if (d !== day) {
          flush();
          if (day || d !== new Date().toDateString()) html += `<li class="t-day">${esc(date(new Date(i.at), { weekday: 'short', day: 'numeric', month: 'short' }))}</li>`;
          day = d;
        }
        if (i.role === 'tool') tools += this.line(i, name);
        else {
          flush();
          html += this.line(i, name);
        }
      }
      flush();
    }
    if (this.painted.get(list) === html) return;
    // new items keep you at the end, unless you scrolled up to read
    const stick = !this.painted.has(list) || list.querySelector('.t-empty') !== null || box.scrollHeight - box.scrollTop - box.clientHeight < STICK_PX;
    this.painted.set(list, html);
    list.innerHTML = html;
    if (stick) box.scrollTop = box.scrollHeight;
    this.jumpHint(el);
  }

  private jumpHint(el: HTMLElement) {
    const box = el.querySelector<HTMLElement>('.thread-scroll');
    if (box) el.querySelector('.thread-jump')?.classList.toggle('on', box.scrollHeight - box.scrollTop - box.clientHeight > STICK_PX * 4);
  }

  /** the little T3 window on the agent's monitor */
  paint(id: string, dt: number) {
    this.paintT += dt;
    this.reveal += dt * 18;
    if (this.paintT < 0.12) return;
    this.paintT = 0;
    const t = this.thread(id);
    if (!t) return;
    const g = this.g;
    const blink = Math.floor(performance.now() / 400) % 2 === 0;
    g.fillStyle = '#121419';
    g.fillRect(0, 0, 64, 36);
    // title bar
    g.fillStyle = ACCENT[t.provider];
    g.fillRect(0, 0, 64, 7);
    g.fillStyle = '#ffffff';
    text(g, t.name, 2, 1, 9);
    g.fillStyle = t.status === 'running' ? '#7dffb0' : t.status === 'waiting' ? '#ffd36b' : t.status === 'failed' ? '#ff6b6b' : '#c8c8d0';
    g.fillRect(59, 2, 3, 3);
    // the task as the first user message, right aligned like a chat bubble
    g.fillStyle = '#2a2f3a';
    g.fillRect(14, 9, 49, 7);
    g.fillStyle = '#d8dce6';
    text(g, t.title, 16, 10, 11);
    // recent tool calls, newest typed out
    const lines = (this.log.get(id) ?? []).filter((l) => l.kind !== 'start').slice(-3);
    const top = lines.length ? lines[lines.length - 1].text + lines.length : '';
    if (top !== this.lastTop) {
      this.lastTop = top;
      this.reveal = 0;
    }
    lines.forEach((l, i) => {
      const y = 18 + i * 6;
      g.fillStyle = l.kind in TOOL_COLOR ? TOOL_COLOR[l.kind as ToolKind] : l.kind === 'status' ? '#ffd36b' : '#8a8f9c';
      g.fillRect(1, y + 1, 3, 3);
      g.fillStyle = '#aab0bd';
      const last = i === lines.length - 1;
      const end = text(g, l.text, 6, y, last ? Math.floor(this.reveal) : 14);
      if (last && t.status === 'running' && blink) {
        g.fillStyle = '#f2efe8';
        g.fillRect(Math.min(end, 61), y, 2, 5);
      }
    });
    if (t.status === 'waiting') {
      g.fillStyle = '#ffd36b';
      g.fillRect(2, 29, 60, 6);
      g.fillStyle = '#1d1c22';
      text(g, blink ? S.bannerApprove : S.bannerWaiting, 4, 30);
    } else if (t.status === 'failed') {
      g.fillStyle = '#d9423b';
      g.fillRect(2, 29, 60, 6);
      g.fillStyle = '#ffffff';
      text(g, S.bannerError, 4, 30);
    } else {
      // context gauge
      g.fillStyle = '#2a2f3a';
      g.fillRect(2, 34, 60, 1);
      g.fillStyle = t.context > 80 ? '#ff8a65' : ACCENT[t.provider];
      g.fillRect(2, 34, Math.round((60 * Math.min(100, t.context)) / 100), 1);
    }
    this.tex.needsUpdate = true;
  }
}

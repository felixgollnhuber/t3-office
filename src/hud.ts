import * as THREE from 'three';
import type { Theme } from './themes';
import { TEAMS } from './data';
import type { Anchor, World } from './workers';
import type { AgentSource, SourceEvent, Thread } from './source';
import type { DayCycle } from './sky';
import type { Sfx } from './audio';
import { hhmm, type Clock } from './time';
import { RADIO, SETS, type Item, type Player } from './player';
import { MODE_LABEL, WEATHER_ICON, type Weather } from './weather';
import { settings } from './settings';
import { LANGS, lang, num, setLang, usd, type Lang } from './i18n';
import { S } from './i18n/hud';

const STATUS_LABEL: Record<string, string> = { running: '', ...S.status, boss: '' };

type Tab = 'radio' | 'sets' | 'likes';

export function applyHudTheme(theme: Theme) {
  const r = document.documentElement.style;
  const h = theme.hud;
  r.setProperty('--font', h.font);
  r.setProperty('--num', h.numFont);
  r.setProperty('--paper', h.paper);
  r.setProperty('--ink', h.ink);
  r.setProperty('--muted', h.muted);
  r.setProperty('--accent', h.accent);
  r.setProperty('--accent2', h.accent2);
  r.setProperty('--edge', h.edge);
  r.setProperty('--shadow', h.shadow);
  r.setProperty('--tag-bg', h.tagBg);
  r.setProperty('--tag-ink', h.tagInk);
  document.body.dataset.theme = theme.id;
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

const clockOf = (sec: number) => {
  const s = Math.max(0, Math.floor(sec || 0));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}` : `${m}:${String(r).padStart(2, '0')}`;
};

export class Hud {
  private scrubAt: number | null = null;
  private root = document.getElementById('hud')!;
  private $ = <T extends HTMLElement = HTMLElement>(sel: string) => this.root.querySelector(sel) as T;
  private hist: number[] = Array(48).fill(0);
  private histT = 0;
  private ticker: { t: string; text: string; kind: string }[] = [];
  private names = new Map<string, Thread>();
  private lastWx = '';

  private tab: Tab;

  constructor(private theme: Theme, private sfx: Sfx, private clock: Clock, source: AgentSource, private player: Player, private weather: Weather, openSettings: () => void = () => {}) {
    this.tab = player.current.kind === 'youtube' ? 'sets' : 'radio';
    for (const t of source.threads()) this.names.set(t.id, t);
    source.subscribe((e) => this.onEvent(e));
    this.root.innerHTML = `
      <section class="panel clock">
        <div class="time"></div>
        <div class="date"></div>
        <div class="sun"><span class="arc"><i></i></span><span class="times"></span></div>
        <button class="wx" title="${esc(S.weatherHint)}"></button>
        <button class="wx lang" title="${esc(S.language(LANGS.find((l) => l.id === lang)!.label))}">${LANGS.map((l) => (l.id === lang ? `<b>${l.id.toUpperCase()}</b>` : `<em data-lang="${l.id}" title="${esc(l.label)}">${l.id.toUpperCase()}</em>`)).join('')}</button>
        <button class="wx gear" title="${esc(S.settings)}" aria-label="${esc(S.settings)}"><i></i></button>
        <div class="crew"></div>
      </section>

      <section class="panel deck">
        <header><span class="kicker">${S.deck}</span><nav class="tabs"><button data-tab="radio">Radio</button><button data-tab="sets">Boiler Room</button><button data-tab="likes">♥ <b class="nlikes">0</b></button></nav></header>
        <div class="yt"></div>
        <div class="now">
          <div class="vinyl"><span></span></div>
          <div class="meta"><div class="title"></div><div class="artist"></div><div class="bpm"></div></div>
          <button class="heart" title="${S.like}">♡</button>
        </div>
        <div class="seek"><span class="tc now-t">0:00</span><div class="prog" title="${S.seek}"><i></i><b></b></div><span class="tc dur-t">0:00</span></div>
        <div class="ctrl"><button data-c="prev" title="${S.prev}">◀◀</button><button data-c="play" class="play">▶</button><button data-c="next" title="${S.next}">▶▶</button><span class="sp"></span><button data-c="video" title="${S.showVideo}">Video</button><button data-c="sounds">Sounds</button></div>
        <div class="eq">${Array.from({ length: 18 }, () => '<i></i>').join('')}</div>
        <ol class="sets"></ol>
        <div class="hint">${S.unlockHint}</div>
      </section>

      <section class="panel receipt">
        <div class="kicker">${S.receipt}</div>
        <dl></dl>
        <div class="teams"></div>
        <div class="total"></div>
      </section>

      <section class="panel pulse">
        <div class="head"><span class="kicker">${S.lastMinutes}</span><span class="live"></span></div>
        <div class="bars">${this.hist.map(() => '<i></i>').join('')}</div>
      </section>

      <section class="panel ticker"><div class="kicker">${S.grapevine}</div><ol></ol></section>
      <div class="toast"></div>
    `;
    const deck = this.$('.deck');
    deck.addEventListener('click', (ev) => {
      ev.stopPropagation();
      sfx.unlock();
      const t = ev.target as HTMLElement;
      const tab = t.closest<HTMLElement>('[data-tab]')?.dataset.tab as Tab | undefined;
      const c = t.closest<HTMLElement>('[data-c]')?.dataset.c;
      const li = t.closest<HTMLElement>('li[data-id]');
      if (tab) {
        this.tab = tab;
        player.showLikes = tab === 'likes';
        this.renderDeck();
      } else if (t.closest('.heart')) player.like();
      else if (t.closest('.li-heart') && li) player.like(li.dataset.id);
      else if (li) {
        const item = [...RADIO, ...SETS].find((i) => i.id === li.dataset.id);
        if (item) void player.play(item);
      } else if (c === 'play') player.toggle();
      else if (c === 'next') player.next(1);
      else if (c === 'prev') player.next(-1);
      else if (c === 'sounds') settings.set('sounds', !settings.get('sounds'));
      else if (c === 'video') player.setShowVideo(!player.showVideo);
      else if (t.closest('.yt-close')) player.closeVideo();
    });
    // scrubbing: click or drag along the progress bar
    const prog = this.$('.prog');
    let scrub = false;
    const frac = (ev: PointerEvent) => {
      const r = prog.getBoundingClientRect();
      return Math.max(0, Math.min(1, (ev.clientX - r.left) / r.width));
    };
    prog.addEventListener('pointerdown', (ev) => {
      ev.stopPropagation();
      sfx.unlock();
      scrub = true;
      prog.setPointerCapture(ev.pointerId);
      this.scrubAt = frac(ev);
      prog.classList.add('scrub');
    });
    prog.addEventListener('pointermove', (ev) => {
      const r = prog.getBoundingClientRect();
      prog.style.setProperty('--hover', `${(((ev.clientX - r.left) / r.width) * 100).toFixed(1)}%`);
      if (scrub) this.scrubAt = frac(ev);
    });
    prog.addEventListener('pointerup', (ev) => {
      if (!scrub) return;
      scrub = false;
      prog.classList.remove('scrub');
      player.seek(frac(ev));
      this.scrubAt = null;
    });
    player.onChange(() => this.renderDeck());
    this.$('.wx').addEventListener('click', (ev) => {
      ev.stopPropagation();
      sfx.unlock();
      // shortcut for the weather setting; main applies it and repaints this button
      settings.set('weather', weather.nextMode());
    });
    this.$('.wx.gear').addEventListener('click', (ev) => {
      ev.stopPropagation();
      sfx.unlock();
      sfx.play('key');
      openSettings();
    });
    // language switch: click a language, or anywhere on the button for the next one
    this.$('.wx.lang').addEventListener('click', (ev) => {
      ev.stopPropagation();
      const picked = (ev.target as HTMLElement).closest<HTMLElement>('[data-lang]')?.dataset.lang as Lang | undefined;
      setLang(picked ?? LANGS[(LANGS.findIndex((l) => l.id === lang) + 1) % LANGS.length].id);
    });
    this.renderDeck();
    this.renderWeather();

    const tps = source.threads().filter((t) => t.status === 'running').reduce((s, t) => s + t.tps, 0);
    this.hist = this.hist.map((_, i) => tps * (0.45 + 0.35 * Math.sin(i * 0.4) ** 2 + Math.random() * 0.25));
    const now = clock.now().valueOf();
    this.ticker = source
      .threads()
      .filter((t) => !t.parentId)
      .slice(0, 4)
      .map((t, i) => ({ t: hhmm(new Date(now - (i + 1) * 6.5 * 60000)), text: S.starts(t.name, t.title), kind: 'add' }));
    this.$('.ticker ol').innerHTML = this.ticker.map((e) => `<li class="k-${e.kind}"><time>${e.t}</time>${esc(e.text)}</li>`).join('');
  }

  ytHost() {
    return this.$('.yt');
  }

  renderWeather() {
    const w = this.weather;
    this.$('.wx').innerHTML = `<b>${WEATHER_ICON[w.state]}</b> ${esc(w.label())} <em>${esc(S.weather(MODE_LABEL[w.mode]))}</em>`;
  }

  renderDeck() {
    const p = this.player;
    const cur = p.current;
    const deck = this.$('.deck');
    deck.classList.toggle('playing', p.playing);
    deck.classList.toggle('rave', p.playing && cur.kind === 'youtube');
    this.root.querySelectorAll<HTMLElement>('.tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === this.tab));
    this.$('.nlikes').textContent = String(p.likes.size);
    this.$('.title').textContent = cur.title;
    this.$('.artist').textContent = cur.artist;
    this.$('.bpm').innerHTML = `<b>${cur.bpm}</b> BPM · ${esc(cur.mood)}`;
    const liked = p.likes.has(cur.id);
    const heart = this.$('.heart');
    heart.textContent = liked ? '♥' : '♡';
    heart.classList.toggle('on', liked);
    this.$('[data-c="play"]').textContent = p.playing ? '❚❚' : '▶';
    this.$('[data-c="sounds"]').classList.toggle('on', this.sfx.sounds);
    const vid = this.$('[data-c="video"]');
    vid.style.display = cur.kind === 'youtube' ? '' : 'none';
    vid.classList.toggle('on', p.showVideo);
    const yt = this.$('.yt');
    if (!yt.querySelector('.yt-close') && yt.classList.contains('on')) yt.insertAdjacentHTML('beforeend', `<button class="yt-close" title="${S.hideVideo}">×</button>`);

    let list: Item[];
    if (this.tab === 'sets') list = SETS;
    else if (this.tab === 'likes') list = [...RADIO, ...SETS].filter((i) => p.likes.has(i.id));
    else {
      const i = Math.max(0, RADIO.findIndex((x) => x.id === cur.id));
      list = Array.from({ length: Math.min(6, RADIO.length) }, (_, k) => RADIO[(i + k - 1 + RADIO.length) % RADIO.length]);
    }
    const ol = this.$('.sets');
    ol.innerHTML = list.length
      ? list
          .map(
            (i) => `<li data-id="${i.id}" class="${i.id === cur.id ? 'on' : ''}"><span class="t">${esc(i.title)}</span><em>${esc(i.kind === 'youtube' ? i.artist : i.mood)}</em><button class="li-heart${p.likes.has(i.id) ? ' on' : ''}">${p.likes.has(i.id) ? '♥' : '♡'}</button></li>`,
          )
          .join('') +
        (p.blocked && this.tab === 'sets'
          ? `<li class="note blocked">${S.embedBlocked} · <a href="https://www.youtube.com/watch?v=${p.blocked.item.videoId}&t=${p.blocked.item.start ?? 0}s" target="_blank" rel="noopener">${S.openOnYouTube}</a></li>`
          : this.tab === 'sets'
            ? `<li class="note">${S.moreSets}</li>`
            : '')
      : `<li class="note">${S.noLikes}</li>`;
  }

  private log(text: string, kind: string) {
    this.ticker.unshift({ t: hhmm(this.clock.now()), text, kind });
    this.ticker.length = Math.min(this.ticker.length, 6);
    this.$('.ticker ol').innerHTML = this.ticker.map((e) => `<li class="k-${e.kind}"><time>${e.t}</time>${esc(e.text)}</li>`).join('');
  }

  private onEvent(e: SourceEvent) {
    if (e.type === 'add') {
      this.names.set(e.thread.id, e.thread);
      const t = e.thread;
      if (t.parentId) this.log(S.helps(t.name, this.names.get(t.parentId)?.name ?? '?'), 'intern');
      else this.log(S.starts(t.name, t.title), 'add');
      return;
    }
    const t = this.names.get(e.id);
    if (!t) return;
    if (e.type === 'status') {
      if (e.to === 'waiting') this.log(S.waitsOnYou(t.name), 'waiting');
      else if (e.to === 'failed') this.log(S.failedIn(t.name, t.title), 'failed');
      else if (e.to === 'completed') this.log(S.isDone(t.name), 'completed');
    } else if (e.type === 'settle') {
      if (!t.parentId) this.log(S.clocksOff(t.name), 'settle');
    } else if (e.type === 'compact') this.log(S.compacts(t.name), 'compact');
  }

  toast(text: string) {
    const el = this.$('.toast');
    el.textContent = text;
    el.classList.remove('show');
    void el.offsetWidth;
    el.classList.add('show');
  }

  update(dt: number, now: Date, world: World, source: AgentSource, cycle: DayCycle) {
    const pr = this.scrubAt ?? this.player.progress();
    this.$('.prog i').style.width = `${(pr * 100).toFixed(2)}%`;
    const dur = this.player.duration();
    this.$('.now-t').textContent = clockOf(pr * dur);
    this.$('.dur-t').textContent = clockOf(dur);
    if (this.weather.label() !== this.lastWx) {
      this.lastWx = this.weather.label();
      this.renderWeather();
    }
    this.$('.hint').style.display = this.sfx.ready ? 'none' : '';
    void dt;
    this.$('.time').textContent = hhmm(now);
    const rate = this.clock.rate;
    const offset = Math.abs(now.valueOf() - Date.now()) > 90_000 || rate !== 1;
    this.$('.date').innerHTML = `${S.dateLine(S.weekdays[now.getDay()], now.getDate(), S.months[now.getMonth()])}${offset ? ` · <b class="warp">${rate !== 1 ? `${rate}× ` : ''}${S.timeTravel}</b>` : ''}`;

    const rise = cycle.sunrise, set = cycle.sunset;
    if (rise && set) {
      const f = (now.valueOf() - rise.valueOf()) / (set.valueOf() - rise.valueOf());
      const sunUp = f >= 0 && f <= 1;
      const k = Math.min(1, Math.max(0, f));
      const dot = this.$('.sun .arc i');
      dot.style.left = `${k * 100}%`;
      dot.style.bottom = `${Math.sin(k * Math.PI) * 100}%`;
      dot.className = sunUp ? 'up' : 'down';
      const left = sunUp ? set.valueOf() - now.valueOf() : 0;
      const tail = sunUp ? S.lightLeft(Math.floor(left / 3.6e6), Math.floor((left % 3.6e6) / 6e4)) : S.night;
      this.$('.sun .times').innerHTML = `↑ ${hhmm(rise)} &nbsp;↓ ${hhmm(set)}<br><em>${tail}</em>`;
    }

    const c = world.counts();
    const crew = (n: number, cls: string) => Array.from({ length: n }, () => `<b class="mini ${cls}"></b>`).join('');
    this.$('.crew').innerHTML = `
      <div class="row"><span class="figs">${crew(c.running, 'running')}</span><span>${S.typing(c.running)}</span></div>
      <div class="row"><span class="figs">${crew(c.waiting, 'waiting')}</span><span>${S.waiting(c.waiting)}</span></div>
      <div class="row"><span class="figs">${crew(c.idle, 'idle')}</span><span>${S.onBreak(c.idle)}${c.away ? ` · ${S.out(c.away)}` : ''}</span></div>
      <div class="row"><span class="figs">${crew(c.failed, 'failed')}${crew(c.completed, 'completed')}</span><span>${S.crashedDone(c.failed, c.completed)}</span></div>`;

    const tot = source.totals();
    this.$('.receipt dl').innerHTML = `
      <dt>Runs</dt><dd>${tot.runs}</dd>
      <dt>Tokens</dt><dd>${num(tot.tokens / 1e6, 2)} M</dd>
      <dt>${S.cost}</dt><dd>${usd(tot.cost)}</dd>`;
    const threads = source.threads();
    const teamCost = TEAMS.map((t, ti) => ({ name: t.name, color: t.color, c: threads.filter((x) => x.team === ti).reduce((s, x) => s + x.cost, 0) })).filter((t) => t.name);
    const maxTeam = Math.max(0.01, ...teamCost.map((t) => t.c));
    this.$('.receipt .teams').innerHTML = teamCost.map((t) => `<div><span>${esc(t.name)}</span><i style="width:${Math.round((t.c / maxTeam) * 100)}%;background:${t.color}"></i></div>`).join('');
    this.$('.receipt .total').textContent = S.flatWhites(Math.max(0, Math.round(tot.cost / 0.4)));

    const tps = threads.filter((t) => t.status === 'running').reduce((s, t) => s + t.tps, 0);
    this.histT += dt;
    if (this.histT > 5) {
      this.histT = 0;
      this.hist.shift();
      this.hist.push(tps);
    }
    const shown = [...this.hist.slice(0, -1), tps];
    const max = Math.max(50, ...shown);
    this.root.querySelectorAll<HTMLElement>('.pulse .bars i').forEach((b, i) => {
      b.style.height = `${Math.max(2, Math.round((shown[i] / max) * 100))}%`;
      b.classList.toggle('now', i >= shown.length - 2);
    });
    this.$('.pulse .live').innerHTML = S.pulseNow(num(Math.round(tps)), tot.queued);

  }

  /** Called every frame: the EQ follows the beat. */
  pulse(beat: number, frac: number) {
    const on = this.player.playing;
    const k = Math.pow(1 - frac, 2);
    const e = this.player.energy;
    this.root.querySelectorAll<HTMLElement>('.eq i').forEach((b, i) => {
      const wobble = Math.abs(Math.sin(beat * 0.9 + i * 1.7)) * 0.5 + Math.abs(Math.sin(beat * 0.37 + i * 0.6)) * 0.5;
      const low = i < 4 ? k : k * 0.5;
      const v = on ? 0.12 + 0.88 * Math.min(1, wobble * (0.45 + 0.4 * e) + low * (0.35 + 0.4 * e)) : 0.08;
      b.style.height = `${Math.round(v * 100)}%`;
    });
  }
}

/** HTML name tags pinned to 3D heads; synced every frame, rebuilt only when their content changes. */
export class Tags {
  private root = document.getElementById('tags')!;
  private els = new Map<string, { el: HTMLElement; key: string; w: number; h: number; off: number }>();
  private v = new THREE.Vector3();
  last: { a: Anchor; x: number; y: number }[] = [];

  /** Full plates for everybody, or quiet ones that only speak up when it matters. */
  setMode(mode: 'full' | 'quiet') {
    this.mode = mode;
  }

  constructor(private mode: 'full' | 'quiet' = 'full', onOpen: (id: string) => void) {
    this.root.addEventListener('click', (ev) => {
      const el = (ev.target as HTMLElement).closest<HTMLElement>('.tag');
      if (el?.dataset.id) {
        ev.stopPropagation();
        onOpen(el.dataset.id);
      }
    });
  }

  update(anchors: Anchor[], camera: THREE.Camera, w: number, h: number) {
    const seen = new Set<string>();
    this.last = [];
    const placed: { rec: { el: HTMLElement; w: number; h: number; off: number }; x: number; y: number; z: number; hidden: boolean }[] = [];
    for (const a of anchors) {
      seen.add(a.id);
      let rec = this.els.get(a.id);
      if (!rec) {
        const el = document.createElement('div');
        el.dataset.id = a.id;
        this.root.appendChild(el);
        rec = { el, key: '', w: 80, h: 22, off: 0 };
        this.els.set(a.id, rec);
      }
      const loud = this.mode === 'full' || a.status === 'boss' || a.status === 'waiting' || a.status === 'failed';
      const energy = a.tps > 0 && !a.doing ? Math.min(100, Math.round(a.tps / 2.1)) : -1;
      const doing = a.doing || STATUS_LABEL[a.status] || '';
      const key = `${a.status}|${doing}|${a.bubble ?? ''}|${a.bubbleKind ?? ''}|${energy >= 0 ? Math.round(energy / 10) : -1}|${loud}|${a.hidden}`;
      if (key !== rec.key) {
        rec.key = key;
        rec.el.className = `tag s-${a.status}${a.intern ? ' intern' : ''}${loud ? '' : ' quiet'}${a.hidden ? ' hidden' : ''}`;
        rec.el.title = a.sub;
        rec.el.innerHTML = loud
          ? `${a.bubble ? `<div class="bubble${a.bubbleKind ? ` b-${a.bubbleKind}` : ''}">${esc(a.bubble)}</div>` : ''}<div class="plate"><span class="dot"></span><strong>${esc(a.name)}</strong>${doing ? `<span class="doing">${esc(doing)}</span>` : ''}${energy >= 0 ? `<i class="energy"><b style="width:${energy}%"></b></i>` : ''}</div>`
          : `<div class="plate"><span class="dot"></span><strong>${esc(a.name)}</strong></div>`;
        const plate = rec.el.querySelector<HTMLElement>('.plate');
        rec.w = plate?.offsetWidth ?? 80;
        rec.h = (plate?.offsetHeight ?? 20) + 2;
      }
      this.v.copy(a.pos).project(camera);
      const x = (this.v.x * 0.5 + 0.5) * w;
      const y = (-this.v.y * 0.5 + 0.5) * h;
      if (!a.hidden) this.last.push({ a, x, y });
      placed.push({ rec, x, y, z: this.v.z, hidden: a.hidden });
    }

    // nudge overlapping plates upwards, front-most first, eased so walking people don't jitter
    placed.sort((p, q) => q.y - p.y);
    const boxes: { x0: number; x1: number; y0: number; y1: number }[] = [];
    for (const p of placed) {
      if (p.hidden) continue;
      const { rec } = p;
      const x0 = p.x - rec.w / 2, x1 = p.x + rec.w / 2;
      let off = 0;
      for (let iter = 0; iter < 6; iter++) {
        const y1 = p.y - off, y0 = y1 - rec.h;
        const hit = boxes.find((b) => x0 < b.x1 && x1 > b.x0 && y0 < b.y1 && y1 > b.y0);
        if (!hit) break;
        off = p.y - hit.y0 + 1;
        if (off > 70) break;
      }
      off = Math.min(off, 70);
      rec.off += (off - rec.off) * 0.25;
      const y1 = p.y - rec.off;
      boxes.push({ x0, x1, y0: y1 - rec.h, y1 });
    }
    for (const p of placed) {
      p.rec.el.style.transform = `translate(${Math.round(p.x)}px, ${Math.round(p.y - p.rec.off)}px)`;
      p.rec.el.style.zIndex = String(Math.round((1 - p.z) * 1000));
    }
    for (const [id, rec] of this.els) {
      if (!seen.has(id)) {
        rec.el.remove();
        this.els.delete(id);
      }
    }
  }

  /** Closest visible person to a screen point, for clicking on the figure itself. */
  pick(x: number, y: number) {
    let best: Anchor | undefined;
    let bd = 60;
    for (const p of this.last) {
      const d = Math.hypot(p.x - x, p.y + 40 - y);
      if (d < bd) {
        bd = d;
        best = p.a;
      }
    }
    return best;
  }
}

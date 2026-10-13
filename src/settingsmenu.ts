import { LANGS } from './i18n';
import { S } from './i18n/settings';
import { S as HUD } from './i18n/hud';
import { LIGHT_SHOW_SETTINGS, PIXEL_SETTINGS, RELOADS, SEASON_SETTINGS, TAG_SETTINGS, WEATHER_SETTINGS, settings, type SettingKey, type Settings, type ThemeId } from './settings';
import type { SeasonKind } from './seasons';
import type { Weather } from './weather';

export interface MenuDeps {
  themes: { id: ThemeId; label: string }[];
  /** the DJ booth, so play/pause sits next to the volume */
  music: { playing(): boolean; toggle(): void; onChange(fn: () => void): void };
  weather: Weather;
  /** the season the office is decorated for right now */
  season(): SeasonKind;
  /** a click sound and the audio unlock */
  blip(): void;
}

type BoolKey = { [K in SettingKey]: Settings[K] extends boolean ? K : never }[SettingKey];
type Text = { label: string; desc: string };

interface Row {
  id: string;
  text: Text;
  /** label and control side by side (switches) instead of stacked */
  inline: boolean;
  key?: SettingKey;
  /** the control, wired up; `labelId` is the element that names it */
  build(labelId: string): Node[];
  /** brings the control in line with the current value */
  sync(): void;
}

/** a DOM element from a tag, attributes and children; texts are set as text, never parsed */
function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string | boolean> = {}, ...kids: (Node | string)[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === false) continue;
    el.setAttribute(k, v === true ? '' : v);
  }
  el.append(...kids);
  return el;
}

function toggleRow(id: string, text: Text, get: () => boolean, set: (v: boolean) => void, state?: () => string, key?: SettingKey): Row {
  const word = h('span');
  const b = h('button', { class: 'st-switch', role: 'switch' }, h('i'), word);
  b.addEventListener('click', () => set(!get()));
  return {
    id,
    text,
    inline: true,
    key,
    build: (l) => {
      b.setAttribute('aria-labelledby', l);
      return [b];
    },
    sync: () => {
      const on = get();
      b.setAttribute('aria-checked', String(on));
      word.textContent = state ? state() : on ? S.on : S.off;
    },
  };
}
const flag = (key: BoolKey, text: Text) => toggleRow(key, text, () => settings.get(key), (v) => settings.set(key, v), undefined, key);

/** one-of-many: a radio group drawn as a row of pixel buttons */
function segRow<K extends SettingKey>(key: K, text: Text, options: { v: Settings[K]; label: string }[], note?: () => string, cols = 0): Row {
  const buttons = options.map((o) => {
    const b = h('button', { role: 'radio' }, o.label);
    b.addEventListener('click', () => settings.set(key, o.v));
    return b;
  });
  // choices that reload the page are only taken on Enter or Space, not while walking through them with the arrows
  const group = h('div', { class: `st-seg${cols ? ` c${cols}` : ''}`, role: 'radiogroup', 'data-lazy': RELOADS.includes(key) }, ...buttons);
  const small = note ? h('small', { class: 'st-note' }) : null;
  return {
    id: key,
    text,
    inline: false,
    key,
    build: (l) => {
      group.setAttribute('aria-labelledby', l);
      return small ? [group, small] : [group];
    },
    sync: () => {
      const cur = settings.get(key);
      const at = options.findIndex((o) => o.v === cur);
      buttons.forEach((b, i) => {
        b.setAttribute('aria-checked', String(i === at));
        // a value outside the options (e.g. ?px=2.5) still leaves the group reachable by Tab
        b.tabIndex = i === Math.max(0, at) ? 0 : -1;
      });
      if (small && note) small.textContent = note();
    },
  };
}

function sliderRow(key: 'soundVolume' | 'musicVolume', text: Text): Row {
  const input = h('input', { type: 'range', min: '0', max: '100', step: '5' });
  const out = h('output');
  input.addEventListener('input', () => settings.set(key, Number(input.value) / 100));
  return {
    id: key,
    text,
    inline: false,
    key,
    build: (l) => {
      input.setAttribute('aria-labelledby', l);
      return [h('div', { class: 'st-slider' }, input, out)];
    },
    sync: () => {
      const v = Math.round(settings.get(key) * 100);
      if (Number(input.value) !== v) input.value = String(v);
      input.style.setProperty('--v', `${v}%`);
      out.textContent = String(v);
    },
  };
}

function locationRow(): Row {
  const fmt = (v: number) => String(Math.round(v * 100) / 100);
  const note = h('small', { class: 'st-note', 'aria-live': 'polite' });
  const field = (k: 'lat' | 'lon', label: string, lim: number) => {
    const input = h('input', { type: 'number', min: String(-lim), max: String(lim), step: '0.01', inputmode: 'decimal' });
    input.addEventListener('change', () => {
      const v = Number(input.value);
      if (input.value.trim() !== '' && Number.isFinite(v) && Math.abs(v) <= lim) settings.set(k, v);
      input.value = fmt(settings.get(k));
    });
    return { k, input, el: h('label', {}, h('span', {}, label), input) };
  };
  const fields = [field('lat', S.lat, 90), field('lon', S.lon, 180)];
  const locate = h('button', { class: 'st-btn' }, S.locate);
  // the browser is only asked for the position on this click, never on its own
  locate.addEventListener('click', () => {
    if (!navigator.geolocation) return void (note.textContent = S.locateFailed);
    note.textContent = S.locating;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        settings.set('lat', Math.round(pos.coords.latitude * 100) / 100);
        settings.set('lon', Math.round(pos.coords.longitude * 100) / 100);
        note.textContent = '';
      },
      (err) => (note.textContent = err.code === err.PERMISSION_DENIED ? S.locateDenied : S.locateFailed),
      { maximumAge: 600_000, timeout: 15_000 },
    );
  });
  return {
    id: 'location',
    text: S.location,
    inline: false,
    build: () => [h('div', { class: 'st-loc' }, ...fields.map((f) => f.el), locate), note],
    sync: () => {
      for (const f of fields) if (document.activeElement !== f.input) f.input.value = fmt(settings.get(f.k));
    },
  };
}

/** The settings menu: a pixel control panel over the office. Every control is a real button or input. */
export class SettingsMenu {
  isOpen = false;
  private root = h('div', { id: 'settings' });
  private body: HTMLElement;
  private rows: { row: Row; url: HTMLElement }[] = [];
  private timer = 0;
  private returnTo: HTMLElement | null = null;

  constructor(private deps: MenuDeps) {
    const w = deps.weather;
    const weatherNow = () => {
      const sky = HUD.sky[w.state];
      if (w.feed === 'live') return S.weatherNow.live(sky, Math.max(0, Math.round((Date.now() - w.fetchedAt) / 60000)));
      if (w.feed === 'loading') return S.weatherNow.loading;
      return w.feed === 'fallback' ? S.weatherNow.fallback(sky) : S.weatherNow.off(sky);
    };
    const sections: { title: string; rows: Row[] }[] = [
      {
        title: S.sections.general,
        rows: [
          segRow('language', S.language, LANGS.map((l) => ({ v: l.id, label: l.label }))),
          segRow('theme', S.theme, deps.themes.map((t) => ({ v: t.id, label: t.label })), undefined, 2),
          segRow('tags', S.tags, TAG_SETTINGS.map((v) => ({ v, label: S.tagsOpt[v] }))),
          segRow('pixel', S.pixel, PIXEL_SETTINGS.map((v) => ({ v: v as number, label: v ? `${v}×` : S.pixelAuto }))),
        ],
      },
      {
        title: S.sections.sound,
        rows: [
          flag('sounds', S.sounds),
          sliderRow('soundVolume', S.soundVolume),
          toggleRow('music', S.music, () => deps.music.playing(), () => deps.music.toggle(), () => (deps.music.playing() ? S.musicPlaying : S.musicPaused)),
          sliderRow('musicVolume', S.musicVolume),
        ],
      },
      {
        title: S.sections.weather,
        rows: [
          segRow('weather', S.weather, WEATHER_SETTINGS.map((v) => ({ v, label: HUD.weatherMode[v] })), weatherNow, 3),
          locationRow(),
          segRow('seasons', S.seasons, SEASON_SETTINGS.map((v) => ({ v, label: S.seasonsOpt[v] })), () => S.seasonNow[deps.season()], 3),
        ],
      },
      {
        title: S.sections.lights,
        rows: [segRow('lightShow', S.lightShow, LIGHT_SHOW_SETTINGS.map((v) => ({ v, label: S.lightShowOpt[v] }))), flag('strobe', S.strobe), flag('fog', S.fog)],
      },
      {
        title: S.sections.life,
        rows: [flag('dance', S.dance), flag('dog', S.dog), flag('cat', S.cat), flag('vacuum', S.vacuum), flag('reactions', S.reactions)],
      },
      { title: S.sections.camera, rows: [flag('director', S.director), flag('kiosk', S.kiosk)] },
    ];

    const close = h('button', { class: 'st-x', 'aria-label': S.close, title: S.close }, '×');
    close.addEventListener('click', () => this.close());
    const reset = h('button', { class: 'st-btn' }, S.reset);
    reset.addEventListener('click', () => settings.reset());
    const cols = h(
      'div',
      { class: 'st-cols' },
      ...sections.map((sec) =>
        h(
          'section',
          {},
          h('h3', {}, sec.title),
          ...sec.rows.map((row) => {
            const labelId = `st-l-${row.id}`;
            const url = h('em', { class: 'st-tag url', hidden: true }, S.fromUrl);
            this.rows.push({ row, url });
            const lbl = h('div', { class: 'st-lbl' }, h('span', { class: 'st-name', id: labelId }, row.text.label));
            if (row.key && RELOADS.includes(row.key)) lbl.append(h('em', { class: 'st-tag' }, S.reloads));
            lbl.append(url);
            if (row.text.desc) lbl.append(h('small', {}, row.text.desc));
            return h('div', { class: `st-row${row.inline ? ' inline' : ''}`, 'data-row': row.id }, lbl, h('div', { class: 'st-ctl' }, ...row.build(labelId)));
          }),
        ),
      ),
    );
    this.root.append(
      h(
        'div',
        { class: 'st-panel', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'st-title' },
        h('div', { class: 'st-bar' }, h('i'), h('span', {}, S.kicker), h('b')),
        h('header', {}, h('h2', { id: 'st-title' }, S.title), h('span', { class: 'sp' }), close),
        (this.body = h('div', { class: 'st-body' }, cols)),
        h('footer', {}, reset, h('span', { class: 'sp' }), h('small', {}, S.closeHint)),
      ),
    );
    document.body.appendChild(this.root);

    // the office below must not see drags, wheel zoom or hover picks through the overlay
    for (const ev of ['pointerdown', 'pointermove', 'pointerup', 'wheel', 'dblclick', 'contextmenu', 'click'] as const) this.root.addEventListener(ev, (e) => e.stopPropagation());
    this.root.addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
      if (t === this.root) return this.close();
      if (t.closest('button')) deps.blip();
    });
    window.addEventListener('keydown', (e) => this.key(e), true);
    settings.onAny(() => this.sync());
    deps.music.onChange(() => this.sync());
  }

  open() {
    if (this.isOpen) return;
    this.isOpen = true;
    this.returnTo = document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null;
    this.root.classList.remove('out');
    this.root.classList.add('on');
    document.body.classList.add('settings-open');
    this.sync();
    // the status lines (age of the weather report, season) tick along while the menu is up
    this.timer = window.setInterval(() => this.sync(), 1000);
    // start on the first setting, not on the close button
    (this.focusable().find((el) => this.body.contains(el)) ?? this.focusable()[0])?.focus({ preventScroll: true });
    this.body.scrollTop = 0;
  }

  close() {
    if (!this.isOpen) return;
    this.isOpen = false;
    clearInterval(this.timer);
    this.root.classList.add('out');
    document.body.classList.remove('settings-open');
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    this.returnTo?.focus({ preventScroll: true });
    setTimeout(() => {
      if (!this.isOpen) this.root.classList.remove('on', 'out');
    }, 220);
  }

  toggle() {
    if (this.isOpen) this.close();
    else this.open();
  }

  private sync() {
    if (!this.isOpen) return;
    for (const { row, url } of this.rows) {
      row.sync();
      url.hidden = !(row.key && settings.overridden(row.key));
    }
  }

  private focusable() {
    return [...this.root.querySelectorAll<HTMLElement>('button, input')].filter((el) => el.tabIndex >= 0 && el.offsetParent !== null);
  }

  /**
   * All keys of the menu are handled here, in the capture phase: the office keys (s, w, m …) stay quiet while it is
   * open, and typing a latitude does not switch the weather.
   */
  private key(e: KeyboardEvent) {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const typing = e.target instanceof HTMLInputElement && e.target.type !== 'range';
    const hotkey = (e.key === ',' || e.key === 'o') && !typing;
    if (!this.isOpen) {
      if (hotkey && !document.body.classList.contains('costs-open')) {
        e.stopImmediatePropagation();
        e.preventDefault();
        this.open();
      }
      return;
    }
    e.stopImmediatePropagation();
    if (e.key === 'Escape' || hotkey) {
      e.preventDefault();
      return this.close();
    }
    const at = e.target as HTMLElement;
    if (e.key === 'Tab') {
      // focus stays inside the dialog
      const list = this.focusable();
      e.preventDefault();
      list[(list.indexOf(at) + (e.shiftKey ? -1 : 1) + list.length) % list.length]?.focus();
      return;
    }
    const radio = at instanceof HTMLElement ? at.closest<HTMLElement>('.st-seg [role="radio"]') : null;
    const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (radio && step) {
      e.preventDefault();
      const all = [...radio.parentElement!.querySelectorAll<HTMLElement>('[role="radio"]')];
      const next = all[(all.indexOf(radio) + step + all.length) % all.length];
      if (!radio.parentElement!.hasAttribute('data-lazy')) next.click();
      next.focus();
    }
  }
}

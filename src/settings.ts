import { LANGS, lang, setLang, type Lang } from './i18n';

/**
 * User settings: one typed store, persisted in localStorage under `office.settings`.
 *
 *   import { settings } from './settings';
 *   settings.get('lightShow');                       // current value
 *   settings.on('lightShow', (v) => show.setMode(v)); // called on every change, returns an unsubscribe
 *   settings.set('lightShow', 'soft');                // persists and notifies
 *
 * URL parameters (?theme=, ?lat=, ?weather=, ?director=1 …) win over stored values for that page view and are not
 * written back. Changing such a setting in the menu drops the override again.
 *
 * Phones start in a cinema mode (no panels, director camera, quiet name tags). That is a default for the device, not a
 * stored choice: a URL parameter like ?kiosk=0 or a value from the menu still wins.
 */

export const THEME_IDS = ['loft', 'campus', 'soma', 'boiler'] as const;
export type ThemeId = (typeof THEME_IDS)[number];
export const WEATHER_SETTINGS = ['real', 'sim', 'clear', 'rain', 'storm', 'snow'] as const;
export type WeatherSetting = (typeof WEATHER_SETTINGS)[number];
export const SEASON_SETTINGS = ['auto', 'off', 'halloween', 'winter', 'christmas'] as const;
export type SeasonSetting = (typeof SEASON_SETTINGS)[number];
export const LIGHT_SHOW_SETTINGS = ['off', 'soft', 'full'] as const;
export type LightShowSetting = (typeof LIGHT_SHOW_SETTINGS)[number];
export const TAG_SETTINGS = ['auto', 'full', 'quiet'] as const;
export type TagSetting = (typeof TAG_SETTINGS)[number];
/** art pixel size in CSS pixels; 0 picks one for the screen */
export const PIXEL_SETTINGS = [0, 1, 1.5, 2, 3] as const;

export interface Settings {
  /** UI language; changing it reloads the page */
  language: Lang;
  /** office style; changing it reloads the page */
  theme: ThemeId;
  /** sound effects (typing, doors, rain …) */
  sounds: boolean;
  /** 0..1 */
  soundVolume: number;
  /** 0..1, radio and YouTube sets */
  musicVolume: number;
  /** 'real' asks open-meteo.com for the weather at lat/lon, 'sim' drifts on its own, the rest pins a state */
  weather: WeatherSetting;
  lat: number;
  lon: number;
  /** seasonal decoration; 'auto' follows the calendar and the hemisphere */
  seasons: SeasonSetting;
  lightShow: LightShowSetting;
  /** hard flashes in the light show; off by default with prefers-reduced-motion */
  strobe: boolean;
  fog: boolean;
  /** agents get up and dance on drops */
  dance: boolean;
  dog: boolean;
  cat: boolean;
  vacuum: boolean;
  /** confetti, gong and warning light when threads finish or fail */
  reactions: boolean;
  /** the camera moves by itself */
  director: boolean;
  /** hide the HUD panels (second screen) */
  kiosk: boolean;
  /** name tags: 'auto' follows the theme */
  tags: TagSetting;
  /** art pixel size, 0 = automatic */
  pixel: number;
}
export type SettingKey = keyof Settings;

const reducedMotion = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
/** a phone or another small touch screen: no room for the panels next to the office */
export const phone = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches && Math.min(screen.width, screen.height) < 600;

export const DEFAULTS: Readonly<Settings> = {
  language: lang,
  theme: 'campus',
  sounds: true,
  soundVolume: 0.7,
  musicVolume: 0.7,
  weather: 'real',
  lat: 48.21,
  lon: 16.37,
  seasons: 'auto',
  lightShow: 'full',
  strobe: !reducedMotion,
  fog: true,
  dance: true,
  dog: true,
  cat: true,
  vacuum: true,
  reactions: true,
  director: false,
  kiosk: false,
  tags: 'auto',
  pixel: 0,
};
export const SETTING_KEYS = Object.keys(DEFAULTS) as SettingKey[];
/** settings that only take effect after a reload; `set` reloads the page for these */
export const RELOADS: readonly SettingKey[] = ['language', 'theme'];

const KEY = 'office.settings';
const oneOf = <T extends string | number>(list: readonly T[]) => (v: unknown): v is T => list.includes(v as T);
const bool = (v: unknown): v is boolean => typeof v === 'boolean';
const range = (lo: number, hi: number) => (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;

const VALID: { [K in SettingKey]: (v: unknown) => v is Settings[K] } = {
  language: oneOf(LANGS.map((l) => l.id)),
  theme: oneOf(THEME_IDS),
  sounds: bool,
  soundVolume: range(0, 1),
  musicVolume: range(0, 1),
  weather: oneOf(WEATHER_SETTINGS),
  lat: range(-90, 90),
  lon: range(-180, 180),
  seasons: oneOf(SEASON_SETTINGS),
  lightShow: oneOf(LIGHT_SHOW_SETTINGS),
  strobe: bool,
  fog: bool,
  dance: bool,
  dog: bool,
  cat: bool,
  vacuum: bool,
  reactions: bool,
  director: bool,
  kiosk: bool,
  tags: oneOf(TAG_SETTINGS),
  pixel: range(0, 8),
};

/** URL parameter of each setting and how to read it; these win for one page view */
const flag = (s: string) => (s === '' || s === '1' || s === 'true' || s === 'on' ? true : s === '0' || s === 'false' || s === 'off' ? false : undefined);
const URL_PARAMS: { [K in SettingKey]?: { name: string; parse: (s: string) => unknown } } = {
  theme: { name: 'theme', parse: (s) => s },
  lat: { name: 'lat', parse: Number },
  lon: { name: 'lon', parse: Number },
  // 'auto' is what the simulation was called before real weather existed
  weather: { name: 'weather', parse: (s) => (s === 'auto' ? 'sim' : s) },
  seasons: { name: 'season', parse: (s) => (s === 'none' ? 'off' : s) },
  lightShow: { name: 'lights', parse: (s) => s },
  director: { name: 'director', parse: flag },
  kiosk: { name: 'kiosk', parse: flag },
  tags: { name: 'tags', parse: (s) => s },
  pixel: { name: 'px', parse: Number },
};

type Stored = { [K in SettingKey]?: Settings[K] };
/** what this device starts with in place of DEFAULTS; never stored */
const DEVICE: Stored = phone ? { kiosk: true, director: true, tags: 'quiet' } : {};
type Listener<K extends SettingKey> = (value: Settings[K], key: K) => void;

function load(): Stored {
  const out: Stored = {};
  const take = <K extends SettingKey>(k: K, v: unknown) => {
    if (VALID[k](v)) out[k] = v;
  };
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Record<string, unknown>;
    for (const k of SETTING_KEYS) if (k in raw) take(k, raw[k]);
  } catch {
    // unreadable settings: start from the defaults
  }
  // values that were stored on their own before this store existed
  if (out.weather === undefined) {
    const old = localStorage.getItem('office.weather');
    if (old === 'clear' || old === 'rain' || old === 'storm') out.weather = old;
  }
  const sounds = localStorage.getItem('office.sounds');
  if (sounds !== null) out.sounds = sounds !== '0';
  // the language keeps living in `office.lang` (src/i18n reads it before anything else runs)
  delete out.language;
  return out;
}

function overrides(): Stored {
  const out: Stored = {};
  const q = new URLSearchParams(location.search);
  const take = <K extends SettingKey>(k: K, v: unknown) => {
    if (VALID[k](v)) out[k] = v;
  };
  for (const k of SETTING_KEYS) {
    const p = URL_PARAMS[k];
    const raw = p ? q.get(p.name) : null;
    if (p && raw !== null) take(k, p.parse(raw));
  }
  return out;
}

class SettingsStore {
  private stored = load();
  private url = overrides();
  private fns = new Map<SettingKey, Set<Listener<SettingKey>>>();
  private anyFns = new Set<(key: SettingKey) => void>();

  get<K extends SettingKey>(key: K): Settings[K] {
    if (key === 'language') return lang as Settings[K];
    return (this.url[key] ?? this.stored[key] ?? DEVICE[key] ?? DEFAULTS[key]) as Settings[K];
  }

  /** true while a URL parameter decides this setting */
  overridden(key: SettingKey) {
    return this.url[key] !== undefined;
  }

  /** Persists the value and tells the listeners. `language` and `theme` reload the page. */
  set<K extends SettingKey>(key: K, value: Settings[K]) {
    if (!VALID[key](value)) return;
    if (key === 'language') {
      if (value !== lang) setLang(value as Lang);
      return;
    }
    const before = this.get(key);
    delete this.url[key];
    this.stored[key] = value;
    this.save();
    if (key === 'sounds') localStorage.setItem('office.sounds', value ? '1' : '0');
    if (value === before) return;
    if (RELOADS.includes(key)) return this.reload(key);
    this.emit(key);
  }

  /** Calls `fn` on every change of `key`; returns a function that stops it. */
  on<K extends SettingKey>(key: K, fn: Listener<K>): () => void {
    let set = this.fns.get(key);
    if (!set) this.fns.set(key, (set = new Set()));
    set.add(fn as unknown as Listener<SettingKey>);
    return () => void set.delete(fn as unknown as Listener<SettingKey>);
  }

  /** Calls `fn` after any setting changed. */
  onAny(fn: (key: SettingKey) => void): () => void {
    this.anyFns.add(fn);
    return () => void this.anyFns.delete(fn);
  }

  /** Back to the defaults of this device (the language stays). */
  reset() {
    const theme = this.get('theme');
    const before = { ...this.all() };
    this.stored = {};
    this.url = {};
    localStorage.removeItem(KEY);
    localStorage.removeItem('office.weather');
    localStorage.setItem('office.sounds', '1');
    if (theme !== DEFAULTS.theme) return this.reload('theme');
    for (const k of SETTING_KEYS) if (before[k] !== this.get(k)) this.emit(k);
  }

  all(): Settings {
    return Object.fromEntries(SETTING_KEYS.map((k) => [k, this.get(k)])) as unknown as Settings;
  }

  private emit(key: SettingKey) {
    const v = this.get(key);
    for (const f of this.fns.get(key) ?? []) f(v, key);
    for (const f of this.anyFns) f(key);
  }

  private save() {
    localStorage.setItem(KEY, JSON.stringify(this.stored));
  }

  /** reload without the URL parameter that would otherwise win again */
  private reload(key: SettingKey) {
    const url = new URL(location.href);
    const p = URL_PARAMS[key];
    if (p) url.searchParams.delete(p.name);
    location.replace(url);
  }
}

export const settings = new SettingsStore();

import { S } from './i18n/hud';
import { WEATHER_SETTINGS, type WeatherSetting } from './settings';

/** 'real' follows open-meteo.com, 'sim' drifts on its own, the rest pins a state */
export type WeatherMode = WeatherSetting;
export type WeatherState = 'clear' | 'cloudy' | 'rain' | 'storm' | 'snow';
/** what the HUD can say about real weather: not asked for, still asking, live, or not reachable (simulating) */
export type WeatherFeed = 'off' | 'loading' | 'live' | 'fallback';

interface Levels {
  cloud: number;
  rain: number;
  snow: number;
}

const TARGET: Record<WeatherState, Levels> = {
  clear: { cloud: 0, rain: 0, snow: 0 },
  cloudy: { cloud: 0.55, rain: 0, snow: 0 },
  rain: { cloud: 0.85, rain: 0.7, snow: 0 },
  storm: { cloud: 1, rain: 1, snow: 0 },
  snow: { cloud: 0.8, rain: 0, snow: 0.7 },
};

const LABEL: Record<WeatherState, string> = S.sky;
export const MODE_LABEL: Record<WeatherMode, string> = S.weatherMode;
export const WEATHER_ICON: Record<WeatherState, string> = { clear: '☀', cloudy: '☁', rain: '☂', storm: '⚡', snow: '❄' };

const REFRESH_MS = 10 * 60_000;
const RETRY_MS = 2 * 60_000;

/** WMO weather codes as Open-Meteo reports them → how hard it rains or snows, 0..1 */
const RAIN_CODE: Record<number, number> = { 51: 0.25, 53: 0.35, 55: 0.45, 56: 0.3, 57: 0.45, 61: 0.5, 63: 0.7, 65: 0.95, 66: 0.5, 67: 0.9, 80: 0.5, 81: 0.75, 82: 1 };
const SNOW_CODE: Record<number, number> = { 71: 0.35, 73: 0.65, 75: 1, 77: 0.3, 85: 0.6, 86: 1 };

/** Open-Meteo's `current` block → the office's weather state and levels. */
export function fromOpenMeteo(cur: { weather_code?: number; cloud_cover?: number }): { state: WeatherState; levels: Levels } {
  const code = Number(cur.weather_code ?? 0);
  const cc = Math.min(1, Math.max(0, Number(cur.cloud_cover ?? 0) / 100));
  if (code >= 95) return { state: 'storm', levels: { cloud: 1, rain: 1, snow: 0 } };
  if (code in SNOW_CODE) return { state: 'snow', levels: { cloud: Math.max(0.7, cc), rain: 0, snow: SNOW_CODE[code] } };
  if (code in RAIN_CODE) return { state: 'rain', levels: { cloud: Math.max(0.75, cc), rain: RAIN_CODE[code], snow: 0 } };
  // 2 partly cloudy, 3 overcast, 45/48 fog
  if (code >= 2) return { state: 'cloudy', levels: { cloud: Math.min(0.8, Math.max(0.3, 0.25 + 0.6 * cc)), rain: 0, snow: 0 } };
  return { state: 'clear', levels: { cloud: Math.min(0.25, cc * 0.5), rain: 0, snow: 0 } };
}

/**
 * The weather outside the windows: the real one at the configured place (mode 'real', from open-meteo.com, with the
 * simulation as a fallback while that is unreachable), one that drifts on its own ('sim'), or a pinned state.
 */
export class Weather {
  mode: WeatherMode;
  state: WeatherState = 'clear';
  cloud = 0;
  rain = 0;
  /** snowfall, 0..1 */
  snow = 0;
  /** real weather: is it there? */
  feed: WeatherFeed = 'off';
  /** when the last real report arrived (ms since epoch), 0 before the first */
  fetchedAt = 0;
  /** lightning brightness, 0..1, decays quickly */
  flash = 0;
  /** seconds since the last strike */
  sinceBolt = 99;
  onBolt?: (near: number) => void;
  onChange?: (s: WeatherState) => void;
  private nextChange = 0;
  private nextBolt = 8;
  private flashes: { at: number; v: number }[] = [];
  private t = 0;
  private target: Levels;
  private nextFetch = 0;
  /** counts requests, so a late answer for an old place or mode is dropped */
  private asked = 0;
  private failures = 0;

  constructor(mode: WeatherMode, private lat: number, private lon: number) {
    this.mode = mode;
    if (mode === 'real' || mode === 'sim') {
      // start mostly clear, sometimes already cloudy or rainy; real weather replaces this with its first report
      const r = Math.random();
      this.state = mode === 'real' || r < 0.6 ? 'clear' : r < 0.85 ? 'cloudy' : 'rain';
      this.nextChange = 120 + Math.random() * 240;
      if (mode === 'real') this.feed = 'loading';
    } else this.state = mode;
    this.target = TARGET[this.state];
    this.cloud = this.target.cloud;
    this.rain = this.target.rain;
    this.snow = this.target.snow;
    window.addEventListener('online', () => (this.nextFetch = 0));
  }

  /** real weather was asked for but is not reachable: the simulation fills in */
  get simulated() {
    return this.mode === 'real' && this.feed === 'fallback';
  }

  setMode(m: WeatherMode) {
    if (m === this.mode) return;
    this.mode = m;
    this.asked++;
    this.feed = m === 'real' ? 'loading' : 'off';
    if (m === 'real') this.nextFetch = 0;
    else if (m === 'sim') this.nextChange = 60 + Math.random() * 120;
    else this.set(m);
  }

  /** the next mode in the order of the HUD button */
  nextMode(): WeatherMode {
    return WEATHER_SETTINGS[(WEATHER_SETTINGS.indexOf(this.mode) + 1) % WEATHER_SETTINGS.length];
  }

  cycleMode() {
    this.setMode(this.nextMode());
  }

  /** Real weather follows this place; asks again right away. */
  setLocation(lat: number, lon: number) {
    if (lat === this.lat && lon === this.lon) return;
    this.lat = lat;
    this.lon = lon;
    this.asked++;
    if (this.mode === 'real') {
      this.feed = 'loading';
      this.nextFetch = 0;
    }
  }

  private set(s: WeatherState, levels: Levels = TARGET[s]) {
    this.target = levels;
    if (s === this.state) return;
    this.state = s;
    this.nextBolt = 3 + Math.random() * 5;
    this.onChange?.(s);
  }

  label() {
    return this.simulated ? S.skySimulated(LABEL[this.state]) : LABEL[this.state];
  }

  /**
   * Current conditions from Open-Meteo (no key, no account). Only the coordinates leave the machine, rounded to two
   * decimals (about a kilometre). A failure of any kind hands over to the simulation until the next try.
   */
  private async fetchReal() {
    const id = ++this.asked;
    const first = this.feed === 'loading';
    try {
      const url = `https://api.open-meteo.com/v1/forecast?latitude=${this.lat.toFixed(2)}&longitude=${this.lon.toFixed(2)}&current=weather_code,cloud_cover,precipitation,rain,snowfall,is_day`;
      const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
      if (!res.ok) throw new Error(`open-meteo ${res.status}`);
      const body = (await res.json()) as { current?: { weather_code?: number; cloud_cover?: number } };
      if (!body.current || typeof body.current.weather_code !== 'number') throw new Error('open-meteo: no current weather');
      if (id !== this.asked || this.mode !== 'real') return;
      const { state, levels } = fromOpenMeteo(body.current);
      this.set(state, levels);
      this.feed = 'live';
      this.failures = 0;
      this.fetchedAt = Date.now();
      this.nextFetch = Date.now() + REFRESH_MS;
      if (first) {
        // the first report sets the scene at once instead of drifting there from the placeholder
        this.cloud = levels.cloud;
        this.rain = levels.rain;
        this.snow = levels.snow;
      }
    } catch (e) {
      if (id !== this.asked || this.mode !== 'real') return;
      if (this.feed !== 'fallback') console.warn('Real weather not available, simulating', e);
      this.feed = 'fallback';
      // one quick second try (a hiccup of the service), then every couple of minutes
      this.nextFetch = Date.now() + (this.failures++ ? RETRY_MS : 20_000);
    }
  }

  /** dt in real seconds, hour of the virtual clock for afternoon storms */
  update(dt: number, hour: number) {
    this.t += dt;
    // real weather goes by the real clock: time travel moves the sun, not the clouds
    if (this.mode === 'real' && Date.now() >= this.nextFetch) {
      this.nextFetch = Date.now() + RETRY_MS;
      void this.fetchReal();
    }
    if (this.mode === 'sim' || this.simulated) {
      this.nextChange -= dt;
      if (this.nextChange <= 0) {
        this.nextChange = 150 + Math.random() * 360;
        const afternoon = hour >= 13 && hour <= 19;
        const r = Math.random();
        const next: Record<WeatherState, WeatherState> = {
          clear: r < 0.35 ? 'cloudy' : 'clear',
          cloudy: r < 0.35 ? 'rain' : r < 0.75 ? 'clear' : 'cloudy',
          rain: r < (afternoon ? 0.4 : 0.18) ? 'storm' : r < 0.65 ? 'cloudy' : 'rain',
          storm: r < 0.7 ? 'rain' : 'storm',
          snow: 'cloudy',
        };
        this.set(next[this.state]);
      }
    }
    const tg = this.target;
    const k = Math.min(1, dt * 0.06);
    this.cloud += (tg.cloud - this.cloud) * k;
    this.rain += (tg.rain - this.rain) * k;
    this.snow += (tg.snow - this.snow) * k;

    this.sinceBolt += dt;
    if (this.state === 'storm' && this.rain > 0.6) {
      this.nextBolt -= dt;
      if (this.nextBolt <= 0) {
        this.nextBolt = 7 + Math.random() * 16;
        const near = Math.random();
        this.flashes.push({ at: this.t, v: 1 }, { at: this.t + 0.12, v: 0.4 }, { at: this.t + 0.22, v: 0.85 });
        this.sinceBolt = 0;
        setTimeout(() => this.onBolt?.(near), 300 + (1 - near) * 2500);
      }
    }
    this.flash *= Math.exp(-dt * 9);
    this.flashes = this.flashes.filter((f) => {
      if (f.at > this.t) return true;
      this.flash = Math.max(this.flash, f.v);
      return false;
    });
  }
}

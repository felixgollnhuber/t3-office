const RAD = Math.PI / 180;
const DAY_MS = 86400000;
const J1970 = 2440588;
const J2000 = 2451545;

export interface SunPos {
  /** radians above the horizon */
  altitude: number;
  /** radians, measured from south towards west (SunCalc convention) */
  azimuth: number;
}

/** Low-precision solar position (SunCalc / NOAA formulas), good to a fraction of a degree. */
export function sunPosition(date: Date, lat: number, lon: number): SunPos {
  const d = date.valueOf() / DAY_MS - 0.5 + J1970 - J2000;
  const M = RAD * (357.5291 + 0.98560028 * d);
  const C = RAD * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M));
  const L = M + C + RAD * 102.9372 + Math.PI;
  const e = RAD * 23.4397;
  const dec = Math.asin(Math.sin(e) * Math.sin(L));
  const ra = Math.atan2(Math.sin(L) * Math.cos(e), Math.cos(L));
  const phi = RAD * lat;
  const H = RAD * (280.16 + 360.9856235 * d) + RAD * lon - ra;
  return {
    altitude: Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(H)),
    azimuth: Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(phi) - Math.tan(dec) * Math.cos(phi)),
  };
}

/** Sunrise and sunset for the local calendar day of `date`, found by scanning in 2-minute steps. */
export function sunTimes(date: Date, lat: number, lon: number) {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  const horizon = -0.833 * RAD;
  let rise: Date | undefined, set: Date | undefined;
  let prev = sunPosition(start, lat, lon).altitude;
  for (let m = 2; m <= 1440; m += 2) {
    const t = new Date(start.valueOf() + m * 60000);
    const a = sunPosition(t, lat, lon).altitude;
    if (prev < horizon && a >= horizon) rise = t;
    if (prev >= horizon && a < horizon) set = t;
    prev = a;
  }
  return { rise, set };
}

/** Wall clock that follows system time, with optional offset (?time=HH:MM) and speed (?speed=N). */
export class Clock {
  private offset = 0;
  private speed = 1;
  private anchorReal = Date.now();
  private anchorVirtual = Date.now();

  constructor(params: URLSearchParams) {
    const t = params.get('time');
    if (t) {
      const [h, m] = t.split(':').map(Number);
      const d = new Date();
      d.setHours(h, m || 0, 0, 0);
      this.offset = d.valueOf() - Date.now();
    }
    this.speed = Number(params.get('speed') ?? 1) || 1;
    this.anchorVirtual = Date.now() + this.offset;
  }

  now() {
    return new Date(this.anchorVirtual + (Date.now() - this.anchorReal) * this.speed);
  }

  shift(minutes: number) {
    const n = this.now().valueOf();
    this.anchorReal = Date.now();
    this.anchorVirtual = n + minutes * 60000;
  }

  reset() {
    this.anchorReal = Date.now();
    this.anchorVirtual = Date.now();
    this.speed = 1;
  }

  setSpeed(s: number) {
    const n = this.now().valueOf();
    this.anchorReal = Date.now();
    this.anchorVirtual = n;
    this.speed = s;
  }

  get rate() {
    return this.speed;
  }
}

export const hhmm = (d: Date) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

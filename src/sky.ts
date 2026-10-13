import * as THREE from 'three';
import { sunPosition, sunTimes } from './time';
import { reseed, rand, pick } from './textures';
import type { PixelPipeline } from './pixel';

const DEG = 180 / Math.PI;

type Key = [number, string];

function keyed(keys: Key[], x: number, out = new THREE.Color()) {
  if (x <= keys[0][0]) return out.set(keys[0][1]);
  for (let i = 1; i < keys.length; i++) {
    if (x <= keys[i][0]) {
      const [x0, c0] = keys[i - 1];
      const [x1, c1] = keys[i];
      const t = (x - x0) / (x1 - x0);
      return out.set(c0).lerp(new THREE.Color(c1), t);
    }
  }
  return out.set(keys[keys.length - 1][1]);
}

function keyedN(keys: [number, number][], x: number) {
  if (x <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) {
    if (x <= keys[i][0]) {
      const [x0, y0] = keys[i - 1];
      const [x1, y1] = keys[i];
      return y0 + ((x - x0) / (x1 - x0)) * (y1 - y0);
    }
  }
  return keys[keys.length - 1][1];
}

const hex = (c: THREE.Color) => '#' + c.getHexString();

// all keyed by solar altitude in degrees
const SUN_COLOR: Key[] = [[-2, '#ff6a3a'], [2, '#ff8a4a'], [8, '#ffc08a'], [20, '#ffe6c4'], [45, '#fff6e8']];
const SUN_I: [number, number][] = [[-2, 0], [1, 0.6], [6, 1.6], [15, 2.4], [40, 2.8]];
const HEMI_SKY: Key[] = [[-18, '#1a2448'], [-8, '#2c3668'], [-3, '#8a7aa8'], [2, '#f2b9a0'], [10, '#f6e2d0'], [25, '#f2f6ff']];
const HEMI_GROUND: Key[] = [[-18, '#141828'], [-4, '#3a3048'], [4, '#a88a6e'], [20, '#c9b48e']];
const HEMI_I: [number, number][] = [[-18, 0.5], [-6, 0.55], [0, 0.85], [10, 1.15], [25, 1.3]];
const BG: Key[] = [[-18, '#141b30'], [-8, '#1c2240'], [-3, '#5a4a6a'], [1, '#e2a990'], [8, '#e8d6c0'], [20, '#cfe6e2']];
const SKY_TOP: Key[] = [[-18, '#060a1e'], [-10, '#121a40'], [-4, '#2a3470'], [0, '#5a6ab0'], [6, '#7aa6dc'], [20, '#8fcdf0']];
const SKY_HOR: Key[] = [[-18, '#10183a'], [-10, '#24305a'], [-5, '#a05a6a'], [-1, '#f08a5a'], [4, '#ffc08a'], [12, '#f0e6c8'], [25, '#dcefe9']];
const HILL: Key[] = [[-12, '#1a2a2a'], [-3, '#3a4a46'], [3, '#7a8a5a'], [15, '#8fbf7a']];
const HILL2: Key[] = [[-12, '#142220'], [-3, '#2e3e38'], [3, '#5f8a4a'], [15, '#6aa65a']];
const GREY = new THREE.Color('#aab4c4');
const GREY_BG = new THREE.Color('#9aa6b4');
const GREY_SKY = new THREE.Color('#8e99a8');
const FLASH = new THREE.Color('#eef2ff');
// a snow sky is brighter and flatter than a rain sky; snowy land is white by day and blue-grey by night
const SNOW_SKY = new THREE.Color('#a2acbb');
const SNOW_LAND: Key[] = [[-12, '#4a5674'], [-3, '#7783a0'], [3, '#d5dcea'], [15, '#f2f5fb']];
const SNOW_LAND2: Key[] = [[-12, '#414c68'], [-3, '#6a7692'], [3, '#c3ccdc'], [15, '#e2e8f2']];
const EXPOSURE: [number, number][] = [[-18, 1.18], [-4, 1.12], [4, 1.02], [20, 1.0]];

export interface Lamp {
  mat: THREE.MeshBasicMaterial;
  base: THREE.Color;
  /** brightness factor at full night */
  night: number;
  /** brightness factor during the day */
  day: number;
}

export class DayCycle {
  altitude = 0;
  azimuth = 0;
  lampLevel = 0;
  sunrise?: Date;
  sunset?: Date;
  private lastPaintAlt = 999;
  private lastTimesDay = -1;
  private viewCtx: CanvasRenderingContext2D;
  readonly lamps: Lamp[] = [];
  readonly lampLights: { light: THREE.PointLight; max: number }[] = [];
  /** snow: how hard it snows; snowCover: how much lies on the land outside (both 0..1) */
  weather = { cloud: 0, rain: 0, flash: 0, snow: 0, snowCover: 0 };
  private lastPaintT = 0;
  private lastWeatherKey = '';
  /** extra multiplier on top of the daylight, e.g. dimmed for the rave */
  ambience = 1;

  constructor(
    private scene: THREE.Scene,
    private sun: THREE.DirectionalLight,
    private hemi: THREE.HemisphereLight,
    private viewTex: THREE.CanvasTexture | undefined,
    private pipe: PixelPipeline,
    private lat: number,
    private lon: number,
  ) {
    this.viewCtx = (viewTex?.image as HTMLCanvasElement | undefined)?.getContext('2d') ?? document.createElement('canvas').getContext('2d')!;
  }

  /** Moves the office to another place on earth: sun path, sunrise and sunset follow. */
  setLocation(lat: number, lon: number) {
    this.lat = lat;
    this.lon = lon;
    this.lastTimesDay = -1;
  }

  /** 0 in daylight .. 1 at night */
  get darkness() {
    return 1 - THREE.MathUtils.smoothstep(this.altitude, -6, 6);
  }

  addLamp(mat: THREE.MeshBasicMaterial, night = 2.2, day = 0.9) {
    this.lamps.push({ mat, base: mat.color.clone(), night, day });
  }

  addLampLight(light: THREE.PointLight) {
    this.lampLights.push({ light, max: light.intensity });
  }

  update(date: Date) {
    const p = sunPosition(date, this.lat, this.lon);
    const alt = p.altitude * DEG;
    this.altitude = alt;
    this.azimuth = p.azimuth;
    const dayKey = date.getFullYear() * 400 + date.getMonth() * 32 + date.getDate();
    if (dayKey !== this.lastTimesDay) {
      const t = sunTimes(date, this.lat, this.lon);
      this.sunrise = t.rise;
      this.sunset = t.set;
      this.lastTimesDay = dayKey;
    }

    // south = -z, west = +x
    const sunAlt = Math.max(p.altitude, 3.5 / DEG);
    const sunDir = new THREE.Vector3(Math.sin(p.azimuth) * Math.cos(sunAlt), Math.sin(sunAlt), -Math.cos(p.azimuth) * Math.cos(sunAlt));
    const W = this.weather;
    const sunI = keyedN(SUN_I, alt) * (1 - 0.88 * W.cloud) * this.ambience;
    const moonI = 0.32 * (1 - THREE.MathUtils.smoothstep(alt, -6, -1));
    if (sunI >= moonI) {
      this.sun.position.copy(sunDir.multiplyScalar(40));
      this.sun.color.copy(keyed(SUN_COLOR, alt));
      this.sun.intensity = sunI;
    } else {
      const mAz = p.azimuth + Math.PI;
      const mAlt = 38 / DEG;
      this.sun.position.set(Math.sin(mAz) * Math.cos(mAlt), Math.sin(mAlt), -Math.cos(mAz) * Math.cos(mAlt)).multiplyScalar(40);
      this.sun.color.set('#9fb4ff');
      this.sun.intensity = moonI;
    }
    const day = THREE.MathUtils.smoothstep(alt, -6, 6);
    this.hemi.color.copy(keyed(HEMI_SKY, alt)).lerp(GREY, W.cloud * 0.6 * day).lerp(FLASH, Math.min(1, W.flash));
    this.hemi.groundColor.copy(keyed(HEMI_GROUND, alt));
    this.hemi.intensity = (keyedN(HEMI_I, alt) * (1 - 0.38 * W.cloud) + W.flash * 2.4) * this.ambience;
    (this.scene.background as THREE.Color).copy(keyed(BG, alt)).lerp(GREY_BG.clone().multiplyScalar(0.25 + 0.75 * day), W.cloud * 0.55).lerp(SNOW_SKY.clone().multiplyScalar(0.22 + 0.78 * day), W.snow * 0.5);
    this.pipe.setPost({ exposure: keyedN(EXPOSURE, alt) + W.flash * 0.45 });

    this.lampLevel = Math.max(1 - THREE.MathUtils.smoothstep(alt, -4, 9), W.cloud * 0.6 * day);
    for (const l of this.lamps) {
      const f = THREE.MathUtils.lerp(l.day, l.night, this.lampLevel);
      l.mat.color.copy(l.base).multiplyScalar(f);
    }
    for (const l of this.lampLights) l.light.intensity = l.max * this.lampLevel;

    const now = performance.now();
    // rain itself is 3D (rain.ts); the view only needs repainting for haze, lightning and slow cloud drift
    const wkey = `${W.cloud.toFixed(2)}|${W.rain.toFixed(2)}|${Math.round(W.flash * 25)}|${W.snow.toFixed(2)}|${(Math.round(W.snowCover * 25) / 25).toFixed(2)}`;
    if (this.viewTex && (Math.abs(alt - this.lastPaintAlt) > 0.25 || wkey !== this.lastWeatherKey || now - this.lastPaintT > 4000)) {
      this.paintView(alt, p.azimuth);
      this.lastPaintAlt = alt;
      this.lastWeatherKey = wkey;
      this.lastPaintT = now;
    }
  }

  private paintView(alt: number, az: number) {
    const g = this.viewCtx;
    const { width: w, height: h } = g.canvas;
    const W = this.weather;
    const dayK = THREE.MathUtils.smoothstep(alt, -6, 6);
    const overcast = GREY_SKY.clone().lerp(SNOW_SKY, Math.min(1, W.snow * 1.4)).multiplyScalar(0.18 + 0.82 * dayK);
    const cover = W.snowCover;
    const hill = keyed(HILL, alt).lerp(keyed(SNOW_LAND, alt), cover);
    const hill2 = keyed(HILL2, alt).lerp(keyed(SNOW_LAND2, alt), cover);
    const top = keyed(SKY_TOP, alt).lerp(overcast.clone().multiplyScalar(0.8), W.cloud * 0.85).lerp(FLASH, W.flash * 0.8);
    const hor = keyed(SKY_HOR, alt).lerp(overcast, W.cloud * 0.8).lerp(FLASH, W.flash * 0.6);
    const bands = 8;
    for (let i = 0; i < bands; i++) {
      g.fillStyle = hex(top.clone().lerp(hor, i / (bands - 1)));
      g.fillRect(0, Math.floor((i * h) / bands), w, Math.ceil(h / bands) + 1);
    }
    reseed(4242);
    const night = (1 - THREE.MathUtils.smoothstep(alt, -10, -3)) * (1 - W.cloud);
    if (night > 0.05) {
      for (let i = 0; i < 90; i++) {
        const x = Math.floor(rand() * w), y = Math.floor(rand() * (h - 18));
        if (rand() < night) {
          g.fillStyle = rand() < 0.2 ? '#fff4d0' : '#c8d4ff';
          g.fillRect(x, y, 1, 1);
        }
      }
      g.fillStyle = '#f4ecd0';
      g.fillRect(48, 6, 5, 5);
      g.fillStyle = hex(top);
      g.fillRect(51, 6, 2, 3);
    }
    // the windows face south: azimuth 0 sits in the middle of the view, west to the right
    if (alt > -3 && W.cloud < 0.6) {
      const sx = Math.round(w / 2 + (az / (Math.PI / 2)) * (w / 2.2));
      const sy = Math.round(h - 16 - alt * 1.1);
      const sc = keyed(SUN_COLOR, alt).lerp(new THREE.Color('#ffffff'), alt > 20 ? 0.6 : 0.2);
      g.fillStyle = hex(sc.clone().lerp(hor, 0.5));
      g.fillRect(sx - 6, sy - 6, 13, 13);
      g.fillStyle = hex(sc);
      g.fillRect(sx - 4, sy - 4, 9, 9);
    }
    if (alt > 2 || W.cloud > 0.1) {
      const cc = new THREE.Color('#ffffff').lerp(GREY_SKY.clone().multiplyScalar(0.55 + 0.45 * dayK), W.cloud);
      g.fillStyle = `rgba(${Math.round(cc.r * 255)},${Math.round(cc.g * 255)},${Math.round(cc.b * 255)},${0.9 * Math.max(dayK, W.cloud)})`;
      const drift = (performance.now() / 4000) % w;
      const n = 3 + Math.round(W.cloud * 7);
      for (let i = 0; i < n; i++) {
        const cx = Math.round(([30, 120, 200, 70, 160, 240, 10, 100, 180, 220][i] + drift * (0.4 + (i % 3) * 0.2)) % (w + 30)) - 15;
        const cy = [8, 5, 10, 3, 12, 6, 14, 2, 9, 4][i];
        const cw = 16 + Math.round(W.cloud * 18);
        g.fillRect(cx, cy, cw, 3 + Math.round(W.cloud * 3));
        g.fillRect(cx + 4, cy - 2, cw - 8, 2);
      }
    }
    g.fillStyle = hex(hill);
    for (let x = 0; x < w; x++) g.fillRect(x, h - 20 - Math.round(Math.sin(x / 30) * 5 + Math.sin(x / 11) * 2), 1, 30);
    g.fillStyle = hex(hill2);
    for (let x = 0; x < w; x++) g.fillRect(x, h - 10 - Math.round(Math.sin(x / 17 + 2) * 3), 1, 20);
    const lit = this.lampLevel;
    for (let i = 0; i < 26; i++) {
      const tx = Math.floor(rand() * w), ty = h - 8 - Math.floor(rand() * 6);
      const c = keyed(HILL2, alt).multiplyScalar(0.75);
      g.fillStyle = hex(c);
      g.fillRect(tx, ty - 6, 3, 6);
      g.fillRect(tx - 1, ty - 4, 5, 3);
      if (cover > 0.3) {
        // snow caps on the trees
        g.fillStyle = hex(hill);
        g.fillRect(tx, ty - 6, 3, 1);
        if (cover > 0.6) g.fillRect(tx - 1, ty - 4, 5, 1);
      }
    }
    for (let i = 0; i < 14; i++) {
      const hx = Math.floor(rand() * w), hy = h - 14 - Math.floor(rand() * 8);
      g.fillStyle = hex(keyed(HILL2, alt).multiplyScalar(0.6));
      g.fillRect(hx, hy, 5, 3);
      if (cover > 0.3) {
        // white roofs
        g.fillStyle = hex(hill);
        g.fillRect(hx, hy, 5, 1);
      }
      if (rand() < lit * 0.9) {
        g.fillStyle = pick(['#ffd27a', '#ffe9b0', '#ffc070']);
        g.fillRect(hx + 1, hy + 1, 1, 1);
        g.fillRect(hx + 3, hy + 1, 1, 1);
      }
    }
    if (W.rain > 0.02) {
      // distant rain veil: washes out the hills towards the horizon
      const veil = hor.clone().lerp(overcast, 0.5);
      const rgb = `${Math.round(veil.r * 255)},${Math.round(veil.g * 255)},${Math.round(veil.b * 255)}`;
      for (let i = 0; i < 4; i++) {
        g.fillStyle = `rgba(${rgb},${(W.rain * (0.08 + i * 0.06)).toFixed(3)})`;
        g.fillRect(0, h - 30 + i * 6, w, i === 3 ? 12 : 6);
      }
    }
    if (W.snow > 0.02) {
      // falling snow in the distance: the land fades into the sky
      const veil = hor.clone().lerp(overcast, 0.6);
      const rgb = `${Math.round(veil.r * 255)},${Math.round(veil.g * 255)},${Math.round(veil.b * 255)}`;
      for (let i = 0; i < 3; i++) {
        g.fillStyle = `rgba(${rgb},${(W.snow * (0.3 - i * 0.09)).toFixed(3)})`;
        g.fillRect(0, h - 34 + i * 7, w, 7);
      }
    }
    if (W.flash > 0.35) {
      reseed(Math.floor(performance.now() / 600));
      let x = 40 + Math.floor(rand() * (w - 80)), y = 0;
      g.fillStyle = '#ffffff';
      while (y < h - 18) {
        const nx = x + Math.floor(rand() * 7) - 3;
        g.fillRect(Math.min(x, nx), y, Math.abs(nx - x) + 1, 3);
        x = nx;
        y += 3;
      }
    }
    this.viewTex!.needsUpdate = true;
  }
}

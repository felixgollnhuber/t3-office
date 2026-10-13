import * as THREE from 'three';
import { fx, ROOM, type Office } from './office';
import { toon } from './materials';
import type { Player } from './player';
import type { Sfx } from './audio';
import { Fog } from './fog';
import { settings, type LightShowSetting } from './settings';
import { cue } from './director';

/** Section kinds from scripts/analyze-set.mjs: groove, breakdown, build-up, drop. */
type Kind = 'g' | 'b' | 'u' | 'd';

interface SetFile {
  v: number;
  duration: number;
  fps: number;
  loud: string;
  low: string;
  mid: string;
  high: string;
  ifps: number;
  intensity: string;
  beats: number[];
  beatK: string;
  sections: [number, Kind][];
  drops: number[];
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const B64I = new Map([...B64].map((c, i) => [c, i / 63]));
const unpack = (s: string) => Float32Array.from(s, (c) => B64I.get(c) ?? 0);

/** A pre-analysed set, indexed by playback time. */
class Timeline {
  readonly fps: number;
  readonly ifps: number;
  readonly loud: Float32Array;
  readonly low: Float32Array;
  readonly mid: Float32Array;
  readonly high: Float32Array;
  readonly intensity: Float32Array;
  readonly beats: Float64Array;
  readonly beatK: Float32Array;
  readonly secT: number[];
  readonly secK: Kind[];
  readonly drops: number[];
  private hint = 0;

  constructor(d: SetFile) {
    this.fps = d.fps;
    this.ifps = d.ifps;
    this.loud = unpack(d.loud);
    this.low = unpack(d.low);
    this.mid = unpack(d.mid);
    this.high = unpack(d.high);
    this.intensity = unpack(d.intensity);
    this.beats = new Float64Array(d.beats.length);
    let acc = 0;
    d.beats.forEach((v, i) => (this.beats[i] = (acc += v) / 100));
    this.beatK = Float32Array.from(d.beatK, (c) => Number(c) / 9);
    this.secT = d.sections.map((s) => s[0]);
    this.secK = d.sections.map((s) => s[1]);
    this.drops = d.drops;
  }

  sample(a: Float32Array, fps: number, t: number) {
    const x = Math.max(0, t * fps);
    const i = Math.min(a.length - 1, Math.floor(x));
    const j = Math.min(a.length - 1, i + 1);
    const f = x - Math.floor(x);
    return a[i] * (1 - f) + a[j] * f;
  }

  /** index of the last beat at or before t (cached walk, binary search after seeks) */
  beatIndex(t: number) {
    const b = this.beats;
    let i = this.hint;
    if (i >= b.length || Math.abs((b[i] ?? 0) - t) > 4) {
      let lo = 0, hi = b.length - 1;
      while (lo < hi) {
        const m = (lo + hi + 1) >> 1;
        if (b[m] <= t) lo = m;
        else hi = m - 1;
      }
      i = lo;
    }
    while (i + 1 < b.length && b[i + 1] <= t) i++;
    while (i > 0 && b[i] > t) i--;
    this.hint = i;
    return i;
  }

  section(t: number) {
    let i = 0;
    for (let k = 0; k < this.secT.length && this.secT[k] <= t; k++) i = k;
    return { kind: this.secK[i] ?? 'g', start: this.secT[i] ?? 0, end: this.secT[i + 1] ?? Infinity };
  }

  sinceDrop(t: number) {
    let s = Infinity;
    for (const d of this.drops) if (d <= t + 0.05) s = t - d;
    return s;
  }

  /** seconds until the next drop */
  untilDrop(t: number) {
    for (const d of this.drops) if (d > t + 0.05) return d - t;
    return Infinity;
  }
}

/** What every effect reads each frame. */
interface Feat {
  low: number;
  mid: number;
  high: number;
  loud: number;
  intensity: number;
  beat: number;
  beatFrac: number;
  beatLen: number;
  kick: number;
  kind: Kind;
  build: number;
  sinceDrop: number;
  untilDrop: number;
  /** length of the current section and what is left of it, in seconds */
  secLen: number;
  secLeft: number;
}

interface Palette {
  wash: string[];
  laser: string[];
}
const PALETTES: Palette[] = [
  { wash: ['#ff3a8c', '#3ad8ff', '#9b5cff'], laser: ['#00ff30', '#ff0020'] },
  { wash: ['#ff5a1a', '#ff1a5a', '#ffb81a'], laser: ['#ff0000', '#ffb000'] },
  { wash: ['#2a6aff', '#3affe0', '#b05cff'], laser: ['#00ffd0', '#0030ff'] },
  { wash: ['#ff2ab0', '#7a2aff', '#ff5a5a'], laser: ['#ff00a0', '#00ff30'] },
  { wash: ['#39ff6a', '#2ad8ff', '#e8ff3a'], laser: ['#00ff30', '#00b0ff'] },
  { wash: ['#ff2a3a', '#ff2ad0', '#5a3aff'], laser: ['#ff0010', '#3000ff'] },
];
const CALM: Palette = { wash: ['#2a3cff', '#6a2aff', '#1aa8ff'], laser: ['#0040ff', '#6000ff'] };

type LaserProg = 'none' | 'sheet' | 'fan' | 'scissor' | 'cone' | 'chase' | 'zigzag' | 'burst' | 'wave';
type HeadProg = 'rest' | 'fanout' | 'circle' | 'sweep' | 'crowd' | 'dj';

const TAU = Math.PI * 2;
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const smooth = (a: number, b: number, x: number) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const hash = (n: number) => {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
};
const ease = (cur: number, target: number, rate: number, dt: number) => cur + (target - cur) * Math.min(1, dt * rate);

const DOWN = new THREE.Vector3(0, -1, 0);
const LASERS = 176;
const DOTS = 200;
const SPECKS = 150;
/** extra beam pieces drawn where a laser crosses the fog */
const FOG_SEGS = 2400;
/** people come running at most this often when the trigger is only a surge of energy (drops always count) */
const RUSH_GAP = 45;
const TILE_X = 6, TILE_Z = 3, TILE_PX = 4;

/**
 * Sound-reactive club lighting for the DJ corner. For YouTube sets it follows an offline analysis
 * (public/sets/<videoId>.json), for the lo-fi radio a live AnalyserNode, otherwise the nominal BPM.
 */
export class LightShow {
  party = 0;
  beat = 0;
  beatFrac = 0;
  intensity = 0;
  /** how much heads should nod: party presence times kick presence */
  groove = 0;
  /** suggested multiplier for the room lights (DayCycle.ambience) */
  ambience = 1;
  /** a high-energy passage is running: after a drop or a kick-in, until the next breakdown or until it cools off */
  hot = false;
  /** counts the moments that pull people onto the dance floor: drops, kick-ins after a breakdown, surges */
  rush = 0;
  /** 1 right after the music slammed in, fading to 0 over eight bars: how much harder heads bob */
  bob = 0;
  /** how dark it is outside, 0..1; set by the owner (the mirror ball joins the lo-fi radio at night) */
  night = 0;
  /** 0 parked .. 1 the mirror ball is down and the star of the room */
  ballK = 0;

  private group = new THREE.Group();
  private sets = new Map<string, Timeline | 'loading' | 'missing'>();
  private analyser?: AnalyserNode;
  private spec?: Float32Array<ArrayBuffer>;
  private live = { low: 0, mid: 0, high: 0, loud: 0, floor: -70, ceil: -30 };
  private clock = { raw: -1, at: 0, t: 0, id: '' };
  private f: Feat = { low: 0, mid: 0, high: 0, loud: 0, intensity: 0, beat: 0, beatFrac: 0, beatLen: 0.47, kick: 0, kind: 'g', build: 0, sinceDrop: Infinity, untilDrop: Infinity, secLen: Infinity, secLeft: Infinity };
  private time = 0;
  private lastBeatIdx = -1;
  private pulse = 0;
  private lowEnv = 0;
  private palIdx = 0;
  private lastKind: Kind = 'g';
  private wash = [new THREE.Color(), new THREE.Color(), new THREE.Color()];
  private laserCol = [new THREE.Color(), new THREE.Color()];
  private tmpC = new THREE.Color();
  private tmpV = new THREE.Vector3();
  private dir = new THREE.Vector3();
  private reach = 9;
  private prog: { laser: LaserProg; laser2: LaserProg; laser3: LaserProg; head: HeadProg; phrase: number; bar: number; tier: number; seed: number } = { laser: 'none', laser2: 'none', laser3: 'none', head: 'rest', phrase: -1, bar: -1, tier: 0, seed: 0 };

  // geometry
  private booth: THREE.Vector3;
  private floorC: THREE.Vector3;
  private emitters: THREE.Vector3[] = [];
  private emitterLens: THREE.MeshBasicMaterial[] = [];
  private laserGeo = new THREE.BufferGeometry();
  private laserPos = new Float32Array(LASERS * 2 * 2 * 3);
  private laserCols = new Float32Array(LASERS * 2 * 2 * 3);
  private laserN = 0;
  private dotGeo = new THREE.BufferGeometry();
  private dotPos = new Float32Array(DOTS * 3);
  private dotCols = new Float32Array(DOTS * 3);
  private dotN = 0;
  private truss = new THREE.Group();
  private heads: { pos: THREE.Vector3; aim: THREE.Vector3; yoke: THREE.Object3D; lens: THREE.MeshBasicMaterial; cone: THREE.Mesh; coneMat: THREE.MeshBasicMaterial; spot: THREE.Mesh; spotMat: THREE.MeshBasicMaterial }[] = [];
  private strobe: THREE.PointLight;
  private strobeLens: THREE.MeshBasicMaterial;
  private strobeT = 0;
  private strobeK = 0;
  private strobeBeat = -1;
  private strobeKind: Kind = 'g';
  private kickInAt = -99;
  private prevSinceDrop = Infinity;
  private mode: LightShowSetting = settings.get('lightShow');
  private strobeOn = settings.get('strobe');
  private fogOn = settings.get('fog');
  /** eased 0..1: is there a show at all (0 with lightShow 'off'), and how much of the room darkening applies */
  private showK = this.mode === 'off' ? 0 : 1;
  private darkK = this.mode === 'off' ? 0 : this.mode === 'soft' ? 0.45 : 1;
  private fog: Fog;
  private fogT = 0;
  private fogRate = 0;
  private fogPower = 1;
  private lastFog = -99;
  private lastHiss = -99;
  private fogPhrase = -1;
  private fogGeo = new THREE.BufferGeometry();
  private fogPos = new Float32Array(FOG_SEGS * 2 * 3);
  private fogCols = new Float32Array(FOG_SEGS * 2 * 3);
  private fogN = 0;
  private beamIdx = 0;
  private dropIdx = -2;
  private lowAt = -99;
  private coolT = 0;
  private lastRush = -99;
  private quietT = 0;
  private headLit: { col: THREE.Color; b: number; r: number }[] = [];
  private off: (() => void)[] = [];
  private glow: THREE.PointLight;
  private specks: { dirs: THREE.Vector3[]; geo: THREE.BufferGeometry; pos: Float32Array; col: Float32Array; tw: Float32Array };
  private tiles: { tex: THREE.DataTexture; data: Uint8Array; mesh: THREE.Mesh; level: Float32Array };
  private ballMat?: THREE.MeshLambertMaterial;

  constructor(private scene: THREE.Scene, private office: Office, private player: Player, private sfx: Sfx) {
    scene.add(this.group);
    const boothObj = scene.getObjectByName('djbooth');
    this.booth = boothObj ? boothObj.getWorldPosition(new THREE.Vector3()) : new THREE.Vector3(3.9, 0, ROOM.minZ + 1);
    const dance = office.spots.dance ?? [];
    this.floorC = dance.length
      ? new THREE.Vector3(dance.reduce((s, p) => s + p.x, 0) / dance.length, 0, dance.reduce((s, p) => s + p.z, 0) / dance.length)
      : new THREE.Vector3(this.booth.x, 0, this.booth.z + 2);
    const ballMesh = office.party.ball.children.find((c) => (c as THREE.Mesh).isMesh && (c as THREE.Mesh).geometry.type === 'IcosahedronGeometry') as THREE.Mesh | undefined;
    if (ballMesh) {
      // own copy, so the sparkle does not leak into other meshes sharing the material
      this.ballMat = (ballMesh.material as THREE.MeshLambertMaterial).clone();
      ballMesh.material = this.ballMat;
    }

    this.buildLasers();
    this.buildTruss();
    this.specks = this.buildSpecks();
    this.tiles = this.buildTiles();

    this.strobe = new THREE.PointLight('#f4f6ff', 0, 20, 1.3);
    this.strobe.position.set(this.floorC.x, ROOM.h - 0.4, this.floorC.z - 0.4);
    this.group.add(this.strobe);
    this.strobeLens = new THREE.MeshBasicMaterial({ color: '#202024' });
    const sb = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.1, 0.06), this.strobeLens);
    sb.position.set(0, -0.12, 0.08);
    this.truss.add(sb);

    this.glow = new THREE.PointLight('#ffb070', 0, 4.5, 1.6);
    this.glow.position.set(this.booth.x, this.booth.y + 1.5, this.booth.z + 0.9);
    this.group.add(this.glow);
    this.applyPalette(PALETTES[0], 1);

    this.fog = new Fog(office.party.fogger, this.floorC);
    this.group.add(this.fog.points);
    this.heads.forEach(() => this.headLit.push({ col: new THREE.Color(), b: 0, r: 0.1 }));
    this.off.push(
      settings.on('lightShow', (v) => (this.mode = v)),
      settings.on('strobe', (v) => (this.strobeOn = v)),
      settings.on('fog', (v) => (this.fogOn = v)),
    );
  }

  // ---------- construction ----------

  private buildLasers() {
    const H = ROOM.h;
    const back = ROOM.minZ + 0.12;
    this.emitters = [
      new THREE.Vector3(this.booth.x, H - 0.5, back),
      new THREE.Vector3(this.floorC.x - 1.75, H - 0.32, this.floorC.z - 1.0),
      new THREE.Vector3(this.floorC.x + 1.75, H - 0.32, this.floorC.z - 1.0),
    ];
    // the wall unit: dark housing with a lens that lights while it fires
    const body = toon('#18171c');
    const e0 = new THREE.Group();
    e0.position.copy(this.emitters[0]);
    const housing = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.16, 0.2), body);
    housing.position.z = -0.04;
    e0.add(housing);
    const lens0 = new THREE.MeshBasicMaterial({ color: '#202024' });
    const l0 = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.05, 0.02), lens0);
    l0.position.z = 0.07;
    e0.add(l0);
    this.group.add(e0);
    this.emitterLens.push(lens0);

    const mat = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
    this.laserGeo.setAttribute('position', new THREE.BufferAttribute(this.laserPos, 3).setUsage(THREE.DynamicDrawUsage));
    this.laserGeo.setAttribute('color', new THREE.BufferAttribute(this.laserCols, 3).setUsage(THREE.DynamicDrawUsage));
    this.laserGeo.setDrawRange(0, 0);
    const lines = new THREE.LineSegments(this.laserGeo, mat);
    lines.frustumCulled = false;
    lines.renderOrder = 5;
    this.group.add(fx(lines));
    this.fogGeo.setAttribute('position', new THREE.BufferAttribute(this.fogPos, 3).setUsage(THREE.DynamicDrawUsage));
    this.fogGeo.setAttribute('color', new THREE.BufferAttribute(this.fogCols, 3).setUsage(THREE.DynamicDrawUsage));
    this.fogGeo.setDrawRange(0, 0);
    const haze = new THREE.LineSegments(this.fogGeo, mat);
    haze.frustumCulled = false;
    haze.renderOrder = 5;
    this.group.add(fx(haze));

    const dmat = new THREE.PointsMaterial({ size: 2, sizeAttenuation: false, vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
    this.dotGeo.setAttribute('position', new THREE.BufferAttribute(this.dotPos, 3).setUsage(THREE.DynamicDrawUsage));
    this.dotGeo.setAttribute('color', new THREE.BufferAttribute(this.dotCols, 3).setUsage(THREE.DynamicDrawUsage));
    this.dotGeo.setDrawRange(0, 0);
    const dots = new THREE.Points(this.dotGeo, dmat);
    dots.frustumCulled = false;
    this.group.add(fx(dots));
  }

  private buildTruss() {
    const c = this.floorC;
    const span = 4.2;
    const z = c.z - 1.0;
    this.truss.position.set(c.x, ROOM.h - 0.22, z);
    this.truss.visible = false;
    const steel = toon('#2a2a30');
    for (const y of [0, -0.16]) {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(span, 0.04, 0.04), steel);
      bar.position.y = y;
      this.truss.add(bar);
    }
    for (let i = 0; i <= 10; i++) {
      const strut = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.16, 0.025), steel);
      strut.position.set(-span / 2 + (i / 10) * span, -0.08, 0);
      strut.rotation.z = i % 2 ? 0.6 : -0.6;
      this.truss.add(strut);
    }
    for (const dx of [-span / 2 + 0.2, span / 2 - 0.2]) {
      const rod = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.6, 0.02), steel);
      rod.position.set(dx, 0.3, 0);
      this.truss.add(rod);
      // the side lasers sit on the truss ends
      const box = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.12, 0.2), toon('#18171c'));
      box.position.set(dx < 0 ? -1.75 : 1.75, -0.24, 0);
      this.truss.add(box);
      const lens = new THREE.MeshBasicMaterial({ color: '#202024' });
      const l = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.04, 0.02), lens);
      l.position.set(dx < 0 ? -1.75 : 1.75, -0.24, 0.11);
      this.truss.add(l);
      this.emitterLens.push(lens);
    }
    this.group.add(this.truss);

    const coneGeo = new THREE.CylinderGeometry(0.03, 1, 1, 14, 1, true);
    coneGeo.translate(0, -0.5, 0);
    const shade = new Float32Array(coneGeo.attributes.position.count * 3);
    for (let i = 0; i < coneGeo.attributes.position.count; i++) {
      const v = coneGeo.attributes.position.getY(i) > -0.5 ? 1 : 0.18;
      shade.set([v, v, v], i * 3);
    }
    coneGeo.setAttribute('color', new THREE.BufferAttribute(shade, 3));
    const spotGeo = new THREE.CircleGeometry(1, 18).rotateX(-Math.PI / 2);
    for (let i = 0; i < 4; i++) {
      const dx = -1.2 + i * 0.8;
      const yoke = new THREE.Group();
      yoke.position.set(dx, -0.2, 0);
      const head = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.2, 0.16), toon('#1b1a20'));
      head.position.y = -0.1;
      yoke.add(head);
      const lens = new THREE.MeshBasicMaterial({ color: '#202024' });
      const lm = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.02, 0.1), lens);
      lm.position.y = -0.205;
      yoke.add(lm);
      this.truss.add(yoke);
      const coneMat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.1, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.FrontSide });
      const cone = new THREE.Mesh(coneGeo, coneMat);
      cone.frustumCulled = false;
      this.group.add(fx(cone));
      const spotMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
      const spot = new THREE.Mesh(spotGeo, spotMat);
      this.group.add(fx(spot));
      this.heads.push({ pos: new THREE.Vector3(), aim: new THREE.Vector3(c.x + dx, 0, c.z), yoke, lens, cone, coneMat, spot, spotMat });
    }
  }

  private buildSpecks() {
    const dirs: THREE.Vector3[] = [];
    for (let i = 0; i < SPECKS; i++) {
      // fibonacci sphere, mostly the lower half: the pin spot hits the ball from above
      const y = -0.95 + 1.3 * ((i + 0.5) / SPECKS);
      const r = Math.sqrt(1 - y * y);
      const a = i * 2.39996;
      dirs.push(new THREE.Vector3(Math.cos(a) * r, y, Math.sin(a) * r));
    }
    const pos = new Float32Array(SPECKS * 3), col = new Float32Array(SPECKS * 3), tw = new Float32Array(SPECKS);
    for (let i = 0; i < SPECKS; i++) tw[i] = hash(i * 3.1) * TAU;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setDrawRange(0, 0);
    const pts = new THREE.Points(geo, new THREE.PointsMaterial({ size: 2, sizeAttenuation: false, vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
    pts.frustumCulled = false;
    this.group.add(fx(pts));
    return { dirs, geo, pos, col, tw };
  }

  private buildTiles() {
    const w = TILE_X * TILE_PX, h = TILE_Z * TILE_PX;
    const data = new Uint8Array(w * h * 4);
    const tex = new THREE.DataTexture(data, w, h, THREE.RGBAFormat);
    tex.magFilter = tex.minFilter = THREE.NearestFilter;
    tex.generateMipmaps = false;
    tex.needsUpdate = true;
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, color: new THREE.Color(1.6, 1.6, 1.6) });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(3.6, 1.8).rotateX(-Math.PI / 2), mat);
    mesh.position.set(this.floorC.x, 0.006, this.floorC.z);
    mesh.visible = false;
    this.group.add(fx(mesh));
    return { tex, data, mesh, level: new Float32Array(TILE_X * TILE_Z) };
  }

  // ---------- features ----------

  private timeline(id: string) {
    const s = this.sets.get(id);
    if (s === undefined) {
      this.sets.set(id, 'loading');
      fetch(`${import.meta.env.BASE_URL}sets/${id}.json`)
        .then((r) => (r.ok ? (r.json() as Promise<SetFile>) : Promise.reject(new Error(String(r.status)))))
        .then((d) => this.sets.set(id, new Timeline(d)))
        .catch(() => this.sets.set(id, 'missing'));
      return null;
    }
    return s instanceof Timeline ? s : null;
  }

  /** YouTube reports its time in coarse steps; extrapolate between them and glide over jitter. */
  private setClock(dt: number, id: string) {
    const raw = this.player.position();
    const now = performance.now() / 1000;
    const c = this.clock;
    if (c.id !== id) Object.assign(c, { id, raw: -1, t: raw });
    if (raw !== c.raw) {
      c.raw = raw;
      c.at = now;
    }
    const est = c.raw + (this.player.playing ? Math.min(1.5, now - c.at) : 0);
    if (Math.abs(est - c.t) > 0.3) c.t = est;
    else c.t += (this.player.playing ? dt : 0) + (est - c.t) * Math.min(1, dt * 4);
    return c.t;
  }

  private readLive() {
    const ctx = this.sfx.ctx;
    if (!this.analyser && ctx && this.sfx.musicBus) {
      this.analyser = ctx.createAnalyser();
      this.analyser.fftSize = 1024;
      this.analyser.smoothingTimeConstant = 0.6;
      // a tap only: the analyser has no output, so what you hear stays the same
      this.sfx.musicBus.connect(this.analyser);
      this.spec = new Float32Array(this.analyser.frequencyBinCount);
    }
    const L = this.live;
    if (!this.analyser || !this.spec || !ctx) return L;
    this.analyser.getFloatFrequencyData(this.spec);
    const hz = ctx.sampleRate / this.analyser.fftSize;
    let lo = 0, mi = 0, hi = 0;
    for (let k = 1; k < this.spec.length; k++) {
      const p = Math.pow(10, this.spec[k] / 10);
      const f = k * hz;
      if (f < 150) lo += p;
      else if (f < 2500) mi += p;
      else hi += p;
    }
    const db = (x: number) => 10 * Math.log10(x + 1e-12);
    const all = db(lo + mi + hi);
    // adaptive range: follows the track's own loudness instead of absolute levels
    L.ceil = Math.max(all, L.ceil - 0.02);
    L.floor = Math.min(all, L.floor + 0.01);
    const n = (v: number) => clamp01((v - L.floor) / Math.max(6, L.ceil - L.floor));
    L.low = n(db(lo) + 4);
    L.mid = n(db(mi) + 3);
    L.high = n(db(hi) + 10);
    L.loud = n(all);
    return L;
  }

  private features(dt: number): Feat {
    const p = this.player;
    const f = this.f;
    const item = p.current;
    if (item.kind === 'youtube' && item.videoId) {
      const t = this.setClock(dt, item.videoId);
      const tl = this.timeline(item.videoId);
      if (tl) {
        f.low = tl.sample(tl.low, tl.fps, t);
        f.mid = tl.sample(tl.mid, tl.fps, t);
        f.high = tl.sample(tl.high, tl.fps, t);
        f.loud = tl.sample(tl.loud, tl.fps, t);
        const bi = tl.beatIndex(t);
        const b0 = tl.beats[bi] ?? 0, b1 = tl.beats[bi + 1] ?? b0 + 0.47;
        f.beatLen = Math.max(0.2, b1 - b0);
        f.beatFrac = clamp01((t - b0) / f.beatLen);
        f.beat = bi + f.beatFrac;
        f.kick = tl.beatK[bi] ?? 0;
        const s = tl.section(t);
        f.kind = s.kind;
        f.build = s.kind === 'u' && Number.isFinite(s.end) ? clamp01((t - s.start) / (s.end - s.start)) : 0;
        f.sinceDrop = tl.sinceDrop(t);
        f.untilDrop = tl.untilDrop(t);
        f.secLen = s.end - s.start;
        f.secLeft = s.end - t;
        const base = tl.sample(tl.intensity, tl.ifps, t);
        const dropBoost = f.sinceDrop < 20 ? 0.28 * Math.exp(-f.sinceDrop / 9) : 0;
        f.intensity = clamp01(base + dropBoost - (f.kind === 'b' ? 0.08 : 0) + (f.kind === 'u' ? 0.15 * f.build : 0));
        return f;
      }
      // no analysis (yet): steady pulse on the nominal tempo
      const bps = item.bpm / 60;
      const b = t * bps;
      f.beat = b;
      f.beatFrac = b - Math.floor(b);
      f.beatLen = 1 / bps;
      f.kick = 0.8;
      f.kind = 'g';
      f.build = 0;
      f.sinceDrop = f.untilDrop = f.secLen = f.secLeft = Infinity;
      f.intensity = 0.55 + 0.15 * Math.sin(t * 0.05);
      const k = Math.pow(1 - f.beatFrac, 3);
      f.low = 0.5 + 0.4 * k;
      f.mid = f.high = f.loud = 0.6;
      return f;
    }
    // lo-fi radio: live analysis, deliberately calm
    const L = this.readLive();
    const frac = p.beatPhase();
    if (frac < f.beatFrac - 0.5) f.beat = Math.floor(f.beat) + 1 + frac;
    else f.beat = Math.floor(f.beat) + frac;
    f.beatFrac = frac;
    f.beatLen = 60 / item.bpm;
    f.kick = 0;
    f.kind = 'g';
    f.build = 0;
    f.sinceDrop = f.untilDrop = f.secLen = f.secLeft = Infinity;
    f.low = L.low;
    f.mid = L.mid;
    f.high = L.high;
    f.loud = L.loud;
    f.intensity = p.playing ? 0.15 * L.loud : 0;
    return f;
  }

  // ---------- frame ----------

  update(dt: number): { party: number; beat: number; beatFrac: number; intensity: number; groove: number; ambience: number; hot: boolean; rush: number; bob: number } {
    dt = Math.min(dt, 0.1);
    this.time += dt;
    const p = this.player;
    const yt = p.playing && p.current.kind === 'youtube';
    const lofi = p.playing && p.current.kind === 'lofi';
    const f = this.features(dt);
    this.party = ease(this.party, yt ? 1 : 0, 0.8, dt);
    this.showK = ease(this.showK, this.mode === 'off' ? 0 : 1, 2, dt);
    this.darkK = ease(this.darkK, this.mode === 'off' ? 0 : this.mode === 'soft' ? 0.45 : 1, 2, dt);
    // what the rig shows; `this.party` itself keeps following the music, so heads still nod with the lights off
    const party = this.party * this.showK;
    this.beat = f.beat;
    this.beatFrac = f.beatFrac;
    // quick to heat up, slow to cool down: a two-bar gap should not reset the whole rig
    const target = yt ? f.intensity : 0;
    this.intensity = ease(this.intensity, target, target > this.intensity ? 2.5 : 0.45, dt);
    if (f.kind === 'd' && f.sinceDrop < 0.5) this.intensity = Math.max(this.intensity, target);
    const I = this.intensity;

    // a beat hit: decays in ~120 ms in real time, scaled by how much kick there really is
    const bi = Math.floor(f.beat);
    if (bi !== this.lastBeatIdx) {
      if (yt) this.pulse = Math.max(this.pulse, 0.25 + 0.75 * f.kick);
      this.lastBeatIdx = bi;
    }
    this.pulse = Math.max(0, this.pulse - dt * 6);
    const hit = Math.pow(this.pulse, 1.6);
    this.lowEnv = Math.max(f.low, this.lowEnv - dt * 3);
    // the radio only gets a hint of a nod
    this.groove = ease(this.groove, yt ? this.party * (f.kind === 'b' ? 0.25 : 0.35 + 0.65 * smooth(0.15, 0.6, f.kick)) : lofi ? 0.22 : 0, 4, dt);
    this.ambience = 1 - this.party * this.darkK * (0.44 + 0.3 * I + (f.kind === 'b' ? 0.08 : 0));

    this.track(f, I, yt, dt);
    this.updateBallState(f, I, yt, lofi, dt);
    this.choosePrograms(f, I);
    this.updatePalette(f, dt);
    this.updateWash(f, I, hit, party);
    this.updateLasers(f, I, party);
    this.updateHeads(f, I, hit, party, dt);
    this.updateBall(f, lofi);
    this.updateTiles(f, I, hit, party);
    this.updateStrobe(f, party, dt);
    this.updateFog(f, I, yt, dt);
    this.updateLofi(f, dt, yt);

    const P = this.office.party;
    for (const v of P.vinyl) v.rotation.y += dt * (p.playing ? 3.5 : 0);
    const cone = yt ? 0.05 * hit + 0.14 * Math.pow(this.lowEnv, 3) : p.playing ? 0.03 * Math.pow(this.lowEnv, 2) : 0;
    for (const c of P.cones) c.scale.setScalar(1 + cone);
    return { party: this.party, beat: this.beat, beatFrac: this.beatFrac, intensity: I, groove: this.groove, ambience: this.ambience, hot: this.hot, rush: this.rush, bob: this.bob };
  }

  // ---------- energy ----------

  /** hard flashes are allowed: the full show, and the strobe setting is on */
  private get flashy() {
    return this.strobeOn && this.mode === 'full';
  }

  /**
   * Follows the energy of the set for everyone who reacts to it (dancers, fog, strobe): slams (a drop, or the kick
   * returning hard after a breakdown or build-up), surges in sets without marked drops, and the hot passage after them.
   */
  private track(f: Feat, I: number, yt: boolean, dt: number) {
    const live = yt && this.party > 0.5;
    let slam = false;
    if (f.kind !== this.strobeKind) {
      const was = this.strobeKind;
      this.strobeKind = f.kind;
      if ((was === 'b' || was === 'u') && (f.kind === 'g' || f.kind === 'd') && f.intensity > 0.55 && live) {
        this.kickInAt = this.time;
        slam = true;
      }
    }
    // a drop that was just passed (or jumped onto), not one we have been past all along
    if (live && f.sinceDrop < 2 && !(this.prevSinceDrop <= f.sinceDrop)) slam = true;
    this.prevSinceDrop = f.sinceDrop;
    if (I < 0.45) this.lowAt = this.time;

    const steady = f.kind === 'g' || f.kind === 'd';
    if (slam && this.time - this.lastRush > 5) {
      this.startRush();
      this.blow(2.2, 28, 1);
      cue('drop', { x: this.floorC.x, z: this.floorC.z }, 2, 8);
    } else if (live && !this.hot && steady && I > 0.72) {
      // no marked drop, but the energy came up out of a quiet stretch: the same pull, a size smaller
      this.hot = true;
      this.coolT = 0;
      if (this.time - this.lowAt < 14 && this.time - this.lastRush > RUSH_GAP) {
        this.startRush();
        this.blow(1.5, 20, 0.9);
      }
    }
    if (this.hot) {
      this.coolT = I < 0.5 ? this.coolT + dt : 0;
      if (!live || !steady || this.coolT > 6) this.hot = false;
    }
    const since = this.sinceSlam(f), bars8 = f.beatLen * 32;
    this.bob = live && since < bars8 ? 1 - Math.pow(since / bars8, 2) : 0;
  }

  private startRush() {
    this.rush++;
    this.lastRush = this.time;
    this.hot = true;
    this.coolT = 0;
  }

  // ---------- fog ----------

  /** the fog machine blows for `seconds` (called every frame it keeps blowing) */
  private blow(seconds: number, rate: number, power: number) {
    if (!this.fogOn || this.mode === 'off') return;
    if (this.time - this.lastHiss > 2.3) {
      this.lastHiss = this.time;
      this.sfx.play('fog');
    }
    this.fogRate = this.fogT > 0 ? Math.max(this.fogRate, rate) : rate;
    this.fogPower = power;
    this.fogT = Math.max(this.fogT, seconds);
    this.lastFog = this.time;
  }

  private updateFog(f: Feat, I: number, yt: boolean, dt: number) {
    if (yt && this.party > 0.5) {
      // creeps in under the second half of a build-up, so the drop hits a full room
      if ((f.kind === 'u' && f.build > 0.45) || f.untilDrop < 4) this.blow(0.3, 9, 0.75);
      // at a peak: a burst on some phrase starts, never closer than 20 s
      const phrase = Math.floor(f.beat / 32);
      if (phrase !== this.fogPhrase) {
        const first = this.fogPhrase < 0;
        this.fogPhrase = phrase;
        if (!first && this.hot && I > 0.7 && this.time - this.lastFog > 20 && hash(phrase * 9.1) < 0.7) this.blow(1.6, 20, 0.9);
      }
    }
    if (this.fogT > 0) {
      this.fogT -= dt;
      this.fog.emit(dt, this.fogRate * (this.mode === 'soft' ? 0.5 : 1), this.fogPower);
    }
    if (this.showK < 0.05 && this.fog.count) this.fog.clear();
    this.fog.update(dt, this.shadeFog);
  }

  /** the light a puff of fog catches: a little of the room, the wash, any moving head it hangs in, the strobe */
  private shadeFog = (x: number, y: number, z: number, out: THREE.Color) => {
    const amb = 0.13 + 0.3 * this.ambience * (1 - 0.65 * this.night);
    out.setRGB(amb, amb, amb * 1.06);
    for (const l of this.office.party.lights) {
      const dx = x - l.position.x, dy = y - l.position.y, dz = z - l.position.z;
      const k = Math.min(0.5, (l.intensity * 0.07) / (1 + (dx * dx + dy * dy + dz * dz) * 0.3));
      out.r += l.color.r * k; out.g += l.color.g * k; out.b += l.color.b * k;
    }
    for (let i = 0; i < this.heads.length; i++) {
      const lit = this.headLit[i], h = this.heads[i];
      if (lit.b < 0.03) continue;
      const ax = h.aim.x - h.pos.x, ay = h.aim.y - h.pos.y, az = h.aim.z - h.pos.z;
      const len2 = ax * ax + ay * ay + az * az;
      const t = clamp01(((x - h.pos.x) * ax + (y - h.pos.y) * ay + (z - h.pos.z) * az) / len2);
      const d = Math.hypot(x - h.pos.x - ax * t, y - h.pos.y - ay * t, z - h.pos.z - az * t);
      const rad = t * Math.sqrt(len2) * lit.r + 0.35;
      if (d > rad) continue;
      const k = lit.b * 0.9 * (1 - d / rad);
      out.r += lit.col.r * k; out.g += lit.col.g * k; out.b += lit.col.b * k;
    }
    const s = this.strobe.intensity * 0.12;
    out.r += s; out.g += s; out.b += s;
    // haze, not glare: lit fog keeps its colour instead of burning out to white
    const m = Math.max(out.r, out.g, out.b);
    out.multiplyScalar((m > 0.8 ? 0.8 / m : 1) * this.showK);
  };

  private choosePrograms(f: Feat, I: number) {
    const phrase = Math.floor(f.beat / 32);
    const bar = Math.floor(f.beat / 4);
    const kindChanged = f.kind !== this.lastKind;
    // energy tiers with a little hysteresis, so a level hovering at a border does not flip programs
    const edges = [0.32, 0.55, 0.75];
    let tier = this.prog.tier;
    while (tier < 3 && I > edges[tier] + 0.03) tier++;
    while (tier > 0 && I < edges[tier - 1] - 0.03) tier--;
    const tierChanged = tier !== this.prog.tier && bar !== this.prog.bar;
    this.prog.bar = bar;
    if (phrase === this.prog.phrase && !kindChanged && !tierChanged) return;
    if (kindChanged && f.kind === 'd') this.palIdx++;
    else if (!kindChanged && !tierChanged && f.kind === 'g' && phrase % 2 === 0) this.palIdx++;
    this.lastKind = f.kind;
    this.prog.phrase = phrase;
    this.prog.tier = tier;
    const r = hash(phrase * 13.7 + this.palIdx);
    const r2 = hash(phrase * 5.3 + 1.9);
    const pick = <T,>(a: T[], x: number) => a[Math.floor(x * a.length) % a.length];
    let laser: LaserProg = 'none', laser2: LaserProg = 'none', laser3: LaserProg = 'none', head: HeadProg = 'rest';
    if (f.kind === 'b') {
      laser = I > 0.12 ? 'sheet' : 'none';
      head = 'fanout';
    } else if (f.kind === 'u') {
      laser = 'cone';
      laser2 = 'zigzag';
      head = 'dj';
    } else if (f.kind === 'd') {
      laser = pick<LaserProg>(['burst', 'fan', 'chase'], r);
      laser2 = 'scissor';
      laser3 = pick<LaserProg>(['wave', 'cone'], r2);
      head = 'crowd';
    } else if (tier === 0) {
      head = 'fanout';
    } else if (tier === 1) {
      laser = pick<LaserProg>(['sheet', 'fan', 'none'], r);
      head = pick<HeadProg>(['fanout', 'sweep'], r2);
    } else if (tier === 2) {
      laser = pick<LaserProg>(['fan', 'cone', 'wave', 'fan'], r);
      laser2 = r2 < 0.7 ? 'scissor' : 'zigzag';
      head = pick<HeadProg>(['circle', 'sweep', 'crowd'], r2);
    } else {
      laser = pick<LaserProg>(['burst', 'chase', 'fan', 'cone'], r);
      laser2 = pick<LaserProg>(['scissor', 'zigzag'], r2);
      laser3 = pick<LaserProg>(['wave', 'cone', 'burst'], hash(phrase * 3.1 + 7.7));
      if (laser3 === laser) laser3 = 'wave';
      head = pick<HeadProg>(['crowd', 'circle', 'sweep'], r2);
    }
    Object.assign(this.prog, { laser, laser2, laser3, head, seed: r });
  }

  private applyPalette(p: Palette, k: number) {
    this.wash.forEach((c, i) => c.lerp(this.tmpC.set(p.wash[i % p.wash.length]), k));
    this.laserCol.forEach((c, i) => c.lerp(this.tmpC.set(p.laser[i % p.laser.length]), k));
  }

  private updatePalette(f: Feat, dt: number) {
    const target = f.kind === 'b' ? CALM : PALETTES[this.palIdx % PALETTES.length];
    this.applyPalette(target, Math.min(1, dt * (f.kind === 'd' && f.sinceDrop < 0.5 ? 20 : 1.5)));
  }

  private updateWash(f: Feat, I: number, hit: number, party: number) {
    const lights = this.office.party.lights;
    const t = this.time;
    lights.forEach((l, i) => {
      l.color.copy(this.wash[i % 3]);
      let v: number;
      if (f.kind === 'b') v = 1.6 + 1.2 * Math.sin(t * 0.7 + i * 2.1);
      else {
        const on = Math.floor(f.beat / 2) % 3 === i ? 1 : 0.3;
        v = 1.4 + 1.8 * I + hit * on * (4 + 13 * I);
        if (this.flashy && this.sinceSlam(f) < f.beatLen * 4) v += 9 * Math.pow(1 - f.beatFrac, 2);
        if (f.kind === 'u') v += f.build * 3 * (Math.floor(f.beat * (1 + Math.floor(f.build * 3))) % 3 === i ? 1 : 0);
      }
      l.intensity = party * v * (this.mode === 'soft' ? 0.6 : 1);
    });
  }

  // ---------- lasers ----------

  private beam(o: THREE.Vector3, yaw: number, pitch: number, color: THREE.Color, b: number, maxLen = this.reach) {
    if (b <= 0.01 || this.laserN >= LASERS) return;
    // the soft show fires every other beam
    if (this.mode === 'soft' && this.beamIdx++ & 1) return;
    const cp = Math.cos(pitch);
    const dx = Math.sin(yaw) * cp, dy = Math.sin(pitch), dz = Math.cos(yaw) * cp;
    let len = maxLen, floorHit = false;
    if (dy < -0.001) {
      const tf = o.y / -dy;
      if (tf < len) {
        len = tf;
        floorHit = true;
      }
    }
    // stop at the back and side walls (the open front fades out in the air instead)
    if (dx > 0.001) len = Math.min(len, (ROOM.maxX - o.x) / dx);
    if (dx < -0.001) len = Math.min(len, (ROOM.minX - o.x) / dx);
    if (dz < -0.001) len = Math.min(len, (ROOM.minZ + 0.05 - o.z) / dz);
    const i = this.laserN++ * 12;
    const P = this.laserPos, C = this.laserCols;
    const mid = len * 0.45;
    P[i] = o.x; P[i + 1] = o.y; P[i + 2] = o.z;
    P[i + 3] = P[i + 6] = o.x + dx * mid; P[i + 4] = P[i + 7] = o.y + dy * mid; P[i + 5] = P[i + 8] = o.z + dz * mid;
    P[i + 9] = o.x + dx * len; P[i + 10] = o.y + dy * len; P[i + 11] = o.z + dz * len;
    // moderate HDR: brighter cores turn white in the tone curve and lose their colour
    const b0 = b * 1.6, b1 = b * 0.95, b2 = floorHit ? b * 0.55 : 0;
    C[i] = color.r * b0; C[i + 1] = color.g * b0; C[i + 2] = color.b * b0;
    C[i + 3] = C[i + 6] = color.r * b1; C[i + 4] = C[i + 7] = color.g * b1; C[i + 5] = C[i + 8] = color.b * b1;
    C[i + 9] = color.r * b2; C[i + 10] = color.g * b2; C[i + 11] = color.b * b2;
    if (floorHit && this.dotN < DOTS) {
      const d = this.dotN++ * 3;
      this.dotPos[d] = o.x + dx * len; this.dotPos[d + 1] = 0.02; this.dotPos[d + 2] = o.z + dz * len;
      const k = b * 2.2;
      this.dotCols[d] = color.r * k; this.dotCols[d + 1] = color.g * k; this.dotCols[d + 2] = color.b * k;
    }
    // where the beam crosses the fog it scatters: brighter, and a pixel thicker in the thick of it
    if (this.fog.amount < 0.02) return;
    const n = Math.min(14, Math.max(4, Math.ceil(len / 0.8)));
    const F = this.fogPos, FC = this.fogCols;
    for (let k = 0; k < n && this.fogN < FOG_SEGS - 2; k++) {
      const t0 = (len * k) / n, t1 = (len * (k + 1)) / n, tm = (t0 + t1) / 2;
      const d = this.fog.density(o.x + dx * tm, o.y + dy * tm, o.z + dz * tm);
      if (d < 0.05) continue;
      const g = b * Math.min(1.5, d * 2.4);
      for (let w = 0; w < (d > 0.3 ? 2 : 1); w++) {
        const j = this.fogN++ * 6, up = w * 0.05, gw = w ? g * 0.6 : g;
        F[j] = o.x + dx * t0; F[j + 1] = o.y + dy * t0 + up; F[j + 2] = o.z + dz * t0;
        F[j + 3] = o.x + dx * t1; F[j + 4] = o.y + dy * t1 + up; F[j + 5] = o.z + dz * t1;
        FC[j] = FC[j + 3] = color.r * gw; FC[j + 1] = FC[j + 4] = color.g * gw; FC[j + 2] = FC[j + 5] = color.b * gw;
      }
    }
  }

  private runLaser(prog: LaserProg, f: Feat, I: number, level: number, colIdx: number) {
    if (prog === 'none' || level <= 0.01) return;
    const B = f.beat, col = this.laserCol[colIdx % 2], alt = this.laserCol[(colIdx + 1) % 2];
    const [E0, E1, E2] = this.emitters;
    const speed = 0.5 + I;
    this.reach = 8 + 7 * I;
    // kick flash, stronger the crazier it gets
    const flash = 1 - I * 0.55 * smooth(0.3, 0.0, f.beatFrac) * (1 - f.kick * 0.5);
    switch (prog) {
      case 'sheet': {
        const n = 21;
        const pitch = -0.17 + 0.05 * Math.sin(this.time * 0.35);
        const drift = 0.12 * Math.sin(this.time * 0.13);
        for (let i = 0; i < n; i++) {
          const yaw = drift - 0.68 + (1.36 * i) / (n - 1);
          const sh = 0.75 + 0.25 * Math.sin(this.time * 3 + i * 1.7) * f.high;
          this.beam(E0, yaw, pitch + 0.012 * Math.sin(i * 0.9 + this.time * 0.5), col, level * 0.5 * sh, 9.5);
        }
        break;
      }
      case 'fan': {
        const n = 13;
        const center = 0.5 * Math.sin((TAU * B) / 8);
        const spread = 0.55 + 0.25 * Math.sin((TAU * B) / 16);
        const pitch = -0.26 + 0.08 * Math.sin((TAU * B) / 16 + 1);
        for (let i = 0; i < n; i++) this.beam(E0, center + spread * (i / (n - 1) - 0.5) * 2, pitch, i % 2 ? alt : col, level * flash);
        break;
      }
      case 'cone': {
        const n = 16;
        const radius = f.kind === 'u' ? 0.32 * (1 - f.build) + 0.02 : 0.18 + 0.06 * Math.sin((TAU * B) / 16);
        const spin = f.kind === 'u' ? this.time * (1 + 6 * f.build) : B * 0.6 * speed;
        const ay = 0.15 * Math.sin((TAU * B) / 32), ap = -0.3;
        const chop = f.kind === 'u' ? (Math.floor(B * (1 << Math.floor(f.build * 3))) % 2 ? 0.35 : 1) : flash;
        for (let i = 0; i < n; i++) {
          const a = spin + (i / n) * TAU;
          // a tight bundle adds up to a solid tube, so it gets dimmer as it narrows
          this.beam(E0, ay + radius * Math.cos(a), ap + radius * 0.7 * Math.sin(a), col, level * chop * (0.25 + 0.65 * smooth(0.02, 0.2, radius)));
        }
        break;
      }
      case 'chase': {
        const n = 19;
        const step = Math.floor(B * 2);
        for (let i = 0; i < n; i++) {
          const d = Math.min((step - i + n * 64) % n, (step + i + n * 64) % n);
          const v = d === 0 ? 1 : d === 1 ? 0.35 : 0.08;
          this.beam(E0, -0.75 + (1.5 * i) / (n - 1), -0.22 - 0.06 * Math.sin(i * 0.8), d === 0 ? alt : col, level * v);
        }
        break;
      }
      case 'scissor': {
        const n = 6;
        const sw = Math.sin((TAU * B) / 4);
        for (let i = 0; i < n; i++) {
          const off = (i / (n - 1) - 0.5) * 0.4;
          this.beam(E1, 0.35 + 0.55 * sw + off, -0.34, col, level * flash * 0.85);
          this.beam(E2, -0.35 - 0.55 * sw - off, -0.34, alt, level * flash * 0.85);
        }
        break;
      }
      case 'zigzag': {
        const rate = f.kind === 'u' ? 1 + Math.floor(f.build * 3) : 2;
        const s = Math.sin(Math.PI * B * rate);
        const pitch = f.kind === 'u' ? -0.25 - 0.4 * f.build : -0.4;
        for (let i = -1; i <= 1; i++) {
          this.beam(E1, 0.2 + 0.6 * s + i * 0.07, pitch, alt, level * (i ? 0.5 : 0.9));
          this.beam(E2, -0.2 - 0.6 * s - i * 0.07, pitch, alt, level * (i ? 0.5 : 0.9));
        }
        break;
      }
      case 'burst': {
        // a sunburst from the booth that snaps to a new angle on every beat and opens with the kick
        const n = 24;
        const snap = hash(Math.floor(B) * 7.3) * TAU;
        const open = 0.35 + 0.65 * Math.pow(1 - f.beatFrac, 2);
        for (let i = 0; i < n; i++) {
          const a = snap + (i / n) * TAU;
          this.beam(E0, 0.95 * Math.cos(a) * open, -0.3 + 0.42 * Math.sin(a) * open, i % 3 ? col : alt, level * (0.55 + 0.45 * open));
        }
        break;
      }
      case 'wave': {
        // a ribbon of beams from both sides of the truss that rolls through the room
        const n = 14;
        for (let i = 0; i < n; i++) {
          const u = i / (n - 1);
          const ph = (TAU * B) / 4 + u * TAU * 1.5;
          const pitch = -0.42 + 0.2 * Math.sin(ph);
          const v = level * 0.7 * (0.55 + 0.45 * Math.sin(ph + 1.2));
          this.beam(E1, -0.25 + 1.15 * u, pitch, col, v);
          this.beam(E2, 0.25 - 1.15 * u, pitch, alt, v);
        }
        break;
      }
    }
  }

  private updateLasers(f: Feat, I: number, party: number) {
    this.laserN = 0;
    this.dotN = 0;
    this.fogN = 0;
    this.beamIdx = 0;
    let level: number;
    if (f.kind === 'b') level = 0.55;
    else if (f.kind === 'u') level = 0.55 + 0.45 * f.build;
    else if (f.kind === 'd') level = 1;
    else level = smooth(0.3, 0.6, I);
    // the lasers rest while the mirror ball is the star
    level *= smooth(0.4, 0.9, party) * (1 - this.ballK);
    // opening of a drop: everything fires and chops on eighths
    if (this.flashy && f.sinceDrop < f.beatLen * 4 && Math.floor(f.beat * 2) % 2) level *= 0.15;
    this.runLaser(this.prog.laser, f, I, level, 0);
    this.runLaser(this.prog.laser2, f, I, level * 0.9, 1);
    if (this.mode !== 'soft') this.runLaser(this.prog.laser3, f, I, level * 0.8, 0);
    this.fogGeo.setDrawRange(0, this.fogN * 2);
    this.fogGeo.attributes.position.needsUpdate = true;
    this.fogGeo.attributes.color.needsUpdate = true;
    this.laserGeo.setDrawRange(0, this.laserN * 4);
    this.laserGeo.attributes.position.needsUpdate = true;
    this.laserGeo.attributes.color.needsUpdate = true;
    this.dotGeo.setDrawRange(0, this.dotN);
    this.dotGeo.attributes.position.needsUpdate = true;
    this.dotGeo.attributes.color.needsUpdate = true;
    const lit = this.laserN ? level : 0;
    this.emitterLens.forEach((m, i) => m.color.copy(this.laserCol[i ? 1 : 0]).multiplyScalar(0.25 + 2.2 * lit).lerp(this.tmpC.set('#202024'), 1 - Math.min(1, lit * 3)));
  }

  // ---------- moving heads ----------

  private updateHeads(f: Feat, I: number, hit: number, party: number, dt: number) {
    const show = party > 0.02;
    this.truss.visible = show;
    this.truss.position.y = ROOM.h - 0.22 + (1 - smooth(0, 0.6, party)) * 1.2;
    this.truss.updateMatrixWorld();
    const tp = this.truss.position;
    this.emitters[1].set(tp.x - 1.75, tp.y - 0.24, tp.z + 0.12);
    this.emitters[2].set(tp.x + 1.75, tp.y - 0.24, tp.z + 0.12);
    const c = this.floorC, B = f.beat;
    const dance = this.office.spots.dance ?? [];
    const prog = this.prog.head;
    this.heads.forEach((h, i) => {
      h.cone.visible = h.spot.visible = show;
      this.headLit[i].b = 0;
      if (!show) return;
      h.yoke.getWorldPosition(h.pos);
      h.pos.y -= 0.2;
      const target = this.tmpV;
      switch (prog) {
        case 'rest':
          target.set(h.pos.x, 0, h.pos.z + 1.2);
          break;
        case 'fanout': {
          const a = this.time * 0.18 + i * 1.3;
          target.set(c.x + (i - 1.5) * 1.6 + Math.sin(a) * 0.6, 0, c.z + 1.6 + Math.cos(a * 0.8) * 1.2);
          break;
        }
        case 'circle': {
          const a = (TAU * B) / 8 + (i * TAU) / 4;
          target.set(c.x + Math.cos(a) * 1.5, 0, c.z + 0.2 + Math.sin(a) * 0.9);
          break;
        }
        case 'sweep': {
          const a = (TAU * B) / 8 + i * 0.35;
          target.set(c.x + Math.sin(a) * 3.2, 0, c.z + 1.4 + i * 0.35);
          break;
        }
        case 'crowd': {
          const s = dance.length ? dance[Math.floor(hash(Math.floor(B / 2) * 4 + i) * dance.length)] : null;
          target.set(s ? s.x : c.x, 0, s ? s.z : c.z);
          break;
        }
        case 'dj':
          target.set(this.booth.x + (i - 1.5) * 0.25 * (1 - f.build), 0, this.booth.z + 0.6 + (1 - f.build) * 0.8);
          break;
      }
      h.aim.lerp(target, Math.min(1, dt * (prog === 'crowd' ? 9 : 3)));
      const dir = this.dir.subVectors(h.aim, h.pos);
      const len = dir.length();
      dir.normalize();
      h.cone.position.copy(h.pos);
      h.cone.quaternion.setFromUnitVectors(DOWN, dir);
      const spread = f.kind === 'u' ? 0.16 - 0.1 * f.build : 0.13;
      const r = len * spread;
      h.cone.scale.set(r, len, r);
      h.yoke.rotation.set(0, 0, 0);
      h.yoke.lookAt(h.aim);
      h.yoke.rotateX(-Math.PI / 2);
      h.spot.position.set(h.aim.x, 0.012, h.aim.z);
      h.spot.scale.set(r, 1, r / Math.max(0.35, -dir.y));
      h.spot.rotation.y = Math.atan2(dir.x, dir.z);

      let b: number;
      if (f.kind === 'b') b = 0.45 + 0.15 * Math.sin(this.time * 0.8 + i);
      else if (f.kind === 'u') b = 0.4 + 0.6 * f.build * (Math.floor(B * 4) % 4 === i ? 1 : 0.5);
      else b = 0.35 + 0.45 * I + hit * (0.4 + 0.7 * I) * ((Math.floor(B) + i) % 2 ? 1 : 0.4);
      const opening = f.sinceDrop < f.beatLen * 4 && this.mode === 'full';
      if (opening) b = 1.3;
      b *= party * (1 - 0.7 * this.ballK) * (this.mode === 'soft' ? 0.75 : 1);
      const col = opening ? this.tmpC.set('#ffffff') : this.tmpC.copy(this.wash[(i + Math.floor(B / 8)) % 3]);
      h.coneMat.color.copy(col);
      // fog in the beam makes the whole cone stand out
      const haze = this.fog.density(h.pos.x + dir.x * len * 0.7, h.pos.y + dir.y * len * 0.7, h.pos.z + dir.z * len * 0.7);
      h.coneMat.opacity = 0.15 * b * (1 + 2.2 * Math.min(1, haze * 1.6));
      const lit = this.headLit[i];
      lit.col.copy(col);
      lit.b = b;
      lit.r = spread;
      h.spotMat.color.copy(col);
      h.spotMat.opacity = 0.55 * b;
      h.lens.color.copy(col).multiplyScalar(0.4 + 2 * b);
    });
  }

  // ---------- mirror ball ----------

  /**
   * The mirror ball comes down for the calm passages: a breakdown that lasts (it is gone again two seconds before
   * the kick is back), a long quiet stretch, and the lo-fi radio at night. It leaves when the energy returns.
   */
  private updateBallState(f: Feat, I: number, yt: boolean, lofi: boolean, dt: number) {
    this.quietT = yt && f.kind === 'g' && I < (this.ballK > 0.5 ? 0.38 : 0.3) ? this.quietT + dt : 0;
    const set = yt && this.party > 0.5 && ((f.kind === 'b' && f.secLen >= 8 && f.secLeft > 2) || this.quietT > 4);
    const calm = this.mode !== 'off' && (set || (lofi && this.night > 0.6));
    this.ballK = THREE.MathUtils.clamp(this.ballK + (calm ? dt / 2.4 : -dt / 1.3), 0, 1);
  }

  private updateBall(f: Feat, lofi: boolean) {
    const ball = this.office.party.ball;
    const k = smooth(0, 1, this.ballK);
    ball.visible = this.ballK > 0.01;
    if (!ball.visible) {
      this.specks.geo.setDrawRange(0, 0);
      return;
    }
    // one slow turn in about 20 s: the dots wander, they do not race
    ball.rotation.y = this.time * 0.32;
    ball.position.y = ROOM.h - 0.85 + (1 - k) * 1.9;
    const S = this.specks;
    const level = smooth(0.55, 1, this.ballK) * (lofi ? 0.6 : 1);
    if (this.ballMat) this.ballMat.emissive.setRGB(0.19, 0.2, 0.24).multiplyScalar(1 + level * 0.9);
    if (level < 0.02) {
      S.geo.setDrawRange(0, 0);
      return;
    }
    ball.updateMatrixWorld();
    const c = ball.getWorldPosition(this.tmpV.set(0, 0, 0));
    const cx = c.x, cy = c.y, cz = c.z;
    const rot = ball.rotation.y;
    const cr = Math.cos(rot), sr = Math.sin(rot);
    let n = 0;
    for (let i = 0; i < SPECKS; i++) {
      const d = S.dirs[i];
      const dx = d.x * cr + d.z * sr, dy = d.y, dz = -d.x * sr + d.z * cr;
      let t = Infinity, onFloor = false;
      if (dy < -0.02) {
        t = cy / -dy;
        onFloor = true;
      }
      if (dz < -0.02) {
        const tw = (ROOM.minZ + 0.06 - cz) / dz;
        if (tw < t) {
          t = tw;
          onFloor = false;
        }
      }
      if (!Number.isFinite(t) || t > 11) continue;
      const x = cx + dx * t, y = onFloor ? 0.02 : cy + dy * t, z = cz + dz * t;
      if (x < ROOM.minX || x > ROOM.maxX || z > ROOM.maxZ || y > ROOM.h) continue;
      const tw = 0.55 + 0.45 * Math.sin(this.time * 7 + S.tw[i] + f.high * 3);
      const k = level * tw * (1 - t / 11) * 2.4;
      S.pos[n * 3] = x; S.pos[n * 3 + 1] = y; S.pos[n * 3 + 2] = z;
      const w = this.wash[i % 3];
      S.col[n * 3] = (0.75 + 0.25 * w.r) * k; S.col[n * 3 + 1] = (0.75 + 0.25 * w.g) * k; S.col[n * 3 + 2] = (0.8 + 0.2 * w.b) * k;
      n++;
    }
    S.geo.setDrawRange(0, n);
    S.geo.attributes.position.needsUpdate = true;
    S.geo.attributes.color.needsUpdate = true;
  }

  // ---------- LED floor ----------

  private updateTiles(f: Feat, I: number, hit: number, party: number) {
    const T = this.tiles;
    T.mesh.visible = party > 0.02;
    if (!T.mesh.visible) return;
    const B = f.beat, step = Math.floor(B), eighth = Math.floor(B * 2);
    for (let z = 0; z < TILE_Z; z++)
      for (let x = 0; x < TILE_X; x++) {
        const k = z * TILE_X + x;
        let v: number;
        if (f.kind === 'b') v = 0.25 + 0.2 * Math.sin(this.time * 1.2 - (x + z) * 0.7);
        else if (f.kind === 'u') v = x / (TILE_X - 1) <= f.build ? 0.5 + 0.5 * (eighth % 2) : 0.08;
        else if (I > 0.72) v = hash(eighth * 31 + k) > 0.55 ? 0.55 + hit * 0.45 : 0.06;
        else v = (x + z + step) % 2 ? 0.25 + hit * 0.75 : 0.06;
        T.level[k] = v * party * (0.6 + 0.6 * I + (f.kind === 'b' ? 0.2 : 0)) * (this.mode === 'soft' ? 0.7 : 1);
      }
    const W = TILE_X * TILE_PX;
    for (let py = 0; py < TILE_Z * TILE_PX; py++)
      for (let px = 0; px < W; px++) {
        const o = (py * W + px) * 4;
        const gap = px % TILE_PX === 0 || py % TILE_PX === 0;
        const tx = Math.floor(px / TILE_PX), tz = Math.floor(py / TILE_PX);
        const v = gap ? 0 : T.level[tz * TILE_X + tx];
        const c = this.wash[(tx + tz + Math.floor(B / 4)) % 3];
        T.data[o] = Math.min(255, c.r * v * 255);
        T.data[o + 1] = Math.min(255, c.g * v * 255);
        T.data[o + 2] = Math.min(255, c.b * v * 255);
        T.data[o + 3] = 255;
      }
    T.tex.needsUpdate = true;
  }

  // ---------- strobe ----------

  /** seconds since the music last slammed back in: a drop, or the kick returning hard after a breakdown or build */
  private sinceSlam(f: Feat) {
    return Math.min(f.sinceDrop, this.time - this.kickInAt);
  }

  private updateStrobe(f: Feat, party: number, dt: number) {
    // The strobe is saved for the moments a track asks for it: the two bars after a drop, the bar where the
    // kick comes back after a breakdown, and the last stretch of a build-up. No routine flashing at peaks.
    // At most one flash per beat and never more than 3 per second (the photosensitivity limit for large areas).
    // (the kick-in itself is noticed in track())
    let k = 0;
    if (f.sinceDrop < f.beatLen * 8) k = f.sinceDrop < f.beatLen * 4 ? 1 : 0.7;
    else if (this.time - this.kickInAt < f.beatLen * 4) k = 0.75;
    else if (f.kind === 'u' && f.build > 0.82) k = 0.3 + 0.5 * smooth(0.82, 1, f.build);
    // never with the strobe setting off or outside the full show, and not while the mirror ball is down
    if (!this.flashy || this.ballK > 0.6) k = 0;
    if (!this.flashy) this.strobeT = 0;
    const beat = Math.floor(f.beat);
    // fast tempos flash on every other beat to stay under the limit
    const every = f.beatLen > 0.34 ? 1 : 2;
    if (k > 0 && f.beatFrac < 0.15 && beat !== this.strobeBeat && beat % every === 0) {
      this.strobeBeat = beat;
      this.strobeK = k;
      this.strobeT = 1;
    } else this.strobeT = Math.max(0, this.strobeT - dt * 14);
    const v = this.strobeT * this.strobeK * party;
    this.strobe.intensity = v * 20;
    this.strobeLens.color.setRGB(0.12 + v * 4, 0.12 + v * 4, 0.13 + v * 4.2);
  }

  // ---------- lo-fi ----------

  private updateLofi(f: Feat, dt: number, yt: boolean) {
    // a faint warm glow at the booth that breathes with the radio, never pulses
    const target = !yt && this.player.playing && this.player.current.kind === 'lofi' ? 0.25 + 0.55 * (0.6 * f.low + 0.4 * f.mid) : 0;
    const rate = target > this.glow.intensity ? 1.2 : 0.6;
    this.glow.intensity = ease(this.glow.intensity, target, rate, dt);
  }

  dispose() {
    this.scene.remove(this.group);
    this.analyser?.disconnect();
    for (const off of this.off) off();
  }
}

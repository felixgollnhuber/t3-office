import * as THREE from 'three';
import { FX_LAYER } from './pixel';
import { ROOM } from './office';

// back-wall window layout, mirrors buildOffice()
const WINDOWS = [-10, -4.5, 1.2, 6.6, 11.2];
const WIN_W = 3.1, SILL = 0.95, TOP = 2.95, WALL_T = 0.3;
const GLASS_Z = ROOM.minZ - WALL_T / 2;
const OUT_Z = ROOM.minZ - WALL_T;
const BACKDROP_Z = ROOM.minZ - 0.9;

/** the shader clock wraps every LOOP seconds, so every rate is a whole number of cycles per LOOP */
const LOOP = 60;
/**
 * Drops start just above the window head as seen from the camera (the wall above the window hides the spawn
 * and the tail) and fall far enough to clear the sill.
 */
const TOP_Y = TOP + 0.06, RANGE = TOP - SILL + 0.4;
const MAX_DROPS = 460;
const MAX_SPLASH = 30;
const MAX_FLAKES = 640;
/**
 * Rain and snow only fall where there are windows to see them through: from the west end of the wall to a bit
 * past the last window (the wind carries them west on the way down). The east wing has a blind back wall.
 */
const FALL_MAX_X = WINDOWS[WINDOWS.length - 1] + WIN_W / 2 + 1.0;

const f = (n: number) => n.toFixed(4);

const vertex = /* glsl */ `
attribute vec4 aA; // drop: x, z, phase, cycles/s   splash: window x, z, phase, cycles/s
attribute vec4 aB; // drop: length px, alpha, 0, near   splash: seed, alpha, 1, direction
uniform float uTime, uWind, uLen;
uniform vec4 uGrid; // art pixel size (x, y) and left/bottom edge of the view, in view space
varying float vRow, vLen, vAlpha, vNear;

float hash(float n) { return fract(sin(n * 12.9898) * 43758.5453); }

void main() {
  vec2 c = position.xy; // x: -0.5..0.5 across the streak, y: 0 at the head .. 1 at the tail
  vec3 p;
  vec2 shift = vec2(0.0);
  float len = 1.0, slope = 0.0;
  vAlpha = aB.y;
  vNear = aB.w;
  if (aB.z < 0.5) {
    // the sight line climbs on its way back to the wall, so deeper drops have to start lower
    vec3 toCam = vec3(viewMatrix[0][2], viewMatrix[1][2], viewMatrix[2][2]);
    float rise = (${f(OUT_Z)} - aA.y) * toCam.y / max(toCam.z, 0.05);
    float fall = fract(aA.z + uTime * aA.w) * ${f(RANGE)};
    p = vec3(aA.x + uWind * fall, ${f(TOP_Y)} - rise - fall, aA.y);
    len = max(1.0, floor(aB.x * uLen + 0.5));
    vec2 d = (viewMatrix * vec4(uWind, -1.0, 0.0, 0.0)).xy / uGrid.xy;
    slope = d.x / -d.y;
  } else {
    float period = 1.0 / aA.w;
    float clock = uTime + aA.z * period;
    float life = mod(clock, period) / 0.2;
    float k = floor(clock / period);
    float x = aA.x + (hash(k * 1.37 + aB.x * 91.7) - 0.5) * ${f(WIN_W - 0.3)};
    p = vec3(x, ${f(SILL + 0.06)}, aA.y);
    float dir = aB.w;
    vNear = 1.0;
    if (abs(dir) < 0.5) {
      if (life > 0.3) c = vec2(0.0);
    } else {
      if (life > 1.0) c = vec2(0.0);
      shift = vec2(dir * floor(1.0 + life * 2.2), floor(sin(life * 3.1416) * 3.4));
      vAlpha *= 1.0 - 0.5 * life;
    }
  }
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  // lock the head to the art-pixel grid: x on a pixel center, y on a pixel's bottom edge
  vec2 cell = floor((mv.xy - uGrid.zw) / uGrid.xy);
  vec2 head = uGrid.zw + (cell + vec2(0.5, 0.0) + shift) * uGrid.xy;
  // exactly one pixel wide on every row, so the streak never shimmers between 0 and 2 px
  mv.xy = head + vec2(c.x - slope * c.y * len, c.y * len) * uGrid.xy;
  vRow = c.y;
  vLen = len;
  gl_Position = projectionMatrix * mv;
}
`;

const fragment = /* glsl */ `
uniform vec3 uNear, uFar;
uniform float uOpacity;
varying float vRow, vLen, vAlpha, vNear;

void main() {
  float row = floor(vRow * vLen);
  float a = vAlpha * (row < 0.5 ? 1.0 : mix(0.72, 0.3, (row - 1.0) / max(vLen - 2.0, 1.0)));
  gl_FragColor = vec4(mix(uFar, uNear, vNear), a * uOpacity);
}
`;

function mulberry(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const DAY_NEAR = new THREE.Color('#f4f8ff');
// a touch darker than the overcast sky, so the far layer still reads against it
const DAY_FAR = new THREE.Color('#8e9fb8');
const NIGHT_NEAR = new THREE.Color('#7d8aa2');
const NIGHT_FAR = new THREE.Color('#3c4760');
const FLASH = new THREE.Color('#f6f8ff');

/** Rain outside the back-wall windows: pixel-locked streaks, sill splashes and beads running down the glass. */
export class Rain {
  private t = 0;
  private uniforms: Record<string, THREE.IUniform>;
  private drops: THREE.Mesh<THREE.InstancedBufferGeometry, THREE.ShaderMaterial>;
  private splashes: THREE.Mesh<THREE.InstancedBufferGeometry, THREE.ShaderMaterial>;
  private beads = new GlassBeads();
  private snow: Snowfall;

  /** how much snow lies on the sills and the land outside, 0..1 */
  get snowCover() {
    return this.snow.cover;
  }

  constructor(scene: THREE.Scene) {
    this.snow = new Snowfall(scene);
    const rnd = mulberry(1307);
    this.uniforms = {
      uTime: { value: 0 },
      uWind: { value: -0.2 },
      uLen: { value: 1 },
      uGrid: { value: new THREE.Vector4(0.03, 0.03, 0, 0) },
      uNear: { value: DAY_NEAR.clone() },
      uFar: { value: DAY_FAR.clone() },
      uOpacity: { value: 1 },
    };
    const mat = new THREE.ShaderMaterial({
      vertexShader: vertex,
      fragmentShader: fragment,
      uniforms: this.uniforms,
      transparent: true,
      depthWrite: false,
    });

    const a: number[] = [], b: number[] = [];
    for (let i = 0; i < MAX_DROPS; i++) {
      const near = rnd() < 0.42;
      const z = near ? OUT_Z - 0.04 - rnd() * 0.2 : OUT_Z - 0.3 - rnd() * (OUT_Z - 0.3 - (BACKDROP_Z + 0.05));
      // past the east end of the wall nothing hides the drops, so keep them where the wall still covers them
      const xMax = Math.min(ROOM.maxX - 0.1 - (OUT_Z - z) * 2, FALL_MAX_X);
      const x = ROOM.minX + 0.4 + rnd() * (xMax - ROOM.minX - 0.4);
      const speed = near ? 9.5 + rnd() * 3 : 6.2 + rnd() * 2;
      a.push(x, z, rnd(), Math.round((speed / RANGE) * LOOP) / LOOP);
      b.push(near ? 4 + rnd() * 3.4 : 2 + rnd() * 1.8, near ? 0.5 + rnd() * 0.3 : 0.24 + rnd() * 0.16, 0, near ? 1 : 0);
    }
    this.drops = this.mesh(mat, a, b);

    const sa: number[] = [], sb: number[] = [];
    for (let i = 0; i < MAX_SPLASH; i++) {
      const wx = WINDOWS[i % WINDOWS.length];
      const z = OUT_Z - 0.03;
      const phase = rnd(), seed = rnd() * 100;
      const cycles = (36 + Math.floor(rnd() * 40)) / LOOP;
      for (const dir of [0, -1, 1]) {
        sa.push(wx, z, phase, cycles);
        sb.push(seed, dir === 0 ? 0.75 : 0.6, 1, dir);
      }
    }
    this.splashes = this.mesh(mat, sa, sb);

    this.drops.onBeforeRender = (renderer, _scene, camera) => {
      const cam = camera as THREE.OrthographicCamera;
      if (!cam.isOrthographicCamera) return;
      const rt = renderer.getRenderTarget();
      const w = rt ? rt.width : renderer.domElement.width;
      const h = rt ? rt.height : renderer.domElement.height;
      const dx = (cam.right - cam.left) / (2 * cam.zoom), dy = (cam.top - cam.bottom) / (2 * cam.zoom);
      const cx = (cam.right + cam.left) / 2, cy = (cam.top + cam.bottom) / 2;
      (this.uniforms.uGrid.value as THREE.Vector4).set((2 * dx) / w, (2 * dy) / h, cx - dx, cy - dy);
      mat.uniformsNeedUpdate = true;
    };

    scene.add(this.drops, this.splashes);
    for (const m of this.beads.meshes) scene.add(m);
  }

  private mesh(mat: THREE.ShaderMaterial, a: number[], b: number[]) {
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, 0, 0, 0.5, 0, 0, 0.5, 1, 0, -0.5, 1, 0], 3));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    g.setAttribute('aA', new THREE.InstancedBufferAttribute(new Float32Array(a), 4));
    g.setAttribute('aB', new THREE.InstancedBufferAttribute(new Float32Array(b), 4));
    g.instanceCount = 0;
    const m = new THREE.Mesh(g, mat);
    m.frustumCulled = false;
    // drawn before the glass panes, which sit in front of it
    m.renderOrder = -1;
    m.layers.set(FX_LAYER);
    m.visible = false;
    return m;
  }

  /** rain, flash and snow 0..1, night 0 (day) .. 1 (dark) */
  update(dt: number, rain: number, flash: number, night: number, snow = 0) {
    this.t = (this.t + dt) % LOOP;
    this.snow.update(dt, this.t, snow, night);
    const r = THREE.MathUtils.clamp(rain, 0, 1);
    const on = r > 0.015;
    this.drops.visible = this.splashes.visible = on;
    this.beads.update(dt, r, flash, night);
    if (!on) return;

    this.drops.geometry.instanceCount = Math.round(MAX_DROPS * Math.pow(r, 0.85));
    this.splashes.geometry.instanceCount = 3 * Math.round(MAX_SPLASH * THREE.MathUtils.smoothstep(r, 0.2, 1));
    const u = this.uniforms;
    u.uTime.value = this.t;
    // gentle gusts; the period divides LOOP so the wrap stays seamless
    const gust = 1 + 0.18 * Math.sin((this.t / LOOP) * Math.PI * 2 * 4) + 0.08 * Math.sin((this.t / LOOP) * Math.PI * 2 * 11);
    u.uWind.value = -(0.1 + 0.3 * r * r) * gust;
    u.uLen.value = 0.9 + 0.4 * r;
    u.uOpacity.value = THREE.MathUtils.smoothstep(r, 0.015, 0.25) * (1 + 0.6 * flash);
    (u.uNear.value as THREE.Color).copy(DAY_NEAR).lerp(NIGHT_NEAR, night).lerp(FLASH, Math.min(1, flash * 0.9));
    (u.uFar.value as THREE.Color).copy(DAY_FAR).lerp(NIGHT_FAR, night).lerp(FLASH, Math.min(1, flash * 0.6));
  }
}

const snowVertex = /* glsl */ `
attribute vec4 aA; // x, z, phase, cycles/s
attribute vec4 aB; // size px, alpha, sway (world units), sway cycles per loop
uniform float uTime, uWind;
uniform vec4 uGrid; // art pixel size (x, y) and left/bottom edge of the view, in view space
varying vec2 vPx;
varying float vSize, vAlpha;

void main() {
  vec3 toCam = vec3(viewMatrix[0][2], viewMatrix[1][2], viewMatrix[2][2]);
  float rise = (${f(OUT_Z)} - aA.y) * toCam.y / max(toCam.z, 0.05);
  float fall = fract(aA.z + uTime * aA.w) * ${f(RANGE)};
  // flakes do not fall straight: each one swings on its own slow sine
  float sway = sin(6.2832 * (aB.w * uTime / ${f(LOOP)} + aA.z * 5.0)) * aB.z;
  vec3 p = vec3(aA.x + uWind * fall + sway, ${f(TOP_Y)} - rise - fall, aA.y);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  // whole art pixels only: a flake is a 1, 2 or 3 pixel square that hops from cell to cell
  vec2 cell = floor((mv.xy - uGrid.zw) / uGrid.xy);
  vec2 c = position.xy + vec2(0.5, 0.0);
  mv.xy = uGrid.zw + (cell + c * aB.x) * uGrid.xy;
  vPx = c * aB.x;
  vSize = aB.x;
  vAlpha = aB.y;
  gl_Position = projectionMatrix * mv;
}
`;

const snowFragment = /* glsl */ `
uniform vec3 uNear, uFar;
uniform float uOpacity;
varying vec2 vPx;
varying float vSize, vAlpha;

void main() {
  vec2 px = floor(vPx);
  // the big ones are a plus, not a block
  if (vSize > 2.5 && mod(px.x + px.y, 2.0) < 0.5) discard;
  gl_FragColor = vec4(mix(uFar, uNear, step(1.5, vSize)), vAlpha * uOpacity);
}
`;

const SNOW_DAY_NEAR = new THREE.Color('#ffffff');
const SNOW_DAY_FAR = new THREE.Color('#eef2f8');
const SNOW_NIGHT_NEAR = new THREE.Color('#aab4c8');
const SNOW_NIGHT_FAR = new THREE.Color('#5d6880');
const SILL_DAY = new THREE.Color('#f6f9ff');
const SILL_NIGHT = new THREE.Color('#5f6c8c');
const SILL_SHADE = 0.86;

/** Snow outside the back-wall windows: slow pixel flakes that drift, and snow that settles on the outer sills. */
class Snowfall {
  /** how much has settled, 0..1: takes about a minute of steady snow, melts in a few */
  cover = -1;
  private uniforms: Record<string, THREE.IUniform>;
  private flakes: THREE.Mesh<THREE.InstancedBufferGeometry, THREE.ShaderMaterial>;
  private sills = new THREE.Group();
  private sillMat = new THREE.MeshBasicMaterial({ color: SILL_DAY.clone(), fog: false });
  private sillShade = new THREE.MeshBasicMaterial({ color: SILL_DAY.clone(), fog: false });

  constructor(scene: THREE.Scene) {
    const rnd = mulberry(4711);
    this.uniforms = {
      uTime: { value: 0 },
      uWind: { value: -0.15 },
      uGrid: { value: new THREE.Vector4(0.03, 0.03, 0, 0) },
      uNear: { value: SNOW_DAY_NEAR.clone() },
      uFar: { value: SNOW_DAY_FAR.clone() },
      uOpacity: { value: 1 },
    };
    const mat = new THREE.ShaderMaterial({ vertexShader: snowVertex, fragmentShader: snowFragment, uniforms: this.uniforms, transparent: true, depthWrite: false });
    const a: number[] = [], b: number[] = [];
    for (let i = 0; i < MAX_FLAKES; i++) {
      const near = rnd() < 0.4;
      const z = near ? OUT_Z - 0.04 - rnd() * 0.2 : OUT_Z - 0.3 - rnd() * (OUT_Z - 0.3 - (BACKDROP_Z + 0.05));
      const x = ROOM.minX + 0.4 + rnd() * (FALL_MAX_X - ROOM.minX - 0.4);
      const speed = near ? 0.75 + rnd() * 0.6 : 0.4 + rnd() * 0.45;
      a.push(x, z, rnd(), Math.max(1, Math.round((speed / RANGE) * LOOP)) / LOOP);
      const size = near ? (rnd() < 0.3 ? 3 : 2) : 1;
      b.push(size, near ? 0.85 + rnd() * 0.15 : 0.55 + rnd() * 0.3, 0.05 + rnd() * 0.14, 5 + Math.floor(rnd() * 12));
    }
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, 0, 0, 0.5, 0, 0, 0.5, 1, 0, -0.5, 1, 0], 3));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    g.setAttribute('aA', new THREE.InstancedBufferAttribute(new Float32Array(a), 4));
    g.setAttribute('aB', new THREE.InstancedBufferAttribute(new Float32Array(b), 4));
    g.instanceCount = 0;
    this.flakes = new THREE.Mesh(g, mat);
    this.flakes.frustumCulled = false;
    this.flakes.renderOrder = -1;
    this.flakes.layers.set(FX_LAYER);
    this.flakes.visible = false;
    this.flakes.onBeforeRender = (renderer, _scene, camera) => {
      const cam = camera as THREE.OrthographicCamera;
      if (!cam.isOrthographicCamera) return;
      const rt = renderer.getRenderTarget();
      const w = rt ? rt.width : renderer.domElement.width;
      const h = rt ? rt.height : renderer.domElement.height;
      const dx = (cam.right - cam.left) / (2 * cam.zoom), dy = (cam.top - cam.bottom) / (2 * cam.zoom);
      const cx = (cam.right + cam.left) / 2, cy = (cam.top + cam.bottom) / 2;
      (this.uniforms.uGrid.value as THREE.Vector4).set((2 * dx) / w, (2 * dy) / h, cx - dx, cy - dy);
      mat.uniformsNeedUpdate = true;
    };
    scene.add(this.flakes);

    // a lumpy white ridge on the outer sill of every window, growing from the bottom of the opening
    const LUMPS = 9, depth = WALL_T / 2 - 0.02;
    for (const wx of WINDOWS) {
      for (let i = 0; i < LUMPS; i++) {
        const w = WIN_W / LUMPS;
        const hgt = 0.07 + rnd() * 0.07 + (i === 0 || i === LUMPS - 1 ? 0.05 : 0);
        const lump = new THREE.Mesh(new THREE.BoxGeometry(w, hgt, depth), i % 2 ? this.sillMat : this.sillShade);
        lump.geometry.translate(0, hgt / 2, 0);
        lump.position.set(wx - WIN_W / 2 + w * (i + 0.5), SILL, (OUT_Z + GLASS_Z) / 2 - 0.01);
        this.sills.add(lump);
      }
    }
    this.sills.traverse((c) => c.layers.set(FX_LAYER));
    this.sills.visible = false;
    scene.add(this.sills);
  }

  update(dt: number, t: number, snow: number, night: number) {
    const s = THREE.MathUtils.clamp(snow, 0, 1);
    // a page that opens into snowfall finds some snow already on the ground
    if (this.cover < 0) this.cover = s > 0.3 ? 0.7 : 0;
    this.cover = THREE.MathUtils.clamp(this.cover + (s > 0.12 ? (dt / 70) * (s / 0.7) : s < 0.04 ? -dt / 200 : 0), 0, 1);
    this.sills.visible = this.cover > 0.04;
    if (this.sills.visible) {
      this.sills.scale.y = THREE.MathUtils.smoothstep(this.cover, 0.04, 1);
      this.sills.position.y = SILL * (1 - this.sills.scale.y);
      this.sillMat.color.copy(SILL_DAY).lerp(SILL_NIGHT, night);
      this.sillShade.color.copy(this.sillMat.color).multiplyScalar(SILL_SHADE);
    }
    const on = s > 0.015;
    this.flakes.visible = on;
    if (!on) return;
    this.flakes.geometry.instanceCount = Math.round(MAX_FLAKES * Math.pow(s, 0.8));
    const u = this.uniforms;
    u.uTime.value = t;
    const gust = 1 + 0.5 * Math.sin((t / LOOP) * Math.PI * 2 * 3) + 0.25 * Math.sin((t / LOOP) * Math.PI * 2 * 7);
    u.uWind.value = -(0.08 + 0.22 * s) * gust;
    u.uOpacity.value = THREE.MathUtils.smoothstep(s, 0.015, 0.2);
    (u.uNear.value as THREE.Color).copy(SNOW_DAY_NEAR).lerp(SNOW_NIGHT_NEAR, night);
    (u.uFar.value as THREE.Color).copy(SNOW_DAY_FAR).lerp(SNOW_NIGHT_FAR, night);
  }
}

interface Bead {
  x: number;
  y: number;
  /** 1 tiny, 2 bead, 3 fat bead that runs */
  r: number;
  v: number;
  slide: boolean;
  /** texels travelled since the last bit of water was left behind */
  run: number;
  trail?: Trail;
}

interface Trail {
  x: number;
  y0: number;
  y1: number;
  age: number;
}

const TW = 64, TH = 50;
const STEP = 1 / 30;
const TRAIL_LIFE = 3.5;
const BEAD_NIGHT = new THREE.Color('#a3abbd').multiplyScalar(0.42);

/** Water beads on the outside of the panes, simulated on a tiny canvas at 30 fps. */
class GlassBeads {
  readonly meshes: THREE.Mesh[] = [];
  private g: CanvasRenderingContext2D;
  private tex: THREE.CanvasTexture;
  private mat: THREE.MeshBasicMaterial;
  private panes: { beads: Bead[]; trails: Trail[] }[] = WINDOWS.map(() => ({ beads: [], trails: [] }));
  private acc = 0;
  private wet = -1;
  private rnd = mulberry(77);

  constructor() {
    const c = document.createElement('canvas');
    c.width = TW * WINDOWS.length;
    c.height = TH;
    this.g = c.getContext('2d')!;
    this.tex = new THREE.CanvasTexture(c);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.tex.magFilter = this.tex.minFilter = THREE.NearestFilter;
    this.tex.generateMipmaps = false;
    this.mat = new THREE.MeshBasicMaterial({ map: this.tex, transparent: true, depthWrite: false, fog: false });
    WINDOWS.forEach((wx, i) => {
      const geo = new THREE.PlaneGeometry(WIN_W, TOP - SILL);
      const uv = geo.attributes.uv as THREE.BufferAttribute;
      for (let k = 0; k < uv.count; k++) uv.setX(k, (i + uv.getX(k)) / WINDOWS.length);
      const m = new THREE.Mesh(geo, this.mat);
      // just on the room side of the pane, so it sorts after the glass
      m.position.set(wx, (SILL + TOP) / 2, GLASS_Z + 0.006);
      m.layers.set(FX_LAYER);
      m.visible = false;
      this.meshes.push(m);
    });
  }

  update(dt: number, rain: number, flash: number, night: number) {
    if (this.wet < 0) {
      this.wet = rain;
      for (let i = 0; i < 300 * rain; i++) this.step(rain, true);
    }
    // the glass dries slower than it gets wet
    this.wet += (rain - this.wet) * Math.min(1, dt * (rain > this.wet ? 0.4 : 0.05));
    const show = this.wet > 0.02;
    for (const m of this.meshes) m.visible = show;
    if (!show) return;
    this.mat.opacity = THREE.MathUtils.smoothstep(this.wet, 0.02, 0.3);
    this.mat.color.set('#ffffff').lerp(BEAD_NIGHT, night).lerp(FLASH, Math.min(1, flash));

    this.acc += dt;
    if (this.acc < STEP) return;
    const n = Math.min(3, Math.floor(this.acc / STEP));
    this.acc -= n * STEP;
    for (let i = 0; i < n; i++) this.step(rain, false);
    this.draw();
  }

  private step(rain: number, warm: boolean) {
    const rnd = this.rnd;
    for (const pane of this.panes) {
      const { beads, trails } = pane;
      if (rnd() < rain * 5 * STEP) {
        const x = Math.floor(rnd() * (TW - 2)), y = Math.floor(rnd() * (TH - 3));
        const hit = beads.find((b) => !b.slide && Math.abs(b.x - x) <= b.r && Math.abs(b.y - y) <= b.r);
        if (hit) hit.r = Math.min(3, hit.r + 1);
        else if (beads.length < 5 + 22 * rain) beads.push({ x, y, r: rnd() < 0.72 ? 1 : 2, v: 0, slide: false, run: 0 });
      }
      for (let i = beads.length - 1; i >= 0; i--) {
        const b = beads[i];
        if (!b.slide) {
          // evaporate when it stops raining
          if (rnd() < (1 - rain) * 0.12 * STEP) beads.splice(i, 1);
          else if (!warm && rnd() < (b.r === 3 ? 0.9 : b.r === 2 ? 0.012 : 0) * STEP) {
            b.slide = true;
            b.v = 2;
          }
          continue;
        }
        b.v = Math.min(8 + b.r * 7, b.v + 30 * STEP);
        const y0 = b.y;
        b.y += b.v * STEP;
        b.run += b.y - y0;
        if (rnd() < 0.05) {
          b.x = THREE.MathUtils.clamp(b.x + (rnd() < 0.5 ? -1 : 1), 0, TW - b.r);
          b.trail = undefined;
        }
        const tx = b.x + (b.r === 3 ? 1 : 0);
        if (!b.trail) {
          b.trail = { x: tx, y0: Math.floor(y0), y1: Math.floor(b.y), age: 0 };
          trails.push(b.trail);
        } else {
          b.trail.y1 = Math.floor(b.y);
          b.trail.age = 0;
        }
        for (let j = beads.length - 1; j >= 0; j--) {
          const o = beads[j];
          if (o === b || o.slide || Math.abs(o.x - b.x) > 1 || o.y < y0 || o.y > b.y + b.r) continue;
          beads.splice(j, 1);
          if (j < i) i--;
          b.r = Math.min(3, b.r + 1);
        }
        if (b.run > 9 + rnd() * 10) {
          b.run = 0;
          if (rnd() < 0.5) beads.push({ x: tx, y: Math.max(0, Math.floor(b.y) - 2), r: 1, v: 0, slide: false, run: 0 });
          b.r--;
          if (b.r < 2) {
            b.slide = false;
            b.r = 1;
            b.y = Math.floor(b.y);
            b.trail = undefined;
          }
        }
        if (b.y > TH) beads.splice(beads.indexOf(b), 1);
      }
      for (let i = trails.length - 1; i >= 0; i--) {
        trails[i].age += STEP;
        if (trails[i].age > TRAIL_LIFE) trails.splice(i, 1);
      }
    }
  }

  private draw() {
    const g = this.g;
    g.clearRect(0, 0, g.canvas.width, g.canvas.height);
    const px = (x: number, y: number, c: string) => {
      g.fillStyle = c;
      g.fillRect(x, y, 1, 1);
    };
    this.panes.forEach(({ beads, trails }, i) => {
      const ox = i * TW;
      for (const t of trails) {
        g.fillStyle = `rgba(205,220,240,${(0.32 * (1 - t.age / TRAIL_LIFE)).toFixed(3)})`;
        g.fillRect(ox + t.x, t.y0, 1, Math.max(1, t.y1 - t.y0));
      }
      for (const b of beads) {
        const x = ox + b.x, y = Math.floor(b.y);
        if (b.r === 1) px(x, y, 'rgba(225,236,252,0.55)');
        else if (b.r === 2) {
          px(x, y, 'rgba(255,255,255,0.9)');
          px(x + 1, y, 'rgba(185,205,232,0.55)');
          px(x, y + 1, 'rgba(185,205,232,0.55)');
          px(x + 1, y + 1, 'rgba(60,80,112,0.5)');
        } else {
          px(x + 1, y, 'rgba(200,218,240,0.6)');
          px(x, y + 1, 'rgba(255,255,255,0.92)');
          px(x + 1, y + 1, 'rgba(185,205,232,0.6)');
          px(x + 2, y + 1, 'rgba(160,182,212,0.55)');
          px(x + 1, y + 2, 'rgba(55,75,108,0.55)');
        }
      }
    });
    this.tex.needsUpdate = true;
  }
}

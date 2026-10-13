import * as THREE from 'three';
import { FX_LAYER } from './pixel';
import { ROOM } from './office';

const PUFFS = 150;
/** density grid on the floor plan, read by the lasers and the moving heads */
const CELL = 0.6, GX = 30, GZ = 16;

const vertex = /* glsl */ `
attribute float aSize, aAlpha, aSeed;
attribute vec3 aColor;
uniform float uPx; // art pixels per world unit
varying float vSize, vAlpha, vSeed;
varying vec3 vColor;

void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  vSize = max(2.0, floor(aSize * uPx));
  gl_PointSize = vSize;
  vAlpha = aAlpha;
  vSeed = aSeed;
  vColor = aColor;
}
`;

const fragment = /* glsl */ `
uniform float uVeil;
varying float vSize, vAlpha, vSeed;
varying vec3 vColor;

float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233)) + vSeed * 37.1) * 43758.5453); }

void main() {
  // every fragment is one art pixel: a lumpy, slightly flat blob in three flat tones with a chewed rim
  vec2 p = floor(gl_PointCoord * vSize);
  vec2 c = (p + 0.5) / vSize - 0.5;
  float lump = 0.12 * sin(atan(c.y, c.x) * 3.0 + vSeed * 6.283) + 0.06 * sin(atan(c.y, c.x) * 7.0 + vSeed * 17.0);
  float r = length(c * vec2(1.0, 1.3)) * 2.0 + lump;
  if (r > 1.0) discard;
  float n = hash(p);
  if (r > 0.78 && n < 0.45) discard;
  float a = (r < 0.45 ? 1.0 : r < 0.78 ? 0.62 : 0.34) * vAlpha;
  // premultiplied: mostly light added to the picture, with a thin veil over what is behind
  gl_FragColor = vec4(vColor * a, a * uVeil);
}
`;

interface Puff {
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  age: number;
  life: number;
  size: number;
  hang: number;
  seed: number;
}

/**
 * The fog machine's cloud: pixel puffs that shoot out of the nozzle, slow down, spread over the dance floor
 * and thin out over 10 to 20 seconds. Whoever lights the room colours the puffs through `shade`.
 */
export class Fog {
  /** how much fog hangs in the room right now, 0..1 */
  amount = 0;
  private puffs: Puff[] = [];
  private geo = new THREE.BufferGeometry();
  private pos = new Float32Array(PUFFS * 3);
  private col = new Float32Array(PUFFS * 3);
  private size = new Float32Array(PUFFS);
  private alpha = new Float32Array(PUFFS);
  private seed = new Float32Array(PUFFS);
  private grid = new Float32Array(GX * GZ);
  private gx0: number;
  private gz0 = ROOM.minZ;
  private t = 0;
  private acc = 0;
  private tmp = new THREE.Color();
  private aim = new THREE.Vector3();
  readonly points: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>;

  constructor(private nozzle: { pos: THREE.Vector3; dir: THREE.Vector3 }, floor: THREE.Vector3) {
    this.gx0 = floor.x - (GX * CELL) / 2;
    // mostly at the dancers, a little the way the nozzle points
    this.aim.set(floor.x + 0.4 - nozzle.pos.x, 0, floor.z + 0.3 - nozzle.pos.z).normalize().multiplyScalar(0.85).addScaledVector(nozzle.dir, 0.15).normalize();
    const g = this.geo;
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aColor', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aSeed', new THREE.BufferAttribute(this.seed, 1).setUsage(THREE.DynamicDrawUsage));
    g.setDrawRange(0, 0);
    const mat = new THREE.ShaderMaterial({
      vertexShader: vertex,
      fragmentShader: fragment,
      uniforms: { uPx: { value: 20 }, uVeil: { value: 0.6 } },
      transparent: true,
      depthWrite: false,
      blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
      toneMapped: false,
    });
    this.points = new THREE.Points(g, mat);
    this.points.frustumCulled = false;
    // after the room, before the lasers
    this.points.renderOrder = 4;
    this.points.layers.set(FX_LAYER);
    this.points.visible = false;
    this.points.onBeforeRender = (renderer, _scene, camera) => {
      const cam = camera as THREE.OrthographicCamera;
      if (!cam.isOrthographicCamera) return;
      const rt = renderer.getRenderTarget();
      const w = rt ? rt.width : renderer.domElement.width;
      mat.uniforms.uPx.value = (w * cam.zoom) / (cam.right - cam.left);
      mat.uniformsNeedUpdate = true;
    };
  }

  /** blow for this frame: `rate` puffs per second, `power` 0..1 is how far they shoot */
  emit(dt: number, rate: number, power = 1) {
    this.acc += dt * rate;
    while (this.acc >= 1) {
      this.acc -= 1;
      if (this.puffs.length >= PUFFS) {
        // the oldest one has all but faded
        this.puffs.shift();
      }
      const r = Math.random, n = this.nozzle;
      const sp = (2.4 + r() * 2.6) * (0.6 + 0.4 * power);
      const side = (r() - 0.5) * 1.5;
      this.puffs.push({
        x: n.pos.x, y: n.pos.y, z: n.pos.z,
        vx: this.aim.x * sp + this.aim.z * side, vy: 0.25 + r() * 0.7, vz: this.aim.z * sp - this.aim.x * side,
        age: 0,
        life: 10 + r() * 10,
        size: 0.85 + r() * 0.9,
        hang: 0.3 + r() * r() * 1.3,
        seed: r(),
      });
    }
  }

  /** fog density around a point, 0 .. about 1.5 */
  density(x: number, y: number, z: number) {
    if (this.amount < 0.01 || y > 2.3) return 0;
    const ix = Math.floor((x - this.gx0) / CELL), iz = Math.floor((z - this.gz0) / CELL);
    if (ix < 0 || iz < 0 || ix >= GX || iz >= GZ) return 0;
    return this.grid[iz * GX + ix] * (y < 1.5 ? 1 : (2.3 - y) / 0.8);
  }

  /** `shade` fills in the light a puff at (x, y, z) catches */
  update(dt: number, shade: (x: number, y: number, z: number, out: THREE.Color) => void) {
    const P = this.puffs;
    if (!P.length) {
      if (this.points.visible) {
        this.points.visible = false;
        this.grid.fill(0);
        this.amount = 0;
      }
      return;
    }
    this.t += dt;
    const t = this.t;
    const drag = Math.exp(-dt * 1.25);
    this.grid.fill(0);
    let n = 0, sum = 0;
    for (let i = P.length - 1; i >= 0; i--) {
      const p = P[i];
      p.age += dt;
      if (p.age >= p.life) {
        P.splice(i, 1);
        continue;
      }
      p.vx *= drag;
      p.vy *= drag;
      p.vz *= drag;
      // once the push is gone the air of the room carries it: a slow swirl, and every puff finds its own height
      const calm = 1 - Math.min(1, Math.hypot(p.vx, p.vz) / 1.5);
      p.x += (p.vx + calm * 0.11 * Math.sin(p.z * 0.8 + t * 0.21 + p.seed * 6)) * dt;
      p.z += (p.vz + calm * (0.05 + 0.09 * Math.cos(p.x * 0.7 - t * 0.17 + p.seed * 4))) * dt;
      p.y += (p.vy + calm * (p.hang - p.y) * 0.35) * dt;
      p.x = Math.min(ROOM.maxX - 0.3, Math.max(ROOM.minX + 0.3, p.x));
      p.z = Math.max(ROOM.minZ + 0.25, p.z);
      p.y = Math.max(0.12, p.y);
    }
    for (const p of P) {
      const u = p.age / p.life;
      const grow = 1 - Math.exp(-p.age * 0.55);
      const a = Math.min(1, p.age / 0.35) * (u < 0.35 ? 1 : Math.pow(1 - (u - 0.35) / 0.65, 1.4));
      const size = p.size * (0.3 + 0.7 * grow);
      this.pos[n * 3] = p.x; this.pos[n * 3 + 1] = p.y + size * 0.2; this.pos[n * 3 + 2] = p.z;
      this.size[n] = size;
      // a young puff is thick, a spread-out one thin
      const dense = a * (0.42 + 0.5 * (1 - grow));
      this.alpha[n] = dense;
      this.seed[n] = p.seed;
      shade(p.x, p.y + size * 0.2, p.z, this.tmp);
      this.col[n * 3] = this.tmp.r; this.col[n * 3 + 1] = this.tmp.g; this.col[n * 3 + 2] = this.tmp.b;
      n++;
      sum += a;
      // splat into the grid: the cell itself and its four neighbours
      const ix = Math.floor((p.x - this.gx0) / CELL), iz = Math.floor((p.z - this.gz0) / CELL);
      if (ix < 1 || iz < 1 || ix >= GX - 1 || iz >= GZ - 1) continue;
      const k = iz * GX + ix, w = a * 0.2;
      this.grid[k] += w;
      this.grid[k - 1] += w * 0.5; this.grid[k + 1] += w * 0.5; this.grid[k - GX] += w * 0.5; this.grid[k + GX] += w * 0.5;
    }
    this.amount = Math.min(1, sum / 40);
    this.points.visible = n > 0;
    this.geo.setDrawRange(0, n);
    for (const k of ['position', 'aColor', 'aSize', 'aAlpha', 'aSeed']) this.geo.attributes[k].needsUpdate = true;
  }

  get count() {
    return this.puffs.length;
  }

  clear() {
    this.puffs.length = 0;
  }
}

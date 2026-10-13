import * as THREE from 'three';
import { toon, glow, glowMap, additive } from './materials';
import { canvasTexture, rand, pick } from './textures';
import { fx, PERSON, pottedPlant, type Seat } from './office';
import type { Theme } from './themes';

const INTERN_SPOTS: [number, number][] = [[0.8, 0.18], [0.62, -0.85], [-0.62, -0.85], [0, -1.4], [1.2, -1.45], [-1.2, -1.45]];

export type ScreenState = 'off' | 'boot' | 'running' | 'waiting' | 'failed' | 'completed' | 'idle';
export type ToolKind = 'terminal' | 'search' | 'edit' | 'web' | 'test';

const DESK_H = 0.64;
/** the paper stack at a full context window, and the thickness of one sheet in it */
const STACK_H = 0.54, SHEET = 0.045;
const STACK_GEO = new THREE.BoxGeometry(0.25, 1, 0.31).translate(0, 0.5, 0);
let stackEdges: THREE.Texture | undefined;
/** paper seen from the side: sixteen sheets, a few of them coloured */
function stackTexture() {
  stackEdges ??= canvasTexture(2, 16, (g) => {
    for (let y = 0; y < 16; y++) {
      g.fillStyle = y % 6 === 3 ? '#a9c8e4' : y % 2 ? '#fbf8f1' : '#c9bfab';
      g.fillRect(0, y, 2, 1);
    }
  });
  const t = stackEdges.clone();
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.needsUpdate = true;
  return t;
}

/** What the monitor shows for a few seconds after a tool call; `t` counts up from the call, `k` runs 0..1 over the time it is shown. */
function drawTool(g: CanvasRenderingContext2D, kind: ToolKind, t: number, k: number, seed: number) {
  const W = 32, H = 20;
  const rnd = (i: number) => {
    const x = Math.sin((seed + i) * 127.1) * 43758.5453;
    return x - Math.floor(x);
  };
  if (kind === 'terminal') {
    g.fillStyle = '#06100b';
    g.fillRect(0, 0, W, H);
    const lines = Math.floor(t / 0.28) + 1, first = Math.max(0, lines - 6);
    for (let i = first; i < lines; i++) {
      const y = 2 + (i - first) * 3;
      const prompt = rnd(i) < 0.4;
      g.fillStyle = prompt ? '#f6f1e7' : '#39ff88';
      if (prompt) g.fillRect(2, y, 1, 1);
      const len = 5 + Math.floor(rnd(i + 50) * 20);
      const shown = i === lines - 1 ? Math.min(len, Math.floor(((t / 0.28) % 1) * len * 1.6)) : len;
      g.fillRect(prompt ? 5 : 2, y, shown, 1);
      if (i === lines - 1 && Math.floor(t * 6) % 2) g.fillRect((prompt ? 5 : 2) + shown + 1, y - 1, 2, 2);
    }
  } else if (kind === 'edit') {
    g.fillStyle = '#12141c';
    g.fillRect(0, 0, W, H);
    const off = Math.floor(t / 0.5);
    for (let r = 0; r < 6; r++) {
      const i = r + off, y = 1 + r * 3;
      const v = rnd(i), add = v < 0.36, del = !add && v < 0.6;
      if (add || del) {
        g.fillStyle = add ? '#1f5a34' : '#6a2228';
        g.fillRect(0, y, W, 3);
      }
      g.fillStyle = add ? '#8dffb0' : del ? '#ff9a9a' : '#69708a';
      g.fillRect(1, y + 1, 2, 1);
      if (add) g.fillRect(2, y, 1, 3);
      g.fillRect(5 + Math.floor(rnd(i + 9) * 4), y + 1, 6 + Math.floor(rnd(i + 20) * 16), 1);
    }
  } else if (kind === 'search') {
    g.fillStyle = '#101a2a';
    g.fillRect(0, 0, W, H);
    // magnifier
    g.fillStyle = '#f6f1e7';
    g.fillRect(3, 3, 5, 1); g.fillRect(3, 9, 5, 1); g.fillRect(2, 4, 1, 5); g.fillRect(8, 4, 1, 5);
    g.fillRect(9, 10, 1, 1); g.fillRect(10, 11, 1, 1); g.fillRect(11, 12, 2, 2);
    g.fillStyle = '#8fd3ff';
    g.fillRect(4, 5, 3, 3);
    // the list of hits, one after the other lights up
    const hit = Math.floor(t / 0.45) % 5;
    for (let r = 0; r < 5; r++) {
      if (r === hit) {
        g.fillStyle = '#ffd36b';
        g.fillRect(14, 1 + r * 4, 17, 3);
      }
      g.fillStyle = r === hit ? '#1f2430' : '#7f9ac0';
      g.fillRect(15, 2 + r * 4, 6 + Math.floor(rnd(r) * 9), 1);
    }
  } else if (kind === 'test') {
    g.fillStyle = '#10161a';
    g.fillRect(0, 0, W, H);
    const n = Math.floor(k * 26);
    for (let i = 0; i < n; i++) {
      g.fillStyle = '#5ee08a';
      g.fillRect(3 + (i % 13) * 2, 3 + Math.floor(i / 13) * 3, 1, 1);
    }
    g.fillStyle = '#f6f1e7';
    g.fillRect(2, 11, 28, 1); g.fillRect(2, 16, 28, 1); g.fillRect(2, 11, 1, 6); g.fillRect(29, 11, 1, 6);
    g.fillStyle = '#5ee08a';
    g.fillRect(4, 13, Math.round(24 * Math.min(1, k * 1.08)), 2);
  } else {
    // a page loading in a browser
    g.fillStyle = '#eef1f4';
    g.fillRect(0, 0, W, H);
    g.fillStyle = '#3d7ad9';
    g.fillRect(0, 0, W, 4);
    g.fillStyle = '#ffffff';
    g.fillRect(6, 1, 20, 2);
    g.fillStyle = '#9aa6b4';
    const rows = Math.min(4, Math.floor(t / 0.4) + 1);
    for (let r = 0; r < rows; r++) g.fillRect(3, 6 + r * 3, 12 + Math.floor(rnd(r) * 14), 1);
    if (rows > 2) {
      g.fillStyle = '#f2b84b';
      g.fillRect(22, 11, 7, 6);
    }
  }
}
const SPARK_GEO = new THREE.BoxGeometry(0.05, 0.05, 0.05);
const SMOKE_GEO = new THREE.BoxGeometry(0.12, 0.12, 0.12);
const CONFETTI_GEO = new THREE.BoxGeometry(0.05, 0.05, 0.01);
const CONFETTI_BIG = new THREE.BoxGeometry(0.11, 0.11, 0.03);

function box(parent: THREE.Object3D, w: number, h: number, d: number, mat: THREE.Material, x: number, y: number, z: number, shadow = true) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y + h / 2, z);
  m.castShadow = shadow;
  m.receiveShadow = true;
  parent.add(m);
  return m;
}

function screenTex(draw: (g: CanvasRenderingContext2D, w: number, h: number) => void, w = 32, h = 20) {
  return canvasTexture(w, h, draw);
}

const STATIC_SCREENS: Partial<Record<ScreenState, THREE.Texture>> = {};
function staticScreen(state: ScreenState, bg: string) {
  if (STATIC_SCREENS[state]) return STATIC_SCREENS[state]!;
  const t = screenTex((g, w, h) => {
    g.fillStyle = state === 'off' ? '#0b0c10' : bg;
    g.fillRect(0, 0, w, h);
    if (state === 'waiting') {
      g.fillStyle = '#ffc94a';
      g.fillRect(14, 4, 4, 8);
      g.fillRect(14, 14, 4, 3);
    } else if (state === 'failed') {
      g.fillStyle = '#ff5a4f';
      for (let i = 0; i < 7; i++) {
        g.fillRect(9 + i * 2, 4 + i * 2, 2, 2);
        g.fillRect(21 - i * 2, 4 + i * 2, 2, 2);
      }
    } else if (state === 'completed') {
      g.fillStyle = '#6ee08a';
      for (let i = 0; i < 4; i++) g.fillRect(8 + i * 2, 9 + i * 2, 2, 2);
      for (let i = 0; i < 7; i++) g.fillRect(14 + i * 2, 13 - i * 2, 2, 2);
    } else if (state === 'idle') {
      for (let i = 0; i < 18; i++) {
        g.fillStyle = pick(['#ffffff', '#8fd3ff', '#c39bff']);
        g.fillRect(Math.floor(rand() * w), Math.floor(rand() * h), 1, 1);
      }
    } else if (state === 'boot') {
      g.fillStyle = '#f6f1e7';
      g.fillRect(12, 6, 8, 6);
      g.fillStyle = bg;
      g.fillRect(14, 8, 4, 2);
      g.fillStyle = '#6ee0c0';
      g.fillRect(8, 15, 16, 1);
    }
  });
  STATIC_SCREENS[state] = t;
  return t;
}

const ICONS: Record<ToolKind, THREE.Texture> = {} as Record<ToolKind, THREE.Texture>;
function iconTexture(kind: ToolKind) {
  if (ICONS[kind]) return ICONS[kind];
  ICONS[kind] = canvasTexture(12, 12, (g) => {
    g.fillStyle = '#1f2430';
    g.fillRect(0, 0, 12, 12);
    g.fillStyle = '#f6f2ea';
    g.fillRect(1, 1, 10, 10);
    g.fillStyle = '#1f2430';
    if (kind === 'terminal') {
      g.fillRect(3, 4, 1, 1); g.fillRect(4, 5, 1, 1); g.fillRect(3, 6, 1, 1); g.fillRect(6, 7, 3, 1);
    } else if (kind === 'search') {
      g.fillRect(3, 3, 4, 1); g.fillRect(3, 6, 4, 1); g.fillRect(3, 3, 1, 4); g.fillRect(6, 3, 1, 4); g.fillRect(7, 7, 1, 1); g.fillRect(8, 8, 1, 1);
    } else if (kind === 'edit') {
      for (let i = 0; i < 5; i++) g.fillRect(3 + i, 8 - i, 2, 1);
      g.fillStyle = '#e8556b';
      g.fillRect(8, 3, 1, 1);
    } else if (kind === 'web') {
      g.fillRect(3, 3, 6, 1); g.fillRect(3, 8, 6, 1); g.fillRect(3, 3, 1, 6); g.fillRect(8, 3, 1, 6); g.fillRect(5, 3, 1, 6); g.fillRect(3, 5, 6, 1);
    } else {
      g.fillStyle = '#2a8a5a';
      g.fillRect(3, 6, 1, 1); g.fillRect(4, 7, 1, 1); g.fillRect(5, 6, 1, 1); g.fillRect(6, 5, 1, 1); g.fillRect(7, 4, 1, 1); g.fillRect(8, 3, 1, 1);
    }
  });
  return ICONS[kind];
}

interface Particle {
  m: THREE.Mesh;
  life: number;
  vx: number;
  vy: number;
  vz: number;
  spin: number;
}

/** A desk and everything on it; it reflects the state of whoever sits there. */
export class Desk {
  readonly group = new THREE.Group();
  readonly seat: Seat;
  occupant?: string;
  private screen: THREE.Mesh;
  private codeTex: THREE.CanvasTexture;
  private screenState: ScreenState = 'off';
  private stack: THREE.Mesh;
  private stackTop: THREE.Mesh;
  private stackTex: THREE.Texture;
  private stackH = 0;
  private stackFull = false;
  /** the occupant is carrying the stack around (to the shredder) */
  private stackOut = false;
  private tool?: { kind: ToolKind; t: number; dur: number; drawn: number; seed: number };
  private toolTex?: THREE.CanvasTexture;
  private toolG?: CanvasRenderingContext2D;
  /** false while the provider's quota is used up: monitor and lamp are dark, a candle burns */
  private power = true;
  private candle?: { g: THREE.Group; flame: THREE.Mesh; halo: THREE.Mesh };
  private notes: THREE.Mesh[] = [];
  private mug: THREE.Mesh;
  private plant: THREE.Group;
  private crate: THREE.Group;
  private crateItems = 0;
  private chair: THREE.Group;
  private phone: THREE.Group;
  private ring: THREE.Mesh;
  private lampBulb: THREE.MeshBasicMaterial;
  private lamp: THREE.Group;
  private pizza: THREE.Group;
  private sparks: Particle[] = [];
  private smoke: Particle[] = [];
  private confetti: Particle[] = [];
  private icons: { s: THREE.Sprite; life: number }[] = [];
  private sparkMat: THREE.MeshBasicMaterial;
  private sparkAcc = 0;
  private t = rand() * 10;
  tps = 0;
  failed = false;
  waiting = false;
  /** desks exist only while the team needs them */
  present = true;
  /** seconds this desk has been free, used to fold away unused desks */
  freeFor = 0;
  private build = 1;
  private buildDir = 0;

  constructor(private scene: THREE.Scene, private theme: Theme, seat: Seat, accent = '#7ee0b5') {
    this.seat = seat;
    const T = theme.desk;
    const g = this.group;
    g.position.set(seat.x, 0, seat.z);
    g.rotation.y = seat.rot;
    g.scale.setScalar(PERSON);
    scene.add(g);

    box(g, 1.25, 0.05, 0.75, toon(T.top), 0, DESK_H - 0.05, 0.62);
    if (T.kind === 'white') {
      box(g, 0.06, DESK_H - 0.05, 0.6, toon(T.leg), -0.55, 0, 0.62);
      box(g, 0.06, DESK_H - 0.05, 0.6, toon(T.leg), 0.55, 0, 0.62);
    } else {
      for (const [x, z] of [[-0.58, 0.3], [0.58, 0.3], [-0.58, 0.95], [0.58, 0.95]]) box(g, 0.04, DESK_H - 0.05, 0.04, toon(T.leg), x, 0, z);
    }
    box(g, 0.25, 0.02, 0.16, toon('#2a2a30'), 0, DESK_H, 0.86);
    box(g, 0.05, 0.2, 0.04, toon('#2a2a30'), 0, DESK_H, 0.88);
    box(g, 0.7, 0.42, 0.04, toon('#1d1c22'), 0, DESK_H + 0.16, 0.86);

    // tall scrolling code texture; offset animates instead of redrawing
    this.codeTex = canvasTexture(32, 80, (c, w, h) => {
      c.fillStyle = T.screenBg;
      c.fillRect(0, 0, w, h);
      const cols = [accent, '#f6f1e7', '#8fd3ff', '#ffd27a', '#c39bff'];
      for (let y = 1; y < h; y += 2) {
        let x = 2 + (rand() < 0.4 ? 2 : 0) + (rand() < 0.2 ? 2 : 0);
        while (x < w - 3 && rand() < 0.85) {
          const len = 1 + Math.floor(rand() * 6);
          c.fillStyle = pick(cols);
          c.fillRect(x, y, Math.min(len, w - 2 - x), 1);
          x += len + 1;
        }
      }
    });
    this.codeTex.wrapT = THREE.RepeatWrapping;
    this.codeTex.repeat.set(1, 20 / 80);
    this.screen = new THREE.Mesh(new THREE.PlaneGeometry(0.64, 0.36), glowMap(staticScreen('off', T.screenBg), theme.lights.screenGlow));
    this.screen.position.set(0, DESK_H + 0.37, 0.838);
    this.screen.rotation.y = Math.PI;
    g.add(this.screen);

    box(g, 0.42, 0.025, 0.14, toon('#e8e4dc'), -0.02, DESK_H, 0.4);
    box(g, 0.08, 0.025, 0.12, toon('#e8e4dc'), 0.3, DESK_H, 0.42);

    // the context window as a pile of paper: one mesh that grows, with a loose sheet on top
    this.stackTex = stackTexture();
    this.stack = new THREE.Mesh(STACK_GEO, toon('#ffffff', { map: this.stackTex }));
    this.stack.position.set(-0.45, DESK_H, 0.62);
    this.stack.castShadow = true;
    this.stack.visible = false;
    g.add(this.stack);
    this.stackTop = box(g, 0.26, 0.012, 0.32, toon('#fbf8f1'), -0.45, DESK_H, 0.62, false);
    this.stackTop.rotation.y = 0.12;
    this.stackTop.visible = false;
    const noteCols = ['#ffe07a', '#ff9fb8', '#9fe0ff', '#b8f29a', '#ffc27a'];
    for (let f = 0; f < 5; f++) {
      const n = new THREE.Mesh(new THREE.PlaneGeometry(0.09, 0.09), toon(noteCols[f]));
      n.position.set(-0.36 + (f % 3) * 0.035 + (f > 2 ? 0.62 : 0), DESK_H + 0.5 - (f % 3) * 0.1, 0.833);
      n.rotation.y = Math.PI;
      n.rotation.z = (f % 2 ? 1 : -1) * 0.15;
      n.visible = false;
      g.add(n);
      this.notes.push(n);
    }
    this.mug = box(g, 0.09, 0.11, 0.09, toon(pick(['#f4efe4', '#e8556b', '#3d5a8a', '#f2c94c', '#6ee0c0'])), 0.46, DESK_H, 0.5);
    this.mug.visible = false;
    this.plant = new THREE.Group();
    this.plant.position.set(0.48, DESK_H, 0.85);
    this.plant.scale.setScalar(0.35);
    pottedPlant(this.plant, 0, 0, 1);
    this.plant.visible = false;
    g.add(this.plant);

    this.crate = new THREE.Group();
    this.crate.position.set(0.05, DESK_H, 0.55);
    box(this.crate, 0.42, 0.26, 0.32, toon('#c9a26b'), 0, 0, 0);
    box(this.crate, 0.42, 0.02, 0.06, toon('#a8844f'), 0, 0.26, -0.13, false);
    this.crate.visible = false;
    g.add(this.crate);

    this.chair = new THREE.Group();
    g.add(this.chair);
    {
      const c = toon(T.chair), metal = toon('#2a2a30');
      box(this.chair, 0.5, 0.05, 0.03, metal, 0, 0.02, 0);
      box(this.chair, 0.03, 0.05, 0.5, metal, 0, 0.02, 0);
      box(this.chair, 0.05, 0.36, 0.05, metal, 0, 0.04, 0);
      box(this.chair, 0.46, 0.08, 0.44, c, 0, 0.36, 0);
      box(this.chair, 0.44, 0.5, 0.07, c, 0, 0.5, -0.22);
    }
    this.setChair(true);

    this.phone = new THREE.Group();
    this.phone.position.set(-0.5, DESK_H, 0.42);
    box(this.phone, 0.18, 0.05, 0.14, toon('#3a3a40'), 0, 0, 0);
    box(this.phone, 0.2, 0.04, 0.06, toon('#c9423b'), 0, 0.06, 0.02);
    g.add(this.phone);
    this.ring = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.012, 4, 12), glow('#ffd36b', 2));
    this.ring.position.set(-0.5, DESK_H + 0.16, 0.42);
    this.ring.rotation.x = Math.PI / 2;
    this.ring.visible = false;
    g.add(fx(this.ring));

    this.lamp = new THREE.Group();
    this.lamp.position.set(0.55, DESK_H, 0.75);
    box(this.lamp, 0.12, 0.02, 0.12, toon('#2a2a30'), 0, 0, 0);
    box(this.lamp, 0.02, 0.32, 0.02, toon('#2a2a30'), 0, 0.02, 0);
    this.lampBulb = glow('#ffd9a0', 0.2);
    const shade = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.07, 0.1), this.lampBulb);
    shade.position.set(-0.05, 0.36, -0.02);
    this.lamp.add(shade);
    this.lamp.visible = false;
    g.add(this.lamp);

    this.pizza = new THREE.Group();
    this.pizza.position.set(-0.32, DESK_H + 0.24, 0.62);
    box(this.pizza, 0.36, 0.05, 0.36, toon('#d9b47a'), 0, 0, 0);
    box(this.pizza, 0.2, 0.012, 0.06, toon('#c9423b'), 0, 0.05, 0, false);
    this.pizza.visible = false;
    g.add(this.pizza);

    this.sparkMat = glow(accent, 1.35);
  }

  setPresent(on: boolean, animate = true) {
    this.present = on;
    if (!animate) {
      this.build = on ? 1 : 0;
      this.buildDir = 0;
      this.applyBuild();
      return;
    }
    this.buildDir = on ? 1 : -1;
    this.group.visible = true;
    for (let i = 0; i < 7; i++) {
      const m = new THREE.Mesh(SMOKE_GEO, toon('#d8d2c4'));
      m.position.set((rand() - 0.5) * 1.2, 0.05, 0.4 + (rand() - 0.5) * 0.8);
      this.group.add(m);
      this.smoke.push({ m, life: 0.8, vx: (rand() - 0.5) * 0.8, vy: 0.15, vz: (rand() - 0.5) * 0.5, spin: 2 });
    }
  }

  get ready() {
    return this.present && this.build >= 1;
  }

  private applyBuild() {
    const b = this.build;
    const back = 1.70158;
    const e = b <= 0 ? 0 : b >= 1 ? 1 : 1 + (back + 1) * Math.pow(b - 1, 3) + back * Math.pow(b - 1, 2);
    const xz = Math.min(1, b * 1.6);
    this.group.scale.set(PERSON * Math.max(0.001, xz), PERSON * Math.max(0.001, e), PERSON * Math.max(0.001, xz));
    this.group.visible = b > 0.001;
  }

  setAccent(color: string) {
    this.sparkMat.color.set(color).multiplyScalar(1.35);
  }

  /** Seat position in world space plus facing. */
  seatWorld() {
    return { x: this.seat.x, z: this.seat.z, rot: this.seat.rot };
  }

  /** Point behind the chair where people approach from. */
  approach() {
    const back = 0.75;
    return { x: this.seat.x - Math.sin(this.seat.rot) * back, z: this.seat.z - Math.cos(this.seat.rot) * back };
  }

  /** Where a colleague stands to help. */
  helpSpot() {
    const off = new THREE.Vector3(0.95, 0, 0.2).applyAxisAngle(new THREE.Vector3(0, 1, 0), this.seat.rot);
    return { x: this.seat.x + off.x, z: this.seat.z + off.z, rot: this.seat.rot - Math.PI / 2 };
  }

  /** Interns crowd around the desk: beside it first, then behind the chair, all looking at the monitor. */
  internSpot(slot = 0) {
    const [ox, oz] = INTERN_SPOTS[slot % INTERN_SPOTS.length];
    const up = new THREE.Vector3(0, 1, 0);
    const off = new THREE.Vector3(ox, 0, oz).applyAxisAngle(up, this.seat.rot);
    const mon = new THREE.Vector3(0, 0, 0.75).applyAxisAngle(up, this.seat.rot);
    const x = this.seat.x + off.x, z = this.seat.z + off.z;
    return { x, z, rot: Math.atan2(this.seat.x + mon.x - x, this.seat.z + mon.z - z) };
  }

  setChair(pushedBack: boolean) {
    this.chair.position.set(pushedBack ? 0.15 : 0, 0, pushedBack ? -0.42 : -0.08);
    this.chair.rotation.y = pushedBack ? 0.45 : 0;
  }

  private previewing = false;

  /** Show a live picture of the agent's thread on this monitor (null restores the normal screen). */
  preview(tex: THREE.Texture | null) {
    const mat = this.screen.material as THREE.MeshBasicMaterial;
    this.previewing = !!tex;
    for (const n of this.notes) n.scale.setScalar(tex ? 1e-3 : 1);
    if (tex) {
      mat.map = tex;
      mat.color.setScalar(this.theme.lights.screenGlow);
      mat.needsUpdate = true;
    } else {
      const st = this.screenState;
      this.screenState = 'off';
      if (st === 'off') this.screenState = 'idle';
      this.setScreen(st);
    }
  }

  /** world position and outward normal of the monitor face, for over-the-shoulder camera shots */
  screenPose() {
    const p = new THREE.Vector3(), n = new THREE.Vector3();
    this.screen.getWorldPosition(p);
    this.screen.getWorldDirection(n);
    return { p, n };
  }

  setScreen(state: ScreenState) {
    if (state === this.screenState) return;
    this.screenState = state;
    this.applyScreen();
  }

  private applyScreen() {
    if (this.previewing) return;
    const state = this.power ? this.screenState : 'off';
    const mat = this.screen.material as THREE.MeshBasicMaterial;
    mat.map = state !== 'running' ? staticScreen(state, this.theme.desk.screenBg) : this.tool ? this.toolTex! : this.codeTex;
    const gl = this.theme.lights.screenGlow * (!this.power ? 0.08 : state === 'off' ? 0.3 : state === 'idle' ? 0.6 : 1);
    mat.color.setScalar(gl);
    mat.needsUpdate = true;
  }

  /** The monitor shows this kind of work for a few seconds (only while the agent's code is on it). */
  showTool(kind: ToolKind, seconds = 3.5) {
    if (!this.toolTex) {
      const c = document.createElement('canvas');
      c.width = 32;
      c.height = 20;
      this.toolG = c.getContext('2d')!;
      this.toolTex = new THREE.CanvasTexture(c);
      this.toolTex.magFilter = this.toolTex.minFilter = THREE.NearestFilter;
      this.toolTex.generateMipmaps = false;
      this.toolTex.colorSpace = THREE.SRGBColorSpace;
    }
    this.tool = { kind, t: 0, dur: seconds, drawn: -1, seed: this.seat.index * 7.3 + this.t };
    this.paintTool();
    this.applyScreen();
  }

  private paintTool() {
    const tl = this.tool!;
    tl.drawn = tl.t;
    drawTool(this.toolG!, tl.kind, tl.t, Math.min(1, tl.t / tl.dur), tl.seed);
    this.toolTex!.needsUpdate = true;
  }

  /** Which tool is on the monitor right now, if any. */
  get toolShown(): ToolKind | undefined {
    return this.tool?.kind;
  }

  /** The context window as a stack of paper: its height follows `pct` (0..100), a nearly full one gets a red cover sheet. */
  setContext(pct: number) {
    const k = this.stackOut ? 0 : THREE.MathUtils.clamp(pct / 100, 0, 1);
    // a bit more than linear, so a compacted context is clearly a small pile and a full one towers
    const h = k < 0.02 ? 0 : Math.max(SHEET, Math.round((STACK_H * Math.pow(k, 1.3)) / SHEET) * SHEET);
    const full = k >= 0.85;
    if (h === this.stackH && full === this.stackFull) return;
    this.stackH = h;
    this.stackFull = full;
    this.stack.visible = this.stackTop.visible = h > 0;
    this.stack.scale.y = Math.max(h, 0.001);
    this.stackTex.repeat.set(1, h / SHEET / 16);
    this.stackTop.position.y = DESK_H + h + 0.006;
    this.stackTop.material = toon(full ? '#ff7a6a' : '#fbf8f1');
    this.pizza.position.y = DESK_H + h + 0.02;
  }

  /** current height of the paper stack in desk units (0 = no paper) */
  get stackHeight() {
    return this.stackH;
  }

  /** The occupant picks the whole stack up (true) or it is back in place and follows the context again (false). */
  carryStack(away: boolean) {
    this.stackOut = away;
    if (away) this.setContext(0);
  }

  /** Quota used up: monitor and lamp go dark and a candle is lit. Reversible. */
  setPower(on: boolean) {
    if (on === this.power) return;
    this.power = on;
    if (!on && !this.candle) {
      const g = new THREE.Group();
      g.position.set(0.3, DESK_H, 0.64);
      box(g, 0.1, 0.02, 0.1, toon('#8a8f9a'), 0, 0, 0, false);
      box(g, 0.05, 0.13, 0.05, toon('#f6f2ea'), 0, 0.02, 0, false);
      const flame = box(g, 0.06, 0.11, 0.06, glow('#ffb347', 2.6), 0, 0.16, 0, false);
      const halo = new THREE.Mesh(new THREE.SphereGeometry(0.3, 8, 6), additive('#ff9a3a', 0.3));
      halo.position.y = 0.2;
      g.add(fx(halo));
      this.group.add(g);
      this.candle = { g, flame, halo };
    }
    if (this.candle) this.candle.g.visible = !on;
    if (!on) this.lamp.visible = false;
    this.applyScreen();
  }

  get powered() {
    return this.power;
  }

  setFiles(n: number) {
    this.notes.forEach((s, i) => (s.visible = i < Math.min(5, n)));
  }

  setBelongings(on: boolean) {
    this.mug.visible = on;
    this.plant.visible = on && this.seat.index % 2 === 0;
  }

  setPhoneRinging(on: boolean) {
    this.waiting = on;
    this.ring.visible = on;
  }

  setPizza(on: boolean) {
    this.pizza.visible = on;
  }

  get hasPizza() {
    return this.pizza.visible;
  }

  /** One step of packing up: returns false when nothing is left on the desk. */
  packStep(): boolean {
    this.crate.visible = true;
    const candidates: THREE.Object3D[] = [...this.notes.filter((n) => n.visible), this.stack, this.plant, this.mug, this.pizza].filter((o) => o.visible);
    const item = candidates[0];
    if (!item) return false;
    if (item === this.stack) this.setContext(0);
    item.visible = false;
    this.crateItems++;
    return true;
  }

  takeCrate() {
    this.crate.visible = false;
    this.crateItems = 0;
  }

  clear() {
    this.setPower(true);
    this.tool = undefined;
    this.setScreen('off');
    this.stackOut = false;
    this.setContext(0);
    this.setFiles(0);
    this.setBelongings(false);
    this.setPhoneRinging(false);
    this.setPizza(false);
    this.crate.visible = false;
    this.failed = false;
    this.tps = 0;
    this.setChair(true);
  }

  popIcon(kind: ToolKind) {
    const mat = new THREE.SpriteMaterial({ map: iconTexture(kind), transparent: true, depthWrite: false });
    const s = new THREE.Sprite(mat);
    s.scale.set(0.2, 0.2, 1);
    s.position.set((rand() - 0.5) * 0.4, DESK_H + 0.75, 0.8);
    this.group.add(fx(s));
    this.icons.push({ s, life: 0 });
  }

  /** `big`: a party popper for the whole team (a merged pull request) instead of the small burst of a finished run. */
  burstConfetti(big = false) {
    const cols = ['#ff6b6b', '#ffd36b', '#6ee0c0', '#8fb8ff', '#ff9fe0'];
    for (let p = 0; p < (big ? 30 : 22); p++) {
      const m = new THREE.Mesh(big ? CONFETTI_BIG : CONFETTI_GEO, glow(pick(cols), 1.2));
      m.position.set((rand() - 0.5) * (big ? 1 : 0.3), DESK_H + 0.7, 0.3);
      this.group.add(fx(m));
      this.confetti.push({ m, life: 0, vx: (rand() - 0.5) * (big ? 2.4 : 1.6), vy: (big ? 2.6 : 1.6) + rand() * 1.4, vz: (rand() - 0.5) * (big ? 2.4 : 1.6), spin: rand() * 10 });
    }
  }

  setLamp(on: boolean, level: number) {
    this.lamp.visible = on && this.power;
    this.lampBulb.color.set('#ffd9a0').multiplyScalar(0.5 + level * 1.0);
  }

  update(dt: number) {
    this.t += dt;
    if (this.buildDir) {
      this.build = Math.min(1, Math.max(0, this.build + dt * 1.6 * this.buildDir));
      if (this.build === 0 || this.build === 1) this.buildDir = 0;
      this.applyBuild();
    }
    if (!this.group.visible) return;
    if (this.screenState === 'running') this.codeTex.offset.y = (this.codeTex.offset.y + dt * (0.02 + this.tps / 3000)) % 1;
    if (this.tool) {
      const tl = this.tool;
      tl.t += dt;
      if (tl.t > tl.dur) {
        this.tool = undefined;
        this.applyScreen();
      } else if (tl.t - tl.drawn > 0.09 && this.screenState === 'running' && this.power && !this.previewing) this.paintTool();
    }
    if (this.candle?.g.visible) {
      const f = 1 + Math.sin(this.t * 17) * 0.12 + Math.sin(this.t * 31) * 0.08;
      this.candle.flame.scale.set(1, f, 1);
      this.candle.halo.scale.setScalar(0.9 + (f - 1) * 0.8);
    }
    if (this.ring.visible) {
      const s = 1 + ((this.t * 1.6) % 1) * 0.8;
      this.ring.scale.set(s, s, s);
      this.phone.rotation.z = Math.sin(this.t * 40) * 0.05 * (Math.sin(this.t * 3) > 0 ? 1 : 0);
    }

    // token sparkles, rate grows with tokens per second
    if (this.tps > 0 && this.screenState === 'running' && this.power) {
      this.sparkAcc += dt * (this.tps / 25);
      while (this.sparkAcc > 1 && this.sparks.length < 14) {
        this.sparkAcc -= 1;
        const m = new THREE.Mesh(SPARK_GEO, this.sparkMat);
        m.position.set((rand() - 0.5) * 0.6, DESK_H + 0.6, 0.8 + (rand() - 0.5) * 0.15);
        this.group.add(fx(m));
        this.sparks.push({ m, life: 0, vx: (rand() - 0.5) * 0.15, vy: 0.5 + rand() * 0.4, vz: 0, spin: rand() * 4 });
      }
    }
    this.stepParticles(this.sparks, dt, 1.6, 0);
    if (this.failed && this.smoke.length < 6 && rand() < dt * 4) {
      const m = new THREE.Mesh(SMOKE_GEO, toon('#6b6670'));
      m.position.set((rand() - 0.5) * 0.2, DESK_H + 0.65, 0.86);
      this.group.add(m);
      this.smoke.push({ m, life: 0, vx: (rand() - 0.5) * 0.1, vy: 0.35, vz: 0, spin: 1 });
    }
    this.stepParticles(this.smoke, dt, 2.2, 0, true);
    this.stepParticles(this.confetti, dt, 2.0, 4.5);

    for (let i = this.icons.length - 1; i >= 0; i--) {
      const ic = this.icons[i];
      ic.life += dt;
      ic.s.position.y += dt * 0.35;
      (ic.s.material as THREE.SpriteMaterial).opacity = 1 - Math.max(0, ic.life - 0.8) / 0.6;
      if (ic.life > 1.4) {
        this.group.remove(ic.s);
        this.icons.splice(i, 1);
      }
    }
  }

  private stepParticles(list: Particle[], dt: number, maxLife: number, gravity: number, grow = false) {
    for (let i = list.length - 1; i >= 0; i--) {
      const p = list[i];
      p.life += dt;
      p.vy -= gravity * dt;
      p.m.position.x += p.vx * dt;
      p.m.position.y += p.vy * dt;
      p.m.position.z += p.vz * dt;
      p.m.rotation.x += p.spin * dt;
      p.m.rotation.y += p.spin * dt;
      const k = 1 - p.life / maxLife;
      p.m.scale.setScalar(grow ? 1 + p.life * 1.2 : Math.max(0.01, k));
      if (p.life > maxLife || p.m.position.y < 0) {
        this.group.remove(p.m);
        list.splice(i, 1);
      }
    }
  }
}

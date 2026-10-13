import * as THREE from 'three';
import { toon, glow } from './materials';
import { canvasTexture } from './textures';
import { fx, ROOM, PERSON, type Spot } from './office';
import { steer, type P2 } from './nav';
import { addClickable } from './interact';
import { settings } from './settings';
import { cue } from './director';
import { S } from './i18n/pets';
import type { Anchor, Worker, World } from './workers';
import type { SfxName } from './audio';

/**
 * The office dog, the office cat and the robot vacuum.
 *
 *   world.pets.dog / .cat / .vacuum     the three of them (each has x, z, `doing`, `setEnabled`)
 *   world.pets.mess({ x, z })           something to clean up there; the vacuum comes by on its next run
 *   world.pets.vacuum.toggle() / .home()
 *
 * World calls `bodies()` before people move (so they walk around the animals) and `update()` once per frame.
 * All three are clickable (src/interact.ts) and follow the `dog`, `cat` and `vacuum` settings live.
 */

const R = Math.random;
const between = (a: number, b: number) => a + R() * (b - a);
const pick = <T,>(a: readonly T[]) => a[Math.floor(R() * a.length)];
const clamp = THREE.MathUtils.clamp;
const angDiff = (a: number, b: number) => Math.atan2(Math.sin(a - b), Math.cos(a - b));
const dist = (a: P2, b: P2) => Math.hypot(a.x - b.x, a.z - b.z);

/** top of a desk and of its keyboard in world units (desks are built 0.64 high and drawn at PERSON scale) */
const DESK_TOP = 0.665 * PERSON;

function box(parent: THREE.Object3D, w: number, h: number, d: number, color: string, x: number, y: number, z: number) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), toon(color));
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  parent.add(m);
  return m;
}

/** Hit area a little larger than the thing itself: never drawn, but the raycaster finds it. */
function hitBox(parent: THREE.Object3D, w: number, h: number, d: number, y: number, z = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshBasicMaterial({ visible: false }));
  m.position.set(0, y, z);
  parent.add(m);
  return m;
}

/** The agent who has waited for the user longest; the dog's job. One place to swap the rule. */
const longestWaiting = (world: World): Worker | undefined => world.longestWaiting();

// ---------- little pixel icons that float up: hearts, Zzz, "!" ----------

const ICONS = {
  heart: { color: '#ff6b8f', rows: ['.##.##.', '#######', '#######', '.#####.', '..###..', '...#...'] },
  zzz: { color: '#cfe3ff', rows: ['#####', '...#.', '..#..', '.#...', '#####'] },
  bang: { color: '#ffd23f', rows: ['##', '##', '##', '##', '..', '##'] },
  what: { color: '#ffffff', rows: ['.###.', '#...#', '...#.', '..#..', '.....', '..#..'] },
  note: { color: '#8fe0ff', rows: ['..####', '..#..#', '..#..#', '###.##', '###.##'] },
  anger: { color: '#ff5a4a', rows: ['.#.#.', '##.##', '.....', '##.##', '.#.#.'] },
  dots: { color: '#ffffff', rows: ['#.#.#'] },
} as const;
type Icon = keyof typeof ICONS;

class Emotes {
  private tex = new Map<Icon, THREE.Texture>();
  private live: { s: THREE.Sprite; t: number; dur: number }[] = [];

  constructor(private scene: THREE.Scene) {}

  private texture(kind: Icon) {
    let t = this.tex.get(kind);
    if (t) return t;
    const { rows, color } = ICONS[kind];
    const w = rows[0].length, h = rows.length;
    t = canvasTexture(w + 2, h + 2, (g) => {
      // a dark rim first, so the icon reads on any floor
      g.fillStyle = '#1c1622';
      rows.forEach((row, j) => [...row].forEach((c, i) => c === '#' && g.fillRect(i, j, 3, 3)));
      g.fillStyle = color;
      rows.forEach((row, j) => [...row].forEach((c, i) => c === '#' && g.fillRect(i + 1, j + 1, 1, 1)));
    });
    this.tex.set(kind, t);
    return t;
  }

  /** `delay` lets a few of them come one after the other */
  emit(kind: Icon, x: number, y: number, z: number, delay = 0) {
    const map = this.texture(kind);
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map, transparent: true, depthTest: false, fog: false }));
    const img = map.image as HTMLCanvasElement;
    // one texel is about one art pixel at the default zoom
    s.scale.set(img.width / 19, img.height / 19, 1);
    s.position.set(x + (R() - 0.5) * 0.15, y, z + (R() - 0.5) * 0.15);
    s.renderOrder = 20;
    s.visible = false;
    this.scene.add(fx(s));
    this.live.push({ s, t: -delay, dur: 1.4 });
  }

  update(dt: number) {
    for (let i = this.live.length - 1; i >= 0; i--) {
      const e = this.live[i];
      e.t += dt;
      if (e.t < 0) continue;
      e.s.visible = true;
      e.s.position.y += dt * (0.5 - 0.25 * (e.t / e.dur));
      e.s.material.opacity = Math.min(1, (e.dur - e.t) * 3);
      if (e.t > e.dur) {
        e.s.removeFromParent();
        e.s.material.dispose();
        this.live.splice(i, 1);
      }
    }
  }
}

// ---------- a four-legged friend built from boxes ----------

interface QuadSpec {
  scale: number;
  /** width, height, length */
  torso: [number, number, number];
  leg: [number, number];
  head: [number, number, number];
  muzzle: [number, number, number];
  ears: 'flop' | 'point';
  tail: number;
  /** how upright it sits, radians */
  sit: number;
  /** how high the tail is carried, radians */
  tailUp: number;
  coat: string;
  white: string;
  dark: string;
  nose: string;
  eye: string;
  collar?: string;
  /** a white ruff around the chest (the collie look) */
  ruff?: boolean;
  stripes?: boolean;
}

type QuadPose = 'stand' | 'walk' | 'sit' | 'lie' | 'sleep' | 'sniff' | 'loaf' | 'loafSleep' | 'arch' | 'crouch' | 'dance';
const KEYS = ['y', 'pitch', 'hp', 'hy', 'hr', 'hdy', 'tp', 'ty', 'fl', 'fr', 'bl', 'br', 'tuck', 'puff', 'fs'] as const;
type Key = (typeof KEYS)[number];
type Vals = Record<Key, number>;
const zero = (): Vals => ({ y: 0, pitch: 0, hp: 0, hy: 0, hr: 0, hdy: 0, tp: 0, ty: 0, fl: 0, fr: 0, bl: 0, br: 0, tuck: 0, puff: 0, fs: 0 });

class Quad {
  readonly root = new THREE.Group();
  /** top of the head while standing, world units */
  readonly height: number;
  /** 0..1: how hard the tail wags */
  wag = 0;
  /** slow tail swish (cats) */
  swish = 0;
  eyesShut = false;
  /** extra head turn on top of the pose (looking at somebody) */
  look = 0;
  private pop = new THREE.Group();
  private body = new THREE.Group();
  private head = new THREE.Group();
  private tail = new THREE.Group();
  private legs: THREE.Group[] = [];
  private eyes: THREE.Mesh[] = [];
  private cur = zero();
  private tgt = zero();
  private headY: number;
  private frontZ: number;
  private t = R() * 10;
  private wagK = 0;
  private shown = true;
  private vis = 1;
  private hover = false;
  private hoverK = 0;
  private hopT = 0;

  constructor(readonly spec: QuadSpec) {
    const { torso: [w, h, d], leg: [lw, lh], head: [hw, hh, hd], muzzle: [mw, mh, md] } = spec;
    const inset = lw / 2 + 0.02;
    this.frontZ = d - 2 * inset;
    this.root.add(this.pop);
    this.pop.add(this.body);
    // the body turns around the hind hips, so sitting down is one rotation
    this.body.position.set(0, lh, -d / 2 + inset);
    box(this.body, w, h, d, spec.coat, 0, h / 2, d / 2 - inset);
    box(this.body, w * 0.7, 0.03, d * 0.6, spec.white, 0, 0.012, d / 2 - inset);
    if (spec.ruff) box(this.body, w + 0.014, h + 0.014, d * 0.24, spec.white, 0, h / 2, d - inset - d * 0.16);
    else box(this.body, w * 0.72, h * 0.7, 0.03, spec.white, 0, h * 0.4, d - inset);
    if (spec.stripes) for (const k of [0.25, 0.45, 0.65]) box(this.body, w + 0.012, h * 0.55, d * 0.07, spec.dark, 0, h * 0.74, d * k - inset);
    if (spec.collar) box(this.body, w * 0.8, 0.06, 0.07, spec.collar, 0, h + 0.01, d - inset - 0.05);
    for (const [sx, z] of [[-1, this.frontZ], [1, this.frontZ], [-1, 0], [1, 0]] as const) {
      const leg = new THREE.Group();
      leg.position.set(sx * (w / 2 - lw / 2), 0.02, z);
      box(leg, lw, lh, lw, spec.coat, 0, -lh / 2 + 0.02, 0);
      box(leg, lw + 0.012, lh * 0.34, lw + 0.012, spec.white, 0, -lh + lh * 0.17, 0.004);
      this.body.add(leg);
      this.legs.push(leg);
    }

    this.headY = h * 0.72;
    this.head.position.set(0, this.headY, d - inset + hd * 0.06);
    this.head.rotation.order = 'YXZ';
    this.body.add(this.head);
    const cy = hh * 0.36, cz = hd * 0.3;
    box(this.head, hw, hh, hd, spec.coat, 0, cy, cz);
    box(this.head, mw, mh, md, spec.white, 0, cy - hh / 2 + mh / 2, cz + hd / 2 + md / 2 - 0.01);
    box(this.head, mw * 0.4, mh * 0.45, 0.03, spec.nose, 0, cy - hh / 2 + mh * 0.8, cz + hd / 2 + md);
    if (spec.ruff) box(this.head, hw * 0.24, hh * 0.6, 0.02, spec.white, 0, cy + hh * 0.22, cz + hd / 2);
    for (const sx of [-1, 1]) {
      this.eyes.push(box(this.head, hw * 0.17, hh * 0.2, 0.02, spec.eye, sx * hw * 0.27, cy + hh * 0.12, cz + hd / 2 + 0.002));
      if (spec.ears === 'flop') box(this.head, hw * 0.22, hh * 0.62, hd * 0.5, spec.dark, sx * (hw / 2 + hw * 0.06), cy + hh * 0.2, cz - hd * 0.08);
      else {
        box(this.head, hw * 0.3, hh * 0.42, hd * 0.26, spec.coat, sx * hw * 0.31, cy + hh / 2 + hh * 0.17, cz - hd * 0.05);
        box(this.head, hw * 0.14, hh * 0.24, 0.02, spec.nose, sx * hw * 0.31, cy + hh / 2 + hh * 0.13, cz - hd * 0.05 + hd * 0.13);
      }
    }

    this.tail.position.set(0, h * 0.82, -inset);
    this.tail.rotation.order = 'YXZ';
    this.body.add(this.tail);
    const tw = lw * 0.8;
    box(this.tail, tw, tw, spec.tail * 0.68, spec.coat, 0, 0, -spec.tail * 0.34);
    box(this.tail, tw + 0.01, tw + 0.01, spec.tail * 0.34, spec.ruff ? spec.white : spec.dark, 0, 0, -spec.tail * 0.83);

    hitBox(this.root, (w + 0.22) * spec.scale, (lh + h + hh * 0.9) * spec.scale, (d + hd + 0.2) * spec.scale, ((lh + h + hh * 0.9) * spec.scale) / 2, hd * 0.3 * spec.scale);
    this.height = (lh + h + hh * 0.75) * spec.scale;
    this.pop.scale.setScalar(spec.scale);
    this.pose('stand');
    Object.assign(this.cur, this.tgt);
  }

  pose(p: QuadPose, phase = 0) {
    const s = this.spec, L = s.leg[1], h = s.torso[1];
    const v = this.tgt;
    Object.assign(v, zero());
    v.y = L;
    v.tp = s.tailUp;
    switch (p) {
      case 'stand':
        break;
      case 'walk': {
        const sw = Math.sin(phase) * 0.75;
        v.fl = v.br = sw;
        v.fr = v.bl = -sw;
        v.y = L + Math.abs(Math.cos(phase)) * 0.018;
        v.hp = 0.06 + Math.sin(phase * 2) * 0.04;
        break;
      }
      case 'sit': {
        // haunches on the floor, chest up; the front legs reach down from there
        const a = s.sit;
        v.pitch = -a;
        v.y = s.leg[0] * 0.55;
        v.fs = (v.y + this.frontZ * Math.sin(a)) / L - 1;
        v.fl = v.fr = a;
        v.bl = v.br = -(Math.PI / 2 - a);
        v.hp = a * 0.85;
        v.tp = a + 0.12;
        break;
      }
      case 'lie':
      case 'sleep':
        v.y = s.leg[0] / 2 + 0.01;
        v.fl = v.fr = -1.45;
        v.bl = v.br = -1.45;
        v.hp = 0.1;
        v.tp = 0.05;
        if (p === 'sleep') {
          v.hdy = -h * 0.5;
          v.hp = 0.22;
          v.hy = 0.45;
          v.ty = 1.1;
        }
        break;
      case 'sniff':
        v.hp = 0.85;
        v.hdy = -h * 0.42;
        v.hy = Math.sin(phase) * 0.4;
        v.tp = s.tailUp * 0.6;
        break;
      case 'loaf':
      case 'loafSleep':
        v.y = 0.012;
        v.tuck = 1;
        v.tp = 0.02;
        v.ty = 1.35;
        if (p === 'loafSleep') {
          v.hdy = -h * 0.3;
          v.hp = 0.3;
        }
        break;
      case 'arch':
        v.y = L * 1.2;
        v.puff = 0.16;
        v.tp = 1.45;
        v.hp = 0.35;
        break;
      case 'crouch':
        v.y = L * 0.5;
        v.fl = v.fr = -0.95;
        v.bl = v.br = 0.9;
        v.hp = -0.08;
        v.tp = 0.15;
        v.ty = Math.sin(phase) * 0.7;
        break;
      case 'dance': {
        const b = Math.sin(phase);
        v.pitch = -0.3;
        v.y = L + Math.abs(b) * 0.07;
        v.fl = -0.7 + b * 0.7;
        v.fr = -0.7 - b * 0.7;
        v.bl = v.br = 0.3;
        v.hr = b * 0.3;
        v.hp = 0.2;
        break;
      }
    }
  }

  setShown(on: boolean) {
    this.shown = on;
    if (on) this.root.visible = true;
  }

  get isShown() {
    return this.shown;
  }

  setHover(on: boolean) {
    if (on && !this.hover) this.hop();
    this.hover = on;
  }

  /** a little jump on the spot */
  hop() {
    if (this.hopT <= 0) this.hopT = 1;
  }

  tick(dt: number) {
    this.t += dt;
    const k = 1 - Math.exp(-dt * 16);
    const c = this.cur;
    for (const key of KEYS) c[key] += (this.tgt[key] - c[key]) * k;
    this.wagK += (this.wag - this.wagK) * k;
    this.body.position.y = c.y;
    this.body.rotation.x = c.pitch;
    this.head.position.y = this.headY + c.hdy;
    this.head.rotation.set(c.hp, c.hy + this.look, c.hr);
    this.tail.rotation.set(c.tp, c.ty + Math.sin(this.t * 17) * 0.8 * this.wagK + Math.sin(this.t * 1.7) * this.swish, 0);
    this.legs[0].rotation.x = c.fl;
    this.legs[1].rotation.x = c.fr;
    this.legs[0].scale.y = this.legs[1].scale.y = 1 + c.fs;
    this.legs[2].rotation.x = c.bl;
    this.legs[3].rotation.x = c.br;
    for (const l of this.legs) l.visible = c.tuck < 0.5;
    for (const e of this.eyes) e.scale.y = this.eyesShut ? 0.3 : 1;
    this.vis += ((this.shown ? 1 : 0) - this.vis) * (1 - Math.exp(-dt * 9));
    this.hoverK += ((this.hover ? 1 : 0) - this.hoverK) * (1 - Math.exp(-dt * 14));
    if (this.hopT > 0) this.hopT -= dt * 3.4;
    this.pop.position.y = this.hopT > 0 ? Math.sin((1 - this.hopT) * Math.PI) * 0.12 : 0;
    this.pop.scale.setScalar(this.spec.scale * Math.max(0.001, this.vis) * (1 + 0.1 * this.hoverK + c.puff));
    if (!this.shown && this.vis < 0.03) this.root.visible = false;
  }
}

// ---------- what the dog and the cat share: walking the nav grid, hopping onto things, coming and going ----------

interface Hop {
  from: THREE.Vector3;
  to: () => THREE.Vector3;
  t: number;
  dur: number;
  peak: number;
  floor: boolean;
  then?: () => void;
}

abstract class Pet implements P2 {
  x = 0;
  y = 0;
  z = 0;
  heading = 0;
  /** standing on the office floor (not on a perch, a bed or in the air) */
  onFloor = false;
  enabled = true;
  /** text next to the name on the tag */
  doing = '';
  /** the tag stands out (the dog sitting with somebody who needs the user) */
  alert = false;
  protected path: P2[] = [];
  protected speed = 1.5;
  protected phase = 0;
  protected retiring = false;
  private onArrive?: () => void;
  private dodgeT = 0;
  private replanAt = -9;
  private hopS?: Hop;
  private checkT = 0;
  private bubble?: { text: string; until: number };

  constructor(protected pets: Pets, readonly q: Quad, readonly id: string, readonly name: string, private sub: string, private stride: number) {
    pets.world.scene.add(q.root);
  }

  protected get world() {
    return this.pets.world;
  }

  get moving() {
    return this.path.length > 0 || !!this.hopS;
  }

  get hopping() {
    return !!this.hopS;
  }

  get shown() {
    return this.q.root.visible;
  }

  say(text: string, seconds = 2) {
    this.bubble = { text, until: this.world.time + seconds };
  }

  emote(kind: Icon, delay = 0) {
    this.pets.emotes.emit(kind, this.x, this.y + this.q.height + 0.22, this.z, delay);
  }

  /** Walk to a place on the floor. False when there is no way there (the pet stays where it is). */
  go(to: P2, then?: () => void, speed = 1.5): boolean {
    const path = this.pets.route(this, to, this.world.standing(this));
    if (!path) return false;
    this.path = path;
    this.onArrive = then;
    this.speed = speed;
    this.dodgeT = 0;
    return true;
  }

  stop() {
    this.path = [];
    this.onArrive = undefined;
  }

  /** Jump to a point in space (onto a perch, or back down with `floor`). `to` may move, like the vacuum. */
  hop(to: THREE.Vector3 | (() => THREE.Vector3), floor: boolean, then?: () => void) {
    this.stop();
    const get = typeof to === 'function' ? to : () => to;
    const from = new THREE.Vector3(this.x, this.y, this.z);
    const b = get();
    const dy = Math.abs(b.y - from.y);
    this.hopS = { from, to: get, t: 0, dur: 0.3 + dy * 0.2 + Math.hypot(b.x - from.x, b.z - from.z) * 0.08, peak: 0.16 + dy * 0.12, floor, then };
    this.onFloor = false;
  }

  protected stepHop(dt: number) {
    const h = this.hopS!;
    h.t += dt;
    const k = Math.min(1, h.t / h.dur);
    const b = h.to();
    this.x = h.from.x + (b.x - h.from.x) * k;
    this.z = h.from.z + (b.z - h.from.z) * k;
    this.y = h.from.y + (b.y - h.from.y) * k + Math.sin(k * Math.PI) * h.peak;
    if (Math.hypot(b.x - h.from.x, b.z - h.from.z) > 0.08) this.heading = Math.atan2(b.x - h.from.x, b.z - h.from.z);
    this.q.pose('walk', 0.9);
    if (k >= 1) {
      this.y = b.y;
      this.onFloor = h.floor;
      this.hopS = undefined;
      h.then?.();
    }
  }

  protected turnTo(angle: number, dt: number, rate = 8) {
    this.heading += angDiff(angle, this.heading) * Math.min(1, dt * rate);
  }

  /** One frame along the path, around whoever is in the way; never into furniture. */
  protected walk(dt: number) {
    const nav = this.world.office.nav;
    const target = this.path[0];
    const dx = target.x - this.x, dz = target.z - this.z;
    const d = Math.hypot(dx, dz);
    const step = this.speed * dt;
    let ux = d > 0.001 ? dx / d : 0, uz = d > 0.001 ? dz / d : 0;
    const last = this.path.length === 1;
    if (d <= step) {
      this.x = target.x;
      this.z = target.z;
      this.path.shift();
    } else {
      if (!(last && d < 0.5)) {
        const s = steer(nav, this, ux, uz, step, this.world.bodies);
        this.dodgeT = s.x !== ux || s.z !== uz ? this.dodgeT + dt : 0;
        if (this.dodgeT < 2.5) {
          ux = s.x;
          uz = s.z;
        } else if (this.dodgeT > 3.3) this.dodgeT = 0;
      }
      let nx = this.x + ux * step, nz = this.z + uz * step;
      if (!nav.walkable(nx, nz)) {
        // pushed against something: back to the planned line; if that is blocked from here too, plan again
        nx = this.x + (dx / d) * step;
        nz = this.z + (dz / d) * step;
        if (!nav.walkable(nx, nz) && this.world.time - this.replanAt > 0.6) {
          this.replanAt = this.world.time;
          const then = this.onArrive;
          this.go(this.path[this.path.length - 1], then, this.speed);
          return;
        }
      }
      this.x = nx;
      this.z = nz;
      if (!last && this.dodgeT > 0 && Math.hypot(target.x - this.x, target.z - this.z) < 0.3) this.path.shift();
    }
    if (d > 0.001) this.turnTo(Math.atan2(ux, uz), dt, 12);
    this.phase += step * this.stride;
    if (!this.path.length) {
      const cb = this.onArrive;
      this.onArrive = undefined;
      cb?.();
    }
  }

  /** Standing in somebody's way: step aside. True when the pet started to move. */
  protected makeWay(): boolean {
    const nav = this.world.office.nav;
    for (const b of this.world.bodies) {
      if (b === this || !(b as { moving?: boolean }).moving) continue;
      const d = dist(this, b);
      if (d > 0.55 || d < 1e-3) continue;
      const ax = (this.x - b.x) / d, az = (this.z - b.z) / d;
      for (const turn of [0, 0.9, -0.9, 1.8, -1.8]) {
        const c = Math.cos(turn), s = Math.sin(turn);
        const p = { x: this.x + (ax * c + az * s) * 0.75, z: this.z + (-ax * s + az * c) * 0.75 };
        if (nav.walkable(p.x, p.z) && nav.walkable((p.x + this.x) / 2, (p.z + this.z) / 2) && this.go(p, undefined, 2.2)) return true;
      }
    }
    return false;
  }

  /** A desk was unfolded right where the pet stands: get out of it. */
  protected unstick(dt: number) {
    this.checkT += dt;
    if (this.checkT < 0.5) return;
    this.checkT = 0;
    if (this.onFloor && !this.moving && !this.world.office.nav.walkable(this.x, this.z)) this.go(this.pets.floorNear(this), undefined, 2);
  }

  setEnabled(on: boolean) {
    if (on === this.enabled) return;
    this.enabled = on;
    this.retiring = !on;
    this.cancel();
    if (on) this.comeBack();
  }

  /** Disabled in the settings: go home, hop in and vanish there. */
  protected retire(dt: number, home: THREE.Vector3, pose: QuadPose) {
    const at = Math.hypot(this.x - home.x, this.z - home.z) < 0.1 && Math.abs(this.y - home.y) < 0.05;
    if (this.hopping) this.stepHop(dt);
    else if (at) {
      this.q.pose(pose);
      this.q.setShown(false);
    } else if (!this.onFloor) this.hop(this.floorPoint(this.pets.floorNear(this)), true);
    else if (this.path.length) {
      this.walk(dt);
      this.q.pose('walk', this.phase);
    } else {
      const side = this.pets.floorNear(home);
      if (dist(this, side) < 0.35 || !this.go(side, undefined, 2)) this.hop(home, false);
    }
  }

  protected floorPoint(p: P2) {
    return new THREE.Vector3(p.x, 0, p.z);
  }

  protected abstract cancel(): void;
  protected abstract comeBack(): void;

  protected sync() {
    this.q.root.position.set(this.x, this.y, this.z);
    this.q.root.rotation.y = this.heading;
  }

  anchor(): Anchor {
    const live = this.bubble && this.bubble.until > this.world.time ? this.bubble.text : undefined;
    return {
      id: this.id,
      name: this.name,
      sub: this.sub,
      status: this.alert ? 'pet alert' : 'pet',
      doing: this.doing,
      bubble: live,
      pos: new THREE.Vector3(this.x, this.y + this.q.height + 0.12, this.z),
      tps: 0,
      intern: false,
      hidden: !this.shown || !this.q.isShown,
    };
  }
}

// ---------- the dog ----------

type DogAct = 'idle' | 'nap' | 'drink' | 'sniff' | 'sit' | 'dance';

class Dog extends Pet {
  /** who it is sitting with (or running to) right now */
  target?: Worker;
  act: DogAct = 'nap';
  fetching = false;
  private actT = 0;
  private actDur = between(3, 7);
  private sniffs = 0;
  private spot?: { p: P2; wx: number; wz: number };
  private arrived = false;
  private repathT = 0;
  private yieldT = 0;
  private barkT = 1;
  private happyT = 0;
  private queued = false;
  private zT = 0;
  private bedPos: THREE.Vector3;
  private ball: THREE.Mesh;
  private fetch?: { stage: number; t: number; from: THREE.Vector3; land: P2; origin: P2 };

  constructor(pets: Pets) {
    super(
      pets,
      new Quad({
        scale: 1.3, torso: [0.3, 0.26, 0.56], leg: [0.1, 0.24], head: [0.27, 0.24, 0.24], muzzle: [0.15, 0.11, 0.13], ears: 'flop', tail: 0.3, sit: 0.62, tailUp: 0.75,
        // a dark coat disappears in the dark club theme
        coat: pets.world.theme.id === 'boiler' ? '#c9a66b' : '#3f3f4c', white: '#f6f1e6', dark: pets.world.theme.id === 'boiler' ? '#9a7a48' : '#23232b', nose: '#18181d', eye: '#d9963c', collar: '#e8455a', ruff: true,
      }),
      'pet:dog', S.dogName, S.dogSub, 8.5,
    );
    const bed = pets.world.office.pets.dogBed;
    this.bedPos = new THREE.Vector3(bed.x, 0.16, bed.z);
    this.ball = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.13, 0.13), toon('#c8f03c', { emissive: '#c8f03c', emissiveIntensity: 0.35 }));
    this.ball.castShadow = true;
    this.ball.visible = false;
    pets.world.scene.add(this.ball);
    this.comeBack();
  }

  protected comeBack() {
    this.x = this.bedPos.x;
    this.y = this.bedPos.y;
    this.z = this.bedPos.z;
    this.heading = -Math.PI / 2;
    this.onFloor = false;
    this.act = 'nap';
    this.actT = 0;
    this.actDur = between(3, 7);
    this.q.setShown(this.enabled);
    this.sync();
  }

  protected cancel() {
    this.stop();
    this.fetch = undefined;
    this.queued = false;
    this.fetching = false;
    this.ball.visible = false;
    this.target = undefined;
    this.spot = undefined;
    this.happyT = 0;
    this.doing = '';
  }

  hint() {
    if (this.fetch) return S.dogHintFetch(this.name);
    return this.target && this.arrived ? S.dogHintWith(this.name, this.target.thread.name) : S.dogHint(this.name);
  }

  /** click */
  pet() {
    if (!this.shown) return;
    this.happyT = 1.8;
    this.world.sfx.play('yip');
    for (let i = 0; i < 3; i++) this.emote('heart', i * 0.22);
    this.q.hop();
  }

  /** double-click: a ball flies off, the dog brings it back and goes on with what it was doing */
  throwBall() {
    if (!this.shown || this.fetch || this.retiring) return;
    if (this.hopping) return void (this.queued = true);
    this.queued = false;
    if (!this.onFloor) return this.hop(this.floorPoint(this.pets.floorNear(this.bedPos)), true, () => this.throwBall());
    this.stop();
    this.happyT = 0;
    const origin = { x: this.x, z: this.z };
    const land = this.pets.floorAround(origin, 2.6, 5);
    this.fetch = { stage: 0, t: 0, from: new THREE.Vector3(this.x, 0.55, this.z), land, origin };
    this.fetching = true;
    this.ball.visible = true;
    this.world.sfx.play('yip');
    this.emote('bang');
    this.spot = undefined;
  }

  private bark() {
    this.world.sfx.play('bark');
    this.emote('bang');
    this.say(pick(S.woof), 1.6);
    this.q.hop();
    this.barkT = between(22, 45);
  }

  /** Beside the chair if there is room, else anywhere close that is free. */
  private sitSpot(who: Worker): P2 {
    const nav = this.world.office.nav;
    const c = Math.cos(who.heading), s = Math.sin(who.heading);
    const local = (ox: number, oz: number) => ({ x: who.x + ox * c + oz * s, z: who.z - ox * s + oz * c });
    const cands: P2[] = [local(0.85, -0.05), local(-0.85, -0.05), local(0.8, -0.65), local(-0.8, -0.65)];
    for (const r of [0.9, 1.2, 1.5]) for (let a = 0; a < 8; a++) cands.push({ x: who.x + Math.cos(a * 0.785 + 0.4) * r, z: who.z + Math.sin(a * 0.785 + 0.4) * r });
    // where people walk up to this desk stays free
    const keep: P2[] = who.desk ? [who.desk.approach(), who.desk.helpSpot()] : [];
    const free = (p: P2) =>
      nav.walkable(p.x, p.z) &&
      nav.walkable(p.x + 0.2, p.z) && nav.walkable(p.x - 0.2, p.z) && nav.walkable(p.x, p.z + 0.2) && nav.walkable(p.x, p.z - 0.2) &&
      !keep.some((k) => dist(k, p) < 0.5) &&
      !this.world.bodies.some((b) => b !== this && b !== who && dist(b, p) < 0.55);
    return cands.find(free) ?? cands.find((p) => nav.walkable(p.x, p.z)) ?? this.pets.floorNear(who);
  }

  private attend(who: Worker, dt: number) {
    if (!this.onFloor) return this.hop(this.floorPoint(this.pets.floorNear(this.bedPos)), true);
    if (this.target !== who) {
      this.target = who;
      this.spot = undefined;
      this.arrived = false;
      this.stop();
    }
    this.yieldT -= dt;
    this.repathT -= dt;
    const moved = !this.spot || Math.hypot(this.spot.wx - who.x, this.spot.wz - who.z) > 0.6;
    if (moved && this.repathT <= 0) {
      // someone walking is followed at a short distance, someone standing or sitting gets a place beside them
      const p = who.moving ? this.pets.floorNear({ x: who.x - Math.sin(who.heading) * 0.9, z: who.z - Math.cos(who.heading) * 0.9 }) : this.sitSpot(who);
      this.spot = { p, wx: who.x, wz: who.z };
      this.repathT = 0.6;
      this.arrived = false;
      if (dist(this, p) > 0.3) this.go(p, undefined, 2.7);
    } else if (this.spot && !this.path.length && this.yieldT <= 0 && dist(this, this.spot.p) > 0.4) {
      if (!this.go(this.spot.p, undefined, 2.7)) this.spot = undefined;
      this.repathT = 1;
    }
    if (this.path.length) {
      this.walk(dt);
      this.q.pose('walk', this.phase);
      this.q.wag = 0.4;
      this.doing = S.dogTo(who.thread.name);
      return;
    }
    if (who.moving) {
      this.q.pose('stand');
      this.q.wag = 0.5;
      return;
    }
    if (!this.arrived) {
      this.arrived = true;
      this.barkT = 0.7;
      cue('dog', { x: this.x, z: this.z }, 1, 5);
    }
    this.doing = S.dogWith(who.thread.name);
    this.turnTo(Math.atan2(who.x - this.x, who.z - this.z), dt);
    this.q.pose('sit');
    this.q.wag = 0.9;
    this.barkT -= dt;
    if (this.barkT <= 0) this.bark();
    if (this.makeWay()) this.yieldT = 2;
  }

  private choose() {
    const w = this.world, o = w.office;
    const night = w.cycle.lampLevel > 0.6;
    this.actT = 0;
    this.sniffs = 0;
    // out of the bed first
    if (!this.onFloor) return this.hop(this.floorPoint(this.pets.floorNear(this.bedPos)), true);
    if (w.party > 0.5 && w.player.energy > 0.7) {
      // to the edge of the dance floor
      const p = this.pets.floorNear({ x: 6.3 + between(-0.4, 0.4), z: -5.4 + between(-0.5, 0.5) });
      this.act = 'dance';
      this.actDur = 1e9;
      this.go(p, undefined, 2.4);
      return;
    }
    const r = R() * ((night ? 9 : 2) + 1.2 + 3 + 1.5);
    if (r < (night ? 9 : 2)) {
      const side = this.pets.floorNear(this.bedPos);
      const taken = this.pets.cat.on('bed');
      this.act = 'nap';
      this.actDur = between(25, 60) * (night ? 3 : 1);
      // the cat has taken the bed: lie down next to it
      if (!this.go(side, () => !taken && !this.pets.cat.on('bed') && this.hop(this.bedPos, false), 1.5)) this.act = 'idle';
    } else if (r < (night ? 9 : 2) + 1.2) {
      const b = o.pets.bowls;
      this.act = 'drink';
      this.actDur = between(3.5, 5);
      if (!this.go(this.pets.floorNear({ x: b.x - 0.5, z: b.z - 0.16 }), undefined, 1.6)) this.act = 'idle';
    } else if (r < (night ? 9 : 2) + 4.2) {
      this.act = 'sniff';
      this.sniffs = 1 + Math.floor(R() * 3);
      this.actDur = between(2.2, 4);
      if (!this.go(this.pets.randomFloor(), undefined, between(1.4, 1.9))) this.act = 'idle';
    } else {
      this.act = 'sit';
      this.actDur = between(5, 10);
    }
  }

  private dogThings(dt: number) {
    const w = this.world;
    if (this.path.length) {
      this.walk(dt);
      this.q.pose('walk', this.phase);
      this.q.wag = 0.25;
      this.doing = '';
      return;
    }
    this.actT += dt;
    const done = this.actT > this.actDur;
    switch (this.act) {
      case 'idle':
        this.q.pose('stand');
        this.q.wag = 0.2;
        this.doing = '';
        if (this.actT > 0.8) this.choose();
        break;
      case 'nap':
        this.q.pose('sleep');
        this.q.eyesShut = true;
        this.q.wag = 0;
        this.doing = S.dogNap;
        if (this.onFloor) this.turnTo(-Math.PI / 2, dt, 3);
        else this.heading = -Math.PI / 2;
        this.zT -= dt;
        if (this.zT <= 0) {
          this.zT = 2.6;
          this.emote('zzz');
        }
        if (done) this.idleNow();
        break;
      case 'drink':
        this.turnTo(Math.PI / 2, dt);
        this.q.pose('sniff', 0);
        this.q.look = 0;
        this.doing = S.dogDrink;
        if (Math.floor(this.actT / 0.45) !== Math.floor((this.actT - dt) / 0.45)) w.sfx.play('drip');
        if (done) this.idleNow();
        break;
      case 'sniff':
        this.q.pose('sniff', this.actT * 5);
        this.q.wag = 0.5;
        this.doing = S.dogSniff;
        if (done) {
          this.actT = 0;
          if (--this.sniffs > 0 && this.go(this.pets.floorAround(this, 1.5, 4), undefined, 1.6)) break;
          this.act = 'idle';
        }
        break;
      case 'sit':
        this.q.pose('sit');
        this.q.look = Math.sin(this.actT * 0.9) * 0.7;
        this.q.wag = 0.15;
        this.doing = '';
        if (done) this.idleNow();
        break;
      case 'dance':
        this.q.pose('dance', w.beat * Math.PI);
        this.q.wag = 1;
        this.doing = S.dogDance;
        if (w.party < 0.3) this.idleNow();
        break;
    }
    if (this.onFloor && this.act !== 'idle') this.makeWay();
  }

  private idleNow() {
    this.act = 'idle';
    this.actT = 0;
  }

  /** no way to the ball (or back): sit down and call it a day */
  private endFetch(f: { stage: number; t: number }) {
    f.stage = 3;
    f.t = 0;
  }

  private runFetch(dt: number) {
    const f = this.fetch!;
    f.t += dt;
    this.doing = S.dogFetch;
    this.q.wag = 1;
    const mouth = () => this.ball.position.set(this.x + Math.sin(this.heading) * 0.52, 0.4, this.z + Math.cos(this.heading) * 0.52);
    if (f.stage === 0) {
      // the ball flies, bounces once and lies there
      const k = Math.min(1, f.t / 0.95);
      const bounce = k < 0.7 ? Math.sin((k / 0.7) * Math.PI) * 1.1 : Math.sin(((k - 0.7) / 0.3) * Math.PI) * 0.25;
      this.ball.position.set(f.from.x + (f.land.x - f.from.x) * k, 0.07 + f.from.y * (1 - k) * (1 - k) + bounce, f.from.z + (f.land.z - f.from.z) * k);
      this.ball.rotation.x += dt * 9;
      this.turnTo(Math.atan2(f.land.x - this.x, f.land.z - this.z), dt, 10);
      this.q.pose('stand');
      if (k >= 1) {
        f.stage = 1;
        if (!this.go(f.land, undefined, 3.6)) this.endFetch(f);
      }
    } else if (f.stage === 1 || f.stage === 2) {
      if (this.path.length) {
        this.walk(dt);
        this.q.pose('walk', this.phase);
      }
      if (f.stage === 2) mouth();
      if (!this.path.length) {
        if (f.stage === 1) {
          this.world.sfx.play('squeak');
          f.stage = 2;
          mouth();
          if (!this.go(f.origin, undefined, 3)) this.endFetch(f);
        } else {
          f.stage = 3;
          f.t = 0;
          this.ball.position.y = 0.07;
          this.world.sfx.play('yip');
          this.emote('heart');
        }
      }
    } else {
      this.q.pose('sit');
      if (f.t > 1.7) {
        this.ball.visible = false;
        this.fetch = undefined;
        this.fetching = false;
      }
    }
  }

  update(dt: number) {
    if (!this.shown) return;
    const q = this.q;
    q.eyesShut = false;
    q.look = 0;
    this.alert = !!this.target && this.arrived && !this.fetch && !this.retiring;
    if (this.retiring) this.retire(dt, this.bedPos, 'sleep');
    else if (this.hopping) this.stepHop(dt);
    else if (this.queued) this.throwBall();
    else if (this.fetch) this.runFetch(dt);
    else if (this.happyT > 0) {
      // being petted: everything else waits
      this.happyT -= dt;
      q.pose(this.onFloor ? 'sit' : 'lie');
      q.wag = 1;
      q.look = Math.sin(this.happyT * 7) * 0.25;
    } else {
      const who = longestWaiting(this.world);
      if (who) this.attend(who, dt);
      else {
        if (this.target) {
          this.target = undefined;
          this.spot = undefined;
          this.act = 'idle';
          this.actT = 0;
          this.stop();
        }
        this.dogThings(dt);
      }
      this.unstick(dt);
    }
    q.tick(dt);
    this.sync();
  }
}

// ---------- the cat ----------

interface Perch {
  key: string;
  /** where the cat lies; may move (the vacuum) */
  at(): THREE.Vector3;
  rot(): number;
  /** still a good place right now */
  ok(): boolean;
  weight(): number;
  pose: QuadPose;
  label(): string;
  /** reserve or give back the place (couch seats are shared with people) */
  hold?(on: boolean): void;
  moving?: boolean;
  /** the cat got chased off (rather than leaving by itself) */
  shooed?(): void;
}

type CatState = 'rest' | 'toPerch' | 'stroll' | 'floorSit';

class Cat extends Pet {
  state: CatState = 'rest';
  perch?: Perch;
  hunting = false;
  private t = 0;
  private dur = between(4, 9);
  private repathT = 0;
  private purrT = 0;
  private hissT = 0;
  private hissCool = 0;
  private patience = 2 + Math.floor(R() * 3);
  private zT = 1;
  private wasParty = false;
  private queued = false;
  private perches: Perch[] = [];
  private tree: Perch;
  private laserDot: THREE.Mesh;
  private laser?: { t: number; dur: number; goal: P2; moveT: number; home: P2 };

  constructor(pets: Pets) {
    super(
      pets,
      new Quad({
        scale: 1.25, torso: [0.2, 0.18, 0.4], leg: [0.07, 0.13], head: [0.22, 0.19, 0.18], muzzle: [0.12, 0.07, 0.04], ears: 'point', tail: 0.38, sit: 0.8, tailUp: 1.05,
        coat: '#ec9a3e', white: '#fff3df', dark: '#b96a22', nose: '#ff9aa8', eye: '#27402a', stripes: true,
      }),
      'pet:cat', S.catName, S.catSub, 13,
    );
    this.laserDot = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.012, 0.09), glow('#ff2a2a', 3));
    this.laserDot.visible = false;
    pets.world.scene.add(fx(this.laserDot));
    this.tree = this.buildPerches();
    this.comeBack();
  }

  private buildPerches() {
    const w = this.world, o = w.office;
    const night = () => w.cycle.lampLevel > 0.6;
    const quiet = () => (this.pets.partying ? 0 : 1);
    const fixed = (key: string, x: number, y: number, z: number, rot: number, pose: QuadPose, label: () => string, weight: () => number, extra: Partial<Perch> = {}): Perch => {
      const v = new THREE.Vector3(x, y, z);
      const p: Perch = { key, at: () => v, rot: () => rot, ok: () => true, weight, pose, label, ...extra };
      this.perches.push(p);
      return p;
    };
    const t = o.pets.catTree;
    const tree = fixed('tree', t.x, t.top, t.z, 0.6, 'loafSleep', () => S.catSleep, () => (night() ? 5 : 2) * (this.pets.partying ? 3 : 1));
    // warm racks: the busier the agents, the better
    const rack = o.rooms.server.perch;
    fixed('rack', rack.x, rack.y, rack.z, Math.PI / 2, 'loafSleep', () => S.catServer, () => (this.pets.load > 0.5 ? 6 : 0.7));
    const bed = o.pets.dogBed;
    fixed('bed', bed.x, 0.16, bed.z, -0.5, 'loafSleep', () => S.catSleep, () => (this.pets.dog.shown && dist(this.pets.dog, bed) < 2.5 ? 0 : 0.7), { ok: () => !this.pets.dog.shown || this.pets.dog.onFloor });
    const couches = o.spots.couch ?? [];
    for (const s of couches) {
      const sofa = !!w.theme.props.couch && Math.abs(s.z - 7.5) < 0.01;
      const free = (sp: Spot) => !sp.taken || sp.taken === this.id;
      fixed('couch', s.x, sofa ? 0.38 : 0.34, s.z + (sofa ? 0.1 : 0), s.rot + 0.5, 'loafSleep', () => S.catSleep, () => (free(s) ? (2.2 / couches.length) * quiet() : 0), {
        ok: () => free(s),
        hold: (on) => void (s.taken = on ? this.id : undefined),
      });
    }
    // window sills: one place per window that has free floor in front of it
    const sills = (o.spots.window ?? []).filter((_, i) => i % 2 === 0);
    for (const s of sills)
      fixed('sill', s.x, 0.99, ROOM.minZ - 0.03, Math.PI / 2, 'loaf', () => S.catWindow, () => ((night() ? 0.8 : 2.4) * (w.weather.rain > 0.3 ? 1.6 : 1) * quiet()) / sills.length);
    // the vacuum, while it cleans
    const vac = this.pets.vacuum;
    const seat = new THREE.Vector3();
    this.perches.push({
      key: 'vacuum',
      at: () => seat.set(vac.x, 0.105, vac.z),
      rot: () => vac.heading,
      ok: () => vac.state === 'cleaning' || vac.state === 'paused',
      weight: () => (vac.state === 'cleaning' && vac.battery > 0.35 ? 3 : 0) * quiet(),
      pose: 'loaf',
      label: () => S.catRide(vac.name),
      moving: true,
    });
    return tree;
  }

  /** the keyboard of somebody who has nothing to do right now */
  private deskPerch(): Perch | undefined {
    const idle = [...this.world.workers.values()].filter((o) => !o.intern && o.desk && o.thread.status === 'idle' && o.mode === 'seated' && !o.thread.settled);
    if (!idle.length || this.pets.partying) return undefined;
    const who = pick(idle), d = who.desk!;
    const rot = d.seat.rot, c = Math.cos(rot), s = Math.sin(rot);
    const lx = -0.02 * PERSON, lz = 0.42 * PERSON;
    const v = new THREE.Vector3(d.seat.x + lx * c + lz * s, DESK_TOP, d.seat.z - lx * s + lz * c);
    const mine = () => who.desk === d && this.world.workers.get(who.thread.id) === who && !who.thread.settled;
    return {
      key: 'desk',
      at: () => v,
      rot: () => rot + Math.PI / 2,
      ok: () => mine() && who.thread.status === 'idle' && who.mode !== 'pack' && who.mode !== 'leaving',
      weight: () => 2.5,
      pose: 'loaf',
      label: () => S.catDesk(who.thread.name),
      shooed: () => mine() && who.mode === 'seated' && who.say(pick(S.shoo(this.name)), 2.8),
    };
  }

  /** Sends the cat to one of its places: 'tree', 'rack', 'bed', 'couch', 'sill', 'desk' or 'vacuum' (if that is possible right now). */
  visit(key: string) {
    if (this.shown && !this.retiring && !this.laser && !this.hopping) this.next(key);
  }

  /** resting on (or on the way to) the perch with this key */
  on(key: string) {
    return this.perch?.key === key && this.shown;
  }

  protected comeBack() {
    const p = this.tree.at();
    this.x = p.x;
    this.y = p.y;
    this.z = p.z;
    this.heading = this.tree.rot();
    this.onFloor = false;
    this.perch = this.tree;
    this.state = 'rest';
    this.t = 0;
    this.dur = between(4, 9);
    this.q.setShown(this.enabled);
    this.sync();
  }

  protected cancel() {
    this.stop();
    this.laser = undefined;
    this.queued = false;
    this.hunting = false;
    this.laserDot.visible = false;
    this.release();
    this.purrT = this.hissT = 0;
    this.doing = '';
  }

  private release() {
    this.perch?.hold?.(false);
    this.perch = undefined;
  }

  hint() {
    return this.laser ? S.catHintLaser(this.name) : S.catHint(this.name);
  }

  /** click: mostly it purrs; now and then it has had enough and walks off */
  pet() {
    if (!this.shown || this.retiring) return;
    if (this.laser) return this.emote('heart');
    if (--this.patience <= 0) {
      this.patience = 2 + Math.floor(R() * 3);
      this.emote('dots');
      this.say(S.unimpressed, 1.5);
      this.world.sfx.play('meow');
      this.purrT = 0;
      if (!this.hopping) this.next();
      return;
    }
    this.purrT = 3;
    this.world.sfx.play('purr');
    this.emote('heart');
    this.say(S.purr, 2.5);
    this.q.hop();
  }

  /** double-click: a red dot on the floor to chase for a few seconds */
  laserPointer() {
    if (!this.shown || this.retiring || this.laser) return;
    // in mid-air: as soon as it has landed
    if (this.hopping) return void (this.queued = true);
    this.queued = false;
    if (!this.onFloor) {
      const down = this.pets.floorNear(this);
      this.release();
      return this.hop(this.floorPoint(down), true, () => this.laserPointer());
    }
    this.release();
    this.stop();
    this.purrT = 0;
    this.laser = { t: 0, dur: 7.5, goal: this.pets.floorAround(this, 0.8, 1.6), moveT: 0.9, home: { x: this.x, z: this.z } };
    this.hunting = true;
    this.laserDot.position.set(this.laser.goal.x, 0.02, this.laser.goal.z);
    this.laserDot.visible = true;
    this.emote('bang');
    this.world.sfx.play('meow');
  }

  private runLaser(dt: number) {
    const L = this.laser!;
    L.t += dt;
    L.moveT -= dt;
    const dot = this.laserDot.position;
    const k = Math.min(1, dt * 12);
    dot.x += (L.goal.x - dot.x) * k;
    dot.z += (L.goal.z - dot.z) * k;
    const near = Math.hypot(dot.x - this.x, dot.z - this.z) < 0.35;
    if (near || L.moveT <= 0) {
      if (near) this.q.hop();
      // the dot always gets away
      // … but stays around where the game began
      for (let i = 0; i < 6; i++) {
        L.goal = this.pets.floorAround(L.home, 0.4, 2.6);
        if (dist(L.goal, this) > 1.2) break;
      }
      L.moveT = between(0.8, 1.5);
      this.go(L.goal, undefined, 3.4);
    }
    if (this.path.length) {
      this.walk(dt);
      this.q.pose('walk', this.phase);
    } else {
      this.turnTo(Math.atan2(dot.x - this.x, dot.z - this.z), dt, 10);
      this.q.pose('crouch', L.t * 9);
    }
    this.doing = S.catHunt;
    if (L.t > L.dur) {
      this.laser = undefined;
      this.hunting = false;
      this.laserDot.visible = false;
      this.stop();
      this.emote('what');
      this.state = 'floorSit';
      this.t = 0;
      this.dur = 3.5;
    }
  }

  /** Whatever comes next: down from the perch first, then a stroll or another place to lie. */
  private next(want?: string) {
    const old = this.perch;
    this.release();
    this.stop();
    this.t = 0;
    if (!this.onFloor) return this.hop(this.floorPoint(this.pets.floorNear(this)), true, () => this.next(want));
    if (!want && R() < 0.22) {
      this.state = 'stroll';
      this.dur = between(5, 11);
      if (this.go(this.pets.randomFloor(), undefined, between(0.9, 1.25))) return;
    }
    const desk = this.deskPerch();
    const all = (desk ? [...this.perches, desk] : this.perches).filter((p) => p !== old && p.ok() && p.weight() > 0);
    let r = R() * all.reduce((s, p) => s + p.weight(), 0);
    const p = (want && [...this.perches, desk].find((c) => c?.key === want && c.ok())) || (all.find((c) => (r -= c.weight()) <= 0) ?? this.tree);
    this.perch = p;
    p.hold?.(true);
    this.state = 'toPerch';
    this.repathT = 0;
    this.dur = between(25, 60) * (p.pose === 'loafSleep' && this.world.cycle.lampLevel > 0.6 ? 2.5 : 1) * (p.moving ? 0.6 : 1);
    if (!p.moving && !this.go(this.pets.floorNear(p.at()), undefined, between(1.0, 1.3))) {
      this.release();
      this.state = 'floorSit';
      this.dur = 3;
    }
  }

  private idle(dt: number) {
    const p = this.perch;
    this.t += dt;
    switch (this.state) {
      case 'rest': {
        if (!p) return this.next();
        const at = p.at();
        this.x = at.x;
        this.y = at.y;
        this.z = at.z;
        if (p.moving) this.heading = p.rot();
        else this.turnTo(p.rot(), dt, 4);
        this.q.pose(p.pose);
        this.q.eyesShut = p.pose === 'loafSleep';
        if (p.key === 'sill') this.q.look = 0.9;
        this.doing = p.label();
        if (this.q.eyesShut) {
          this.zT -= dt;
          if (this.zT <= 0) {
            this.zT = 3.2;
            this.emote('zzz');
          }
        }
        if (!p.ok()) {
          p.shooed?.();
          this.next();
        } else if (this.t > this.dur) this.next();
        break;
      }
      case 'toPerch': {
        if (!p || !p.ok()) return this.next();
        this.doing = '';
        const at = p.at();
        if (p.moving) {
          // the vacuum does not wait: keep after it and jump when it is close
          this.repathT -= dt;
          if (dist(this, at) < 0.8) return this.hop(() => p.at(), false, () => this.settle());
          if (this.repathT <= 0) {
            this.repathT = 0.7;
            if (!this.go(this.pets.floorNear(at), undefined, 1.9)) return this.next();
          }
          if (this.t > 25) return this.next();
        }
        if (this.path.length) {
          this.walk(dt);
          this.q.pose('walk', this.phase);
        } else if (!p.moving) this.hop(at, false, () => this.settle());
        break;
      }
      case 'stroll':
        this.doing = '';
        if (this.path.length) {
          this.walk(dt);
          this.q.pose('walk', this.phase);
        } else {
          this.state = 'floorSit';
          this.t = 0;
        }
        break;
      case 'floorSit':
        // sits and washes
        this.doing = '';
        this.q.pose('sit');
        this.q.look = Math.sin(this.t * 1.1) * 0.6;
        if (this.makeWay()) this.state = 'stroll';
        else if (this.t > this.dur) this.next();
        break;
    }
  }

  private settle() {
    this.state = 'rest';
    this.t = 0;
    if (this.perch?.moving) cue('cat-ride', { x: this.x, z: this.z }, 1, 6);
  }

  update(dt: number) {
    if (!this.shown) return;
    const q = this.q, pets = this.pets;
    q.eyesShut = false;
    q.look = 0;
    q.wag = 0;
    q.swish = this.onFloor ? 0.25 : 0.08;
    this.hissCool -= dt;
    // the party is not for cats: off to somewhere quiet, once
    if (pets.partying && !this.wasParty && this.perch && this.state === 'rest' && !['tree', 'rack', 'bed'].includes(this.perch.key) && !this.retiring && !this.laser) {
      this.emote('anger');
      this.next();
    }
    this.wasParty = pets.partying;

    if (this.retiring) this.retire(dt, this.tree.at(), 'loaf');
    else if (this.hopping) this.stepHop(dt);
    else if (this.queued) this.laserPointer();
    else if (this.laser) this.runLaser(dt);
    else if (this.hissT > 0) {
      this.hissT -= dt;
      q.pose('arch');
      this.turnTo(Math.atan2(pets.dog.x - this.x, pets.dog.z - this.z), dt, 10);
    } else if (this.purrT > 0) {
      this.purrT -= dt;
      const p = this.perch;
      if (this.state === 'rest' && p) {
        // a perch may move on while it purrs
        const at = p.at();
        this.x = at.x;
        this.y = at.y;
        this.z = at.z;
        if (p.moving) this.heading = p.rot();
      }
      q.pose(this.onFloor ? 'sit' : (p?.pose ?? 'loaf'));
      q.eyesShut = true;
      q.swish = 0.5;
      q.look = Math.sin(this.purrT * 3) * 0.2;
      this.doing = S.catPurr;
    } else {
      const dog = pets.dog;
      if (this.onFloor && dog.shown && dog.onFloor && this.hissCool <= 0 && dist(this, dog) < 0.95) {
        // the dog came too close: once is enough
        this.hissCool = 45;
        this.hissT = 1.3;
        this.emote('anger');
        this.say(S.hiss, 1.5);
        this.world.sfx.play('hiss');
      } else this.idle(dt);
      this.unstick(dt);
    }
    q.tick(dt);
    this.sync();
  }
}

// ---------- the robot vacuum ----------

export type VacuumState = 'docked' | 'cleaning' | 'paused' | 'returning' | 'off';

class Vacuum implements P2 {
  readonly id = 'pet:vacuum';
  readonly name = S.vacName;
  x: number;
  z: number;
  heading = 0;
  state: VacuumState = 'docked';
  /** 0..1; a run ends when it gets low, the dock fills it up again */
  battery = 1;
  enabled = true;
  doing = '';
  private g: THREE.Group;
  private light: THREE.MeshBasicMaterial;
  private dock: P2;
  private path: P2[] = [];
  private docking = false;
  /** places still to clean on this run, with the seconds to spend at each */
  private todo: { p: P2; roam: number }[] = [];
  private place?: P2;
  private roam = 0;
  private turn = 0;
  private blockedT = 0;
  private pausedT = 0;
  private bumpT = 0;
  private jolt = 0;
  private dirt: P2[] = [];
  private sinceRun = 0;
  private slot = '';
  private vis = 1;
  private hover = false;
  private hoverK = 0;
  private t = 0;
  private bubble?: { text: string; until: number };

  constructor(private pets: Pets) {
    const o = pets.world.office;
    this.g = o.roomba;
    this.dock = o.roombaDock;
    this.x = this.dock.x;
    this.z = this.dock.z;
    this.light = (this.g.children[1] as THREE.Mesh).material as THREE.MeshBasicMaterial;
    // a face for the little robot: lid, bumper and two wheels
    const lid = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.02, 10), toon('#4a4a56'));
    lid.position.y = 0.1;
    this.g.add(lid);
    box(this.g, 0.3, 0.05, 0.05, '#c8ccd4', 0, 0.045, 0.19).castShadow = false;
    hitBox(this.g, 0.62, 0.3, 0.62, 0.15);
    this.enabled = settings.get('vacuum');
    if (!this.enabled) {
      this.state = 'off';
      this.vis = 0;
      this.g.visible = false;
    }
  }

  get moving() {
    return this.state === 'cleaning' || this.state === 'returning';
  }

  /** out on the floor, where people have to walk around it */
  get out() {
    return this.state !== 'docked' && this.state !== 'off';
  }

  hint() {
    const n = this.name;
    return this.state === 'cleaning' ? S.vacHintCleaning(n) : this.state === 'paused' ? S.vacHintPaused(n) : this.state === 'returning' ? S.vacHintReturning(n) : S.vacHintDocked(n);
  }

  setHover(on: boolean) {
    this.hover = on;
  }

  private beep(name: SfxName) {
    this.pets.world.sfx.play(name);
    this.bubble = { text: S.beep, until: this.pets.world.time + 1.2 };
  }

  /** click: start a run, pause it, carry on */
  toggle() {
    if (this.state === 'off') return;
    if (this.state === 'cleaning') {
      this.state = 'paused';
      this.pausedT = 0;
      this.beep('vacOff');
    } else if (this.state === 'paused') {
      this.state = 'cleaning';
      this.beep('vacOn');
    } else this.start(true);
  }

  /** Start a cleaning run: whatever needs cleaning first, then (`tour`) a round through the office. */
  start(tour = true) {
    if (this.state === 'off') return;
    const stops = this.dirt.splice(0).map((p) => ({ p, roam: 6 }));
    if (tour) for (let i = 0; i < 5; i++) stops.push({ p: this.pets.randomFloor(), roam: between(7, 11) });
    // nearest first, so it does not criss-cross the office
    this.todo = [];
    let at: P2 = this;
    while (stops.length) {
      const i = stops.reduce((b, s, j) => (dist(s.p, at) < dist(stops[b].p, at) ? j : b), 0);
      at = stops[i].p;
      this.todo.push(...stops.splice(i, 1));
    }
    this.state = 'cleaning';
    this.path = [];
    this.docking = false;
    this.roam = 0;
    this.sinceRun = 0;
    this.beep('vacOn');
  }

  /** double-click: back to the dock */
  home() {
    if (this.state === 'off' || this.state === 'docked') return;
    if (this.state !== 'returning') this.beep('vacOff');
    this.state = 'returning';
    this.todo = [];
    this.path = [];
    this.docking = false;
  }

  /** something to clean up at this place (confetti, a party) */
  mess(p: P2) {
    const near = this.pets.floorNear(p);
    if (this.state === 'cleaning' || this.state === 'paused') this.todo.push({ p: near, roam: 6 });
    else if (this.dirt.length < 5) this.dirt.push(near);
  }

  setEnabled(on: boolean) {
    if (on === this.enabled) return;
    this.enabled = on;
    if (on) {
      this.state = 'docked';
      this.x = this.dock.x;
      this.z = this.dock.z;
      this.heading = 0;
      this.g.visible = true;
    } else if (this.state === 'docked') this.state = 'off';
    else this.home();
  }

  private ahead(reach: number) {
    const fx = Math.sin(this.heading), fz = Math.cos(this.heading);
    for (const b of this.pets.world.bodies) {
      if (b === this) continue;
      const ox = b.x - this.x, oz = b.z - this.z;
      const d = Math.hypot(ox, oz);
      if (d < reach && ox * fx + oz * fz > d * 0.35) return true;
    }
    return false;
  }

  /** Turn towards a point, then drive; waits while somebody stands in front. True on arrival. */
  private drive(dt: number, to: P2, speed: number, careful = true) {
    const dx = to.x - this.x, dz = to.z - this.z;
    const d = Math.hypot(dx, dz);
    const step = speed * dt;
    if (d <= step) {
      this.x = to.x;
      this.z = to.z;
      return true;
    }
    const diff = angDiff(Math.atan2(dx, dz), this.heading);
    this.heading += clamp(diff, -4 * dt, 4 * dt);
    if (Math.abs(diff) > 0.3) return false;
    if (careful && this.ahead(0.7)) {
      this.blockedT += dt;
      return false;
    }
    this.blockedT = 0;
    this.x += (dx / d) * step;
    this.z += (dz / d) * step;
    return false;
  }

  private bump(hard: boolean) {
    // away from the wall; when it has strayed, back towards the place it is cleaning
    const back = this.place && dist(this, this.place) > 2.6;
    this.turn = back ? angDiff(Math.atan2(this.place!.x - this.x, this.place!.z - this.z) + between(-0.5, 0.5), this.heading) : (R() < 0.5 ? -1 : 1) * between(1.7, 2.9);
    if (hard && this.bumpT <= 0) {
      this.bumpT = 2.5;
      this.jolt = 1;
      this.pets.world.sfx.play('bump');
    }
  }

  private clean(dt: number) {
    const nav = this.pets.world.office.nav;
    this.battery -= dt / 170;
    if (this.battery < 0.1) return this.home();
    if (this.turn) {
      const a = clamp(this.turn, -3.6 * dt, 3.6 * dt);
      this.heading += a;
      this.turn -= a;
      if (Math.abs(this.turn) < 0.02) this.turn = 0;
      return;
    }
    // a desk was unfolded on top of it: out of there first
    if (!this.path.length && !nav.walkable(this.x, this.z)) this.path = [this.pets.floorNear(this)];
    if (this.path.length) {
      if (this.drive(dt, this.path[0], 0.8)) this.path.shift();
      if (this.blockedT > 2) {
        // somebody stands in the way: clean right here instead
        this.blockedT = 0;
        this.path = [];
      }
      if (!this.path.length) this.place = { x: this.x, z: this.z };
      return;
    }
    if (this.roam > 0) {
      // the way robot vacuums do it: straight on until something is in the way, then turn
      this.roam -= dt;
      const step = 0.6 * dt;
      const fx = Math.sin(this.heading), fz = Math.cos(this.heading);
      if (!nav.walkable(this.x + fx * (step + 0.1), this.z + fz * (step + 0.1))) this.bump(true);
      else if (this.ahead(0.75)) this.bump(false);
      else {
        this.x += fx * step;
        this.z += fz * step;
      }
      return;
    }
    const next = this.todo.shift();
    if (!next) return this.home();
    const path = this.pets.route(this, next.p);
    this.roam = next.roam;
    this.place = next.p;
    if (path) this.path = path;
    else this.place = { x: this.x, z: this.z };
  }

  private goHome(dt: number) {
    if (!this.path.length && !this.docking) {
      const front = this.pets.floorNear({ x: this.dock.x, z: this.dock.z + 0.45 });
      this.path = this.pets.route(this, front) ?? [front];
      this.docking = true;
      this.blockedT = 0;
    }
    if (this.path.length) {
      if (this.drive(dt, this.path[0], 0.95)) this.path.shift();
      if (this.blockedT > 2.5) {
        // plan around whoever stands there
        this.blockedT = 0;
        const front = this.path[this.path.length - 1];
        this.path = this.pets.route(this, front, this.pets.world.standing(this)) ?? this.path;
      }
      return;
    }
    // the last bit onto the charging contacts
    if (!this.drive(dt, this.dock, 0.5, false)) return;
    this.docking = false;
    this.state = this.enabled ? 'docked' : 'off';
    this.pets.world.sfx.play('vacDock');
  }

  /** The scheduled runs: early morning, lunch, evening, and every two hours through the night. */
  private schedule() {
    const w = this.pets.world;
    const h = w.now.getHours() + w.now.getMinutes() / 60;
    const slot = w.cycle.lampLevel > 0.75 ? `n${Math.floor(h / 2)}` : `d${[6.5, 13, 20].filter((s) => h >= s).length}`;
    if (slot === this.slot) return false;
    const first = !this.slot;
    this.slot = slot;
    // on page load only a night run starts right away
    return !first || slot[0] === 'n';
  }

  update(dt: number) {
    this.t += dt;
    this.bumpT -= dt;
    this.sinceRun += dt;
    this.vis += ((this.state === 'off' ? 0 : 1) - this.vis) * (1 - Math.exp(-dt * 8));
    this.hoverK += ((this.hover ? 1 : 0) - this.hoverK) * (1 - Math.exp(-dt * 14));
    if (this.state === 'off') {
      if (this.vis < 0.03) this.g.visible = false;
    } else if (this.state === 'docked') {
      this.heading += angDiff(0, this.heading) * Math.min(1, dt * 4);
      this.battery = Math.min(1, this.battery + dt / 45);
      const due = this.schedule();
      if (this.battery > 0.9 && (due || (this.dirt.length > 0 && this.sinceRun > 100))) this.start(due);
    } else if (this.state === 'cleaning') this.clean(dt);
    else if (this.state === 'returning') this.goHome(dt);
    else if (this.state === 'paused') {
      this.pausedT += dt;
      if (this.pausedT > 45) this.home();
    }

    // the light says what it is up to
    const blink = 0.6 + 0.4 * Math.sin(this.t * 6);
    const [col, k] =
      this.state === 'cleaning' ? ['#5ef0ff', 2.2] : this.state === 'paused' ? ['#ffb23f', 1 + 1.6 * blink] : this.state === 'returning' ? ['#b08cff', 2] : this.battery < 0.98 ? ['#7dffb0', 0.6 + 1.2 * blink] : ['#7dffb0', 1.1];
    this.light.color.set(col as string).multiplyScalar((k as number) * (1 + this.hoverK));
    this.doing = this.state === 'cleaning' ? S.vacCleaning : this.state === 'paused' ? S.vacPaused : this.state === 'returning' ? S.vacReturning : this.battery < 0.98 ? S.vacCharging : '';
    if (this.jolt > 0) this.jolt -= dt * 6;
    const j = Math.max(0, this.jolt) * 0.05;
    this.g.position.set(this.x - Math.sin(this.heading) * j, 0.03 * this.hoverK, this.z - Math.cos(this.heading) * j);
    this.g.rotation.y = this.heading;
    this.g.scale.setScalar(Math.max(0.001, this.vis) * (1 + 0.12 * this.hoverK));
  }

  anchor(): Anchor {
    const w = this.pets.world;
    return {
      id: this.id,
      name: this.name,
      sub: S.vacSub,
      status: 'pet',
      doing: this.doing,
      bubble: this.bubble && this.bubble.until > w.time ? this.bubble.text : undefined,
      pos: new THREE.Vector3(this.x, 0.42, this.z),
      tps: 0,
      intern: false,
      // parked at the dock it needs no label
      hidden: !this.out,
    };
  }
}

// ---------- all three ----------

export class Pets {
  readonly emotes: Emotes;
  readonly vacuum: Vacuum;
  readonly dog: Dog;
  readonly cat: Cat;
  /** a DJ set is on and the lights are going */
  partying = false;
  /** share of the agents who are working right now, 0..1 (warm racks) */
  load = 0;
  private partied = 0;
  private loadT = 0;

  constructor(readonly world: World) {
    this.emotes = new Emotes(world.scene);
    this.vacuum = new Vacuum(this);
    this.dog = new Dog(this);
    this.cat = new Cat(this);
    this.dog.setEnabled(settings.get('dog'));
    this.cat.setEnabled(settings.get('cat'));
    settings.on('dog', (on) => this.dog.setEnabled(on));
    settings.on('cat', (on) => this.cat.setEnabled(on));
    settings.on('vacuum', (on) => this.vacuum.setEnabled(on));

    const { dog, cat, vacuum } = this;
    addClickable({ objects: [dog.q.root], hint: () => dog.hint(), onClick: () => dog.pet(), onDouble: () => dog.throwBall(), onHover: (on) => dog.q.setHover(on) });
    addClickable({ objects: [cat.q.root], hint: () => cat.hint(), onClick: () => cat.pet(), onDouble: () => cat.laserPointer(), onHover: (on) => cat.q.setHover(on) });
    addClickable({ objects: [world.office.roomba], hint: () => vacuum.hint(), onClick: () => vacuum.toggle(), onDouble: () => vacuum.home(), onHover: (on) => vacuum.setHover(on) });

    // confetti on the floor where a thread was finished
    world.source.subscribe((e) => {
      if (e.type !== 'status' || e.to !== 'completed') return;
      const d = world.workers.get(e.id)?.desk;
      if (d) this.mess(d.approach());
    });
  }

  /** Something to clean up at this place; the vacuum comes by on its next run (or right away while it is out). */
  mess(p: P2) {
    this.vacuum.mess(p);
  }

  /** Adds whoever is on the floor to the people everybody walks around. */
  bodies(out: P2[]) {
    if (this.dog.shown && this.dog.onFloor) out.push(this.dog);
    if (this.cat.shown && this.cat.onFloor) out.push(this.cat);
    if (this.vacuum.out) out.push(this.vacuum);
  }

  /** A walkable way from a to b, or null when there is none (never a line through a wall). */
  route(from: P2, to: P2, avoid: P2[] = []): P2[] | null {
    const nav = this.world.office.nav;
    const path = nav.findPath({ x: from.x, z: from.z }, to, avoid);
    let a: P2 = from;
    for (const b of path) {
      const d = dist(a, b);
      const n = Math.ceil(d / 0.08);
      // brushing a corner is fine (the grid's own line of sight allows it), crossing something is not;
      // and the first steps may lead out of a spot that is not walkable itself
      let inside = 0;
      for (let i = 1; i <= n; i++) {
        const x = a.x + ((b.x - a.x) * i) / n, z = a.z + ((b.z - a.z) * i) / n;
        if (nav.walkable(x, z) || (a === from && (d * i) / n < 0.6)) inside = 0;
        else if (++inside >= 4) return null;
      }
      a = b;
    }
    return path;
  }

  /** The walkable point closest to p. */
  floorNear(p: P2): P2 {
    const nav = this.world.office.nav;
    if (nav.walkable(p.x, p.z)) return { x: p.x, z: p.z };
    for (let r = 0.2; r < 2.6; r += 0.15)
      for (let a = 0; a < 12; a++) {
        const x = p.x + Math.cos(a * 0.5236) * r, z = p.z + Math.sin(a * 0.5236) * r;
        if (nav.walkable(x, z)) return { x, z };
      }
    return { x: p.x, z: p.z };
  }

  /** A walkable point with some room around it, between rMin and rMax away from p. */
  floorAround(p: P2, rMin: number, rMax: number): P2 {
    const nav = this.world.office.nav;
    for (let i = 0; i < 30; i++) {
      const a = R() * Math.PI * 2, r = between(rMin, rMax);
      const x = p.x + Math.cos(a) * r, z = p.z + Math.sin(a) * r;
      if (this.roomy(x, z) && nav.walkable((x + p.x) / 2, (z + p.z) / 2)) return { x, z };
    }
    return this.floorNear(p);
  }

  /** Somewhere on the open floor of the main room. */
  randomFloor(): P2 {
    for (let i = 0; i < 40; i++) {
      const x = between(ROOM.minX + 1, 12.6), z = between(ROOM.minZ + 1.3, ROOM.maxZ - 0.9);
      if (this.roomy(x, z)) return { x, z };
    }
    return this.floorNear(this.world.office.pets.dogBed);
  }

  private roomy(x: number, z: number) {
    const nav = this.world.office.nav;
    return nav.walkable(x, z) && nav.walkable(x + 0.3, z) && nav.walkable(x - 0.3, z) && nav.walkable(x, z + 0.3) && nav.walkable(x, z - 0.3);
  }

  update(dt: number) {
    const w = this.world;
    this.partying = w.party > 0.5 && w.player.energy > 0.7;
    // after a party the dance floor needs the vacuum
    if (this.partying) this.partied += dt;
    else if (w.party < 0.05 && this.partied > 0) {
      if (this.partied > 20) for (const s of (w.office.spots.dance ?? []).filter((_, i) => i % 3 === 0)) this.mess(s);
      this.partied = 0;
    }
    this.loadT -= dt;
    if (this.loadT <= 0) {
      this.loadT = 1;
      let n = 0, run = 0;
      for (const o of w.workers.values()) {
        if (o.intern) continue;
        n++;
        if (o.thread.status === 'running') run++;
      }
      this.load = n ? run / n : 0;
    }
    this.vacuum.update(dt);
    this.dog.update(dt);
    this.cat.update(dt);
    this.emotes.update(dt);
  }

  /** name tags for the HUD, in the shape of the people's */
  anchors(): Anchor[] {
    return [this.dog.anchor(), this.cat.anchor(), this.vacuum.anchor()];
  }
}

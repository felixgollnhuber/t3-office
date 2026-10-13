import * as THREE from 'three';
import { toon, glow, glowMap, glass, additive } from './materials';
import { canvasTexture, labelTexture, rand, pick } from './textures';
import { fx, pottedPlant, rugMesh, ROOM, WING, PERSON, type Spot } from './office';
import type { NavGrid } from './nav';
import type { Theme } from './themes';
import { S } from './i18n/world';

export type Season = 'none' | 'halloween' | 'winter' | 'christmas';
interface P {
  x: number;
  z: number;
}
/** a canvas on a wall that others may repaint (same shape as the pinboard) */
export interface PaintedScreen {
  mesh: THREE.Mesh;
  g: CanvasRenderingContext2D;
  tex: THREE.CanvasTexture;
  center: THREE.Vector3;
  width: number;
  height: number;
}

export interface Extras {
  rooms: {
    server: { setLoad(k: number): void; center: P; perch: P & { y: number } };
    meeting: { center: P; screen: PaintedScreen };
    nap: { center: P };
  };
  shredder: { run(): void };
  gong: { hit(): void; object: THREE.Object3D };
  alarm: { set(on: boolean): void };
  pets: { dogBed: P; catTree: P & { top: number }; bowls: P };
  roombaDock: P;
  season: { set(kind: Season): void };
  fx: { update(dt: number): void };
}

type Tick = (dt: number, t: number) => void;

export interface Ctx {
  scene: THREE.Scene;
  theme: Theme;
  nav: NavGrid;
  spots: Record<string, Spot[]>;
  glassMat: THREE.MeshBasicMaterial;
  lampMats: THREE.MeshBasicMaterial[];
  pointLamp: (x: number, y: number, z: number, color: string, intensity: number, dist?: number) => void;
  /** back-wall windows: centres, width, sill and top height */
  windows: number[];
  winW: number;
  sill: number;
  top: number;
  /** the boss office's glass corner */
  boss: P;
}

const GH = 2.7, DOOR_H = 2.2;
/** where the wing's rooms end: server room | meeting room | nap pods */
const SERVER_Z = -4.5, MEET_Z = -0.5;

function box(parent: THREE.Object3D, w: number, h: number, d: number, mat: THREE.Material, x: number, y: number, z: number, shadow = true) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y + h / 2, z);
  m.castShadow = shadow;
  m.receiveShadow = true;
  parent.add(m);
  return m;
}

const facing = (from: P, to: P) => Math.atan2(to.x - from.x, to.z - from.z);

/** Name plate on a wall running along z, readable from the east. */
function plate(scene: THREE.Scene, text: string, x: number, y: number, z: number, bg = '#f2e6c8', fg = '#2a2228') {
  const m = document.createElement('canvas').getContext('2d')!;
  m.font = '8px "Silkscreen"';
  const w = Math.ceil(m.measureText(text).width) + 8;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w / 40, 0.25), new THREE.MeshBasicMaterial({ map: labelTexture(text, { w, h: 10, bg, fg, size: 8 }) }));
  mesh.position.set(x, y, z);
  mesh.rotation.y = Math.PI / 2;
  scene.add(mesh);
}

type WallFn = (axis: 'x' | 'z', at: number, a: number, b: number, doors?: [number, number][], mat?: THREE.Material) => void;

/** Glass partitions like the boss office: panes, mullions, a top rail, doorways with a header. */
function glassWalls(c: Ctx): { wall: WallFn; openDoors: () => void } {
  const { scene, nav } = c;
  const mull = toon('#2a2a30');
  const posts = new Set<string>();
  const doorways: [number, number, number, number][] = [];
  const wall: WallFn = (axis, at, a, b, doors = [], mat = c.glassMat) => {
    const xz = (s: number): [number, number] => (axis === 'x' ? [at, s] : [s, at]);
    const post = (s: number) => {
      const [x, z] = xz(s);
      const k = `${x.toFixed(2)},${z.toFixed(2)}`;
      if (posts.has(k)) return;
      posts.add(k);
      box(scene, 0.07, GH + 0.05, 0.07, mull, x, 0, z);
    };
    const pane = (s0: number, s1: number, y0: number, y1: number) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(s1 - s0, y1 - y0), mat);
      const [x, z] = xz((s0 + s1) / 2);
      m.position.set(x, (y0 + y1) / 2, z);
      if (axis === 'x') m.rotation.y = Math.PI / 2;
      scene.add(fx(m));
    };
    const bar = (s0: number, s1: number, y: number) => {
      const [x, z] = xz((s0 + s1) / 2);
      if (axis === 'x') box(scene, 0.08, 0.07, s1 - s0, mull, x, y, z);
      else box(scene, s1 - s0, 0.07, 0.08, mull, x, y, z);
    };
    const cuts = [a, ...doors.flat(), b];
    for (let i = 0; i < cuts.length; i += 2) {
      const s0 = cuts[i], s1 = cuts[i + 1];
      post(s0);
      post(s1);
      if (s1 - s0 < 0.05) continue;
      pane(s0, s1, 0, GH);
      const n = Math.max(1, Math.round((s1 - s0) / 1.7));
      for (let k = 1; k < n; k++) post(s0 + ((s1 - s0) * k) / n);
      if (axis === 'x') nav.rect(at - 0.05, s0, at + 0.05, s1, 0.2);
      else nav.rect(s0, at - 0.05, s1, at + 0.05, 0.2);
    }
    for (const [d0, d1] of doors) {
      pane(d0, d1, DOOR_H, GH);
      bar(d0, d1, DOOR_H);
      // only cells that lie wholly inside the opening
      doorways.push(axis === 'x' ? [at - 0.3, d0 + 0.25, at + 0.3, d1 - 0.25] : [d0 + 0.25, at - 0.3, d1 - 0.25, at + 0.3]);
    }
    bar(a, b, GH);
  };
  return { wall, openDoors: () => doorways.forEach((d) => nav.free(...d)) };
}

function serverRoom(c: Ctx, wall: WallFn, ticks: Tick[]) {
  const { scene, nav, theme } = c;
  const x0 = WING.x, x1 = ROOM.maxX, z0 = ROOM.minZ, z1 = SERVER_Z;
  wall('x', x0, z0, z1, [[-6.5, -5.3]]);
  wall('z', z1, x0, x1);
  plate(scene, S.signServer, x0 + 0.06, 2.45, -5.9, '#1d2a2e', '#7dffb0');

  // raised floor of square tiles, a few of them perforated
  const TX = 10, TZ = 7, px = 12;
  const tiles = canvasTexture(TX * px, TZ * px, (g) => {
    for (let j = 0; j < TZ; j++)
      for (let i = 0; i < TX; i++) {
        g.fillStyle = pick(['#5e636f', '#5a5f6b', '#626773']);
        g.fillRect(i * px, j * px, px, px);
        g.fillStyle = '#3c4049';
        g.fillRect(i * px, j * px, px, 1);
        g.fillRect(i * px, j * px, 1, px);
        if (j > 1 && rand() < 0.2) for (let v = 3; v < px - 1; v += 2) g.fillRect(i * px + 3, j * px + v, px - 5, 1);
      }
    g.fillStyle = '#e8c25a';
    for (let v = 0; v < 14; v += 2) g.fillRect(0, 31 + v, 3, 1);
  });
  box(scene, x1 - x0 - 0.06, 0.05, z1 - z0 - 0.06, toon('#ffffff', { map: tiles }), (x0 + x1) / 2 + 0.03, 0, (z0 + z1) / 2 - 0.03, false);

  // racks along the back wall
  const N = 6, U = 8, LPU = 4;
  const rackX = (i: number) => 14.55 + i * 0.85;
  const rz = z0 + 0.5;
  const bodyMat = toon('#1d1c22');
  const front = canvasTexture(26, 74, (g, w, h) => {
    g.fillStyle = '#24242c';
    g.fillRect(0, 0, w, h);
    for (let u = 0; u < U; u++) {
      const y = h - 5 - (u + 1) * 8.6;
      g.fillStyle = '#34343e';
      g.fillRect(2, Math.round(y), w - 4, 7);
      g.fillStyle = '#1a1a20';
      for (let v = 14; v < w - 3; v += 2) g.fillRect(v, Math.round(y) + 2, 1, 3);
    }
  });
  const frontMat = toon('#ffffff', { map: front });
  const leds = new THREE.InstancedMesh(new THREE.BoxGeometry(0.04, 0.04, 0.02), new THREE.MeshBasicMaterial({ color: '#ffffff' }), N * U * LPU);
  const M = new THREE.Matrix4();
  const fans: THREE.Object3D[] = [];
  const steel = toon('#8a8f9a');
  for (let i = 0; i < N; i++) {
    const x = rackX(i);
    box(scene, 0.72, 2.0, 0.8, bodyMat, x, 0, rz);
    const f = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 1.84), frontMat);
    f.position.set(x, 1.02, rz + 0.405);
    scene.add(f);
    for (let u = 0; u < U; u++)
      for (let l = 0; l < LPU; l++) leds.setMatrixAt((i * U + u) * LPU + l, M.makeTranslation(x - 0.24 + l * 0.065, 0.29 + u * 0.2125, rz + 0.41));
    // exhaust fan on top
    box(scene, 0.46, 0.04, 0.46, toon('#2a2a32'), x, 2.0, rz + 0.05, false);
    const fan = new THREE.Group();
    fan.position.set(x, 2.06, rz + 0.05);
    box(fan, 0.4, 0.02, 0.09, steel, 0, 0, 0, false);
    box(fan, 0.09, 0.02, 0.4, steel, 0, 0, 0, false);
    scene.add(fan);
    fans.push(fan);
    // cable drop from the tray
    box(scene, 0.05, 0.3, 0.05, toon(pick(['#f2c94c', '#3d7ad9', '#e8556b'])), x - 0.22, 2.0, rz - 0.3, false);
  }
  leds.instanceMatrix.needsUpdate = true;
  scene.add(leds);
  nav.rect(rackX(0) - 0.36, z0, rackX(N - 1) + 0.36, rz + 0.4, 0.1);

  // cable tray on the wall above the racks
  const trayY = 2.3, trayX = (rackX(0) + rackX(N - 1)) / 2, trayL = rackX(N - 1) - rackX(0) + 1.3;
  for (const dz of [0.06, 0.34]) box(scene, trayL, 0.05, 0.04, steel, trayX, trayY, z0 + dz, false);
  for (let x = trayX - trayL / 2 + 0.15; x < trayX + trayL / 2; x += 0.42) box(scene, 0.04, 0.03, 0.3, steel, x, trayY, z0 + 0.2, false);
  [['#f2c94c', 0.12], ['#3d7ad9', 0.2], ['#e8556b', 0.28]].forEach(([col, dz]) => box(scene, trayL - 0.2, 0.04, 0.05, toon(col as string), trayX, trayY + 0.04, z0 + (dz as number), false));

  // cooling unit with a big fan, and a crash cart
  const acX = x1 - 0.5;
  box(scene, 0.8, 1.9, 0.8, toon('#d9d4cc'), acX, 0, rz);
  box(scene, 0.66, 0.5, 0.02, toon('#8a8f9a'), acX, 0.2, rz + 0.41, false);
  const ring = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.03, 12), toon('#2a2a32'));
  ring.rotation.x = Math.PI / 2;
  ring.position.set(acX, 1.3, rz + 0.41);
  scene.add(ring);
  const acFan = new THREE.Group();
  acFan.position.set(acX, 1.3, rz + 0.435);
  box(acFan, 0.52, 0.1, 0.02, steel, 0, -0.05, 0, false);
  box(acFan, 0.1, 0.52, 0.02, steel, 0, -0.26, 0, false);
  scene.add(acFan);
  nav.rect(acX - 0.4, z0, acX + 0.4, rz + 0.4, 0.1);
  const cart = new THREE.Group();
  cart.position.set(x1 - 0.75, 0.05, z1 - 0.7);
  cart.rotation.y = -0.5;
  box(cart, 0.7, 0.05, 0.5, toon('#3a3a42'), 0, 0.8, 0);
  box(cart, 0.7, 0.05, 0.5, toon('#3a3a42'), 0, 0.3, 0);
  for (const [dx, dz] of [[-0.32, -0.22], [0.32, -0.22], [-0.32, 0.22], [0.32, 0.22]]) box(cart, 0.04, 0.85, 0.04, toon('#2a2a30'), dx, 0, dz, false);
  box(cart, 0.44, 0.32, 0.06, toon('#1d1c22'), 0, 0.87, -0.12);
  const term = new THREE.Mesh(new THREE.PlaneGeometry(0.38, 0.26), glow('#39ff88', 0.9));
  term.position.set(0, 1.03, -0.085);
  cart.add(term);
  scene.add(cart);
  nav.rect(x1 - 1.15, z1 - 1.0, x1 - 0.35, z1 - 0.4, 0.05);

  // load gauge on the wall
  const SEG = 12, gx = trayX - 0.38, gy = 2.62;
  box(scene, 2.5, 0.36, 0.04, toon('#141418'), trayX, gy - 0.05, z0 + 0.02, false);
  const lbl = new THREE.Mesh(new THREE.PlaneGeometry(0.72, 0.3), new THREE.MeshBasicMaterial({ map: labelTexture(S.signLoad, { w: 24, h: 10, bg: '#141418', fg: '#cfd6dc', size: 8 }) }));
  lbl.position.set(trayX - 0.85, gy + 0.13, z0 + 0.045);
  scene.add(lbl);
  const gauge = new THREE.InstancedMesh(new THREE.BoxGeometry(0.1, 0.2, 0.02), new THREE.MeshBasicMaterial({ color: '#ffffff' }), SEG);
  for (let i = 0; i < SEG; i++) gauge.setMatrixAt(i, M.makeTranslation(gx + 0.13 * i, gy + 0.13, z0 + 0.05));
  scene.add(gauge);

  // one light for the whole room: cool at rest, red under load
  const light = new THREE.PointLight('#7ad8ff', 2, 9, 1.5);
  light.position.set((x0 + x1) / 2, 2.2, rz + 1.6);
  scene.add(light);
  const cool = new THREE.Color('#7ad8ff'), hot = new THREE.Color('#ff2410');
  const hazeMat = additive('#ff2a10', 0);
  const haze = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0 - 0.2, 2.5, z1 - z0 - 0.2), hazeMat);
  haze.position.set((x0 + x1) / 2, 1.3, (z0 + z1) / 2);
  haze.visible = false;
  scene.add(fx(haze));

  const smokeGeo = new THREE.BoxGeometry(0.2, 0.2, 0.2), smokeMat = toon('#c4c0c8');
  const smoke: { m: THREE.Mesh; life: number; vx: number; vy: number }[] = [];
  const state = new Uint8Array(leds.count);
  const COLS = [new THREE.Color(0.04, 0.06, 0.05), new THREE.Color('#7dffb0').multiplyScalar(2.4), new THREE.Color('#ffd36b').multiplyScalar(2.4), new THREE.Color('#ff4a3a').multiplyScalar(2.8)];
  const DARK = new THREE.Color('#22262a');
  let target = 0.2, load = 0.2, acc = 0, shown = -1, puff = 0;
  const flip = (i: number, k: number) => {
    const r = Math.random();
    const red = 0.03 + 0.8 * k * k * k, amber = 0.08 + 0.25 * k;
    state[i] = r < 0.22 ? 0 : r < 0.22 + red ? 3 : r < 0.22 + red + amber ? 2 : 1;
    leds.setColorAt(i, COLS[state[i]]);
  };
  for (let i = 0; i < leds.count; i++) flip(i, load);
  ticks.push((dt, t) => {
    load += (target - load) * (1 - Math.exp(-dt * 2.5));
    const k = load;
    for (const f of fans) f.rotation.y += dt * (2 + 34 * k);
    acFan.rotation.z += dt * (3 + 30 * k);
    acc = Math.min(120, acc + dt * leds.count * (0.25 + 12 * k * k));
    if (acc >= 1) {
      for (; acc >= 1; acc--) flip(Math.floor(Math.random() * leds.count), k);
      leds.instanceColor!.needsUpdate = true;
    }
    const lit = Math.round(k * SEG);
    if (lit !== shown) {
      shown = lit;
      for (let i = 0; i < SEG; i++) gauge.setColorAt(i, i >= lit ? DARK : COLS[i < 6 ? 1 : i < 9 ? 2 : 3]);
      gauge.instanceColor!.needsUpdate = true;
    }
    const alarm = THREE.MathUtils.smoothstep(k, 0.65, 1);
    const pulse = 1 + 0.4 * alarm * Math.sin(t * 9);
    light.color.lerpColors(cool, hot, THREE.MathUtils.smoothstep(k, 0.3, 0.85));
    light.intensity = (1.5 + 10 * k * k) * pulse;
    const heat = Math.max(0, k - 0.45) / 0.55;
    haze.visible = heat > 0.01;
    hazeMat.opacity = 0.1 * heat * heat * pulse;
    if (k > 0.85 && smoke.length < 36) {
      puff += (dt * (k - 0.85) * 10) / 0.15;
      for (; puff >= 1; puff--) {
        const m = new THREE.Mesh(smokeGeo, smokeMat);
        m.position.set(rackX(Math.floor(Math.random() * N)) + (Math.random() - 0.5) * 0.3, 2.1, rz + (Math.random() - 0.3) * 0.5);
        scene.add(m);
        smoke.push({ m, life: 0, vx: (Math.random() - 0.5) * 0.25, vy: 0.55 + Math.random() * 0.35 });
      }
    }
    for (let i = smoke.length - 1; i >= 0; i--) {
      const p = smoke[i];
      p.life += dt;
      p.m.position.x += p.vx * dt;
      p.m.position.y += p.vy * dt;
      p.m.rotation.x += dt;
      p.m.rotation.y += dt;
      p.m.scale.setScalar((1 + p.life * 0.9) * Math.min(1, (2.8 - p.life) * 3));
      if (p.life > 2.8) {
        scene.remove(p.m);
        smoke.splice(i, 1);
      }
    }
  });

  c.spots.server = [{ x: 15.4, z: rz + 1.3, rot: Math.PI }, { x: 17.6, z: rz + 1.3, rot: Math.PI }];
  return {
    setLoad: (k: number) => void (target = THREE.MathUtils.clamp(k, 0, 1)),
    center: { x: (x0 + x1) / 2, z: (z0 + z1) / 2 },
    // the front edge of the first rack, beside its exhaust fan: where the cat lies when the racks run warm
    perch: { x: rackX(0), y: 2.0, z: rz + 0.3 },
  };
}

function chair(scene: THREE.Scene, x: number, z: number, rot: number, color: string) {
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  g.rotation.y = rot;
  g.scale.setScalar(PERSON);
  const metal = toon('#2a2a30');
  for (const [dx, dz] of [[-0.18, -0.17], [0.18, -0.17], [-0.18, 0.17], [0.18, 0.17]]) box(g, 0.04, 0.28, 0.04, metal, dx, 0, dz, false);
  box(g, 0.44, 0.06, 0.42, toon(color), 0, 0.28, 0);
  box(g, 0.42, 0.4, 0.06, toon(color), 0, 0.36, -0.2);
  scene.add(g);
}

function meetingRoom(c: Ctx, wall: WallFn) {
  const { scene, nav, theme, spots } = c;
  const x0 = WING.x, x1 = ROOM.maxX;
  const light = theme.id === 'campus';
  wall('x', x0, SERVER_Z, MEET_Z, [[-4.35, -3.2]]);
  wall('z', MEET_Z, x0, x1);
  plate(scene, S.signMeeting, x0 + 0.06, 2.45, -3.78);

  const cx = 16.2, cz = -2.2;
  rugMesh(scene, cx + 0.2, cz, 4.6, 3.0, light ? '#cfdde8' : '#3a3044', light ? '#b4c7d6' : '#2c2434');
  const wood = toon(light ? '#f4f1ea' : '#5a3d26');
  box(scene, 2.7, 0.07, 1.0, wood, cx, 0.7, cz);
  for (const dx of [-0.9, 0.9]) box(scene, 0.1, 0.7, 0.7, toon(light ? '#d8cfbd' : '#2a2228'), cx + dx, 0, cz);
  nav.rect(cx - 1.35, cz - 0.5, cx + 1.35, cz + 0.5, 0.05);
  // on the table: conference phone, laptop, mugs
  box(scene, 0.26, 0.05, 0.26, toon('#2a2a30'), cx - 0.1, 0.77, cz, false);
  box(scene, 0.06, 0.02, 0.06, glow('#7dffb0', 1.6), cx - 0.1, 0.82, cz, false);
  box(scene, 0.34, 0.02, 0.24, toon('#b8b8c0'), cx + 0.75, 0.77, cz + 0.2, false);
  const lid = box(scene, 0.34, 0.22, 0.02, toon('#b8b8c0'), cx + 0.75, 0.78, cz + 0.33, false);
  lid.rotation.x = 0.25;
  for (const [dx, dz, col] of [[-0.8, -0.3, '#e8556b'], [0.35, -0.32, '#f2c94c'], [-0.5, 0.3, '#5ec4ff']] as [number, number, string][]) box(scene, 0.08, 0.1, 0.08, toon(col), cx + dx, 0.77, cz + dz, false);

  // index 0 sits at the head, looking at the screen
  const seats: Spot[] = [{ x: cx + 1.8, z: cz, rot: -Math.PI / 2 }];
  for (const dx of [-0.85, 0, 0.85]) seats.push({ x: cx + dx, z: cz - 0.93, rot: 0 });
  for (const dx of [-0.85, 0, 0.85]) seats.push({ x: cx + dx, z: cz + 0.93, rot: Math.PI });
  for (const s of seats) chair(scene, s.x, s.z, s.rot, theme.desk.chair);
  spots.meeting = seats;

  // wall screen on the partition
  const W = 1.7, Hh = 1.1, sy = 1.62;
  box(scene, 0.07, Hh + 0.12, W + 0.12, toon('#141418'), x0 + 0.07, sy - Hh / 2 - 0.06, cz);
  const cv = document.createElement('canvas');
  cv.width = 68;
  cv.height = 44;
  const tex = new THREE.CanvasTexture(cv);
  tex.magFilter = tex.minFilter = THREE.NearestFilter;
  tex.colorSpace = THREE.SRGBColorSpace;
  const g = cv.getContext('2d')!;
  g.fillStyle = '#101820';
  g.fillRect(0, 0, 68, 44);
  g.fillStyle = '#7dffb0';
  g.font = '8px "Silkscreen"';
  g.fillText(S.screenTitle, 3, 9);
  g.fillStyle = '#2c3a44';
  g.fillRect(3, 12, 62, 1);
  [9, 14, 11, 19, 16, 23].forEach((v, i) => {
    g.fillStyle = i === 5 ? '#ff6b6b' : '#3ad8c0';
    g.fillRect(4 + i * 5, 40 - v, 4, v);
  });
  g.fillStyle = '#8fa0ac';
  for (let i = 0; i < 5; i++) g.fillRect(39, 17 + i * 5, 14 + ((i * 7) % 12), 2);
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(W, Hh), glowMap(tex, 1.25));
  mesh.position.set(x0 + 0.115, sy, cz);
  mesh.rotation.y = Math.PI / 2;
  scene.add(mesh);
  const screen: PaintedScreen = { mesh, g, tex, center: new THREE.Vector3(x0 + 0.12, sy, cz), width: W, height: Hh };

  // lamp over the table
  for (const dx of [-0.8, 0.8]) box(scene, 0.02, ROOM.h - 2.2, 0.02, toon('#2a2a30'), cx + dx, 2.2, cz, false);
  const lamp = box(scene, 2.0, 0.06, 0.14, glow('#fff2d8', 1), cx, 2.14, cz, false);
  c.lampMats.push(lamp.material as THREE.MeshBasicMaterial);
  const L = theme.lights;
  c.pointLamp(cx, 2.0, cz, theme.props.pendants === 'globe' ? '#ffd9a0' : L.lamp, L.lampIntensity > 0 ? Math.min(L.lampIntensity, 6) * 0.8 : 5, 7);

  // sideboard at the far end
  box(scene, 0.5, 0.8, 1.7, toon(light ? '#f4f1ea' : '#3a3036'), x1 - 0.4, 0, cz);
  nav.rect(x1 - 0.65, cz - 0.85, x1 - 0.15, cz + 0.85, 0.05);
  pottedPlant(scene, x1 - 0.4, cz - 0.5, 0.55).position.y = 0.8;
  const carafe = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.26, 0.14), glass('#7fc8ff', 0.6));
  carafe.position.set(x1 - 0.4, 0.93, cz + 0.45);
  scene.add(fx(carafe));

  return { center: { x: cx, z: cz }, screen };
}

function napPods(c: Ctx, wall: WallFn) {
  const { scene, nav, theme, spots } = c;
  const x0 = WING.x, x1 = ROOM.maxX, z1 = WING.maxZ;
  const tint = glass(theme.id === 'boiler' ? '#ff6680' : '#8fa6d8', theme.id === 'boiler' ? 0.14 : 0.26);
  wall('x', x0, MEET_Z, z1, [[1.95, 3.05]], tint);
  wall('z', z1, x0, x1, [], tint);
  plate(scene, S.signNap, x0 + 0.06, 2.45, 2.5, '#2a3350', '#dfe6ff');
  rugMesh(scene, (x0 + x1) / 2 + 0.05, (MEET_Z + z1) / 2, x1 - x0 - 0.3, z1 - MEET_Z - 0.3, '#2c3558', '#232b48');

  const shell = toon(theme.id === 'campus' || theme.id === 'soma' ? '#ece7dc' : '#3a3644');
  const blankets = ['#e8556b', '#2f6f73', '#f2b84b', '#9b7fe0'];
  const zh = MEET_Z + 0.12, len = 2.16;
  spots.nap = [];
  [14.35, 15.7, 17.05, 18.4].forEach((x, i) => {
    const g = new THREE.Group();
    g.position.set(x, 0, zh);
    scene.add(g);
    box(g, 1.05, 0.3, len, shell, 0, 0, len / 2);
    box(g, 0.84, 0.12, 1.92, toon('#5b6ea8'), 0, 0.3, len / 2 + 0.04);
    box(g, 0.5, 0.08, 0.3, toon('#f6f2ea'), 0, 0.42, 0.32, false);
    box(g, 0.84, 0.05, 0.6, toon(blankets[i]), 0, 0.42, len - 0.42, false);
    // hood: solid at the back and on the far side, glass towards the camera
    box(g, 1.05, 1.05, 0.08, shell, 0, 0, 0.04);
    box(g, 0.06, 0.75, 0.95, shell, -0.5, 0.3, 0.52);
    for (const dx of [-0.5, 0.5]) box(g, 0.06, 0.16, len - 1.0, shell, dx, 0.3, 1.0 + (len - 1.0) / 2, false);
    const roof = new THREE.Mesh(new THREE.BoxGeometry(1.05, 0.04, 0.95), tint);
    roof.position.set(0, 1.05, 0.52);
    g.add(fx(roof));
    const side = new THREE.Mesh(new THREE.PlaneGeometry(0.95, 0.75), tint);
    side.position.set(0.52, 0.675, 0.52);
    side.rotation.y = Math.PI / 2;
    g.add(fx(side));
    box(g, 0.7, 0.03, 0.03, glow('#ffb066', 1.3), 0, 0.9, 0.1, false);
    box(g, 0.06, 0.06, 0.03, glow('#7dffb0', 1.8), 0.4, 0.14, len + 0.01, false);
    nav.rect(x - 0.52, zh, x + 0.52, zh + len, 0.08);
    // a lane up the mattress, so the way into a pod leads over its foot end
    nav.free(x - 0.02, zh + 1.0, x + 0.02, zh + len + 0.3);
    spots.nap.push({ x, z: zh + 1.0, rot: 0, y: 0.42, lie: true });
  });
  // night lights along the floor
  for (const x of [14.35, 15.7, 17.05, 18.4]) box(scene, 0.3, 0.03, 0.03, glow('#6a8cff', 1.1), x + 0.67, 0.02, zh + 0.3, false);
  return { center: { x: 16.4, z: 1.3 } };
}

function library(c: Ctx) {
  const { scene, nav, theme, spots } = c;
  const z0 = ROOM.minZ;
  const wood = toon(theme.id === 'campus' ? '#d9c8a4' : '#5a3d26');
  const spines = ['#c9423b', '#2f6f73', '#f2b84b', '#3d5a6e', '#9b7fe0', '#e8e2d6', '#4f9a3c', '#d9774f', '#2a4a8a', '#e8556b'];
  const shelf = (w: number, h: number, rows: number) =>
    canvasTexture(Math.round(w * 40), Math.round(h * 40), (g, cw, ch) => {
      g.fillStyle = '#2e2119';
      g.fillRect(0, 0, cw, ch);
      const rh = ch / rows;
      for (let r = 0; r < rows; r++) {
        const base = Math.round((r + 1) * rh) - 2;
        let x = 1;
        while (x < cw - 3) {
          if (rand() < 0.1) {
            x += 3;
            continue;
          }
          const bw = 2 + Math.floor(rand() * 2), bh = Math.round(rh) - 4 - Math.floor(rand() * 3);
          g.fillStyle = pick(spines);
          g.fillRect(x, base - bh, bw, bh);
          g.fillStyle = 'rgba(0,0,0,0.25)';
          g.fillRect(x + bw - 1, base - bh, 1, bh);
          x += bw;
        }
        g.fillStyle = '#8a6a48';
        g.fillRect(0, base, cw, 2);
      }
    });
  const unit = (x: number, w: number, h: number, rows: number) => {
    box(scene, w, h, 0.4, wood, x, 0, z0 + 0.2);
    const f = new THREE.Mesh(new THREE.PlaneGeometry(w - 0.1, h - 0.1), toon('#ffffff', { map: shelf(w - 0.1, h - 0.1, rows) }));
    f.position.set(x, h / 2, z0 + 0.405);
    scene.add(f);
  };
  unit(-6.45, 0.78, 2.1, 5);
  unit(-4.5, 3.1, 0.9, 2);
  nav.rect(-6.84, z0, -2.95, z0 + 0.4, 0.12);
  // on top: a pile of books, a globe, a reading lamp
  [['#c9423b', 0.3], ['#2f6f73', 0.26], ['#f2b84b', 0.22]].forEach(([col, w], i) => box(scene, w as number, 0.05, 0.2, toon(col as string), -5.55 + i * 0.02, 0.9 + i * 0.05, z0 + 0.2, false));
  box(scene, 0.12, 0.04, 0.12, toon('#2a2a30'), -3.35, 0.9, z0 + 0.2, false);
  box(scene, 0.03, 0.1, 0.03, toon('#2a2a30'), -3.35, 0.94, z0 + 0.2, false);
  const globe = new THREE.Mesh(new THREE.SphereGeometry(0.13, 8, 6), toon('#3d7ad9'));
  globe.position.set(-3.35, 1.16, z0 + 0.2);
  scene.add(globe);
  box(globe, 0.12, 0.1, 0.12, toon('#4f9a3c'), 0.05, -0.02, 0.05, false);
  rugMesh(scene, -4.7, z0 + 1.25, 3.6, 1.3, theme.id === 'campus' ? '#e6d2c0' : '#3a2a30', theme.id === 'campus' ? '#d4b9a2' : '#2a1e24');
  spots.books = [-5.6, -4.5, -3.4].map((x) => ({ x, z: z0 + 1.0, rot: Math.PI }));
}

function barTable(c: Ctx) {
  const { scene, nav, theme, spots } = c;
  const x = 11.2, z = -5.0;
  const top = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, 0.05, 10), toon(theme.id === 'campus' ? '#d8cfbd' : '#a9774f'));
  top.position.set(x, 1.05, z);
  top.castShadow = true;
  scene.add(top);
  box(scene, 0.08, 1.02, 0.08, toon('#2a2a30'), x, 0, z);
  const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.04, 10), toon('#2a2a30'));
  foot.position.set(x, 0.02, z);
  scene.add(foot);
  box(scene, 0.1, 0.12, 0.1, toon('#e8e2d6'), x + 0.05, 1.075, z - 0.1, false);
  box(scene, 0.03, 0.1, 0.03, toon('#4f9a3c'), x + 0.05, 1.19, z - 0.1, false);
  nav.rect(x - 0.22, z - 0.22, x + 0.22, z + 0.22, 0.08);
  spots.kitchenWait = [Math.PI, -Math.PI / 3, Math.PI / 3].map((a) => {
    const p = { x: x - Math.sin(a) * 0.82, z: z - Math.cos(a) * 0.82 };
    return { ...p, rot: facing(p, { x, z }) };
  });
}

/** Paper shredder under the whiteboard. */
function shredder(c: Ctx, ticks: Tick[]) {
  const { scene, nav, spots } = c;
  const x = -2.7, z = ROOM.minZ + 0.24;
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  scene.add(g);
  box(g, 0.46, 0.56, 0.42, toon('#d9d4cc'), 0, 0, 0);
  box(g, 0.5, 0.16, 0.46, toon('#5a5f6b'), 0, 0.56, 0);
  box(g, 0.36, 0.012, 0.04, toon('#0d0d10'), 0, 0.72, -0.04, false);
  const lamp = glow('#7dffb0', 1.8);
  box(g, 0.05, 0.03, 0.05, lamp, 0.18, 0.72, 0.14, false);
  // window into the bin, and what is already in there
  box(g, 0.3, 0.3, 0.012, toon('#f6f2ea'), 0, 0.1, 0.211, false);
  for (let i = 0; i < 6; i++) box(g, 0.04, 0.012, 0.012, toon('#b8b8c0'), -0.1 + (i % 3) * 0.1, 0.16 + Math.floor(i / 3) * 0.1, 0.218, false);
  nav.rect(x - 0.23, ROOM.minZ, x + 0.23, z + 0.21, 0.08);
  spots.shredder = [{ x, z: z + 0.8, rot: Math.PI }];

  const paper = glow('#ffffff', 1.05);
  const sheet = box(g, 0.3, 0.3, 0.02, paper, 0, 0.74, -0.04, false);
  sheet.visible = false;
  const strips = Array.from({ length: 22 }, () => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.3, 0.02), paper);
    m.visible = false;
    g.add(m);
    return { m, vx: 0, vy: 0, vz: 0, life: 9 };
  });
  let t = 9, next = 0;
  ticks.push((dt) => {
    if (t > 4) return;
    t += dt;
    const feeding = t < 1.3;
    sheet.visible = t < 0.9;
    sheet.position.y = 0.74 + 0.15 - Math.min(t, 0.9) * 0.33;
    g.position.x = x + (feeding ? Math.sin(t * 70) * 0.008 : 0);
    lamp.color.set(feeding ? '#ff6b3a' : '#7dffb0').multiplyScalar(1.8);
    if (feeding && t > 0.25 && next < strips.length && t > 0.25 + next * 0.045) {
      const s = strips[next++];
      s.m.visible = true;
      s.m.position.set((Math.random() - 0.5) * 0.3, 0.76, -0.04);
      s.vx = (Math.random() - 0.5) * 1.4;
      s.vz = 0.3 + Math.random() * 1.3;
      s.vy = 2.6 + Math.random() * 1.2;
      s.life = 0;
    }
    for (const s of strips) {
      if (!s.m.visible) continue;
      s.life += dt;
      if (s.m.position.y > 0.02) {
        s.vy -= 6 * dt;
        s.m.position.x += s.vx * dt;
        s.m.position.y = Math.max(0.02, s.m.position.y + s.vy * dt);
        s.m.position.z += s.vz * dt;
        s.m.rotation.x += dt * 7;
        s.m.rotation.z += dt * 5;
      } else s.m.rotation.set(Math.PI / 2, 0, s.vx * 3);
      if (s.life > 3.4) s.m.visible = false;
    }
  });
  return {
    run() {
      t = 0;
      next = 0;
    },
  };
}

function gong(c: Ctx, ticks: Tick[]) {
  const { scene, nav, spots } = c;
  const x = 8.2, z = -4.2;
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  scene.add(g);
  const woodM = toon('#5a2a22');
  for (const dx of [-0.66, 0.66]) {
    box(g, 0.09, 1.62, 0.09, woodM, dx, 0, 0);
    box(g, 0.12, 0.06, 0.5, woodM, dx, 0, 0);
  }
  box(g, 1.56, 0.09, 0.11, woodM, 0, 1.56, 0);
  const swing = new THREE.Group();
  swing.position.y = 1.56;
  g.add(swing);
  const brass = toon('#d9a441', { emissive: '#ffd36b', emissiveIntensity: 0 });
  const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.05, 14), brass);
  disc.rotation.x = Math.PI / 2;
  disc.position.y = -0.72;
  disc.castShadow = true;
  swing.add(disc);
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.08, 10), toon('#a9774f'));
  hub.rotation.x = Math.PI / 2;
  hub.position.y = -0.72;
  swing.add(hub);
  for (const dx of [-0.25, 0.25]) box(swing, 0.02, 0.3, 0.02, toon('#2a2a30'), dx, -0.3, 0, false);
  // mallet leaning on the stand
  const mallet = new THREE.Group();
  mallet.position.set(0.8, 0, 0.12);
  mallet.rotation.z = -0.18;
  box(mallet, 0.04, 0.7, 0.04, toon('#c9a26b'), 0, 0, 0, false);
  box(mallet, 0.14, 0.14, 0.14, toon('#c9423b'), 0, 0.66, 0, false);
  g.add(mallet);
  nav.rect(x - 0.72, z - 0.2, x + 0.72, z + 0.2, 0.08);
  // whoever strikes it stands to the left of the disc as the camera sees it, so both can be seen
  const p = { x: x - 0.62, z: z + 0.72 };
  spots.gong = [{ ...p, rot: facing(p, { x: x - 0.1, z }) }];

  let a = 0, v = 0, flash = 0;
  ticks.push((dt) => {
    if (!a && !v && !flash) return;
    v += (-38 * a - 1.6 * v) * dt;
    a += v * dt;
    flash = Math.max(0, flash - dt * 1.2);
    if (Math.abs(a) < 0.002 && Math.abs(v) < 0.01 && !flash) a = v = 0;
    swing.rotation.x = a;
    disc.rotation.z = Math.sin(flash * 40) * flash * 0.05;
    brass.emissiveIntensity = flash * 0.9;
  });
  return {
    object: g,
    hit() {
      v += 3.0;
      flash = 1;
    },
  };
}

/** Rotating warning light on the corner post of the boss office. */
function beacon(c: Ctx, ticks: Tick[]) {
  const { scene } = c;
  const g = new THREE.Group();
  g.position.set(c.boss.x, GH + 0.05, c.boss.z);
  scene.add(g);
  box(g, 0.07, 0.25, 0.07, toon('#2a2a30'), 0, 0, 0, false);
  box(g, 0.3, 0.07, 0.3, toon('#2a2a30'), 0, 0.25, 0, false);
  const lens = new THREE.MeshBasicMaterial({ color: '#5a1612' });
  const dome = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.17, 0.3, 8), lens);
  dome.position.y = 0.47;
  g.add(dome);
  box(g, 0.2, 0.04, 0.2, toon('#2a2a30'), 0, 0.62, 0, false);
  const head = new THREE.Group();
  head.position.y = 0.47;
  head.visible = false;
  g.add(head);
  const beamMat = additive('#ff2a1a', 0.45);
  for (const s of [-1, 1]) {
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.08, 2.6, 6, 1, true), beamMat);
    beam.rotation.z = (s * Math.PI) / 2;
    beam.position.x = -s * 1.4;
    head.add(fx(beam));
  }
  const light = new THREE.PointLight('#ff2a1a', 0, 9, 1.4);
  scene.add(light);
  let on = false, level = 0, ang = 0;
  ticks.push((dt) => {
    level += ((on ? 1 : 0) - level) * (1 - Math.exp(-dt * 8));
    if (level < 0.01) {
      if (head.visible) {
        head.visible = false;
        light.intensity = 0;
        lens.color.set('#5a1612');
      }
      return;
    }
    head.visible = true;
    ang += dt * 4.4;
    head.rotation.y = ang;
    beamMat.opacity = 0.45 * level;
    // the light itself circles the post, so its patch sweeps over floor and walls
    light.position.set(g.position.x + Math.cos(ang) * 1.8, 2.3, g.position.z - Math.sin(ang) * 1.8);
    light.intensity = 16 * level;
    lens.color.set('#ff3a22').multiplyScalar(1 + 1.6 * level * (0.7 + 0.3 * Math.sin(ang * 2)));
  });
  return { set: (v: boolean) => void (on = v) };
}

function petCorner(c: Ctx) {
  const { scene, nav } = c;
  const ex = WING.x;
  // cat tree
  const cat = { x: ex - 0.55, z: WING.maxZ + 0.6 };
  const t = new THREE.Group();
  t.position.set(cat.x, 0, cat.z);
  scene.add(t);
  const carpet = toon('#c9b79a'), sisal = toon('#a9774f');
  box(t, 0.7, 0.06, 0.7, carpet, 0, 0, 0);
  box(t, 0.4, 0.36, 0.4, carpet, -0.12, 0.06, -0.12);
  box(t, 0.2, 0.2, 0.02, toon('#2a2228'), -0.12, 0.1, 0.085, false);
  box(t, 0.12, 0.84, 0.12, sisal, 0.2, 0.06, 0.2);
  box(t, 0.46, 0.06, 0.42, carpet, 0.12, 0.6, 0.12);
  box(t, 0.12, 1.24, 0.12, sisal, -0.18, 0.06, -0.18);
  box(t, 0.5, 0.06, 0.5, carpet, -0.1, 1.3, -0.1);
  box(t, 0.02, 0.2, 0.02, toon('#2a2a30'), 0.13, 1.08, 0.13, false);
  box(t, 0.07, 0.07, 0.07, toon('#e8556b'), 0.13, 1.02, 0.13, false);
  nav.rect(cat.x - 0.35, cat.z - 0.35, cat.x + 0.35, cat.z + 0.35, 0.05);
  // dog bed
  const dog = { x: ex - 0.75, z: WING.maxZ + 1.8 };
  box(scene, 0.95, 0.14, 0.75, toon('#7a5a8a'), dog.x, 0, dog.z);
  box(scene, 0.75, 0.05, 0.55, toon('#d8c8e0'), dog.x, 0.11, dog.z, false);
  box(scene, 0.12, 0.05, 0.3, toon('#f6f2ea'), dog.x + 0.2, 0.16, dog.z + 0.1, false);
  nav.rect(dog.x - 0.47, dog.z - 0.37, dog.x + 0.47, dog.z + 0.37, 0.03);
  // bowls on a mat
  const bowls = { x: ex - 0.5, z: WING.maxZ + 2.75 };
  box(scene, 0.34, 0.015, 0.66, toon('#3a4a5a'), bowls.x, 0, bowls.z, false);
  for (const [dz, col] of [[-0.16, '#5ec4ff'], [0.16, '#8a5a3a']] as [number, string][]) {
    const b = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.09, 0.07, 8), toon('#c0c4c8'));
    b.position.set(bowls.x, 0.05, bowls.z + dz);
    scene.add(b);
    const fill = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.085, 0.02, 8), toon(col));
    fill.position.set(bowls.x, 0.085, bowls.z + dz);
    scene.add(fill);
  }
  nav.rect(bowls.x - 0.17, bowls.z - 0.33, bowls.x + 0.17, bowls.z + 0.33, 0.03);
  return { dogBed: dog, catTree: { ...cat, x: cat.x - 0.1, z: cat.z - 0.1, top: 1.36 }, bowls };
}

function roombaDock(c: Ctx) {
  const { scene } = c;
  const x = 6.55, z0 = ROOM.minZ;
  box(scene, 0.5, 0.02, 0.36, toon('#3a3a42'), x, 0, z0 + 0.2, false);
  box(scene, 0.4, 0.24, 0.1, toon('#e8e4dc'), x, 0, z0 + 0.07);
  box(scene, 0.05, 0.03, 0.02, glow('#7dffb0', 2), x, 0.17, z0 + 0.125, false);
  for (const dx of [-0.08, 0.08]) box(scene, 0.05, 0.02, 0.04, toon('#c0c4c8'), x + dx, 0.03, z0 + 0.14, false);
  return { x, z: z0 + 0.3 };
}

function seasons(c: Ctx, ticks: Tick[]) {
  const { scene, nav } = c;
  const z0 = ROOM.minZ;
  const hall = new THREE.Group(), winter = new THREE.Group(), xmas = new THREE.Group();
  for (const g of [hall, winter, xmas]) {
    g.visible = false;
    scene.add(g);
  }

  // halloween: pumpkins wherever nobody walks
  const face = canvasTexture(9, 7, (g) => {
    g.fillStyle = '#e8822a';
    g.fillRect(0, 0, 9, 7);
    g.fillStyle = '#fff2a8';
    g.fillRect(2, 1, 2, 2);
    g.fillRect(5, 1, 2, 2);
    g.fillRect(1, 4, 7, 1);
    g.fillRect(2, 5, 1, 1);
    g.fillRect(4, 5, 1, 1);
    g.fillRect(6, 5, 1, 1);
  });
  const faceMat = glowMap(face, 1.5);
  const pumpkin = (x: number, y: number, z: number, s: number, lit = true) => {
    const g = new THREE.Group();
    g.position.set(x, y, z);
    g.scale.setScalar(s);
    box(g, 0.36, 0.26, 0.36, toon('#e8822a'), 0, 0, 0);
    box(g, 0.28, 0.04, 0.28, toon('#d06a1a'), 0, 0.26, 0, false);
    box(g, 0.05, 0.08, 0.05, toon('#3f7a34'), 0, 0.3, 0, false);
    if (lit)
      for (const side of [0, 1]) {
        const f = new THREE.Mesh(new THREE.PlaneGeometry(0.32, 0.24), faceMat);
        f.position.set(side ? 0.182 : 0, 0.13, side ? 0 : 0.182);
        f.rotation.y = side ? Math.PI / 2 : 0;
        g.add(f);
      }
    hall.add(g);
  };
  pumpkin(c.boss.x - 2.8, 0, c.boss.z + 0.36, 1.7);
  pumpkin(c.boss.x - 2.1, 0, c.boss.z + 0.34, 1.1, false);
  pumpkin(10.78, 0.92, z0 + 0.42, 0.9);
  pumpkin(-4.4, 0.9, z0 + 0.2, 1.0);
  pumpkin(WING.x - 0.36, 0, 0.1, 1.5);
  pumpkin(WING.x - 0.34, 0, -0.55, 1.0, false);
  pumpkin(16.2, 0.77, -2.2, 0.8);
  pumpkin(9.25, 0, -4.2, 1.4);
  pumpkin(12.9, 0, 7.3, 1.8);
  nav.rect(12.6, 7.0, 13.2, 7.6, 0.05);

  // winter: paper snowflakes on the windows, a snowman on the fridge
  const flakes = canvasTexture(62, 40, (g) => {
    g.fillStyle = '#ffffff';
    for (const [x, y, r] of [[8, 9, 3], [27, 6, 2], [47, 12, 3], [17, 27, 2], [38, 29, 3], [55, 31, 2], [31, 17, 1], [5, 34, 1]]) {
      g.fillRect(x - r, y, 2 * r + 1, 1);
      g.fillRect(x, y - r, 1, 2 * r + 1);
      if (r > 1) for (const [a, b] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) for (let k = 1; k < r; k++) g.fillRect(x + a * k, y + b * k, 1, 1);
    }
  });
  const flakeMat = new THREE.MeshBasicMaterial({ map: flakes, transparent: true, depthWrite: false, color: new THREE.Color(1.3, 1.35, 1.5) });
  for (const wx of c.windows) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(c.winW, c.top - c.sill), flakeMat);
    m.position.set(wx, (c.sill + c.top) / 2, z0 - 0.04);
    winter.add(fx(m));
  }
  const snow = toon('#f6f6fa');
  box(winter, 0.3, 0.24, 0.3, snow, 12.5, 2.1, z0 + 0.5);
  box(winter, 0.22, 0.18, 0.22, snow, 12.5, 2.34, z0 + 0.5);
  box(winter, 0.16, 0.14, 0.16, snow, 12.5, 2.52, z0 + 0.5);
  box(winter, 0.04, 0.04, 0.1, toon('#e8822a'), 12.5, 2.57, z0 + 0.62, false);
  box(winter, 0.24, 0.05, 0.24, toon('#c9423b'), 12.5, 2.47, z0 + 0.5, false);
  box(winter, 0.2, 0.12, 0.2, toon('#1d1c22'), 12.5, 2.66, z0 + 0.5, false);

  // christmas: a tree with presents in open floor, which it blocks while it is up
  const tx = 10.2, tz = 2.1;
  const tree = new THREE.Group();
  tree.position.set(tx, 0, tz);
  xmas.add(tree);
  box(tree, 0.5, 0.2, 0.5, toon('#c9423b'), 0, 0, 0);
  box(tree, 0.16, 0.3, 0.16, toon('#6b4a2f'), 0, 0.2, 0);
  const tiers: [number, number][] = [[1.2, 0.4], [0.95, 0.75], [0.7, 1.1], [0.45, 1.45], [0.22, 1.8]];
  tiers.forEach(([w, y], i) => (box(tree, w, 0.38, w, toon(i % 2 ? '#3f7a34' : '#2f6a33'), 0, y, 0).rotation.y = i % 2 ? Math.PI / 4 : 0));
  box(tree, 0.16, 0.16, 0.04, glow('#ffe07a', 2.2), 0, 2.18, 0, false);
  box(tree, 0.04, 0.16, 0.16, glow('#ffe07a', 2.2), 0, 2.18, 0, false);
  const bulbs: THREE.Vector3[] = [];
  tiers.slice(0, 4).forEach(([w, y], i) => {
    const n = 8 - i;
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2 + i;
      const r = (w / 2) * (i % 2 ? 1.0 : 1.05);
      bulbs.push(new THREE.Vector3(Math.cos(a) * r, y + 0.08 + (k % 2) * 0.14, Math.sin(a) * r));
    }
  });
  const fairy = new THREE.InstancedMesh(new THREE.BoxGeometry(0.07, 0.07, 0.07), new THREE.MeshBasicMaterial({ color: '#ffffff' }), bulbs.length);
  const M = new THREE.Matrix4();
  bulbs.forEach((p, i) => fairy.setMatrixAt(i, M.makeTranslation(p.x, p.y, p.z)));
  tree.add(fairy);
  for (const [dx, dz, w, h, col, rib] of [[0.75, 0.25, 0.34, 0.26, '#3d7ad9', '#f2c94c'], [-0.3, 0.8, 0.4, 0.2, '#e8556b', '#f6f2ea'], [0.45, 0.75, 0.26, 0.3, '#f2c94c', '#c9423b'], [0.85, -0.35, 0.28, 0.2, '#9b7fe0', '#f6f2ea']] as [number, number, number, number, string, string][]) {
    box(tree, w, h, w, toon(col), dx, 0, dz);
    box(tree, w + 0.01, h + 0.01, 0.06, toon(rib), dx, 0, dz, false);
    box(tree, 0.06, h + 0.01, w + 0.01, toon(rib), dx, 0, dz, false);
  }
  // wreath beside the boss's door
  const wreath = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.07, 4, 8), toon('#2f6a33'));
  wreath.position.set(c.boss.x - 1.75, 1.75, c.boss.z + 0.04);
  xmas.add(wreath);
  box(xmas, 0.16, 0.1, 0.05, toon('#c9423b'), c.boss.x - 1.75, 1.5, c.boss.z + 0.1, false);

  // string lights under the top rails of the glass rooms, coloured by season
  const runs: [number, number, number, number][] = [
    [WING.x, SERVER_Z, ROOM.maxX, SERVER_Z], [WING.x, MEET_Z, ROOM.maxX, MEET_Z], [WING.x, WING.maxZ, ROOM.maxX, WING.maxZ],
    [ROOM.minX, c.boss.z, c.boss.x, c.boss.z], [c.boss.x, z0, c.boss.x, c.boss.z],
  ];
  const pts: THREE.Vector3[] = [];
  for (const [ax, az, bx, bz] of runs) {
    const n = Math.floor(Math.hypot(bx - ax, bz - az) / 0.32);
    for (let k = 1; k < n; k++) {
      const len = [0.1, 0.2, 0.14, 0.26][k % 4];
      pts.push(new THREE.Vector3(ax + ((bx - ax) * k) / n + (az === bz ? 0 : 0.05), GH - 0.03 - len / 2, az + ((bz - az) * k) / n + (az === bz ? 0.05 : 0)));
    }
  }
  const lights = new THREE.InstancedMesh(new THREE.BoxGeometry(0.05, 1, 0.05), new THREE.MeshBasicMaterial({ color: '#ffffff' }), pts.length);
  pts.forEach((p, i) => lights.setMatrixAt(i, M.makeScale(1, [0.1, 0.2, 0.14, 0.26][i % 4], 1).setPosition(p)));
  lights.visible = false;
  scene.add(lights);
  const PAL: Record<Season, string[]> = {
    none: [],
    halloween: ['#ff8a2a', '#b05cff', '#ff8a2a', '#7dff6b'],
    winter: ['#dff2ff', '#bfe0ff', '#ffffff'],
    christmas: ['#ff4a3a', '#39d86a', '#ffd36b', '#5ec4ff'],
  };
  const col = new THREE.Color();
  let kind: Season = 'none', tw = 0, step = 0;
  const paint = () => {
    const pal = PAL[kind];
    if (!pal.length) return;
    for (let i = 0; i < pts.length; i++) lights.setColorAt(i, col.set(pal[i % pal.length]).multiplyScalar((i * 7 + step) % 5 === 0 ? 0.7 : 2.0));
    lights.instanceColor!.needsUpdate = true;
    const xp = PAL.christmas;
    for (let i = 0; i < bulbs.length; i++) fairy.setColorAt(i, col.set(xp[i % xp.length]).multiplyScalar((i + step) % 3 === 0 ? 0.5 : 2.4));
    fairy.instanceColor!.needsUpdate = true;
  };
  ticks.push((dt) => {
    if (kind === 'none') return;
    if ((tw += dt) < 0.45) return;
    tw = 0;
    step++;
    paint();
  });
  return {
    set(k: Season) {
      if (k === kind) return;
      kind = k;
      hall.visible = k === 'halloween';
      winter.visible = k === 'winter' || k === 'christmas';
      xmas.visible = k === 'christmas';
      lights.visible = k !== 'none';
      nav.rect(tx - 0.6, tz - 0.6, tx + 1.0, tz + 0.95, 0, k === 'christmas' ? 1 : 0);
      paint();
    },
  };
}

/** Everything in the east wing plus the props scattered over the main floor. */
export function buildExtras(c: Ctx): Extras {
  const ticks: Tick[] = [];
  const { wall, openDoors } = glassWalls(c);
  const server = serverRoom(c, wall, ticks);
  const meeting = meetingRoom(c, wall);
  const nap = napPods(c, wall);
  openDoors();
  library(c);
  barTable(c);
  const shred = shredder(c, ticks);
  const gng = gong(c, ticks);
  const alarm = beacon(c, ticks);
  const pets = petCorner(c);
  const dock = roombaDock(c);
  const season = seasons(c, ticks);
  let t = 0;
  return {
    rooms: { server, meeting, nap },
    shredder: shred,
    gong: gng,
    alarm,
    pets,
    roombaDock: dock,
    season,
    fx: {
      update(dt: number) {
        t += dt;
        for (const tick of ticks) tick(dt, t);
      },
    },
  };
}

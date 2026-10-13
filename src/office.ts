import * as THREE from 'three';
import { toon, glow, glowMap, glass, additive } from './materials';
import { FX_LAYER } from './pixel';
import { brick, planks, speckle, carpetTiles, plaster, livingWall, windowView, screenTexture, labelTexture, canvasTexture, rand, reseed, pick } from './textures';
import { createCharacter, type Character, type Look } from './character';
import { TEAMS } from './data';
import { NavGrid } from './nav';
import { Floor, floorSeats, type Sign } from './floor';
import type { Theme } from './themes';
import { S } from './i18n/world';
import { buildExtras, type Extras } from './rooms';

/** Bounding box of the L-shaped building. */
export const ROOM = { minX: -13, maxX: 20, minZ: -9, maxZ: 9, h: 3.4 };
/** East of x lies the wing (server room, meeting room, nap pods); it only reaches south to maxZ, beyond that is outside. */
export const WING = { x: 13.5, maxZ: 3.2 };
const inside = (x: number, z: number) => x < WING.x || z < WING.maxZ;
/** People and their desks are drawn larger than the room so faces stay readable from the iso camera. */
export const PERSON = 1.25;

export interface Seat {
  index: number;
  /** -1 while no team owns the column */
  team: number;
  band: number;
  col: number;
  x: number;
  z: number;
  rot: number;
}

export interface Spot {
  x: number;
  z: number;
  rot: number;
  taken?: string;
  /** height of the character root while sitting or lying here */
  y?: number;
  /** lying down: `rot` is the way the feet point, the head lies the other way */
  lie?: boolean;
}

export interface Door {
  pivot: THREE.Group;
  x: number;
  z: number;
  /** where a person stands to go through */
  front: { x: number; z: number; rot: number };
  open: number;
  target: number;
  busyLamp?: THREE.MeshBasicMaterial;
}

export interface Office extends Extras {
  scene: THREE.Scene;
  sun: THREE.DirectionalLight;
  hemi: THREE.HemisphereLight;
  viewTex?: THREE.CanvasTexture;
  nav: NavGrid;
  seats: Seat[];
  spots: Record<string, Spot[]>;
  doors: { exit: Door; wc: Door };
  lamps: { mats: THREE.MeshBasicMaterial[]; lights: THREE.PointLight[]; dim: THREE.MeshBasicMaterial[] };
  clock: { hour: THREE.Object3D; minute: THREE.Object3D };
  coffeeDisplay: (cost: number) => void;
  /** cork board on the west wall, painted from GitHub Projects */
  pinboard: { mesh: THREE.Mesh; g: CanvasRenderingContext2D; tex: THREE.CanvasTexture; center: THREE.Vector3; width: number; height: number };
  whiteboard: (runs: number, hist: number[]) => void;
  tipJar: { x: number; y: number; z: number; drop: () => void; update: (dt: number) => void };
  pingpongBall: THREE.Mesh;
  coffeeSteam: THREE.Mesh[];
  boss: { ch: Character; head: THREE.Object3D; seat: { x: number; z: number; rot: number } };
  roomba: THREE.Group;
  /** team boards whose texels map 1:1 to art pixels; main rescales them on resize */
  signs: Sign[];
  floor: Floor;
  /** boss-office wall screen for the quota overlay: top-left corner, right edge vector, down edge vector */
  wallScreen: { tl: THREE.Vector3; right: THREE.Vector3; down: THREE.Vector3; glow: THREE.MeshBasicMaterial; mesh: THREE.Mesh };
  occluders: THREE.Box3[];
  party: { lights: THREE.PointLight[]; ball: THREE.Group; vinyl: THREE.Object3D[]; cones: THREE.Object3D[]; fogger: { pos: THREE.Vector3; dir: THREE.Vector3 } };
}

function box(parent: THREE.Object3D, w: number, h: number, d: number, mat: THREE.Material, x: number, y: number, z: number, shadow = true) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y + h / 2, z);
  m.castShadow = shadow;
  m.receiveShadow = true;
  parent.add(m);
  return m;
}

/**
 * The view behind the back wall may only show through the window openings: trace each fragment back along the
 * (orthographic) view direction to both faces of the wall and drop it unless it passes through a window there.
 */
function windowOnly(mat: THREE.MeshBasicMaterial, xs: number[], winW: number, sill: number, top: number, wallZ: number, wallT: number) {
  const dir = { value: new THREE.Vector3(0, 0, -1) };
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uDir = dir;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWorldPos;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    const checks = xs.map((x) => `abs(q.x - (${x.toFixed(3)})) < ${(winW / 2).toFixed(3)}`).join(' || ');
    sh.fragmentShader = sh.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
varying vec3 vWorldPos;
uniform vec3 uDir;
bool through(float z) {
  vec3 q = vWorldPos - uDir * ((vWorldPos.z - z) / uDir.z);
  return q.y > ${sill.toFixed(3)} && q.y < ${top.toFixed(3)} && (${checks});
}`,
      )
      .replace('void main() {', `void main() {\n  if (!through(${wallZ.toFixed(3)}) || !through(${(wallZ - wallT).toFixed(3)})) discard;`);
  };
  const tmp = new THREE.Vector3();
  mat.userData.setView = (camera: THREE.Camera) => dir.value.copy(camera.getWorldDirection(tmp));
  return mat;
}

export function fx<T extends THREE.Object3D>(o: T) {
  o.traverse((c) => c.layers.set(FX_LAYER));
  return o;
}

const shadowOnly = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false });

/** Invisible geometry that still casts shadows, so sunlight only enters through windows and skylights. */
function caster(scene: THREE.Scene, w: number, h: number, d: number, x: number, y: number, z: number) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), shadowOnly);
  m.position.set(x, y + h / 2, z);
  m.castShadow = true;
  scene.add(fx(m));
}

export const SKIN = ['#f6d3b3', '#eab894', '#d39a6e', '#b9794f', '#8d5a3b', '#6a4029', '#f2c7a5'];

export function buildOffice(theme: Theme): Office {
  reseed(42);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(theme.bg);
  if (theme.fog) scene.fog = new THREE.Fog(theme.fog.color, 50, 50 + 1 / theme.fog.density);

  const { minX, maxX, minZ, maxZ, h: H } = ROOM;
  const W = maxX - minX, D = maxZ - minZ, CX = (minX + maxX) / 2;
  const L = theme.lights;
  const nav = new NavGrid(minX + 0.15, minZ + 0.15, maxX - 0.1, maxZ - 0.1);
  const lampMats: THREE.MeshBasicMaterial[] = [];
  const lampLights: THREE.PointLight[] = [];
  const dimMats: THREE.MeshBasicMaterial[] = [];
  const spots: Record<string, Spot[]> = {};

  const hemi = new THREE.HemisphereLight(L.sky, L.ground, L.hemi);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(L.sun, L.sunIntensity);
  sun.position.copy(new THREE.Vector3(...L.sunDir).normalize().multiplyScalar(40));
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera;
  sc.left = -24; sc.right = 24; sc.top = 24; sc.bottom = -24; sc.near = 1; sc.far = 90;
  sc.layers.enable(FX_LAYER);
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.03;
  scene.add(sun, sun.target);

  const pointLamp = (x: number, y: number, z: number, color: string, intensity: number, dist = 9) => {
    if (intensity <= 0) return;
    const p = new THREE.PointLight(color, intensity, dist, 1.6);
    p.position.set(x, y, z);
    scene.add(p);
    lampLights.push(p);
  };

  // slab + floor
  const F = theme.floor;
  const floorTex = F.kind === 'planks' ? planks(F.a, F.b) : F.kind === 'carpet' ? carpetTiles(F.a, F.b) : speckle(F.a, 0.04, 0.3);
  floorTex.wrapS = floorTex.wrapT = THREE.RepeatWrapping;
  // two rectangles make the L; the wing's texture is shifted so the pattern runs through
  for (const [x0, x1, z1] of [[minX, WING.x, maxZ], [WING.x, maxX, WING.maxZ]]) {
    const w = x1 - x0, d = z1 - minZ;
    box(scene, w + 0.8, 0.6, d + 0.8, toon(theme.slab), (x0 + x1) / 2, -0.62, (minZ + z1) / 2, false);
    const t = x0 === minX ? floorTex : floorTex.clone();
    t.repeat.set(w / 2, d / 2);
    t.offset.set(((x0 - minX) / 2) % 1, 1 - ((d / 2) % 1));
    box(scene, w, 0.04, d, toon('#ffffff', { map: t }), (x0 + x1) / 2, -0.04, (minZ + z1) / 2, false);
  }
  nav.rect(WING.x, WING.maxZ, maxX, maxZ, 0);

  // walls
  const wallTex = (len: number) => {
    const t = theme.wall.kind === 'brick' ? brick(theme.wall.a, theme.wall.b) : plaster(theme.wall.a);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(len / 1.6, H / 1.6);
    return t;
  };
  const backMat = toon('#ffffff', { map: wallTex(W) });
  const leftMat = toon('#ffffff', { map: wallTex(D) });
  const wallT = 0.3;
  const windows = theme.view === 'none' ? [] : [-10, -4.5, 1.2, 6.6, 11.2];
  const winW = 3.1, sill = 0.95, top = 2.95;
  const backZ = minZ - wallT / 2;
  const segs: [number, number][] = [];
  let cursor = minX - wallT;
  for (const wx of windows) {
    segs.push([cursor, wx - winW / 2]);
    cursor = wx + winW / 2;
  }
  segs.push([cursor, maxX]);
  for (const [a, b] of segs) if (b > a) box(scene, b - a, H, wallT, backMat, (a + b) / 2, 0, backZ);
  const frameMat = toon(theme.frame);
  for (const wx of windows) {
    box(scene, winW, sill, wallT, backMat, wx, 0, backZ);
    box(scene, winW, H - top, wallT, backMat, wx, top, backZ);
    box(scene, winW + 0.1, 0.08, wallT + 0.16, frameMat, wx, sill - 0.04, backZ + 0.02);
    box(scene, winW, 0.08, wallT, frameMat, wx, top - 0.04, backZ);
    for (const f of [-winW / 2, -winW / 6, winW / 6, winW / 2]) box(scene, 0.07, top - sill, wallT * 0.6, frameMat, wx + f, sill, backZ);
    box(scene, winW, 0.06, wallT * 0.6, frameMat, wx, (sill + top) / 2, backZ);
    const pane = new THREE.Mesh(new THREE.PlaneGeometry(winW, top - sill), glass('#bcd8ff', 0.1));
    dimMats.push(pane.material);
    pane.position.set(wx, (sill + top) / 2, backZ);
    scene.add(fx(pane));
    spots.window ??= [];
    if (wx > -4 && wx < 9) spots.window.push({ x: wx - 0.6, z: minZ + 0.75, rot: Math.PI }, { x: wx + 0.7, z: minZ + 0.75, rot: Math.PI });
  }
  let viewTex: THREE.CanvasTexture | undefined;
  if (windows.length) {
    viewTex = windowView(theme.view);
    const backdrop = new THREE.Mesh(new THREE.PlaneGeometry(32, 4), windowOnly(new THREE.MeshBasicMaterial({ map: viewTex, fog: false }), windows, winW, sill, top, minZ, wallT));
    backdrop.position.set(0, 1.0, minZ - 0.9);
    backdrop.onBeforeRender = (_r, _s, camera) => (backdrop.material as THREE.MeshBasicMaterial).userData.setView(camera);
    scene.add(fx(backdrop));
  }

  // invisible shell: roof with skylights, front wall and west wall with windows
  {
    const skylights = theme.view === 'none' ? [] : [[-0.4, 1.5, 2.2, 1.6], [6.2, 1.5, 2.2, 1.6], [-0.4, -4.6, 2.2, 1.4], [16.5, -2.5, 2.2, 1.4]];
    const step = 1;
    for (let x = minX; x < maxX; x += step)
      for (let z = minZ; z < maxZ; z += step) {
        const cx = x + step / 2, cz = z + step / 2;
        if (!inside(cx, cz)) continue;
        if (skylights.some(([sx, sz, sw, sd]) => Math.abs(cx - sx) < sw / 2 && Math.abs(cz - sz) < sd / 2)) continue;
        caster(scene, step, 0.2, step, cx, H, cz);
      }
    for (const [sx, sz, sw, sd] of skylights) {
      const f = toon(theme.wall.trim);
      box(scene, sw + 0.2, 0.12, 0.1, f, sx, H - 0.06, sz - sd / 2, false);
      box(scene, sw + 0.2, 0.12, 0.1, f, sx, H - 0.06, sz + sd / 2, false);
      box(scene, 0.1, 0.12, sd, f, sx - sw / 2, H - 0.06, sz, false);
      box(scene, 0.1, 0.12, sd, f, sx + sw / 2, H - 0.06, sz, false);
    }
    const shell = (axis: 'x' | 'z', fixed: number, from: number, to: number, holes: number[]) => {
      let c = from;
      const seg = (a: number, b: number, y0: number, y1: number) => {
        if (b <= a) return;
        if (axis === 'z') caster(scene, b - a, y1 - y0, 0.3, (a + b) / 2, y0, fixed);
        else caster(scene, 0.3, y1 - y0, b - a, fixed, y0, (a + b) / 2);
      };
      for (const hc of holes) {
        seg(c, hc - 1.4, 0, H);
        seg(hc - 1.4, hc + 1.4, 0, sill);
        seg(hc - 1.4, hc + 1.4, top, H);
        c = hc + 1.4;
      }
      seg(c, to, 0, H);
    };
    const open = theme.view !== 'none';
    shell('z', maxZ + 0.15, minX, WING.x, open ? [-8, -2, 4, 10] : []);
    shell('z', WING.maxZ + 0.15, WING.x, maxX, []);
    shell('x', maxX + 0.15, minZ, WING.maxZ, open ? [-5.5, 0.5] : []);
    shell('x', WING.x + 0.15, WING.maxZ, maxZ, open ? [6.5] : []);
  }

  // left wall
  const leftX = minX - wallT / 2;
  box(scene, wallT, H, D + wallT, leftMat, leftX, 0, (minZ + maxZ) / 2 - wallT / 2);
  if (theme.wall.kind === 'livingwall') {
    const lw = livingWall();
    lw.repeat.set(3, 2);
    box(scene, 0.12, 2.3, 3.6, toon('#ffffff', { map: lw }), minX + 0.06, 0.55, 0.5);
    box(scene, 0.22, 0.14, 3.8, toon('#9a8f7a'), minX + 0.1, 0.42, 0.5);
    nav.rect(minX, -1.4, minX + 0.3, 2.4);
  }
  const trim = toon(theme.wall.trim);
  box(scene, W + wallT, 0.12, wallT + 0.04, trim, CX - wallT / 2, H - 0.12, backZ);
  box(scene, wallT + 0.04, 0.12, D + wallT, trim, leftX, H - 0.12, -wallT / 2);
  box(scene, W, 0.1, 0.06, trim, CX, 0, minZ + 0.03);
  box(scene, 0.06, 0.1, D, trim, minX + 0.03, 0, 0);

  // doors on the left wall
  const makeDoor = (z: number, w: number, color: string, label: string, labelBg: string): Door => {
    const frame = toon(theme.id === 'campus' ? '#d8d2c4' : '#2a2228');
    box(scene, 0.14, 2.4, 0.1, frame, minX + 0.07, 0, z - w / 2 - 0.05);
    box(scene, 0.14, 2.4, 0.1, frame, minX + 0.07, 0, z + w / 2 + 0.05);
    box(scene, 0.14, 0.1, w + 0.2, frame, minX + 0.07, 2.3, z);
    box(scene, 0.04, 2.3, w, toon('#1a1a20'), minX + 0.02, 0, z, false);
    const pivot = new THREE.Group();
    pivot.position.set(minX + 0.08, 0, z - w / 2);
    const leaf = box(pivot, 0.06, 2.28, w, toon(color), 0, 0, w / 2);
    leaf.castShadow = true;
    box(pivot, 0.1, 0.05, 0.16, toon('#d9c9a0'), 0.05, 1.0, w - 0.14);
    scene.add(pivot);
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.24), glowMap(labelTexture(label, { w: 40, h: 14, bg: labelBg, fg: '#ffffff', size: 10 }), 1.15));
    sign.position.set(minX + 0.1, 2.58, z);
    sign.rotation.y = Math.PI / 2;
    scene.add(sign);
    nav.free(minX, z - w / 2, minX + 0.6, z + w / 2);
    return { pivot, x: minX + 0.1, z, front: { x: minX + 0.75, z, rot: -Math.PI / 2 }, open: 0, target: 0 };
  };
  const exit = makeDoor(3.8, 1.3, theme.id === 'campus' ? '#3e8a6e' : '#4a3a2a', S.signExit, '#2f8a4a');
  const wc = makeDoor(6.8, 1.0, theme.id === 'campus' ? '#f2b84b' : '#5a3a2a', S.signWc, '#3a4a5a');
  const busy = glow('#ff4a4a', 0.4);
  const busyLamp = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.12, 0.12), busy);
  busyLamp.position.set(minX + 0.1, 2.58, 6.8 + 0.42);
  scene.add(busyLamp);
  wc.busyLamp = busy;
  spots.wcQueue = [
    { x: minX + 1.3, z: 7.6, rot: -Math.PI / 2 - 0.4 },
    { x: minX + 1.9, z: 8.2, rot: -Math.PI / 2 - 0.5 },
    { x: minX + 2.2, z: 7.2, rot: -Math.PI / 2 - 0.2 },
  ];

  // boss glass office
  const bossX = -7, bossZ = -4;
  const glassMat = glass(theme.id === 'boiler' ? '#ff6680' : '#cfe6ff', 0.2);
  dimMats.push(glassMat);
  const gw1 = new THREE.Mesh(new THREE.PlaneGeometry(bossZ - minZ, 2.7), glassMat);
  gw1.position.set(bossX, 1.35, (minZ + bossZ) / 2);
  gw1.rotation.y = Math.PI / 2;
  scene.add(fx(gw1));
  const gw2 = new THREE.Mesh(new THREE.PlaneGeometry(bossX - minX - 1.1, 2.7), glassMat);
  gw2.position.set(minX + (bossX - minX - 1.1) / 2, 1.35, bossZ);
  scene.add(fx(gw2));
  const mull = toon('#2a2a30');
  for (const z of [minZ + 0.1, -7.2, -5.6, bossZ]) box(scene, 0.07, 2.75, 0.07, mull, bossX, 0, z);
  for (const x of [minX + 0.1, -11.2, -9.4, bossX - 1.1, bossX]) box(scene, 0.07, 2.75, 0.07, mull, x, 0, bossZ);
  box(scene, 0.08, 0.07, bossZ - minZ, mull, bossX, 2.7, (minZ + bossZ) / 2);
  box(scene, bossX - minX, 0.07, 0.08, mull, (minX + bossX) / 2, 2.7, bossZ);
  const chefPlate = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.24), new THREE.MeshBasicMaterial({ map: labelTexture(S.signBoss, { w: 36, h: 10, bg: '#f2e6c8', fg: '#2a2228', size: 8 }) }));
  chefPlate.position.set(bossX - 0.6, 1.9, bossZ + 0.02);
  scene.add(chefPlate);
  nav.rect(bossX - 0.05, minZ, bossX + 0.05, bossZ, 0.25);
  nav.rect(minX, bossZ - 0.05, bossX - 1.1, bossZ + 0.05, 0.25);
  spots.knock = [{ x: bossX - 0.55, z: bossZ + 0.7, rot: Math.PI }];
  // the line of people who wait for an answer: along the glass towards the door. It starts a few steps from the
  // door, so the boss can still get out and the first team's name board does not hang in front of it.
  spots.bossQueue = [0, 1, 2].map((i) => ({ x: bossX - 3.4 - i * 0.72, z: bossZ + 0.7, rot: Math.PI / 2 - 0.25 }));

  const bossDeskMat = toon(theme.id === 'campus' ? '#f4f1ea' : '#3a2a24');
  box(scene, 2.4, 0.06, 1.0, bossDeskMat, -10, 0.84, -6.7);
  nav.rect(-11.2, -7.2, -8.8, -6.2, 0.15);
  box(scene, 2.4, 0.84, 0.08, bossDeskMat, -10, 0, -6.25);
  box(scene, 0.08, 0.84, 1.0, bossDeskMat, -11.16, 0, -6.7);
  box(scene, 0.08, 0.84, 1.0, bossDeskMat, -8.84, 0, -6.7);
  for (const dx of [-0.45, 0.45]) {
    const mon = new THREE.Group();
    // at the far edge of the desk, screens turned to the boss
    mon.position.set(-10 + dx, 0.9, -6.5);
    mon.rotation.y = Math.PI + dx * 0.4;
    box(mon, 0.7, 0.42, 0.05, toon('#1d1c22'), 0, 0.12, 0);
    const scr = new THREE.Mesh(new THREE.PlaneGeometry(0.64, 0.36), glowMap(screenTexture('boss', '#ffd27a', theme.desk.screenBg, 77 + dx * 10), L.screenGlow));
    scr.position.set(0, 0.33, 0.03);
    mon.add(scr);
    box(mon, 0.06, 0.12, 0.06, toon('#1d1c22'), 0, 0, 0);
    scene.add(mon);
  }
  // service bell on the boss desk
  box(scene, 0.16, 0.03, 0.16, toon('#3a3a40'), -9.0, 0.9, -6.4);
  box(scene, 0.12, 0.07, 0.12, toon('#e8c25a'), -9.0, 0.93, -6.4);
  box(scene, 0.8, 0.08, 0.8, toon('#2a2228'), -10, 0.52, -7.75);
  box(scene, 0.8, 1.1, 0.14, toon('#2a2228'), -10, 0.6, -8.2);
  // quota wall: a big dark screen whose content is an HTML overlay mapped onto it
  box(scene, 0.07, 2.12, 4.62, toon('#141418'), minX + 0.03, 0.69, -6.5);
  const wallGlow = glow('#0d1416', 1);
  const wallPlane = new THREE.Mesh(new THREE.PlaneGeometry(4.3, 1.8), wallGlow);
  wallPlane.position.set(minX + 0.075, 1.75, -6.5);
  wallPlane.rotation.y = Math.PI / 2;
  scene.add(wallPlane);
  const wallScreen = {
    tl: new THREE.Vector3(minX + 0.08, 2.65, -4.35),
    right: new THREE.Vector3(0, 0, -4.3),
    down: new THREE.Vector3(0, -1.8, 0),
    glow: wallGlow,
    mesh: wallPlane,
  };
  const occluders: THREE.Box3[] = [];
  for (const x of [minX + 0.1, -11.2, -9.4, bossX - 1.1]) occluders.push(new THREE.Box3(new THREE.Vector3(x - 0.04, 0, bossZ - 0.04), new THREE.Vector3(x + 0.04, 2.75, bossZ + 0.04)));
  occluders.push(new THREE.Box3(new THREE.Vector3(minX, 2.66, bossZ - 0.05), new THREE.Vector3(bossX, 2.77, bossZ + 0.05)));
  pottedPlant(scene, -7.6, -8.5, 1.2);
  if (theme.rug) rug(scene, -10, -6.4, 4.2, 3.6, theme.id === 'campus' ? '#d7e4d0' : '#6a3a4a', theme.id === 'campus' ? '#c4d4bb' : '#55303e');

  // boss character (the orchestrator thread)
  const bossLook: Look = {
    skin: SKIN[1], hair: '#d9d4cc', hairStyle: 'short', shirt: '#2a2a3a', shirtTrim: '#d9774f', pants: '#26303a', shoes: '#2a2428', outfit: 'blazer', glasses: true,
  };
  const bossCh = createCharacter(bossLook, 1.05 * PERSON);
  const bossSeat = theme.djCentral ? { x: 0.5, z: -7.85, rot: 0.15 } : { x: -10, z: -7.7, rot: 0 };
  bossCh.root.position.set(bossSeat.x, theme.djCentral ? 0.35 : 0, bossSeat.z);
  bossCh.root.rotation.y = bossSeat.rot;
  bossCh.setPose(theme.djCentral ? 'cheer' : 'typing');
  scene.add(bossCh.root);

  // pods and seats
  const pods: [number, number][] = [[-3.6, -1.4], [2.8, -1.4], [-3.6, 4.4], [2.8, 4.4]];
  const seats = floorSeats();
  const floor = new Floor(scene, theme, nav, seats);
  const signs = floor.signs;
  pods.forEach(([cx, cz]) => {
    if (theme.props.pendants === 'edison') {
      for (const dx of [-1.2, 1.2]) {
        box(scene, 0.02, 1.0, 0.02, toon('#151515'), cx + dx, H - 1.0, cz, false);
        const bulb = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.16, 0.12), glow(L.lamp, 1));
        bulb.position.set(cx + dx, H - 1.22, cz);
        scene.add(bulb);
        lampMats.push(bulb.material as THREE.MeshBasicMaterial);
      }
      pointLamp(cx, H - 1.3, cz, L.lamp, L.lampIntensity);
    } else if (theme.props.pendants === 'globe') {
      for (const dx of [-1.6, 0, 1.6]) {
        box(scene, 0.02, 0.8, 0.02, toon('#e8e2d6'), cx + dx, H - 0.8, cz, false);
        const g = new THREE.Mesh(new THREE.SphereGeometry(0.2, 8, 6), glow('#fff2d8', 1));
        g.position.set(cx + dx, H - 0.95, cz);
        scene.add(g);
        lampMats.push(g.material as THREE.MeshBasicMaterial);
      }
      pointLamp(cx, H - 1.1, cz, '#ffd9a0', 6, 8);
    }
  });

  if (theme.props.pendants === 'globe') {
    for (const [x, z, i] of [[10.6, -6.9, 4], [9.6, 6.0, 3.5], [-10, -6.4, 3], [-11.2, 5.2, 2.5]] as [number, number, number][]) {
      box(scene, 0.02, 0.8, 0.02, toon('#e8e2d6'), x, H - 0.8, z, false);
      const g = new THREE.Mesh(new THREE.SphereGeometry(0.2, 8, 6), glow('#fff2d8', 1));
      g.position.set(x, H - 0.95, z);
      scene.add(g);
      lampMats.push(g.material as THREE.MeshBasicMaterial);
      pointLamp(x, H - 1.1, z, '#ffd9a0', i, 7);
    }
  }

  // kitchen
  const kitchen = buildKitchen(scene, theme, nav, spots);
  // DJ booth
  const fogger = djBooth(scene, theme, nav);
  const partyLights: THREE.PointLight[] = [];
  for (const [x, z, c] of [[2.4, -6.2, '#ff3a8c'], [5.4, -6.2, '#3ad8ff'], [3.9, -4.6, '#9b5cff']] as [number, number, string][]) {
    const pl = new THREE.PointLight(c, 0, 9, 1.5);
    pl.position.set(x, 2.9, z);
    scene.add(pl);
    partyLights.push(pl);
  }
  const ball = new THREE.Group();
  ball.position.set(3.9, H - 0.75, -6.0);
  const ballMesh = new THREE.Mesh(new THREE.IcosahedronGeometry(0.26, 1), new THREE.MeshLambertMaterial({ color: '#d8dce8', flatShading: true, emissive: '#30343c' }));
  ball.add(ballMesh);
  box(ball, 0.02, 0.5, 0.02, toon('#2a2a30'), 0, 0.2, 0, false);
  ball.visible = false;
  scene.add(ball);
  spots.dance = [];
  for (const [x, z] of [[2.6, -6.6], [3.5, -6.8], [4.4, -6.7], [5.3, -6.5], [3.0, -5.8], [3.9, -5.6], [4.8, -5.8], [2.3, -5.2], [5.6, -5.4]]) spots.dance.push({ x, z, rot: Math.PI + (x - 3.9) * 0.15 });
  // lounge
  const lounged = lounge(scene, theme, nav, spots);
  // the single rack that stood here drew this many random numbers; keep the sequence so the plants look as before
  for (let i = 0; i < 24; i++) if (rand() >= 0.7) rand();
  // walls: whiteboard, kanban, neon, clock
  const decor = wallDecor(scene, theme, lampMats);

  // water cooler
  waterCooler(scene, 7.4, minZ + 0.7);
  nav.rect(7.15, minZ, 7.65, minZ + 0.95);
  spots.cooler = [
    { x: 6.9, z: minZ + 1.65, rot: Math.PI * 0.8 },
    { x: 8.1, z: minZ + 1.85, rot: -Math.PI * 0.6 },
  ];

  // plants (also watering spots)
  const plantSpots: [number, number, number][] = [
    [-12.4, -3.4, 1.1], [-12.4, 8.5, 1.3], [-0.3, 8.3, 0.9], [12.4, 8.3, 1.2], [-6.4, 8.3, 1.0], [5.8, -8.5, 0.9],
    [-0.4, -8.5, 1.0], [13.0, 1.35, 1.2], [-6.6, 1.4, 0.8], [6.3, 1.5, 0.9], [-12.4, 2.6, 1.0], [13.0, -4.85, 1.0],
    [-1.6, -3.8, 0.7], [-0.4, 1.5, 0.8], [6.3, 7.2, 0.9], [-6.6, 7.2, 1.0],
  ];
  spots.plants = [];
  plantSpots.slice(0, theme.props.plants).forEach(([x, z, s]) => {
    pottedPlant(scene, x, z, s);
    nav.rect(x - 0.22 * s, z - 0.22 * s, x + 0.22 * s, z + 0.22 * s, 0.15);
    const dx = x > 0 ? -0.75 : 0.75;
    if (Math.abs(x) < 12 && Math.abs(z) < 8) spots.plants.push({ x: x + dx, z, rot: dx > 0 ? -Math.PI / 2 : Math.PI / 2 });
  });

  if (theme.props.beams) {
    const steel = toon('#22252a');
    box(scene, W, 0.3, 0.3, steel, CX, H - 0.3, minZ + 0.4);
  }

  // roomba
  const roomba = new THREE.Group();
  const rb = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.08, 12), toon('#2a2a30'));
  rb.position.y = 0.05;
  rb.castShadow = true;
  roomba.add(rb);
  const rl = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.03, 0.06), glow('#5ef0ff', 2));
  rl.position.set(0, 0.1, 0.12);
  roomba.add(rl);
  scene.add(roomba);

  // the east wing and the props on the main floor come last, so the seeded look of everything above stays as it was
  const extras = buildExtras({ scene, theme, nav, spots, glassMat, lampMats, pointLamp, windows, winW, sill, top, boss: { x: bossX, z: bossZ } });
  roomba.position.set(extras.roombaDock.x, 0, extras.roombaDock.z);
  if (spots.window) spots.window = spots.window.filter((s) => nav.walkable(s.x, s.z));

  return {
    ...extras,
    scene,
    sun,
    hemi,
    viewTex,
    nav,
    seats,
    spots,
    doors: { exit, wc },
    lamps: { mats: lampMats, lights: lampLights, dim: dimMats },
    clock: decor.clock,
    coffeeDisplay: kitchen.display,
    pinboard: decor.pinboard,
    whiteboard: decor.whiteboard,
    tipJar: kitchen.tipJar,
    pingpongBall: lounged.ball,
    coffeeSteam: kitchen.steam,
    boss: { ch: bossCh, head: bossCh.head, seat: bossSeat },
    roomba,
    signs,
    floor,
    wallScreen,
    occluders,
    party: {
      lights: partyLights,
      ball,
      vinyl: (() => { const v: THREE.Object3D[] = []; scene.traverse((o) => o.name === 'vinyl' && v.push(o)); return v; })(),
      cones: (() => { const v: THREE.Object3D[] = []; scene.traverse((o) => o.name === 'cone' && v.push(o)); return v; })(),
      fogger,
    },
  };
}

function rug(scene: THREE.Scene, x: number, z: number, w: number, d: number, a: string, b: string) {
  rugMesh(scene, x, z, w, d, a, b);
}

export function rugMesh(scene: THREE.Scene, x: number, z: number, w: number, d: number, a: string, b: string) {
  const t = canvasTexture(32, 32, (g) => {
    g.fillStyle = a;
    g.fillRect(0, 0, 32, 32);
    g.fillStyle = b;
    g.fillRect(2, 2, 28, 1);
    g.fillRect(2, 29, 28, 1);
    g.fillRect(2, 2, 1, 28);
    g.fillRect(29, 2, 1, 28);
    for (let i = 0; i < 80; i++) g.fillRect(4 + Math.floor(rand() * 24), 4 + Math.floor(rand() * 24), 1, 1);
  });
  return box(scene, w, 0.02, d, toon('#ffffff', { map: t }), x, 0, z, false);
}

/** A team board drawn at exactly one texel per art pixel, so the pixel font stays crisp. */
export function pixelSign(text: string, color: string) {
  const font = '8px "Silkscreen"';
  const m = document.createElement('canvas').getContext('2d')!;
  m.font = font;
  const w = Math.ceil(m.measureText(text).width) + 9;
  const h = 13;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d')!;
  g.fillStyle = color;
  g.fillRect(0, 0, w, h);
  const dark = '#' + new THREE.Color(color).multiplyScalar(0.62).getHexString();
  g.fillStyle = dark;
  g.fillRect(0, h - 1, w, 1);
  g.fillRect(w - 1, 0, 1, h);
  g.fillStyle = '#' + new THREE.Color(color).lerp(new THREE.Color('#ffffff'), 0.35).getHexString();
  g.fillRect(0, 0, w - 1, 1);
  g.fillRect(0, 0, 1, h - 1);
  // draw text, then threshold the anti-aliased edges back to hard pixels
  const t = document.createElement('canvas');
  t.width = w;
  t.height = h;
  const tg = t.getContext('2d')!;
  tg.font = font;
  tg.textBaseline = 'alphabetic';
  tg.fillStyle = '#1f1a20';
  tg.fillText(text, 5, 10);
  const img = tg.getImageData(0, 0, w, h);
  for (let i = 3; i < img.data.length; i += 4) img.data[i] = img.data[i] > 110 ? 255 : 0;
  tg.putImageData(img, 0, 0);
  g.drawImage(t, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.magFilter = tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.colorSpace = THREE.SRGBColorSpace;
  return { tex, w, h };
}

export function pottedPlant(scene: THREE.Object3D, x: number, z: number, s = 1) {
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  g.scale.setScalar(s);
  box(g, 0.4, 0.42, 0.4, toon(pick(['#c9704a', '#e8e2d6', '#3a3a40', '#d9a441'])), 0, 0, 0);
  box(g, 0.34, 0.03, 0.34, toon('#3a2a1f'), 0, 0.42, 0);
  const greens = ['#4f9a3c', '#3f7a34', '#62b04a', '#2f6a33'];
  const kind = Math.floor(rand() * 3);
  if (kind === 0) {
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const leaf = box(g, 0.14, 0.5 + rand() * 0.3, 0.06, toon(pick(greens)), Math.cos(a) * 0.1, 0.4, Math.sin(a) * 0.1);
      leaf.rotation.set(Math.sin(a) * 0.5, -a, Math.cos(a) * 0.5);
    }
  } else if (kind === 1) {
    box(g, 0.08, 0.6, 0.08, toon('#6b4a2f'), 0, 0.42, 0);
    box(g, 0.6, 0.45, 0.6, toon(pick(greens)), 0, 0.9, 0);
    box(g, 0.4, 0.3, 0.4, toon(pick(greens)), 0.05, 1.3, 0.03);
  } else {
    box(g, 0.22, 0.75, 0.22, toon('#4f8a4a'), 0, 0.42, 0);
    box(g, 0.12, 0.3, 0.12, toon('#4f8a4a'), 0.17, 0.75, 0);
    box(g, 0.12, 0.24, 0.12, toon('#4f8a4a'), -0.16, 0.62, 0);
  }
  scene.add(g);
  return g;
}

function buildKitchen(scene: THREE.Scene, theme: Theme, nav: NavGrid, spots: Record<string, Spot[]>) {
  const minZ = ROOM.minZ;
  const counterMat = toon(theme.id === 'campus' ? '#f4f1ea' : '#3a3036');
  const topMat = toon(theme.id === 'campus' ? '#d8cfbd' : '#a9774f');
  box(scene, 3.8, 0.86, 0.7, counterMat, 10.6, 0, minZ + 0.4);
  box(scene, 3.9, 0.06, 0.76, topMat, 10.6, 0.86, minZ + 0.42);
  for (let i = 0; i < 4; i++) box(scene, 0.86, 0.68, 0.02, toon(theme.wall.trim), 9.1 + i * 0.96, 0.09, minZ + 0.76, false);
  nav.rect(8.7, minZ, 13, minZ + 0.85);

  const cm = new THREE.Group();
  cm.position.set(9.6, 0.92, minZ + 0.45);
  box(cm, 0.6, 0.66, 0.46, toon('#2a2a30'), 0, 0, 0);
  box(cm, 0.6, 0.12, 0.5, toon('#c9423b'), 0, 0.66, 0);
  box(cm, 0.3, 0.06, 0.2, toon('#8a8a90'), 0, 0.02, 0.18);
  const dispCanvas = document.createElement('canvas');
  dispCanvas.width = 28;
  dispCanvas.height = 14;
  const dispTex = new THREE.CanvasTexture(dispCanvas);
  dispTex.magFilter = dispTex.minFilter = THREE.NearestFilter;
  dispTex.colorSpace = THREE.SRGBColorSpace;
  const display = (cost: number) => {
    const g = dispCanvas.getContext('2d')!;
    g.fillStyle = '#0d1a12';
    g.fillRect(0, 0, 28, 14);
    g.fillStyle = '#7dffb0';
    g.font = '10px "VT323"';
    g.textBaseline = 'middle';
    g.fillText(S.coffeeCost(cost), 9, 7.5);
    g.fillRect(2, 4, 4, 5);
    g.fillRect(6, 5, 1, 2);
    dispTex.needsUpdate = true;
  };
  display(0);
  const dm = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.21), glowMap(dispTex, 1.6));
  dm.position.set(0, 0.48, 0.235);
  cm.add(dm);
  scene.add(cm);
  const steam: THREE.Mesh[] = [];
  const steamMat = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.5, depthWrite: false });
  for (let i = 0; i < 4; i++) {
    const s = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.07, 0.07), steamMat);
    s.visible = false;
    s.position.set(9.6, 1.1, minZ + 0.66);
    scene.add(fx(s));
    steam.push(s);
  }
  spots.coffee = [
    { x: 9.6, z: minZ + 1.25, rot: Math.PI },
    { x: 9.8, z: minZ + 2.1, rot: Math.PI * 0.9 },
    { x: 10.4, z: minZ + 2.6, rot: Math.PI * 0.85 },
  ];
  spots.microwave = [{ x: 11.4, z: minZ + 1.25, rot: Math.PI }, { x: 11.9, z: minZ + 2.0, rot: Math.PI * 0.9 }];

  // tip jar = running cost, one coin per quarter dollar
  const jarX = 10.25, jarY = 0.92, jarZ = minZ + 0.45;
  const jar = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.34, 0.24), glass('#d8f0ff', 0.35));
  jar.position.set(jarX, jarY + 0.17, jarZ);
  scene.add(fx(jar));
  const coinMat = glow('#f2c94c', 1.1);
  let stacked = 0;
  const falling: { m: THREE.Mesh; v: number; targetY: number }[] = [];
  const tipJar = {
    x: jarX, y: jarY, z: jarZ,
    drop() {
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.02, 0.07), coinMat);
      const targetY = jarY + 0.01 + Math.min(stacked, 14) * 0.021;
      stacked++;
      m.position.set(jarX + (rand() - 0.5) * 0.1, jarY + 0.8, jarZ + (rand() - 0.5) * 0.1);
      scene.add(m);
      falling.push({ m, v: 0, targetY });
      if (stacked > 15) {
        // keep the jar from overflowing: old coins melt into the pile
        const old = scene.children.find((c) => (c as THREE.Mesh).material === coinMat && !falling.some((f) => f.m === c));
        if (old) scene.remove(old);
      }
    },
    update(dt: number) {
      for (let i = falling.length - 1; i >= 0; i--) {
        const f = falling[i];
        f.v += 9.8 * dt;
        f.m.position.y -= f.v * dt;
        f.m.rotation.y += dt * 8;
        if (f.m.position.y <= f.targetY) {
          f.m.position.y = f.targetY;
          falling.splice(i, 1);
        }
      }
    },
  };

  box(scene, 0.62, 0.36, 0.42, toon('#d9d4cc'), 11.4, 0.92, minZ + 0.4);
  box(scene, 0.36, 0.26, 0.02, toon('#22262c'), 11.33, 0.97, minZ + 0.62);
  box(scene, 0.9, 2.1, 0.8, toon('#e6e3dc'), 12.5, 0, minZ + 0.45);
  box(scene, 0.04, 0.5, 0.04, toon('#8a8a90'), 12.12, 1.2, minZ + 0.87);
  if (theme.props.kombucha) {
    box(scene, 0.32, 0.5, 0.18, toon('#c0c4c8'), 8.9, 0.92, minZ + 0.4);
    for (const dx of [-0.08, 0.08]) box(scene, 0.04, 0.16, 0.08, toon(dx < 0 ? '#f2b84b' : '#e8556b'), 8.9 + dx, 1.25, minZ + 0.55);
  }
  return { display, tipJar, steam };
}

function waterCooler(scene: THREE.Scene, x: number, z: number) {
  box(scene, 0.42, 0.9, 0.42, toon('#e8e4dc'), x, 0, z);
  const jug = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.46, 0.34), glass('#7fc8ff', 0.6));
  jug.position.set(x, 1.13, z);
  scene.add(fx(jug));
  box(scene, 0.08, 0.06, 0.06, toon('#3d7ad9'), x - 0.08, 0.62, z + 0.23);
  box(scene, 0.08, 0.06, 0.06, toon('#d9423d'), x + 0.08, 0.62, z + 0.23);
}

function djBooth(scene: THREE.Scene, theme: Theme, nav: NavGrid) {
  const central = theme.djCentral;
  const g = new THREE.Group();
  const bx = central ? 0.5 : 3.9, bz = ROOM.minZ + (central ? 2.1 : 1.0);
  g.position.set(bx, central ? 0.35 : 0, bz);
  scene.add(g);
  nav.rect(bx - 1.8, bz - 0.4, bx + 1.8, bz + 0.4);
  nav.rect(bx + 0.7, bz + 0.65, bx + 1.3, bz + 1.15, 0.1);
  if (central) {
    box(scene, 5.2, 0.35, 2.6, toon('#151218'), 0.5, 0, ROOM.minZ + 2.1);
    box(scene, 5.2, 0.04, 0.04, glow('#ff2a55', 2.5), 0.5, 0.35, ROOM.minZ + 3.4);
    nav.rect(-2.1, ROOM.minZ, 3.1, ROOM.minZ + 3.4);
  }
  const body = toon(theme.id === 'campus' ? '#2f6f73' : '#1b1a20');
  box(g, 1.9, 0.92, 0.7, body, 0, 0, 0);
  box(g, 2.0, 0.05, 0.78, toon('#2a2a30'), 0, 0.92, 0);
  const front = canvasTexture(38, 18, (c, w, h) => {
    c.fillStyle = '#121016';
    c.fillRect(0, 0, w, h);
    for (let x = 1; x < w - 1; x += 2) {
      const v = Math.round(3 + Math.abs(Math.sin(x * 0.7) * Math.cos(x * 0.23)) * 12);
      c.fillStyle = x % 6 === 1 ? '#ff4f7a' : x % 6 === 3 ? '#5ef0ff' : '#ffd36b';
      c.fillRect(x, h - 1 - v, 1, v);
    }
  });
  const fm = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 0.8), glowMap(front, central ? 1.8 : 1.1));
  fm.position.set(0, 0.46, 0.355);
  g.add(fm);
  for (const dx of [-0.6, 0.6]) {
    box(g, 0.56, 0.06, 0.5, toon('#3a3a42'), dx, 0.97, 0);
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.21, 0.21, 0.02, 12), toon('#121214'));
    disc.position.set(dx, 1.04, 0);
    disc.name = 'vinyl';
    g.add(disc);
    const lbl = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.025, 0.04), glow(dx < 0 ? '#ff4f7a' : '#5ef0ff', 1.6));
    lbl.position.set(0.1, 0.005, 0);
    disc.add(lbl);
  }
  box(g, 0.4, 0.07, 0.45, toon('#26262c'), 0, 0.97, 0);
  for (let k = 0; k < 6; k++) box(g, 0.04, 0.03, 0.04, glow(k % 2 ? '#ffd36b' : '#7dffb0', 1.8), -0.12 + (k % 3) * 0.12, 1.04, -0.1 + Math.floor(k / 3) * 0.18, false);
  for (const dx of [-1.45, 1.45]) {
    const s = new THREE.Group();
    s.position.set(dx, 0, 0);
    box(s, 0.7, central ? 1.8 : 1.3, 0.6, toon('#18171c'), 0, 0, 0);
    for (const [y, r] of central ? [[0.45, 0.24], [1.3, 0.14]] : [[0.35, 0.2], [0.95, 0.12]]) {
      const cone = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 0.04, 10), toon('#3a3a42'));
      cone.rotation.x = Math.PI / 2;
      cone.position.set(0, y, 0.31);
      cone.name = 'cone';
      s.add(cone);
    }
    g.add(s);
  }
  box(g, 0.5, 0.36, 0.4, toon('#c9a26b'), 1.0, 0, 0.9);
  for (let r = 0; r < 6; r++) box(g, 0.44, 0.4, 0.02, toon(pick(['#e8556b', '#2a2a30', '#f2c94c', '#5ef0ff', '#9b7fe0'])), 1.0, 0.04, 0.75 + r * 0.05, false);
  g.name = 'djbooth';

  // fog machine beside the left speaker, aimed at the dance floor
  const fog = new THREE.Group();
  fog.position.set(-2.2, 0, 0.1);
  fog.rotation.y = 0.35;
  for (const dx of [-0.2, 0.2]) box(fog, 0.04, 0.06, 0.4, toon('#2a2a30'), dx, 0, 0, false);
  box(fog, 0.46, 0.26, 0.36, toon('#4a4a54'), 0, 0.06, 0);
  box(fog, 0.47, 0.05, 0.37, toon('#f2b84b'), 0, 0.16, 0, false);
  box(fog, 0.14, 0.12, 0.12, toon('#8a8a90'), 0, 0.13, 0.22);
  box(fog, 0.3, 0.03, 0.04, toon('#8a8a90'), 0, 0.37, 0, false);
  for (const dx of [-0.14, 0.14]) box(fog, 0.03, 0.06, 0.04, toon('#8a8a90'), dx, 0.32, 0, false);
  const tank = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.22, 0.14), glass('#7fc8ff', 0.6));
  tank.position.set(0.1, 0.43, -0.08);
  fog.add(fx(tank));
  box(fog, 0.04, 0.03, 0.02, glow('#ff4a4a', 2), -0.15, 0.2, 0.185, false);
  g.add(fog);
  if (!central) nav.rect(bx - 2.45, bz - 0.15, bx - 1.95, bz + 0.35, 0.05);
  g.updateMatrixWorld(true);
  const fogger = { pos: fog.localToWorld(new THREE.Vector3(0, 0.19, 0.3)), dir: new THREE.Vector3(0, 0.2, 1).applyQuaternion(fog.quaternion).normalize() };

  if (central) {
    const led = canvasTexture(96, 28, (c, w, h) => {
      c.fillStyle = '#05040a';
      c.fillRect(0, 0, w, h);
      for (let y = 0; y < h; y += 2)
        for (let x = 0; x < w; x += 2) {
          const v = Math.sin(x * 0.18) * 6 + Math.sin(x * 0.05 + 1) * 4 + h / 2;
          if (Math.abs(y - v) < 3) {
            c.fillStyle = '#ff2a55';
            c.fillRect(x, y, 1, 1);
          }
        }
      c.fillStyle = '#ffe6ee';
      c.font = '10px "Silkscreen"';
      c.textAlign = 'center';
      c.fillText('B2B · LIVE', w / 2, 9);
    });
    const ledMesh = new THREE.Mesh(new THREE.PlaneGeometry(7.2, 2.1), glowMap(led, 2.2));
    ledMesh.position.set(0.5, 2.1, ROOM.minZ + 0.02);
    scene.add(ledMesh);
    const cols = ['#ff2a55', '#39ff88', '#ff2a55', '#5e7bff', '#39ff88', '#ff2a55', '#5e7bff'];
    for (let i = 0; i < 7; i++) {
      const len = 12 + (i % 3) * 2;
      const beam = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.025, len), additive(cols[i % cols.length], 0.22));
      beam.rotation.order = 'YXZ';
      beam.rotation.y = -0.85 + (i / 6) * 1.7;
      beam.rotation.x = 0.16 + (i % 3) * 0.05;
      beam.position.set(0.5, 3.2, ROOM.minZ + 1.3);
      beam.translateZ(len / 2);
      beam.name = 'laser';
      scene.add(fx(beam));
    }
    for (const [x, c] of [[-3.5, '#ff3a6e'], [0.5, '#5a66ff'], [4.5, '#ff3a6e']] as [number, string][]) {
      const p = new THREE.PointLight(c, 7, 11, 1.4);
      p.position.set(x, 3.0, -5.5);
      scene.add(p);
    }
    for (const [x, z, c] of [[-4, 1.5, '#5a66ff'], [6, 1.5, '#ff3a6e'], [-4, 6, '#ff3a6e'], [6, 6, '#5a66ff'], [10.5, -6, '#ff8a3a'], [-10, -6, '#5a66ff']] as [number, number, string][]) {
      const p = new THREE.PointLight(c, 5, 9, 1.4);
      p.position.set(x, 3.0, z);
      scene.add(p);
    }
  } else {
    const p = new THREE.PointLight('#ff8ab0', 1.1, 3, 1.8);
    p.position.set(3.9, 1.6, ROOM.minZ + 1.6);
    scene.add(p);
  }
  return fogger;
}

function lounge(scene: THREE.Scene, theme: Theme, nav: NavGrid, spots: Record<string, Spot[]>) {
  const P = theme.props;
  rug(scene, 9.6, 6.2, 5.6, 4.2, theme.id === 'campus' ? '#f2d9a8' : '#1a1418', theme.id === 'campus' ? '#e0be82' : '#2a1a22');
  spots.couch = [];
  if (P.beanbags) {
    for (const [x, z, col, rot] of [[9.2, 5.6, '#e8556b', 0.4], [10.9, 5.0, '#2f6f73', -0.3], [11.4, 6.9, '#f2b84b', -1.2], [8.6, 7.2, '#9b7fe0', 1.0]] as [number, number, string, number][]) {
      const bag = new THREE.Group();
      bag.position.set(x, 0, z);
      bag.rotation.y = rot;
      box(bag, 0.9, 0.34, 0.9, toon(col), 0, 0, 0);
      box(bag, 0.8, 0.3, 0.3, toon(col), 0, 0.3, -0.3);
      scene.add(bag);
      nav.rect(x - 0.45, z - 0.45, x + 0.45, z + 0.45, 0.05);
      spots.couch.push({ x: x + Math.sin(rot) * 0.05, z: z + Math.cos(rot) * 0.05, rot });
    }
  }
  if (P.couch) {
    const c = toon('#3d5a6e');
    box(scene, 3.0, 0.38, 1.0, c, 9.6, 0, 7.6);
    box(scene, 3.0, 0.75, 0.3, c, 9.6, 0, 8.15);
    nav.rect(8.1, 7.1, 11.1, 8.3, 0.05);
    spots.couch.push({ x: 9.0, z: 7.5, rot: Math.PI }, { x: 10.2, z: 7.5, rot: Math.PI });
  }
  let ball = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.06), glow('#fff4d0', 1.4));
  if (P.pingpong) {
    const tbl = toon('#2f6a8a');
    box(scene, 2.8, 0.06, 1.5, tbl, 9.8, 0.72, -1.2);
    box(scene, 2.8, 0.01, 0.03, toon('#f6f2ea'), 9.8, 0.78, -1.2, false);
    box(scene, 0.03, 0.16, 1.55, toon('#f6f2ea'), 9.8, 0.78, -1.2, false);
    for (const [x, z] of [[8.6, -1.8], [11, -1.8], [8.6, -0.6], [11, -0.6]]) box(scene, 0.06, 0.72, 0.06, toon('#2a2a30'), x, 0, z);
    ball.position.set(9.2, 1.25, -1.0);
    ball.visible = false;
    scene.add(ball);
    nav.rect(8.4, -1.95, 11.2, -0.45, 0.15);
    spots.pingpong = [{ x: 7.95, z: -1.2, rot: Math.PI / 2 }, { x: 11.65, z: -1.2, rot: -Math.PI / 2 }];
  }
  return { ball };
}

function wallDecor(scene: THREE.Scene, theme: Theme, lampMats: THREE.MeshBasicMaterial[]) {
  const minX = ROOM.minX, minZ = ROOM.minZ;
  const mkCanvas = (w: number, h: number) => {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const t = new THREE.CanvasTexture(c);
    t.magFilter = t.minFilter = THREE.NearestFilter;
    t.colorSpace = THREE.SRGBColorSpace;
    return { c, g: c.getContext('2d')!, t };
  };

  const wb = mkCanvas(64, 36);
  const whiteboard = (runs: number, hist: number[]) => {
    const { g, t } = wb;
    g.fillStyle = '#f6f4ee';
    g.fillRect(0, 0, 64, 36);
    g.fillStyle = '#2a4a8a';
    g.font = '8px "Silkscreen"';
    g.fillText(S.boardToday, 3, 8);
    g.fillStyle = '#c9423b';
    g.fillText(S.boardRuns(runs), 3, 17);
    g.fillStyle = '#2a8a5a';
    const max = Math.max(1, ...hist);
    hist.slice(-14).forEach((v, i) => {
      const bh = Math.max(1, Math.round((v / max) * 12));
      g.fillRect(4 + i * 3, 36 - 3 - bh, 2, bh);
    });
    g.fillStyle = '#ffe07a';
    g.fillRect(48, 3, 12, 10);
    g.fillStyle = '#ff9fb8';
    g.fillRect(50, 15, 11, 9);
    t.needsUpdate = true;
  };
  if (!theme.djCentral) {
    const board = new THREE.Mesh(new THREE.PlaneGeometry(2.0, 1.12), toon('#ffffff', { map: wb.t }));
    board.position.set(-1.75, 1.75, minZ + 0.03);
    scene.add(board);
    box(scene, 2.1, 1.22, 0.04, toon('#b8b8c0'), -1.75, 1.14, minZ + 0.01);
    box(scene, 2.0, 0.05, 0.12, toon('#9a9aa2'), -1.75, 1.13, minZ + 0.08);
  }

  // cork pinboard between the boss-office glass and the living wall, ~40 texels per metre like the rest
  const pinW = 2.3, pinH = 1.45, pinZ = -2.65, pinY = 1.72;
  const pb = mkCanvas(92, 58);
  const pinMesh = new THREE.Mesh(new THREE.PlaneGeometry(pinW, pinH), toon('#ffffff', { map: pb.t }));
  pinMesh.position.set(minX + 0.05, pinY, pinZ);
  pinMesh.rotation.y = Math.PI / 2;
  scene.add(pinMesh);
  box(scene, 0.04, pinH + 0.06, pinW + 0.06, toon('#5a3d26'), minX + 0.02, pinY - pinH / 2 - 0.03, pinZ);
  const pinboard = { mesh: pinMesh, g: pb.g, tex: pb.t, center: new THREE.Vector3(minX + 0.06, pinY, pinZ), width: pinW, height: pinH };

  if (theme.props.neon) {
    const n = theme.props.neon;
    const tex = canvasTexture(96, 20, (g, w, h) => {
      g.clearRect(0, 0, w, h);
      g.fillStyle = n.color;
      g.font = '500 15px "Bitcount Prop Single"';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(n.text, w / 2, h / 2 + 1);
    });
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, color: new THREE.Color(1.6, 1.6, 1.6), depthWrite: false });
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(3.0, 0.62), mat);
    sign.position.set(minX + 0.06, 2.12 + 0.86, 0.5);
    sign.rotation.y = Math.PI / 2;
    scene.add(fx(sign));
    lampMats.push(mat);
  }

  // analog wall clock showing the dashboard's time
  const clockG = new THREE.Group();
  clockG.position.set(-1.75, 2.75, minZ + 0.06);
  scene.add(clockG);
  const face = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.05, 16), toon('#f6f2ea'));
  face.rotation.x = Math.PI / 2;
  clockG.add(face);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.03, 4, 16), toon('#2a2a30'));
  clockG.add(rim);
  const hand = (len: number, w: number, color: string) => {
    const p = new THREE.Group();
    p.position.z = 0.04;
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, len, 0.02), toon(color));
    m.position.y = len / 2;
    p.add(m);
    clockG.add(p);
    return p;
  };
  const hour = hand(0.15, 0.04, '#2a2a30');
  const minute = hand(0.24, 0.025, '#c9423b');

  return { whiteboard, pinboard, clock: { hour, minute } };
}

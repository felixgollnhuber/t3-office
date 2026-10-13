import * as THREE from 'three';
import '@fontsource/pixelify-sans/700.css';
import '@fontsource/silkscreen/400.css';
import '@fontsource/vt323/400.css';
import './style.css';
import { PixelPipeline } from './pixel';
import { buildOffice } from './office';
import { THEMES } from './themes';
import { applyHudTheme, Hud, Tags } from './hud';
import { Clock } from './time';
import { DayCycle } from './sky';
import { DemoSource, type AgentSource } from './source';
import { TEAMS } from './data';
import { detectT3, T3Source, T3Usage } from './t3source';
import { Sfx } from './audio';
import { World } from './workers';
import { Player } from './player';
import { Weather } from './weather';
import { DemoUsage, type UsageSource } from './usage';
import { QuotaWall } from './quota';
import { Rain } from './rain';
import { BoardSource, paintPinboard, PinboardView } from './board';
import { AgentInspector } from './agentview';
import { CostView } from './costview';
import type { Desk } from './desk';
import type { Provider } from './data';
import { S as TXT } from './i18n/app';
import { phone, settings, type ThemeId } from './settings';
import { SettingsMenu } from './settingsmenu';
import { resolveSeason, type SeasonKind } from './seasons';
import { Director, stage, type CameraRig, type XZ } from './director';
import { clickables, hintOf, pickClickable, type Clickable } from './interact';
import { showDemoBar } from './demobar';

async function main() {
  const params = new URLSearchParams(location.search);
  const ZOOM = Number(params.get('zoom') ?? 11);
  // settings come from the store; URL parameters (?theme=, ?lat=, ?px= …) win there for this page view
  const theme = THEMES.find((t) => t.id === settings.get('theme')) ?? THEMES[0];
  // art pixel size in device pixels: 3 on retina (a bit finer than before), 2 on 1x screens
  const pixelFor = (dpr: number) => (settings.get('pixel') ? Math.max(1, Math.round(settings.get('pixel') * dpr)) : Math.max(2, Math.round(1.5 * dpr)));

  await Promise.all([
    document.fonts.load('500 16px "Bitcount Prop Single"'),
    document.fonts.load('700 16px "Bitcount Prop Single"'),
    document.fonts.load('700 16px "Pixelify Sans"'),
    document.fonts.load('8px "Silkscreen"'),
    document.fonts.load('16px "VT323"'),
  ]);

  applyHudTheme(theme);

  const clock = new Clock(params);
  const want = params.get('source');
  let t3: T3Source | null = null;
  if (want === 't3' || (want !== 'demo' && (await detectT3()))) {
    try {
      t3 = await T3Source.connect({ hours: Number(params.get('hours') ?? 12) });
    } catch (e) {
      console.warn('T3 not readable, using demo data', e);
    }
  }
  const source: AgentSource = t3 ?? new DemoSource(Number(params.get('sim') ?? 1), Number(params.get('agents') ?? 15));
  const syncTeams = () => {
    if (!t3) return;
    const named = new Map(t3.teams().map((t) => [t.index, t.short]));
    TEAMS.forEach((team, i) => (team.name = named.get(i) ?? ''));
  };
  syncTeams();
  let teamSyncT = 0;
  const sfx = new Sfx();
  const weather = new Weather(settings.get('weather'), settings.get('lat'), settings.get('lon'));
  const usage: UsageSource = t3 ? await T3Usage.connect() : new DemoUsage();

  const canvas = document.getElementById('scene') as HTMLCanvasElement;
  const pipe = new PixelPipeline(canvas, pixelFor(window.devicePixelRatio || 1), theme.post);
  const office = buildOffice(theme);
  const cycle = new DayCycle(office.scene, office.sun, office.hemi, office.viewTex, pipe, settings.get('lat'), settings.get('lon'));
  const rain = office.viewTex ? new Rain(office.scene) : null;
  for (const m of office.lamps.mats) cycle.addLamp(m, 2.2, 0.4);
  for (const m of office.lamps.dim) cycle.addLamp(m, 0.2, 1);

  let hud: Hud | undefined;
  const player = new Player(sfx, () => hud!.ytHost());
  const world = new World(office, theme, source, cycle, sfx, player, weather);
  hud = new Hud(theme, sfx, clock, source, player, weather, () => menu.open());
  const wall = new QuotaWall(office, usage, () => focusOn(spots[0]));
  if (t3) wall.live = 'live · T3';
  const board = new BoardSource(t3 ? 'live' : 'demo');
  const pinView = new PinboardView(board);
  const paintBoard = () => {
    paintPinboard(office.pinboard.g, pinView.current);
    office.pinboard.tex.needsUpdate = true;
  };
  paintBoard();
  if (import.meta.env.DEV) Object.assign(window, { __world: world, __source: source, __player: player, __weather: weather, __board: board, __sfx: sfx, __office: office, __cycle: cycle, __rain: rain, __focusAgent: (id: string) => focusAgent(id) });

  const isBoss = (id: string) => !!source.boss?.() && source.boss!()!.id === id;
  const openThread = (id: string) => {
    const t = source.threads().find((x) => x.id === id) ?? (isBoss(id) ? source.boss!()! : undefined);
    if (t && t3?.openThread(id)) hud!.toast(TXT.opening(t.title));
    else if (t) hud!.toast(TXT.openDemo(t.name, t.title));
  };
  // the season the office is decorated for; follows the (possibly time-travelled) date and the hemisphere
  let season: SeasonKind = 'none';
  const syncSeason = () => {
    const next = resolveSeason(settings.get('seasons'), clock.now(), settings.get('lat'));
    if (next === season) return;
    season = next;
    // `season` is being added to Office; once it is there this cast can go
    (office as { season?: { set(kind: SeasonKind): void } }).season?.set(season);
  };
  // created before the cost view: both listen for keys in the capture phase and the menu has to come first
  const menu = new SettingsMenu({
    themes: THEMES.map((t) => ({ id: t.id as ThemeId, label: t.label })),
    music: { playing: () => player.playing, toggle: () => player.toggle(), onChange: (fn) => player.onChange(fn) },
    weather,
    season: () => season,
    blip: () => {
      sfx.unlock();
      sfx.play('key');
    },
  });
  const costs = new CostView(t3 ? 'live' : 'demo', (id, url, title) => {
    if (t3?.openThread(id)) hud!.toast(TXT.opening(title));
    else if (url) {
      window.open(url, '_blank', 'noopener');
      hud!.toast(TXT.opening(title));
    } else hud!.toast(t3 ? TXT.goneInT3(title) : TXT.openDemoTitle(title));
  });
  document.querySelector('#hud .receipt')!.addEventListener('click', () => {
    sfx.unlock();
    sfx.play('coin');
    costs.open();
  });
  const open = (id: string) => {
    if (id === 'boss') return hud!.toast(TXT.bossBusy);
    if (world.workers.has(id) || isBoss(id)) focusAgent(id);
  };
  const inspector = new AgentInspector(source, world, () => clock.now());
  const tagMode = () => (settings.get('tags') === 'auto' ? (theme.tagMode ?? 'full') : (settings.get('tags') as 'full' | 'quiet'));
  const tags = new Tags(tagMode(), (id) => {
    noteClick({ kind: 'agent', id, name: '' });
    open(id);
  });

  // camera: iso view; drag pans like a map, right-drag or shift-drag turns it a little
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 200);
  const baseTarget = new THREE.Vector3(3.8, 1.5, 0.6);
  const target = baseTarget.clone();
  const view = { az: 45, el: 34, px: 0, py: 0 };
  const goal = { ...view };
  const camRight = new THREE.Vector3(), camUp = new THREE.Vector3();
  let zoomF = 1, zoomTarget = 1;
  // things on the walls you can click: the camera flies in front of them and an interactive close-up opens
  interface Spot {
    id: string;
    hint: string;
    center: THREE.Vector3;
    normal: THREE.Vector3;
    width: number;
    height: number;
    meshes: THREE.Object3D[];
    render(el: HTMLElement): void;
    click(el: HTMLElement, t: HTMLElement): boolean;
    leave?(): void;
    /** moving targets (agents) compute their camera every frame */
    pose?(): { az: number; el: number; target: THREE.Vector3; half: number; clip?: number };
    tick?(el: HTMLElement, dt: number): void;
    /** the close-up docks at the side instead of covering the object */
    dock?: boolean;
  }
  const S = office.wallScreen;
  const spots: Spot[] = [
    {
      id: 'quota',
      hint: TXT.hintQuota,
      center: S.tl.clone().addScaledVector(S.right, 0.5).addScaledVector(S.down, 0.5),
      normal: new THREE.Vector3(1, 0, 0),
      width: S.right.length(),
      height: S.down.length(),
      meshes: [S.mesh],
      render: (el) => {
        wall.renderView(el);
        wall.hidden = true;
      },
      click: (el, t) => wall.click(el, t),
      leave: () => {
        wall.view = null;
        wall.hidden = false;
      },
    },
    {
      id: 'board',
      hint: TXT.hintBoard,
      center: office.pinboard.center,
      normal: new THREE.Vector3(1, 0, 0),
      width: office.pinboard.width,
      height: office.pinboard.height,
      meshes: [office.pinboard.mesh],
      render: (el) => pinView.render(el),
      click: (el, t) => {
        const close = pinView.click(el, t);
        paintBoard();
        return close;
      },
    },
  ];
  let agentId = '';
  /** on an upright phone the agent sheet comes up from the bottom instead of docking at the side (style.css) */
  const sheetBelow = () => phone && window.innerHeight >= window.innerWidth;
  let previewDesk: Desk | null = null;
  let agentT = 0;
  const shot = new THREE.Vector3();
  const agentSpot: Spot = {
    id: 'agent',
    hint: '',
    center: new THREE.Vector3(),
    normal: new THREE.Vector3(1, 0, 0),
    width: 1,
    height: 1,
    meshes: [],
    dock: true,
    pose: () => {
      const w = inspector.worker(agentId);
      const aspect = window.innerWidth / window.innerHeight;
      const p = w ? w.ch.root.position : isBoss(agentId) ? office.boss.ch.root.position : shot;
      let az = view.az, el = view.el, half = 2.3;
      // someone walking keeps the furniture around them; only a seated close-up cuts through the room
      let clip = 12;
      shot.set(p.x, 0.95, p.z);
      if (w && w.mode === 'seated' && w.desk) {
        // over the shoulder, so the monitor is readable
        const { p: sp, n } = w.desk.screenPose();
        az = THREE.MathUtils.radToDeg(Math.atan2(n.x, n.z)) + 42;
        el = 32;
        half = 1.3;
        clip = 1.8;
        shot.set(p.x, 0, p.z).lerp(sp, 0.85);
        shot.y = sp.y - 0.05;
      }
      const a = THREE.MathUtils.degToRad(az);
      if (sheetBelow()) {
        // keep the person above the sheet (the bottom 56% of a phone held upright), with as much room around them as
        // on a wide screen
        half *= 1.7;
        const e = THREE.MathUtils.degToRad(el);
        shot.addScaledVector(new THREE.Vector3(-Math.sin(e) * Math.sin(a), Math.cos(e), -Math.sin(e) * Math.cos(a)), -half * 0.56);
      } else {
        // keep the person left of the docked sheet, which takes half of a phone on its side
        shot.addScaledVector(new THREE.Vector3(Math.cos(a), 0, -Math.sin(a)), half * aspect * (phone ? 0.5 : 0.3));
      }
      return { az, el, target: shot, half, clip };
    },
    render: (el) => inspector.render(el, agentId),
    click: (el, t) => {
      const a = t.closest<HTMLElement>('[data-a]')?.dataset.a;
      const other = t.closest<HTMLElement>('[data-agent]')?.dataset.agent;
      if (a === 'close') return true;
      if (a === 'open') openThread(agentId);
      if (other && (world.workers.has(other) || isBoss(other))) {
        previewDesk?.preview(null);
        previewDesk = null;
        agentId = other;
        inspector.render(el, agentId);
      }
      return false;
    },
    tick: (el, dt) => {
      const w = inspector.worker(agentId);
      if (!isBoss(agentId) && (!w || w.mode === 'gone')) return closeFocus();
      const desk = w && w.mode === 'seated' && w.desk ? w.desk : null;
      if (desk !== previewDesk) {
        previewDesk?.preview(null);
        desk?.preview(inspector.tex);
        previewDesk = desk;
      }
      if (desk) inspector.paint(agentId, dt);
      agentT += dt;
      if (agentT > 0.5) {
        agentT = 0;
        inspector.render(el, agentId);
      }
    },
    leave: () => {
      previewDesk?.preview(null);
      previewDesk = null;
    },
  };
  const focusAgent = (id: string) => {
    if (fly.spot === agentSpot) {
      previewDesk?.preview(null);
      previewDesk = null;
      agentId = id;
      inspector.render(focusEl, id);
      return;
    }
    agentId = id;
    focusOn(agentSpot);
  };
  const focusRoot = document.getElementById('focus')!;
  const focusEl = focusRoot.querySelector<HTMLElement>('.focus-view')!;
  const hintEl = focusRoot.querySelector<HTMLElement>('.spot-hint')!;
  const fly = { spot: null as Spot | null, k: 0, dir: 0, shown: false };
  const FLY_EL = 7;
  const spotPose = (sp: Spot) => {
    if (sp.pose) return sp.pose();
    const az = THREE.MathUtils.radToDeg(Math.atan2(sp.normal.x, sp.normal.z));
    const aspect = window.innerWidth / window.innerHeight;
    const half = Math.max((sp.height * Math.cos(THREE.MathUtils.degToRad(FLY_EL))) / (2 * 0.8), sp.width / (2 * 0.9 * aspect));
    return { az, el: FLY_EL, target: sp.center, half };
  };
  const focusOn = (sp: Spot) => {
    if (fly.spot === sp && fly.dir >= 0) return;
    if (fly.spot && fly.spot !== sp) closeFocus(true);
    fly.spot = sp;
    fly.dir = 1;
    setHover(null);
    document.body.classList.add('focused');
    sfx.play('door');
  };
  const closeFocus = (instant = false) => {
    if (!fly.spot) return;
    fly.dir = -1;
    fly.shown = false;
    focusEl.classList.remove('on', 'dock');
    fly.spot.leave?.();
    document.body.classList.remove('focused');
    if (instant) fly.k = 0;
  };
  focusEl.addEventListener('click', (ev) => {
    ev.stopPropagation();
    if (fly.spot && fly.spot.click(focusEl, ev.target as HTMLElement)) closeFocus();
  });
  board.onChange(() => {
    paintBoard();
    if (fly.spot?.id === 'board' && fly.shown) pinView.render(focusEl);
  });
  let boardCycleT = 0;

  const smooth = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
  const placeCamera = () => {
    const s = fly.spot ? smooth(fly.k) : 0;
    const azN = THREE.MathUtils.degToRad(view.az), elN = THREE.MathUtils.degToRad(view.el);
    camRight.set(Math.cos(azN), 0, -Math.sin(azN));
    camUp.set(-Math.sin(elN) * Math.sin(azN), Math.cos(elN), -Math.sin(elN) * Math.cos(azN));
    target.copy(baseTarget).addScaledVector(camRight, view.px).addScaledVector(camUp, view.py);
    let azD = view.az, elD = view.el, half = ZOOM * zoomF;
    let clip = fly.spot?.dock ? 1.8 : 0.9;
    if (s > 0) {
      const f = spotPose(fly.spot!);
      clip = f.clip ?? clip;
      const fAz = view.az + ((((f.az - view.az) % 360) + 540) % 360) - 180;
      azD = THREE.MathUtils.lerp(view.az, fAz, s);
      elD = THREE.MathUtils.lerp(view.el, f.el, s);
      target.lerp(f.target, s);
      half = Math.exp(THREE.MathUtils.lerp(Math.log(half), Math.log(f.half), s));
    }
    // flying in, everything between the camera and the wall gets clipped away
    camera.near = 0.1 + s * s * (60 - 0.1 - clip);
    const az = THREE.MathUtils.degToRad(azD), el = THREE.MathUtils.degToRad(elD);
    camera.position.set(target.x + Math.sin(az) * Math.cos(el) * 60, target.y + Math.sin(el) * 60, target.z + Math.cos(az) * Math.cos(el) * 60);
    camera.lookAt(target);
    const w = window.innerWidth, h = window.innerHeight;
    camera.left = -half * (w / h);
    camera.right = half * (w / h);
    camera.top = half;
    camera.bottom = -half;
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
    // keep team boards at exactly one texel per art pixel
    const ppu = pipe.height / (2 * half);
    for (const s of office.signs) {
      s.mesh.scale.set(s.texW / ppu, s.texH / ppu, 1);
      s.mesh.quaternion.copy(camera.quaternion);
    }
  };

  const resize = () => {
    const dpr = window.devicePixelRatio || 1;
    pipe.pixelSize = pixelFor(dpr);
    pipe.setSize(window.innerWidth, window.innerHeight, dpr);
    placeCamera();
  };
  window.addEventListener('resize', resize);
  resize();

  window.addEventListener(
    'wheel',
    (ev) => {
      if (fly.spot || (ev.target as HTMLElement).closest('.panel, .focus-view')) return;
      // the director may have zoomed in further than the wheel goes: start from there instead of jumping back
      zoomTarget = THREE.MathUtils.clamp(zoomTarget * (1 + Math.sign(ev.deltaY) * 0.04), Math.min(0.82, zoomTarget), 1.12);
    },
    { passive: true },
  );
  const PAN = { x: 9, y: 5 }, AZ = 18, EL = [24, 46] as const;
  const rubber = (v: number, lim: number) => (Math.abs(v) <= lim ? v : Math.sign(v) * (lim + (Math.abs(v) - lim) * 0.25));
  let drag: { id: number; x: number; y: number; moved: number; turn: boolean; lim: { x: number; y: number } } | null = null;

  // what a click hit: a person, a wall display (spot) or a registered clickable (src/interact.ts)
  type Hit = { kind: 'agent'; id: string; name: string } | { kind: 'spot'; sp: Spot } | { kind: 'thing'; c: Clickable };
  const lastDown = { x: 0, y: 0 };
  let lastClick: { p: Hit | null; t: number; x: number; y: number } | null = null;
  const noteClick = (p: Hit | null) => {
    lastClick = { p, t: performance.now(), x: lastDown.x, y: lastDown.y };
  };
  /** what the previous click hit, if this event is the second click of a double-click on the same place */
  const repeatOf = (ev: MouseEvent) => (lastClick && performance.now() - lastClick.t < 500 && Math.hypot(ev.clientX - lastClick.x, ev.clientY - lastClick.y) < 12 ? lastClick.p : null);
  window.addEventListener('contextmenu', (ev) => ev.preventDefault());
  window.addEventListener('pointerdown', (ev) => {
    sfx.unlock();
    const el = ev.target as HTMLElement;
    const again = repeatOf(ev);
    lastDown.x = ev.clientX;
    lastDown.y = ev.clientY;
    if (fly.spot) {
      if (el.closest('.focus-view')) return;
      if (again?.kind === 'agent') {
        // second click of a double-click on a person: the thread opens in T3, the sheet stays (or comes back)
        lastClick = null;
        openThread(again.id);
        open(again.id);
        return;
      }
      noteClick(pickAt(ev.clientX, ev.clientY, true));
      closeFocus();
      return;
    }
    if (el.closest('.panel, .quota-wall')) return;
    // a pan the director left outside the usual limits stays reachable for this drag
    const lim = { x: Math.max(PAN.x, Math.abs(goal.px)), y: Math.max(PAN.y, Math.abs(goal.py)) };
    drag = { id: ev.pointerId, x: ev.clientX, y: ev.clientY, moved: 0, turn: ev.button === 2 || ev.shiftKey, lim };
    document.body.classList.add('grabbing');
  });

  // director camera: moves by itself and cuts to what happens; any input hands the camera back for a while
  const HOME = { az: 45, el: 34 };
  const homeView = () => {
    Object.assign(goal, { ...HOME, px: 0, py: 0 });
    zoomTarget = 1;
  };
  /** the height the camera aims at: about the chest of a person */
  const LOOK_Y = 1;
  const basis = (azDeg: number, elDeg: number) => {
    const az = THREE.MathUtils.degToRad(azDeg), el = THREE.MathUtils.degToRad(elDeg);
    return {
      right: new THREE.Vector3(Math.cos(az), 0, -Math.sin(az)),
      up: new THREE.Vector3(-Math.sin(el) * Math.sin(az), Math.cos(el), -Math.sin(el) * Math.cos(az)),
      back: new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)),
    };
  };
  /** the point in the middle of the picture for a pan and a pair of angles */
  const lookAt = (px: number, py: number, az: number, el: number): XZ => {
    const b = basis(az, el);
    const t = baseTarget.clone().addScaledVector(b.right, px).addScaledVector(b.up, py);
    t.addScaledVector(b.back, (LOOK_Y - t.y) / b.back.y);
    return { x: t.x, z: t.z };
  };
  const rig: CameraRig = {
    pose: () => ({ ...lookAt(goal.px, goal.py, goal.az, goal.el), az: goal.az, el: goal.el, zoom: zoomTarget }),
    homePose: () => ({ ...lookAt(0, 0, HOME.az, HOME.el), ...HOME, zoom: 1 }),
    apply: (p, cut) => {
      const b = basis(p.az, p.el);
      const v = new THREE.Vector3(p.x, LOOK_Y, p.z).sub(baseTarget);
      Object.assign(goal, { az: p.az, el: p.el, px: v.dot(b.right), py: v.dot(b.up) });
      zoomTarget = p.zoom;
      if (cut) {
        Object.assign(view, goal);
        zoomF = zoomTarget;
      }
    },
    half: () => ZOOM,
    busy: () => !!fly.spot || !!drag || menu.isOpen || costs.isOpen,
  };
  const afoot = (id: string) => () => {
    const w = world.workers.get(id);
    return w && w.mode !== 'gone' && !w.hidden ? w.ch.root.position : null;
  };
  const director = new Director(rig, () => {
    // with nothing else going on, walk along with somebody who is away from their desk
    const out = [...world.workers.values()].filter((w) => w.mode !== 'seated' && w.mode !== 'gone' && !w.hidden);
    return out.length ? afoot(out[Math.floor(Math.random() * out.length)].thread.id) : null;
  });
  stage.director = director;
  if (import.meta.env.DEV) Object.assign(window, { __director: director, __camera: camera, __settings: settings, __clickables: clickables, __season: () => season });
  source.subscribe((e) => {
    if (!director.enabled) return;
    if (e.type === 'add') {
      // newcomers walk in through the door; until they are in the room the door itself is the picture
      const at = afoot(e.thread.id);
      director.follow(() => at() ?? office.doors.exit.front, e.thread.parentId ? 1 : 2, 6, 'arrive');
    } else if (e.type === 'status' && e.to === 'failed') director.follow(afoot(e.id), 4, 6, 'failed');
    else if (e.type === 'status' && e.to === 'waiting') director.follow(afoot(e.id), 3, 6, 'waiting');
    else if (e.type === 'status' && e.to === 'completed') director.follow(afoot(e.id), 2, 4, 'completed');
    else if (e.type === 'order') director.follow(() => office.boss.ch.root.position, 3, 6, 'order');
  });
  for (const ev of ['pointerdown', 'wheel', 'keydown'] as const) window.addEventListener(ev, () => director.pause(20), true);

  const ray = new THREE.Raycaster();
  /** What is under the cursor: people, registered clickables and wall displays; the nearest one wins. */
  const pickAt = (x: number, y: number, fuzzy: boolean): Hit | null => {
    ray.setFromCamera(new THREE.Vector2((x / window.innerWidth) * 2 - 1, -(y / window.innerHeight) * 2 + 1), camera);
    const best = { hit: null as Hit | null, d: Infinity };
    const take = (at: { distance: number } | null | undefined, hit: () => Hit) => {
      if (!at || at.distance >= best.d) return;
      best.d = at.distance;
      best.hit = hit();
    };
    for (const sp of spots) take(ray.intersectObjects(sp.meshes, false)[0], () => ({ kind: 'spot', sp }));
    const thing = pickClickable(ray);
    take(thing, () => ({ kind: 'thing', c: thing!.c }));
    for (const [id, w] of world.workers) {
      if (w.mode === 'gone' || w.hidden || !w.ch.root.visible) continue;
      take(ray.intersectObject(w.ch.root, true)[0], () => ({ kind: 'agent', id, name: w.thread.name }));
    }
    const chief = source.boss?.() ?? null;
    if (office.boss.ch.root.visible) take(ray.intersectObject(office.boss.ch.root, true)[0], () => ({ kind: 'agent', id: chief?.id ?? 'boss', name: chief ? chief.title.slice(0, 18) : '' }));
    if (best.hit || !fuzzy) return best.hit;
    // a click next to somebody still means them
    const near = tags.pick(x, y);
    return near ? { kind: 'agent', id: near.id, name: near.name } : null;
  };
  let hovered: Clickable | null = null;
  let hoverT = 0;
  const setHover = (hit: Hit | null, x = 0, y = 0) => {
    const thing = hit?.kind === 'thing' ? hit.c : null;
    if (thing !== hovered) {
      hovered?.onHover?.(false);
      thing?.onHover?.(true);
      hovered = thing;
    }
    const text = !hit ? '' : hit.kind === 'spot' ? hit.sp.hint : hit.kind === 'thing' ? hintOf(hit.c) : hit.name ? TXT.hintAgent(hit.name) : '';
    hintEl.classList.toggle('on', !!text);
    document.body.classList.toggle('hot', !!hit);
    if (!text) return;
    hintEl.textContent = text;
    hintEl.style.transform = `translate(${Math.max(4, Math.min(x + 14, window.innerWidth - hintEl.offsetWidth - 8))}px, ${Math.min(y + 12, window.innerHeight - hintEl.offsetHeight - 8)}px)`;
  };
  window.addEventListener('pointermove', (ev) => {
    if (!drag && !fly.spot && ev.timeStamp - hoverT > 30) {
      hoverT = ev.timeStamp;
      const el = ev.target as HTMLElement;
      setHover(el.closest('.quota-wall') ? { kind: 'spot', sp: spots[0] } : el.closest('.panel') ? null : pickAt(ev.clientX, ev.clientY, false), ev.clientX, ev.clientY);
    }
    if (!drag || ev.pointerId !== drag.id) return;
    const dx = ev.clientX - drag.x, dy = ev.clientY - drag.y;
    drag.x = ev.clientX;
    drag.y = ev.clientY;
    drag.moved += Math.abs(dx) + Math.abs(dy);
    if (drag.turn) {
      goal.az = rubber(goal.az - 45 - dx * 0.12, AZ) + 45;
      goal.el = THREE.MathUtils.clamp(goal.el + dy * 0.08, EL[0], EL[1]);
    } else {
      // the floor stays under the cursor
      const unit = (2 * ZOOM * zoomF) / window.innerHeight;
      goal.px = rubber(goal.px - dx * unit, drag.lim.x);
      goal.py = rubber(goal.py + dy * unit, drag.lim.y);
    }
  });
  const endDrag = (ev: PointerEvent) => {
    if (!drag || ev.pointerId !== drag.id) return;
    const click = drag.moved < 5 && !drag.turn;
    const { lim } = drag;
    drag = null;
    document.body.classList.remove('grabbing');
    goal.px = THREE.MathUtils.clamp(goal.px, -lim.x, lim.x);
    goal.py = THREE.MathUtils.clamp(goal.py, -lim.y, lim.y);
    goal.az = THREE.MathUtils.clamp(goal.az, 45 - AZ, 45 + AZ);
    if (!click) return;
    const again = repeatOf(ev);
    const hit = pickAt(ev.clientX, ev.clientY, true);
    noteClick(hit);
    if (!hit) return;
    if (hit.kind === 'agent') open(hit.id);
    else if (hit.kind === 'spot') focusOn(hit.sp);
    // the second click of a double-click goes to onDouble, if the thing has one
    else if (again?.kind === 'thing' && again.c === hit.c && hit.c.onDouble) hit.c.onDouble();
    else hit.c.onClick();
  };
  window.addEventListener('pointerup', endDrag);
  window.addEventListener('pointercancel', endDrag);
  window.addEventListener('dblclick', (ev) => {
    if (fly.spot || (ev.target as HTMLElement).closest('.panel, .quota-wall, .focus-view')) return;
    // a double-click on somebody or something is theirs; only the empty floor resets the camera
    if (lastClick?.p && performance.now() - lastClick.t < 700) return;
    homeView();
  });
  window.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape') return closeFocus();
    if (ev.key === 'p') return fly.spot ? closeFocus() : focusOn(spots[1]);
    if (ev.key === 'k') return fly.spot ? closeFocus() : focusOn(spots[0]);
    if (ev.key === '[') clock.shift(-30);
    else if (ev.key === ']') clock.shift(30);
    else if (ev.key === '\\') clock.reset();
    else if (ev.key === 'm') player.toggle();
    else if (ev.key === 'n') player.next(1);
    else if (ev.key === 'l') player.like();
    else if (ev.key === 's') settings.set('sounds', !settings.get('sounds'));
    else if (ev.key === 'w') settings.set('weather', weather.nextMode());
    else if (ev.key === 'c') settings.set('director', !settings.get('director'));
    else if (ev.key === '0') homeView();
    else return;
    sfx.unlock();
  });

  // settings that apply at once (language and theme reload the page instead)
  const applyVolume = () => {
    sfx.setVolume(settings.get('soundVolume'), settings.get('musicVolume'));
    player.setVolume(settings.get('musicVolume'));
  };
  applyVolume();
  settings.on('soundVolume', applyVolume);
  settings.on('musicVolume', applyVolume);
  settings.on('sounds', (on) => {
    sfx.setSounds(on);
    hud!.renderDeck();
  });
  settings.on('weather', (mode) => {
    weather.setMode(mode);
    hud!.renderWeather();
  });
  const moved = () => {
    cycle.setLocation(settings.get('lat'), settings.get('lon'));
    weather.setLocation(settings.get('lat'), settings.get('lon'));
    syncSeason();
  };
  settings.on('lat', moved);
  settings.on('lon', moved);
  settings.on('seasons', syncSeason);
  settings.on('tags', () => tags.setMode(tagMode()));
  settings.on('pixel', resize);
  document.body.classList.toggle('phone', phone);
  if (phone && import.meta.env.VITE_DEMO_REPO) showDemoBar(import.meta.env.VITE_DEMO_REPO);
  document.body.classList.toggle('kiosk', settings.get('kiosk'));
  settings.on('kiosk', (on) => {
    document.body.classList.toggle('kiosk', on);
    if (on) hud!.toast(TXT.kioskOn);
  });
  director.setEnabled(settings.get('director'));
  settings.on('director', (on) => {
    director.setEnabled(on);
    hud!.toast(on ? TXT.directorOn : TXT.directorOff);
  });
  syncSeason();

  let last = performance.now();
  let hudT = 1;
  let boardT = 1;
  let quotaT = 0;
  let coinAcc = source.totals().cost;
  const boardHist: number[] = [];
  let frames = 0;
  const people: THREE.Box3[] = [];

  const loop = () => {
    const t = performance.now();
    const dt = Math.min(0.05, (t - last) / 1000);
    last = t;
    const now = clock.now();

    director.update(dt);
    const ease = 1 - Math.exp(-dt * (drag ? 22 : 9));
    view.az += (goal.az - view.az) * ease;
    view.el += (goal.el - view.el) * ease;
    view.px += (goal.px - view.px) * ease;
    view.py += (goal.py - view.py) * ease;
    zoomF += (zoomTarget - zoomF) * (1 - Math.exp(-dt * 6));
    if (fly.spot) {
      fly.k = THREE.MathUtils.clamp(fly.k + (fly.dir * dt) / 0.85, 0, 1);
      if (fly.k === 0 && fly.dir < 0) fly.spot = null;
    }
    placeCamera();
    if (fly.spot && fly.k === 1 && fly.spot.dock) {
      if (!fly.shown) {
        fly.shown = true;
        focusEl.removeAttribute('style');
        fly.spot.render(focusEl);
        focusEl.classList.add('on', 'dock');
      }
      fly.spot.tick?.(focusEl, dt);
    } else if (fly.spot && fly.k === 1) {
      const sp = fly.spot;
      // a phone is too narrow to read a wall display: there its close-up takes the whole screen (style.css)
      if (!phone) {
        const az = Math.atan2(sp.normal.x, sp.normal.z);
        const right = new THREE.Vector3(Math.cos(az), 0, -Math.sin(az)).multiplyScalar(sp.width / 2);
        const up = new THREE.Vector3(0, sp.height / 2, 0);
        const a = sp.center.clone().sub(right).add(up).project(camera);
        const b = sp.center.clone().add(right).sub(up).project(camera);
        const W = window.innerWidth, Hh = window.innerHeight;
        const x0 = (Math.min(a.x, b.x) * 0.5 + 0.5) * W, x1 = (Math.max(a.x, b.x) * 0.5 + 0.5) * W;
        const y0 = (-Math.max(a.y, b.y) * 0.5 + 0.5) * Hh, y1 = (-Math.min(a.y, b.y) * 0.5 + 0.5) * Hh;
        Object.assign(focusEl.style, { left: `${x0}px`, top: `${y0}px`, width: `${x1 - x0}px`, height: `${y1 - y0}px` });
      }
      if (!fly.shown) {
        fly.shown = true;
        focusEl.classList.remove('dock', 'agent-view');
        sp.render(focusEl);
        focusEl.classList.add('on');
      }
    }
    boardCycleT += dt;
    if (boardCycleT > 25 && !fly.spot && board.data.projects.length > 1) {
      boardCycleT = 0;
      pinView.project = (pinView.project + 1) % board.data.projects.length;
      paintBoard();
    }
    board.update(dt);

    source.update(dt);
    weather.update(dt, now.getHours());
    cycle.weather.cloud = weather.cloud;
    cycle.weather.rain = weather.rain;
    cycle.weather.snow = weather.snow;
    cycle.weather.snowCover = rain?.snowCover ?? 0;
    cycle.weather.flash = weather.flash;
    cycle.ambience = world.ambience;
    cycle.update(now);
    sfx.setRain(weather.rain, weather.snow);
    if ((teamSyncT += dt) > 5) {
      teamSyncT = 0;
      syncTeams();
    }
    rain?.update(dt, weather.rain, weather.flash, cycle.darkness, weather.snow);
    player.update();
    world.update(dt, now);
    office.tipJar.update(dt);
    office.fx.update(dt);

    const h = now.getHours() % 12, m = now.getMinutes() + now.getSeconds() / 60;
    office.clock.minute.rotation.z = -(m / 60) * Math.PI * 2;
    office.clock.hour.rotation.z = -((h + m / 60) / 12) * Math.PI * 2;

    const tot = source.totals();
    while (tot.cost - coinAcc >= 0.25) {
      coinAcc += 0.25;
      office.tipJar.drop();
      sfx.play('coin');
    }

    const threads = source.threads();
    boardT += dt;
    if (boardT > 2) {
      boardT = 0;
      const running = threads.filter((x) => x.status === 'running').length;
      boardHist.push(threads.filter((x) => x.status === 'running').reduce((s, x) => s + x.tps, 0));
      if (boardHist.length > 14) boardHist.shift();
      office.whiteboard(tot.runs, boardHist);
      office.coffeeDisplay(tot.cost);
    }

    const running: Record<Provider, number> = { claude: 0, codex: 0, cursor: 0, gemini: 0 };
    for (const x of threads) if (x.status === 'running') running[x.provider]++;
    usage.update(dt, running);
    world.setUsage(usage.groups());
    quotaT += dt;
    if (quotaT > 75) {
      quotaT = 0;
      const low = usage.groups().flatMap((g) => g.pools.map((p) => ({ g, p }))).find(({ p }) => p.left < 0.25);
      if (low) world.bossSay(TXT.quotaLow(low.g.label, low.p.label, Math.round(low.p.left * 100)));
    }

    const typing = threads.filter((x) => x.status === 'running').reduce((s, x) => s + 1 + x.tps / 60, 0);
    sfx.update(dt, typing * 1.4);

    pipe.render(office.scene, camera);
    const w = window.innerWidth, hh = window.innerHeight;
    tags.update([...world.anchors(), ...world.pets.anchors()], camera, w, hh);
    people.length = 0;
    world.occluders(people);
    wall.update(dt, camera, w, hh, people);
    hud!.pulse(world.beat, world.beatFrac);

    hudT += dt;
    if (hudT > 0.25) {
      hud!.update(hudT, now, world, source, cycle);
      hudT = 0;
      syncSeason();
      document.body.classList.toggle('night', cycle.lampLevel > 0.55);
    }

    if (++frames === 3) (window as unknown as { __ready: boolean }).__ready = true;
    requestAnimationFrame(loop);
  };
  loop();
}

main();

import * as THREE from 'three';
import { createCharacter, type Character, type Look, type Pose, type HairStyle, type Outfit } from './character';
import { Boss } from './boss';
import { LightShow } from './lightshow';
import { Desk } from './desk';
import { PROVIDERS, TEAMS } from './data';
import { PERSON, SKIN, ROOM, type Office, type Spot } from './office';
const ROOM_H = ROOM.h;
import { toon } from './materials';
import { steer, type P2 } from './nav';
import type { AgentSource, SourceEvent, Thread } from './source';
import type { Theme } from './themes';
import type { DayCycle } from './sky';
import type { Sfx } from './audio';
import type { Player } from './player';
import type { Weather } from './weather';
import { S } from './i18n/world';
import { settings } from './settings';
import { Life } from './life';
import { addClickable } from './interact';
import type { ToolKind } from './desk';
import type { UsageGroup } from './usage';
import type { Provider } from './data';
import { Pets } from './pets';

const HAIR = ['#2a1e1a', '#4a2f22', '#7a4a2a', '#c58b4a', '#e8c27a', '#1c1c24', '#8f3b2e', '#d9d4cc', '#5b3a6e'];
const HAIRSTYLES: HairStyle[] = ['short', 'long', 'bun', 'curly', 'ponytail', 'cap', 'short', 'long', 'mohawk', 'bald'];
const SPARK: Record<Thread['provider'], string> = { claude: '#ff9a5a', codex: '#3fd69a', cursor: '#7f8cff', gemini: '#4fb4ff' };

const R = Math.random;
const pick = <T,>(a: readonly T[]) => a[Math.floor(R() * a.length)];
const between = (a: number, b: number) => a + R() * (b - a);

function hash(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

function lookFor(t: Thread): Look {
  const h = hash(t.name + t.provider);
  const p = PROVIDERS[t.provider];
  const m = t.model;
  const outfit: Outfit = m.startsWith('opus') ? 'blazer' : m === 'sonnet' || m === 'gpt-5' ? 'hoodie' : m === 'composer' ? 'sweater' : 'tee';
  return {
    skin: SKIN[h % SKIN.length],
    hair: HAIR[(h >>> 3) % HAIR.length],
    hairStyle: HAIRSTYLES[(h >>> 7) % HAIRSTYLES.length],
    shirt: p.shirts[(h >>> 11) % p.shirts.length],
    shirtTrim: p.trims[(h >>> 13) % p.trims.length],
    pants: ['#2d3550', '#3a3a40', '#5a4a3a', '#26303a', '#6b6f7a'][(h >>> 15) % 5],
    shoes: ['#f2efe8', '#2a2428', '#c9423b', '#3d5a8a'][(h >>> 18) % 4],
    outfit,
    glasses: (h >>> 20) % 3 === 0,
    headphones: (h >>> 22) % 4 === 0 ? ['#22222a', '#f2efe8', '#e8556b'][(h >>> 24) % 3] : undefined,
    lanyard: t.parentId ? '#f2c94c' : undefined,
  };
}

type Mode = 'walk' | 'seated' | 'errand' | 'unpack' | 'pack' | 'leaving' | 'wc' | 'gone';
type ErrandKind =
  | 'coffee' | 'wc' | 'cooler' | 'pingpong' | 'couch' | 'window' | 'plants' | 'microwave' | 'knock' | 'phoneWalk' | 'help' | 'queue' | 'dance'
  // what real events send people to do, and the rooms of the east wing
  | 'books' | 'shred' | 'bossQueue' | 'kitchenWait' | 'gong' | 'highfive' | 'meeting' | 'nap' | 'server';
/** errands that are over in a moment or belong to the work: a thread that starts running does not call them off */
const STAYS: ReadonlySet<ErrandKind> = new Set<ErrandKind>(['books', 'shred', 'gong', 'highfive', 'meeting']);
/** Something to do from the desk, as soon as there is time for it. */
interface Job {
  /** true: done or started; false: not possible right now, ask again */
  run: () => boolean | undefined;
  until: number;
  miss?: () => void;
}

interface Errand {
  kind: ErrandKind;
  spot?: Spot;
  t: number;
  dur: number;
  stage: number;
  target?: string;
  /** it happens at the own chair: sit down again afterwards instead of walking back */
  home?: boolean;
}

export interface Anchor {
  id: string;
  name: string;
  sub: string;
  status: string;
  doing: string;
  bubble?: string;
  bubbleKind?: string;
  pos: THREE.Vector3;
  tps: number;
  intern: boolean;
  hidden: boolean;
}

export class Worker {
  ch: Character;
  desk?: Desk;
  x = 0;
  z = 0;
  heading = 0;
  path: P2[] = [];
  speed = 1.7;
  onArrive?: () => void;
  mode: Mode = 'seated';
  modeT = 0;
  phase = R() * 10;
  errand?: Errand;
  holding?: 'mug' | 'phone' | 'umbrella';
  bubble?: { text: string; until: number; kind?: string };
  patience = between(12, 40);
  seatedT = 0;
  statusT = 0;
  /** seconds into waiting for the user when they get up and stand in line at the boss's door */
  waitAt = between(5, 9);
  helpRequested = false;
  hidden = false;
  stool?: THREE.Mesh;
  /** which spot around the parent's desk an intern takes */
  slot = 0;
  pizzaNight = -1;
  doing = '';
  bootUntil = 0;
  /** a short pose at the desk that overrides what the status would show (a cheer, a facepalm, looking up) */
  act?: { pose: Pose; until: number; yaw?: number; wipe?: boolean };
  /** the kind of the last tool call, for a few seconds */
  tool?: { kind: ToolKind; until: number };
  private todo: Job[] = [];
  private carry?: 'papers';
  private zT = 0;
  lastBooks = -999;
  lastFive = -999;

  constructor(public thread: Thread, private world: World) {
    this.ch = createCharacter(lookFor(thread), (thread.parentId ? 0.78 : 1) * PERSON);
    world.scene.add(this.ch.root);
  }

  get intern() {
    return !!this.thread.parentId;
  }

  say(text: string, seconds = 3.5, kind?: string) {
    this.bubble = { text, until: this.world.time + seconds, kind };
  }

  /** Hold a pose at the desk for a few seconds. */
  react(pose: Pose, seconds: number, opts: { yaw?: number; wipe?: boolean } = {}): true {
    this.act = { pose, until: this.world.time + seconds, ...opts };
    return true;
  }

  /** Do this from the desk when there is time; `miss` runs instead if that takes longer than `ttl` seconds. */
  queue(run: Job['run'], ttl = 20, miss?: () => void) {
    if (this.todo.length >= 4) return miss?.();
    this.todo.push({ run, until: this.world.time + ttl, miss });
  }

  /** in the middle of a reaction, or one is still to come */
  get busy() {
    return !!this.act || this.todo.length > 0;
  }

  /** Returns true when a job took the worker away from the desk. */
  private runJobs() {
    const w = this.world;
    while (this.todo.length) {
      const j = this.todo[0];
      if (w.time > j.until) {
        this.todo.shift();
        j.miss?.();
        continue;
      }
      if (!j.run()) return false;
      this.todo.shift();
      if (this.mode !== 'seated' || this.moving) return true;
      if (this.act) return false;
    }
    return false;
  }

  /** A tool call: the monitor and the way they sit show what kind for a few seconds. */
  showTool(kind: ToolKind, seconds = 3.6) {
    this.tool = { kind, until: this.world.time + seconds };
    this.desk?.showTool(kind, seconds);
  }

  /** A colleague came over for a high five: get up from the chair and turn to them. */
  hostFive(guest: Worker) {
    const s = this.seatPose();
    this.mode = 'errand';
    this.modeT = 0;
    this.errand = { kind: 'highfive', t: 0, dur: 1.9, stage: 0, target: guest.thread.id, home: true };
    this.doing = S.doHighFive;
    this.place(s.x, s.z, Math.atan2(guest.x - s.x, guest.z - s.z));
  }

  /** Keep walking, but to another place (the line moved up). */
  retarget(to: P2) {
    const then = this.onArrive;
    if (then) this.go(to, then);
  }

  private snore(dt: number) {
    if ((this.zT -= dt) > 0) return;
    this.zT = between(1.1, 1.8);
    const p = new THREE.Vector3();
    this.ch.head.getWorldPosition(p);
    p.y += 0.5 * this.ch.scale;
    this.world.life.zzz(p);
  }

  private back(hurry = false): null {
    this.ch.root.position.y = 0;
    this.doing = '';
    this.returnToDesk(hurry);
    return null;
  }

  place(x: number, z: number, rot: number) {
    this.x = x;
    this.z = z;
    this.heading = rot;
    this.ch.root.position.set(x, 0, z);
    this.ch.root.rotation.y = rot;
  }

  /** walking a straight line on purpose (through a door), no sidestepping */
  private direct = false;
  private dodgeT = 0;

  get moving() {
    return this.path.length > 0;
  }

  go(to: P2, then: () => void, hurry = false, direct = false) {
    this.direct = direct;
    this.dodgeT = 0;
    this.path = direct ? [] : this.world.office.nav.findPath({ x: this.x, z: this.z }, to, this.world.standing(this));
    if (!this.path.length || Math.hypot(this.path[this.path.length - 1].x - to.x, this.path[this.path.length - 1].z - to.z) > 0.6) this.path.push({ x: to.x, z: to.z });
    this.onArrive = then;
    this.speed = hurry ? 2.6 : between(1.4, 1.8);
    if (this.mode === 'seated' && this.desk) this.desk.setChair(true);
    if (this.mode !== 'leaving') this.mode = 'walk';
    this.ch.root.position.y = 0;
  }

  seatPose() {
    if (this.intern && this.desk) return this.desk.internSpot(this.slot);
    return this.desk!.seatWorld();
  }

  sitDown() {
    const s = this.seatPose();
    const off = new THREE.Vector3(0, 0, -0.05 * PERSON).applyAxisAngle(new THREE.Vector3(0, 1, 0), s.rot);
    this.place(s.x + off.x, s.z + off.z, s.rot);
    if (this.intern) {
      if (!this.stool) {
        this.stool = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.45, 0.4), toon('#d9a441'));
        this.stool.position.set(s.x, 0.225, s.z);
        this.stool.castShadow = true;
        this.world.scene.add(this.stool);
      }
      this.ch.root.position.y = 0.45 - 0.46 * this.ch.scale;
    } else this.desk!.setChair(false);
    this.mode = 'seated';
    this.seatedT = 0;
    this.errand = undefined;
    this.path = [];
    if (this.holding === 'mug') this.holding = undefined;
    this.carry = undefined;
    if (!this.intern) this.desk!.carryStack(false);
  }

  returnToDesk(hurry = false) {
    if (!this.desk) return;
    this.releaseSpot();
    const target = this.intern ? this.desk.internSpot(this.slot) : this.desk.approach();
    this.go(target, () => this.sitDown(), hurry);
  }

  releaseSpot() {
    // only what is still ours: the spot may long belong to the next one
    if (this.errand?.spot && (!this.errand.spot.taken || this.errand.spot.taken === this.thread.id)) this.errand.spot.taken = undefined;
    if (this.errand?.kind === 'bossQueue') this.world.bossLeave(this);
    if (this.errand?.kind === 'pingpong') this.world.pingpongLeave(this);
    if (this.errand?.kind === 'queue' || this.errand?.kind === 'wc') this.world.wcLeave(this);
  }

  /** Status changed in T3. */
  onStatus(to: Thread['status'], from: Thread['status']) {
    this.statusT = 0;
    this.waitAt = between(5, 9);
    this.helpRequested = false;
    const d = this.desk;
    if (!d) return;
    d.failed = to === 'failed';
    d.setPhoneRinging(to === 'waiting');
    if (to === 'completed') {
      d.burstConfetti();
      this.world.sfx.play('ding');
      this.say(pick(S.done), 4, 'good');
    } else if (to === 'failed') {
      this.world.sfx.play('error');
      this.say(pick(S.failed), 4, 'bad');
    } else if (to === 'waiting') {
      this.world.sfx.play('phone');
      this.say(pick(S.ask), 5, 'ask');
    } else if (to === 'running' && from !== 'running') {
      if (this.mode === 'errand' || this.mode === 'walk' || this.mode === 'wc') {
        if (this.mode !== 'wc' && !(this.errand && STAYS.has(this.errand.kind))) {
          this.say(this.errand?.kind === 'nap' ? pick(S.wake) : S.backAlready, 2.5);
          this.ch.root.position.y = 0;
          this.returnToDesk(true);
        }
      }
    }
    // whoever stood in line for an answer hurries back the moment anything changes
    const k = this.errand?.kind;
    if (from === 'waiting' && to !== 'running' && (k === 'bossQueue' || k === 'kitchenWait') && (this.mode === 'errand' || this.mode === 'walk')) this.returnToDesk(true);
  }

  settle() {
    if (this.mode === 'pack' || this.mode === 'leaving' || this.mode === 'gone') return;
    if (this.mode === 'wc') {
      this.thread.settled = true;
      return;
    }
    this.releaseSpot();
    this.todo.length = 0;
    this.act = undefined;
    this.carry = undefined;
    if (!this.intern) this.desk?.carryStack(false);
    if (this.mode === 'seated') this.startPack();
    else this.go(this.intern ? this.desk!.internSpot(this.slot) : this.desk!.approach(), () => this.startPack());
  }

  startPack() {
    this.mode = 'pack';
    this.modeT = 0;
    this.path = [];
    if (this.desk && !this.intern) {
      this.desk.setChair(true);
      const a = this.desk.approach();
      const s = this.desk.seatWorld();
      this.place((a.x + s.x) / 2, (a.z + s.z) / 2, s.rot);
    }
    this.ch.root.position.y = 0;
  }

  leave() {
    this.mode = 'leaving';
    this.say(pick(S.bye), 3);
    const door = this.world.office.doors.exit;
    this.go(door.front, () => {
      door.target = 1;
      this.world.sfx.play('door');
      this.go({ x: door.x - 0.2, z: door.z }, () => {
        this.mode = 'gone';
        this.hidden = true;
        this.ch.root.visible = false;
        setTimeout(() => (door.target = 0), 700);
      }, false, true);
      this.mode = 'leaving';
    });
    this.mode = 'leaving';
  }

  update(dt: number) {
    const w = this.world;
    this.modeT += dt;
    this.statusT += dt;
    if (this.bubble && this.bubble.until < w.time) this.bubble = undefined;
    const t = this.thread;

    if (this.path.length) {
      this.walk(dt);
      return;
    }

    switch (this.mode) {
      case 'seated':
        this.seated(dt);
        break;
      case 'errand':
        this.doErrand(dt);
        break;
      case 'unpack': {
        this.ch.setPose('stand');
        if (this.modeT > 1.1) {
          this.ch.backpack.visible = false;
          this.holding = undefined;
          this.desk?.setBelongings(true);
          this.desk?.setScreen('boot');
          this.bootUntil = w.time + 1.6;
          w.sfx.play('boot');
          this.sitDown();
          this.say(pick(S.hello), 2.5);
        }
        break;
      }
      case 'pack': {
        this.ch.setPose('stand');
        if (this.intern) {
          if (this.modeT > 0.6) this.leave();
          break;
        }
        if (this.modeT > 0.5 && Math.floor((this.modeT - 0.5) / 0.32) > Math.floor((this.modeT - 0.5 - dt) / 0.32)) {
          if (this.desk!.packStep()) w.sfx.play('pack');
          else {
            this.desk!.takeCrate();
            this.desk!.clear();
            this.ch.setPose('carry');
            this.leave();
          }
        }
        break;
      }
      case 'wc':
        break;
      case 'leaving':
        this.ch.setPose(this.intern ? 'wave' : 'carry', this.modeT * 6);
        break;
    }
    void t;
  }

  private walk(dt: number) {
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
      // walk around whoever is in the way; the last steps to the goal go straight, or nobody would ever arrive
      if (!this.direct && !(last && d < 0.7)) {
        const s = steer(this.world.office.nav, this, ux, uz, step, this.world.bodies);
        this.dodgeT = s.x !== ux || s.z !== uz ? this.dodgeT + dt : 0;
        // circling for too long: push through for a moment
        if (this.dodgeT < 2.5) {
          ux = s.x;
          uz = s.z;
        } else if (this.dodgeT > 3.3) this.dodgeT = 0;
      }
      this.x += ux * step;
      this.z += uz * step;
      // pushed off the line, a corner counts as taken when it is close
      if (!last && this.dodgeT > 0 && Math.hypot(target.x - this.x, target.z - this.z) < 0.3) this.path.shift();
    }
    if (d > 0.001) {
      const want = Math.atan2(ux, uz);
      let diff = want - this.heading;
      diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      this.heading += diff * Math.min(1, dt * 12);
    }
    this.phase += step * 5.5;
    const carrying = this.mode === 'leaving' && !this.intern;
    this.ch.setPose(carrying ? 'carry' : this.carry ? 'carryPapers' : 'walk', this.phase);
    if (this.holding) this.ch.hold(this.holding);
    this.ch.root.position.x = this.x;
    this.ch.root.position.z = this.z;
    this.ch.root.rotation.y = this.heading;
    if (!this.path.length) {
      const cb = this.onArrive;
      this.onArrive = undefined;
      cb?.();
    }
  }

  /** Heads bob only to a DJ set; lofi radio is background music, nobody nods to it. */
  private nod(amount: number) {
    const w = this.world;
    if (!w.player.playing || w.groove < 0.01) return;
    const k = Math.pow(1 - w.beatFrac, 3);
    // harder for the first bars after a drop
    this.ch.head.rotation.x += k * amount * (1 + 2.2 * w.bob) * 1.5 * w.groove;
  }

  private seated(dt: number) {
    const w = this.world;
    const t = this.thread;
    const d = this.desk!;
    this.seatedT += dt;
    if (this.act && w.time > this.act.until) this.act = undefined;
    // what happened in the thread and still wants a reaction: one thing after the other, and only from the desk
    if (!this.act && this.todo.length && this.runJobs()) return;
    const tool = !this.intern && this.tool && w.time < this.tool.until ? this.tool.kind : undefined;
    d.tps = t.tps;
    d.setContext(t.context);
    d.setFiles(t.files);
    const hour = w.now.getHours();
    const lateNight = hour >= 23 || hour < 6;
    const lampOn = w.cycle.lampLevel > 0.45;
    if (!this.intern) {
      d.setLamp(lampOn, w.cycle.lampLevel);
      const nightKey = w.now.getDate();
      if ((hour >= 21 || hour < 4) && this.pizzaNight !== nightKey && t.status === 'running') {
        this.pizzaNight = nightKey;
        if (R() < 0.35) d.setPizza(true);
      }
    }
    let pose: Pose = 'typing';
    switch (t.status) {
      case 'running':
        if (!this.intern) d.setScreen(w.time < this.bootUntil ? 'boot' : 'running');
        // the last tool call shows in how they sit: hammering at a terminal, going through hits, watching tests run
        this.phase += dt * (tool === 'terminal' ? 26 : tool === 'search' ? 4 : tool === 'test' ? 3 : 5 + t.tps / 14);
        pose = tool === 'terminal' ? 'hack' : tool === 'search' ? 'mouse' : tool === 'test' ? 'watch' : 'typing';
        break;
      case 'waiting':
        if (!this.intern) d.setScreen('waiting');
        pose = 'raiseHand';
        // a moment with the hand up at the desk, then over to the boss's door; the kitchen when the line there is full
        if (!this.intern && !this.act && this.statusT > this.waitAt) {
          this.waitAt = this.statusT + 8;
          if (this.startErrand('bossQueue') || this.startErrand('kitchenWait')) return;
        }
        break;
      case 'failed':
        if (!this.intern) d.setScreen('failed');
        pose = 'headInHands';
        if (!this.helpRequested && this.statusT > 3) {
          this.helpRequested = true;
          w.requestHelp(this);
        }
        break;
      case 'completed':
        if (!this.intern) d.setScreen('completed');
        pose = this.statusT < 3.2 ? 'cheerSeated' : 'sitIdle';
        break;
      case 'idle':
        if (!this.intern) d.setScreen('idle');
        pose = lateNight ? 'sleepDesk' : this.seatedT % 14 < 2 ? 'stretch' : 'sitIdle';
        // nothing happened here for hours: off to a pod if one is free, otherwise asleep on the keyboard
        if (w.life.wantsNap(this)) {
          pose = 'sleepDesk';
          if (this.seatedT > 5 && !this.act && this.startErrand('nap')) return;
        }
        if (this.seatedT > this.patience * (lateNight ? 3 : 1) * (w.player.energy > 0.7 ? 0.35 : 1)) {
          this.patience = between(15, 45);
          this.startErrand(w.chooseErrand(this));
          return;
        }
        break;
    }
    // no quota, no light: nothing to do but shrug
    if (!this.intern && !d.powered && (t.status === 'running' || pose === 'stretch')) {
      pose = this.seatedT % 8 < 2.4 ? 'shrug' : 'sitIdle';
      this.phase = w.time * 5;
    }
    if (this.act) {
      pose = this.act.pose;
      this.phase += dt * 9;
    }
    this.ch.setPose(pose, this.phase);
    if (this.act?.yaw) this.ch.head.rotation.y = this.act.yaw;
    if (this.act?.wipe) this.ch.wipe(w.time * 9);
    if (pose === 'sleepDesk') this.snore(dt);
    if (pose !== 'sleepDesk' && pose !== 'headInHands') this.nod(pose === 'typing' ? 0.08 : 0.2);
  }

  /** Get up and go do something. `given`: the spot to use instead of picking a free one. Returns true when they set off. */
  startErrand(kind: ErrandKind | undefined, target?: string, given?: Spot) {
    if (!kind) {
      this.seatedT = 0;
      return false;
    }
    const w = this.world;
    const e: Errand = { kind, t: 0, dur: 10, stage: 0, target };
    if (kind === 'dance') {
      // target 'rush': called onto the floor by a drop; 'desk': the floor is full, dance beside the desk
      e.spot = target === 'desk' && this.desk ? this.danceBeside() : w.takeSpot('dance', this.thread.id);
      if (!e.spot) {
        this.seatedT = 0;
        return;
      }
      e.dur = target ? between(40, 85) : between(25, 50);
      // which of the three moves this dancer starts with
      e.stage = Math.floor(R() * 3);
      this.errand = e;
      this.doing = S.doDance;
      const spot = e.spot;
      this.go(spot, () => {
        this.mode = 'errand';
        this.modeT = 0;
        this.place(spot.x, spot.z, spot.rot);
      }, !!target);
      return;
    } else if (kind === 'wc') {
      e.kind = 'queue';
      e.spot = w.wcJoin(this);
    } else if (kind === 'help' && target) {
      const other = w.workers.get(target!);
      if (!other?.desk) return;
      e.spot = { ...other.desk.helpSpot() };
    } else if (kind === 'highfive') {
      // close enough to the colleague's chair for two hands to meet, and diagonally behind it: seen from the
      // default camera the two then stand side by side instead of one hiding the other
      const other = target ? w.workers.get(target) : undefined;
      if (!other?.desk) return false;
      const s = other.seatPose();
      const off = new THREE.Vector3(0.58, 0, -0.58).applyAxisAngle(new THREE.Vector3(0, 1, 0), s.rot);
      e.spot = { x: s.x + off.x, z: s.z + off.z, rot: Math.atan2(-off.x, -off.z) };
    } else if (kind === 'bossQueue') {
      e.spot = w.bossJoin(this);
      if (!e.spot) return false;
    } else if (given) {
      e.spot = given;
      given.taken = this.thread.id;
    } else {
      const spotKey = kind === 'phoneWalk' ? 'window' : kind === 'shred' ? 'shredder' : kind;
      e.spot = w.takeSpot(spotKey, this.thread.id);
      if (!e.spot) {
        this.seatedT = 0;
        return false;
      }
    }
    e.dur = { coffee: 6, wc: 10, queue: 0, cooler: between(10, 18), pingpong: between(16, 26), couch: between(14, 28), window: between(9, 15), plants: 5, microwave: 7, knock: 7, phoneWalk: between(10, 16), help: 8, dance: between(25, 50), books: between(5, 8), shred: 3.2, bossQueue: Infinity, kitchenWait: Infinity, gong: 3.1, highfive: 1.9, meeting: Infinity, nap: Infinity, server: between(7, 11) }[e.kind];
    this.errand = e;
    if (kind === 'shred') {
      // the whole stack goes along
      this.desk?.carryStack(true);
      this.carry = 'papers';
    }
    if (kind === 'coffee') this.doing = S.doCoffee;
    else if (kind === 'wc') this.doing = S.doWc;
    else this.doing = { cooler: S.doCooler, pingpong: S.doPingpong, couch: S.doCouch, window: S.doWindow, plants: S.doPlants, microwave: S.doMicrowave, knock: S.doKnock, phoneWalk: S.doPhone, help: S.doHelp, queue: S.doQueue, coffee: '', wc: '', dance: S.doDance, books: S.doBooks, shred: S.doShred, bossQueue: S.doBossQueue, kitchenWait: S.doKitchenWait, gong: S.doGong, highfive: S.doHighFive, meeting: S.doMeeting, nap: S.doNap, server: S.doServer }[kind];
    if (kind === 'window' && w.weather.rain > 0.3) this.doing = S.doWindowRain;
    if ((kind === 'pingpong' || (kind === 'cooler' && R() < 0.5)) && !target) {
      const busy = kind === 'pingpong' ? w.pingpongPartner(this) : w.coolerPartner(this);
      if (!busy) {
        const buddy = w.idleBuddy(this);
        if (buddy) {
          this.say(kind === 'pingpong' ? S.invitePingpong(buddy.thread.name) : S.inviteWater(buddy.thread.name), 3);
          setTimeout(() => buddy.mode === 'seated' && buddy.thread.status === 'idle' && buddy.startErrand(kind, this.thread.id), 900);
        }
      }
    }
    const spot = e.spot!;
    this.go(spot, () => {
      this.mode = 'errand';
      this.modeT = 0;
      // the line at the boss's door may have moved up on the way
      const at = e.spot ?? spot;
      this.place(at.x, at.z, at.rot);
      this.arrived(e);
      if (kind === 'coffee') w.sfx.play('coffee');
      if (kind === 'knock') {
        w.sfx.play('knock');
        w.bossNotice(this);
      }
      if (kind === 'help') this.say(pick(S.helping), 4);
      if (kind === 'window' && w.cycle.altitude > -2 && w.cycle.altitude < 10) this.say(w.now.getHours() < 12 ? S.sunrise : S.sunset, 4);
      if (kind === 'window' && w.cycle.altitude < -6) this.say(pick(S.night), 3.5);
    }, kind === 'gong' || kind === 'highfive');
    return true;
  }

  /** Just got to the place of one of the event errands. */
  private arrived(e: Errand) {
    const w = this.world;
    switch (e.kind) {
      case 'books':
        this.say(pick(S.reading), 3);
        break;
      case 'bossQueue':
        this.say(pick(S.queueing), 3, 'ask');
        if (w.bossPlace(this) === 0) {
          w.sfx.play('knock');
          w.bossNotice(this);
        } else e.stage = 1;
        break;
      case 'kitchenWait':
        w.sfx.play('coffee');
        break;
      case 'highfive': {
        const mate = e.target ? w.workers.get(e.target) : undefined;
        if (mate && mate.mode === 'seated' && !mate.moving && !mate.busy) {
          mate.hostFive(this);
          this.place(this.x, this.z, Math.atan2(mate.x - this.x, mate.z - this.z));
        } else e.stage = 5;
        break;
      }
      case 'nap':
        this.say(pick(S.yawn), 2.5);
        break;
      case 'server':
        this.say(pick(S.serverHot), 4.5, 'bad');
        break;
    }
  }

  /** The errands that come from real events and the rooms of the east wing. Returns null when the worker has moved on. */
  private doSpecial(e: Errand, dt: number): Pose | null {
    const w = this.world;
    const st = this.thread.status;
    switch (e.kind) {
      case 'books': {
        // take a book off the shelf, turn to the room with it, put it back
        const shelf = e.spot?.rot ?? Math.PI;
        const out = e.t > 1.1 && e.t < e.dur - 0.9;
        this.heading += ((out ? shelf - 2.5 : shelf) - this.heading) * Math.min(1, dt * 7);
        this.ch.root.rotation.y = this.heading;
        this.phase += dt * 2.4;
        return out ? 'read' : 'knock';
      }
      case 'shred':
        if (e.t < 0.5) {
          this.phase = 0;
          return 'carryPapers';
        }
        if (e.stage === 0) {
          e.stage = 1;
          this.carry = undefined;
          w.office.shredder.run();
          w.sfx.play('shred');
        }
        if (e.stage === 1 && e.t > 2.1) {
          e.stage = 2;
          this.say(S.compacted, 3);
        }
        this.phase += dt * 10;
        return e.t < 1.8 ? 'feed' : 'stand';
      case 'bossQueue':
        if (st !== 'waiting') return this.back(true);
        // a long wait is nicer with a coffee, and it makes room at the door
        if (this.statusT > this.waitAt + 45 && w.spotFree('kitchenWait')) {
          this.releaseSpot();
          this.startErrand('kitchenWait');
          return null;
        }
        if (e.stage === 0 && e.t < 1.6) {
          this.phase += dt * 14;
          return 'knock';
        }
        this.phase += dt * 2.5;
        return 'handUpL';
      case 'kitchenWait':
        if (st !== 'waiting') return this.back(true);
        this.holding = 'mug';
        if (e.stage === 0 && e.t > 2.5) {
          e.stage = 1;
          this.say(pick(S.waitCoffee), 3.5, 'ask');
        }
        return 'coffee';
      case 'gong':
        if (e.t < 0.35) return 'stand';
        if (e.stage === 0 && e.t > 1.02) {
          e.stage = 1;
          w.life.gongStruck(this, e.target ?? '');
        }
        if (e.t < 1.7) {
          this.phase = (e.t - 0.35) / 0.9;
          return 'strike';
        }
        return 'cheer';
      case 'highfive': {
        if (e.stage === 5) return 'cheer';
        const k = e.t / 1.5;
        if (!e.home && e.stage === 0 && k > 0.46) {
          e.stage = 1;
          const mate = e.target ? w.workers.get(e.target) : undefined;
          if (mate?.errand?.kind === 'highfive' && mate.errand.home) w.life.slap(this, mate);
        }
        this.phase = k;
        // the two face each other, so the hand on the camera's side is the right one for one and the left for the other
        return Math.sin(this.heading) > 0 ? 'highFiveL' : 'highFive';
      }
      case 'meeting':
        // the chair is a little higher than the couch the pose was made for
        this.ch.root.position.y = 0.34 * PERSON - 0.275 * this.ch.scale;
        this.phase += dt * 7;
        return this.bubble ? 'sitTalk' : 'sitListen';
      case 'nap':
        if (!w.life.wantsNap(this)) {
          this.say(pick(S.wake), 2.5);
          return this.back(st === 'running');
        }
        this.phase += dt * 1.7;
        this.snore(dt);
        this.ch.root.position.y = e.spot?.y ?? 0.42;
        return 'lie';
      case 'server':
        return 'stand';
    }
    return 'stand';
  }

  /** free to drop everything for a drop: idle at the desk, or idling somewhere on a break that can simply end */
  get canDance() {
    if (this.intern || !this.desk || this.thread.status !== 'idle' || this.thread.settled || this.path.length) return false;
    if (this.mode === 'seated') return true;
    const k = this.errand?.kind;
    return this.mode === 'errand' && (k === 'couch' || k === 'cooler' || k === 'window' || k === 'plants' || k === 'pingpong');
  }

  /** a drop calls: onto the dance floor ('rush') or beside the own desk ('desk') */
  joinDance(where: 'rush' | 'desk') {
    if (!this.canDance) return;
    if (this.mode === 'errand') {
      this.releaseSpot();
      this.errand = undefined;
      this.doing = '';
    }
    this.startErrand('dance', where);
  }

  /** a place to dance next to the own desk, facing the DJ */
  private danceBeside(): Spot {
    const a = this.desk!.approach();
    const booth = this.world.office.spots.dance?.[0] ?? { x: 3.9, z: -8 };
    return { x: a.x, z: a.z, rot: Math.atan2(booth.x - a.x, booth.z - a.z) };
  }

  private doErrand(dt: number) {
    const e = this.errand!;
    const w = this.world;
    e.t += dt;
    let pose: Pose = 'stand';
    switch (e.kind) {
      case 'coffee':
        if (e.t < 3.5) {
          pose = 'stand';
          w.brewing = true;
        } else {
          pose = 'coffee';
          this.holding = 'mug';
        }
        break;
      case 'microwave':
        pose = e.t < 5 ? 'stand' : 'coffee';
        if (e.t >= 5 && e.stage === 0) {
          e.stage = 1;
          w.sfx.play('microwave');
          this.holding = 'mug';
        }
        break;
      case 'queue': {
        pose = 'crossLegs';
        if (w.wcCanEnter(this)) {
          const door = w.office.doors.wc;
          e.kind = 'wc';
          e.t = 0;
          if (e.spot) e.spot.taken = undefined;
          this.go(door.front, () => {
            door.target = 1;
            w.sfx.play('door');
            this.go({ x: door.x - 0.2, z: door.z }, () => {
              this.mode = 'wc';
              this.hidden = true;
              this.ch.root.visible = false;
              setTimeout(() => (door.target = 0), 600);
              setTimeout(() => this.exitWc(), between(7000, 13000));
            }, false, true);
          });
        }
        this.ch.setPose(pose, this.phase);
        return;
      }
      case 'cooler': {
        pose = 'water';
        const partner = w.coolerPartner(this);
        if (partner && !this.bubble && e.stage === 0) {
          e.stage = 1;
          this.say(pick(S.gossip), 4);
        }
        break;
      }
      case 'pingpong': {
        const partner = w.pingpongPartner(this);
        if (!partner) {
          pose = 'stand';
          if (e.t > 10) e.t = e.dur + 1;
        } else {
          pose = 'paddle';
          this.phase += dt * 6;
        }
        break;
      }
      case 'couch':
        pose = 'sitCouch';
        break;
      case 'window':
        pose = 'coffee';
        break;
      case 'plants':
        pose = 'watering';
        this.phase += dt * 3;
        break;
      case 'knock':
        pose = e.t < 2.2 ? 'knock' : 'stand';
        this.phase += dt * 14;
        break;
      case 'phoneWalk':
        pose = 'phone';
        break;
      case 'dance': {
        // a move per person, swapped every eight bars, always down on the beat
        const move = (e.stage + Math.floor(w.beat / 32)) % 3;
        pose = move === 0 ? 'dance' : move === 1 ? 'dance2' : 'dance3';
        this.phase = (w.beat + (this.thread.name.length % 2)) * Math.PI;
        if (e.spot) this.ch.root.rotation.y = e.spot.rot + Math.sin(w.beat * Math.PI * 0.25 + e.stage * 2.1) * 0.3;
        const st = this.thread.status;
        if (w.player.energy < 0.7 || !settings.get('dance') || st === 'waiting' || st === 'failed') e.t = e.dur + 1;
        // came for a drop: back to the desk a few seconds after the high-energy passage is over
        else if (e.target && !w.danceHot) e.dur = Math.min(e.dur, e.t + 2 + (this.thread.name.length % 5));
        break;
      }
      case 'help':
        pose = 'point';
        if (!w.workers.get(e.target!) || w.workers.get(e.target!)!.thread.status !== 'failed') e.t = e.dur + 1;
        break;
      default: {
        const special = this.doSpecial(e, dt);
        if (!special) return;
        pose = special;
      }
    }
    this.ch.setPose(pose, this.phase);
    // hot in the server room
    if (e.kind === 'server' && e.t > 2.5) this.ch.wipe(w.time * 9);
    if (this.holding && pose !== 'coffee') this.ch.hold(this.holding);
    if (pose === 'stand' || pose === 'water' || pose === 'coffee' || pose === 'sitCouch') this.nod(0.18);
    if (e.kind === 'couch') this.ch.root.position.y = -0.05;
    if (e.t > e.dur) {
      this.ch.root.position.y = 0;
      this.doing = '';
      if (e.home) this.sitDown();
      else this.returnToDesk();
    }
  }

  private exitWc() {
    const w = this.world;
    const door = w.office.doors.wc;
    door.target = 1;
    w.sfx.play('flush');
    this.hidden = false;
    this.ch.root.visible = true;
    this.place(door.x + 0.1, door.z, Math.PI / 2);
    this.mode = 'walk';
    w.wcLeave(this);
    setTimeout(() => (door.target = 0), 700);
    this.go({ x: door.front.x, z: door.front.z }, () => {
      if (this.thread.settled) this.settle();
      else if (this.thread.status === 'running') this.returnToDesk(true);
      else this.returnToDesk();
    });
  }

  anchor(): Anchor {
    const head = new THREE.Vector3();
    this.ch.head.getWorldPosition(head);
    head.y += 0.62 * this.ch.scale;
    const t = this.thread;
    const away = this.mode !== 'seated';
    const doing =
      this.mode === 'leaving' || this.mode === 'pack' ? S.goingHome : this.mode === 'unpack' ? S.arriving : away && this.doing ? this.doing : away && this.mode === 'walk' ? S.out : '';
    return {
      id: t.id,
      name: t.name,
      sub: `${PROVIDERS[t.provider].label} · ${t.model} · ${t.title}`,
      status: t.status,
      doing,
      bubble: this.bubble?.text,
      bubbleKind: this.bubble?.kind,
      pos: head,
      tps: t.status === 'running' ? t.tps : 0,
      intern: this.intern,
      hidden: this.hidden || this.mode === 'gone',
    };
  }
}

/** Owns desks and workers and the shared office state (WC, ping pong, boss). */
export class World {
  readonly scene: THREE.Scene;
  readonly desks: Desk[];
  readonly workers = new Map<string, Worker>();
  time = 0;
  now = new Date();
  brewing = false;
  private wcInside?: string;
  private wcQueue: string[] = [];
  readonly boss: Boss;
  /** reactions to real events, meetings, naps, the server room, the quota */
  readonly life: Life;
  /** who stands in line at the boss's door, first in line first */
  private bossLine: string[] = [];
  private bossBubble?: { text: string; until: number };
  private ping = { t: 0, lastSide: 0 };
  /** the dog, the cat and the robot vacuum */
  readonly pets: Pets;
  /** continuous beat counter and the position inside the current beat */
  beat = 0;
  beatFrac = 0;
  party = 0;
  intensity = 0;
  /** party times the actual kick: how hard heads bob right now */
  groove = 0;
  ambience = 1;
  private show: LightShow;
  private dj: Character;
  private lastWeather = '';
  /** 1 right after a drop, 0 eight bars later: heads bob harder */
  bob = 0;
  /** a high-energy passage of the set is running */
  danceHot = false;
  private lastRush = 0;
  private danceQueue: { id: string; at: number; where: 'rush' | 'desk' }[] = [];

  constructor(
    readonly office: Office,
    readonly theme: Theme,
    readonly source: AgentSource,
    readonly cycle: DayCycle,
    readonly sfx: Sfx,
    readonly player: Player,
    readonly weather: Weather,
  ) {
    this.scene = office.scene;
    this.life = new Life(this);
    addClickable({ objects: [office.gong.object], hint: S.hintGong, onClick: () => this.life.ringGong() });
    this.boss = new Boss(this);
    this.show = new LightShow(office.scene, office, player, sfx);
    this.desks = office.seats.map((s) => new Desk(this.scene, theme, s));
    for (const d of this.desks) d.setPresent(false, false);
    const start = TEAMS.map(() => 0);
    for (const t of source.threads()) if (!t.parentId && t.team >= 0) start[t.team]++;
    this.relayout(start.map((n) => (n ? n + 1 : 0)));
    for (const t of source.threads()) this.spawn(t, false);
    // one spare desk per team so a newcomer has somewhere to sit
    for (let team = 0; team < 4; team++) {
      const spare = this.desks.find((d) => !d.present && d.seat.team === team);
      spare?.setPresent(true, false);
    }
    source.subscribe((e) => this.onEvent(e));
    weather.onBolt = (near) => sfx.thunder(near);
    this.dj = createCharacter(
      { skin: SKIN[2], hair: '#1c1c24', hairStyle: 'cap', shirt: '#1a1a1e', shirtTrim: '#ff3a8c', pants: '#26303a', shoes: '#f2efe8', outfit: 'tee', glasses: false, headphones: '#f2efe8' },
      PERSON,
    );
    this.dj.root.position.set(3.9, 0, -8.68);
    this.dj.root.visible = false;
    this.scene.add(this.dj.root);
    this.pets = new Pets(this);
  }

  /** Desks appear when a team needs one and fold away when they've been empty for a while. */
  private freeDesk(team: number) {
    const free = (d: Desk) => !d.occupant && d.present;
    const own = this.desks.find((d) => free(d) && d.seat.team === team);
    if (own) return own;
    if (!this.desks.some((d) => !d.present && d.seat.team === team)) {
      const want = this.demand();
      want[team] = Math.max(want[team], 1) + 1;
      this.relayout(want);
    }
    const build = this.desks.find((d) => !d.present && d.seat.team === team) ?? this.desks.find(free) ?? this.desks.find((d) => !d.present);
    if (build && !build.present) {
      build.setPresent(true);
      this.sfx.play('build');
    }
    return build;
  }

  /** seats each team needs: everyone with a desk (or on the way to one) plus one spare */
  private demand() {
    const n = TEAMS.map(() => 0);
    for (const w of this.workers.values()) if (!w.intern && w.mode !== 'gone' && w.mode !== 'leaving' && w.thread.team >= 0) n[w.thread.team]++;
    return n.map((k) => (k ? k + 1 : 0));
  }

  private relayout(demand = this.demand()) {
    const floor = this.office.floor;
    floor.layout(demand, (s) => !!this.desks[s.index]?.occupant);
    floor.refreshNav((s) => !!this.desks[s.index]?.present);
  }

  /** A worker whose column now belongs to another team packs up and moves to a desk of their own team. */
  private moveHouse() {
    for (const w of this.workers.values()) {
      if (w.intern || w.mode !== 'seated' || w.path.length || !w.desk || w.desk.seat.team === w.thread.team) continue;
      const team = w.thread.team;
      const d = this.desks.find((o) => o.present && !o.occupant && o.seat.team === team) ?? this.desks.find((o) => !o.present && o.seat.team === team);
      if (!d) continue;
      if (!d.present) {
        d.setPresent(true);
        this.sfx.play('build');
      }
      const old = w.desk;
      old.occupant = undefined;
      old.setBelongings(false);
      old.setPhoneRinging(false);
      old.failed = false;
      old.setScreen('off');
      d.occupant = w.thread.id;
      d.setAccent(SPARK[w.thread.provider]);
      d.setBelongings(true);
      w.desk = d;
      old.setChair(false);
      w.say(pick(S.moving), 3);
      w.returnToDesk();
      for (const i of this.workers.values()) {
        if (!i.intern || i.desk !== old) continue;
        i.desk = d;
        if (i.mode === 'seated') i.returnToDesk();
      }
      return;
    }
  }

  private layoutT = 0;

  private tidyDesks(dt: number) {
    this.layoutT += dt;
    if (this.layoutT > 2) {
      this.layoutT = 0;
      this.relayout();
      this.moveHouse();
      for (const d of this.desks) if (d.present && !d.occupant && d.seat.team < 0 && d.freeFor > 5) d.setPresent(false);
      for (const d of this.desks) if (d.present && !d.occupant && d.seat.team < 0) d.freeFor += 2;
    }
    for (let team = 0; team < 4; team++) {
      const spare = this.desks.filter((d) => d.present && !d.occupant && d.seat.team === team);
      for (const d of spare) d.freeFor += dt;
      for (const d of this.desks) if (d.occupant) d.freeFor = 0;
      // keep one spare per team, fold the rest after two minutes
      const extra = spare.sort((a, b) => b.freeFor - a.freeFor).slice(0, Math.max(0, spare.length - 1));
      for (const d of extra) {
        if (d.freeFor > 120) {
          d.setPresent(false);
          d.freeFor = 0;
          this.sfx.play('build');
        }
      }
    }
  }

  spawn(t: Thread, arriving: boolean) {
    const w = new Worker(t, this);
    if (t.parentId) {
      const parent = this.workers.get(t.parentId);
      if (!parent?.desk) {
        w.ch.root.removeFromParent();
        return;
      }
      w.desk = parent.desk;
      const taken = new Set([...this.workers.values()].filter((o) => o.intern && o.desk === parent.desk).map((o) => o.slot));
      while (taken.has(w.slot)) w.slot++;
    } else {
      const d = this.freeDesk(t.team);
      if (d && !arriving) d.setPresent(true, false);
      if (!d) {
        w.ch.root.removeFromParent();
        return;
      }
      d.occupant = t.id;
      d.setAccent(SPARK[t.provider]);
      w.desk = d;
    }
    this.workers.set(t.id, w);
    if (!arriving) {
      if (!w.intern) w.desk!.setBelongings(true);
      w.sitDown();
      w.statusT = R() * 20;
      w.seatedT = R() * 20;
      if (!w.intern) {
        w.desk!.setPhoneRinging(t.status === 'waiting');
        w.desk!.failed = t.status === 'failed';
      }
      return;
    }
    const door = this.office.doors.exit;
    door.target = 1;
    this.sfx.play('door');
    setTimeout(() => (door.target = 0), 900);
    w.place(door.x + 0.2, door.z, Math.PI / 2);
    w.ch.backpack.visible = !w.intern;
    w.mode = 'walk';
    const wet = this.weather.rain > 0.3;
    if (wet) w.holding = 'umbrella';
    w.say(w.intern ? S.helps(this.workers.get(t.parentId!)?.thread.name ?? '') : wet ? pick(S.wet) : S.newThread, 3);
    if (t.parentId) this.life.internArrived(t.parentId);
    const target = w.intern ? w.desk!.internSpot(w.slot) : w.desk!.approach();
    w.go(target, () => {
      if (w.intern) {
        w.sitDown();
        return;
      }
      w.mode = 'unpack';
      w.modeT = 0;
      const s = w.desk!.seatWorld();
      w.place(target.x, target.z, s.rot);
    });
  }

  private onEvent(e: SourceEvent) {
    if (e.type === 'add') return this.spawn(e.thread, true);
    if (e.type === 'order') {
      if (!this.theme.djCentral) this.boss.order(e.target, e.kind, e.text);
      return;
    }
    const w = this.workers.get(e.id);
    if (!w) return;
    if (e.type === 'status') w.onStatus(e.to, e.from);
    else if (e.type === 'settle') {
      w.thread.settled = true;
      for (const intern of this.workers.values()) if (intern.thread.parentId === e.id) intern.settle();
      w.settle();
    } else this.life.onEvent(e, w);
  }

  takeSpot(key: string, id: string) {
    const list = this.office.spots[key];
    if (!list?.length) return undefined;
    const free = list.filter((s) => !s.taken);
    if (!free.length) return undefined;
    const s = key === 'coffee' || key === 'microwave' ? free[0] : pick(free);
    s.taken = id;
    return s;
  }

  spotFree(key: string) {
    return !!this.office.spots[key]?.some((s) => !s.taken);
  }

  chooseErrand(w: Worker): ErrandKind | undefined {
    const h = this.now.getHours() + this.now.getMinutes() / 60;
    const golden = this.cycle.altitude > -2 && this.cycle.altitude < 10;
    const opts: [ErrandKind, number][] = [
      ['coffee', h < 10.5 ? 6 : h > 14 && h < 16.5 ? 4 : 2.5],
      ['wc', 2],
      ['cooler', this.office.spots.cooler?.some((s) => s.taken) ? 4 : 2],
      ['pingpong', this.office.spots.pingpong ? (this.office.spots.pingpong.some((s) => s.taken) ? 6 : 1.5) : 0],
      ['couch', 2],
      ['window', golden ? 5 : 1.2],
      ['plants', h < 11 ? 1.8 : 0.6],
      ['microwave', h > 11.5 && h < 13.6 ? 7 : 0],
      ['dance', settings.get('dance') && this.player.energy > 0.7 ? (this.danceHot ? 14 : 3) : 0],
    ];
    if (this.weather.rain > 0.3) {
      opts[5][1] *= 3;
      opts[0][1] *= 1.5;
    }
    const avail = opts.filter(([k, wgt]) => wgt > 0 && (k === 'wc' || this.spotFree(k)));
    const total = avail.reduce((s, [, wgt]) => s + wgt, 0);
    let r = R() * total;
    for (const [k, wgt] of avail) {
      r -= wgt;
      if (r <= 0) return k;
    }
    void w;
    return undefined;
  }

  /** A place in the line at the boss's door, or nothing when the line is full. */
  bossJoin(w: Worker) {
    const spots = this.office.spots.bossQueue ?? [];
    this.bossLeave(w);
    if (this.bossLine.length >= spots.length) return undefined;
    this.bossLine.push(w.thread.id);
    return spots[this.bossLine.length - 1];
  }
  bossLeave(w: Worker) {
    this.bossLine = this.bossLine.filter((id) => id !== w.thread.id);
  }
  /** position in that line, 0 = next at the door, -1 = not in it */
  bossPlace(w: Worker) {
    return this.bossLine.indexOf(w.thread.id);
  }
  /** who stands first at the boss's door right now */
  bossVisitor() {
    const w = this.workers.get(this.bossLine[0] ?? '');
    return w && w.mode === 'errand' && !w.moving ? w : undefined;
  }

  /** The agent that has been waiting for the user the longest (and can be seen). */
  longestWaiting(): Worker | undefined {
    let best: Worker | undefined;
    for (const w of this.workers.values()) {
      if (w.thread.status !== 'waiting' || w.hidden || w.mode === 'gone' || w.mode === 'leaving') continue;
      if (!best || w.statusT > best.statusT) best = w;
    }
    return best;
  }

  /** The quota pools as the usage source reports them; the main loop passes them in. */
  setUsage(groups: UsageGroup[]) {
    this.life.setUsage(groups);
  }

  /** Dev helper: pretend a provider (or 'all') has this share of its quota left; null lifts the override. */
  forceQuota(provider: Provider | 'all', left: number | null) {
    this.life.forceQuota(provider, left);
  }

  wcJoin(w: Worker) {
    this.wcQueue.push(w.thread.id);
    const idx = this.wcQueue.indexOf(w.thread.id);
    return this.office.spots.wcQueue[Math.min(idx, this.office.spots.wcQueue.length - 1)];
  }
  wcCanEnter(w: Worker) {
    return !this.wcInside && this.wcQueue[0] === w.thread.id && w.path.length === 0;
  }
  wcLeave(w: Worker) {
    if (this.wcInside === w.thread.id) this.wcInside = undefined;
    this.wcQueue = this.wcQueue.filter((id) => id !== w.thread.id);
  }

  coolerPartner(w: Worker) {
    return [...this.workers.values()].find((o) => o !== w && o.mode === 'errand' && o.errand?.kind === 'cooler');
  }
  idleBuddy(w: Worker) {
    const c = [...this.workers.values()].filter((o) => o !== w && !o.intern && o.mode === 'seated' && o.thread.status === 'idle' && !o.thread.settled);
    return c.length ? pick(c) : undefined;
  }
  pingpongPartner(w: Worker) {
    return [...this.workers.values()].find((o) => o !== w && o.mode === 'errand' && o.errand?.kind === 'pingpong');
  }
  pingpongLeave(w: Worker) {
    void w;
  }

  requestHelp(w: Worker) {
    const helper = [...this.workers.values()].find(
      (o) => o !== w && !o.intern && o.mode === 'seated' && o.thread.status === 'idle' && o.desk && Math.abs(o.desk.seat.x - w.desk!.seat.x) + Math.abs(o.desk.seat.z - w.desk!.seat.z) < 9,
    );
    helper?.startErrand('help', w.thread.id);
  }

  bossSay(text: string) {
    this.bossBubble = { text, until: this.time + 4.5 };
  }

  bossNotice(w: Worker) {
    this.boss.notice();
    void w;
  }

  /** everyone on their feet (or on a stool in the aisle) this frame; people walk around them */
  bodies: P2[] = [];

  /** those of them who stand still: routes are planned around them */
  standing(self: P2) {
    return this.bodies.filter((b) => b !== self && !(b as { moving?: boolean }).moving);
  }

  update(dt: number, now: Date) {
    this.time += dt;
    this.now = now;
    this.bodies.length = 0;
    // whoever sits at a desk is already part of the furniture in the nav grid
    for (const w of this.workers.values()) if (w.mode !== 'gone' && !w.hidden && !(w.mode === 'seated' && !w.intern && !w.moving)) this.bodies.push(w);
    if (this.boss.away) this.bodies.push(this.boss);
    this.pets.bodies(this.bodies);
    this.brewing = false;
    if (this.wcQueue.length && !this.wcInside) {
      const head = this.workers.get(this.wcQueue[0]);
      if (head?.mode === 'wc') this.wcInside = head.thread.id;
    }
    for (const w of this.workers.values()) {
      if (w.mode === 'wc') this.wcInside = w.thread.id;
    }
    for (const [id, w] of this.workers) {
      w.update(dt);
      if (w.mode === 'gone') {
        if (w.desk && !w.intern) w.desk.occupant = undefined;
        w.stool?.removeFromParent();
        w.ch.root.removeFromParent();
        this.workers.delete(id);
      }
    }
    for (const d of this.desks) d.update(dt);

    // queue shuffles forward
    this.wcQueue.forEach((id, i) => {
      const w = this.workers.get(id);
      if (w && w.mode === 'errand' && w.errand?.kind === 'queue') {
        const spot = this.office.spots.wcQueue[Math.min(i, this.office.spots.wcQueue.length - 1)];
        if (Math.hypot(w.x - spot.x, w.z - spot.z) > 0.2 && !w.path.length) w.go(spot, () => { w.mode = 'errand'; w.place(spot.x, spot.z, spot.rot); });
      }
    });
    // so does the line at the boss's door
    this.bossLine = this.bossLine.filter((id) => this.workers.get(id)?.errand?.kind === 'bossQueue');
    this.bossLine.forEach((id, i) => {
      const w = this.workers.get(id)!;
      const spot = this.office.spots.bossQueue[i];
      if (w.errand!.spot === spot) return;
      w.errand!.spot = spot;
      if (w.mode === 'errand' && !w.moving) w.go(spot, () => { w.mode = 'errand'; w.place(spot.x, spot.z, spot.rot); });
      else w.retarget(spot);
    });
    this.life.update(dt);
    this.office.doors.wc.busyLamp!.color.set(this.wcInside ? '#ff4a4a' : '#4aff7a').multiplyScalar(this.wcInside ? 2.4 : 1.2);

    for (const door of [this.office.doors.exit, this.office.doors.wc]) {
      door.open += (door.target - door.open) * Math.min(1, dt * 6);
      door.pivot.rotation.y = -door.open * 1.4;
    }

    // ping pong rally
    const players = [...this.workers.values()].filter((o) => o.mode === 'errand' && o.errand?.kind === 'pingpong' && !o.path.length);
    const ball = this.office.pingpongBall;
    if (players.length >= 2) {
      ball.visible = true;
      this.ping.t += dt / 0.85;
      const side = Math.floor(this.ping.t) % 2;
      const f = this.ping.t % 1;
      const a = side ? 11.2 : 8.4, b = side ? 8.4 : 11.2;
      ball.position.set(a + (b - a) * f, 0.85 + Math.sin(f * Math.PI) * 0.45, -1.2 + Math.sin(this.ping.t * 1.3) * 0.4);
      if (side !== this.ping.lastSide) {
        this.ping.lastSide = side;
        this.sfx.play('ping');
      }
    } else ball.visible = false;

    // coffee steam
    this.office.coffeeSteam.forEach((s, i) => {
      s.visible = this.brewing;
      if (this.brewing) {
        const k = (this.time * 0.8 + i / 4) % 1;
        s.position.y = 1.1 + k * 0.5;
        s.scale.setScalar(1 + k);
      }
    });

    // boss
    this.boss.thread = this.source.boss?.() ?? null;
    if (!this.theme.djCentral) this.boss.update(dt);

    this.pets.update(dt);
    this.tidyDesks(dt);
    this.updateMusic(dt);
    this.updateWeather();
  }

  /**
   * A drop (or a kick-in, or a surge of energy): idle people get up. Those nearest take the spots on the dance
   * floor, the rest dance beside their desks. Running, waiting, failed and sleeping agents stay where they are.
   */
  private danceRush() {
    const hour = this.now.getHours();
    if (hour >= 23 || hour < 6) return;
    const spots = this.office.spots.dance ?? [];
    if (!spots.length) return;
    const cx = spots.reduce((a, p) => a + p.x, 0) / spots.length, cz = spots.reduce((a, p) => a + p.z, 0) / spots.length;
    const dist = (o: Worker) => Math.hypot(o.x - cx, o.z - cz);
    const idle = [...this.workers.values()].filter((o) => o.canDance && !this.danceQueue.some((q) => q.id === o.thread.id)).sort((a, b) => dist(a) - dist(b));
    let free = spots.filter((p) => !p.taken).length - this.danceQueue.filter((q) => q.where === 'rush').length;
    for (const o of idle) {
      const floor = free > 0 && dist(o) < 18;
      if (floor) free--;
      // not all in the same frame: the near ones jump up first
      this.danceQueue.push({ id: o.thread.id, at: this.time + (floor ? between(0.1, 1.4) : between(0.6, 3)), where: floor ? 'rush' : 'desk' });
    }
  }

  private updateMusic(dt: number) {
    this.show.night = this.cycle.darkness;
    const s = this.show.update(dt);
    this.bob = s.bob;
    this.danceHot = s.hot;
    if (s.rush !== this.lastRush) {
      this.lastRush = s.rush;
      if (settings.get('dance')) this.danceRush();
    }
    if (this.danceQueue.length) {
      const due = this.danceQueue.filter((q) => q.at <= this.time);
      this.danceQueue = this.danceQueue.filter((q) => q.at > this.time);
      for (const q of due) {
        this.workers.get(q.id)?.joinDance(q.where);
      }
    }
    this.party = s.party;
    this.beat = s.beat;
    this.beatFrac = s.beatFrac;
    this.intensity = s.intensity;
    this.groove = s.groove;
    this.ambience = s.ambience;
    const p = this.player;
    const djOn = p.playing && p.current.kind === 'youtube';
    this.dj.root.visible = djOn;
    if (djOn) this.dj.setPose(Math.floor(this.beat / 16) % 4 === 3 ? 'dance' : 'dj', this.beat * Math.PI);
    if (this.party > 0.3 && !this.theme.djCentral) this.office.boss.ch.head.rotation.x += Math.pow(1 - this.beatFrac, 2.5) * 0.2 * this.groove;
  }

  private updateWeather() {
    const w = this.weather;
    if (w.state !== this.lastWeather) {
      const first = !this.lastWeather;
      this.lastWeather = w.state;
      if (!first && (w.state === 'rain' || w.state === 'storm')) {
        const someone = this.idleOrAny();
        someone?.say(w.state === 'storm' ? S.storm : pick(S.rain), 3.5);
      }
      if (!first && w.state === 'snow') this.idleOrAny()?.say(pick(S.snow), 3.5);
      if (!first && w.state === 'clear') this.idleOrAny()?.say(pick(S.sunBack), 3);
    }
    if (w.sinceBolt === 0) {
      w.sinceBolt = 0.0001;
      const seated = [...this.workers.values()].filter((o) => o.mode !== 'gone' && !o.hidden);
      for (let i = 0; i < Math.min(3, seated.length); i++) {
        const o = pick(seated);
        if (!o.bubble) o.say(pick(S.lightning), 2.5);
      }
    }
  }

  private idleOrAny() {
    const all = [...this.workers.values()].filter((o) => o.mode === 'seated' && !o.bubble);
    return all.find((o) => o.thread.status === 'idle') ?? all[0];
  }

  anchors(): Anchor[] {
    const list = [...this.workers.values()].map((w) => w.anchor());
    const boss = this.office.boss;
    const head = new THREE.Vector3();
    boss.head.getWorldPosition(head);
    head.y += 0.62 * 1.05 * PERSON;
    const interns = [...this.workers.values()].filter((w) => w.intern).length;
    const bubble = this.bossBubble && this.bossBubble.until > this.time ? this.bossBubble.text : undefined;
    const chief = this.boss.thread;
    const team = chief ? [...this.workers.values()].filter((w) => w.thread.managerId === chief.id).length : 0;
    list.push({
      id: chief?.id ?? 'boss',
      name: chief ? chief.title.slice(0, 18) : 'Oskar',
      sub: chief ? `Orchestrator · ${chief.model}` : 'Orchestrator · opus',
      status: chief && chief.status === 'waiting' ? 'waiting' : 'boss',
      doing: chief ? (chief.status === 'waiting' ? S.bossWaiting : team ? S.bossSteers(team) : '') : interns ? S.internsOut(interns) : '',
      bubble,
      pos: head,
      tps: 64,
      intern: false,
      hidden: false,
    });
    return list;
  }

  /** Rough boxes around every visible person, for cutting them out of HTML overlays behind them. */
  occluders(out: THREE.Box3[]) {
    const add = (ch: Character) => {
      if (!ch.root.visible) return;
      const p = ch.root.position, k = ch.scale;
      out.push(new THREE.Box3(new THREE.Vector3(p.x - 0.3 * k, p.y, p.z - 0.3 * k), new THREE.Vector3(p.x + 0.3 * k, p.y + ch.headHeight + 0.12 * k, p.z + 0.3 * k)));
    };
    for (const w of this.workers.values()) if (!w.hidden) add(w.ch);
    add(this.office.boss.ch);
    add(this.dj);
  }

  counts() {
    const c = { running: 0, waiting: 0, idle: 0, failed: 0, completed: 0, away: 0 };
    for (const w of this.workers.values()) {
      if (w.intern || w.mode === 'gone') continue;
      c[w.thread.status]++;
      if (w.mode !== 'seated') c.away++;
    }
    return c;
  }
}

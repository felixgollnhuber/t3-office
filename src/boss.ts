import * as THREE from 'three';
import type { Pose } from './character';
import { glow } from './materials';
import { steer, type P2 } from './nav';
import { fx, ROOM } from './office';
import type { Thread } from './source';
import type { Worker, World } from './workers';
import { S } from './i18n/boss';

type Hold = 'mug' | 'phone';
type Step =
  | { go: P2; hold?: Hold; slow?: boolean; pace?: boolean }
  | { pose: Pose; secs: number; rot?: number; hold?: Hold; say?: string; reply?: { w: Worker; text: string } };

const DOOR: P2 = { x: -7.55, z: -3.4 };
const DROP_GEO = new THREE.BoxGeometry(0.07, 0.11, 0.07);
const DROP_MAT = glow('#8fd8ff', 1.5);
/** first clause of an instruction, short enough for a speech bubble */
const brief = (t: string) => {
  const s = t.replace(/^(Main|Chef|Boss)( (an|to) [^:,]+)?[:,]\s*/i, '').split(/(?<=[.!?;:])\s/)[0];
  return s.length > 46 ? s.slice(0, 44).trimEnd() + '…' : s;
};
const pick = <T,>(a: T[]) => a[Math.floor(Math.random() * a.length)];
const between = (a: number, b: number) => a + Math.random() * (b - a);

/**
 * Oskar, the orchestrator. Mostly at his desk, but he does rounds: checks on agents that wait for
 * input or failed, peeks over shoulders, studies the quota wall and the pinboard, fetches coffee,
 * paces on the phone and dances when a set is on.
 */
export class Boss {
  x: number;
  z: number;
  private heading: number;
  private phase = 0;
  private steps: Step[] = [];
  private stepT = 0;
  private seated = true;
  private sitT = 0;
  private nextAt = between(6, 14);
  private noticeT = 0;
  private sip = 0;
  private mug = false;
  private visited = new Map<string, number>();
  private path: P2[] = [];
  private dodgeT = 0;
  private orders: { target: string; kind: 'launch' | 'send'; text: string; at: number }[] = [];
  private onOrder = false;
  private waitT = 0;
  /** sweat: drops flying off his head while the quota is nearly gone, and the moments he wipes his forehead */
  private drops: { m: THREE.Mesh; life: number; vx: number; vy: number; vz: number }[] = [];
  private dropAcc = 0;
  private wipeT = 0;
  private wipeAt = 3;
  /** the T3 orchestrator thread he stands for (live mode only) */
  thread: Thread | null = null;

  constructor(private world: World) {
    const s = world.office.boss.seat;
    this.x = s.x;
    this.z = s.z;
    this.heading = s.rot;
  }

  get moving() {
    return this.path.length > 0;
  }

  get away() {
    return !this.seated;
  }

  /** The orchestrator launched or messaged a thread: walk over and tell them in person. */
  order(target: string, kind: 'launch' | 'send', text: string) {
    this.orders = this.orders.filter((o) => o.target !== target);
    this.orders.push({ target, kind, text, at: this.world.time });
    if (this.orders.length > 4) this.orders.shift();
    if (!this.seated && !this.onOrder) this.startOrder();
  }

  private startOrder() {
    const w = this.world;
    while (this.orders.length) {
      const o = this.orders.shift()!;
      if (w.time - o.at > 90) continue;
      const worker = w.workers.get(o.target);
      const said = brief(o.text);
      if (!worker || !worker.desk || worker.intern) {
        // not in the office: call them instead
        this.begin([
          { pose: 'phone', secs: 3.2, hold: 'phone', say: `☎ ${said}` },
          { pose: 'phone', secs: 1.6, hold: 'phone', say: pick(S.phoneBye) },
        ], true);
        return;
      }
      const reply = o.kind === 'launch' ? pick(S.replyLaunch) : pick(S.replySend);
      const { at, rot } = this.beside(worker);
      this.visited.set(worker.thread.id, w.time);
      this.begin([
        { go: DOOR },
        { go: at },
        { pose: 'point', secs: 3.6, rot, say: o.kind === 'launch' ? S.newForYou(said) : said, reply: { w: worker, text: reply } },
        { pose: 'stand', secs: 1.8, rot },
        ...(this.orders.length ? [] : [{ go: DOOR } as Step]),
      ], true);
      return;
    }
    this.onOrder = false;
  }

  private begin(steps: Step[], order: boolean) {
    const seat = this.world.office.boss.seat;
    this.steps = [...steps, { go: { x: seat.x + 0.9, z: seat.z }, hold: this.mug ? 'mug' : undefined }, { go: seat }];
    this.onOrder = order;
    this.seated = false;
    this.stepT = 0;
    this.path = [];
  }

  /** Someone knocked on the glass door. */
  notice() {
    if (this.seated) {
      this.noticeT = 5;
      this.world.bossSay(pick(S.knockSeated));
    } else this.world.bossSay(pick(S.knockAway));
  }

  /** how nervous the quota makes him: 0 fine, 1 under 25 % left, 2 under 10 %, 3 a pool is used up */
  private get stress() {
    return this.world.life.budget.stress;
  }

  update(dt: number) {
    this.move(dt);
    this.sweat(dt);
  }

  /** Under 10 % of a quota left: drops fly off his forehead and every few seconds he wipes it. */
  private sweat(dt: number) {
    const ch = this.world.office.boss.ch;
    const hot = this.stress >= 2;
    if (hot) {
      this.wipeAt -= dt;
      if (this.wipeAt <= 0) {
        this.wipeAt = between(4, 7);
        this.wipeT = 1.5;
      }
      this.dropAcc += dt * (this.stress === 3 ? 5 : 3.2);
      const head = new THREE.Vector3();
      while (this.dropAcc > 1) {
        this.dropAcc -= 1;
        ch.head.getWorldPosition(head);
        const m = new THREE.Mesh(DROP_GEO, DROP_MAT);
        const a = Math.random() * Math.PI * 2;
        m.position.set(head.x + Math.cos(a) * 0.3, head.y + 0.55 + Math.random() * 0.15, head.z + Math.sin(a) * 0.3);
        this.world.scene.add(fx(m));
        this.drops.push({ m, life: 0, vx: Math.cos(a) * 0.7, vy: 1.1 + Math.random() * 0.5, vz: Math.sin(a) * 0.7 });
      }
    }
    if (this.wipeT > 0) {
      this.wipeT -= dt;
      if (hot) ch.wipe(this.world.time * 10);
    }
    for (let i = this.drops.length - 1; i >= 0; i--) {
      const d = this.drops[i];
      d.life += dt;
      d.vy -= 5.5 * dt;
      d.m.position.x += d.vx * dt;
      d.m.position.y += d.vy * dt;
      d.m.position.z += d.vz * dt;
      if (d.life > 0.75) {
        d.m.removeFromParent();
        this.drops.splice(i, 1);
      }
    }
  }

  private move(dt: number) {
    const ch = this.world.office.boss.ch;
    this.noticeT = Math.max(0, this.noticeT - dt);
    if (this.seated) {
      this.sitT += dt;
      // with a pool used up there is nothing left to steer: head in hands, now and then
      const despair = this.stress === 3 && this.sitT % 9 > 5.5;
      ch.setPose(this.noticeT > 0 ? 'sitIdle' : despair ? 'headInHands' : this.sip > 0 ? 'coffee' : 'typing', this.world.time * 7);
      if (this.noticeT > 0) ch.head.rotation.y = 0.9;
      if (this.mug) {
        this.sip = Math.max(0, this.sip - dt);
        if (this.sip <= 0 && Math.random() < dt / 9) this.sip = 2.2;
        ch.hold('mug');
        if (this.sitT > 60) this.mug = false;
      }
      const waiting = this.thread?.status === 'waiting';
      if (waiting) {
        ch.setPose('raiseHand', this.world.time * 4);
        this.waitT -= dt;
        if (this.waitT <= 0) {
          this.waitT = 14;
          this.world.bossSay(pick(S.needsYou));
        }
        return;
      }
      if (this.orders.length && this.noticeT <= 0) return this.startOrder();
      // a busy orchestrator makes fewer idle rounds
      if (this.sitT > this.nextAt * (this.thread?.status === 'running' ? 1.6 : 1) && this.noticeT <= 0) this.plan();
      return;
    }
    const step = this.steps[0];
    if (!step) {
      if (this.onOrder && this.orders.length) return this.startOrder();
      this.onOrder = false;
      return this.sitDown();
    }
    // between two orders he goes straight to the next desk
    if (this.onOrder && this.orders.length && 'go' in step && this.steps.length <= 2) return this.startOrder();
    if ('go' in step) {
      if (!this.path.length) {
        this.path = this.world.office.nav.findPath({ x: this.x, z: this.z }, step.go, this.world.standing(this));
        const last = this.path[this.path.length - 1];
        if (!last || Math.hypot(last.x - step.go.x, last.z - step.go.z) > 0.6) this.path.push(step.go);
      }
      this.walk(dt, step.pace ? 1.25 : step.slow ? 1.0 : 1.45);
      ch.setPose(step.pace ? 'pace' : 'walk', this.phase);
      if (step.hold) ch.hold(step.hold);
      else if (this.mug) ch.hold('mug');
      if (!this.path.length) this.advance();
    } else {
      if (this.stepT === 0) {
        if (step.say) this.world.bossSay(step.say);
        if (step.reply) {
          const { w, text } = step.reply;
          setTimeout(() => w.say(text, 3.2), 1600);
        }
      }
      this.stepT += dt;
      if (step.rot !== undefined) this.turn(step.rot, dt);
      ch.setPose(step.pose, this.world.time * (step.pose === 'dance' ? 1 : 6));
      if (step.hold) ch.hold(step.hold);
      if (this.stepT >= step.secs) this.advance();
    }
    this.place();
  }

  private advance() {
    const done = this.steps.shift();
    if (done && 'pose' in done && done.pose === 'coffee') this.mug = true;
    this.stepT = 0;
    this.path = [];
  }

  private walk(dt: number, speed: number) {
    const t = this.path[0];
    if (!t) return;
    const dx = t.x - this.x, dz = t.z - this.z;
    const d = Math.hypot(dx, dz);
    const step = speed * dt;
    let ux = d > 0.001 ? dx / d : 0, uz = d > 0.001 ? dz / d : 0;
    const last = this.path.length === 1;
    if (d <= step) {
      this.x = t.x;
      this.z = t.z;
      this.path.shift();
    } else {
      if (!(last && d < 0.7)) {
        const s = steer(this.world.office.nav, this, ux, uz, step, this.world.bodies);
        this.dodgeT = s.x !== ux || s.z !== uz ? this.dodgeT + dt : 0;
        if (this.dodgeT < 2.5) {
          ux = s.x;
          uz = s.z;
        } else if (this.dodgeT > 3.3) this.dodgeT = 0;
      }
      this.x += ux * step;
      this.z += uz * step;
      if (!last && this.dodgeT > 0 && Math.hypot(t.x - this.x, t.z - this.z) < 0.3) this.path.shift();
    }
    if (d > 0.001) this.turn(Math.atan2(ux, uz), dt);
    this.phase += step * 5.5;
  }

  private turn(to: number, dt: number) {
    const diff = Math.atan2(Math.sin(to - this.heading), Math.cos(to - this.heading));
    this.heading += diff * Math.min(1, dt * 10);
  }

  private place() {
    const r = this.world.office.boss.ch.root;
    r.position.set(this.x, 0, this.z);
    r.rotation.y = this.heading;
  }

  private sitDown() {
    const s = this.world.office.boss.seat;
    this.x = s.x;
    this.z = s.z;
    this.heading = s.rot;
    this.place();
    this.seated = true;
    this.sitT = 0;
    // a nervous boss does not stay in his chair for long
    this.nextAt = between(16, 40) * (this.stress >= 2 ? 0.35 : this.stress === 1 ? 0.8 : this.world.cycle.darkness > 0.6 ? 1.8 : 1);
  }

  /** Standing spot beside a seated agent, looking at their monitor. */
  private beside(w: Worker): { at: P2; rot: number } {
    const s = w.seatPose();
    const fx = Math.sin(s.rot), fz = Math.cos(s.rot);
    const side = Math.random() < 0.5 ? 1 : -1;
    const at = { x: s.x - fx * 0.35 + fz * 0.62 * side, z: s.z - fz * 0.35 - fx * 0.62 * side };
    const mx = s.x + fx * 0.9, mz = s.z + fz * 0.9;
    return { at, rot: Math.atan2(mx - at.x, mz - at.z) };
  }

  private plan() {
    const w = this.world;
    const seated = [...w.workers.values()].filter((o) => o.mode === 'seated' && o.desk && !o.intern && !o.path.length);
    const fresh = (o: Worker) => w.time - (this.visited.get(o.thread.id) ?? -999) > 90;
    const waiting = seated.filter((o) => o.thread.status === 'waiting' && o.statusT > 6 && fresh(o));
    const failed = seated.filter((o) => o.thread.status === 'failed' && o.statusT > 4 && fresh(o));
    const running = seated.filter((o) => o.thread.status === 'running' && fresh(o));
    const minX = ROOM.minX, minZ = ROOM.minZ;
    const door = DOOR;

    const visit = (o: Worker, kind: 'waiting' | 'failed' | 'running'): Step[] => {
      this.visited.set(o.thread.id, w.time);
      const { at, rot } = this.beside(o);
      const name = o.thread.title.split(' ')[0];
      const talk =
        kind === 'waiting'
          ? { say: pick([S.whatNeed(name), ...S.askWaiting]), reply: pick(S.replyWaiting) }
          : kind === 'failed'
            ? { say: pick(S.askFailed), reply: pick(S.replyFailed) }
            : { say: pick(S.askRunning), reply: pick(S.replyRunning) };
      return [
        { go: door },
        { go: at },
        { pose: 'stand', secs: 1.2, rot },
        { pose: kind === 'running' ? 'stand' : 'point', secs: 3.4, rot, say: talk.say, reply: { w: o, text: talk.reply } },
        { pose: 'stand', secs: 2.6, rot },
        { go: door },
      ];
    };

    // somebody stands at the door with a question: step out and ask
    const caller = w.bossVisitor();
    const answer = (o: Worker): Step[] => {
      this.visited.set(o.thread.id, w.time);
      const rot = Math.atan2(o.x - door.x, o.z - door.z);
      return [
        { go: door },
        { pose: 'point', secs: 3.2, rot, say: S.whatNeed(o.thread.title.split(' ')[0]), reply: { w: o, text: pick(S.replyWaiting) } },
        { pose: 'stand', secs: 2.4, rot },
      ];
    };
    // the quota runs low: up and down in front of his office, where everybody sees it, hands behind the back
    const stress = this.stress;
    const pacing = (): Step[] => {
      const a: P2 = { x: -5.9, z: -4.5 }, b: P2 = { x: -5.9, z: -7.4 };
      const say = stress === 3 ? pick(S.budgetCritical) : stress === 2 ? pick(S.budgetCritical) : pick(S.budgetLow);
      const laps = stress >= 2 ? 3 : 2;
      const steps: Step[] = [{ go: door }, { go: a, pace: true }, { pose: 'stand', secs: 1.4, rot: Math.PI / 2, say }];
      for (let i = 0; i < laps; i++) steps.push({ go: b, pace: true }, { go: a, pace: true });
      if (stress >= 2) steps.push({ pose: 'stand', secs: 1.6, rot: Math.PI / 2, say: pick(S.budgetCritical) });
      steps.push({ go: door });
      return steps;
    };

    const options: [number, () => Step[]][] = [
      [stress >= 2 ? 24 : stress === 1 ? 10 : 0, pacing],
      [caller && fresh(caller) ? 7 : 0, () => answer(caller!)],
      [waiting.length ? 6 : 0, () => visit(pick(waiting), 'waiting')],
      [failed.length ? 5 : 0, () => visit(pick(failed), 'failed')],
      [running.length ? 2.5 : 0, () => visit(pick(running), 'running')],
      [1.6, () => [
        { go: { x: minX + 1.15, z: -6.2 } },
        { pose: 'stand', secs: 1.5, rot: -Math.PI / 2 },
        { pose: 'point', secs: 2.4, rot: -Math.PI / 2, say: pick(S.quota) },
        { pose: 'stand', secs: 3, rot: -Math.PI / 2 },
      ]],
      [1.4, () => [
        { go: door },
        { go: { x: minX + 1.1, z: -2.65 } },
        { pose: 'stand', secs: 1.6, rot: -Math.PI / 2 },
        { pose: 'point', secs: 2.6, rot: -Math.PI / 2, say: pick(S.pinboard) },
        { pose: 'stand', secs: 2, rot: -Math.PI / 2 },
        { go: door },
      ]],
      [1.3, () => {
        const c = w.office.spots.coffee[0];
        return [
          { go: door },
          { go: c },
          { pose: 'coffee', secs: 4, rot: c.rot, say: pick(S.coffee) || undefined },
          { go: door, hold: 'mug' },
        ];
      }],
      [1.2, () => {
        const pts: P2[] = [{ x: -8.3, z: -5.2 }, { x: -11.8, z: -5.0 }, { x: -8.4, z: -7.9 }, { x: -11.6, z: -6.0 }];
        return [
          { pose: 'phone', secs: 2.5, say: pick(S.phoneHello) },
          { go: pts[0], hold: 'phone', slow: true },
          { pose: 'phone', secs: 2.5, say: pick(S.phoneListen) },
          { go: pts[1], hold: 'phone', slow: true },
          { pose: 'phone', secs: 2.2, say: pick(S.phoneAgree) },
          { go: pts[2 + Math.floor(Math.random() * 2)], hold: 'phone', slow: true },
          { pose: 'phone', secs: 1.5, say: S.phoneEnd },
        ];
      }],
      [0.8, () => [
        { go: { x: -10.9, z: minZ + 0.75 } },
        { pose: 'stand', secs: 6, rot: Math.PI, say: w.weather.rain > 0.3 ? pick(S.windowRain) : pick(S.windowFine) },
      ]],
      [0.9, () => [
        { go: { x: -10.75, z: -7.6 } },
        { pose: 'stretch', secs: 3.2, rot: 0 },
      ]],
      [w.party > 0.4 ? 8 * w.party : 0, () => {
        const d = pick(w.office.spots.dance);
        return [{ go: door }, { go: d }, { pose: 'dance', secs: between(14, 26), rot: d.rot, say: pick(S.dance) }, { go: door }];
      }],
    ];
    const total = options.reduce((s, [wt]) => s + wt, 0);
    let r = Math.random() * total;
    const chosen = options.find(([wt]) => wt > 0 && (r -= wt) <= 0) ?? options[5];
    this.begin(chosen[1](), false);
  }
}

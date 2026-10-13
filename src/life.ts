import * as THREE from 'three';
import type { SfxName } from './audio';
import type { Provider } from './data';
import { cue, follow } from './director';
import { glow } from './materials';
import { fx } from './office';
import { settings } from './settings';
import type { SourceEvent } from './source';
import { canvasTexture } from './textures';
import type { UsageGroup } from './usage';
import type { Worker, World } from './workers';
import { S } from './i18n/world';
import { S as BOSS } from './i18n/boss';

const R = Math.random;
const pick = <T,>(a: readonly T[]) => a[Math.floor(R() * a.length)];
const between = (a: number, b: number) => a + R() * (b - a);
/** a PR title or a test command, short enough for a speech bubble */
const clip = (s: string, n = 30) => (s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s);

/** a thread counts as asleep after this long without anything happening in it … */
const NAP_AFTER = 2 * 3600_000;
/** … or, between 23:00 and 6:00, already after this long */
const NAP_AFTER_NIGHT = 20 * 60_000;
/** the server room counts as running hot from here on */
const HOT = 0.8;
/** seconds the warning light turns after a failed CI run */
const ALARM_SECS = 20;
const SPARK_GEO = new THREE.BoxGeometry(0.06, 0.06, 0.06);

type ThreadEvent = Extract<SourceEvent, { id: string }>;

interface Meeting {
  parent: Worker;
  members: Worker[];
  /** seconds since the parent sat down at the head of the table */
  t: number;
  dur: number;
  live: boolean;
  /** seconds since it was called, to give up when nobody gets there */
  age: number;
  talkAt: number;
  talks: number;
  paintT: number;
  saved: ImageData;
}

/**
 * What the office does with real events beyond a single desk: reactions to pull requests, CI and test runs,
 * meetings of an agent with its subagents, the load of the server room, naps, and what a quota running out does.
 */
export class Life {
  /** smoothed load of the server room, 0..1 */
  load = 0.15;
  /** fixed load for trying things out (null: follow the threads) */
  forceLoad: number | null = null;
  /** quota: the smallest share left in any pool, the providers with a used-up pool, and how nervous that makes the boss (0..3) */
  readonly budget = { min: 1, out: new Set<Provider>(), stress: 0 as 0 | 1 | 2 | 3 };
  private forced = new Map<string, number>();
  private labels = new Map<Provider, string>();
  private alarm = { by: new Set<string>(), until: 0, on: false };
  private lastLoud = new Map<string, number>();
  private lastFive = -99;
  private meeting?: Meeting;
  private meetingEnded = -99;
  private lastMeet = new Map<string, number>();
  private pendingMeet = new Map<string, number>();
  private meetCheckT = 20;
  private serverCheckAt = 30;
  private zs: { s: THREE.Sprite; life: number; vx: number }[] = [];
  private zTex?: THREE.Texture;
  private sparks: { m: THREE.Mesh; life: number; v: THREE.Vector3 }[] = [];

  constructor(private world: World) {
    settings.on('reactions', (on) => {
      if (!on) this.alarm.by.clear();
    });
  }

  private get loudOk() {
    return settings.get('reactions');
  }

  /** an office-wide sound that must not pile up when several things happen at once */
  private loud(name: SfxName, gap: number) {
    const t = this.world.time;
    if (t - (this.lastLoud.get(name) ?? -99) < gap) return false;
    this.lastLoud.set(name, t);
    this.world.sfx.play(name);
    return true;
  }

  /** seated colleagues of the same team */
  private mates(w: Worker) {
    return [...this.world.workers.values()].filter((o) => o !== w && !o.intern && o.thread.team === w.thread.team && o.mode === 'seated' && !o.moving);
  }

  // ---------------------------------------------------------------- events

  onEvent(e: ThreadEvent, w: Worker) {
    const W = this.world;
    if (e.type === 'tool') {
      if (w.intern || w.mode !== 'seated' || w.moving) return;
      w.desk!.popIcon(e.kind);
      w.showTool(e.kind);
      if (!w.bubble && R() < 0.3) w.say(e.label, 2.2, 'tool');
      // looking something up on the web: over to the bookshelf, if nobody needs them at the desk right now
      if (e.kind === 'web' && !w.busy && W.time - w.lastBooks > 75 && W.spotFree('books')) {
        w.lastBooks = W.time;
        w.startErrand('books');
      }
    } else if (e.type === 'compact') {
      if (w.intern || w.mode !== 'seated') return;
      const quiet = () => {
        w.say(S.compacted, 3);
        W.sfx.play('shred');
      };
      w.queue(() => w.startErrand('shred'), 20, quiet);
    } else if (e.type === 'pr') {
      const label = clip(e.label);
      if (e.state === 'opened') {
        w.say(S.prOpened(label), 5, 'good');
        w.queue(() => w.react('proud', 2.8), 25);
        return;
      }
      w.say(S.prMerged(label), 6, 'good');
      const small = () => w.react('proud', 3);
      if (!this.loudOk || w.intern) w.queue(small, 25);
      else
        w.queue(() => w.startErrand('gong', label), 45, () => {
          // never got to the gong: the party happens at the desk
          small();
          this.celebrate(w);
        });
    } else if (e.type === 'ci') {
      if (e.ok) {
        this.alarm.by.delete(e.id);
        w.say(pick(S.ciGreen), 4.5, 'good');
        w.queue(() => w.react('sitIdle', 2.6, { wipe: true }), 20);
        return;
      }
      w.say(S.ciFailed(clip(e.label)), 6, 'bad');
      w.queue(() => w.react('headInHands', 7), 25);
      if (!this.loudOk) return;
      this.alarm.by.add(e.id);
      this.alarm.until = W.time + ALARM_SECS;
      this.loud('alarm', 12);
      // the team looks up at the warning light
      const beacon = W.office.spots.knock[0];
      let said = 0;
      for (const o of this.mates(w)) {
        if (o.busy) continue;
        const yaw = Math.atan2(beacon.x - o.x, beacon.z - o.z) - o.heading;
        o.react('lookUp', between(3, 4.5), { yaw: THREE.MathUtils.clamp(Math.atan2(Math.sin(yaw), Math.cos(yaw)), -1.3, 1.3) });
        if (said++ < 2 && !o.bubble) o.say(pick(S.alarmMate), 2.5);
      }
      follow(() => (w.mode !== 'gone' && !w.hidden ? w.ch.root.position : null), 4, 6, 'ci-failed');
    } else if (e.type === 'tests') {
      if (!e.ok) {
        if (!w.bubble) w.say(pick(S.testsRed), 3.5, 'bad');
        if (!w.intern) w.queue(() => w.react('facepalm', 3.5), 12);
        return;
      }
      if (!w.bubble) w.say(pick(S.testsGreen), 3, 'good');
      if (w.intern || W.time - w.lastFive < 40) return;
      w.lastFive = W.time;
      w.queue(() => this.highFive(w), 10);
    }
  }

  /** Confetti over the team's desks, and the colleagues who are there cheer. */
  private celebrate(w: Worker) {
    const team = w.thread.team;
    for (const d of this.world.desks) if (d.present && d.occupant && d.seat.team === team) d.burstConfetti(true);
    let said = 0;
    for (const o of this.mates(w)) {
      if (o.busy) continue;
      o.react('cheerSeated', between(2.6, 3.6));
      if (said++ < 2) o.say(pick(S.cheerMate), 2.8, 'good');
    }
  }

  /** The agent's mallet reaches the gong (their PR was merged). */
  gongStruck(w: Worker, label: string) {
    const W = this.world;
    W.office.gong.hit();
    this.loud('gong', 3);
    this.loud('ding', 1);
    w.say(S.prMerged(label), 5, 'good');
    this.celebrate(w);
    const at = W.office.spots.gong[0];
    this.burst(new THREE.Vector3(at.x - 0.3, 1.2, at.z - 0.5), 10);
    cue('pr-merged', at, 2, 6);
  }

  /** Somebody clicked the gong. */
  ringGong() {
    this.world.office.gong.hit();
    this.world.sfx.play('gong');
  }

  /** Tests are green: slap hands with the nearest colleague of the team, or cheer alone. */
  private highFive(w: Worker): boolean {
    const W = this.world;
    const d = w.desk!;
    const near = (o: Worker) => Math.hypot(o.desk!.seat.x - d.seat.x, o.desk!.seat.z - d.seat.z);
    const mate = W.time - this.lastFive > 12 ? this.mates(w).filter((o) => !o.busy && o.desk && o.desk.powered && near(o) < 4.5).sort((a, b) => near(a) - near(b))[0] : undefined;
    if (!mate || !w.startErrand('highfive', mate.thread.id)) return w.react('proud', 2.2);
    this.lastFive = W.time;
    return true;
  }

  /** The two hands meet. */
  slap(a: Worker, b: Worker) {
    this.burst(new THREE.Vector3((a.x + b.x) / 2, 1.95 * a.ch.scale, (a.z + b.z) / 2), 9);
    this.world.sfx.play('clap');
    a.say(pick(S.highFive), 2.2, 'good');
  }

  // ---------------------------------------------------------------- meetings

  /** A subagent walked in for this agent: once it sits, the two (or more) of them meet. */
  internArrived(parentId: string) {
    if (this.world.time - (this.lastMeet.get(parentId) ?? -999) < 60) return;
    this.pendingMeet.set(parentId, this.world.time + 4);
  }

  private interns(parentId: string) {
    return [...this.world.workers.values()].filter((o) => o.thread.parentId === parentId && !o.thread.settled && o.mode !== 'gone' && o.mode !== 'leaving' && o.mode !== 'pack');
  }

  private tryMeeting(parent: Worker, force = false): boolean {
    const W = this.world;
    if (this.meeting || W.time - this.meetingEnded < 15) return false;
    if (parent.intern || parent.mode !== 'seated' || parent.moving || parent.busy || parent.thread.settled) return false;
    if (parent.thread.status === 'waiting' || parent.thread.status === 'failed') return false;
    const all = this.interns(parent.thread.id);
    // not while one of them is still on the way in, unless it takes too long
    if (!force && all.some((o) => o.mode === 'walk')) return false;
    const seats = W.office.spots.meeting;
    if (!seats || seats.some((s) => s.taken)) return false;
    const order = [2, 5, 1, 4, 3, 6];
    const interns = all.filter((o) => o.mode === 'seated' && !o.moving).slice(0, order.length);
    if (!interns.length) return false;
    const screen = W.office.rooms.meeting.screen;
    const m: Meeting = { parent, members: [parent, ...interns], t: 0, dur: between(15, 25), live: false, age: 0, talkAt: 0.8, talks: 0, paintT: 0, saved: screen.g.getImageData(0, 0, 68, 44) };
    parent.startErrand('meeting', undefined, seats[0]);
    interns.forEach((o, i) => o.startErrand('meeting', undefined, seats[order[i]]));
    this.meeting = m;
    this.lastMeet.set(parent.thread.id, W.time);
    cue('meeting', W.office.rooms.meeting.center, 1, 8);
    return true;
  }

  private inMeeting(o: Worker) {
    return o.errand?.kind === 'meeting' && o.errand.spot?.taken === o.thread.id && (o.mode === 'errand' || o.mode === 'walk');
  }

  private endMeeting() {
    const m = this.meeting;
    if (!m) return;
    this.meeting = undefined;
    this.meetingEnded = this.world.time;
    const screen = this.world.office.rooms.meeting.screen;
    screen.g.putImageData(m.saved, 0, 0);
    screen.tex.needsUpdate = true;
    for (const o of m.members) if (this.inMeeting(o)) o.returnToDesk();
  }

  private updateMeeting(dt: number) {
    const W = this.world;
    for (const [id, at] of this.pendingMeet) {
      if (W.time < at) continue;
      const parent = W.workers.get(id);
      const late = W.time > at + 30;
      if (!parent || late || this.tryMeeting(parent, W.time > at + 14)) this.pendingMeet.delete(id);
    }
    // now and then, an agent with a whole team of subagents calls them together again
    if ((this.meetCheckT -= dt) <= 0) {
      this.meetCheckT = 15;
      for (const p of W.workers.values()) {
        if (p.intern || W.time - (this.lastMeet.get(p.thread.id) ?? -999) < 120 || this.interns(p.thread.id).length < 2) continue;
        if (R() < 0.4 && this.tryMeeting(p)) break;
      }
    }
    const m = this.meeting;
    if (!m) return;
    m.age += dt;
    m.members = m.members.filter((o) => this.inMeeting(o));
    if (!m.members.includes(m.parent) || m.members.length < 2) return this.endMeeting();
    const seated = m.members.filter((o) => o.mode === 'errand' && !o.moving);
    if (!m.live) {
      if (seated.includes(m.parent) && seated.length > 1) m.live = true;
      else if (m.age > 35) return this.endMeeting();
      else return;
    }
    m.t += dt;
    if (m.t > m.dur) {
      m.parent.say(pick(S.meetingClose), 2.5);
      return this.endMeeting();
    }
    if (m.t > m.talkAt && m.t < m.dur - 2.5) {
      m.talkAt = m.t + between(2.8, 4.2);
      const others = seated.filter((o) => o !== m.parent);
      if (m.talks++ % 2 === 0) m.parent.say(m.talks === 1 ? pick(S.meetingOpen) : pick(S.meetingOpen.slice(1)), 2.6);
      else if (others.length) pick(others).say(pick(S.meetingReply), 2.6);
    }
    if ((m.paintT -= dt) <= 0) {
      m.paintT = 0.4;
      this.paintMeeting(m);
    }
  }

  /** The wall screen during a meeting: the agent's name and one line per subagent that gets ticked off. */
  private paintMeeting(m: Meeting) {
    const { g, tex } = this.world.office.rooms.meeting.screen;
    g.fillStyle = '#101820';
    g.fillRect(0, 0, 68, 44);
    g.fillStyle = '#7dffb0';
    g.font = '8px "Silkscreen"';
    g.textAlign = 'left';
    g.textBaseline = 'alphabetic';
    g.fillText(`${S.screenPlan} ${m.parent.thread.name}`.toUpperCase().slice(0, 11), 3, 9);
    g.fillStyle = '#2c3a44';
    g.fillRect(3, 12, 62, 1);
    const rows = THREE.MathUtils.clamp(m.members.length + 1, 3, 5);
    const k = m.t / m.dur;
    for (let i = 0; i < rows; i++) {
      const y = 16 + i * 6;
      const done = k > (i + 0.8) / rows, now = !done && k > (i - 0.2) / rows;
      g.fillStyle = done ? '#3ad8c0' : '#5a6a76';
      g.fillRect(3, y, 4, 4);
      g.fillStyle = '#101820';
      if (!done) g.fillRect(4, y + 1, 2, 2);
      g.fillStyle = done ? '#3ad8c0' : now ? '#ffd36b' : '#8fa0ac';
      g.fillRect(10, y + 1, 16 + ((i * 11) % 14), 2);
      if (now) {
        // the item under discussion fills up
        const f = THREE.MathUtils.clamp((k - (i - 0.2) / rows) * rows, 0, 1);
        g.fillStyle = '#2c3a44';
        g.fillRect(46, y + 1, 19, 2);
        g.fillStyle = '#ffd36b';
        g.fillRect(46, y + 1, Math.round(19 * f), 2);
      } else if (done) {
        g.fillStyle = '#3ad8c0';
        g.fillRect(60, y + 2, 1, 1);
        g.fillRect(61, y + 3, 1, 1);
        g.fillRect(62, y + 2, 1, 1);
        g.fillRect(63, y + 1, 1, 1);
        g.fillRect(64, y, 1, 1);
      }
    }
    tex.needsUpdate = true;
  }

  /** who the running meeting belongs to (for tests and the inspector) */
  get meetingOf(): string | undefined {
    return this.meeting?.parent.thread.id;
  }

  /** Call a meeting of this agent and its subagents right now (dev helper; the normal triggers do the same). */
  callMeeting(parentId: string) {
    const p = this.world.workers.get(parentId);
    return !!p && this.tryMeeting(p, true);
  }

  // ---------------------------------------------------------------- naps

  /** Nothing happened in this thread for hours (or it is the middle of the night): time for a pod. */
  wantsNap(w: Worker) {
    const t = w.thread;
    if (t.status !== 'idle' || w.intern || t.settled || !t.lastActiveAt) return false;
    const quiet = Date.now() - t.lastActiveAt;
    const h = this.world.now.getHours();
    return quiet > NAP_AFTER || ((h >= 23 || h < 6) && quiet > NAP_AFTER_NIGHT);
  }

  /** A little z drifts up from a sleeper's head. */
  zzz(at: THREE.Vector3) {
    if (this.zs.length > 16) return;
    // an opaque little tile like the tool icons (the effects layer has no soft edges)
    this.zTex ??= canvasTexture(7, 7, (g) => {
      g.fillStyle = '#39406a';
      g.fillRect(0, 0, 7, 7);
      g.fillStyle = '#ffffff';
      g.fillRect(1, 1, 5, 1);
      g.fillRect(1, 5, 5, 1);
      for (let i = 0; i < 3; i++) g.fillRect(4 - i, 2 + i, 1, 1);
    });
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.zTex, transparent: true, depthWrite: false, depthTest: false }));
    s.position.copy(at);
    s.scale.setScalar(0.16);
    this.world.scene.add(fx(s));
    this.zs.push({ s, life: 0, vx: between(0.05, 0.14) });
  }

  private burst(at: THREE.Vector3, n: number) {
    const cols = ['#ffd36b', '#ffffff', '#ff9fe0', '#6ee0c0'];
    for (let i = 0; i < n; i++) {
      const m = new THREE.Mesh(SPARK_GEO, glow(pick(cols), 1.5));
      m.position.copy(at);
      this.world.scene.add(fx(m));
      const a = R() * Math.PI * 2;
      this.sparks.push({ m, life: 0, v: new THREE.Vector3(Math.cos(a) * between(0.5, 1.3), between(0.6, 1.9), Math.sin(a) * between(0.5, 1.3)) });
    }
  }

  private updateParticles(dt: number) {
    for (let i = this.zs.length - 1; i >= 0; i--) {
      const z = this.zs[i];
      z.life += dt;
      z.s.position.y += dt * 0.28;
      z.s.position.x += dt * z.vx;
      z.s.scale.setScalar(0.16 + z.life * 0.09);
      z.s.material.opacity = Math.min(1, (2.4 - z.life) / 0.8);
      if (z.life > 2.4) {
        z.s.removeFromParent();
        z.s.material.dispose();
        this.zs.splice(i, 1);
      }
    }
    for (let i = this.sparks.length - 1; i >= 0; i--) {
      const p = this.sparks[i];
      p.life += dt;
      p.v.y -= 5 * dt;
      p.m.position.addScaledVector(p.v, dt);
      p.m.rotation.x += dt * 9;
      p.m.scale.setScalar(Math.max(0.05, 1 - p.life / 0.8));
      if (p.life > 0.8) {
        p.m.removeFromParent();
        (p.m.material as THREE.Material).dispose();
        this.sparks.splice(i, 1);
      }
    }
  }

  // ---------------------------------------------------------------- server room

  private updateServers(dt: number) {
    const W = this.world;
    let n = 0, tps = 0;
    for (const t of W.source.threads()) {
      if (t.status !== 'running' || t.settled) continue;
      n++;
      tps += t.tps;
    }
    // a handful of agents keeps the room cool; it takes about sixteen of them at full speed to make it glow
    const x = Math.min(1.1, (0.6 * n) / 16 + (0.4 * tps) / 2400);
    const raw = this.forceLoad ?? Math.min(1, 0.08 + 0.92 * Math.pow(x, 1.6));
    this.load += (raw - this.load) * (1 - Math.exp(-dt / (this.forceLoad === null ? 6 : 1)));
    W.office.rooms.server.setLoad(this.load);
    if (this.load < HOT || W.time < this.serverCheckAt) return;
    if ([...W.workers.values()].some((o) => o.errand?.kind === 'server' && o.mode !== 'seated')) return;
    const idle = [...W.workers.values()].filter((o) => !o.intern && o.mode === 'seated' && !o.moving && !o.busy && o.thread.status === 'idle' && !o.thread.settled);
    if (!idle.length) return;
    this.serverCheckAt = W.time + between(40, 70);
    if (pick(idle).startErrand('server')) cue('server-hot', W.office.rooms.server.center, 2, 7);
  }

  // ---------------------------------------------------------------- quota

  /** The provider's quota pools as the quota wall shows them; call it from the main loop. */
  setUsage(groups: UsageGroup[]) {
    const W = this.world;
    const left = new Map<Provider, number>();
    for (const g of groups) {
      this.labels.set(g.provider, g.label);
      if (g.pools.length) left.set(g.provider, Math.min(...g.pools.map((p) => p.left)));
    }
    for (const [k, v] of this.forced) {
      if (k === 'all') for (const p of new Set<Provider>([...left.keys(), 'claude', 'codex', 'cursor', 'gemini'])) left.set(p, this.forced.get(p) ?? v);
      else left.set(k as Provider, v);
    }
    const b = this.budget;
    const was = new Set(b.out);
    b.out.clear();
    b.min = 1;
    for (const [p, v] of left) {
      b.min = Math.min(b.min, v);
      if (v <= 0.002) b.out.add(p);
    }
    b.stress = b.out.size ? 3 : b.min < 0.1 ? 2 : b.min < 0.25 ? 1 : 0;
    const visible = (p: Provider) => [...W.workers.values()].filter((o) => o.thread.provider === p && !o.intern && !o.hidden && o.mode !== 'gone');
    for (const p of b.out) {
      if (was.has(p)) continue;
      // the lights go out for everybody on this provider
      const hit = visible(p);
      hit.slice(0, 3).forEach((o, i) => setTimeout(() => o.say(pick(S.noQuota), 4, 'bad'), 300 + i * 700));
      W.bossSay(BOSS.budgetOut(this.labels.get(p) ?? p));
      if (this.loudOk) this.loud('error', 5);
      const first = hit.find((o) => o.mode === 'seated');
      if (first) cue('quota-out', { x: first.x, z: first.z }, 3, 6);
    }
    for (const p of was) {
      if (b.out.has(p)) continue;
      visible(p).slice(0, 2).forEach((o, i) => setTimeout(() => o.say(pick(S.quotaBack), 3.5, 'good'), 300 + i * 700));
      if (!b.out.size) W.bossSay(BOSS.budgetBack);
    }
  }

  /**
   * Pretend a provider ('claude', 'codex', …, or 'all') has this share of its quota left (0..1); null removes the
   * override again. For trying the budget drama without waiting for a real limit.
   */
  forceQuota(provider: Provider | 'all', left: number | null) {
    if (left === null) this.forced.delete(provider);
    else this.forced.set(provider, left);
  }

  isOut(provider: Provider) {
    return this.budget.out.has(provider);
  }

  // ---------------------------------------------------------------- per frame

  update(dt: number) {
    const W = this.world;
    const on = this.alarm.by.size > 0 && W.time < this.alarm.until;
    if (on !== this.alarm.on) {
      this.alarm.on = on;
      W.office.alarm.set(on);
      if (!on) this.alarm.by.clear();
    }
    this.updateMeeting(dt);
    this.updateServers(dt);
    this.updateParticles(dt);
    // desks of a provider without quota are dark, whether their agent sits there or not
    const out = this.budget.out;
    for (const d of W.desks) {
      const o = d.occupant ? W.workers.get(d.occupant) : undefined;
      d.setPower(!(o && out.has(o.thread.provider)));
    }
  }

  /** the warning light is on */
  get alarmOn() {
    return this.alarm.on;
  }
}

import { ROOM } from './office';

/**
 * Director camera: for a second screen the camera moves by itself. Without news it does slow establishing moves
 * (a turn over the whole office, a travelling shot, a push-in, a walk with someone); when something happens it
 * glides or cuts there, holds for a few seconds and goes back.
 *
 *   director.cue('pr-merged', { x, z }, 3, 6);                    // look at a place for 6 s
 *   director.follow(() => dog.alive ? dog.position : null, 1, 8);  // stay with something that moves
 *
 * Priorities used so far: 0 establishing, 1 nice to see, 2 arrival / completion, 3 waiting on you / boss order,
 * 4 failure. A higher priority takes over the running shot, an equal or lower one waits its turn (and is dropped
 * when it is stale by then).
 */

export interface XZ {
  x: number;
  z: number;
}

/** What the camera looks at: a floor point in the middle of the picture, turn and tilt in degrees, zoom (1 = whole office). */
export interface Pose extends XZ {
  az: number;
  el: number;
  zoom: number;
}

/** The camera as main.ts owns it. */
export interface CameraRig {
  /** where the camera is heading right now */
  pose(): Pose;
  /** the default view of the whole office */
  homePose(): Pose;
  /** send the camera there; `cut` jumps instead of easing */
  apply(p: Pose, cut: boolean): void;
  /** half the picture height in world units at zoom 1 */
  half(): number;
  /** something else has the camera (a close-up, an overlay) */
  busy(): boolean;
}

interface Cue {
  kind: string;
  getPos: () => XZ | null;
  priority: number;
  hold: number;
  at: number;
}

interface Shot {
  kind: string;
  priority: number;
  /** the move itself runs from a to b over lead + dur seconds */
  a: Pose;
  b: Pose;
  dur: number;
  /** seconds of easing over from where the camera was; 0 is a cut */
  lead: number;
  from: Pose;
  t: number;
  /** seconds before a more important cue may interrupt (failures only wait MIN_SHOT) */
  guard: number;
  getPos?: () => XZ | null;
}

/** shots never change faster than this */
const MIN_SHOT = 2.5;
/** two hard cuts are at least this far apart; in between the camera glides */
const MIN_CUT = 5;
/** a cue nobody got around to showing is forgotten */
const STALE = 14;
/** half the picture height of a close shot, in world units */
const CLOSE_HALF = 5;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const smooth = (x: number) => x * x * (3 - 2 * x);
const mix = (a: number, b: number, k: number) => a + (b - a) * k;
const mixPose = (a: Pose, b: Pose, k: number): Pose => ({
  x: mix(a.x, b.x, k),
  z: mix(a.z, b.z, k),
  az: mix(a.az, b.az, k),
  el: mix(a.el, b.el, k),
  zoom: Math.exp(mix(Math.log(a.zoom), Math.log(b.zoom), k)),
});

/** The one director of the page; main.ts puts it here so any module can reach it without being handed a reference. */
export const stage: { director: Director | null } = { director: null };
/** `stage.director?.cue(…)`: does nothing while the director is off or not there yet */
export const cue = (kind: string, pos: XZ, priority = 1, holdSeconds = 5) => stage.director?.cue(kind, pos, priority, holdSeconds);
/** `stage.director?.follow(…)` */
export const follow = (getPos: () => XZ | null, priority = 1, holdSeconds = 8, kind = 'follow') => stage.director?.follow(getPos, priority, holdSeconds, kind);

export class Director {
  enabled = false;
  private shot: Shot | null = null;
  private pending: Cue[] = [];
  private time = 0;
  private pausedUntil = 0;
  private lastCut = -99;
  private count = 0;
  /** cue shots since the last establishing one */
  private streak = 0;

  /** `wander` may offer somebody to walk along with when nothing else is going on */
  constructor(private rig: CameraRig, private wander?: () => (() => XZ | null) | null) {}

  setEnabled(on: boolean) {
    if (on === this.enabled) return;
    this.enabled = on;
    this.shot = null;
    this.pending = [];
    this.pausedUntil = 0;
    if (!on) this.rig.apply(this.rig.homePose(), false);
  }

  /** Look at a place: glide or cut there and hold for `holdSeconds`. */
  cue(kind: string, pos: XZ, priority = 1, holdSeconds = 5) {
    const p = { x: pos.x, z: pos.z };
    this.add({ kind, getPos: () => p, priority, hold: holdSeconds, at: this.time });
  }

  /** Stay with something that moves; `getPos` is asked every frame and ends the shot by returning null. */
  follow(getPos: () => XZ | null, priority = 1, holdSeconds = 8, kind = 'follow') {
    this.add({ kind, getPos, priority, hold: holdSeconds, at: this.time });
  }

  /** Hands the camera back to the user for a while (any pointer or key input does this). */
  pause(seconds = 20) {
    if (!this.enabled) return;
    this.pausedUntil = Math.max(this.pausedUntil, this.time + seconds);
    this.shot = null;
  }

  /** for the HUD and for tests */
  get state() {
    return { enabled: this.enabled, paused: this.time < this.pausedUntil, shot: this.shot?.kind ?? null, priority: this.shot?.priority ?? 0, pending: this.pending.length };
  }

  private add(c: Cue) {
    if (!this.enabled) return;
    const p = c.getPos();
    if (!p) return;
    // several events about the same thing at the same place are one shot
    const same = (kind: string, q: XZ | null | undefined) => kind === c.kind && !!q && Math.hypot(q.x - p.x, q.z - p.z) < 1.5;
    if (this.pending.some((o) => same(o.kind, o.getPos()))) return;
    if (this.shot && this.shot.priority > 0 && same(this.shot.kind, this.shot.b)) return;
    this.pending.push(c);
    // on a busy day only the most important few wait in line
    if (this.pending.length > 6) this.pending.splice(this.pending.indexOf(this.pending.reduce((p, o) => (o.priority < p.priority || (o.priority === p.priority && o.at < p.at) ? o : p))), 1);
  }

  /** keeps a pose inside the building: the closer the shot, the further it may leave the middle (ROOM is read live) */
  private fit(p: Pose): Pose {
    const home = this.rig.homePose();
    const zoom = clamp(p.zoom, 0.25, 1.05);
    const free = Math.max(0, 1 - zoom);
    const ex = ((ROOM.maxX - ROOM.minX) / 2) * free, ez = ((ROOM.maxZ - ROOM.minZ) / 2) * free;
    return { x: home.x + clamp(p.x - home.x, -ex, ex), z: home.z + clamp(p.z - home.z, -ez, ez), az: clamp(p.az, home.az - 12, home.az + 12), el: clamp(p.el, 26, 42), zoom };
  }

  private closeZoom() {
    return clamp(CLOSE_HALF / this.rig.half(), 0.3, 0.7);
  }

  /** starts a shot: a hard cut when the place is out of the picture (and the last cut is a while ago), else a glide */
  private start(kind: string, priority: number, a: Pose, b: Pose, dur: number, getPos?: () => XZ | null) {
    const from = this.rig.pose();
    a = this.fit(a);
    b = this.fit(b);
    const dist = Math.hypot(a.x - from.x, a.z - from.z);
    const outside = dist > this.rig.half() * from.zoom * 0.9;
    const cut = outside && this.time - this.lastCut >= MIN_CUT;
    if (cut) this.lastCut = this.time;
    const lead = cut ? 0 : clamp(dist / 3 + Math.abs(Math.log(a.zoom / from.zoom)) * 2.2 + Math.abs(a.az - from.az) * 0.08, 2, 5);
    this.shot = { kind, priority, a, b, dur, lead, from, t: 0, guard: MIN_SHOT, getPos };
    this.count++;
  }

  private startCue(c: Cue) {
    const p = c.getPos();
    if (!p) return;
    const home = this.rig.homePose();
    const zoom = this.closeZoom();
    const az = home.az + (this.count % 2 ? 7 : -7);
    // a slow push-in keeps the held shot alive
    this.start(c.kind, c.priority, { ...p, az, el: 32, zoom }, { ...p, az, el: 32, zoom: zoom * 0.92 }, c.hold, c.getPos);
  }

  private establish() {
    // a wide shot that follows a run of close ones gets some time before the next cue may take over
    const guard = this.streak >= 3 ? 8 : MIN_SHOT;
    this.streak = 0;
    this.pick();
    if (this.shot) this.shot.guard = guard;
  }

  private pick() {
    const home = this.rig.homePose();
    const w = ROOM.maxX - ROOM.minX, d = ROOM.maxZ - ROOM.minZ;
    const dir = Math.random() < 0.5 ? 1 : -1;
    const kind = (['wide', 'pan', 'wander', 'push'] as const)[this.count % 4];
    const subject = kind === 'wander' ? this.wander?.() : null;
    const at = subject?.();
    if (subject && at) {
      const zoom = this.closeZoom() * 1.2;
      return this.start('wander', 0, { ...at, az: home.az - 5 * dir, el: 33, zoom }, { ...at, az: home.az + 3 * dir, el: 33, zoom }, 14, subject);
    }
    if (kind === 'wide') return this.start('wide', 0, { ...home, az: home.az - 6 * dir }, { ...home, az: home.az + 6 * dir, zoom: 0.94 }, 24);
    if (kind === 'pan') {
      const z = home.z + (Math.random() - 0.5) * d * 0.3;
      return this.start('pan', 0, { x: home.x - dir * w * 0.2, z, az: home.az - 4 * dir, el: 31, zoom: 0.6 }, { x: home.x + dir * w * 0.2, z, az: home.az + 2 * dir, el: 31, zoom: 0.6 }, 26);
    }
    const x = home.x + (Math.random() - 0.5) * w * 0.5, z = home.z + (Math.random() - 0.5) * d * 0.4;
    this.start('push', 0, { x: mix(home.x, x, 0.5), z: mix(home.z, z, 0.5), az: home.az + 5 * dir, el: 34, zoom: 0.85 }, { x, z, az: home.az, el: 32, zoom: 0.52 }, 22);
  }

  update(dt: number) {
    if (!this.enabled) return;
    this.time += dt;
    if (this.rig.busy()) {
      // a close-up or an overlay has the camera: step back, and give it a moment afterwards
      this.pausedUntil = Math.max(this.pausedUntil, this.time + 2);
      this.shot = null;
    }
    this.pending = this.pending.filter((c) => this.time - c.at < STALE);
    if (this.time < this.pausedUntil) return;

    const s = this.shot;
    const done = !s || s.t >= s.lead + s.dur;
    if (this.pending.length) {
      const best = this.pending.reduce((p, c) => (c.priority > p.priority || (c.priority === p.priority && c.at > p.at) ? c : p));
      // a running shot is only interrupted by something more important, and never before it had its minimum time
      // … and after a few close shots in a row the office gets a wide one, unless something went wrong
      const urgent = best.priority >= 4;
      const breather = done && this.streak >= 3 && !urgent;
      if (!breather && (done || (s.t >= (urgent ? MIN_SHOT : s.guard) && best.priority > s.priority))) {
        this.pending = this.pending.filter((c) => c !== best);
        this.streak++;
        this.startCue(best);
      }
    }
    if (!this.shot || this.shot.t >= this.shot.lead + this.shot.dur) this.establish();

    const sh = this.shot!;
    sh.t += dt;
    if (sh.getPos) {
      const p = sh.getPos();
      if (!p) sh.t = Math.max(sh.t, sh.lead + sh.dur);
      else {
        // stay with the subject, without copying every little step
        const k = 1 - Math.exp(-dt * 2.5);
        const tx = sh.a.x + (p.x - sh.a.x) * k, tz = sh.a.z + (p.z - sh.a.z) * k;
        const f = this.fit({ ...sh.a, x: tx, z: tz });
        sh.a.x = sh.b.x = f.x;
        sh.a.z = sh.b.z = f.z;
      }
    }
    const move = mixPose(sh.a, sh.b, smooth(clamp(sh.t / (sh.lead + sh.dur), 0, 1)));
    const cut = sh.lead === 0 && sh.t <= dt;
    this.rig.apply(sh.lead > 0 && sh.t < sh.lead ? mixPose(sh.from, move, smooth(sh.t / sh.lead)) : move, cut);
  }
}

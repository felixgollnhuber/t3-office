/** Generative lo-fi: every track is a seed that picks key, chords, groove, instruments and atmosphere. */

import { S } from './i18n/music';

type Voice = 'rhodes' | 'pluck' | 'pad' | 'bell' | 'guitar' | 'organ' | 'kalimba';
type Scale = 'major' | 'minor' | 'dorian' | 'mixolydian';

export interface Track {
  id: string;
  title: string;
  artist: string;
  mood: string;
  bpm: number;
  root: number;
  scale: Scale;
  prog: number[];
  barsPerChord: number;
  ninths: boolean;
  chordVoice: Voice;
  leadVoice: Voice;
  kick: number[];
  snare: number[];
  hats: 'eighths' | 'sixteenths' | 'sparse' | 'shaker';
  swing: number;
  vinyl: number;
  cutoff: number;
  wobble: number;
  bassStyle: 'root' | 'walk' | 'sync';
  bars: number;
  seed: number;
}

const SCALES: Record<Scale, number[]> = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
};
const PROGS: Record<'bright' | 'dark', number[][]> = {
  bright: [[1, 4, 0, 5], [0, 5, 3, 4], [5, 3, 0, 4], [3, 4, 2, 5], [0, 3, 1, 4], [3, 2, 1, 0], [0, 2, 3, 3], [1, 4, 2, 5, 1, 4, 0, 0]],
  dark: [[0, 5, 2, 6], [0, 3, 6, 2], [3, 4, 0, 0], [1, 4, 0, 0], [0, 6, 5, 6], [5, 6, 0, 0], [0, 3, 0, 4], [0, 5, 3, 4, 0, 5, 6, 6]],
};
const KICKS = [[0, 10], [0, 7, 10], [0, 8], [0, 3, 10], [0, 6, 10, 14], [0, 10, 11]];
const SNARES = [[4, 12], [4, 12, 15], [4, 12, 14], [12], [4, 11, 12]];

const TITLES = S.titles;
const ARTISTS = S.artists;

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeTrack(i: number): Track {
  const r = rng(9001 + i * 7919);
  const p = <T,>(a: readonly T[]) => a[Math.floor(r() * a.length)];
  const scale = p<Scale>(['major', 'minor', 'dorian', 'mixolydian', 'minor', 'dorian']);
  const dark = scale === 'minor' || scale === 'dorian';
  const bpm = Math.round(68 + r() * 24);
  const dreamy = r() < 0.3;
  r();
  const chordVoice = p<Voice>(['rhodes', 'rhodes', 'pad', 'guitar', 'organ', 'rhodes', 'pluck']);
  const leadVoice = p<Voice>(['bell', 'kalimba', 'pluck', 'rhodes', 'bell', 'guitar']);
  const ninths = r() < 0.6;
  const mood = S.mood[dreamy ? 'dreamy' : bpm < 74 ? 'night' : ninths && !dark ? 'jazzy' : dark ? 'melancholy' : bpm > 84 ? 'sunny' : 'chillhop'];
  return {
    id: `lofi-${i}`,
    title: TITLES[i % TITLES.length],
    artist: ARTISTS[Math.floor(r() * ARTISTS.length)],
    mood,
    bpm,
    root: 45 + Math.floor(r() * 10),
    scale,
    prog: p(PROGS[dark ? 'dark' : 'bright']),
    barsPerChord: bpm < 74 && r() < 0.5 ? 2 : 1,
    ninths,
    chordVoice,
    leadVoice,
    kick: p(KICKS),
    snare: p(SNARES),
    hats: p(['eighths', 'sixteenths', 'sparse', 'shaker', 'eighths'] as const),
    swing: 0.08 + r() * 0.2,
    vinyl: 0.3 + r() * 0.7,
    cutoff: 1300 + r() * 1800,
    wobble: 4 + r() * 14,
    bassStyle: p(['root', 'walk', 'sync'] as const),
    bars: 40 + Math.floor(r() * 3) * 8,
    seed: i,
  };
}

export const TRACKS: Track[] = TITLES.map((_, i) => makeTrack(i));

const midi = (n: number) => 440 * Math.pow(2, (n - 69) / 12);

type Section = 'intro' | 'a' | 'b' | 'break' | 'outro';

/** Schedules one track at a time onto the given bus. */
export class LofiEngine {
  track?: Track;
  playing = false;
  bar = 0;
  private step = 0;
  private next = 0;
  private bus: GainNode;
  private filter: BiquadFilterNode;
  private wobbleOsc: OscillatorNode;
  private wobbleGain: GainNode;
  private motif: { step: number; deg: number; len: number }[] = [];
  private prevChord: number[] = [];
  private r = Math.random;
  onEnd?: () => void;
  /** seconds since the track started, for the progress bar */
  t0 = 0;

  constructor(private ctx: AudioContext, out: AudioNode, private noise: AudioBuffer) {
    this.filter = ctx.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.filter.Q.value = 0.6;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.ratio.value = 3;
    this.bus = ctx.createGain();
    this.bus.connect(this.filter).connect(comp).connect(out);
    this.wobbleOsc = ctx.createOscillator();
    this.wobbleOsc.frequency.value = 0.4;
    this.wobbleGain = ctx.createGain();
    this.wobbleOsc.connect(this.wobbleGain);
    this.wobbleOsc.start();
  }

  get beatSeconds() {
    return this.track ? 60 / this.track.bpm : 0.75;
  }

  /** 0..1 position inside the current beat, for nodding heads. */
  beatPhase() {
    if (!this.playing || !this.track) return 0;
    const b = (this.ctx.currentTime - this.t0) / this.beatSeconds;
    return b - Math.floor(b);
  }

  /** jump to a point in the arrangement (0..1); the next 16th starts right away */
  seek(frac: number) {
    if (!this.track) return;
    const bar = Math.floor(Math.max(0, Math.min(0.999, frac)) * this.track.bars);
    this.step = bar * 16;
    this.bar = bar;
    this.next = this.ctx.currentTime + 0.05;
    this.t0 = this.next - bar * 4 * this.beatSeconds;
  }

  get duration() {
    return this.track ? (this.track.bars * 4 * 60) / this.track.bpm : 0;
  }

  progress() {
    if (!this.track) return 0;
    return Math.min(1, (this.ctx.currentTime - this.t0) / ((this.track.bars * 4 * 60) / this.track.bpm));
  }

  play(t: Track) {
    this.track = t;
    this.playing = true;
    this.bar = 0;
    this.step = 0;
    this.next = this.ctx.currentTime + 0.1;
    this.t0 = this.next;
    const r = rng(t.seed * 31 + 5);
    this.r = r;
    this.filter.frequency.setTargetAtTime(t.cutoff, this.ctx.currentTime, 0.5);
    this.wobbleGain.gain.value = t.wobble;
    this.wobbleOsc.frequency.value = 0.25 + r() * 0.5;
    this.motif = [];
    let s = Math.floor(r() * 3);
    while (s < 32) {
      this.motif.push({ step: s, deg: Math.floor(r() * 5), len: 1 + Math.floor(r() * 3) });
      s += 2 + Math.floor(r() * 5);
    }
  }

  stop() {
    this.playing = false;
  }

  private section(bar: number): Section {
    const n = this.track!.bars;
    if (bar < 4) return 'intro';
    if (bar >= n - 4) return 'outro';
    const k = (bar - 4) % 24;
    if (k < 8) return 'a';
    if (k < 16) return 'b';
    if (k < 20) return 'break';
    return 'a';
  }

  private chordNotes(deg: number) {
    const t = this.track!;
    const sc = SCALES[t.scale];
    const at = (d: number) => t.root + 12 + sc[d % 7] + 12 * Math.floor(d / 7);
    const notes = [at(deg), at(deg + 2), at(deg + 4), at(deg + 6)];
    if (t.ninths) notes.push(at(deg + 8));
    // voice-lead into the previous chord's register
    const center = this.prevChord.length ? this.prevChord.reduce((a, b) => a + b, 0) / this.prevChord.length : t.root + 17;
    const out = notes.map((n) => {
      let m = n;
      while (m - center > 6) m -= 12;
      while (center - m > 6) m += 12;
      return m;
    });
    this.prevChord = out;
    return out;
  }

  update() {
    if (!this.playing || !this.track) return;
    const t = this.track;
    const sixteenth = 60 / t.bpm / 4;
    while (this.next < this.ctx.currentTime + 0.25) {
      const s = this.step % 16;
      const bar = Math.floor(this.step / 16);
      if (bar >= t.bars) {
        this.playing = false;
        this.onEnd?.();
        return;
      }
      this.bar = bar;
      const sec = this.section(bar);
      const swing = s % 2 === 1 ? t.swing * sixteenth : 0;
      const at = this.next + swing;
      const chordIdx = Math.floor(bar / t.barsPerChord) % t.prog.length;
      const deg = t.prog[chordIdx];
      const chordStart = s === 0 && bar % t.barsPerChord === 0;
      const r = this.r;

      if (chordStart) {
        const notes = this.chordNotes(deg);
        const len = sixteenth * 16 * t.barsPerChord;
        const vel = sec === 'intro' || sec === 'outro' ? 0.6 : sec === 'break' ? 0.75 : 1;
        notes.forEach((n, i) => this.voice(t.chordVoice, midi(n), len * 0.95, 0.045 * vel, at + i * 0.012 * (t.chordVoice === 'guitar' ? 2.5 : 1)));
      }
      // rhodes/guitar re-strike on the "and" of 3 for movement
      if (s === 10 && sec !== 'intro' && (t.chordVoice === 'guitar' || t.chordVoice === 'pluck') && r() < 0.6) {
        this.prevChord.forEach((n) => this.voice(t.chordVoice, midi(n), sixteenth * 5, 0.025, at));
      }

      const drums = sec === 'a' || sec === 'b' || (sec === 'break' && false);
      const lite = sec === 'break' || sec === 'intro';
      if (drums && t.kick.includes(s)) this.kick(at, 0.5);
      if ((drums || sec === 'break') && t.snare.includes(s)) this.snare(at, s === 15 || s === 11 || s === 14 ? 0.35 : 0.7);
      if (drums || (lite && bar % 2 === 1)) this.hats(s, at, lite ? 0.5 : 1);
      if (drums && s === 14 && bar % 4 === 3 && r() < 0.5) this.hat(at, 0.06, 0.22);

      if (drums || sec === 'break') this.bass(s, at, deg, sixteenth, sec === 'break' ? 0.5 : 1);

      if (sec === 'b' || (sec === 'a' && bar > 20)) {
        const pos = s + (bar % 2) * 16;
        for (const m of this.motif) {
          if (m.step !== pos) continue;
          if (r() < 0.15) continue;
          const sc = SCALES[t.scale];
          const penta = t.scale === 'major' || t.scale === 'mixolydian' ? [0, 1, 2, 4, 5] : [0, 2, 3, 4, 6];
          const d = penta[(m.deg + (bar % 8 >= 4 && r() < 0.4 ? 1 : 0)) % 5];
          const n = t.root + 24 + sc[d];
          this.voice(t.leadVoice, midi(n), sixteenth * m.len * 2, 0.05, at);
        }
      }

      if (r() < t.vinyl * 0.4) this.crackle(at + r() * sixteenth);
      this.next += sixteenth;
      this.step++;
    }
  }

  private osc(type: OscillatorType, f: number, at: number, dur: number, gain: number, attack = 0.008, dest: AudioNode = this.bus, detune = 0) {
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.value = f;
    o.detune.value = detune;
    this.wobbleGain.connect(o.detune);
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(gain, at + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    o.connect(g).connect(dest);
    o.start(at);
    o.stop(at + dur + 0.05);
    o.onended = () => this.wobbleGain.disconnect(o.detune);
    return { o, g };
  }

  private voice(v: Voice, f: number, dur: number, gain: number, at: number) {
    const ctx = this.ctx;
    switch (v) {
      case 'rhodes':
        this.osc('sine', f, at, dur, gain);
        this.osc('sine', f * 2, at, dur * 0.4, gain * 0.25);
        this.osc('triangle', f, at, dur * 0.7, gain * 0.35, 0.008, this.bus, 6);
        break;
      case 'pad': {
        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.value = 900;
        lp.connect(this.bus);
        this.osc('sawtooth', f, at, dur, gain * 0.35, dur * 0.3, lp, -8);
        this.osc('sawtooth', f, at, dur, gain * 0.35, dur * 0.3, lp, 8);
        break;
      }
      case 'pluck':
      case 'guitar': {
        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.setValueAtTime(v === 'pluck' ? 3200 : 2200, at);
        lp.frequency.exponentialRampToValueAtTime(v === 'pluck' ? 500 : 700, at + 0.35);
        lp.connect(this.bus);
        this.osc(v === 'pluck' ? 'sawtooth' : 'triangle', f, at, Math.min(dur, v === 'pluck' ? 0.9 : 1.6), gain * (v === 'pluck' ? 0.5 : 1.1), 0.004, lp);
        if (v === 'guitar') this.osc('sawtooth', f * 2, at, 0.3, gain * 0.15, 0.003, lp);
        break;
      }
      case 'organ':
        this.osc('square', f, at, dur, gain * 0.18, 0.04);
        this.osc('sine', f * 2, at, dur, gain * 0.3, 0.04);
        break;
      case 'bell':
        this.osc('sine', f, at, Math.min(dur * 2, 2.2), gain);
        this.osc('sine', f * 3.01, at, 0.5, gain * 0.25);
        break;
      case 'kalimba':
        this.osc('sine', f, at, 0.9, gain * 1.1, 0.002);
        this.osc('triangle', f * 4.2, at, 0.08, gain * 0.3, 0.001);
        break;
    }
  }

  private noiseHit(at: number, dur: number, gain: number, type: BiquadFilterType, freq: number, q = 1) {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, at);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    src.connect(f).connect(g).connect(this.bus);
    src.start(at, Math.random() * 0.8);
    src.stop(at + dur + 0.05);
  }

  private kick(at: number, gain: number) {
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.frequency.setValueAtTime(120, at);
    o.frequency.exponentialRampToValueAtTime(42, at + 0.18);
    g.gain.setValueAtTime(gain, at);
    g.gain.exponentialRampToValueAtTime(0.0001, at + 0.4);
    o.connect(g).connect(this.bus);
    o.start(at);
    o.stop(at + 0.45);
  }

  private snare(at: number, v: number) {
    this.noiseHit(at, 0.18, 0.22 * v, 'bandpass', 1800, 0.7);
    this.osc('triangle', 190, at, 0.09, 0.08 * v);
  }

  private hat(at: number, dur: number, gain: number) {
    this.noiseHit(at, dur, gain, 'highpass', 7000);
  }

  private hats(s: number, at: number, v: number) {
    const t = this.track!;
    if (t.hats === 'eighths' && s % 2 === 0) this.hat(at, 0.04, (s % 4 === 0 ? 0.07 : 0.045) * v);
    else if (t.hats === 'sixteenths') this.hat(at, 0.03, (s % 4 === 0 ? 0.06 : s % 2 === 0 ? 0.04 : 0.022) * v);
    else if (t.hats === 'sparse' && (s === 2 || s === 6 || s === 10 || s === 14)) this.hat(at, 0.05, 0.05 * v);
    else if (t.hats === 'shaker') this.noiseHit(at, 0.06, (s % 2 ? 0.03 : 0.05) * v, 'bandpass', 5200, 1.2);
  }

  private bass(s: number, at: number, deg: number, sixteenth: number, v: number) {
    const t = this.track!;
    const sc = SCALES[t.scale];
    const root = t.root - 12 + sc[deg % 7];
    const play = (n: number, len: number) => {
      this.osc('sine', midi(n), at, sixteenth * len, 0.2 * v, 0.01);
      this.osc('triangle', midi(n), at, sixteenth * len * 0.6, 0.05 * v, 0.01);
    };
    if (t.bassStyle === 'root' && (s === 0 || s === 10)) play(root, s === 0 ? 8 : 5);
    else if (t.bassStyle === 'sync' && (s === 0 || s === 7 || s === 10)) play(s === 7 ? root + 12 : root, 3);
    else if (t.bassStyle === 'walk' && s % 4 === 0) play(root + [0, sc[2], sc[4], sc[2]][s / 4], 3.5);
  }

  private crackle(at: number) {
    this.noiseHit(at, 0.012, 0.04 + Math.random() * 0.05, 'highpass', 2500);
  }
}

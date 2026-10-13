export type SfxName =
  | 'ding'
  | 'phone'
  | 'error'
  | 'coffee'
  | 'door'
  | 'flush'
  | 'pack'
  | 'coin'
  | 'ping'
  | 'shred'
  | 'boot'
  | 'knock'
  | 'microwave'
  | 'key'
  | 'build'
  | 'drip'
  | 'gong'
  | 'alarm'
  | 'clap'
  | 'fog'
  | 'bark'
  | 'yip'
  | 'meow'
  | 'purr'
  | 'hiss'
  | 'squeak'
  | 'vacOn'
  | 'vacOff'
  | 'vacDock'
  | 'bump';

/** Tiny WebAudio synth: every sound is generated, nothing is downloaded. */
export class Sfx {
  sounds = localStorage.getItem('office.sounds') !== '0';
  ctx?: AudioContext;
  musicBus?: GainNode;
  noise?: AudioBuffer;
  private master?: GainNode;
  private volume = { sfx: 0.7, music: 0.7 };
  private sfxBus?: GainNode;
  private rainGain?: GainNode;
  private rainTone?: BiquadFilterNode;
  private rainLevel = 0;
  private snowLevel = 0;
  private dripAcc = 0;
  private unlockFns: (() => void)[] = [];
  private last = new Map<SfxName, number>();
  private typingAcc = 0;

  onUnlock(fn: () => void) {
    if (this.ctx) fn();
    else this.unlockFns.push(fn);
  }

  /** Browsers only allow audio after a user gesture. */
  unlock() {
    if (this.ctx) {
      void this.ctx.resume();
      return;
    }
    const ctx = new AudioContext();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = 0.5;
    this.master.connect(ctx.destination);
    this.sfxBus = ctx.createGain();
    this.sfxBus.connect(this.master);
    this.musicBus = ctx.createGain();
    this.musicBus.gain.value = 0.55;
    this.musicBus.connect(this.master);
    const len = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

    // rain heard from inside: pink noise, muffled by the glass, breathing with slow gusts
    const rlen = ctx.sampleRate * 6;
    const pink = ctx.createBuffer(2, rlen, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const out = pink.getChannelData(c);
      let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
      for (let i = 0; i < rlen; i++) {
        const w = Math.random() * 2 - 1;
        b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.969 * b2 + w * 0.153852;
        b3 = 0.8665 * b3 + w * 0.3104856; b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
        out[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
        b6 = w * 0.115926;
      }
      // crossfade the loop seam so it never clicks
      const fade = ctx.sampleRate * 0.25;
      for (let i = 0; i < fade; i++) out[i] = out[i] * (i / fade) + out[rlen - fade + i] * (1 - i / fade);
    }
    const rain = ctx.createBufferSource();
    rain.buffer = pink;
    rain.loop = true;
    rain.loopStart = 0;
    rain.loopEnd = (rlen - ctx.sampleRate * 0.25) / ctx.sampleRate;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 90;
    this.rainTone = ctx.createBiquadFilter();
    this.rainTone.type = 'lowpass';
    this.rainTone.frequency.value = 700;
    this.rainTone.Q.value = 0.3;
    const gust = ctx.createGain();
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.06;
    const depth = ctx.createGain();
    depth.gain.value = 0.22;
    lfo.connect(depth).connect(gust.gain);
    gust.gain.value = 0.78;
    lfo.start();
    this.rainGain = ctx.createGain();
    this.rainGain.gain.value = 0;
    rain.connect(hp).connect(this.rainTone).connect(gust).connect(this.rainGain).connect(this.sfxBus);
    rain.start();
    this.setVolume(this.volume.sfx, this.volume.music);
    for (const fn of this.unlockFns) fn();
    this.unlockFns = [];
  }

  /** rain 0..1 and, instead of it, snowfall 0..1: no patter then, only a low muffled hush */
  setRain(level: number, snow = 0) {
    this.rainLevel = level;
    this.snowLevel = snow;
    if (!this.ctx || !this.rainGain || !this.rainTone) return;
    // heavier rain gets a little brighter, but stays well below the harsh range; snow swallows the highs
    const hush = Math.max(0, snow - level), k = Math.min(1, hush * 1.6);
    this.rainGain.gain.setTargetAtTime(this.sounds ? Math.pow(level, 1.3) * 0.16 + Math.pow(hush, 0.8) * 0.07 : 0, this.ctx.currentTime, 1.2);
    this.rainTone.frequency.setTargetAtTime((600 + level * 650) * (1 - k) + 230 * k, this.ctx.currentTime, 1.2);
  }

  /** Distant thunder: a long low rumble, with a crack first when the strike is close. */
  thunder(near: number) {
    if (!this.sounds || !this.ready) return;
    const ctx = this.ctx!;
    if (near > 0.6) this.hiss(0.4, { gain: 0.1 * near, freq: 700, type: 'lowpass', q: 0.4 });
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise!;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(260 + near * 300, t);
    f.frequency.exponentialRampToValueAtTime(70, t + 4);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.35 + near * 0.35, t + 0.15 + (1 - near) * 0.5);
    for (let k = 1; k < 5; k++) g.gain.linearRampToValueAtTime((0.2 + Math.random() * 0.25) * (1 - k / 6), t + 0.4 + k * 0.55);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 4.5);
    src.connect(f).connect(g).connect(this.sfxBus!);
    src.start(t, Math.random());
    src.stop(t + 4.6);
  }

  get ready() {
    return !!this.ctx && this.ctx.state === 'running';
  }

  /** 0..1 each; 0.7 is the level the office was mixed at */
  setVolume(sfx: number, music: number) {
    this.volume = { sfx, music };
    if (!this.ctx) return;
    const gain = (v: number) => Math.pow(v / 0.7, 2);
    this.sfxBus!.gain.setTargetAtTime(gain(sfx), this.ctx.currentTime, 0.05);
    this.musicBus!.gain.setTargetAtTime(0.55 * gain(music), this.ctx.currentTime, 0.05);
  }

  setSounds(on: boolean) {
    this.sounds = on;
    localStorage.setItem('office.sounds', on ? '1' : '0');
    this.setRain(this.rainLevel, this.snowLevel);
  }


  private tone(freq: number, dur: number, opts: { type?: OscillatorType; gain?: number; at?: number; slide?: number; bus?: AudioNode } = {}) {
    const ctx = this.ctx!;
    const t = ctx.currentTime + (opts.at ?? 0);
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = opts.type ?? 'sine';
    o.frequency.setValueAtTime(freq, t);
    if (opts.slide) o.frequency.exponentialRampToValueAtTime(opts.slide, t + dur);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(opts.gain ?? 0.2, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(opts.bus ?? this.sfxBus!);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  private hiss(dur: number, opts: { gain?: number; at?: number; freq?: number; q?: number; type?: BiquadFilterType; attack?: number; bus?: AudioNode } = {}) {
    const ctx = this.ctx!;
    const t = ctx.currentTime + (opts.at ?? 0);
    const src = ctx.createBufferSource();
    src.buffer = this.noise!;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = opts.type ?? 'bandpass';
    f.frequency.value = opts.freq ?? 1200;
    f.Q.value = opts.q ?? 1;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(opts.gain ?? 0.15, t + (opts.attack ?? 0.01));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(opts.bus ?? this.sfxBus!);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.05);
  }

  private patter(gain: number, freq: number) {
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise!;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
    const pan = ctx.createStereoPanner();
    pan.pan.value = Math.random() * 1.6 - 0.8;
    src.connect(f).connect(g).connect(pan).connect(this.sfxBus!);
    src.start(t, Math.random());
    src.stop(t + 0.06);
  }

  play(name: SfxName) {
    if (!this.sounds || !this.ready) return;
    const now = performance.now();
    const minGap = name === 'key' || name === 'drip' ? 25 : name === 'pack' ? 120 : 250;
    if (now - (this.last.get(name) ?? 0) < minGap) return;
    this.last.set(name, now);
    switch (name) {
      case 'ding':
        this.tone(1318, 0.9, { type: 'triangle', gain: 0.12 });
        this.tone(1975, 0.7, { type: 'sine', gain: 0.06, at: 0.09 });
        break;
      case 'phone':
        for (let i = 0; i < 6; i++) this.tone(i % 2 ? 1180 : 1420, 0.07, { type: 'square', gain: 0.035, at: i * 0.075 });
        break;
      case 'error':
        this.tone(160, 0.35, { type: 'sawtooth', gain: 0.06 });
        this.tone(120, 0.4, { type: 'sawtooth', gain: 0.05, at: 0.18 });
        break;
      case 'coffee':
        this.hiss(2.6, { gain: 0.05, freq: 2400, q: 0.7, attack: 0.4 });
        this.tone(90, 1.4, { type: 'sawtooth', gain: 0.02 });
        break;
      case 'door':
        this.tone(220, 0.25, { type: 'triangle', gain: 0.05, slide: 180 });
        this.hiss(0.12, { gain: 0.05, freq: 500, at: 0.18 });
        break;
      case 'flush':
        this.hiss(1.6, { gain: 0.08, freq: 700, q: 0.5, attack: 0.15 });
        break;
      case 'pack':
        this.hiss(0.08, { gain: 0.08, freq: 300 + Math.random() * 200, q: 2 });
        break;
      case 'coin':
        this.tone(1568, 0.12, { type: 'square', gain: 0.04 });
        this.tone(2093, 0.3, { type: 'square', gain: 0.04, at: 0.08 });
        break;
      case 'ping':
        this.tone(1900 + Math.random() * 300, 0.05, { type: 'sine', gain: 0.07 });
        break;
      case 'shred':
        this.hiss(0.5, { gain: 0.05, freq: 3200, q: 3 });
        break;
      case 'boot':
        this.tone(523, 0.12, { type: 'triangle', gain: 0.05 });
        this.tone(784, 0.25, { type: 'triangle', gain: 0.05, at: 0.1 });
        break;
      case 'knock':
        for (let i = 0; i < 3; i++) this.tone(140, 0.08, { type: 'triangle', gain: 0.12, at: i * 0.16 });
        break;
      case 'microwave':
        for (let i = 0; i < 3; i++) this.tone(2000, 0.12, { type: 'square', gain: 0.03, at: i * 0.25 });
        break;
      case 'build':
        for (let i = 0; i < 4; i++) this.tone(300 + i * 90, 0.06, { type: 'square', gain: 0.03, at: i * 0.07 });
        this.hiss(0.15, { gain: 0.06, freq: 600, at: 0.3 });
        break;
      case 'gong':
        // a struck bronze disc: a low fundamental with slightly detuned partials that ring out
        this.hiss(0.06, { gain: 0.1, freq: 900, q: 0.8 });
        this.tone(98, 3.2, { type: 'sine', gain: 0.2, slide: 94 });
        this.tone(147.5, 2.6, { type: 'sine', gain: 0.1 });
        this.tone(233, 2.0, { type: 'triangle', gain: 0.07 });
        this.tone(311, 1.4, { type: 'sine', gain: 0.045, at: 0.01 });
        this.tone(498, 0.9, { type: 'sine', gain: 0.025, at: 0.01 });
        break;
      case 'alarm':
        // three two-tone hoots, short enough not to annoy
        for (let i = 0; i < 3; i++) {
          this.tone(620, 0.2, { type: 'square', gain: 0.035, at: i * 0.46, slide: 880 });
          this.tone(880, 0.2, { type: 'square', gain: 0.035, at: i * 0.46 + 0.21, slide: 620 });
        }
        break;
      case 'clap':
        this.hiss(0.07, { gain: 0.16, freq: 1700, q: 0.9 });
        this.hiss(0.05, { gain: 0.08, freq: 3400, q: 1.5, at: 0.012 });
        break;
      case 'drip':
        // a soft tap on the window sill, never a chirp
        this.patter(0.012 + Math.random() * 0.012, 500 + Math.random() * 600);
        break;
      case 'fog':
        // the fog machine: a long breathy hiss with a low valve thump under it
        this.hiss(2.6, { gain: 0.06, freq: 4200, q: 0.5, attack: 0.18 });
        this.hiss(2.2, { gain: 0.035, freq: 900, q: 0.6, attack: 0.3 });
        this.tone(70, 0.18, { type: 'triangle', gain: 0.05 });
        break;
      case 'bark':
        // a soft "wuff" from across the room, not a guard dog
        this.tone(330, 0.13, { type: 'sawtooth', gain: 0.045, slide: 170 });
        this.hiss(0.09, { gain: 0.04, freq: 900, q: 0.8 });
        break;
      case 'yip':
        this.tone(620, 0.08, { type: 'triangle', gain: 0.05, slide: 900 });
        this.tone(760, 0.1, { type: 'triangle', gain: 0.05, slide: 1100, at: 0.11 });
        break;
      case 'meow':
        this.tone(560, 0.22, { type: 'triangle', gain: 0.045, slide: 860 });
        this.tone(840, 0.34, { type: 'triangle', gain: 0.04, slide: 430, at: 0.16 });
        break;
      case 'purr':
        // a low rumble in little pulses
        for (let i = 0; i < 34; i++) this.tone(86 + (i % 2) * 6, 0.05, { type: 'sawtooth', gain: 0.022 + 0.012 * Math.sin(i * 0.4), at: i * 0.045 });
        break;
      case 'hiss':
        this.hiss(0.55, { gain: 0.07, freq: 5200, q: 0.8, attack: 0.05 });
        break;
      case 'squeak':
        this.tone(1500, 0.09, { type: 'sine', gain: 0.045, slide: 2200 });
        break;
      case 'vacOn':
        this.tone(660, 0.09, { type: 'square', gain: 0.03 });
        this.tone(880, 0.14, { type: 'square', gain: 0.03, at: 0.1 });
        this.hiss(1.1, { gain: 0.025, freq: 320, q: 0.7, attack: 0.35, at: 0.2 });
        break;
      case 'vacOff':
        this.tone(880, 0.09, { type: 'square', gain: 0.03 });
        this.tone(587, 0.16, { type: 'square', gain: 0.03, at: 0.1 });
        break;
      case 'vacDock':
        [523, 659, 784].forEach((f, i) => this.tone(f, 0.14, { type: 'triangle', gain: 0.04, at: i * 0.1 }));
        break;
      case 'bump':
        this.tone(105, 0.07, { type: 'triangle', gain: 0.05 });
        break;
      case 'key':
        this.hiss(0.025, { gain: 0.035, freq: 3000 + Math.random() * 2500, q: 4 });
        break;
    }
  }

  /** Keyboard clatter scales with how many agents are typing and how fast. */
  update(dt: number, typingRate: number) {
    if (!this.ready) return;
    if (this.sounds) {
      this.typingAcc += dt * Math.min(18, typingRate);
      while (this.typingAcc > 1) {
        this.typingAcc -= 1 + Math.random() * 0.6;
        this.play('key');
      }
      this.dripAcc += dt * this.rainLevel * 3;
      while (this.dripAcc > 1) {
        this.dripAcc -= 0.4 + Math.random() * 1.2;
        this.play('drip');
      }
    }
  }
}

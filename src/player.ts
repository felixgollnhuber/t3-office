import { LofiEngine, TRACKS, type Track } from './music';
import type { Sfx } from './audio';
import setList from './sets.json';

export interface Item {
  id: string;
  kind: 'lofi' | 'youtube';
  title: string;
  artist: string;
  mood: string;
  bpm: number;
  /** how much the office parties: 0 calm, 1 rave */
  energy: number;
  videoId?: string;
  start?: number;
  track?: Track;
}

/** YouTube sets live in sets.json; `node scripts/add-set.mjs <url>` analyses one for the light show and adds it there */
export const SETS: Item[] = (setList as { videoId: string; title: string; artist: string; bpm: number; start?: number }[]).map((s) => ({
  id: `yt-${s.videoId}`,
  kind: 'youtube',
  title: s.title,
  artist: s.artist,
  mood: 'Boiler Room',
  bpm: s.bpm,
  energy: 1,
  videoId: s.videoId,
  start: s.start,
}));

export const RADIO: Item[] = TRACKS.map((t) => ({ id: t.id, kind: 'lofi', title: t.title, artist: t.artist, mood: t.mood, bpm: t.bpm, energy: 0.3, track: t }));

interface YTPlayer {
  playVideo(): void;
  pauseVideo(): void;
  stopVideo(): void;
  loadVideoById(o: { videoId: string; startSeconds?: number }): void;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  setVolume(v: number): void;
  getCurrentTime(): number;
  getDuration(): number;
  destroy(): void;
}
declare global {
  interface Window {
    YT?: { Player: new (el: HTMLElement | string, o: unknown) => YTPlayer; PlayerState: Record<string, number> };
    onYouTubeIframeAPIReady?: () => void;
  }
}

let ytApi: Promise<void> | undefined;
function loadYouTube() {
  ytApi ??= new Promise<void>((resolve) => {
    if (window.YT?.Player) return resolve();
    window.onYouTubeIframeAPIReady = () => resolve();
    const s = document.createElement('script');
    s.src = 'https://www.youtube.com/iframe_api';
    document.head.appendChild(s);
  });
  return ytApi;
}

/** One deck: the generative radio or a YouTube set, plus likes. */
export class Player {
  current: Item;
  playing = false;
  likes: Set<string>;
  showLikes = false;
  /** the YouTube picture costs GPU time; by default only the sound plays */
  showVideo = localStorage.getItem('office.video') === '1';
  private engine?: LofiEngine;
  private yt?: YTPlayer;
  private ytStarted = 0;
  private ytVolume = 80;
  private listeners: (() => void)[] = [];
  /** where the last visit stopped: the first play of that track picks up there */
  private resume: { id: string; t: number } | null = null;
  private savedAt = 0;

  constructor(private sfx: Sfx, private ytHost: () => HTMLElement) {
    this.likes = new Set(JSON.parse(localStorage.getItem('office.likes') ?? '[]') as string[]);
    const last = localStorage.getItem('office.track');
    this.current = [...RADIO, ...SETS].find((i) => i.id === last) ?? RADIO[Math.floor(Math.random() * RADIO.length)];
    sfx.onUnlock(() => {
      this.engine = new LofiEngine(sfx.ctx!, sfx.musicBus!, sfx.noise!);
      this.engine.onEnd = () => this.next();
      if (localStorage.getItem('office.playing') === '1') void this.play(this.current);
    });
    try {
      this.resume = JSON.parse(localStorage.getItem('office.pos') ?? 'null') as { id: string; t: number } | null;
    } catch {
      this.resume = null;
    }
    window.addEventListener('pagehide', () => this.savePos());
  }

  onChange(fn: () => void) {
    this.listeners.push(fn);
  }
  private changed() {
    localStorage.setItem('office.track', this.current.id);
    localStorage.setItem('office.playing', this.playing ? '1' : '0');
    for (const f of this.listeners) f();
  }

  private savePos() {
    // before the first play of this visit the stored position is still the one to come back to
    if (this.resume || (!this.playing && !this.position())) return;
    localStorage.setItem('office.pos', JSON.stringify({ id: this.current.id, t: Math.round(this.position()) }));
  }

  get energy() {
    return this.playing ? this.current.energy : 0;
  }

  /** 0..1 position inside the current beat */
  beatPhase() {
    if (!this.playing) return 0;
    if (this.current.kind === 'lofi') return this.engine?.beatPhase() ?? 0;
    const b = this.position() * (this.current.bpm / 60);
    return b - Math.floor(b);
  }

  /** seconds into the current track or set */
  position() {
    if (this.current.kind === 'lofi') return (this.engine?.progress() ?? 0) * (this.engine?.duration ?? 0);
    try {
      return this.yt?.getCurrentTime() ?? 0;
    } catch {
      return (performance.now() - this.ytStarted) / 1000;
    }
  }

  duration() {
    if (this.current.kind === 'lofi') return this.engine?.duration ?? 0;
    try {
      return this.yt?.getDuration() ?? 0;
    } catch {
      return 0;
    }
  }

  seek(frac: number) {
    frac = Math.max(0, Math.min(1, frac));
    if (this.current.kind === 'lofi') {
      if (!this.playing) void this.play(this.current);
      this.engine?.seek(frac);
    } else if (this.yt) {
      const d = this.duration();
      if (d) this.yt.seekTo(frac * d, true);
      if (!this.playing) this.toggle();
    }
    this.changed();
  }

  /** 0..1 for YouTube sets (the radio goes through the music bus of Sfx); 0.7 is the usual level */
  setVolume(v: number) {
    this.ytVolume = Math.round(Math.min(100, (80 * v) / 0.7));
    try {
      this.yt?.setVolume(this.ytVolume);
    } catch {
      // the YouTube player is not ready yet; onReady applies it
    }
  }

  setShowVideo(on: boolean) {
    this.showVideo = on;
    localStorage.setItem('office.video', on ? '1' : '0');
    this.syncVideo();
    this.changed();
  }

  private syncVideo() {
    const host = this.ytHost();
    const yt = this.current.kind === 'youtube';
    host.classList.toggle('on', yt && this.showVideo);
    host.classList.toggle('audio', yt && !this.showVideo);
  }

  beatsPerSecond() {
    return this.playing ? this.current.bpm / 60 : 0;
  }

  progress() {
    if (this.current.kind === 'lofi') return this.engine?.progress() ?? 0;
    const d = this.duration();
    return d ? this.position() / d : 0;
  }

  /** set when YouTube refused to embed the last set */
  blocked: { item: Item; code: number } | null = null;

  async play(item: Item) {
    if (item.kind === 'youtube') this.blocked = null;
    this.sfx.unlock();
    this.stopAll();
    const at = this.resume?.id === item.id ? this.resume.t : 0;
    this.resume = null;
    this.current = item;
    this.playing = true;
    if (item.kind === 'lofi') {
      this.ytHost().classList.remove('on', 'audio');
      this.engine?.play(item.track!);
      if (at > 1 && this.engine?.duration) this.engine.seek(at / this.engine.duration);
    } else {
      const start = at > 1 ? at : item.start;
      this.ytStarted = performance.now();
      await loadYouTube();
      const host = this.ytHost();
      this.syncVideo();
      if (this.yt) {
        this.yt.loadVideoById({ videoId: item.videoId!, startSeconds: start });
      } else {
        const el = document.createElement('div');
        host.replaceChildren(el);
        this.yt = new window.YT!.Player(el, {
          videoId: item.videoId,
          width: '100%',
          height: '100%',
          playerVars: { start, autoplay: 1, controls: 1, rel: 0, playsinline: 1, modestbranding: 1, origin: location.origin },
          events: {
            onReady: (e: { target: YTPlayer }) => {
              e.target.setVolume(this.ytVolume);
              e.target.playVideo();
            },
            onError: (e: { data: number }) => {
              // 101/150: the owner blocks this embed here; fall back to the radio and offer a link
              if (this.current.kind !== 'youtube') return;
              const it = this.current;
              this.ytHost().classList.remove('on', 'audio');
              this.blocked = { item: it, code: e.data };
              void this.play(RADIO[0]);
            },
            onStateChange: (e: { data: number }) => {
              // 1 playing, 2 paused, 0 ended
              if (this.current.kind !== 'youtube') return;
              if (e.data === 1 && !this.playing) {
                this.playing = true;
                this.changed();
              } else if ((e.data === 2 || e.data === 0) && this.playing) {
                this.playing = false;
                this.changed();
              }
            },
          },
        });
      }
    }
    this.changed();
  }

  private stopAll() {
    this.engine?.stop();
    if (this.yt && this.current.kind === 'youtube') this.yt.pauseVideo();
  }

  toggle() {
    if (this.playing) {
      this.stopAll();
      this.playing = false;
      this.changed();
    } else if (this.current.kind === 'youtube' && this.yt) {
      this.yt.playVideo();
      this.playing = true;
      this.changed();
    } else void this.play(this.current);
  }

  closeVideo() {
    this.setShowVideo(false);
  }

  next(dir = 1) {
    const list = this.current.kind === 'lofi' ? RADIO : SETS;
    const pool = this.showLikes ? list.filter((i) => this.likes.has(i.id)) : list;
    const src = pool.length ? pool : list;
    const i = src.findIndex((x) => x.id === this.current.id);
    const n = src[(i + dir + src.length) % src.length];
    if (n.kind === 'youtube' && n.id === this.current.id) return;
    void this.play(n);
  }

  like(id = this.current.id) {
    if (this.likes.has(id)) this.likes.delete(id);
    else this.likes.add(id);
    localStorage.setItem('office.likes', JSON.stringify([...this.likes]));
    this.changed();
  }

  update() {
    this.engine?.update();
    if (this.playing && performance.now() - this.savedAt > 2000) {
      this.savedAt = performance.now();
      this.savePos();
    }
  }
}

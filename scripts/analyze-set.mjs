#!/usr/bin/env node
// Offline analysis of a YouTube DJ set for the light show.
// usage: node scripts/analyze-set.mjs <videoId> [--audio file]   → public/sets/<videoId>.json
//
// Output (all times in seconds unless noted):
//   fps        rate of the band strings (25 Hz)
//   loud/low/mid/high  one char per frame, 64 levels (B64 alphabet), normalised over the whole set
//   ifps       rate of the intensity string (5 Hz)
//   intensity  smoothed "crazy meter" 0..63, normalised over the whole set
//   beats      beat times as deltas in centiseconds (first value absolute)
//   beatK      one digit per beat: how much kick is really on that beat (0 none … 9 full)
//   sections   [start, kind] with kind g groove, b breakdown, u build-up, d drop
//   drops      drop times
import { spawn, execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const args = process.argv.slice(2);
const id = args.find((a) => !a.startsWith('--'));
if (!id) {
  console.error('usage: node scripts/analyze-set.mjs <videoId> [--audio file]');
  process.exit(1);
}
const audioArg = args.includes('--audio') ? args[args.indexOf('--audio') + 1] : null;

const SR = 16000;
const N = 1024;
const HOP = 160; // 100 frames per second internally
const FPS = SR / HOP;
const OUT_FPS = 25;
const INT_FPS = 5;
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const t0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...a);

// ---------- download ----------
let tmp = null;
let file = audioArg;
if (!file) {
  tmp = await mkdtemp(path.join(tmpdir(), 'set-'));
  log('downloading', id);
  execFileSync('yt-dlp', ['-f', 'bestaudio', '--no-playlist', '-q', '--no-warnings', '-o', path.join(tmp, 'a.%(ext)s'), `https://www.youtube.com/watch?v=${id}`], { stdio: 'inherit' });
  const f = (await readdir(tmp)).find((x) => x.startsWith('a.'));
  if (!f) throw new Error('download failed');
  file = path.join(tmp, f);
}

// ---------- FFT ----------
const LOG2N = Math.log2(N);
const rev = new Uint32Array(N);
for (let i = 0; i < N; i++) {
  let r = 0;
  for (let b = 0; b < LOG2N; b++) r |= ((i >> b) & 1) << (LOG2N - 1 - b);
  rev[i] = r;
}
const cosT = new Float64Array(N / 2), sinT = new Float64Array(N / 2);
for (let i = 0; i < N / 2; i++) {
  cosT[i] = Math.cos((-2 * Math.PI * i) / N);
  sinT[i] = Math.sin((-2 * Math.PI * i) / N);
}
const hann = new Float64Array(N);
for (let i = 0; i < N; i++) hann[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N);
const re = new Float64Array(N), im = new Float64Array(N);
function fft() {
  for (let i = 0; i < N; i++) {
    const j = rev[i];
    if (j > i) {
      const t = re[i]; re[i] = re[j]; re[j] = t;
      const u = im[i]; im[i] = im[j]; im[j] = u;
    }
  }
  for (let size = 2; size <= N; size <<= 1) {
    const half = size >> 1, step = N / size;
    for (let s = 0; s < N; s += size) {
      for (let k = 0; k < half; k++) {
        const c = cosT[k * step], si = sinT[k * step];
        const a = s + k, b = a + half;
        const tr = re[b] * c - im[b] * si, ti = re[b] * si + im[b] * c;
        re[b] = re[a] - tr; im[b] = im[a] - ti;
        re[a] += tr; im[a] += ti;
      }
    }
  }
}

// ---------- per-frame features at 100 Hz ----------
const binHz = SR / N;
const kLow = Math.round(150 / binHz), kMid = Math.round(2500 / binHz), kFluxLow = Math.round(200 / binHz), kFluxHi = Math.round(3000 / binHz);
const F = { rms: [], low: [], mid: [], high: [], flux: [], lowFlux: [], hiFlux: [] };
const prevLog = new Float64Array(N / 2 + 1);
function frame(buf, off) {
  let ss = 0;
  for (let i = 0; i < N; i++) {
    const x = buf[off + i];
    ss += x * x;
    re[i] = x * hann[i];
    im[i] = 0;
  }
  fft();
  let low = 0, mid = 0, high = 0, flux = 0, lowFlux = 0, hiFlux = 0;
  for (let k = 1; k <= N / 2; k++) {
    const p = re[k] * re[k] + im[k] * im[k];
    if (k < kLow) low += p;
    else if (k < kMid) mid += p;
    else high += p;
    const lm = Math.log1p(Math.sqrt(p) * 4);
    const d = lm - prevLog[k];
    prevLog[k] = lm;
    if (d > 0) {
      flux += d;
      if (k <= kFluxLow) lowFlux += d;
      if (k >= kFluxHi) hiFlux += d;
    }
  }
  F.rms.push(Math.sqrt(ss / N));
  F.low.push(low); F.mid.push(mid); F.high.push(high);
  F.flux.push(flux); F.lowFlux.push(lowFlux); F.hiFlux.push(hiFlux);
}

log('decoding + analysing', path.basename(file));
let nextReport = 10 * 60 * FPS;
await new Promise((resolve, reject) => {
  const ff = spawn('ffmpeg', ['-v', 'error', '-i', file, '-ac', '1', '-ar', String(SR), '-f', 'f32le', '-'], { stdio: ['ignore', 'pipe', 'inherit'] });
  let pend = new Float32Array(0);
  let byteRest = Buffer.alloc(0);
  ff.stdout.on('data', (chunk) => {
    const bytes = byteRest.length ? Buffer.concat([byteRest, chunk]) : chunk;
    const usable = bytes.length - (bytes.length % 4);
    byteRest = Buffer.from(bytes.subarray(usable));
    const aligned = Buffer.from(bytes.subarray(0, usable));
    const fresh = new Float32Array(aligned.buffer, aligned.byteOffset, usable / 4);
    const buf = new Float32Array(pend.length + fresh.length);
    buf.set(pend);
    buf.set(fresh, pend.length);
    let off = 0;
    while (off + N <= buf.length) {
      frame(buf, off);
      off += HOP;
    }
    pend = buf.slice(off);
    if (F.rms.length >= nextReport) {
      nextReport += 10 * 60 * FPS;
      log(`  ${Math.round(F.rms.length / FPS / 60)} min`);
    }
  });
  ff.on('error', reject);
  ff.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}`))));
});
const n = F.rms.length;
const duration = (n * HOP + N / 2) / SR;
log(`frames ${n}, duration ${(duration / 60).toFixed(1)} min`);
if (tmp) await rm(tmp, { recursive: true, force: true });

// ---------- helpers ----------
const arr = (a) => Float64Array.from(a);
function percentile(a, q) {
  const step = Math.max(1, Math.floor(a.length / 40000));
  const s = [];
  for (let i = 0; i < a.length; i += step) s.push(a[i]);
  s.sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.max(0, Math.round(q * (s.length - 1))))];
}
function boxSmooth(a, r) {
  r = Math.max(1, Math.round(r));
  const pre = new Float64Array(a.length + 1);
  for (let i = 0; i < a.length; i++) pre[i + 1] = pre[i] + a[i];
  const o = new Float64Array(a.length);
  for (let i = 0; i < a.length; i++) {
    const lo = Math.max(0, i - r), hi = Math.min(a.length, i + r + 1);
    o[i] = (pre[hi] - pre[lo]) / (hi - lo);
  }
  return o;
}
const smooth = (a, r) => boxSmooth(boxSmooth(a, r), r); // triangular, zero phase
const norm = (a, lo = 0.03, hi = 0.995) => {
  const p0 = percentile(a, lo), p1 = percentile(a, hi);
  return a.map((x) => Math.min(1, Math.max(0, (x - p0) / (p1 - p0 || 1))));
};
const db = (x) => 10 * Math.log10(x + 1e-10);
const q64 = (a) => Array.from(a, (x) => B64[Math.min(63, Math.max(0, Math.round(x * 63)))]).join('');

// ---------- onset envelope + tempo ----------
const lowFlux = arr(F.lowFlux), flux = arr(F.flux);
const pl = percentile(lowFlux, 0.9) || 1, pf = percentile(flux, 0.9) || 1;
let O = new Float64Array(n);
for (let i = 0; i < n; i++) O[i] = (0.6 * lowFlux[i]) / pl + (0.4 * flux[i]) / pf;
const Omean = boxSmooth(O, 50);
O = O.map((x, i) => Math.max(0, x - Omean[i]));
let sd = 0;
for (let i = 0; i < n; i++) sd += O[i] * O[i];
sd = Math.sqrt(sd / n) || 1;
O = O.map((x) => x / sd);

const WIN = 8 * FPS, TH = FPS, LMIN = Math.floor((60 * FPS) / 185), LMAX = Math.ceil((60 * FPS) / 85);
const tempoT = [], tempoP = [], tempoC = [];
for (let s = 0; s + WIN < n; s += TH) {
  const ac = new Float64Array(2 * LMAX + 2);
  let a0 = 0;
  for (let i = s; i < s + WIN; i++) a0 += O[i] * O[i];
  for (let L = LMIN; L <= 2 * LMAX + 1; L++) {
    let v = 0;
    for (let i = s; i < s + WIN - L; i++) v += O[i] * O[i + L];
    ac[L] = v / (WIN - L);
  }
  a0 /= WIN;
  let best = LMIN, bestS = -Infinity;
  const score = (L) => {
    const bpm = (60 * FPS) / L;
    const prior = Math.exp(-0.5 * (Math.log2(bpm / 126) / 0.38) ** 2);
    return prior * (ac[L] + 0.5 * ac[2 * L]);
  };
  for (let L = LMIN; L <= LMAX; L++) {
    const v = score(L);
    if (v > bestS) { bestS = v; best = L; }
  }
  let P = best;
  if (best > LMIN && best < LMAX) {
    const y0 = score(best - 1), y1 = bestS, y2 = score(best + 1);
    const den = y0 - 2 * y1 + y2;
    if (den < 0) P = best + (0.5 * (y0 - y2)) / den;
  }
  tempoT.push(s + WIN / 2);
  tempoP.push(P);
  tempoC.push(a0 > 0 ? ac[best] / a0 : 0);
}
// hold the tempo through rhythm-less passages, then median-smooth
const confThr = percentile(arr(tempoC), 0.25);
for (let i = 1; i < tempoP.length; i++) if (tempoC[i] < confThr) tempoP[i] = tempoP[i - 1];
const med = tempoP.map((_, i) => {
  const w = tempoP.slice(Math.max(0, i - 5), i + 6).sort((a, b) => a - b);
  return w[w.length >> 1];
});
const period = new Float64Array(n), conf = new Float64Array(n);
for (let i = 0, j = 0; i < n; i++) {
  while (j < tempoT.length - 2 && tempoT[j + 1] < i) j++;
  const a = tempoT[j] ?? 0, b = tempoT[j + 1] ?? a + 1;
  const f = Math.min(1, Math.max(0, (i - a) / (b - a)));
  period[i] = (med[j] ?? 50) * (1 - f) + (med[j + 1] ?? med[j] ?? 50) * f;
  conf[i] = (tempoC[j] ?? 0) * (1 - f) + (tempoC[j + 1] ?? tempoC[j] ?? 0) * f;
}
log('tempo median', ((60 * FPS) / percentile(arr(med), 0.5)).toFixed(1), 'bpm');

// ---------- dynamic-programming beat tracker (Ellis 2007) ----------
const TIGHT = 100;
const C = new Float64Array(n), back = new Int32Array(n).fill(-1);
for (let t = 0; t < n; t++) {
  const P = period[t];
  const lo = Math.max(0, Math.round(t - 2 * P)), hi = Math.round(t - P / 2);
  let best = -Infinity, bi = -1;
  for (let u = lo; u <= hi; u++) {
    const r = Math.log((t - u) / P);
    const v = C[u] - TIGHT * r * r;
    if (v > best) { best = v; bi = u; }
  }
  if (best > 0) { C[t] = O[t] + best; back[t] = bi; }
  else C[t] = O[t];
}
let end = n - 1;
for (let t = Math.max(0, Math.round(n - 2 * period[n - 1])); t < n; t++) if (C[t] > C[end]) end = t;
const beatF = [];
for (let t = end; t >= 0; t = back[t]) beatF.push(t);
beatF.reverse();
const frameTime = (f) => (f * HOP + N / 2) / SR;
const beatT = beatF.map((f) => {
  if (f <= 0 || f >= n - 1) return frameTime(f);
  const y0 = O[f - 1], y1 = O[f], y2 = O[f + 1];
  const den = y0 - 2 * y1 + y2;
  const d = den < 0 ? Math.max(-0.5, Math.min(0.5, (0.5 * (y0 - y2)) / den)) : 0;
  return frameTime(f + d);
});
// kick strength on each beat
const kickRaw = beatF.map((f) => {
  let m = 0;
  for (let k = Math.max(0, f - 3); k <= Math.min(n - 1, f + 3); k++) m = Math.max(m, lowFlux[k]);
  return m;
});
const kRef = percentile(arr(kickRaw), 0.8) || 1;
const beatK = kickRaw.map((v) => Math.min(9, Math.round((v / kRef) * 8)));
log('beats', beatT.length);

// ---------- 25 Hz bands ----------
const R = FPS / OUT_FPS;
const m = Math.floor(n / R);
const loud = new Float64Array(m), low = new Float64Array(m), mid = new Float64Array(m), high = new Float64Array(m), fl = new Float64Array(m);
for (let i = 0; i < m; i++) {
  let r2 = 0, lo = 0, mi = 0, hi = 0, fx = 0;
  for (let k = i * R; k < (i + 1) * R; k++) {
    r2 += F.rms[k] * F.rms[k];
    lo = Math.max(lo, F.low[k]);
    mi += F.mid[k];
    hi += F.high[k];
    fx += F.flux[k];
  }
  loud[i] = db(r2 / R);
  low[i] = db(lo);
  mid[i] = db(mi / R);
  high[i] = db(hi / R);
  fl[i] = fx / R;
}
const loudN = norm(loud), lowN = norm(low), midN = norm(mid), highN = norm(high), fluxN = norm(fl);

// ---------- kick presence → breakdowns, builds, drops ----------
const kickAt = new Float64Array(m);
for (let b = 0; b < beatT.length; b++) {
  const i = Math.round(beatT[b] * OUT_FPS);
  if (i >= 0 && i < m) kickAt[i] = beatK[b] / 9;
}
// fraction of beats with a real kick, over ±3 s
const beatMask = new Float64Array(m);
for (const t of beatT) {
  const i = Math.round(t * OUT_FPS);
  if (i >= 0 && i < m) beatMask[i] = 1;
}
const kSum = boxSmooth(kickAt, 3 * OUT_FPS), bSum = boxSmooth(beatMask, 3 * OUT_FPS);
const kickPres = kSum.map((v, i) => (bSum[i] > 0 ? v / bSum[i] : 0));

// ---------- intensity ----------
const confN = norm(Float64Array.from({ length: m }, (_, i) => conf[Math.min(n - 1, i * R)]), 0.05, 0.98);
const a = smooth(loudN, 1.5 * OUT_FPS), b = smooth(lowN, 1 * OUT_FPS), c = smooth(highN, 1 * OUT_FPS), d = smooth(fluxN, 1.5 * OUT_FPS), e = smooth(confN, 2 * OUT_FPS), kp = smooth(kickPres, 1 * OUT_FPS);
const raw = new Float64Array(m);
for (let i = 0; i < m; i++) raw[i] = 0.25 * a[i] + 0.2 * b[i] + 0.15 * c[i] + 0.15 * d[i] + 0.1 * e[i] + 0.15 * kp[i];
const sorted = Float64Array.from(raw).sort();
const cdf = (x) => {
  let lo = 0, hi = sorted.length;
  while (lo < hi) {
    const mm = (lo + hi) >> 1;
    if (sorted[mm] < x) lo = mm + 1;
    else hi = mm;
  }
  return lo / sorted.length;
};
const lin = norm(raw, 0.04, 0.985);
const inten = smooth(raw.map((x, i) => 0.55 * cdf(x) + 0.45 * lin[i]), 1 * OUT_FPS);

// sections at 1 Hz with hysteresis: a breakdown is ≥ 6 s with (almost) no kick
const S = Math.floor(m / OUT_FPS);
const kps = Array.from({ length: S }, (_, s) => kickPres[s * OUT_FPS] ?? 0);
const kpThr = percentile(arr(kps), 0.5);
const enter = Math.min(0.28, kpThr * 0.45), exit = Math.min(0.5, kpThr * 0.75);
const kind = new Array(S).fill('g');
let inBreak = false, startB = 0;
const breaks = [];
for (let s = 0; s < S; s++) {
  if (!inBreak && kps[s] < enter) { inBreak = true; startB = s; }
  else if (inBreak && kps[s] > exit) {
    inBreak = false;
    if (s - startB >= 6) breaks.push([startB, s]);
  }
}
if (inBreak && S - startB >= 6) breaks.push([startB, S]);
const drops = [];
const intAt = (s) => inten[Math.min(m - 1, s * OUT_FPS)];
for (const [s0, s1] of breaks) {
  for (let s = s0; s < s1; s++) kind[s] = 'b';
  if (s1 >= S) continue;
  // a drop: the kick returns and the next 10 s are clearly louder than the breakdown
  let after = 0, during = 0;
  for (let s = s1; s < Math.min(S, s1 + 10); s++) after += intAt(s) / 10;
  for (let s = s0; s < s1; s++) during += intAt(s) / (s1 - s0);
  if (after > during + 0.12 && after > 0.45) {
    // snap to the first strong beat after the breakdown
    let dt = s1;
    for (let k = 0; k < beatT.length; k++) if (beatT[k] >= s1 - 2 && beatK[k] >= 6) { dt = beatT[k]; break; }
    drops.push(+dt.toFixed(2));
    const buildLen = Math.min(16, Math.max(4, Math.round((s1 - s0) * 0.4)));
    for (let s = Math.max(s0, Math.floor(dt) - buildLen); s < Math.floor(dt); s++) kind[s] = 'u';
    for (let s = Math.floor(dt); s < Math.min(S, Math.floor(dt) + 16); s++) kind[s] = 'd';
  }
}
const sections = [];
for (let s = 0; s < S; s++) if (!s || kind[s] !== kind[s - 1]) sections.push([s, kind[s]]);

// ---------- write ----------
const intOut = [];
for (let i = 0; i < m; i += OUT_FPS / INT_FPS) intOut.push(inten[i]);
const beatsCs = [];
let prev = 0;
for (const t of beatT) {
  const cs = Math.round(t * 100);
  beatsCs.push(cs - prev);
  prev = cs;
}
const out = {
  v: 1,
  id,
  duration: +duration.toFixed(2),
  fps: OUT_FPS,
  loud: q64(loudN),
  low: q64(lowN),
  mid: q64(midN),
  high: q64(highN),
  ifps: INT_FPS,
  intensity: q64(intOut),
  beats: beatsCs,
  beatK: beatK.join(''),
  sections,
  drops,
};
await mkdir('public/sets', { recursive: true });
const json = JSON.stringify(out);
await writeFile(`public/sets/${id}.json`, json);
log(`wrote public/sets/${id}.json (${(json.length / 1024).toFixed(0)} KB): ${beatT.length} beats, ${breaks.length} breakdowns, ${drops.length} drops`);
const hist = new Array(10).fill(0);
for (const x of intOut) hist[Math.min(9, Math.floor(x * 10))]++;
log('intensity histogram', hist.map((h) => Math.round((h / intOut.length) * 100) + '%').join(' '));
if (args.includes('--debug')) {
  // one line per minute: tempo from the tracked beats, intensity, kick presence, section kinds
  for (let s = 0; s < S; s += 60) {
    const bs = beatT.filter((t) => t >= s && t < s + 60);
    const ivs = bs.slice(1).map((t, i) => t - bs[i]).sort((x, y) => x - y);
    const bpm = ivs.length ? 60 / ivs[ivs.length >> 1] : 0;
    const jitter = ivs.length ? (ivs[Math.floor(ivs.length * 0.9)] - ivs[Math.floor(ivs.length * 0.1)]) * 1000 : 0;
    let iv = 0, kk = 0;
    for (let k = s; k < s + 60 && k < S; k++) { iv += intAt(k) / 60; kk += kps[k] / 60; }
    const ks = kind.slice(s, s + 60).join('').replace(/g+/g, (x) => (x.length > 3 ? '·' : x));
    console.log(`${String(s / 60).padStart(3)}m bpm ${bpm.toFixed(1).padStart(5)} ±${jitter.toFixed(0).padStart(3)}ms  int ${iv.toFixed(2)} kick ${kk.toFixed(2)}  ${ks}`);
  }
  // the tracker should sit on the kick, not on the off-beat hats
  let on = 0, off = 0;
  for (let k = 0; k + 1 < beatF.length; k++) {
    const h = Math.round((beatF[k] + beatF[k + 1]) / 2);
    let mo = 0;
    for (let j = h - 3; j <= h + 3; j++) mo = Math.max(mo, lowFlux[j] ?? 0);
    on += kickRaw[k];
    off += mo;
  }
  console.log('low flux on beats / off beats', (on / off).toFixed(2));
  console.log('drops', drops.map((t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`).join(' '));
}

#!/usr/bin/env node
// Add a YouTube set to the DJ booth: analyse it for the light show and list it in src/sets.json.
// usage: node scripts/add-set.mjs <youtube url or videoId> [--start seconds] [--title "…"] [--artist "…"]
import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';

const args = process.argv.slice(2);
const opt = (k) => (args.includes(k) ? args[args.indexOf(k) + 1] : undefined);
const flags = ['--start', '--title', '--artist'];
const src = args.find((a, i) => !a.startsWith('--') && !flags.includes(args[i - 1]));
if (!src) {
  console.error('usage: node scripts/add-set.mjs <youtube url or videoId> [--start seconds] [--title "…"] [--artist "…"]');
  process.exit(1);
}
const videoId = /^[\w-]{11}$/.test(src) ? src : (src.match(/(?:v=|youtu\.be\/|live\/|embed\/)([\w-]{11})/) ?? [])[1];
if (!videoId) throw new Error(`no YouTube video id found in "${src}"`);
const url = `https://www.youtube.com/watch?v=${videoId}`;

const meta = execFileSync('yt-dlp', ['--no-playlist', '--no-warnings', '--print', '%(title)s\n%(uploader)s', url], { encoding: 'utf8' }).trim().split('\n');
execFileSync('node', ['scripts/analyze-set.mjs', videoId], { stdio: 'inherit' });

// tempo: the median gap between the tracked beats
const a = JSON.parse(await readFile(`public/sets/${videoId}.json`, 'utf8'));
const gaps = a.beats.slice(1).sort((x, y) => x - y);
const bpm = gaps.length ? Math.round(6000 / gaps[gaps.length >> 1]) : 124;

const file = 'src/sets.json';
const sets = JSON.parse(await readFile(file, 'utf8'));
const entry = { videoId, title: opt('--title') ?? meta[0] ?? videoId, artist: opt('--artist') ?? meta[1] ?? '', bpm };
if (opt('--start')) entry.start = Number(opt('--start'));
const i = sets.findIndex((s) => s.videoId === videoId);
if (i >= 0) sets[i] = { ...sets[i], ...entry };
else sets.push(entry);
await writeFile(file, '[\n' + sets.map((s) => '  ' + JSON.stringify(s).replace(/^\{/, '{ ').replace(/\}$/, ' }').replace(/","/g, '", "').replace(/,"/g, ', "').replace(/":/g, '": ')).join(',\n') + '\n]\n');
console.log(`${i >= 0 ? 'updated' : 'added'}: ${entry.title} · ${entry.artist} · ${bpm} BPM`);

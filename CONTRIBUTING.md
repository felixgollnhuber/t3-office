# Contributing to T3 Office

Thanks for wanting to build on the office! New furniture, a better dog, a third language, a faster renderer, a fix
for a typo: everything is welcome. This page gets you from zero to a pull request.

- [Get it running](#get-it-running)
- [A tour of the code](#a-tour-of-the-code)
- [House rules](#house-rules)
- [Good places to start](#good-places-to-start)
- [Opening a pull request](#opening-a-pull-request)

## Get it running

You need [Node.js](https://nodejs.org) 22.13 or newer. T3 Code itself is **not** required: without it the office runs
on a built-in simulation.

```sh
git clone https://github.com/felixgollnhuber/t3-office.git
cd t3-office
npm install
npm run dev
```

Open <http://localhost:5173/?source=demo>. Vite reloads the page on every save; changes to `server/` or
`vite.config.ts` restart the dev server.

| Command | What it does |
|---|---|
| `npm run dev` | Dev server with hot reload and the local T3 API |
| `npm run build` | Type check (`tsc`) and production build into `dist/`; CI runs this |
| `npm run typecheck` | Type check only (the app and the Node side) |
| `npm start` | Build and serve the office like an end user gets it (`bin/t3-office.mjs`) |
| `npm run add-set -- <url>` | Analyse a YouTube DJ set for the light show (needs `yt-dlp` and `ffmpeg`) |

Useful URL parameters while you work: `?source=demo` (simulated agents), `&agents=30` (more of them), `&sim=4` (the
simulation runs four times as fast), `&time=22:30` and `&speed=60` (time of day and clock speed),
`&weather=storm`, `&theme=boiler`, `&lang=de`. The full list is in the [README](README.md#url-parameters).

In dev mode the page puts its main objects on `window` (`__world`, `__source`, `__office`, `__player`, `__weather` …;
see the end of the setup in `src/main.ts`), so you can poke at the office from the browser console:

```js
__office.gong.hit();
__office.rooms.server.setLoad(1);
```

## A tour of the code

The office is plain TypeScript and [three.js](https://threejs.org), no UI framework. Everything is built from code:
geometry, pixel textures painted on canvases, generated sounds and music. There are no image or audio assets.

```text
server/              Node side, runs inside the Vite server (dev and `npm start`)
  t3.ts              /api/t3/*: threads, transcripts and quotas from T3 Code's local SQLite database (read-only)
  costs.ts           /api/t3/costs: the numbers of T3 Code's Usage page, from the provider transcripts
vite.config.ts       Mounts the APIs, plus /api/board (GitHub Projects through the gh CLI)
bin/t3-office.mjs    `npx t3-office` / `npm start`: builds once and serves dist/ with the same APIs

src/
  main.ts            Wires everything together; the frame loop; clicks and keys
  source.ts          The AgentSource interface the office runs on, and the demo simulation
  t3source.ts        The live AgentSource: polls /api/t3 and turns it into threads and events
  data.ts            Shared types (Agent, Status, Provider), teams and demo staff
  workers.ts         World and Worker: every thread as a person who sits, walks, queues, celebrates
  character.ts       The voxel people: looks, poses, animation
  office.ts          The building: floor plan, walls, seats, doors, spots to walk to
  rooms.ts           Server room, kitchen, meeting room, sleeping pods, library, DJ booth, decorations
  desk.ts            Desks and their monitors (what the agent is doing right now)
  floor.ts           Where teams sit
  nav.ts             Walkability grid, A* and path smoothing
  life.ts            Office life: meetings, naps, the hot server room, alarms and celebrations
  boss.ts            The glass office and the orchestrator thread
  pets.ts            Ping the dog, Null the cat, Cron the robot vacuum
  director.ts        The camera that moves by itself
  pixel.ts           The pixel-art render pipeline (low-res target, outlines, colour levels, dithering)
  materials.ts       Toon materials
  textures.ts        Canvas-painted textures and the scenery behind the windows
  themes.ts          Office styles: campus, loft, soma, boiler
  sky.ts time.ts     Daylight from the real sun position, the clock, time travel
  weather.ts rain.ts Real or simulated weather, and how it looks
  seasons.ts         Halloween, winter, Christmas
  music.ts           Generative lo-fi radio
  player.ts          YouTube DJ sets (list in sets.json)
  lightshow.ts fog.ts Lasers, moving heads and haze, driven by the analysed set or the radio
  audio.ts           Sound effects, all synthesised with WebAudio
  hud.ts             Clock, counters, name tags
  agentview.ts       The agent sheet you get by clicking someone, with the thread reader
  costview.ts        The receipt and the full cost view
  quota.ts board.ts  The quota wall and the GitHub Projects pinboard
  settings.ts        One typed settings store (localStorage + URL overrides, phone defaults)
  settingsmenu.ts    The settings menu
  interact.ts        Registry for clickable things
  demobar.ts         The bar of the public demo on phones, linking back to the repository
  i18n/              Every text, one table per area, one block per language

scripts/             add-set.mjs and analyze-set.mjs for the DJ booth
public/sets/         Light-show analyses of the DJ sets (numbers only, no audio)
```

How data flows: `server/t3.ts` reads T3 Code's state and answers `/api/t3/threads` with plain data and codes, never
with words. `src/t3source.ts` polls that, diffs it and emits `SourceEvent`s (`status`, `tool`, `pr`, `ci`, `tests`,
`order` …). `World` in `src/workers.ts` turns events into behaviour: someone stands up, walks to the boss's door, rings
the gong. The demo simulation in `src/source.ts` emits the same events, so anything you build works in both modes.

## House rules

These keep the office trustworthy and pleasant to work on.

1. **Read-only, always.** T3 Office never writes to T3 Code's files, sends no messages and changes no settings. The
   database is opened read-only and every query goes through an index: it can be gigabytes large, and `node:sqlite`
   is synchronous.
2. **Nothing leaves the machine** unless the user would expect it (YouTube when a set plays, GitHub for the pinboard,
   Open-Meteo for the weather). No analytics, no telemetry. A new outgoing request needs a way to switch it off and a
   line in the README's privacy section.
3. **The server speaks codes, the browser speaks languages.** Texts live in `src/i18n/`; the server sends codes and raw
   values. Every text exists in every language: `en` is the reference, and TypeScript fails the build when another
   block misses a key. You can write the German text with a translator; a native speaker will polish it in review.
4. **Settings go through `src/settings.ts`.** One typed store, persisted in the browser. If a setting also makes sense
   as a URL parameter, wire it up there, so it works on a kiosk screen.
5. **Generated, not downloaded.** New props, sounds and textures are made in code, in the existing pixel style. If you
   really need an asset, it must be small and properly licensed; mention it in the pull request.
6. **Few dependencies.** Runtime dependencies are three.js, a few fonts and Vite. Please open an issue before adding
   one.
7. **Style.** There is no auto-formatter; match the code around you: two spaces, single quotes, semicolons, long
   lines are fine (up to about 160 characters). Comments say *why*, not *what*. Each module starts with a short doc
   comment that says what it is and how to use it. Keep the type checker happy (`strict` is on).
8. **Screenshots only from demo data.** In live mode the office shows your real thread names, prompts and costs. Use
   `?source=demo` for anything you post. The folders `shots/` and `scripts/dev/` are git-ignored for throwaway
   screenshots and browser scripts.

## Good places to start

- **A new language.** Add it to `LANGS` in `src/i18n/index.ts`, then add a block to each table in `src/i18n/`;
  TypeScript tells you what is missing.
- **Office life.** New props, a reaction to an event, another office style in `src/themes.ts`, a new trick for one of
  the pets.
- **Linux and Windows.** The office is developed on macOS. Double-click "open in T3 Code" uses `open -b` and is
  macOS-only today; reports and fixes for other systems are very welcome.
- **More data.** `AgentSource` (in `src/source.ts`) is small. A source for another agent tool would let more people
  use the office.
- **Tests.** There is no test suite yet. The parsing helpers in `server/t3.ts` (`shell()`, `testResult()`) and
  `server/costs.ts` are a good start; a proposal for a light test runner is welcome.
- **Performance.** The office should stay smooth with dozens of agents on a laptop. Profiles and fixes are gold.

Issues labelled [`good first issue`](https://github.com/felixgollnhuber/t3-office/labels/good%20first%20issue) and
[`help wanted`](https://github.com/felixgollnhuber/t3-office/labels/help%20wanted) are a good start as well. For bigger
changes, open an issue first so we can agree on the idea before you spend an evening on it.

## Opening a pull request

1. Fork the repository and create a branch from `main`.
2. Make your change. Keep pull requests focused: one feature or fix per pull request.
3. Run `npm run build`; it must pass. It is also what CI checks.
4. Check it in the browser, in demo mode and, if your change touches live data, with T3 Code running.
5. For anything visible, add a screenshot or a short clip (demo data only) to the pull request.
6. Write a clear description: what changes, why, and how you tested it.

`main` is protected: every change, the maintainer's included, lands through a pull request once the `CI passed`
check is green. Pull requests are usually squash-merged, so give yours a title that works as a commit message: a
short summary in the imperative ("Add a coffee machine to the loft").

By contributing you agree that your contribution is licensed under the [MIT License](LICENSE), and you agree to
follow the [Code of Conduct](CODE_OF_CONDUCT.md).

import type { ToolKind } from './desk';
import type { Provider, Status } from './data';
import { S } from './i18n/demo';

export interface Thread {
  id: string;
  name: string;
  title: string;
  provider: Provider;
  model: string;
  team: number;
  status: Status;
  tps: number;
  toolCalls: number;
  files: number;
  context: number;
  cost: number;
  settled: boolean;
  parentId?: string;
  /** thread that launched or steers this one (not a subagent relation) */
  managerId?: string;
  /** epoch ms of the last thing that happened in the thread (a tool call, a message, a run starting or ending) */
  lastActiveAt?: number;
}

export type SourceEvent =
  | { type: 'add'; thread: Thread }
  | { type: 'status'; id: string; from: Status; to: Status }
  | { type: 'tool'; id: string; kind: ToolKind; label: string }
  | { type: 'compact'; id: string }
  | { type: 'settle'; id: string }
  /** the orchestrator (boss) launched or messaged another thread */
  | { type: 'order'; id: string; target: string; kind: 'launch' | 'send'; text: string }
  /** a pull request of the thread `id` was opened (linked to the thread) or merged; label: "#12 title" */
  | { type: 'pr'; id: string; state: 'opened' | 'merged'; label: string }
  /** the checks of that thread's pull request finished; label: "#12 title" */
  | { type: 'ci'; id: string; ok: boolean; label: string }
  /** a test run inside the thread finished; label: the test command */
  | { type: 'tests'; id: string; ok: boolean; label: string };

/** One entry of a thread's conversation as the thread reader shows it. */
export interface TranscriptItem {
  id: string;
  /** epoch ms */
  at: number;
  role: 'user' | 'assistant' | 'tool' | 'note';
  /** the message, or the tool call condensed to one line */
  text: string;
  /** the message was cut off */
  more?: boolean;
  /** user messages: typed by the user or sent by another agent */
  by?: 'user' | 'agent';
  /** tool calls, and the two kinds of notes */
  kind?: ToolKind | 'compact' | 'error';
  state?: 'running' | 'failed';
}

/** Anything that can feed the office: the demo simulator now, the live T3 server later. */
export interface AgentSource {
  threads(): Thread[];
  subscribe(fn: (e: SourceEvent) => void): void;
  update(dt: number): void;
  totals(): { runs: number; tokens: number; cost: number; queued: number };
  /** the orchestrator thread the boss character stands for, if the source knows one */
  boss?(): Thread | null;
  /** the latest part of a thread's conversation, oldest first; rejects when the thread can't be read */
  transcript?(id: string): Promise<TranscriptItem[]>;
}

export const NAMES: Record<Provider, string[]> = {
  claude: ['Clara', 'Clemens', 'Cleo', 'Claudia', 'Clint', 'Clarissa', 'Clive', 'Clea', 'Claus', 'Clementine', 'Clio', 'Clayton', 'Claire', 'Clark', 'Cliff', 'Clyde', 'Clover', 'Claudius', 'Clarence', 'Clovis', 'Clelia', 'Cleon', 'Clotilde', 'Clancy', 'Clem', 'Claudine', 'Clarita', 'Cleve', 'Clodagh', 'Clifton', 'Claas', 'Clemente', 'Clarice', 'Cleta', 'Cleopatra', 'Clement'],
  codex: ['Cora', 'Conrad', 'Cosima', 'Cody', 'Colette', 'Constantin', 'Cosmo', 'Colin', 'Corinna', 'Conny', 'Corvin', 'Coco', 'Cornelius', 'Constanze', 'Corbin', 'Cordula', 'Connor', 'Colleen', 'Coralie', 'Cornelia', 'Conan', 'Coleman', 'Cosette', 'Corin', 'Colombine', 'Coen', 'Cordelia', 'Cole', 'Columbus', 'Concetta', 'Corentin', 'Coby', 'Consuelo', 'Cort', 'Cornel', 'Coraline', 'Cobus', 'Corbinian', 'Colm', 'Courtney'],
  cursor: ['Kurt', 'Kuno', 'Curtis', 'Kuba', 'Kunigunde', 'Kurti', 'Kira', 'Kai', 'Curt', 'Kunibert', 'Cuno', 'Kurosch', 'Kumiko', 'Kublai', 'Curdin', 'Kunz', 'Kuki', 'Kuma', 'Curzio', 'Kunal', 'Cupido', 'Kuzma', 'Kusi', 'Curro'],
  gemini: ['Gemma', 'Genevieve', 'Gerda', 'Georg', 'Gesa', 'Gero', 'Gerhard', 'Gertrud', 'Gereon', 'Gerrit', 'Geli', 'Gesine', 'Gerald', 'Geraldine', 'Gernot', 'Genoveva', 'Geert', 'Gerlinde', 'Gena', 'Germaine'],
};
export const INTERNS = ['Pia', 'Paul', 'Pepe', 'Paula', 'Pino', 'Pippa', 'Pius', 'Polly', 'Pablo', 'Penny', 'Piet', 'Pauline', 'Pit', 'Pina', 'Paco', 'Petra', 'Pelle', 'Peppa', 'Phil', 'Paolo', 'Perla', 'Piri', 'Poldi', 'Pim', 'Palina', 'Peer', 'Pepper', 'Pavel', 'Pilar', 'Ponyo'];
const MODELS: Record<Provider, string[]> = {
  claude: ['opus', 'sonnet', 'sonnet', 'haiku'],
  codex: ['gpt-5', 'gpt-5', 'gpt-5-mini'],
  cursor: ['composer'],
  gemini: ['pro', 'flash'],
};
const TITLES = S.titles;
/** what a demo test run was started with; the same in every language */
const TEST_RUNS = ['vitest run', 'pytest -q', 'npm test', 'cargo test', 'go test ./...'];
const TOOLS: Record<ToolKind, string[]> = {
  terminal: ['npm test', 'git status', 'pnpm build', 'xcodebuild', 'terraform plan', 'git diff'],
  search: ['rg "useState"', 'rg "fetchUser"', 'glob **/*.ts', 'rg TODO'],
  edit: ['edit App.tsx', 'edit office.ts', 'edit schema.sql', 'write README'],
  web: S.toolsWeb,
  test: S.toolsTest,
};

const R = Math.random;
const pick = <T,>(a: readonly T[]) => a[Math.floor(R() * a.length)];
const between = (a: number, b: number) => a + R() * (b - a);

interface Sim extends Thread {
  t: number;
  dur: number;
  nextTool: number;
  /** the made-up conversation so far */
  log: TranscriptItem[];
  /** a test run that reports back in a moment */
  testRun?: { in: number; label: string };
  /** the thread's pull request: opened, then its checks finish, then (when green) it is merged */
  pr?: { label: string; ciIn: number; mergeIn: number };
}

/** Plausible-looking fake activity so the office can be built and tuned without live data. */
export class DemoSource implements AgentSource {
  private list: Sim[] = [];
  private fns: ((e: SourceEvent) => void)[] = [];
  private seq = 0;
  private runs = 0;
  private tokens = 0;
  private spent = 0;
  private queued = 3;
  private spawnT = 0;
  private lines = 0;

  constructor(private speed = 1, initial = 15, private seatsPerTeam = 6) {
    const statuses: Status[] = ['running', 'running', 'running', 'running', 'running', 'running', 'waiting', 'idle', 'idle', 'idle', 'idle', 'completed', 'failed', 'running', 'idle'];
    for (let i = 0; i < initial; i++) this.create(statuses[i % statuses.length], false);
    const parent = this.list.find((t) => t.status === 'running');
    if (parent) this.spawnIntern(parent, false);
    this.runs = 128;
    this.tokens = 2.9e6;
    this.spent = 16.8;
  }

  subscribe(fn: (e: SourceEvent) => void) {
    this.fns.push(fn);
  }
  private emit(e: SourceEvent) {
    for (const f of this.fns) f(e);
  }
  threads() {
    return this.list;
  }
  totals() {
    return { runs: this.runs, tokens: this.tokens, cost: this.spent, queued: this.queued };
  }

  transcript(id: string) {
    const t = this.list.find((x) => x.id === id);
    return t ? Promise.resolve([...t.log]) : Promise.reject(new Error('gone'));
  }

  private say(t: Sim, role: TranscriptItem['role'], text: string, more: Partial<TranscriptItem> = {}, ago = 0) {
    t.log.push({ id: `${t.id}-${++this.lines}`, at: Date.now() - ago * 1000, role, text, ...more });
    if (t.log.length > 80) t.log.shift();
    if (!ago) t.lastActiveAt = Date.now();
  }

  /** a thread that was already there when the office opened has some history */
  private backstory(t: Sim) {
    const n = Math.min(12, t.toolCalls);
    const span = t.status === 'idle' ? between(8, 100) * 60 : between(60, 400);
    const quiet = t.status === 'idle' ? span * 0.6 : 0;
    this.say(t, 'user', S.ask(t.title), { by: 'user' }, span + 20);
    this.say(t, 'assistant', pick(S.opener), {}, span + 12);
    for (let i = 0; i < n; i++) {
      const kind = pick<ToolKind>(['terminal', 'search', 'search', 'edit', 'edit', 'web', 'test']);
      const ago = quiet + (span - quiet) * (1 - (i + 1) / (n + 1));
      this.say(t, 'tool', pick(TOOLS[kind]), { kind }, ago);
      if (i % 4 === 3) this.say(t, 'assistant', pick(S.progress), {}, ago - 1);
    }
    if (t.status === 'waiting') this.say(t, 'assistant', pick(S.question), {}, 5);
    else if (t.status === 'failed') this.say(t, 'note', S.crashed, { kind: 'error' }, 5);
    else if (t.status !== 'running') this.say(t, 'assistant', S.done(t.title), {}, quiet);
    t.lastActiveAt = Date.now() - quiet * 1000;
  }

  private usedNames() {
    return new Set(this.list.map((t) => t.name));
  }

  private teamWithRoom() {
    const counts = [0, 0, 0, 0];
    for (const t of this.list) if (!t.parentId) counts[t.team]++;
    const open = counts.map((c, i) => [c, i]).filter(([c]) => c < this.seatsPerTeam);
    if (!open.length) return -1;
    open.sort((a, b) => a[0] - b[0] + (R() - 0.5) * 2);
    return open[0][1];
  }

  private create(status: Status, announce = true) {
    const team = this.teamWithRoom();
    if (team < 0) return;
    const provider = pick<Provider>(['claude', 'claude', 'codex', 'codex', 'cursor', 'gemini']);
    const used = this.usedNames();
    const name = NAMES[provider].find((n) => !used.has(n)) ?? `${pick(NAMES[provider])} ${++this.seq}`;
    const t: Sim = {
      id: `th-${++this.seq}`,
      name,
      title: pick(TITLES),
      provider,
      model: pick(MODELS[provider]),
      team,
      status,
      tps: status === 'running' ? between(60, 180) : 0,
      toolCalls: Math.floor(between(0, 30)),
      files: Math.floor(between(0, 5)),
      context: between(8, 70),
      cost: between(0.1, 3),
      settled: false,
      t: announce ? 0 : between(0, 30),
      dur: between(40, 120),
      nextTool: between(1, 4),
      log: [],
      lastActiveAt: Date.now(),
    };
    if (announce) {
      this.say(t, 'user', S.ask(t.title), { by: 'user' });
      this.say(t, 'assistant', pick(S.opener));
    } else this.backstory(t);
    this.list.push(t);
    if (announce) this.emit({ type: 'add', thread: t });
    return t;
  }

  private spawnIntern(parent: Sim, announce = true) {
    const used = this.usedNames();
    const t: Sim = {
      id: `th-${++this.seq}`,
      name: INTERNS.find((n) => !used.has(n)) ?? 'Pia',
      title: S.subagentOf(parent.name),
      provider: parent.provider,
      model: parent.provider === 'claude' ? 'haiku' : parent.model,
      team: parent.team,
      status: 'running',
      tps: between(150, 260),
      toolCalls: 0,
      files: 0,
      context: between(5, 20),
      cost: 0,
      settled: false,
      parentId: parent.id,
      t: 0,
      dur: between(25, 60),
      nextTool: between(1, 3),
      log: [],
      lastActiveAt: Date.now(),
    };
    this.say(t, 'user', S.ask(parent.title), { by: 'agent' });
    this.list.push(t);
    if (announce) this.emit({ type: 'add', thread: t });
  }

  private setStatus(t: Sim, to: Status) {
    const from = t.status;
    if (from === to) return;
    t.status = to;
    t.t = 0;
    t.dur = between(40, 120);
    t.tps = to === 'running' ? between(60, 180) : 0;
    if (to === 'completed') this.runs++;
    if (to === 'waiting') this.say(t, 'assistant', pick(S.question));
    else if (to === 'failed') this.say(t, 'note', S.crashed, { kind: 'error' });
    else if (to === 'completed') this.say(t, 'assistant', S.done(t.title));
    else if (to === 'running' && from === 'waiting') this.say(t, 'user', pick(S.reply), { by: 'user' });
    else if (to === 'running' && from === 'failed') this.say(t, 'assistant', S.retry);
    else if (to === 'running' && from === 'idle') this.say(t, 'user', S.ask(pick(TITLES)), { by: 'user' });
    this.emit({ type: 'status', id: t.id, from, to });
    // now and then finished work becomes a pull request
    if (to === 'completed' && !t.pr && !t.parentId && R() < 0.35) {
      t.pr = { label: `#${100 + ++this.seq} ${t.title}`, ciIn: between(6, 14), mergeIn: between(8, 20) };
      this.emit({ type: 'pr', id: t.id, state: 'opened', label: t.pr.label });
    }
  }

  private settle(t: Sim) {
    t.settled = true;
    this.emit({ type: 'settle', id: t.id });
    // the office removes the worker once they have walked out
    setTimeout(() => (this.list = this.list.filter((x) => x !== t)), 0);
  }

  update(realDt: number) {
    const dt = realDt * this.speed;
    for (const t of [...this.list]) {
      if (t.settled) continue;
      t.t += dt;
      if (t.testRun && (t.testRun.in -= dt) <= 0) {
        this.emit({ type: 'tests', id: t.id, ok: R() < 0.75, label: t.testRun.label });
        delete t.testRun;
      }
      if (t.pr) {
        if (t.pr.ciIn > 0) {
          if ((t.pr.ciIn -= dt) <= 0) {
            const ok = R() < 0.8;
            this.emit({ type: 'ci', id: t.id, ok, label: t.pr.label });
            if (!ok) delete t.pr;
          }
        } else if ((t.pr.mergeIn -= dt) <= 0) {
          this.emit({ type: 'pr', id: t.id, state: 'merged', label: t.pr.label });
          delete t.pr;
        }
      }
      if (t.status === 'running') {
        t.tps = Math.max(20, Math.min(240, t.tps + (R() - 0.5) * 40 * dt));
        const tok = t.tps * dt;
        this.tokens += tok;
        const c = tok * 1.2e-5;
        t.cost += c;
        this.spent += c;
        t.context = Math.min(99, t.context + dt * 0.25);
        t.nextTool -= dt;
        if (t.nextTool <= 0) {
          t.nextTool = between(1.5, 5);
          t.toolCalls++;
          const kind = pick<ToolKind>(['terminal', 'terminal', 'search', 'search', 'edit', 'edit', 'web', 'test']);
          if (kind === 'edit') t.files++;
          // half of the test calls are real runs that report a result a moment later
          const run = kind === 'test' && !t.testRun && R() < 0.5 ? pick(TEST_RUNS) : '';
          const label = run || pick(TOOLS[kind]);
          this.say(t, 'tool', label, { kind });
          if (t.toolCalls % 9 === 0) {
            const last = [...t.log].reverse().find((l) => l.role === 'assistant')?.text;
            this.say(t, 'assistant', pick(S.progress.filter((x) => x !== last)));
          }
          this.emit({ type: 'tool', id: t.id, kind, label });
          if (run) t.testRun = { in: between(2, 5), label: run };
        }
        if (t.context > 92) {
          t.context = 28;
          this.say(t, 'note', '', { kind: 'compact' });
          this.emit({ type: 'compact', id: t.id });
        }
        if (t.parentId) {
          if (t.t > t.dur) this.settle(t);
          continue;
        }
        if (t.t > t.dur) this.setStatus(t, 'completed');
        else if (R() < dt * 0.006) this.setStatus(t, 'waiting');
        else if (R() < dt * 0.0025) this.setStatus(t, 'failed');
        else if (R() < dt * 0.004 && !this.list.some((x) => x.parentId === t.id)) this.spawnIntern(t);
      } else if (t.status === 'waiting') {
        if (t.t > between(25, 90)) this.setStatus(t, 'running');
      } else if (t.status === 'failed') {
        if (t.t > between(25, 55)) this.setStatus(t, 'running');
      } else if (t.status === 'completed') {
        if (t.t > 7) this.setStatus(t, 'idle');
      } else if (t.status === 'idle') {
        if (R() < dt * 0.008) {
          this.setStatus(t, 'running');
          if (this.queued > 0) this.queued--;
        } else if (t.t > 70 && R() < dt * 0.006) this.settle(t);
      }
    }
    this.spawnT -= dt;
    const active = this.list.filter((t) => !t.parentId && !t.settled).length;
    if (this.spawnT <= 0) {
      this.spawnT = between(15, 40);
      if (active < 18) this.create('running');
      if (R() < 0.4) this.queued = Math.min(8, this.queued + 1);
    }
  }
}

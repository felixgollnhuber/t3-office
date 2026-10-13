import { S } from './i18n/demo';

export type Provider = 'claude' | 'codex' | 'cursor' | 'gemini';
export type Status = 'running' | 'waiting' | 'idle' | 'failed' | 'completed';
export type Activity = 'coffee' | 'toilet' | 'watercooler' | 'pingpong' | 'couch' | 'plants' | 'dance' | 'records' | 'phone';

export interface Agent {
  id: string;
  name: string;
  provider: Provider;
  model: string;
  team: number;
  status: Status;
  /** Idle or waiting agents leave their desk after a while. */
  away?: Activity;
  tokensPerSec: number;
  toolCalls: number;
  filesChanged: number;
  contextPct: number;
  costUsd: number;
  bubble?: string;
  intern?: boolean;
}

export const PROVIDERS: Record<Provider, { label: string; shirts: string[]; trims: string[] }> = {
  claude: { label: 'Claude', shirts: ['#d9774f', '#c8613f', '#e89263'], trims: ['#f3d2bc', '#8a3a24'] },
  codex: { label: 'Codex', shirts: ['#2f3a3a', '#3c4b48', '#e9e6dc'], trims: ['#7ee0b5', '#10a37f'] },
  cursor: { label: 'Cursor', shirts: ['#5b63d6', '#4950b8', '#7b82e8'], trims: ['#d6d9ff', '#2a2f7a'] },
  gemini: { label: 'Gemini', shirts: ['#3f86e0', '#7b5cd6'], trims: ['#ffd36b', '#cde4ff'] },
};

export const TEAMS = [
  { name: 'Web App', color: '#e7a948' },
  { name: 'Bots iOS', color: '#5fb3a2' },
  { name: 'T3 Tools', color: '#9b7fe0' },
  { name: 'Infra', color: '#e0727a' },
];

export const BOSS = {
  name: 'Oskar',
  title: 'Orchestrator',
  provider: 'claude' as Provider,
  model: 'opus 5.5',
  bubble: S.bossBubble,
};

export const AGENTS: Agent[] = [
  { id: 't1', name: 'Clara', provider: 'claude', model: 'opus', team: 0, status: 'running', tokensPerSec: 142, toolCalls: 38, filesChanged: 5, contextPct: 62, costUsd: 3.1, bubble: 'rg "fetchUser"…' },
  { id: 't2', name: 'Conrad', provider: 'codex', model: 'gpt-5', team: 0, status: 'running', tokensPerSec: 96, toolCalls: 21, filesChanged: 2, contextPct: 31, costUsd: 1.2 },
  { id: 't3', name: 'Kuno', provider: 'cursor', model: 'composer', team: 0, status: 'waiting', tokensPerSec: 0, toolCalls: 12, filesChanged: 1, contextPct: 18, costUsd: 0.4, bubble: S.askPush },
  { id: 't4', name: 'Clemens', provider: 'claude', model: 'sonnet', team: 0, status: 'idle', away: 'coffee', tokensPerSec: 0, toolCalls: 44, filesChanged: 7, contextPct: 74, costUsd: 2.2, bubble: S.coffee },
  { id: 't5', name: 'Cora', provider: 'codex', model: 'gpt-5', team: 0, status: 'running', tokensPerSec: 118, toolCalls: 30, filesChanged: 4, contextPct: 45, costUsd: 1.9 },

  { id: 't6', name: 'Cleo', provider: 'claude', model: 'opus', team: 1, status: 'running', tokensPerSec: 160, toolCalls: 52, filesChanged: 9, contextPct: 81, costUsd: 4.4, bubble: 'xcodebuild…' },
  { id: 't7', name: 'Cosima', provider: 'codex', model: 'gpt-5', team: 1, status: 'completed', tokensPerSec: 0, toolCalls: 27, filesChanged: 6, contextPct: 40, costUsd: 1.6, bubble: 'PR #128 ✓' },
  { id: 't8', name: 'Curtis', provider: 'cursor', model: 'composer', team: 1, status: 'idle', away: 'toilet', tokensPerSec: 0, toolCalls: 9, filesChanged: 0, contextPct: 12, costUsd: 0.3, bubble: S.brb },
  { id: 't9', name: 'Claudia', provider: 'claude', model: 'sonnet', team: 1, status: 'running', tokensPerSec: 88, toolCalls: 17, filesChanged: 3, contextPct: 29, costUsd: 0.9 },
  { id: 't9i', name: 'Cleo jr.', provider: 'claude', model: 'haiku', team: 1, status: 'running', tokensPerSec: 210, toolCalls: 6, filesChanged: 0, contextPct: 9, costUsd: 0.1, intern: true },

  { id: 't10', name: 'Cody', provider: 'codex', model: 'gpt-5', team: 2, status: 'failed', tokensPerSec: 0, toolCalls: 33, filesChanged: 4, contextPct: 57, costUsd: 1.4, bubble: S.buildBroken },
  { id: 't11', name: 'Clint', provider: 'claude', model: 'opus', team: 2, status: 'running', tokensPerSec: 131, toolCalls: 41, filesChanged: 6, contextPct: 66, costUsd: 3.6 },
  { id: 't12', name: 'Gemma', provider: 'gemini', model: 'pro', team: 2, status: 'idle', away: 'watercooler', tokensPerSec: 0, toolCalls: 15, filesChanged: 1, contextPct: 22, costUsd: 0.6 },
  { id: 't13', name: 'Colette', provider: 'codex', model: 'gpt-5', team: 2, status: 'idle', away: 'watercooler', tokensPerSec: 0, toolCalls: 19, filesChanged: 2, contextPct: 35, costUsd: 0.8, bubble: S.didYouHear },
  { id: 't14', name: 'Kurt', provider: 'cursor', model: 'composer', team: 2, status: 'running', tokensPerSec: 74, toolCalls: 11, filesChanged: 2, contextPct: 20, costUsd: 0.5 },

  { id: 't15', name: 'Clarissa', provider: 'claude', model: 'sonnet', team: 3, status: 'running', tokensPerSec: 102, toolCalls: 25, filesChanged: 3, contextPct: 38, costUsd: 1.3, bubble: 'terraform plan' },
  { id: 't16', name: 'Constantin', provider: 'codex', model: 'gpt-5', team: 3, status: 'waiting', tokensPerSec: 0, toolCalls: 8, filesChanged: 0, contextPct: 15, costUsd: 0.3, away: 'phone', bubble: S.waitingOnYou },
  { id: 't17', name: 'Cosmo', provider: 'codex', model: 'gpt-5', team: 3, status: 'idle', away: 'pingpong', tokensPerSec: 0, toolCalls: 22, filesChanged: 3, contextPct: 28, costUsd: 0.9 },
  { id: 't18', name: 'Clive', provider: 'claude', model: 'haiku', team: 3, status: 'idle', away: 'pingpong', tokensPerSec: 0, toolCalls: 14, filesChanged: 1, contextPct: 11, costUsd: 0.2 },
  { id: 't19', name: 'Genevieve', provider: 'gemini', model: 'flash', team: 3, status: 'idle', away: 'couch', tokensPerSec: 0, toolCalls: 5, filesChanged: 0, contextPct: 6, costUsd: 0.1 },
];

export const TODAY = {
  runs: 142,
  tokens: 3.14e6,
  cost: 18.4,
  queued: 4,
  history: [
    12, 18, 22, 19, 25, 31, 28, 35, 40, 38, 44, 52, 49, 55, 61, 58, 50, 46, 52, 60, 68, 74, 71, 66, 72, 80, 86, 79, 70, 64,
    58, 62, 70, 78, 84, 92, 88, 95, 101, 97, 90, 84, 88, 96, 104, 112, 108, 99, 92, 100, 110, 118, 124, 116, 108, 114, 122, 130, 126, 128,
  ],
};

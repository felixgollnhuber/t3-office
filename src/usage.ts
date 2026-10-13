import type { Provider } from './data';
import { S as T3 } from './i18n/t3';

export interface Account {
  name: string;
  left: number;
  resetAt: number;
  badge?: number;
}

export interface Pool {
  id: string;
  label: string;
  left: number;
  resetAt: number;
  trend: 'up' | 'down' | 'flat' | 'session';
  delta?: string;
  note?: string;
  accounts?: Account[];
}

export interface UsageGroup {
  provider: Provider;
  label: string;
  pools: Pool[];
}

/** Rate-limit pools per provider. Demo values for now; the T3 adapter will fill the same shape. */
export interface UsageSource {
  groups(): UsageGroup[];
  update(dt: number, running: Record<Provider, number>): void;
}

const H = 3600_000, D = 24 * H;

export class DemoUsage implements UsageSource {
  private data: UsageGroup[];
  constructor() {
    const now = Date.now();
    this.data = [
      {
        provider: 'codex',
        label: 'Codex',
        pools: [
          {
            id: 'codex-weekly',
            label: 'Weekly',
            left: 0.69,
            resetAt: now + 6 * D + 5 * H,
            trend: 'up',
            delta: '+26%',
            accounts: [
              { name: 'Codex-2', left: 0.48, resetAt: now + 6 * D + 5 * H, badge: 2 },
              { name: 'Codex', left: 0.9, resetAt: now + 6 * D + 11 * H, badge: 1 },
            ],
          },
        ],
      },
      {
        provider: 'claude',
        label: 'Claude',
        pools: [
          { id: 'claude-session', label: 'Session', left: 1, resetAt: now + 4 * H + 57 * 60_000, trend: 'session' },
          { id: 'claude-weekly', label: 'Weekly', left: 0.23, resetAt: now + 2 * D + 17 * H, trend: 'up' },
          { id: 'claude-fable', label: 'Weekly · Fable', left: 1, resetAt: now + 2 * D + 17 * H, trend: 'down' },
        ],
      },
      {
        provider: 'cursor',
        label: 'Cursor',
        pools: [
          { id: 'cursor-models', label: 'Cursor Models', left: 1, resetAt: now + 30 * D + 19 * H, trend: 'flat', note: T3.cursorAuto },
          { id: 'cursor-other', label: 'Other Models', left: 0.62, resetAt: now + 30 * D + 19 * H, trend: 'flat', note: T3.cursorApi },
        ],
      },
    ];
  }

  groups() {
    return this.data;
  }

  update(dt: number, running: Record<Provider, number>) {
    const now = Date.now();
    for (const g of this.data) {
      const n = running[g.provider] ?? 0;
      for (const p of g.pools) {
        const rate = p.id === 'claude-session' ? 4e-5 : p.id.includes('fable') ? 0 : 6e-6;
        p.left = Math.max(0, p.left - n * rate * dt);
        if (p.accounts) {
          for (const a of p.accounts) a.left = Math.max(0, a.left - n * rate * dt * 0.5);
          p.left = p.accounts.reduce((s, a) => s + a.left, 0) / p.accounts.length;
        }
        if (now > p.resetAt) {
          p.left = 1;
          p.resetAt = now + (p.id === 'claude-session' ? 5 * H : 7 * D);
        }
      }
    }
  }
}

export function resetIn(at: number) {
  const ms = Math.max(0, at - Date.now());
  const d = Math.floor(ms / D), h = Math.floor((ms % D) / H), m = Math.floor((ms % H) / 60_000);
  return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}m`;
}

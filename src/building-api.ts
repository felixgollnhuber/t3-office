/** Minimal sharing contract. Deliberately excludes tasks, transcripts, paths, costs and tool output. */
import type { Provider, Status } from './data';

export interface Session {
  user: { id: string; handle: string; name: string };
  office: { id: string; name: string; paused: boolean };
}
export interface Floor {
  id: string;
  name: string;
  ownerName: string;
  isOwner: boolean;
  scope: 'owner' | 'presence' | 'activity';
  online: boolean;
  updatedAt: number | null;
  agentCount: number;
}
export interface SharedAgent { id: string; name: string; provider: Provider; status: Status }
export interface OfficeSnapshot { office: Floor; agents: SharedAgent[] }
export interface Grant { id: string; userName: string; userHandle: string; scope: 'presence' | 'activity' }
export interface Invite { id: string; scope: 'presence' | 'activity'; expiresAt: number }

export class ApiError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

export async function api<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const res = await fetch(`/api/building${path}`, {
    method,
    credentials: 'same-origin',
    cache: 'no-store',
    signal: AbortSignal.timeout(7000),
    headers: method === 'GET' ? {} : { 'Content-Type': 'application/json' },
    body: method === 'GET' ? undefined : JSON.stringify(body ?? {}),
  });
  const json = await res.json().catch(() => ({ error: 'The building service is unavailable.' }));
  if (!res.ok) throw new ApiError(json.error ?? 'Request failed.', res.status);
  return json as T;
}

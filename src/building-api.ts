import type { CharacterStyle } from './character-style';
import type { Appearance } from './appearance';
/** Minimal sharing contract. Deliberately excludes tasks, transcripts, paths, costs and tool output. */
import type { Provider, Status } from './data';

export interface Session {
  user: { id: string; handle: string; name: string };
  office: { id: string; name: string; paused: boolean; appearance: Appearance };
}
export interface Floor {
  id: string;
  name: string;
  ownerName: string;
  isOwner: boolean;
  scope: 'owner' | 'presence' | 'activity';
  online: boolean;
  paused?: boolean;
  moment?: { id: string; title: string; kind: 'shipped' | 'milestone' | 'helped'; createdAt: number };
  appearance?: Appearance;
  updatedAt: number | null;
  agentCount: number;
  areas: { area: WorkArea; count: number }[];
}
export const WORK_AREAS = ['general', 'frontend', 'backend', 'design', 'testing', 'research', 'operations'] as const;
export type WorkArea = (typeof WORK_AREAS)[number];
export interface SharedAgent { id: string; name: string; provider: Provider; status: Status; area: WorkArea; style?: CharacterStyle }
export interface OfficeSnapshot { office: Floor; agents: SharedAgent[] }
export interface Grant { id: string; userName: string; userHandle: string; scope: 'presence' | 'activity' }
export interface Invite { id: string; scope: 'presence' | 'activity'; expiresAt: number }

export class ApiError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

export async function api<T>(path: string, method = 'GET', body?: unknown, retryContext = true): Promise<T> {
  const res = await fetch(`/api/building${path}`, {
    method,
    credentials: 'same-origin',
    cache: 'no-store',
    signal: AbortSignal.timeout(7000),
    headers: method === 'GET' ? {} : { 'Content-Type': 'application/json' },
    body: method === 'GET' ? undefined : JSON.stringify(body ?? {}),
  });
  // Preserve abort/parse failures. Treating an interrupted 200 response as success
  // made shared views mistake a temporary connection failure for a missing office.
  const json = await res.json();
  if(res.status===428&&retryContext&&method==='POST'&&['/register','/login','/logout','/auth/github/start','/auth/github/confirm'].includes(path)){await api('/auth/providers');return api<T>(path,method,body,false);}
  if (!res.ok) throw new ApiError(json.error ?? 'Request failed.', res.status);
  return json as T;
}

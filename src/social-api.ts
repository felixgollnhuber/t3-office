/** Explicitly opted-in social data only: never inferred from agents or private work. */
import { api } from './building-api';
export interface FocusParticipant { userId: string; name: string; quiet: boolean }
export interface FocusSession {
  id: string; officeId: string; officeName: string; hostId: string; hostName: string;
  startedAt: number; endsAt: number; participants: FocusParticipant[]; participantCount: number;
  isHost: boolean; joined: boolean; doorbell?: 'open'|'approval'|'dnd';
}
export type MomentKind = 'shipped' | 'milestone' | 'helped';
export interface Moment {
  id: string; officeId: string; officeName: string; ownerName: string;
  title: string; kind: MomentKind; createdAt: number; isOwner: boolean;
}
export interface SocialState { viewerId: string; serverNow: number; sessions: FocusSession[]; moments: Moment[] }
export const getSocial = () => api<SocialState>('/social');
export const startFocus = (minutes: 25 | 50, quiet: boolean, actorId?: string) => api<FocusSession>('/focus', 'POST', { minutes, quiet, actorId });
export const joinFocus = (id: string, quiet: boolean, actorId?: string) => api<FocusSession>(`/focus/${encodeURIComponent(id)}/join`, 'POST', { quiet, actorId });
export const leaveFocus = (id: string, actorId?: string) => api<{ ok: true }>(`/focus/${encodeURIComponent(id)}/leave`, 'POST', {actorId});
export const endFocus = (id: string, actorId?: string) => api<{ ok: true }>(`/focus/${encodeURIComponent(id)}`, 'DELETE', {actorId});
export const publishMoment = (title: string, kind: MomentKind, actorId?: string) => api<Moment>('/moments', 'POST', { title, kind, actorId });
export const deleteMoment = (id: string, actorId?: string) => api<{ ok: true }>(`/moments/${encodeURIComponent(id)}`, 'DELETE', {actorId});

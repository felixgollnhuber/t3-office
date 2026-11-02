import type { WorkArea } from './building-api';
import type { CharacterStyle } from './character-style';
export type CharacterProfile = { name: string; area: WorkArea; style?: CharacterStyle };
export const PROFILE_KEY = 'office.character-profiles.v1';
export function readProfiles(): Record<string, CharacterProfile> {
  try { const raw = JSON.parse(localStorage.getItem(PROFILE_KEY) ?? '{}'); if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw; } catch { /* unreadable preferences */ }
  return {};
}
export function saveProfile(id: string, profile: CharacterProfile) {
  const profiles = readProfiles(); profiles[id] = profile;
  localStorage.setItem(PROFILE_KEY, JSON.stringify(profiles));
  window.dispatchEvent(new Event('office-profile-change'));
}

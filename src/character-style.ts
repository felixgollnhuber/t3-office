/** Bounded appearance choices shared by renderer, editor and permission API. */
export const HAIR_STYLES = ['short', 'long', 'bun', 'curly', 'bald', 'cap', 'ponytail', 'mohawk'] as const;
export const OUTFITS = ['hoodie', 'blazer', 'tee', 'sweater'] as const;
export const SKIN_COLORS = ['#f6d3b3', '#eab894', '#d39a6e', '#b9794f', '#8d5a3b', '#6a4029', '#f2c7a5'] as const;
export const HAIR_COLORS = ['#241e1b', '#503626', '#916347', '#dfbd73', '#be6745', '#bcbfc5', '#2a1e1a', '#4a2f22', '#7a4a2a', '#c58b4a', '#e8c27a', '#1c1c24', '#8f3b2e', '#d9d4cc', '#5b3a6e'] as const;
export const SHIRT_COLORS = ['#10a37f', '#d9774f', '#5b63d6', '#3f86e0', '#d35c82', '#dbb34b', '#344450', '#e6e1d3', '#c8613f', '#e89263', '#2f3a3a', '#3c4b48', '#e9e6dc', '#4950b8', '#7b82e8', '#7b5cd6'] as const;
export interface CharacterStyle { hairStyle: typeof HAIR_STYLES[number]; outfit: typeof OUTFITS[number]; skin: string; hair: string; shirt: string; glasses: boolean }
export function isCharacterStyle(value: unknown): value is CharacterStyle {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const v = value as CharacterStyle;
  return HAIR_STYLES.includes(v.hairStyle) && OUTFITS.includes(v.outfit) && (SKIN_COLORS as readonly string[]).includes(v.skin) && (HAIR_COLORS as readonly string[]).includes(v.hair) && (SHIRT_COLORS as readonly string[]).includes(v.shirt) && typeof v.glasses === 'boolean';
}
export function cleanCharacterStyle(v: CharacterStyle): CharacterStyle {
  return { hairStyle: v.hairStyle, outfit: v.outfit, skin: v.skin, hair: v.hair, shirt: v.shirt, glasses: v.glasses };
}

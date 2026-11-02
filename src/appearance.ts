/** Public, allowlisted room preferences. No local work information belongs here. */
export const OFFICE_THEMES = ['loft', 'campus', 'soma', 'boiler'] as const;
export const OFFICE_LAYOUTS = ['original', 'focus', 'lounge'] as const;
export const OFFICE_LIGHTING = ['original', 'warm', 'cool'] as const;
export type Appearance = { theme: typeof OFFICE_THEMES[number]; layout: typeof OFFICE_LAYOUTS[number]; lighting: typeof OFFICE_LIGHTING[number]; identity?: FloorIdentity };
export const DEFAULT_APPEARANCE: Appearance = { theme: 'campus', layout: 'original', lighting: 'original' };
export function isAppearance(value: unknown): value is Appearance {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const a = value as Appearance;
  return OFFICE_THEMES.includes(a.theme) && OFFICE_LAYOUTS.includes(a.layout) && OFFICE_LIGHTING.includes(a.lighting) && (a.identity === undefined || isIdentity(a.identity));
}

export const FLOOR_ACCENTS = ['original', 'sage', 'amber', 'rose', 'sky'] as const;
export const FLOOR_EMBLEMS = ['none', 'leaf', 'star', 'moon'] as const;
export const FLOOR_ITEMS = ['none', 'plant', 'books', 'lamp'] as const;
export const FLOOR_SLOTS = ['west', 'center', 'east'] as const;
export type FloorIdentity = { accent: typeof FLOOR_ACCENTS[number]; emblem: typeof FLOOR_EMBLEMS[number]; slots: Record<typeof FLOOR_SLOTS[number], typeof FLOOR_ITEMS[number]> };
export const DEFAULT_IDENTITY: FloorIdentity = { accent: 'original', emblem: 'none', slots: { west: 'none', center: 'none', east: 'none' } };
export function isIdentity(value: unknown): value is FloorIdentity {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const v = value as FloorIdentity;
  return FLOOR_ACCENTS.includes(v.accent) && FLOOR_EMBLEMS.includes(v.emblem) && !!v.slots && typeof v.slots === 'object' && FLOOR_SLOTS.every(s => FLOOR_ITEMS.includes(v.slots[s]));
}
export function cleanAppearance(value: Appearance): Appearance {
  const d = value.identity;
  return { theme:value.theme,layout:value.layout,lighting:value.lighting,...(isIdentity(d) ? {identity:{accent:d.accent,emblem:d.emblem,slots:{west:d.slots.west,center:d.slots.center,east:d.slots.east}}} : {}) };
}

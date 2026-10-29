/** Public, allowlisted room preferences. No local work information belongs here. */
export const OFFICE_THEMES = ['loft', 'campus', 'soma', 'boiler'] as const;
export const OFFICE_LAYOUTS = ['original', 'focus', 'lounge'] as const;
export const OFFICE_LIGHTING = ['original', 'warm', 'cool'] as const;
export type Appearance = { theme: typeof OFFICE_THEMES[number]; layout: typeof OFFICE_LAYOUTS[number]; lighting: typeof OFFICE_LIGHTING[number] };
export const DEFAULT_APPEARANCE: Appearance = { theme: 'campus', layout: 'original', lighting: 'original' };
export function isAppearance(value: unknown): value is Appearance {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const a = value as Appearance;
  return OFFICE_THEMES.includes(a.theme) && OFFICE_LAYOUTS.includes(a.layout) && OFFICE_LIGHTING.includes(a.lighting);
}

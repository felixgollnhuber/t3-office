import type { SeasonSetting } from './settings';

export type SeasonKind = 'none' | 'halloween' | 'winter' | 'christmas';

/**
 * The season the office decorates for: Halloween in October, Christmas from Dec 1 to 26 (both by the northern
 * calendar, wherever you are), winter for the rest of the meteorological winter of the hemisphere.
 */
export function seasonOf(date: Date, lat: number): SeasonKind {
  const m = date.getMonth(), d = date.getDate();
  if (m === 9) return 'halloween';
  if (m === 11 && d <= 26) return 'christmas';
  const winter = lat >= 0 ? m === 11 || m <= 1 : m >= 5 && m <= 7;
  return winter ? 'winter' : 'none';
}

/** What the setting makes of it: 'auto' follows the calendar, 'off' never decorates, the rest pins a season. */
export function resolveSeason(setting: SeasonSetting, date: Date, lat: number): SeasonKind {
  if (setting === 'auto') return seasonOf(date, lat);
  return setting === 'off' ? 'none' : setting;
}

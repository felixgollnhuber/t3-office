import type { Appearance } from './appearance';
import type { Theme } from './themes';

/** Use established furniture builders so navigation and interaction spots stay aligned. */
export function styleRoom(base: Theme, appearance: Appearance): Theme {
  const theme = { ...base, props: { ...base.props }, lights: { ...base.lights }, post: { ...base.post } };
  if (appearance.layout === 'focus') Object.assign(theme.props, { pingpong: false, beanbags: false, couch: false, plants: 3 });
  if (appearance.layout === 'lounge') Object.assign(theme.props, { pingpong: true, beanbags: true, couch: true, plants: 8 });
  if (appearance.lighting === 'warm') Object.assign(theme.lights, { lamp: '#ffc080', lamp2: '#ff9e70', lampIntensity: 7, sky: '#ffdfbd', sun: '#ffe1b8' });
  if (appearance.lighting === 'cool') Object.assign(theme.lights, { lamp: '#b6deff', lamp2: '#b2c7ff', lampIntensity: 7, sky: '#c2ddff', sun: '#d6eaff' });
  return theme;
}

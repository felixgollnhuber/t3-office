import { locale } from './index';

/** Per-theme copy; theme names (Lo-Fi Loft, Boiler Room, …) are proper names and stay. */
export const S = locale({
  en: {
    loft: { tagline: 'Rain on the window, warm lamps, a cat on the server.', weather: 'Rain · 11°' },
    campus: { tagline: 'Bright, lots of green, ping-pong and kombucha on tap.', weather: 'Sunny · 21°' },
    soma: { tagline: 'A startup in an old warehouse: golden hour, neon and brick.', weather: 'Golden hour · 19°' },
    boiler: { tagline: 'Set is on: lights off, fog on, everyone nodding in time.', weather: 'Basement air · 27°' },
  },
  de: {
    loft: { tagline: 'Regen am Fenster, warme Lampen, eine Katze auf dem Server.', weather: 'Regen · 11°' },
    campus: { tagline: 'Hell, viel Grün, Tischtennis und Kombucha vom Fass.', weather: 'Sonnig · 21°' },
    soma: { tagline: 'Startup in einer alten Lagerhalle, Golden Hour, Neon und Ziegel.', weather: 'Golden Hour · 19°' },
    boiler: { tagline: 'Set läuft: Licht aus, Nebel an, alle nicken im Takt.', weather: 'Kellerklima · 27°' },
  },
});

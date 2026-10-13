import { locale } from './index';

/**
 * The generative radio. `titles` and `artists` must keep their length in every language:
 * a track is its index, and the artist is drawn from the seed.
 */
export const S = locale({
  en: {
    titles: [
      'Coffee Grounds', 'Neon on Glass', 'Midnight Commit', 'Merge Conflict Blues', 'Sunday Bagels', 'Quiet Fans',
      'Green Build', 'Fog over Ottakring', 'Stand-up at Ten', 'Oat Flat White', 'Tabs vs. Spaces', 'Pull Request Pause',
      'Last Tram Home', 'Sprint Retro', 'Down by the Danube', 'Radiator Ticking', 'Gentle Rebase', 'Pixel Clouds', 'Clocking-Off Pint',
      'Dark Mode', 'Headphones On', 'Stale Branches', 'Lazy Loading', 'Window Seat', 'Cache Miss', 'Friday Deploy',
      'Desk Plant', '404 Dreams Not Found', 'Fridge Hum', 'Ctrl+Z', "Oskar's Coffee Mug", 'Hello World, Quietly',
    ],
    artists: ['coffeekid', 'Night Shift', 'lofi.lion', 'Amber Beats', 'Mooncat', 'tape.tram', 'Mr. Sunshine', 'Attic Tapes', 'The Agents', 'Smokes & Tea'],
    mood: { dreamy: 'Dreamy', night: 'Late Night', jazzy: 'Jazzy', melancholy: 'Melancholy', sunny: 'Sunny', chillhop: 'Chillhop' },
  },
  de: {
    titles: [
      'Kaffeesatz', 'Neon auf Glas', 'Commit um Mitternacht', 'Merge Conflict Blues', 'Sonntagsbrötchen', 'Leise Lüfter',
      'Grüner Build', 'Nebel über Ottakring', 'Stand-up um zehn', 'Hafer Flat White', 'Tabs vs. Spaces', 'Pull Request Pause',
      'Späte Straßenbahn', 'Sprint Retro', 'Donauufer', 'Heizung tickt', 'Sanfter Rebase', 'Pixelwolken', 'Feierabendbier',
      'Dark Mode', 'Kopfhörer auf', 'Stille Branches', 'Lazy Loading', 'Fensterplatz', 'Cache Miss', 'Deploy am Freitag',
      'Zimmerpflanze', '404 Träume', 'Kühlschrankbrummen', 'Strg+Z', 'Oskars Kaffeetasse', 'Hello World, leise',
    ],
    artists: ['kaffeekind', 'Nachtschicht', 'lofi.löwe', 'Bernsteinbeats', 'Mondkatze', 'tape.tram', 'Herr Sonnenschein', 'Dachgeschoss Tapes', 'die Agents', 'Tschick & Tee'],
    mood: { dreamy: 'Verträumt', night: 'Nacht', jazzy: 'Jazzig', melancholy: 'Melancholie', sunny: 'Sonnig', chillhop: 'Chillhop' },
  },
});

import { locale } from './index';

/** The quota board on the boss-office wall and its close-up. */
export const S = locale({
  en: {
    title: 'Quotas',
    all: 'All',
    back: 'back (Esc)',
    left: 'left',
    demo: 'live · demo data',
    /** pool name as printed small on the wall */
    poolOnWall: (label: string) => label,
  },
  de: {
    title: 'Kontingente',
    all: 'Alle',
    back: 'zurück (Esc)',
    left: 'übrig',
    demo: 'live · Demo-Werte',
    poolOnWall: (label) => label.replace('Weekly', 'Woche').replace('Session', 'Sitzung'),
  },
});

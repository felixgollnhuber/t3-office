import { locale } from './index';

/** Texts of main.ts: toasts, hover hints of the clickable spots, boss warnings. */
export const S = locale({
  en: {
    opening: (title: string) => `Opening in T3: ${title}`,
    openDemo: (name: string, title: string) => `Open thread: ${name} · ${title} (demo data)`,
    openDemoTitle: (title: string) => `Open thread: ${title} (demo data)`,
    goneInT3: (title: string) => `“${title}” no longer exists in T3`,
    bossBusy: 'Oskar is running all the threads right now',
    hintQuota: 'View quotas',
    hintBoard: 'View pinboard',
    quotaLow: (group: string, pool: string, percent: number) => `${group} ${pool}: only ${percent}% left!`,
    hintAgent: (name: string) => `${name} · double-click opens the thread`,
    directorOn: 'Director camera on · any input pauses it',
    directorOff: 'Director camera off',
    kioskOn: 'Kiosk mode · press , for the settings',
  },
  de: {
    opening: (title: string) => `Öffne in T3: ${title}`,
    openDemo: (name: string, title: string) => `Thread öffnen: ${name} · ${title} (Demo-Daten)`,
    openDemoTitle: (title: string) => `Thread öffnen: ${title} (Demo-Daten)`,
    goneInT3: (title: string) => `„${title}“ gibt es in T3 nicht mehr`,
    bossBusy: 'Oskar orchestriert gerade alle Threads',
    hintQuota: 'Kontingente ansehen',
    hintBoard: 'Pinnwand ansehen',
    quotaLow: (group: string, pool: string, percent: number) => `${group} ${pool}: nur noch ${percent}%!`,
    hintAgent: (name: string) => `${name} · Doppelklick öffnet den Thread`,
    directorOn: 'Regie-Kamera an · jede Eingabe pausiert sie',
    directorOff: 'Regie-Kamera aus',
    kioskOn: 'Kiosk-Modus · mit , zu den Einstellungen',
  },
});

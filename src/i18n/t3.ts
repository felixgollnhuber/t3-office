import { locale } from './index';

/**
 * Texts of t3source.ts. The dev server (server/t3.ts) is language-neutral: it sends codes plus raw values,
 * and these turn them into what the office shows.
 */
export const S = locale({
  en: {
    // tool labels (speech bubbles, history, "right now")
    waiting: 'waiting on you',
    script: (interpreter: string) => `${interpreter} script`,
    edit: (file: string) => `edit ${file}`,
    file: 'file',
    web: (host: string) => `Web: ${host}`,
    webSearch: 'web search',
    find: (pattern: string) => `searching ${pattern}`,
    fileSearch: 'file search',
    read: (file: string) => `reading ${file}`,
    delegate: (task: string) => `delegates: ${task}`,
    delegates: 'delegates a task',
    compacted: 'context compacted',
    unknownProject: 'Unknown',
    // why T3 can't be read
    dbMissing: (path: string) => `T3 database not found (${path})`,
    notRunning: (pid: string) => `T3 Code is not running (pid ${pid} not active)`,
    noRuntime: 'T3 Code is not running (no server-runtime.json)',
    readFailed: (message: string) => `Can't read T3 data: ${message}`,
    // why a provider has no quota pools
    noQuotaData: 'no quota data in the cache',
    noProvider: 'no provider set up in T3',
    // notes under Cursor's quota pools, by T3's window id
    cursorAuto: 'Grok and Composer use this first. Auto can use either pool.',
    cursorApi: 'Claude, GPT, and Gemini use this pool. Grok and Composer fall back here.',
  },
  de: {
    waiting: 'wartet auf dich',
    script: (interpreter: string) => `${interpreter}-Skript`,
    edit: (file: string) => `edit ${file}`,
    file: 'Datei',
    web: (host: string) => `Web: ${host}`,
    webSearch: 'Websuche',
    find: (pattern: string) => `suche ${pattern}`,
    fileSearch: 'Dateisuche',
    read: (file: string) => `liest ${file}`,
    delegate: (task: string) => `delegiert: ${task}`,
    delegates: 'delegiert eine Aufgabe',
    compacted: 'Kontext komprimiert',
    unknownProject: 'Unbekannt',
    dbMissing: (path: string) => `T3-Datenbank nicht gefunden (${path})`,
    notRunning: (pid: string) => `T3 Code läuft nicht (pid ${pid} nicht aktiv)`,
    noRuntime: 'T3 Code läuft nicht (keine server-runtime.json)',
    readFailed: (message: string) => `T3-Daten nicht lesbar: ${message}`,
    noQuotaData: 'keine Kontingentdaten im Cache',
    noProvider: 'kein Provider in T3 eingerichtet',
    cursorAuto: 'Grok und Composer nutzen zuerst diesen Pool. Auto kann beide Pools nutzen.',
    cursorApi: 'Claude, GPT und Gemini nutzen diesen Pool. Grok und Composer weichen hierher aus.',
  },
});

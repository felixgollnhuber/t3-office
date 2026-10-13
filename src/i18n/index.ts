/**
 * Localization. Every module keeps its texts in a table under src/i18n/, one block per language:
 *
 *   export const S = locale({
 *     en: { typing: (n: number) => `${n} typing`, done: 'done' },
 *     de: { typing: (n: number) => `${n} tippen`, done: 'fertig' },
 *   });
 *
 * `en` is the reference: every other block must have exactly its shape, so a missing text is a compile error.
 * The language is fixed at page load; switching reloads the page.
 */
export const LANGS = [
  { id: 'en', label: 'English', tag: 'en-US' },
  { id: 'de', label: 'Deutsch', tag: 'de-DE' },
] as const;
export type Lang = (typeof LANGS)[number]['id'];

const KEY = 'office.lang';
const known = (x: string | null | undefined): x is Lang => LANGS.some((l) => l.id === x);

function detect(): Lang {
  const q = new URLSearchParams(location.search).get('lang');
  if (known(q)) return q;
  const stored = localStorage.getItem(KEY);
  if (known(stored)) return stored;
  for (const n of navigator.languages ?? [navigator.language]) {
    const id = n.toLowerCase().split('-')[0];
    if (known(id)) return id;
  }
  return 'en';
}

/** the language of this page view */
export const lang: Lang = detect();
/** BCP 47 tag for Intl and toLocaleString */
export const localeTag: string = LANGS.find((l) => l.id === lang)!.tag;
document.documentElement.lang = lang;

export function setLang(l: Lang) {
  localStorage.setItem(KEY, l);
  const url = new URL(location.href);
  url.searchParams.delete('lang');
  location.replace(url);
}

/** Picks this page's language out of a table of texts. */
export function locale<T>(table: { en: T } & Record<Lang, NoInfer<T>>): T {
  return table[lang];
}

/** 1234.5 → "1,234.5" / "1.234,5" */
export function num(n: number, digits = 0, maxDigits = digits) {
  return n.toLocaleString(localeTag, { minimumFractionDigits: digits, maximumFractionDigits: maxDigits });
}

/** US dollars the way the language writes them: "$1,234.50" / "1.234,50 $" */
export function usd(n: number, digits = 2) {
  return n.toLocaleString(localeTag, { style: 'currency', currency: 'USD', minimumFractionDigits: digits, maximumFractionDigits: digits });
}

/** 0.123 → "12.3%" / "12,3 %" */
export function pct(frac: number, digits = 0) {
  return frac.toLocaleString(localeTag, { style: 'percent', minimumFractionDigits: digits, maximumFractionDigits: digits });
}

/** wall-clock time "14:05"; both languages use the 24 h clock, the office clock is a pixel display */
export function hhmm(d: Date) {
  return d.toLocaleTimeString(localeTag, { hour: '2-digit', minute: '2-digit', hour12: false });
}

/** Intl date formatting in the page language */
export function date(d: Date, opts: Intl.DateTimeFormatOptions) {
  return d.toLocaleDateString(localeTag, opts);
}

/** "one thread" / "3 threads": picks by plural rule ("one" | "other" is enough for en and de) */
export function plural(n: number, one: string, other: string) {
  return new Intl.PluralRules(localeTag).select(n) === 'one' ? one : other;
}

import { locale, plural } from './index';

/** HUD panels (clock, DJ booth, receipt, pulse, grapevine), name tags and the weather button. */
export const S = locale({
  en: {
    // clock panel
    weekdays: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
    months: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
    dateLine: (weekday: string, day: number, month: string) => `${weekday}, ${month} ${day}`,
    timeTravel: 'time travel',
    lightLeft: (h: number, min: number) => `${h} h ${min} min of light left`,
    night: 'Night, lamps on',
    language: (name: string) => `Language: ${name}`,

    // weather button
    weather: (mode: string) => `Weather: ${mode}`,
    sky: { clear: 'clear', cloudy: 'cloudy', rain: 'rain', storm: 'storm', snow: 'snow' },
    skySimulated: (sky: string) => `${sky} · simulated`,
    weatherMode: { real: 'Real', sim: 'Simulated', clear: 'Clear', rain: 'Rain', storm: 'Storm', snow: 'Snow' },
    weatherHint: 'Click for the next weather mode',
    settings: 'Settings ( , )',

    // crew counts
    typing: (n: number) => `${n} typing`,
    waiting: (n: number) => `${n} waiting on you`,
    onBreak: (n: number) => `${n} on break`,
    out: (n: number) => `${n} out`,
    crashedDone: (crashed: number, done: number) => `${crashed} crashed · ${done} done`,

    // name tags
    status: { waiting: 'waiting on you', idle: 'on break', failed: 'crashed', completed: 'done' },

    // DJ booth
    deck: 'DJ booth',
    like: 'save',
    seek: 'click or drag to seek',
    prev: 'previous',
    next: 'next',
    showVideo: 'Show the YouTube picture (costs performance)',
    hideVideo: 'Hide video',
    unlockHint: 'Click anywhere to allow sound',
    embedBlocked: "YouTube won't let this set play here",
    openOnYouTube: 'open on YouTube ↗',
    moreSets: 'more sets to come · YouTube',
    noLikes: 'Nothing saved yet. Hit ♡ on a track.',

    // receipt
    receipt: 'Receipt · today',
    cost: 'Cost',
    flatWhites: (n: number) => `= ${n} ${plural(n, 'flat white', 'flat whites')}`,

    // pulse
    lastMinutes: 'Last 4 minutes',
    pulseNow: (tps: string, queued: number) => `<b>${tps}</b> tok/s now · ${queued} in the queue`,

    // grapevine
    grapevine: 'Grapevine',
    starts: (name: string, title: string) => `${name} picks up: ${title}`,
    helps: (intern: string, boss: string) => `${intern} lends ${boss} a hand`,
    waitsOnYou: (name: string) => `${name} is waiting on you`,
    failedIn: (name: string, title: string) => `${name}: error in “${title}”`,
    isDone: (name: string) => `${name} is done ✓`,
    clocksOff: (name: string) => `${name} packs up, clocking off`,
    compacts: (name: string) => `${name} tidies up the context`,
  },
  de: {
    weekdays: ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'],
    months: ['Jän', 'Feb', 'März', 'Apr', 'Mai', 'Juni', 'Juli', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'],
    dateLine: (weekday, day, month) => `${weekday}, ${day}. ${month}`,
    timeTravel: 'Zeitreise',
    lightLeft: (h, min) => `noch ${h} h ${min} min Licht`,
    night: 'Nacht, Lampen an',
    language: (name) => `Sprache: ${name}`,

    weather: (mode) => `Wetter: ${mode}`,
    sky: { clear: 'klar', cloudy: 'bewölkt', rain: 'Regen', storm: 'Gewitter', snow: 'Schnee' },
    skySimulated: (sky) => `${sky} · simuliert`,
    weatherMode: { real: 'Echt', sim: 'Simuliert', clear: 'Klar', rain: 'Regen', storm: 'Gewitter', snow: 'Schnee' },
    weatherHint: 'Klick für den nächsten Wettermodus',
    settings: 'Einstellungen ( , )',

    typing: (n) => `${n} tippen`,
    waiting: (n) => `${n} warten auf dich`,
    onBreak: (n) => `${n} in der Pause`,
    out: (n) => `${n} unterwegs`,
    crashedDone: (crashed, done) => `${crashed} abgestürzt · ${done} fertig`,

    status: { waiting: 'wartet auf dich', idle: 'Pause', failed: 'abgestürzt', completed: 'fertig' },

    deck: 'DJ-Pult',
    like: 'merken',
    seek: 'klicken oder ziehen zum Spulen',
    prev: 'zurück',
    next: 'weiter',
    showVideo: 'YouTube-Bild zeigen (kostet Leistung)',
    hideVideo: 'Video ausblenden',
    unlockHint: 'Klick irgendwo, um Ton zu erlauben',
    embedBlocked: 'YouTube lässt dieses Set hier nicht einbetten',
    openOnYouTube: 'auf YouTube öffnen ↗',
    moreSets: 'weitere Sets folgen · YouTube',
    noLikes: 'Noch nichts gemerkt. Drück ♡ beim Track.',

    receipt: 'Kassenbon · heute',
    cost: 'Kosten',
    flatWhites: (n) => `= ${n} Flat Whites`,

    lastMinutes: 'Letzte 4 Minuten',
    pulseNow: (tps, queued) => `<b>${tps}</b> tok/s jetzt · ${queued} in der Warteschlange`,

    grapevine: 'Flurfunk',
    starts: (name, title) => `${name} fängt an: ${title}`,
    helps: (intern, boss) => `${intern} hilft ${boss} aus`,
    waitsOnYou: (name) => `${name} wartet auf dich`,
    failedIn: (name, title) => `${name}: Fehler in „${title}“`,
    isDone: (name) => `${name} ist fertig ✓`,
    clocksOff: (name) => `${name} packt zusammen, Feierabend`,
    compacts: (name) => `${name} räumt den Kontext auf`,
  },
});

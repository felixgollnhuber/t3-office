/** What the boss says on his rounds, and what people answer him. */
import { locale } from './index';

export const S = locale({
  en: {
    // someone knocks on the glass door
    knockSeated: ['one moment!', 'come in', 'yes?', 'I’ll take a look'],
    knockAway: ['coming!', 'one second', 'on my way'],
    // his own thread waits for the user
    needsYou: ['got a minute?', 'need a decision', 'waiting on you'],

    // passing on an order
    phoneBye: ['thanks, talk soon', 'good, let’s do that', 'bye'],
    replyLaunch: ['on it!', 'sure thing, boss', 'starting now'],
    replySend: ['okay!', 'will do', 'got it', 'sounds good', 'on it'],
    newForYou: (what: string) => `one for you: ${what}`,

    // desk visits
    whatNeed: (name: string) => `${name}, what do you need?`,
    askWaiting: ['where are you stuck?', 'need a sign-off?'],
    replyWaiting: ['a quick question', 'quick look?', 'sign-off please'],
    askFailed: ['what happened?', 'show me the error', 'start over?'],
    replyFailed: ['tests are red…', 'build’s broken', 'I’ll fix it'],
    askRunning: ['looking good!', 'keep it up', 'how far along?', 'nice work'],
    replyRunning: ['almost done', 'going well!', 'thanks!', 'a bit longer'],

    // rounds
    quota: ['quota’s fine', 'hm, those limits…', 'tokens will last', 'reset’s soon'],
    pinboard: ['what’s up next?', 'sort the backlog', 'we’ll push that', 'review first'],
    coffee: ['coffee first', 'caffeine!', ''],
    phoneHello: ['yes, hello?', 'Oskar speaking', 'ah, glad you called'],
    phoneListen: ['yeah… yeah…', 'I see', 'mhm'],
    phoneAgree: ['let’s do that', 'by Friday, sure', 'send it over'],
    phoneEnd: 'bye!',
    windowRain: ['rain again', 'miserable weather'],
    windowFine: ['nice day', 'hmm…'],
    dance: ['yeah!', 'what a set', 'louder!'],

    // the quota runs low
    budgetLow: ['hm, those limits…', 'we have to slow down', 'this won’t last the week'],
    budgetCritical: ['almost nothing left!', 'who’s burning all the tokens?', 'not good, not good…', 'when’s the reset?!'],
    budgetOut: (provider: string) => `${provider} is used up!`,
    budgetBack: 'phew, quota’s back',
  },
  de: {
    knockSeated: ['Moment!', 'komm rein', 'ja?', 'schau ich mir an'],
    knockAway: ['komme gleich!', 'eine Sekunde', 'bin unterwegs'],
    needsYou: ['kurz Zeit?', 'brauche eine Entscheidung', 'wartet auf dich'],

    phoneBye: ['danke, bis gleich', 'gut, so machen wir’s', 'ciao'],
    replyLaunch: ['bin dran!', 'alles klar, Chef', 'leg gleich los'],
    replySend: ['okay!', 'mach ich', 'verstanden', 'passt', 'bin dran'],
    newForYou: (what: string) => `neu für dich: ${what}`,

    whatNeed: (name: string) => `${name}, was brauchst du?`,
    askWaiting: ['wo hängt’s?', 'brauchst du eine Freigabe?'],
    replyWaiting: ['eine Rückfrage', 'kurz drüberschauen?', 'Freigabe bitte'],
    askFailed: ['was ist passiert?', 'zeig mal den Fehler', 'nochmal von vorne?'],
    replyFailed: ['Tests rot…', 'Build kaputt', 'ich fix das'],
    askRunning: ['sieht gut aus!', 'weiter so', 'wie weit bist du?', 'stark'],
    replyRunning: ['fast fertig', 'läuft!', 'danke!', 'noch ein bisschen'],

    quota: ['Kontingent passt', 'hm, die Limits…', 'Tokens reichen noch', 'Reset bald'],
    pinboard: ['was ist als Nächstes dran?', 'Backlog sortieren', 'das schieben wir', 'Review zuerst'],
    coffee: ['erstmal Kaffee', 'Koffein!', ''],
    phoneHello: ['ja, hallo?', 'Oskar hier', 'ah, gut dass du anrufst'],
    phoneListen: ['ja… ja…', 'verstehe', 'mhm'],
    phoneAgree: ['machen wir so', 'bis Freitag, klar', 'schick mir das'],
    phoneEnd: 'ciao!',
    windowRain: ['schon wieder Regen', 'Sauwetter'],
    windowFine: ['schöner Tag', 'hmm…'],
    dance: ['yeah!', 'was für ein Set', 'lauter!'],

    budgetLow: ['hm, die Limits…', 'wir müssen langsamer machen', 'das reicht nicht bis Freitag'],
    budgetCritical: ['fast nichts mehr übrig!', 'wer verheizt die ganzen Tokens?', 'nicht gut, gar nicht gut…', 'wann ist der Reset?!'],
    budgetOut: (provider: string) => `${provider} ist aufgebraucht!`,
    budgetBack: 'puh, Kontingent ist zurück',
  },
});

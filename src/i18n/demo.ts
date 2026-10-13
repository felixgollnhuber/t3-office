/** Texts of the demo data: made-up task titles, tool calls and sample bubbles. Agent and team names are the same in every language. */
import { locale } from './index';

export const S = locale({
  en: {
    titles: ['Fix login flow', 'Add dark mode', 'Build iOS widget', 'Fix CI', 'Dashboard prototype', 'Terraform upgrade', 'Clean up tests', 'Onboarding copy', 'Push notifications', 'DB migration'],
    toolsWeb: ['read docs', 'web search', 'fetch API'],
    toolsTest: ['tests green', 'vitest', 'pytest'],
    subagentOf: (name: string) => `${name}’s subagent`,

    // made-up conversation for the thread reader
    ask: (title: string) => `Can you take this one? ${title}.`,
    opener: ['On it. I’ll read the code first.', 'Sure, let me check how this works today.', 'Okay, starting with the part that fails.'],
    progress: ['Found the spot. Changing it now.', 'That explains it. One more check.', 'Halfway there, tests are next.', 'Cleaning up after myself.'],
    question: ['Ready to push. Okay with you?', 'This touches the schema. Go ahead?'],
    reply: ['Yes, go ahead.', 'Looks good, do it.'],
    done: (title: string) => `Done: ${title}. Everything is green.`,
    crashed: 'Build failed with exit code 1',
    retry: 'Trying a different approach.',

    // static sample roster
    bossBubble: 'delegating 3 tasks',
    askPush: 'ok to push?',
    coffee: 'coffee…',
    brb: 'back in a sec',
    buildBroken: 'build’s broken :(',
    didYouHear: 'did you hear…',
    waitingOnYou: 'waiting on you',
  },
  de: {
    titles: ['Login-Flow fixen', 'Dark Mode einbauen', 'iOS Widget bauen', 'CI reparieren', 'Dashboard Prototyp', 'Terraform Upgrade', 'Tests aufräumen', 'Onboarding Copy', 'Push Notifications', 'DB Migration'],
    toolsWeb: ['Docs lesen', 'Websuche', 'fetch API'],
    toolsTest: ['Tests grün', 'vitest', 'pytest'],
    subagentOf: (name: string) => `Subagent von ${name}`,

    ask: (title: string) => `Kannst du das übernehmen? ${title}.`,
    opener: ['Bin dran. Ich lese zuerst den Code.', 'Klar, ich schaue mir an, wie das heute läuft.', 'Okay, ich fange bei der Stelle an, die fehlschlägt.'],
    progress: ['Stelle gefunden. Ich ändere sie jetzt.', 'Das erklärt es. Noch eine Prüfung.', 'Halbzeit, als Nächstes die Tests.', 'Ich räume hinter mir auf.'],
    question: ['Bereit zum Pushen. Passt das für dich?', 'Das fasst das Schema an. Soll ich?'],
    reply: ['Ja, mach.', 'Sieht gut aus, los.'],
    done: (title: string) => `Fertig: ${title}. Alles grün.`,
    crashed: 'Build fehlgeschlagen mit Exit-Code 1',
    retry: 'Ich versuche einen anderen Weg.',

    bossBubble: 'delegiert 3 Tasks',
    askPush: 'darf ich pushen?',
    coffee: 'Kaffee…',
    brb: 'kurz weg',
    buildBroken: 'Build kaputt :(',
    didYouHear: 'hast du gehört…',
    waitingOnYou: 'wartet auf dich',
  },
});

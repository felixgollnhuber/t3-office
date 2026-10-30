/** A short, optional walk through the real office controls. No account or data is fabricated here. */
import { travelToFloor } from './elevator';
import { api, type Floor } from './building-api';
import { locale } from './i18n';
import './tour.css';
const KEY = 'office.guided-tour.v1';
const T = locale({
  en: { label: 'Your first visit', skip: 'Skip tour', restart: 'Take a tour', next: 'Continue', done: 'Make yourself at home', loading: 'Opening…', unavailable: 'That floor is no longer available. You can still explore your office.',
    titles: ['An office of your own', 'Good company, upstairs', 'A visit by invitation', 'Build together', 'Small wins deserve a moment', 'Your work stays yours'],
    text: ['Your AI coworkers live here. Click a character to rename and style it. Your original office is always home.', 'The building contains only your floor and offices shared with you. Select a friend’s floor to look closer.', 'Enter a friend’s office without seeing their prompts, files, transcripts or costs. Every visit requires their permission.', 'Join a 25- or 50-minute focus session. Joining shares your chosen name with the host and other participants; quiet mode keeps it low-key.', 'Preview a milestone before publishing it to your activity guests. Export only the approved card, never a screenshot of private work.', 'Return home, invite someone you trust, and choose what to share. Nothing in this tour starts activity publishing.'],
    actions: ['Show me the building', 'Focus a friend’s floor', 'Visit this office', 'Try a focus session', 'Preview a milestone', 'Finish tour'], noFriends: 'There are no invited floors yet. Open Friends to create or accept an invitation. The two-office demo includes a simulated friend.', invite: 'Open Friends', back: 'Back', simulation: 'SIMULATION · guided first visit', progress: (n: number) => `Step ${n} of 6`,
  },
  de: { label: 'Dein erster Besuch', skip: 'Tour überspringen', restart: 'Tour starten', next: 'Weiter', done: 'Fühl dich wie zu Hause', loading: 'Wird geöffnet…', unavailable: 'Diese Etage ist nicht mehr verfügbar. Dein Büro bleibt zugänglich.',
    titles: ['Ein eigenes Büro', 'Gute Gesellschaft nebenan', 'Ein Besuch auf Einladung', 'Gemeinsam arbeiten', 'Kleine Erfolge teilen', 'Deine Arbeit bleibt deine'],
    text: ['Hier leben deine KI-Kollegen. Klicke eine Figur an, um Namen und Aussehen zu ändern. Dein ursprüngliches Büro bleibt dein Zuhause.', 'Das Gebäude zeigt nur deine Etage und mit dir geteilte Büros. Wähle eine Etage, um näher hinzusehen.', 'Besuche Freunde, ohne ihre Prompts, Dateien, Gespräche oder Kosten zu sehen. Jeder Besuch braucht eine Erlaubnis.', 'Tritt einer 25- oder 50-Minuten-Fokusrunde bei. Dabei sehen Gastgeber und Teilnehmer deinen gewählten Namen. Der Ruhemodus hält es entspannt.', 'Prüfe einen Meilenstein, bevor du ihn mit Aktivitätsgästen teilst. Exportiere nur die freigegebene Karte, niemals private Arbeit.', 'Kehre heim, lade vertraute Menschen ein und entscheide, was du teilst. Diese Tour startet keine Aktivitätsfreigabe.'],
    actions: ['Zeig mir das Gebäude', 'Etage eines Freundes wählen', 'Dieses Büro besuchen', 'Fokusrunde ausprobieren', 'Meilenstein ansehen', 'Tour beenden'], noFriends: 'Noch keine eingeladenen Etagen. Öffne Freunde, um eine Einladung zu erstellen oder anzunehmen. Die Demo enthält einen simulierten Freund.', invite: 'Freunde öffnen', back: 'Zurück', simulation: 'SIMULATION · erste Führung', progress: (n: number) => `Schritt ${n} von 6`,
  },
});
type Ticket = { step: number; at: number; floor?: string };
export function installOfficeTour() {
  let ticket: Ticket | null = null; let busy = false; let generation = 0; let message = ''; 
  const card = document.createElement('section'); card.className = 'office-tour'; card.setAttribute('aria-label', T.label); card.hidden = true;
  document.body.append(card);
  const save = () => { if (ticket) sessionStorage.setItem(KEY, JSON.stringify(ticket)); else sessionStorage.removeItem(KEY); };
  const stop = () => { generation++; ticket = null; save(); card.hidden = true; const u = new URL(location.href); u.searchParams.delete('tour'); history.replaceState(null, '', u); };
  const paint = () => {
    if (!ticket) { card.hidden = true; return; }
    const container = document.querySelector('.building-world') ?? document.body; if (card.parentElement !== container) container.append(card);
    const s = ticket.step; card.hidden = false; card.dataset.step = String(s);
    card.replaceChildren();
    const header = document.createElement('header'); const eyebrow = document.createElement('small'); eyebrow.textContent = document.getElementById('friend-preview-banner') ? T.simulation : T.label;
    const skip = document.createElement('button'); skip.textContent = T.skip; skip.dataset.tourAction = 'skip'; header.append(eyebrow, skip);
    const progress = document.createElement('p'); progress.className = 'tour-progress'; progress.textContent = T.progress(s + 1);
    const title = document.createElement('h2'); title.textContent = T.titles[s];
    const text = document.createElement('p'); text.textContent = message || T.text[s]; text.setAttribute('role', 'status');
    const actions = document.createElement('footer'); const next = document.createElement('button'); next.dataset.tourAction = 'next'; next.textContent = busy ? T.loading : T.actions[s]; next.disabled = busy;
    if (s > 0) { const back = document.createElement('button'); back.dataset.tourAction = 'back'; back.textContent = T.back; back.disabled = busy; actions.append(back); }
    actions.append(next); card.append(header, progress, title, text, actions);
  };
  const setStep = (step: number) => { if (!ticket) return; ticket.step = step; ticket.at = Date.now(); save(); paint(); };
  const start = () => { generation++; busy = false; message = ''; ticket = { step: 0, at: Date.now() }; save(); paint(); card.querySelector<HTMLButtonElement>('[data-tour-action=next]')?.focus(); };
  // Allow the actual scene to finish its asynchronous directory request without an unbounded poll.
  const waitFor = (selector: string) => new Promise<HTMLElement>((resolve, reject) => {
    const immediate = document.querySelector<HTMLElement>(selector); if (immediate) return resolve(immediate);
    const observer = new MutationObserver(() => { const el = document.querySelector<HTMLElement>(selector); if (el) { observer.disconnect(); clearTimeout(timer); resolve(el); } });
    const timer = setTimeout(() => { observer.disconnect(); reject(new Error(T.unavailable)); }, 7500);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true });
  });
  card.addEventListener('click', event => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-tour-action]'); if (!button) return;
    if (button.dataset.tourAction === 'skip') return stop();
    if (!ticket || busy) return;
    if (button.dataset.tourAction === 'back') return setStep(Math.max(0, ticket.step - 1));
    const epoch = generation; const step = ticket.step; message = '';
    busy = true; paint();
    void (async () => {
      if (step === 0) { document.querySelector<HTMLButtonElement>('.office-building-launcher')?.click(); await waitFor('.building-world[data-rendered=true]'); if (epoch === generation) setStep(1); }
      else if (step === 1) {
        let friend: Floor | undefined;
        try { friend = (await api<{ floors: Floor[] }>('/floors')).floors.find(f => !f.isOwner); } catch { /* Optional accounts: guide to invitations. */ }
        if (epoch !== generation || !ticket) return;
        if (!friend) { message = T.noFriends; window.dispatchEvent(new Event('office-building-close')); window.dispatchEvent(new Event('office-social-account')); setStep(5); return; }
        ticket.floor = friend.id;
        const floor = await waitFor(`.building-world [data-floor="${CSS.escape(friend.id)}"]`);
        if (epoch !== generation) return; floor.click(); setStep(2);
      } else if (step === 2) {
        if (!document.querySelector('.building-world')) document.querySelector<HTMLButtonElement>('.office-building-launcher')?.click();
        await waitFor('.building-world[data-rendered=true]');
        if (ticket?.floor) { const floor = await waitFor(`.building-world [data-floor="${CSS.escape(ticket.floor)}"]`); floor.click(); }
        const enter = await waitFor('.building-world-enter');
        if (epoch !== generation || !ticket) return;
        // Save before navigation: the next page resumes only this short-lived tour, never publishes data.
        ticket.step = 3; ticket.at = Date.now(); save(); enter.click();
      } else if (step === 3 || step === 4) {
        window.dispatchEvent(new Event('office-building-close'));
        window.dispatchEvent(new CustomEvent('office-open-social', { detail: { tab: step === 3 ? 'focus' : 'moments' } })); setStep(step + 1);
      } else { stop(); if (new URLSearchParams(location.search).get('source') === 'shared') void travelToFloor(null); }
    })().catch(() => { if (epoch === generation) { message = T.unavailable; paint(); } }).finally(() => { busy = false; if (epoch === generation && ticket) paint(); });
  });
  for (const kind of ['pointerdown','pointerup','wheel','dblclick'] as const) card.addEventListener(kind, event => event.stopPropagation());
  card.addEventListener('keydown', event => { if (event.key !== 'Tab' && event.key !== 'Escape') event.stopPropagation(); });
  window.addEventListener('office-start-tour', start);
  window.addEventListener('pagehide', () => { generation++; card.remove(); });
  const resume = async () => {
    const epoch = generation;
    const transitions = document.body.getAnimations();
    if (!matchMedia('(prefers-reduced-motion: reduce)').matches && transitions.length) await Promise.race([Promise.allSettled(transitions.map(a => a.finished)), new Promise(resolve => setTimeout(resolve, 3000))]);
    if (epoch !== generation || !card.isConnected) return;
    try { const value = JSON.parse(sessionStorage.getItem(KEY) ?? 'null'); if (value && Number.isInteger(value.step) && value.step >= 0 && value.step < 6 && Date.now() - value.at < 10 * 60_000 && Date.now() >= value.at) ticket = value; } catch { sessionStorage.removeItem(KEY); }
    if (new URLSearchParams(location.search).get('tour') === '1' && !ticket) start(); else paint();
  };
  if ((window as unknown as { __ready?: boolean }).__ready) resume(); else window.addEventListener('office-ready', resume, { once: true });
  return { start, stop };
}

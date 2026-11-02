/** Optional, consent-based social rituals. No renderer capture or private work data. */
import { api, ApiError, type Session } from './building-api';
import { getSocial, startFocus, joinFocus, leaveFocus, endFocus, publishMoment, deleteMoment, type SocialState, type Moment, type MomentKind } from './social-api';
import { locale, localeTag } from './i18n';
import './social.css';

const T = locale({
  en: {
    title: 'Build together', close: 'Close', focus: 'Focus sessions', moments: 'We shipped', loading: 'Checking your building…',
    intro: 'A little company, without sharing your work. Sessions and moments are separate from agent activity: end a session or delete a moment to remove it.', start: 'Start a focus session', minutes: 'Session length', short: '25 minutes', long: '50 minutes', quiet: 'Quiet mode · no check-ins',
    focusConsent: 'Starting or joining shares your display name and quiet preference with the host and other joined friends. Only invited friends can join. Your agents, prompts and files stay private.',
    focusEmpty: 'No focus sessions yet. Start one and invite a friend from Friends & characters.', active: 'In your building', ring:'Ring doorbell', dnd:'Do Not Disturb', join: 'Join session', leave: 'Leave session', end: 'End session', joined: 'You joined', hosting: 'Your session', people: 'people', ends: 'remaining', finished: 'Finished · refreshing…', quietBadge: 'Quiet', present: 'Here to build',
    startHint: 'Start small. Pick a timer, settle into your own office, and build alongside friends.', participantHint: 'Participant names appear after you join.',
    momentsIntro: 'Celebrate something you choose to share. Nothing is published automatically.', newMoment: 'Create a moment', titleLabel: 'What would you like to celebrate?', titlePlaceholder: 'We shipped our first playable office', kind: 'Moment', shipped: 'Shipped', milestone: 'Milestone', helped: 'Helped a friend',
    preview: 'Preview moment', publish: 'Publish to activity guests', edit: 'Keep editing', previewTitle: 'Ready to share?', consent: 'This title, your display name, office name, kind and date will be visible to friends with activity access. Presence-only guests cannot see it. Check that the text contains no private details.',
    manual: 'Owner-published · not automatically verified', momentsEmpty: 'Your building’s next milestone starts here.', export: 'Preview share card', remove: 'Delete moment', exportTitle: 'Your share card', exportHint: 'Only this title, kind, display name and date go into the PNG. Downloading does not publish it anywhere.', download: 'Download PNG', cancel: 'Cancel',
    signIn: 'Friends make a building.', accountHint: 'Your office works without an account. To start shared sessions or publish moments, use your optional office account.', account: 'Open Friends & characters', unavailable: 'Connection unavailable. Shared content has been cleared. Try again.', retry: 'Try again', refreshed: 'Up to date', changed: 'Your account changed. Shared content was cleared.', published: 'A moment worth celebrating.', deleted: 'Moment removed.', saved: 'Done.', error: 'That action could not finish. Try again.', member: 'In session', backOffice: 'Back to office', activeHint:'Your timer keeps running while you work in your office. Reopen it from the small timer badge.',
  },
  de: {
    title: 'Gemeinsam bauen', close: 'Schließen', focus: 'Fokus-Sitzungen', moments: 'Geschafft', loading: 'Dein Gebäude wird geprüft…',
    intro: 'Ein wenig Gesellschaft, ohne deine Arbeit zu teilen. Sitzungen und Momente sind unabhängig von der Agentenaktivität: Beende eine Sitzung oder lösche einen Moment, um sie zu entfernen.', start: 'Fokus-Sitzung starten', minutes: 'Sitzungsdauer', short: '25 Minuten', long: '50 Minuten', quiet: 'Ruhemodus · keine Check-ins',
    focusConsent: 'Beim Starten oder Beitreten werden dein Anzeigename und Ruhemodus mit Gastgeber und beigetretenen Freunden geteilt. Nur eingeladene Freunde können beitreten. Agenten, Prompts und Dateien bleiben privat.',
    focusEmpty: 'Noch keine Fokus-Sitzung. Starte eine und lade über Freunde & Charaktere jemanden ein.', active: 'In deinem Gebäude', ring:'Klingeln',dnd:'Nicht stören', join: 'Sitzung beitreten', leave: 'Sitzung verlassen', end: 'Sitzung beenden', joined: 'Du bist dabei', hosting: 'Deine Sitzung', people: 'Personen', ends: 'verbleibend', finished: 'Beendet · wird aktualisiert…', quietBadge: 'Ruhe', present: 'Bereit zum Bauen',
    startHint: 'Klein anfangen: Timer wählen, ins eigene Büro setzen und mit Freunden bauen.', participantHint: 'Teilnehmernamen erscheinen nach deinem Beitritt.',
    momentsIntro: 'Feiere etwas, das du bewusst teilen möchtest. Nichts wird automatisch veröffentlicht.', newMoment: 'Moment erstellen', titleLabel: 'Was möchtest du feiern?', titlePlaceholder: 'Unser erstes spielbares Büro ist fertig', kind: 'Moment', shipped: 'Veröffentlicht', milestone: 'Meilenstein', helped: 'Freund geholfen',
    preview: 'Moment-Vorschau', publish: 'Für Aktivitätsgäste veröffentlichen', edit: 'Weiter bearbeiten', previewTitle: 'Bereit zum Teilen?', consent: 'Dieser Titel, dein Anzeigename, Büroname, Art und Datum werden für Freunde mit Aktivitätszugriff sichtbar. Anwesenheitsgäste sehen dies nicht. Prüfe, dass der Text keine privaten Details enthält.',
    manual: 'Vom Besitzer veröffentlicht · nicht automatisch geprüft', momentsEmpty: 'Hier beginnt der nächste Meilenstein deines Gebäudes.', export: 'Karten-Vorschau', remove: 'Moment löschen', exportTitle: 'Deine Karte', exportHint: 'Nur Titel, Art, Anzeigename und Datum kommen ins PNG. Der Download veröffentlicht nichts.', download: 'PNG herunterladen', cancel: 'Abbrechen',
    signIn: 'Freunde machen ein Gebäude aus.', accountHint: 'Dein Büro funktioniert ohne Konto. Für gemeinsame Sitzungen oder Momente nutze dein optionales Bürokonto.', account: 'Freunde & Charaktere öffnen', unavailable: 'Verbindung nicht verfügbar. Geteilte Inhalte wurden entfernt. Versuche es erneut.', retry: 'Erneut versuchen', refreshed: 'Aktuell', changed: 'Dein Konto hat sich geändert. Geteilte Inhalte wurden entfernt.', published: 'Ein Moment zum Feiern.', deleted: 'Moment entfernt.', saved: 'Fertig.', error: 'Die Aktion konnte nicht abgeschlossen werden. Versuche es erneut.', member: 'In Sitzung', backOffice:'Zurück zum Büro', activeHint:'Dein Timer läuft im Büro weiter. Öffne die Sitzung über die kleine Timer-Anzeige.',
  },
});
const FOCUS_HINT = 'office.focus-active.v1';
const esc = (value: string) => value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const kinds: Record<MomentKind, string> = { shipped: T.shipped, milestone: T.milestone, helped: T.helped };
const kindKnown = (value: unknown): value is MomentKind => value === 'shipped' || value === 'milestone' || value === 'helped';
const when = (time: number) => new Date(time).toLocaleDateString(localeTag, { month: 'short', day: 'numeric', year: 'numeric' });

/** Only explicitly published fields are drawn; never the scene, DOM or office HUD. */
export function createMomentCard(moment: Pick<Moment, 'title' | 'kind' | 'ownerName' | 'createdAt'>): HTMLCanvasElement {
  const canvas = document.createElement('canvas'); canvas.width = 1200; canvas.height = 630;
  const ctx = canvas.getContext('2d'); if (!ctx) throw new Error(T.error);
  ctx.fillStyle = '#f4f0dc'; ctx.fillRect(0, 0, 1200, 630);
  ctx.strokeStyle = '#243d37'; ctx.lineWidth = 12; ctx.strokeRect(20, 20, 1160, 590);
  ctx.fillStyle = '#243d37'; ctx.fillRect(60, 60, 1080, 78);
  ctx.fillStyle = '#f4f0dc'; ctx.font = 'bold 28px monospace'; ctx.fillText('T3 OFFICE · ' + kinds[moment.kind], 84, 110);
  ctx.fillStyle = '#243d37'; ctx.font = 'bold 52px monospace';
  const wrapped = (text: string, x: number, y: number, width: number, lineHeight: number, maxLines: number) => {
    let line = '', row = 0;
    const flush = () => { ctx.fillText(line, x, y + row * lineHeight); line = ''; row++; };
    for (const word of text.split(/\s+/)) {
      const candidate = line ? `${line} ${word}` : word;
      if (line && ctx.measureText(candidate).width > width) flush();
      if (row >= maxLines) return;
      if (ctx.measureText(word).width <= width) line = line ? `${line} ${word}` : word;
      else for (const char of word) {
        if (line && ctx.measureText(line + char).width > width) flush();
        if (row >= maxLines) return;
        line += char;
      }
    }
    if (line && row < maxLines) ctx.fillText(line, x, y + row * lineHeight);
  };
  wrapped(moment.title, 70, 230, 1050, 68, 3);
  ctx.font = '24px monospace'; wrapped(moment.ownerName, 70, 490, 1050, 30, 2);
  ctx.font = '21px monospace'; ctx.fillText(when(moment.createdAt), 70, 565);
  return canvas;
}

export function installSocialOffice(): { open(tab?: 'focus' | 'moments'): void } {
  const existing = document.querySelector<HTMLDialogElement>('.social-office');
  if (existing) return { open: (tab = 'focus') => { existing.dispatchEvent(new CustomEvent('social-open', { detail: tab })); } };
  const dialog = document.createElement('dialog'); dialog.className = 'social-office'; dialog.setAttribute('aria-labelledby', 'social-office-title');
  dialog.innerHTML = `<header><div><small>T3 OFFICE</small><h1 id="social-office-title">${T.title}</h1><p>${T.intro}</p></div><button type="button" data-social="close" aria-label="${T.close}">×</button></header><nav aria-label="${T.title}"><button type="button" data-tab="focus">${T.focus}</button><button type="button" data-tab="moments">${T.moments}</button></nav><p class="social-notice" role="status" aria-live="polite"></p><main class="social-content"></main>`;
  document.body.append(dialog);
  const badge = document.createElement('button'); badge.className = 'social-focus-badge'; badge.type = 'button'; badge.hidden = true; document.body.append(badge);
  const checkin = document.createElement('aside'); checkin.className = 'social-checkin'; checkin.hidden = true; checkin.setAttribute('role', 'status');
  const checkinText = document.createElement('p'); checkinText.textContent = locale({en:'Halfway there. Take a breath, or keep building at your own pace.',de:'Halbzeit. Atme kurz durch oder arbeite in deinem Tempo weiter.'});
  const dismissCheckin = document.createElement('button'); dismissCheckin.textContent = locale({en:'Keep going',de:'Weiter geht’s'}); checkin.append(checkinText, dismissCheckin); document.body.append(checkin);
  const reminded = new Set<string>();
  let restoring = false;
  const content = dialog.querySelector<HTMLElement>('.social-content')!;
  const notice = dialog.querySelector<HTMLElement>('.social-notice')!;
  let tab: 'focus' | 'moments' = 'focus', generation = 0, current: Session | null = null, state: SocialState | null = null;
  let polling: ReturnType<typeof setInterval> | undefined, timer: ReturnType<typeof setInterval> | undefined, celebration: ReturnType<typeof setTimeout> | undefined;
  let refreshing = false, pending = false, serverOffset = 0, priorFocus: HTMLElement | null = null;
  let activeFocus: { id: string; userId: string; startedAt: number; endsAt: number; quiet: boolean } | null = null;
  let draft: { title: string; kind: MomentKind } | null = null, exporting: string | null = null;
  const say = (text: string, error = false) => { notice.textContent = text; notice.dataset.error = String(error); };
  function clear() { current = null; state = null; draft = null; exporting = null; content.replaceChildren(); }
  const markPending = (value: boolean) => { pending = value; dialog.dataset.pending = String(value); dialog.querySelectorAll<HTMLButtonElement>('.social-content button, [data-tab]').forEach(b => b.disabled = value); };
  function stopIdleTimers() { if (!dialog.open && !activeFocus) { clearInterval(polling); clearInterval(timer); polling = undefined; timer = undefined; } }
  function updateBadge() {
    const joined = state?.sessions.find(s => s.joined || s.isHost);
    activeFocus = joined && current ? { id: joined.id, userId: current.user.id, startedAt: joined.startedAt, endsAt: joined.endsAt, quiet: joined.participants.find(p => p.userId === current!.user.id)?.quiet ?? true } : null;
    badge.hidden = !activeFocus;
    if (activeFocus) sessionStorage.setItem(FOCUS_HINT, '1'); else { sessionStorage.removeItem(FOCUS_HINT); checkin.hidden = true; }
    ticks(); stopIdleTimers();
  }
  function ticks() {
    if (activeFocus) {
      const seconds = Math.max(0, Math.ceil((activeFocus.endsAt - (Date.now() + serverOffset)) / 1000));
      if (!seconds) { activeFocus = null; badge.hidden = true; checkin.hidden = true; sessionStorage.removeItem(FOCUS_HINT); stopIdleTimers(); }
      else if (!activeFocus.quiet && !reminded.has(activeFocus.id) && Date.now() + serverOffset >= (activeFocus.startedAt + activeFocus.endsAt) / 2) { reminded.add(activeFocus.id); checkin.hidden = false; }
      if (activeFocus) badge.textContent = `${T.focus} · ${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}${activeFocus.quiet ? ` · ${T.quietBadge}` : ''}`;
    }
    for (const el of dialog.querySelectorAll<HTMLElement>('[data-ends]')) {
      const seconds = Math.max(0, Math.ceil((Number(el.dataset.ends) - (Date.now() + serverOffset)) / 1000));
      el.textContent = seconds ? `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}` : T.finished;
    }
  }
  function authPrompt() { content.innerHTML = `<section class="social-empty"><span aria-hidden="true">⌂</span><h2>${T.signIn}</h2><p>${T.accountHint}</p><button type="button" data-social="account">${T.account}</button></section>`; }
  function renderShell() {
    dialog.querySelectorAll<HTMLElement>('[data-tab]').forEach(b => { const selected = b.dataset.tab === tab; b.setAttribute('aria-pressed', String(selected)); });
    if (!current) return;
    if (tab === 'focus') {
      content.innerHTML = `<section class="social-start"><h2>${T.start}</h2><p class="social-start-hint">${T.startHint}</p><button type="button" data-social="minimize" hidden>${T.backOffice}</button><form class="social-focus-form"><label>${T.minutes}<select name="minutes"><option value="25">${T.short}</option><option value="50">${T.long}</option></select></label><label class="social-check"><input name="quiet" type="checkbox" checked>${T.quiet}</label><p class="social-consent">${T.focusConsent}</p><button type="submit">${T.start}</button></form></section><section><h2>${T.active}</h2><div class="social-sessions"></div></section>`;
    } else {
      content.innerHTML = `<section><h2>${T.newMoment}</h2><p>${T.momentsIntro}</p><form class="social-moment-form"><label>${T.titleLabel}<input name="title" required maxlength="80" autocomplete="off" placeholder="${T.titlePlaceholder}"></label><label>${T.kind}<select name="kind">${Object.entries(kinds).map(([key, label]) => `<option value="${key}">${label}</option>`).join('')}</select></label><button type="submit">${T.preview}</button></form><div class="social-preview"></div><div class="social-export"></div></section><section><h2>${T.moments}</h2><div class="social-moments"></div></section>`;
    }
    renderLists();
  }
  function renderLists() {
    if (!current || !state) return;
    const active = state.sessions.find(s => s.joined || s.isHost);
    const startSection = dialog.querySelector('.social-start');
    if (startSection) { startSection.querySelector<HTMLFormElement>('form')!.hidden = !!active; startSection.querySelector('h2')!.textContent = active ? (active.isHost ? T.hosting : T.joined) : T.start; startSection.querySelector('.social-start-hint')!.textContent = active ? T.activeHint : T.startHint; startSection.querySelector<HTMLButtonElement>('[data-social=minimize]')!.hidden = !active; }
    const sessions = dialog.querySelector('.social-sessions');
    if (sessions && sessions.getAttribute('data-state') !== JSON.stringify(state.sessions)) {
      const quiet = new Map([...sessions.querySelectorAll<HTMLInputElement>('[data-join-quiet]')].map(el => [el.dataset.joinQuiet, el.checked]));
      sessions.setAttribute('data-state', JSON.stringify(state.sessions));
      sessions.innerHTML = state.sessions.map(s => `<article class="social-session" data-session="${esc(s.id)}"><div class="social-card-heading"><div><small>${s.isHost ? T.hosting : s.joined ? T.joined : esc(s.hostName)}</small><h3>${esc(s.officeName)}</h3></div><div class="social-countdown"><b data-ends="${s.endsAt}" aria-label="${T.ends}"></b><small>${T.ends}</small></div></div><p>${s.participantCount} ${T.people}${s.joined ? ` · ${T.member}` : ''}</p>${s.joined || s.isHost ? `<ul>${s.participants.map(p => `<li>${esc(p.name)} <span class="social-badge">${p.quiet ? T.quietBadge : T.present}</span></li>`).join('')}</ul>` : `<p class="social-hint">${T.participantHint}</p>`}<div class="social-actions">${s.isHost ? `<button type="button" data-end="${esc(s.id)}">${T.end}</button>` : s.joined ? `<button type="button" data-leave="${esc(s.id)}">${T.leave}</button>` : s.doorbell==='dnd'?`<p>${T.dnd}</p>`:s.doorbell==='approval'?`<button type="button" data-ring="${esc(s.id)}">${T.ring}</button>`:`<label class="social-check"><input data-join-quiet="${esc(s.id)}" type="checkbox" checked>${T.quiet}</label><button type="button" data-join="${esc(s.id)}">${T.join}</button>`}</div></article>`).join('') || `<p class="social-empty-note">${T.focusEmpty}</p>`;
      sessions.querySelectorAll<HTMLInputElement>('[data-join-quiet]').forEach(el => { if (quiet.has(el.dataset.joinQuiet)) el.checked = quiet.get(el.dataset.joinQuiet)!; });
    }
    const moments = dialog.querySelector('.social-moments');
    if (moments && moments.getAttribute('data-state') !== JSON.stringify(state.moments)) { moments.setAttribute('data-state', JSON.stringify(state.moments)); moments.innerHTML = state.moments.map(m => `<article class="social-moment" data-moment="${esc(m.id)}"><div class="social-card-heading"><span class="social-badge">${kinds[m.kind]}</span><time datetime="${new Date(m.createdAt).toISOString()}">${esc(when(m.createdAt))}</time></div><h3>${esc(m.title)}</h3><p>${esc(m.ownerName)} · ${esc(m.officeName)}</p><small>${T.manual}</small>${m.isOwner ? `<div class="social-actions"><button type="button" data-export="${esc(m.id)}">${T.export}</button><button type="button" data-delete-moment="${esc(m.id)}">${T.remove}</button></div>` : ''}</article>`).join('') || `<p class="social-empty-note">${T.momentsEmpty}</p>`; }
    if (exporting && !state.moments.some(m => m.id === exporting && m.isOwner)) { exporting = null; dialog.querySelector('.social-export')?.replaceChildren(); }
    markPending(pending); ticks();
  }
  async function refresh() {
    if ((!dialog.open && !activeFocus && !restoring) || refreshing || pending) return;
    refreshing = true; const epoch = generation;
    try {
      const before = await api<Session>('/session');
      const result = await getSocial();
      const after = await api<Session>('/session');
      if (epoch !== generation || (!dialog.open && !activeFocus && !restoring)) return;
      if (before.user.id !== after.user.id || result.viewerId !== after.user.id || (activeFocus && activeFocus.userId !== after.user.id)) { clear(); activeFocus = null; badge.hidden = true; checkin.hidden = true; sessionStorage.removeItem(FOCUS_HINT); stopIdleTimers(); say(T.changed, true); return; }
      const changed = current?.user.id !== after.user.id;
      if (changed) clear();
      current = after; state = result; serverOffset = result.serverNow - Date.now();
      updateBadge();
      if (dialog.open) { if (changed || !content.querySelector('section')) renderShell(); else renderLists(); }
      if (!notice.dataset.error || notice.textContent === T.loading || notice.textContent === T.unavailable) say(T.refreshed);
    } catch (error) {
      if (epoch !== generation) return;
      clear(); activeFocus = null; badge.hidden = true; checkin.hidden = true; sessionStorage.removeItem(FOCUS_HINT); stopIdleTimers();
      if (!dialog.open) return;
      if (error instanceof ApiError && error.status === 401) { say(''); authPrompt(); }
      else { say(T.unavailable, true); content.innerHTML = `<button type="button" data-social="retry">${T.retry}</button>`; }
    } finally { refreshing = false; }
  }
  async function mutate(action: (userId: string) => Promise<unknown>, done = T.saved, celebrate = false) {
    if (pending || !current) return;
    const epoch = generation, userId = current.user.id; markPending(true);
    try {
      const before = await api<Session>('/session');
      if (epoch !== generation || !dialog.open || before.user.id !== userId) { if (dialog.open && epoch === generation) { clear(); say(T.changed, true); } return; }
      const result = await action(userId);
      const after = await api<Session>('/session');
      if (epoch !== generation || !dialog.open) return;
      if (after.user.id !== userId) { clear(); say(T.changed, true); return; }
      say(done);
      if (celebrate) {
        draft = null; dialog.querySelector('.social-preview')?.replaceChildren(); dialog.querySelector<HTMLFormElement>('.social-moment-form')?.reset();
        dialog.classList.add('social-celebrate'); clearTimeout(celebration); celebration = setTimeout(() => dialog.classList.remove('social-celebrate'), 1800);
        window.dispatchEvent(new CustomEvent('office-moment-published', { detail: { moment: result } }));
      }
    } catch (error) { if (epoch === generation && dialog.open) { clear(); activeFocus = null; badge.hidden = true; checkin.hidden = true; sessionStorage.removeItem(FOCUS_HINT); say(error instanceof Error ? error.message : T.error, true); content.innerHTML = `<button type="button" data-social="retry">${T.retry}</button>`; } }
    finally { if (epoch === generation) { markPending(false); void refresh(); } }
  }
  function previewMoment(title: string, kind: MomentKind) {
    if (!current) return;
    draft = { title, kind };
    const box = dialog.querySelector<HTMLElement>('.social-preview')!;
    box.innerHTML = `<section class="social-publication-preview" aria-label="${T.preview}"><h3>${T.previewTitle}</h3><span class="social-badge">${kinds[kind]}</span><h3>${esc(title)}</h3><p>${esc(current.user.name)} · ${esc(current.office.name)}</p><small>${T.manual}</small><p class="social-consent">${T.consent}</p><div class="social-actions"><button type="button" data-social="publish">${T.publish}</button><button type="button" data-social="edit">${T.edit}</button></div></section>`;
    box.querySelector<HTMLButtonElement>('button')?.focus();
  }
  function previewExport(moment: Moment) {
    if (!moment.isOwner) return;
    exporting = moment.id;
    const box = dialog.querySelector<HTMLElement>('.social-export')!;
    box.innerHTML = `<section aria-label="${T.exportTitle}"><h3>${T.exportTitle}</h3><p>${T.exportHint}</p><div class="social-card-preview"></div><div class="social-actions"><button type="button" data-social="download">${T.download}</button><button type="button" data-social="cancel-export">${T.cancel}</button></div></section>`;
    const canvas = createMomentCard(moment); canvas.setAttribute('aria-label', `${kinds[moment.kind]}: ${moment.title} · ${moment.ownerName} · ${when(moment.createdAt)}`); canvas.setAttribute('role', 'img');
    box.querySelector('.social-card-preview')!.append(canvas); box.querySelector<HTMLButtonElement>('button')?.focus();
  }
  async function downloadCard() {
    if (!exporting || !current || pending) return;
    const epoch = generation, userId = current.user.id, id = exporting; markPending(true);
    try {
      const before = await api<Session>('/session'), social = await getSocial(), after = await api<Session>('/session');
      if (epoch !== generation || !dialog.open) return;
      if (before.user.id !== userId || after.user.id !== userId || social.viewerId !== userId) { clear(); say(T.changed, true); return; }
      const moment = social.moments.find(m => m.id === id && m.isOwner); if (!moment) throw new Error(T.unavailable);
      const blob = await new Promise<Blob>((resolve, reject) => createMomentCard(moment).toBlob(b => b ? resolve(b) : reject(new Error(T.error)), 'image/png'));
      if (epoch !== generation || !dialog.open) return;
      const url = URL.createObjectURL(blob), link = document.createElement('a'); link.href = url; link.download = 't3-office-moment.png'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) { if (epoch === generation) say(error instanceof Error ? error.message : T.error, true); }
    finally { if (epoch === generation) markPending(false); }
  }
  dialog.addEventListener('submit', event => {
    event.preventDefault(); if (pending) return;
    const form = event.target as HTMLFormElement, data = new FormData(form);
    if (form.matches('.social-focus-form')) { const minutes = Number(data.get('minutes')); if (minutes === 25 || minutes === 50) void mutate(actor => startFocus(minutes, data.has('quiet'), actor)); }
    else if (form.matches('.social-moment-form')) {
      const title = String(data.get('title') ?? '').trim(), kind = data.get('kind');
      if (title && title.length <= 80 && !/[\u0000-\u001f\u007f]/.test(title) && kindKnown(kind)) previewMoment(title, kind);
    }
  });
  dialog.addEventListener('click', event => {
    if (event.target === dialog) { const r = dialog.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) dialog.close(); return; }
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button'); if (!button || button.disabled) return;
    if (button.dataset.tab === 'focus' || button.dataset.tab === 'moments') { tab = button.dataset.tab; draft = null; exporting = null; renderShell(); return; }
    const action = button.dataset.social;
    if (action === 'close' || action === 'minimize') dialog.close();
    else if (action === 'account') { dialog.close(); window.dispatchEvent(new Event('office-social-account')); }
    else if (action === 'retry') { say(T.loading); void refresh(); }
    else if (action === 'publish' && draft) { const value = draft; void mutate(actor => publishMoment(value.title, value.kind, actor), T.published, true); }
    else if (action === 'edit') { draft = null; dialog.querySelector('.social-preview')?.replaceChildren(); dialog.querySelector<HTMLInputElement>('.social-moment-form input')?.focus(); }
    else if (action === 'cancel-export') { exporting = null; dialog.querySelector('.social-export')?.replaceChildren(); }
    else if (action === 'download') void downloadCard();
    else if (button.dataset.ring) { dialog.close(); window.dispatchEvent(new Event('office-open-doorbell')); }
    else if (button.dataset.join) { const id = button.dataset.join; const quiet = [...dialog.querySelectorAll<HTMLInputElement>('[data-join-quiet]')].find(el => el.dataset.joinQuiet === id)?.checked ?? true; void mutate(actor => joinFocus(id, quiet, actor)); }
    else if (button.dataset.leave) { const id = button.dataset.leave; void mutate(actor => leaveFocus(id, actor)); }
    else if (button.dataset.end) { const id = button.dataset.end; void mutate(actor => endFocus(id, actor)); }
    else if (button.dataset.deleteMoment) { const id = button.dataset.deleteMoment; void mutate(actor => deleteMoment(id, actor), T.deleted); }
    else if (button.dataset.export) { const moment = state?.moments.find(m => m.id === button.dataset.export && m.isOwner); if (moment) previewExport(moment); }
  });
  // Native dialog supplies focus trapping/Escape. Keep office hotkeys from handling input.
  for (const kind of ['keydown', 'pointerdown', 'pointerup', 'pointermove', 'wheel', 'dblclick'] as const) dialog.addEventListener(kind, event => event.stopPropagation());
  dialog.addEventListener('close', () => { generation++; clearTimeout(celebration); pending = false; dialog.classList.remove('social-celebrate'); clear(); stopIdleTimers(); priorFocus?.focus(); });
  const open = (next: 'focus' | 'moments' = 'focus') => {
    if (dialog.open) { tab = next; draft = null; exporting = null; renderShell(); return; }
    priorFocus = document.activeElement as HTMLElement | null; generation++; tab = next; clear(); say(T.loading); dialog.showModal();
    dialog.querySelectorAll<HTMLElement>('[data-tab]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.tab === tab)));
    void refresh();
    polling ??= setInterval(() => { void refresh(); }, 5000); timer ??= setInterval(ticks, 1000);
  };
  dialog.addEventListener('social-open', event => { const next = (event as CustomEvent).detail; open(next === 'moments' ? 'moments' : 'focus'); });
  for (const element of [badge, checkin]) for (const kind of ['pointerdown','pointerup','wheel','dblclick','keydown'] as const) element.addEventListener(kind, event => event.stopPropagation());
  dismissCheckin.addEventListener('click', () => { checkin.hidden = true; });
  badge.addEventListener('click', () => open('focus'));
  window.addEventListener('pagehide', () => { activeFocus = null; badge.hidden = true; checkin.hidden = true; if (dialog.open) dialog.close(); clearInterval(polling); clearInterval(timer); });
  const resumeFocus = () => { restoring=true;polling??=setInterval(()=>{void refresh();},5000);timer??=setInterval(ticks,1000);void refresh().finally(()=>{restoring=false;stopIdleTimers();}); };
  dialog.addEventListener('social-resume',resumeFocus);
  if (sessionStorage.getItem(FOCUS_HINT) === '1') {
    restoring = true; polling = setInterval(() => { void refresh(); }, 5000); timer = setInterval(ticks, 1000);
    void refresh().finally(() => { restoring = false; stopIdleTimers(); });
  }
  return { open };
}

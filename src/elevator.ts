/** Short, permission-checked travel between offices. No office payload is stored across navigation. */
import { api, type Floor } from './building-api';
import { locale } from './i18n';
import './elevator.css';
const T = locale({ en: { travel: 'Elevator', checking: 'Checking your destination…', closing: 'Doors closing', moving: 'Going to your floor', opening: 'Opening office…', arrived: 'Welcome to the floor', skip: 'Skip animation', back: 'Back to office', denied: 'This floor is unavailable. Your access may have changed.', home: 'Home', floor: 'Floor', private: 'Presence only', loading: 'Preparing your office…' }, de: { travel: 'Aufzug', checking: 'Ziel wird geprüft…', closing: 'Türen schließen', moving: 'Auf dem Weg zur Etage', opening: 'Büro wird geöffnet…', arrived: 'Willkommen auf der Etage', skip: 'Animation überspringen', back: 'Zurück zum Büro', denied: 'Diese Etage ist nicht verfügbar. Dein Zugang könnte sich geändert haben.', home: 'Zuhause', floor: 'Etage', private: 'Nur Anwesenheit', loading: 'Dein Büro wird vorbereitet…' } });
const KEY = 'office.elevator-arrival.v1';
const esc = (v: string) => v.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
let active = false;
let generation = 0;
let activeRoot: HTMLElement | undefined;
window.addEventListener('pagehide', () => { generation++; });
window.addEventListener('pageshow', event => { if (event.persisted) { activeRoot?.remove(); activeRoot = undefined; active = false; window.dispatchEvent(new Event('office-travel-cancel')); } });
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
function overlay() {
  const previous = document.activeElement as HTMLElement | null;
  const root = document.createElement('div'); root.className = 'elevator-overlay'; root.dataset.phase = 'checking';
  root.setAttribute('role', 'dialog'); root.setAttribute('aria-modal', 'true'); root.setAttribute('aria-label', T.travel);
  root.innerHTML = `<div class="elevator-sky"></div><div class="elevator-stage"></div><div class="elevator-console"><b>${T.travel}</b><output class="elevator-indicator" aria-live="off" aria-label="${T.floor}">—</output><p role="status" aria-live="polite">${T.checking}</p><button type="button">${T.skip}</button></div><div class="elevator-doors" aria-hidden="true"><i></i><i></i></div>`;
  document.body.append(root); activeRoot = root;
  for (const kind of ['pointerdown', 'pointerup', 'pointermove', 'click', 'wheel']) root.addEventListener(kind, event => event.stopPropagation());
  const status = root.querySelector('p')!; const button = root.querySelector('button')!;
  root.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Tab') { e.preventDefault(); button.focus(); } else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); button.click(); } });
  button.focus();
  return { root, status, button, close() { root.remove(); if (activeRoot === root) { activeRoot = undefined; active = false; previous?.focus(); } } };
}
function building(root: HTMLElement, floors: Floor[], from: string, to: string) {
  // Bound the artwork while always including both endpoints. Directory positions aren't global floor numbers.
  const selected = floors.map((floor, index) => ({ floor, index })).filter(({ floor, index }) => index < 4 || floor.id === from || floor.id === to).slice(0, 6).reverse();
  const rows = selected.map(({ floor, index }) => `<div class="elevator-floor ${floor.id === to ? 'destination' : ''}" data-floor="${esc(floor.id)}"><span class="floor-number">${floor.isOwner ? T.home : index + 1}</span><div class="cutaway-room ${floor.online ? 'online' : ''} ${floor.online && floor.agentCount > 0 ? 'has-activity' : ''}" style="--room:${floor.scope === 'presence' ? '#202f3b' : floor.appearance?.theme === 'loft' ? '#8a5a3c' : '#698878'}">${floor.scope === 'presence' ? `<span class="room-presence">${T.private}</span>` : '<i class="mini-desk"></i><i class="mini-desk"></i><i class="mini-desk"></i>'}<strong>${esc(floor.name)}</strong></div></div>`).join('');
  root.querySelector('.elevator-stage')!.innerHTML = `<div class="cutaway-building"><div class="building-roof"></div><div class="building-rooms">${rows}</div><div class="elevator-shaft"><div class="elevator-cabin"><i></i><i></i></div></div><div class="building-base"></div></div>`;
  const start = Math.max(0, selected.findIndex(v => v.floor.id === from));
  const end = Math.max(0, selected.findIndex(v => v.floor.id === to));
  root.style.setProperty('--start', `${start * 76 + 12}px`); root.style.setProperty('--end', `${end * 76 + 12}px`);
  return { start: selected[start]?.index ?? 0, end: selected[end]?.index ?? 0 };
}
export async function travelToFloor(id: string | null) {
  if (active) return;
  const current = new URL(location.href); const currentId = current.searchParams.get('source') === 'shared' ? current.searchParams.get('floor') : null;
  if (id === currentId && !current.searchParams.has('view')) return;
  active = true;
  const version = ++generation;
  const ui = overlay();
  let skip = reduced(); let finishWait: (() => void) | undefined; let navigating = false;
  ui.root.classList.toggle('reduced-motion', skip);
  ui.button.onclick = () => { skip = true; ui.root.classList.add('reduced-motion'); finishWait?.(); };
  const pause = (ms: number) => skip ? Promise.resolve() : new Promise<void>(resolve => { const timer = setTimeout(resolve, ms); finishWait = () => { clearTimeout(timer); resolve(); }; });
  try {
    const { floors } = await api<{ floors: Floor[] }>('/floors');
    if (version !== generation) return ui.close();
    const own = floors.find(f => f.isOwner); const destination = id ? floors.find(f => f.id === id) : own;
    if (!destination || !own) throw new Error(T.denied);
    const steps = building(ui.root, floors, currentId ?? own.id, destination.id);
    ui.root.querySelector('output')!.textContent = currentId ? String(steps.start + 1) : T.home;
    ui.root.dataset.phase = 'pullback'; ui.status.textContent = T.closing;
    if (!skip) window.dispatchEvent(new Event('office-departure'));
    await pause(300); if (version !== generation) return ui.close();
    ui.root.dataset.phase = 'closing'; await pause(280); if (version !== generation) return ui.close();
    ui.root.dataset.phase = 'moving'; ui.status.textContent = T.moving;
    const started = performance.now();
    const counter = setInterval(() => { const progress = Math.min(1, (performance.now() - started) / 850); ui.root.querySelector('output')!.textContent = String(Math.round(steps.start + (steps.end - steps.start) * progress) + 1); }, 90);
    await pause(850); clearInterval(counter); if (version !== generation) return ui.close();
    ui.root.querySelector('output')!.textContent = destination.isOwner ? T.home : String(steps.end + 1);
    ui.root.dataset.phase = 'boarding'; ui.status.textContent = T.opening;
    // Revalidate after the animation; a grant may have been revoked while travelling.
    if (id) await api(`/offices/${encodeURIComponent(id)}`);
    else await api('/session');
    if (version !== generation) return ui.close();
    const url = new URL(location.href); url.searchParams.delete('view');
    if (id) { url.searchParams.set('source', 'shared'); url.searchParams.set('floor', id); }
    else { url.searchParams.delete('source'); url.searchParams.delete('floor'); }
    try { sessionStorage.setItem(KEY, JSON.stringify({ path: url.pathname + url.search, at: Date.now(), skip })); } catch { /* storage may be disabled */ }
    navigating = true; location.assign(url);
  } catch {
    if (version !== generation) return ui.close();
    ui.root.dataset.phase = 'failed'; ui.root.querySelector('.elevator-stage')!.replaceChildren();
    ui.status.textContent = T.denied; ui.button.textContent = T.back; ui.button.onclick = () => { window.dispatchEvent(new Event('office-travel-cancel')); ui.close(); };
    ui.button.focus();
  } finally { finishWait = undefined; if (!navigating && ui.root.dataset.phase !== 'failed') ui.close(); }
}
/** Called before the heavy renderer loads, so the destination isn't exposed behind loading doors. */
export function resumeArrival() {
  let ticket;
  try { ticket = JSON.parse(sessionStorage.getItem(KEY) ?? 'null'); sessionStorage.removeItem(KEY); } catch { return; }
  if (!ticket || ticket.path !== location.pathname + location.search || typeof ticket.at !== 'number' || Date.now() - ticket.at > 30000 || Date.now() < ticket.at) return;
  active = true; const ui = overlay();
  ui.root.dataset.phase = 'arrival-loading'; ui.root.classList.toggle('reduced-motion', !!ticket.skip || reduced());
  ui.status.textContent = T.loading;
  let ready = false; let skipped = !!ticket.skip || reduced(); let timer: ReturnType<typeof setTimeout> | undefined;
  let fallback: ReturnType<typeof setTimeout> | undefined;
  const cleanup = () => { clearTimeout(timer); clearTimeout(fallback); ui.close(); window.removeEventListener('office-ready', arrive); window.removeEventListener('office-load-error', fail); };
  const arrive = () => { clearTimeout(fallback); ready = true; if (!skipped) window.dispatchEvent(new Event('office-arrival-start')); ui.root.dataset.phase = 'arrived'; ui.status.textContent = T.arrived; timer = setTimeout(cleanup, skipped ? 0 : 650); };
  const fail = () => cleanup();
  ui.button.onclick = () => { skipped = true; ui.root.classList.add('reduced-motion'); if (ready) cleanup(); };
  fallback = setTimeout(() => { ui.button.textContent = T.back; ui.button.onclick = () => { cleanup(); const home = new URL(location.href); home.searchParams.delete('source'); home.searchParams.delete('floor'); location.assign(home); }; }, 12000);
  window.addEventListener('office-ready', arrive, { once: true }); window.addEventListener('office-load-error', fail, { once: true });
}

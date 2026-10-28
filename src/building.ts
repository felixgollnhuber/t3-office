/** Invitation-based building shell. One iframe owns one office renderer; no hidden floors keep running. */
import '@fontsource/pixelify-sans/700.css';
import './building.css';
import { api, ApiError, type Session, type Floor, type Grant, type Invite } from './building-api';
import { B } from './i18n/building';
import { lang, setLang } from './i18n';

const esc = (s: string | number) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const root = document.createElement('div');
root.id = 'building';
document.body.replaceChildren(root);
let session: Session | null = null;
let floors: Floor[] = [];
let selected = '';
let rendered = '';
let demoTimer: ReturnType<typeof setInterval> | undefined;
let demoTick = 0;
let generation = 0;
let refreshingGeneration = -1;
let authMode: 'register' | 'login' = 'register';
let invitation = sessionStorage.getItem('building.invitation') ?? '';
const hash = new URLSearchParams(location.hash.slice(1));
if (hash.has('invite')) {
  invitation = hash.get('invite') ?? '';
  sessionStorage.setItem('building.invitation', invitation);
  history.replaceState(null, '', location.pathname + location.search);
}

const logo = `<span class="building-logo" aria-hidden="true"><i></i><i></i><i></i><i></i></span>`;
const language = `<label class="language">${B.language}<select id="language"><option value="en" ${lang === 'en' ? 'selected' : ''}>English</option><option value="de" ${lang === 'de' ? 'selected' : ''}>Deutsch</option></select></label>`;
const illustration = () => `<div class="tower" aria-hidden="true"><div class="tower-roof"></div>${[3, 2, 1].map((n) => `<div class="tower-floor"><span class="floor-digit">0${n}</span><div class="tiny-office"><i class="plant"></i><i class="desk"></i><i class="person"></i><i class="desk second"></i><i class="person second"></i><i class="window"></i></div></div>`).join('')}<div class="tower-lobby"><span>t3 office</span><i></i></div><div class="tower-base"></div></div>`;

function message(text: string, error = false) {
  document.querySelectorAll<HTMLElement>('#notice, dialog[open] .dialog-notice').forEach((target) => {
    target.textContent = text;
    target.classList.toggle('error', error);
    target.hidden = !text;
  });
}

async function run(task: () => Promise<void>) {
  try { await task(); }
  catch (error) {
    message(error instanceof Error ? error.message : B.genericError, true);
    if (error instanceof ApiError && error.status === 401 && session) { generation++; clearDemo(); session = null; renderAuth(); message(error.message, true); }
  }
}

function renderAuth() {
  rendered = '';
  root.innerHTML = `<header class="public-header"><a href="/" class="brand">${logo}<span>T3 Office <small>${B.building}</small></span></a>${language}</header>
    <main class="welcome"><section class="welcome-copy"><p class="eyebrow">${B.eyebrow}</p><h1>${esc(B.tagline).replace('\n', '<br>')}</h1><p class="intro">${B.intro}</p><p class="privacy-note"><span aria-hidden="true">◇</span> ${B.consent}</p>${illustration()}</section>
    <section class="auth-card"><span class="small-label">T3 OFFICE / ${B.building.toUpperCase()}</span><h2>${authMode === 'register' ? B.register : B.login}</h2><p class="muted">${B.accountHint}</p>
    <p id="notice" role="status" aria-live="polite" ${invitation ? '' : 'hidden'}>${invitation ? B.acceptPending : ''}</p>
    <form id="auth-form">${authMode === 'register' ? `<label>${B.name}<input name="name" required maxlength="60" autocomplete="name"></label>` : ''}
    <label>${B.handle}<input name="handle" required minlength="3" maxlength="32" pattern="[a-zA-Z0-9_-]+" autocomplete="username" autocapitalize="none" spellcheck="false"></label>
    <label>${B.password}<input name="password" type="password" required minlength="12" maxlength="256" autocomplete="${authMode === 'register' ? 'new-password' : 'current-password'}" aria-describedby="password-hint"></label><small id="password-hint">${B.passwordHint}</small>
    <button class="primary" type="submit">${authMode === 'register' ? B.register : B.login} <span aria-hidden="true">↗</span></button></form>
    <button class="text-button" data-action="auth-mode">${authMode === 'register' ? B.loginInstead : B.registerInstead}</button><a class="demo-link" href="?source=demo&weather=clear">${B.demo} ↗</a></section></main>`;
}

function renderShell() {
  root.innerHTML = `<div class="building-layout"><aside class="directory"><a class="brand" href="/">${logo}<span>T3 Office <small>${B.building}</small></span></a><div class="directory-heading"><span class="small-label">${B.lobby}</span><span aria-hidden="true">↕</span></div>
    <nav id="floor-list" aria-label="${B.lobby}"></nav><div class="directory-bottom"><button data-action="accept-open">+ ${B.accept}</button><div class="profile"><span class="avatar">${esc(session!.user.name.slice(0, 2).toUpperCase())}</span><span>${esc(session!.user.name)}<small>@${esc(session!.user.handle)}</small></span><button data-action="logout" aria-label="${B.signOut}" title="${B.signOut}">↗</button></div></div></aside>
    <main class="workspace"><header class="office-header"><div><span class="small-label" id="floor-kicker"></span><h1 id="office-title"></h1></div><div class="header-actions"><button data-action="manage" class="owner-control">${B.settings}</button><button class="primary owner-control" data-action="invite">+ ${B.invite}</button></div></header>
    <p id="notice" role="status" aria-live="polite" hidden></p><div class="office-toolbar"><span id="office-state"></span><span id="sharing-scope"></span></div>
    <section id="office-room" class="office-room" aria-label="${B.overview}"></section>
    <footer class="office-footer"><span>◇ ${B.safe}</span><span class="connection-dot">${B.connection}</span></footer></main></div>
    <dialog id="manage-dialog" aria-labelledby="manage-title"><div class="dialog-header"><h2 id="manage-title">${B.settings}</h2><button data-action="close-dialog" aria-label="${B.close}">×</button></div><div class="dialog-body"><p class="dialog-notice" role="status" aria-live="polite" hidden></p>
    <form id="name-form"><label>${B.officeName}<input name="name" maxlength="80" required value="${esc(session!.office.name)}"></label><button type="submit">${B.save}</button></form>
    <section class="control-section"><div class="control-heading"><h3>${B.activity}</h3><button data-action="pause">${session!.office.paused ? B.resume : B.pause}</button></div><p class="muted">${B.safe}</p><div class="button-row"><button data-action="demo">${demoTimer ? B.stopDemo : B.startDemo}</button></div></section>
    <section class="control-section" id="invite-section"><h3>${B.invite}</h3><p class="muted">${B.inviteHint}</p><form id="invite-form"><label>${B.shareLevel}<select name="scope"><option value="presence">${B.presence}</option><option value="activity">${B.activity}</option></select></label><button class="primary" type="submit">${B.createInvite}</button></form><div id="invite-result"></div></section>
    <section class="control-section"><h3>${B.guests}</h3><div id="grant-list"></div><h3>${B.pendingInvites}</h3><div id="invite-list"></div></section>
    <section class="control-section" id="publisher-section"><h3>${B.publisher}</h3><p class="muted">${B.publisherHint}</p><button data-action="create-key">${B.createKey}</button><div id="key-result"></div><h3>${B.keys}</h3><div id="key-list"></div></section></div></dialog>
    <dialog id="accept-dialog" aria-labelledby="accept-title"><div class="dialog-header"><h2 id="accept-title">${B.accept}</h2><button data-action="close-dialog" aria-label="${B.close}">×</button></div><div class="dialog-body"><p class="dialog-notice" role="status" aria-live="polite" hidden></p><p class="muted">${B.acceptHint}</p><form id="accept-form"><label>${B.token}<input name="token" required value="${esc(invitation)}" autocomplete="off"></label><button class="primary" type="submit">${B.accept}</button></form></div></dialog>`;
}

function renderFloors() {
  const nav = document.querySelector('#floor-list')!;
  nav.innerHTML = `<p class="group-label">${B.own}</p>${floors.filter((f) => f.isOwner).map(floorButton).join('')}<p class="group-label">${B.shared}</p>${floors.filter((f) => !f.isOwner).map(floorButton).join('') || `<p class="empty-directory">${B.emptyDirectory}</p>`}`;
}

function floorButton(f: Floor) {
  return `<button class="floor-button ${f.id === selected ? 'selected' : ''}" data-floor="${esc(f.id)}" aria-current="${f.id === selected ? 'page' : 'false'}"><span class="floor-icon" aria-hidden="true">▦</span><span><b>${esc(f.name)}</b><small>${esc(f.ownerName)} · ${f.online ? B.online : B.offline}</small></span><span class="status-dot ${f.online ? 'on' : ''}" aria-hidden="true"></span></button>`;
}

function renderOffice() {
  const floor = floors.find((f) => f.id === selected);
  const room = document.querySelector<HTMLElement>('#office-room')!;
  if (!floor) { room.replaceChildren(); rendered = ''; return; }
  document.querySelector('#office-title')!.textContent = floor.name;
  document.querySelector('#floor-kicker')!.textContent = floor.isOwner ? B.owner.toUpperCase() : `${B.visitor.toUpperCase()} / ${floor.ownerName}`;
  document.querySelectorAll<HTMLElement>('.owner-control').forEach((el) => { el.hidden = !floor.isOwner; });
  document.querySelector('#office-state')!.textContent = floor.isOwner && session!.office.paused ? B.paused : `${floor.online ? B.online : B.offline}${floor.agentCount ? ` · ${floor.agentCount} ${B.agents}` : ''}${demoTimer && floor.isOwner ? ` · ${B.simulation}` : ''}`;
  document.querySelector('#sharing-scope')!.textContent = floor.scope === 'presence' ? B.presence : floor.isOwner ? B.private : B.activity;
  const key = `${floor.id}:${floor.online}:${floor.scope}:${floor.isOwner && session!.office.paused}`;
  if (key === rendered) return;
  rendered = key;
  const hasActivity = floor.online && floor.scope !== 'presence' && !(floor.isOwner && session!.office.paused);
  if (hasActivity) {
    room.innerHTML = `<iframe title="${esc(floor.name)}" src="?source=shared&floor=${encodeURIComponent(floor.id)}&weather=clear&theme=campus&season=off&kiosk=1&zoom=14" referrerpolicy="no-referrer"></iframe><span class="room-hint">${B.roomHint}</span>`;
  } else {
    const paused = floor.isOwner && session!.office.paused;
    room.innerHTML = `<div class="empty-office">${illustration()}<div><span class="small-label">${B.floorLabel} / ${esc(floor.ownerName)}</span><h2>${paused ? B.paused : floor.isOwner ? B.emptyTitle : floor.scope === 'presence' ? B.presenceTitle : B.offlineTitle}</h2><p>${paused ? B.pausedBody : floor.isOwner ? B.emptyBody : floor.scope === 'presence' ? B.presenceBody : B.offlineBody}</p>${floor.isOwner ? `<div class="button-row"><button class="primary" data-action="${paused ? 'pause' : 'demo'}">${paused ? B.resume : B.startDemo}</button><button data-action="publisher">${B.publisher}</button></div>` : ''}</div></div>`;
  }
}

async function refresh() {
  if (!session || refreshingGeneration === generation) return;
  const epoch = generation;
  const userId = session.user.id;
  refreshingGeneration = epoch;
  try {
    const [nextSession, data] = await Promise.all([api<Session>('/session'), api<{ floors: Floor[] }>('/floors')]);
    if (epoch !== generation || !session || session.user.id !== userId) return;
    session = nextSession;
    floors = data.floors;
    if (!floors.some((f) => f.id === selected)) selected = session.office.id;
    renderFloors(); renderOffice();
  } catch (error) {
    if (epoch !== generation || !session || session.user.id !== userId) return;
    rendered = '';
    document.querySelector('#office-room')?.replaceChildren();
    if (error instanceof ApiError && error.status === 401) { generation++; clearDemo(); session = null; renderAuth(); }
    message(B.connectionLost, true);
  } finally { if (refreshingGeneration === epoch) refreshingGeneration = -1; }
}

async function controls() {
  const [grants, invites, keys] = await Promise.all([
    api<{ grants: Grant[] }>('/grants'), api<{ invites: Invite[] }>('/invites'), api<{ tokens: { id: string; expiresAt: number }[] }>('/publisher-tokens'),
  ]);
  document.querySelector('#grant-list')!.innerHTML = grants.grants.map((g) => `<div class="access-row"><span>${esc(g.userName)} <small>@${esc(g.userHandle)} · ${g.scope === 'activity' ? B.activity : B.presence}</small></span><button data-delete="grants" data-id="${esc(g.id)}">${B.revoke}</button></div>`).join('') || `<p class="muted">${B.noGuests}</p>`;
  document.querySelector('#invite-list')!.innerHTML = invites.invites.map((i) => `<div class="access-row"><span>${i.scope === 'activity' ? B.activity : B.presence}<small>${B.expires} ${esc(new Date(i.expiresAt).toLocaleString())}</small></span><button data-delete="invites" data-id="${esc(i.id)}">${B.revoke}</button></div>`).join('') || `<p class="muted">${B.noInvites}</p>`;
  document.querySelector('#key-list')!.innerHTML = keys.tokens.map((k) => `<div class="access-row"><span>${B.publisher}<small>${B.expires} ${esc(new Date(k.expiresAt).toLocaleString())}</small></span><button data-delete="publisher-tokens" data-id="${esc(k.id)}">${B.revoke}</button></div>`).join('') || `<p class="muted">${B.noKeys}</p>`;
}

async function openManage(section?: string) {
  await controls();
  const dialog = document.querySelector<HTMLDialogElement>('#manage-dialog')!;
  if (!dialog.open) dialog.showModal();
  if (section) document.getElementById(section)?.scrollIntoView({ block: 'start', behavior: 'instant' });
}

function clearDemo() { clearInterval(demoTimer); demoTimer = undefined; }
async function publishDemo() {
  const providers = ['claude', 'codex', 'cursor', 'gemini'];
  const statuses = ['running', 'running', 'waiting', 'idle', 'running', 'completed', 'running', 'idle'];
  await api('/publish', 'POST', { agents: Array.from({ length: 8 }, (_, i) => ({ id: `sim-${i}`, provider: providers[i % 4], status: statuses[(i + demoTick) % statuses.length] })) });
  demoTick++;
}

async function toggleDemo() {
  if (demoTimer) { clearDemo(); await api('/publish', 'POST', { agents: [] }); }
  else {
    if (session!.office.paused) session = await updateOffice({ paused: false });
    await publishDemo();
    demoTimer = setInterval(() => { void run(async () => { try { await publishDemo(); } catch (e) { clearDemo(); throw e; } }); }, 10_000);
  }
  await refresh();
  document.querySelectorAll<HTMLButtonElement>('[data-action="demo"]').forEach((b) => { b.textContent = demoTimer ? B.stopDemo : B.startDemo; });
}

async function updateOffice(body: unknown): Promise<Session> {
  await api('/office', 'POST', body);
  return api<Session>('/session');
}

function inviteCode(value: string) {
  const text = value.trim();
  try { return new URLSearchParams(new URL(text).hash.slice(1)).get('invite') ?? text; }
  catch { return text; }
}

async function accept(value: string) {
  const token = inviteCode(value);
  if (!token) throw new Error(B.linkInvalid);
  const result = await api<{ officeId: string }>('/accept', 'POST', { token });
  invitation = ''; sessionStorage.removeItem('building.invitation');
  selected = result.officeId;
  document.querySelector<HTMLDialogElement>('#accept-dialog')?.close();
  await refresh(); message(B.joined);
}

root.addEventListener('change', (event) => {
  if ((event.target as HTMLElement).id === 'language') setLang((event.target as HTMLSelectElement).value as 'en' | 'de');
});
root.addEventListener('submit', (event) => {
  event.preventDefault();
  const form = event.target as HTMLFormElement;
  const data = Object.fromEntries(new FormData(form));
  const submit = form.querySelector<HTMLButtonElement>('[type="submit"]')!;
  submit.disabled = true;
  void run(async () => {
    if (form.id === 'auth-form') {
      generation++;
      session = await api<Session>(`/${authMode}`, 'POST', data);
      selected = session.office.id;
      renderShell(); await refresh();
      if (invitation) document.querySelector<HTMLDialogElement>('#accept-dialog')!.showModal();
    } else if (form.id === 'name-form') {
      session = await updateOffice(data); await refresh(); message(B.saved);
    } else if (form.id === 'invite-form') {
      const result = await api<{ token: string; expiresAt: number }>('/invites', 'POST', data);
      const link = `${location.origin}${location.pathname}#invite=${encodeURIComponent(result.token)}`;
      document.querySelector('#invite-result')!.innerHTML = `<p>${B.inviteReady}</p><textarea readonly aria-label="${B.token}">${esc(link)}</textarea><button data-action="copy-invite">${B.copy}</button>`;
      await controls();
    } else if (form.id === 'accept-form') await accept(String(data.token));
  }).finally(() => { submit.disabled = false; });
});

root.addEventListener('click', (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button');
  if (!button) return;
  void run(async () => {
    if (button.dataset.floor) { selected = button.dataset.floor; renderFloors(); renderOffice(); return; }
    if (button.dataset.delete && button.dataset.id) {
      button.disabled = true;
      try { await api(`/${button.dataset.delete}/${encodeURIComponent(button.dataset.id)}`, 'DELETE'); await controls(); }
      finally { button.disabled = false; }
      return;
    }
    switch (button.dataset.action) {
      case 'auth-mode': authMode = authMode === 'register' ? 'login' : 'register'; renderAuth(); break;
      case 'logout':
        generation++;
        await api('/logout', 'POST'); clearDemo(); session = null; floors = []; renderAuth(); break;
      case 'close-dialog': button.closest('dialog')?.close(); break;
      case 'manage': await openManage(); break;
      case 'invite': await openManage('invite-section'); break;
      case 'publisher': await openManage('publisher-section'); break;
      case 'accept-open': document.querySelector<HTMLDialogElement>('#accept-dialog')!.showModal(); break;
      case 'demo': await toggleDemo(); break;
      case 'pause':
        clearDemo(); session = await updateOffice({ paused: !session!.office.paused });
        button.textContent = session.office.paused ? B.resume : B.pause;
        rendered = ''; await refresh(); break;
      case 'create-key': {
        button.disabled = true;
        try {
          const result = await api<{ token: string }>('/publisher-tokens', 'POST');
          document.querySelector('#key-result')!.innerHTML = `<p>${B.keyReady}</p><textarea readonly aria-label="${B.publisher}">${esc(result.token)}</textarea><button data-action="copy-key">${B.copyKey}</button>`;
          await controls();
        } finally { button.disabled = false; }
        break;
      }
      case 'copy-invite': case 'copy-key': {
        const area = button.parentElement!.querySelector('textarea')!;
        try { await navigator.clipboard.writeText(area.value); button.textContent = B.copied; }
        catch { area.focus(); area.select(); }
        break;
      }
    }
  });
});
window.addEventListener('message', (event) => {
  const frame = root.querySelector('iframe');
  if (event.origin === location.origin && event.source === frame?.contentWindow && event.data?.type === 'office-access-lost') {
    frame?.remove(); rendered = ''; message(B.noAccess, true); void refresh();
  }
});
document.addEventListener('visibilitychange', () => { if (!document.hidden) void refresh(); });
setInterval(() => { void refresh(); }, 5000);
root.textContent = B.loading;
void (async () => {
  try {
    session = await api<Session>('/session'); selected = session.office.id;
    renderShell(); await refresh();
    if (invitation) document.querySelector<HTMLDialogElement>('#accept-dialog')!.showModal();
  } catch (error) {
    renderAuth();
    if (!(error instanceof ApiError && error.status === 401)) message(error instanceof Error ? error.message : B.genericError, true);
  }
})();

import { travelToFloor } from './elevator';
import { settings } from './settings';
import { DEFAULT_APPEARANCE, isAppearance, OFFICE_LAYOUTS, OFFICE_LIGHTING, type Appearance } from './appearance';
/** Optional friends menu embedded in the original office. Own-office use never requires a building account. */
import '@fontsource/pixelify-sans/700.css';
import '@fontsource-variable/bitcount-prop-single';
import './building.css';
import { api, ApiError, WORK_AREAS, type SharedAgent, type Session, type Floor, type Grant, type Invite } from './building-api';
import { B } from './i18n/building';
import { THEMES } from './themes';

const theme = THEMES.find((t) => t.id === new URLSearchParams(location.search).get('theme')) ?? THEMES[0];
for (const [key, value] of Object.entries({ paper: theme.hud.paper, ink: theme.hud.ink, muted: theme.hud.muted, accent: theme.hud.accent, edge: theme.hud.edge, shadow: theme.hud.shadow })) document.documentElement.style.setProperty(`--${key}`, value);
const esc = (s: string | number) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const root = document.createElement('main'); root.id = 'friends-menu'; document.body.replaceChildren(root);
const embedded = parent !== window;
const send = (data: unknown) => { if (embedded) parent.postMessage(data, location.origin); };
let session: Session | null = null;
let local = false;
let sharing = false;
let pendingShare = false;
let localCharacters: SharedAgent[] = [];
let authMode: 'register' | 'login' = 'register';
let appearance: Appearance = { ...DEFAULT_APPEARANCE };
let currentFloor: string | null = null;
let appearanceReady = false;
let tab: 'friends' | 'characters' | 'sharing' | 'style' = 'friends';
let generation = 0;
let invitation = sessionStorage.getItem('building.invitation') ?? '';
const token = new URLSearchParams(location.hash.slice(1)).get('invite');
if (token) { invitation = token; sessionStorage.setItem('building.invitation', token); history.replaceState(null, '', location.pathname + location.search); }
let refreshing = false;
let logoutPending = false;

function notice(text: string, error = false) {
  const target = root.querySelector<HTMLElement>('#notice');
  if (target) { target.textContent = text; target.hidden = !text; target.classList.toggle('error', error); }
}
async function run(task: () => Promise<void>) {
  try { await task(); } catch (error) { notice(error instanceof Error ? error.message : B.genericError, true); }
}
function render() {
  root.innerHTML = `<header><h1>${B.friendsMenu}</h1><button data-action="close" aria-label="${B.close}">×</button></header><nav class="menu-tabs" aria-label="${B.friendsMenu}">${(['friends', 'characters', 'sharing', 'style'] as const).map((t) => `<button data-tab="${t}" aria-pressed="${tab === t}">${t === 'friends' ? B.friends : t === 'characters' ? B.characters : t === 'style' ? B.decorate : B.sharing}</button>`).join('')}</nav><p id="notice" role="status" aria-live="polite" hidden></p><section id="panel"></section>`;
  const panel = root.querySelector('#panel')!;
  if (tab === 'style') {
    panel.innerHTML = `<h2>${B.decorate}</h2><p class="hint">${B.styleHint}</p>${!local && embedded ? `<p>${B.styleVisitor}</p><button data-action="own">${B.own}</button>` : `<form id="style-form"><label>${B.themeLabel}<select name="theme">${THEMES.map((t) => `<option value="${t.id}" ${appearance.theme === t.id ? 'selected' : ''}>${esc(t.label)}</option>`).join('')}</select></label><label>${B.layoutLabel}<select name="layout">${OFFICE_LAYOUTS.map((v, i) => `<option value="${v}" ${appearance.layout === v ? 'selected' : ''}>${[B.originalLayout, B.focusLayout, B.loungeLayout][i]}</option>`).join('')}</select></label><label>${B.lightingLabel}<select name="lighting">${OFFICE_LIGHTING.map((v, i) => `<option value="${v}" ${appearance.lighting === v ? 'selected' : ''}>${[B.originalLight, B.warmLight, B.coolLight][i]}</option>`).join('')}</select></label><p class="hint">${B.styleLocal}</p><button type="submit">${B.applyStyle}</button></form>`}`;
    return;
  }
  if (tab === 'characters') {
    panel.innerHTML = `<p class="hint">${B.characterHint}</p><div id="character-list"></div>`;
    if (local) { if (!embedded) renderCharacters(localCharacters); }
    else if (session) {
      const epoch = generation;
      void run(async () => { const result = await api<{ characters: SharedAgent[] }>('/characters'); if (epoch === generation && session) renderCharacters(result.characters); });
    }
    else panel.innerHTML += `<p>${B.noCharacters}</p>`;
    send({ type: 'office-characters-request' });
    return;
  }
  if (!session) {
    panel.innerHTML = `<h2>${B.yourOfficeFirst}</h2><p class="hint">${B.optionalAccount}</p>${invitation ? `<p>${B.acceptPending}</p>` : ''}<form id="auth-form">${authMode === 'register' ? `<label>${B.name}<input name="name" required maxlength="60" autocomplete="name"></label>` : ''}<label>${B.handle}<input name="handle" required minlength="3" maxlength="32" pattern="[a-zA-Z0-9_-]+" autocomplete="username" autocapitalize="none"></label><label>${B.password}<input name="password" type="password" required minlength="12" maxlength="256" autocomplete="${authMode === 'register' ? 'new-password' : 'current-password'}"></label><small>${B.passwordHint}</small><button type="submit">${authMode === 'register' ? B.register : B.login}</button></form><button data-action="auth-mode">${authMode === 'register' ? B.loginInstead : B.registerInstead}</button>`;
    return;
  }
  const account = `<p class="account">${esc(session.user.name)} · @${esc(session.user.handle)} <button data-action="logout">${B.signOut}</button></p>`;
  if (tab === 'friends') {
    panel.innerHTML = `${account}<div class="section-title"><h2>${B.building}</h2><button data-action="building">${B.buildingView}</button><button data-action="own">${B.own}</button></div><p class="hint">${B.buildingHint}</p><div class="elevator-heading"><span aria-hidden="true">↕</span><div><h2>${B.elevator}</h2><p class="hint">${B.liftHint}</p></div></div><div id="floor-list" aria-label="${B.elevator}"></div><section><h2>${B.invite}</h2><p class="hint">${B.inviteHint}</p><form id="invite-form"><label>${B.shareLevel}<select name="scope"><option value="presence">${B.presence}</option><option value="activity">${B.activity}</option></select></label><button type="submit">${B.createInvite}</button></form><div id="invite-result"></div></section><section><h2>${B.accept}</h2><form id="accept-form"><label>${B.token}<input name="token" required value="${esc(invitation)}" autocomplete="off"></label><button type="submit">${B.accept}</button></form></section><section><h2>${B.guests}</h2><div id="grant-list"></div><h2>${B.pendingInvites}</h2><div id="invite-list"></div></section>`;
    void refreshFriends();
  } else {
    panel.innerHTML = `${account}<h2>${B.sharing} · ${esc(session.office.name)}</h2><p class="hint">${B.safe}</p><p id="sharing-state" role="status" aria-live="polite"></p>${local ? `<button data-action="share">${sharing ? B.stopSharing : B.shareOffice}</button><p class="hint">${B.shareOfficeHint}</p>` : ''}<section class="sharing-summary"><h2>${B.sharedDetails}</h2><p>${B.presenceDetails}</p><p>${B.activityDetails}</p><p class="hint">${B.privateDetails}</p><p id="snapshot-state"></p><p class="hint">${B.freshnessHint}</p><button data-action="refresh-access">${B.refreshAccess}</button><h2>${B.guests}</h2><p class="hint">${B.accessHint}</p><div id="sharing-audience"></div></section><form id="name-form"><label>${B.officeName}<input name="name" maxlength="80" required value="${esc(session.office.name)}"></label><button type="submit">${B.save}</button></form><section><h2>${B.publisher}</h2><p class="hint">${B.publisherHint}</p><button data-action="create-key">${B.createKey}</button><div id="key-result"></div><div id="key-list"></div></section>`;
    renderSharingState();
    void refreshFriends();
    void run(async () => renderKeys());
  }
}
function renderCharacters(agents: SharedAgent[]) {
  if (tab !== 'characters') return;
  if (local) { root.querySelector('#character-list')!.innerHTML = `<p class="hint">${B.selectCharacter}</p>` + agents.map((a) => `<button class="character-select" data-character-select="${esc(a.id)}">${esc(a.name)} · ${B.editCharacter}</button>`).join(''); return; }
  root.querySelector('#character-list')!.innerHTML = agents.map((a) => `<form class="character-form" data-character="${esc(a.id)}"><span class="character-avatar" aria-hidden="true">${esc(a.name.slice(0, 2).toUpperCase())}</span><div><small>${esc(a.provider)}</small><label>${B.characterName}<input name="name" required maxlength="32" value="${esc(a.name)}"></label><label>${B.workArea}<select name="area">${WORK_AREAS.map((area) => `<option value="${area}" ${a.area === area ? 'selected' : ''}>${B.areaLabels[area]}</option>`).join('')}</select></label></div><button type="submit">${B.saveCharacter}</button></form>`).join('') || `<p>${B.noCharacters}</p>`;
}
function renderSharingState() {
  const state = root.querySelector('#sharing-state'); if (state) state.textContent = sharing ? B.online : B.browserStopped;
  const button = root.querySelector('[data-action="share"]'); if (button) button.textContent = sharing ? B.stopSharing : B.shareOffice;
  if (button instanceof HTMLButtonElement) button.disabled = pendingShare;
}
async function refreshFriends() {
  if (!session || !['friends', 'sharing'].includes(tab) || refreshing) return;
  refreshing = true;
  const epoch = generation;
  try {
    const [data, grants, invites] = await Promise.all([api<{ floors: Floor[] }>('/floors'), api<{ grants: Grant[] }>('/grants'), api<{ invites: Invite[] }>('/invites')]);
    if (epoch !== generation || !session || !['friends', 'sharing'].includes(tab)) return;
    const audience = grants.grants.map((g) => `<div class="access-row"><span>${esc(g.userName)} · @${esc(g.userHandle)}<small>${g.scope === 'activity' ? B.activityDetails : B.presenceDetails}</small></span><button data-delete="grants" data-id="${esc(g.id)}">${B.revoke}</button></div>`).join('') || `<p class="hint">${B.noGuests}</p>`;
    if (tab === 'sharing') {
      root.querySelector('#sharing-audience')!.innerHTML = audience;
      const own = data.floors.find((f) => f.isOwner);
      root.querySelector('#snapshot-state')!.textContent = own ? `${own.paused ? B.serverPaused : own.online ? B.online : B.offline} · ${B.lastPublished}: ${own.updatedAt ? new Date(own.updatedAt).toLocaleString() : B.neverPublished}` : B.accessUnavailable;
      return;
    }
    root.querySelector('#floor-list')!.innerHTML = [...data.floors].reverse().map((f, index) => `<button class="floor ${(currentFloor ? currentFloor === f.id : f.isOwner) ? 'current-floor' : ''}" aria-current="${(currentFloor ? currentFloor === f.id : f.isOwner) ? 'location' : 'false'}" data-floor="${esc(f.id)}" data-own="${f.isOwner}"><span><small class="floor-number">${f.isOwner ? B.homeFloor : `${B.floorLabel} ${data.floors.length - index}`}${(currentFloor ? currentFloor === f.id : f.isOwner) ? ` · ${B.youAreHere}` : ''}</small><b>${esc(f.name)}</b><small>${esc(f.ownerName)} · ${f.online ? B.online : B.offline}</small><small>${f.scope === 'presence' ? B.presence : f.areas.map((a) => `${B.areaLabels[a.area]} (${a.count})`).join(' · ')}</small></span><span class="floor-windows" aria-hidden="true">${Array.from({ length: 3 }, () => `<i class="${f.online ? 'lit' : ''}"></i>`).join('')}</span><span>${f.isOwner ? B.own : B.enter} ↗</span></button>`).join('');
    root.querySelector('#grant-list')!.innerHTML = audience;
    root.querySelector('#invite-list')!.innerHTML = invites.invites.map((i) => `<div class="access-row"><span>${i.scope === 'activity' ? B.activity : B.presence}<small>${B.expires} ${esc(new Date(i.expiresAt).toLocaleString())}</small></span><button data-delete="invites" data-id="${esc(i.id)}">${B.revoke}</button></div>`).join('') || `<p class="hint">${B.noInvites}</p>`;
  } catch (error) {
    if (epoch !== generation) return;
    const snapshot = root.querySelector('#snapshot-state'); if (snapshot) snapshot.textContent = B.accessUnavailable;
    const audience = root.querySelector('#sharing-audience'); if (audience) audience.textContent = B.accessUnavailable;
    if (error instanceof ApiError && error.status === 401) { session = null; generation++; render(); }
    notice(error instanceof Error ? error.message : B.genericError, true);
  } finally { refreshing = false; }
}
async function renderKeys() {
  const epoch = generation;
  const data = await api<{ tokens: { id: string; expiresAt: number }[] }>('/publisher-tokens');
  if (epoch !== generation || !session) return;
  const list = root.querySelector('#key-list'); if (!list) return;
  list.innerHTML = data.tokens.map((k) => `<div class="access-row"><span>${B.publisher}<small>${B.expires} ${esc(new Date(k.expiresAt).toLocaleString())}</small></span><button data-delete="publisher-tokens" data-id="${esc(k.id)}">${B.revoke}</button></div>`).join('') || `<p class="hint">${B.noKeys}</p>`;
}
function inviteCode(value: string) { try { return new URLSearchParams(new URL(value.trim()).hash.slice(1)).get('invite') ?? value.trim(); } catch { return value.trim(); } }
async function logout() { generation++; await api('/logout', 'POST'); session = null; sharing = false; render(); }
root.addEventListener('submit', (event) => {
  event.preventDefault(); const form = event.target as HTMLFormElement; const data = Object.fromEntries(new FormData(form));
  const button = form.querySelector<HTMLButtonElement>('[type="submit"]')!; button.disabled = true;
  const epoch = generation;
  void run(async () => {
    if (form.id === 'style-form') {
      if (!isAppearance(data)) return;
      const epoch = generation;
      if (session) { const result = await api<Session>('/office', 'POST', { appearance: data }); if (epoch !== generation || !session) return; session = result; }
      appearance = data;
      if (embedded) send({ type: 'office-appearance-save', appearance });
      else {
        localStorage.setItem('office.appearance.v1', JSON.stringify(appearance));
        const home = new URL(location.href); home.searchParams.delete('view'); home.searchParams.delete('theme');
        history.replaceState(null, '', home);
        if (settings.get('theme') !== appearance.theme) settings.set('theme', appearance.theme);
        else location.assign(home);
      }
    }
    else if (form.id === 'auth-form') { const authEpoch = ++generation; const result = await api<Session>(`/${authMode}`, 'POST', data); if (authEpoch !== generation) return; session = result; render(); }
    else if (form.dataset.character) {
      if (local) send({ type: 'office-character-save', id: form.dataset.character, ...data });
      else { await api(`/characters/${encodeURIComponent(form.dataset.character)}`, 'POST', data); if (epoch !== generation || !session) return; notice(B.characterSaved); }
    } else if (form.id === 'invite-form') {
      const result = await api<{ token: string }>('/invites', 'POST', data);
      if (epoch !== generation || !session || !form.isConnected) return;
      const link = new URL(location.href); link.searchParams.delete('view'); link.searchParams.delete('theme'); link.hash = new URLSearchParams({ invite: result.token }).toString();
      root.querySelector('#invite-result')!.innerHTML = `<p>${B.inviteReady}</p><textarea readonly aria-label="${B.token}">${esc(link.href)}</textarea><button data-action="copy">${B.copy}</button>`; await refreshFriends();
    } else if (form.id === 'accept-form') {
      const result = await api<{ officeId: string }>('/accept', 'POST', { token: inviteCode(String(data.token)) });
      if (epoch !== generation || !session) return;
      invitation = ''; sessionStorage.removeItem('building.invitation'); notice(B.joined); await refreshFriends();
      if (epoch !== generation || !session) return;
      send({ type: 'office-visit-floor', id: result.officeId });
    } else if (form.id === 'name-form') { const result = await api<Session>('/office', 'POST', data); if (epoch !== generation || !session) return; session = result; notice(B.saved); }
  }).finally(() => { button.disabled = false; });
});
root.addEventListener('click', (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button'); if (!button) return;
  const epoch = generation;
  void run(async () => {
    if (button.dataset.characterSelect) { send({ type: 'office-character-select', id: button.dataset.characterSelect }); return; }
    if (button.dataset.tab) { tab = button.dataset.tab as typeof tab; render(); return; }
    if (button.dataset.floor) {
      const data = { type: button.dataset.own === 'true' ? 'office-own-floor' : 'office-visit-floor', id: button.dataset.floor };
      if (embedded) send(data); else { void travelToFloor(button.dataset.own === 'true' ? null : button.dataset.floor); }
      return;
    }
    if (button.dataset.delete) { await api(`/${button.dataset.delete}/${encodeURIComponent(button.dataset.id!)}`, 'DELETE'); if (epoch !== generation || !session) return; if (button.dataset.delete === 'publisher-tokens') await renderKeys(); else await refreshFriends(); return; }
    switch (button.dataset.action) {
      case 'building': if (embedded) send({ type: 'office-open-building' }); else location.assign('/?building=1'); break;
      case 'refresh-access': await refreshFriends(); break;
      case 'close': if (embedded) send({ type: 'office-menu-close' }); else location.assign('/'); break;
      case 'own': if (embedded) send({ type: 'office-own-floor' }); else void travelToFloor(null); break;
      case 'auth-mode': authMode = authMode === 'register' ? 'login' : 'register'; render(); break;
      case 'logout': if (sharing || pendingShare) { logoutPending = true; send({ type: 'office-share-stop' }); } else await logout(); break;
      case 'share': pendingShare = true; renderSharingState(); send({ type: sharing ? 'office-share-stop' : 'office-share-start' }); break;
      case 'create-key': {
        button.disabled = true;
        let key: { token: string };
        try { key = await api<{ token: string }>('/publisher-tokens', 'POST'); } finally { button.disabled = false; }
        if (epoch !== generation || !session || !button.isConnected) return;
        const result = root.querySelector('#key-result'); if (!result) return;
        result.innerHTML = `<p>${B.keyReady}</p><textarea readonly aria-label="${B.publisher}">${esc(key.token)}</textarea><button data-action="copy">${B.copyKey}</button>`; await renderKeys(); break;
      }
      case 'copy': {
        const area = button.parentElement!.querySelector('textarea')!;
        try { await navigator.clipboard.writeText(area.value); button.textContent = B.copied; } catch { area.focus(); area.select(); }
        break;
      }
    }
  });
});
window.addEventListener('message', (event) => {
  if (event.origin !== location.origin || event.source !== parent) return;
  const data = event.data;
  if (data?.type === 'office-appearance-state' && isAppearance(data.appearance)) { appearance = data.appearance; if (!appearanceReady && tab === 'style') render(); appearanceReady = true; }
  else if (data?.type === 'office-current-floor') { currentFloor = typeof data.id === 'string' ? data.id : null; }
  else if (data?.type === 'office-local-characters') { const changed = local !== data.local; local = data.local; localCharacters = data.characters; if (changed && tab === 'style') render(); if (tab === 'characters' && local) renderCharacters(localCharacters); }
  else if (data?.type === 'office-character-saved') { notice(B.characterSaved); }
  else if (data?.type === 'office-sharing-state') { sharing = data.sharing; pendingShare = !!data.pending; renderSharingState(); if (session && tab === 'sharing') void refreshFriends(); }
  else if (data?.type === 'office-sharing-stopped') { sharing = false; pendingShare = false; renderSharingState(); if (session && tab === 'sharing') void refreshFriends(); if (logoutPending) { logoutPending = false; void run(logout); } }
  else if (data?.type === 'office-menu-error') notice(data.message, true);
});
render(); send({ type: 'office-menu-ready' });
const initialGeneration = generation;
void (async () => { try { const result = await api<Session>('/session'); if (initialGeneration !== generation) return; session = result; render(); } catch (error) { if (initialGeneration === generation && !(error instanceof ApiError && error.status === 401)) notice(B.genericError, true); } })();
setInterval(() => { void refreshFriends(); }, 5000);

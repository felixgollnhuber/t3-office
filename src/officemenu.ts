import { readProfiles, saveProfile } from './character-profiles';
import { isCharacterStyle, cleanCharacterStyle } from './character-style';
import { isAppearance } from './appearance';
/** Optional friends/characters drawer layered over the original office. No account is required to use your own office. */
import { api, type Session, WORK_AREAS, type WorkArea } from './building-api';
import { B } from './i18n/building';
import type { AgentSource } from './source';
import { settings } from './settings';

export function installOfficeMenu(source: AgentSource, shared: boolean, selectCharacter?: (id: string) => void) {
  let profiles = readProfiles();
  const original = new Map<string, string>();
  const apply = () => {
    if (shared) return;
    for (const t of source.threads()) {
      if (!original.has(t.id)) original.set(t.id, t.name);
      const p = profiles[t.id];
      if (p && typeof p.name === 'string' && p.name.length <= 32) t.name = p.name;
      t.characterStyle = isCharacterStyle(p?.style) ? cleanCharacterStyle(p.style) : undefined;
      t.workArea = B.areaLabels[p && WORK_AREAS.includes(p.area) ? p.area : 'general'];
    }
  };
  apply();
  const profileTimer = setInterval(apply, 1000);
  const button = document.createElement('button');
  button.className = 'wx friends'; button.textContent = B.friendsMenu;
  button.setAttribute('aria-label', B.friendsMenu);
  document.querySelector('#hud .clock')!.append(button);
  const floating = button.cloneNode(true) as HTMLButtonElement;
  floating.className = 'office-friends-launcher';
  document.body.append(floating);
  if (shared) {
    const home = document.createElement('button'); home.className = 'office-home-launcher'; home.textContent = `← ${B.own}`;
    home.addEventListener('click', () => { const own = new URL(location.href); own.searchParams.delete('source'); own.searchParams.delete('floor'); location.assign(own); });
    document.body.append(home);
  }
  const dialog = document.createElement('dialog');
  dialog.className = 'office-friends-dialog';
  dialog.setAttribute('aria-label', B.friendsMenu);
  const frame = document.createElement('iframe');
  frame.title = B.friendsMenu;
  const url = new URL(location.href);
  url.search = '';
  url.searchParams.set('view', 'friends');
  url.searchParams.set('theme', settings.get('theme'));
  const invite = new URLSearchParams(location.hash.slice(1)).get('invite');
  if (invite) {
    url.hash = new URLSearchParams({ invite }).toString();
    history.replaceState(null, '', location.pathname + location.search);
  } else url.hash = '';
  frame.src = url.href;
  dialog.append(frame); document.body.append(dialog);
  button.addEventListener('click', () => dialog.showModal());
  floating.addEventListener('click', () => dialog.showModal());
  dialog.addEventListener('click', (event) => { if (event.target === dialog) dialog.close(); });
  const send = (data: unknown) => frame.contentWindow?.postMessage(data, location.origin);
  const localCharacters = () => source.threads().map((t) => ({ id: t.id, name: t.name, provider: t.provider, status: t.status, area: profiles[t.id]?.area ?? 'general', ...(t.characterStyle ? { style: t.characterStyle } : {}) }));
  let publishing: ReturnType<typeof setInterval> | undefined;
  let publishingBusy = false;
  let publisherGeneration = 0;
  let pending = false;
  let controls: Promise<void> = Promise.resolve();
  let ownerId = '';
  let salt = localStorage.getItem('office.publisher-salt.v1');
  if (!salt) { salt = crypto.randomUUID(); localStorage.setItem('office.publisher-salt.v1', salt); }
  const sentProfiles = new Map<string, string>();
  const publish = async () => {
    if (publishingBusy) return;
    publishingBusy = true;
    const generation = publisherGeneration;
    try {
      const session = await api<Session>('/session');
      if (generation !== publisherGeneration || session.user.id !== ownerId) return;
      const agents = await Promise.all(localCharacters().slice(0, 24).map(async (a) => {
        const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${salt}:${ownerId}:${a.id}`));
        const id = [...new Uint8Array(hash)].map((v) => v.toString(16).padStart(2, '0')).join('').slice(0, 32);
        return { ...a, id };
      }));
      if (generation !== publisherGeneration) return;
      await api('/publish', 'POST', { agents: agents.map(({ id, provider, status }) => ({ id, provider, status })) });
      for (const a of agents) {
        if (generation !== publisherGeneration) return;
        const profile = { name: a.name.slice(0, 32), area: a.area, ...(a.style ? { style: a.style } : {}) };
        const value = JSON.stringify(profile);
        if (sentProfiles.get(a.id) !== value) {
          await api(`/characters/${a.id}`, 'POST', profile);
          sentProfiles.set(a.id, value);
        }
      }
      if (generation !== publisherGeneration) return;
      send({ type: 'office-sharing-state', sharing: true, updatedAt: Date.now() });
    } catch (error) {
      if (generation !== publisherGeneration) return;
      clearInterval(publishing); publishing = undefined;
      send({ type: 'office-menu-error', message: error instanceof Error ? error.message : B.genericError });
      send({ type: 'office-sharing-state', sharing: false });
    } finally { publishingBusy = false; }
  };
  window.addEventListener('office-profile-change', () => { profiles = readProfiles(); apply(); if (publishing) void publish(); });
  window.addEventListener('message', (event) => {
    if (event.origin !== location.origin || event.source !== frame.contentWindow) return;
    const data = event.data;
    if (!data || typeof data !== 'object') return;
    if (data.type === 'office-menu-ready' || data.type === 'office-characters-request') {
      let appearance; try { appearance = JSON.parse(localStorage.getItem('office.appearance.v1') ?? 'null'); } catch { /* defaults */ }
      send({ type: 'office-appearance-state', appearance: { theme: settings.get('theme'), layout: isAppearance(appearance) ? appearance.layout : 'original', lighting: isAppearance(appearance) ? appearance.lighting : 'original' } });
      send({ type: 'office-current-floor', id: shared ? new URLSearchParams(location.search).get('floor') : null });
      apply(); send({ type: 'office-local-characters', characters: shared ? [] : localCharacters(), local: !shared });
      send({ type: 'office-sharing-state', sharing: !!publishing, pending });
    } else if (data.type === 'office-appearance-save' && !shared && isAppearance(data.appearance)) {
      localStorage.setItem('office.appearance.v1', JSON.stringify(data.appearance));
      if (settings.get('theme') !== data.appearance.theme) { settings.set('theme', data.appearance.theme); return; }
      const next = new URL(location.href); next.searchParams.delete('theme'); location.assign(next);
    } else if (data.type === 'office-character-select' && !shared && typeof data.id === 'string') {
      if (source.threads().some((t) => t.id === data.id)) { dialog.close(); selectCharacter?.(data.id); }
    } else if (data.type === 'office-character-save' && !shared) {
      const t = source.threads().find((t) => t.id === data.id);
      if (!t || typeof data.name !== 'string' || !data.name.trim() || data.name.length > 32 || !WORK_AREAS.includes(data.area)) return;
      saveProfile(t.id, { ...profiles[t.id], name: data.name.trim(), area: data.area }); apply();
      send({ type: 'office-character-saved', id: t.id });
      if (publishing) void publish();
    } else if (data.type === 'office-menu-close') dialog.close();
    else if (data.type === 'office-own-floor') {
      if (!shared) return dialog.close();
      const own = new URL(location.href); own.searchParams.delete('source'); own.searchParams.delete('floor'); location.assign(own);
    } else if (data.type === 'office-visit-floor' && typeof data.id === 'string' && /^[\w-]+$/.test(data.id)) {
      const visit = new URL(location.href); visit.searchParams.set('source', 'shared'); visit.searchParams.set('floor', data.id); location.assign(visit);
    } else if (data.type === 'office-share-start' && !shared) {
      const generation = ++publisherGeneration;
      pending = true;
      send({ type: 'office-sharing-state', sharing: !!publishing, pending: true });
      controls = controls.catch(() => {}).then(async () => {
        try {
          if (generation !== publisherGeneration) return;
          const session = await api<Session>('/session');
          if (generation !== publisherGeneration) return;
          ownerId = session.user.id; sentProfiles.clear();
          let storedAppearance; try { storedAppearance = JSON.parse(localStorage.getItem('office.appearance.v1') ?? 'null'); } catch { /* defaults */ }
          await api('/office', 'POST', { paused: false, appearance: { theme: settings.get('theme'), layout: isAppearance(storedAppearance) ? storedAppearance.layout : 'original', lighting: isAppearance(storedAppearance) ? storedAppearance.lighting : 'original' } });
          if (generation !== publisherGeneration) return;
          clearInterval(publishing);
          publishing = setInterval(() => { void publish(); }, 10_000);
          await publish();
        } catch (error) { if (generation === publisherGeneration) send({ type: 'office-menu-error', message: error instanceof Error ? error.message : B.genericError }); }
        finally { if (generation === publisherGeneration) { pending = false; send({ type: 'office-sharing-state', sharing: !!publishing, pending: false }); } }
      });
    } else if (data.type === 'office-share-stop') {
      publisherGeneration++; clearInterval(publishing); publishing = undefined;
      pending = false;
      // Serialize control writes: a delayed unpause must finish before the superseding pause.
      controls = controls.catch(() => {}).then(async () => {
        await api('/office', 'POST', { paused: true }); send({ type: 'office-sharing-stopped' });
      }).catch((error) => send({ type: 'office-menu-error', message: error.message }));
    }
  });
  window.addEventListener('pagehide', () => { publisherGeneration++; clearInterval(profileTimer); clearInterval(publishing); publishing = undefined; pending = false; });
  if (invite) dialog.showModal();
}

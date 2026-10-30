import { PixelPipeline } from './pixel';
import { THEMES, type Theme } from './themes';
import { toon } from './materials';
import { planks, carpetTiles, speckle, brick, plaster } from './textures';
import { createCharacter, type Character } from './character';
/** One interactive cutaway scene for the user's authorized building; no private office readers. */
import * as THREE from 'three';
import { api, ApiError, type Floor } from './building-api';
import { DEFAULT_APPEARANCE, isAppearance } from './appearance';
import { settings } from './settings';
import { B } from './i18n/building';
import { locale } from './i18n';
import { travelToFloor } from './elevator';
import './building-view.css';
const T = locale({ en: { title: 'The Building', floors: 'Floors', hint: 'Click a floor to focus. Drag to turn the building.', all: 'Whole building', close: 'Back to office', friends: 'Friends & invitations', enter: 'Enter this office', choose: 'Pick a floor', chooseHint: 'Every office is a place you can visit. Select one in the building or directory to look closer.', privacy: 'Only your office and floors shared with you appear here.', own: 'Your office', home: 'Home floor', presence: 'Presence only · interior private', active: 'Activity shared', offline: 'Offline', online: 'Online', agents: 'coworkers', loading: 'Opening your building…', error: 'Building unavailable. Floor details have been cleared.', retry: 'Try again', local: 'Your office works without an account. Invite friends from the in-office menu to add their floors.', focus: 'Floor focus', count: 'offices', limited: 'The 3D view shows a section of this tall building. Choose any office in the directory.', preview: 'Stylized office previews · no tasks or transcripts' }, de: { title: 'Das Gebäude', floors: 'Etagen', hint: 'Etage zum Fokussieren anklicken. Ziehen zum Drehen.', all: 'Ganzes Gebäude', close: 'Zurück zum Büro', friends: 'Freunde & Einladungen', enter: 'Dieses Büro betreten', choose: 'Wähle eine Etage', chooseHint: 'Wähle ein Büro im Gebäude oder Verzeichnis, um es näher anzusehen.', privacy: 'Nur dein Büro und mit dir geteilte Etagen erscheinen hier.', own: 'Dein Büro', home: 'Eigene Etage', presence: 'Nur Anwesenheit · Innenraum privat', active: 'Aktivität geteilt', offline: 'Offline', online: 'Online', agents: 'Kollegen', loading: 'Dein Gebäude wird geöffnet…', error: 'Gebäude nicht verfügbar. Etageninformationen wurden entfernt.', retry: 'Erneut versuchen', local: 'Dein Büro funktioniert ohne Konto. Lade über das Büromenü Freunde ein, um ihre Etagen hinzuzufügen.', focus: 'Etagenansicht', count: 'Büros', limited: 'Die 3D-Ansicht zeigt einen Abschnitt dieses hohen Gebäudes. Wähle jedes Büro im Verzeichnis.', preview: 'Stilisierte Büroansichten · keine Aufgaben oder Gespräche' } });
const esc = (v: string) => v.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
let closeCurrent: (() => void) | undefined;
export interface BuildingRenderHost {
  canvas: HTMLCanvasElement;
  theme: Theme;
  render(scene: THREE.Scene, camera: THREE.Camera): void;
  sync(scene: THREE.Scene, sun: THREE.DirectionalLight, hemi: THREE.HemisphereLight): void;
}
export async function openBuildingView(openFriends: () => void, host?: BuildingRenderHost) {
  if (closeCurrent) return;
  const previous = document.activeElement as HTMLElement | null;
  const root = document.createElement('section'); root.className = 'building-world'; root.setAttribute('role', 'dialog'); root.setAttribute('aria-modal', 'true'); root.setAttribute('aria-label', T.title);
  root.innerHTML = `<header><div><small>T3 OFFICE</small><h1>${T.title}</h1><p>${T.hint}</p></div><nav><button data-action="all">${T.all}</button><button data-action="directory">${T.floors}</button><button data-action="close">${T.close} ×</button></nav></header><div class="building-world-stage"><canvas aria-label="${T.title}"></canvas><div class="building-world-labels"></div><p class="building-world-caption">${T.preview}</p></div><aside><p class="building-world-status" role="status" aria-live="polite">${T.loading}</p><div class="building-world-detail"></div><h2>${T.all}</h2><p class="building-world-privacy">${T.privacy}</p><div class="building-world-directory"></div><button class="building-world-invite" data-action="friends">${T.friends}</button></aside>`;
  document.body.append(root); document.body.classList.add('building-view-open');
  let closed = false; let raf = 0; let poll: ReturnType<typeof setInterval> | undefined;
  let floors: Floor[] = []; let selected: string | null = null; let busy = false; let signature = ''; let windowStart = 0;
  const stage = root.querySelector<HTMLElement>('.building-world-stage')!; let canvas = root.querySelector('canvas')!;
  const canvasMarker = host ? document.createComment('office canvas') : undefined;
  const hudMarker = host && document.querySelector('#hud') ? document.createComment('office HUD') : undefined;
  const originalHud = host ? document.querySelector<HTMLElement>('#hud') : null;
  if (host && canvasMarker) { host.canvas.before(canvasMarker); canvas.replaceWith(host.canvas); canvas = host.canvas; root.dataset.sharedCanvas = 'true'; }
  if (originalHud && hudMarker) { originalHud.before(hudMarker); root.append(originalHud); }
  const status = root.querySelector<HTMLElement>('.building-world-status')!;
  const labelLayer = root.querySelector<HTMLElement>('.building-world-labels')!;
  const directory = root.querySelector<HTMLElement>('.building-world-directory')!;
  const detail = root.querySelector<HTMLElement>('.building-world-detail')!;
  const theme = host?.theme ?? THEMES.find(t => t.id === settings.get('theme')) ?? THEMES[0];
  for (const [key, value] of Object.entries({ paper: theme.hud.paper, ink: theme.hud.ink, muted: theme.hud.muted, edge: theme.hud.edge, shadow: theme.hud.shadow, font: theme.hud.font, accent: theme.hud.accent, 'tag-bg': theme.hud.tagBg, 'tag-ink': theme.hud.tagInk })) root.style.setProperty(`--${key}`, value);
  const scene = new THREE.Scene(); scene.background = new THREE.Color(theme.bg);
  const camera = new THREE.OrthographicCamera(-15, 15, 15, -15, .1, 200);
  const fallback = host ? undefined : new PixelPipeline(canvas, 2, theme.post);
  const hemi = new THREE.HemisphereLight(theme.lights.sky, theme.lights.ground, theme.lights.hemi); scene.add(hemi);
  const sun = new THREE.DirectionalLight(theme.lights.sun, theme.lights.sunIntensity); sun.position.set(...theme.lights.sunDir).multiplyScalar(40); sun.castShadow = true; sun.shadow.mapSize.set(1024, 1024); Object.assign(sun.shadow.camera, { left: -30, right: 30, top: 40, bottom: -40, near: 1, far: 120 }); sun.shadow.bias = -.0004; sun.shadow.normalBias = .03; scene.add(sun);
  const unit = new THREE.BoxGeometry(1, 1, 1); const leaves = new THREE.IcosahedronGeometry(1, 0); const edges = new THREE.EdgesGeometry(unit);
  const materials = new Map<string, THREE.MeshToonMaterial>();
  const textured = new Map<string, THREE.MeshToonMaterial>();
  const figures: Character[] = [];
  const figureGeometries = new Set<THREE.BufferGeometry>();
  const mat = (color: string) => { let m = materials.get(color); if (!m) { m = toon(color); materials.set(color, m); } return m; };
  const surface = (f: Floor, wall: boolean) => {
    const chosen = THEMES.find(t => t.id === f.appearance?.theme) ?? theme;
    const key = `${chosen.id}:${wall}`;
    let m = textured.get(key);
    if (!m) {
      const p = chosen.floor; const w = chosen.wall;
      const map = wall ? w.kind === 'brick' ? brick(w.a, w.b) : plaster(w.a) : p.kind === 'planks' ? planks(p.a, p.b) : p.kind === 'carpet' ? carpetTiles(p.a, p.b) : speckle(p.a);
      map.wrapS = map.wrapT = THREE.RepeatWrapping; map.repeat.set(wall ? 3 : 4, wall ? 1 : 2);
      m = toon('#ffffff', { map }); textured.set(key, m);
    }
    return m;
  };
  const box = (parent: THREE.Object3D, color: string, x: number, y: number, z: number, w: number, h: number, d: number) => { const mesh = new THREE.Mesh(unit, mat(color)); mesh.position.set(x, y, z); mesh.scale.set(w, h, d); mesh.castShadow = mesh.receiveShadow = true; parent.add(mesh); return mesh; };
  const models = new THREE.Group(); scene.add(models);
  const rings = new Map<string, THREE.LineSegments>(); const rowY = new Map<string, number>();
  const ringMaterial = new THREE.LineBasicMaterial({ color: '#ffda83' });
  const target = new THREE.Vector3(0, 4, 0); const wanted = target.clone(); let half = 12; let wantedHalf = 12; let zoom = 1; let yaw = .5; let goalYaw = .5;
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  let width = 1, height = 1; let cabin: THREE.Mesh | undefined; let cabinTarget = 1.4;
  const resize = () => { width = Math.max(1, stage.clientWidth); height = Math.max(1, stage.clientHeight); fallback?.setSize(width, height); };
  const observer = new ResizeObserver(resize); observer.observe(stage); resize();
  const palette = (f: Floor) => { const chosen = THEMES.find(t => t.id === f.appearance?.theme) ?? theme; return [chosen.floor.a, chosen.wall.a, chosen.desk.top, chosen.desk.chair]; };
  function paintSelection() {
    for (const object of models.children) object.visible = !selected || object.userData.floorId === selected;
    for (const [id, ring] of rings) ring.visible = id === selected;
    root.dataset.selectedFloor = selected ?? '';
    root.dataset.controlsOpen = String(!!selected || root.dataset.directoryOpen === 'true');
    for (const b of root.querySelectorAll<HTMLElement>('[data-floor]')) b.setAttribute('aria-pressed', String(b.dataset.floor === selected));
    const f = floors.find(f => f.id === selected);
    detail.innerHTML = f ? `<small>${T.focus}</small><h2>${esc(f.name)}</h2><p>${esc(f.ownerName)}</p><p>${f.online ? T.online : T.offline} · ${f.scope === 'presence' ? T.presence : T.active}</p>${f.scope !== 'presence' ? `<p>${f.agentCount} ${T.agents}</p><p>${f.areas.map(a => `${B.areaLabels[a.area]} (${a.count})`).join(' · ')}</p>` : ''}<button class="building-world-enter" data-action="enter">${f.isOwner ? B.own : T.enter}</button>` : `<h2>${T.choose}</h2><p>${T.chooseHint}</p>`;
  }
  function fit(resetDirectory: boolean | Event = true) {
    if (resetDirectory !== false) root.dataset.directoryOpen = 'false';
    selected = null; zoom = 1; wanted.set(0, Math.max(.5, (rowY.size * 3.4 - 3.6) / 2), 0);
    wantedHalf = Math.max(8.5, rowY.size * 3.4 / 2 + 5, 10.5 / Math.max(.5, width / height));
    cabinTarget = rowY.get(floors.find(f => f.isOwner)?.id ?? '') ?? 0;
    paintSelection();
  }
  function select(id: string, resetScroll = true) {
    const index = floors.findIndex(f => f.id === id); if (index < 0) return;
    if (!rowY.has(id)) { windowStart = Math.max(0, index - 10); build(); }
    selected = id; zoom = 1; wanted.set(.6, (rowY.get(id) ?? 0) + 1.3, 0); wantedHalf = Math.max(2.7, 4.5 / Math.max(1, width / height));
    if (width < 700) wanted.y -= wantedHalf * .6;
    cabinTarget = rowY.get(id) ?? 0; paintSelection(); if (resetScroll) root.querySelector('aside')!.scrollTop = 0;
  }
  function build() {
    models.clear(); figureGeometries.forEach(g => g.dispose()); figureGeometries.clear(); figures.length = 0; rings.clear(); rowY.clear(); labelLayer.replaceChildren();
    const shown = floors.slice(windowStart, windowStart + 24); const total = shown.length * 3.4;
    box(models, theme.slab, 0, -3.6, 0, 36, .6, 25);
    box(models, '#839188', 0, -3.15, 0, 16, .3, 10);
    box(models, '#485851', 0, -1.65, -2.2, 13, 3, 2);
    box(models, '#b3c4ac', 0, -.2, 0, 14, .35, 8);
    // Lobby entrance and a pair of trees anchor the whole building to the street.
    box(models, '#acc1bd', 0, -1.8, -.9, 2.5, 2.5, .15);
    for (const x of [-10, 10]) { box(models, '#705a45', x, -2.7, 1, .4, 1.8, .4); const tree = new THREE.Mesh(leaves, mat('#597f5a')); tree.position.set(x, -1.1, 1); tree.scale.set(1.4, 1.8, 1.4); models.add(tree); }
    shown.forEach((f, i) => {
      const y = i * 3.4; rowY.set(f.id, y);
      const group = new THREE.Group(); group.position.y = y; group.userData.floorId = f.id; models.add(group);
      const [floor, wall, desk, chair] = palette(f);
      box(group, '#c3c6b5', 0, 0, 0, 14, .28, 8);
      if (f.scope === 'presence') box(group, '#344d58', 0, 1.5, 0, 13, 2.8, 7);
      else {
        box(group, floor, 0, .2, 0, 13, .15, 7).material = surface(f, false);
        box(group, wall, 0, 1.55, -3.45, 13, 2.7, .18).material = surface(f, true); box(group, wall, -6.45, 1.55, 0, .18, 2.7, 7).material = surface(f, true);
        for (const x of [-4.2, 0, 4.2]) {
          box(group, '#cce3d5', x, 1.9, -3.32, 2.2, 1.2, .12);
          box(group, '#567273', x, 1.9, -3.2, .06, 1.3, .1);
        }
        const roomTheme = THEMES.find(t => t.id === f.appearance?.theme) ?? theme;
        const lampColor = f.appearance?.lighting === 'cool' ? '#b6deff' : f.appearance?.lighting === 'warm' ? '#ffc080' : roomTheme.lights.lamp;
        const lamp = new THREE.PointLight(lampColor, Math.min(5, Math.max(2, roomTheme.lights.lampIntensity)), 13, 1.6); lamp.position.set(0, 2.6, 0); group.add(lamp);
        box(group, '#ffe6b6', 0, 2.9, 0, 1.8, .08, .65);
        const seats = f.appearance?.layout === 'lounge' ? 4 : 6;
        for (let n = 0; n < seats; n++) {
          const x = [-4.2, 0, 4.2][n % 3]; const z = n < 3 ? -1.2 : 1.9;
          box(group, desk, x, .95, z, 2.2, .18, 1.1); box(group, '#39474b', x, .6, z, .15, .7, .15);
          box(group, '#253d44', x, 1.42, z - .15, .8, .65, .18); box(group, f.online ? '#a5d3b9' : '#52686c', x, 1.42, z - .03, .65, .48, .02);
          box(group, chair, x, .65, z + .9, .75, 1, .3);
          if (f.online && n < Math.min(f.agentCount, seats)) {
            const ch = createCharacter({ skin: '#eab894', hair: ['#2a1e1a', '#c58b4a', '#4a2f22'][n % 3], hairStyle: ['short', 'bun', 'curly'][n % 3] as 'short' | 'bun' | 'curly', shirt: chair, shirtTrim: desk, pants: '#2d3550', shoes: '#2a2428', outfit: n % 2 ? 'hoodie' : 'tee' }, .95);
            ch.root.position.set(x, .35, z + .65); ch.root.rotation.y = Math.PI; ch.setPose('typing', n); group.add(ch.root); figures.push(ch);
            ch.root.traverse(o => { if (o instanceof THREE.Mesh) figureGeometries.add(o.geometry); });
          }
        }
        if (f.appearance?.layout === 'lounge') { box(group, '#a37388', 2.8, .7, 2.3, 4, .8, 1); box(group, '#a37388', 2.8, 1.2, 2.75, 4, .75, .25); }
        for (const x of [-5.8, 5.8]) { box(group, '#bf9575', x, .5, -2.7, .55, .6, .55); const plant = new THREE.Mesh(leaves, mat('#527f59')); plant.position.set(x, 1.2, -2.7); plant.scale.set(.6, .8, .6); group.add(plant); }
      }
      box(group, f.online ? '#8dcba4' : '#bdac83', 0, .38, 3.95, 13, .12, .15);
      const ring = new THREE.LineSegments(edges, ringMaterial); ring.scale.set(14.2, 3.15, 8.2); ring.position.y = 1.4; ring.visible = false; group.add(ring); rings.set(f.id, ring);
      const label = document.createElement('button'); label.dataset.floor = f.id; label.textContent = f.isOwner ? `${T.home} · ${f.name}` : `${windowStart + i + 1} · ${f.name}`; labelLayer.append(label);
    });
    // Cutaway roof leaves the front of the top office visible.
    box(models, '#899a8c', 0, total - .1, -2.7, 14, .4, 2.6); box(models, '#657b75', -3, total + .4, -2.7, 2, .7, 1.2);
    box(models, '#3d5459', 7.3, total / 2 - 1.2, -1.4, 1.2, total + 3.2, 5);
    box(models, '#90ada5', 7.95, total / 2 - 1.2, 1.15, .16, total + 3.2, .16);
    cabin = box(models, '#d9bd7f', 7.35, cabinTarget + 1.3, 1.15, 1, 2.4, .3);
    box(models, '#4a625d', 7.35, total + .25, -.5, 1.5, .4, 5.7);
    directory.innerHTML = [...floors].reverse().map((f, n) => `<button data-floor="${esc(f.id)}"><span>${f.isOwner ? T.home : floors.length - n}</span><div><b>${esc(f.name)}</b><small>${f.online ? T.online : T.offline}${f.scope === 'presence' ? ` · ${T.presence}` : ''}</small></div></button>`).join('');
    fit(false);
  }
  async function refresh() {
    if (busy || closed) return; busy = true;
    try {
      let next: Floor[]; let anonymous = false;
      try { next = (await api<{ floors: Floor[] }>('/floors')).floors; }
      catch (e) {
        if (!(e instanceof ApiError && e.status === 401)) throw e;
        anonymous = true; let appearance = { ...DEFAULT_APPEARANCE, theme: settings.get('theme') };
        try { const local = JSON.parse(localStorage.getItem('office.appearance.v1') ?? 'null'); if (isAppearance(local)) appearance = { ...local, theme: settings.get('theme') }; } catch { /* defaults */ }
        next = [{ id: 'local-own', name: T.own, ownerName: T.own, isOwner: true, scope: 'owner', online: false, agentCount: 0, updatedAt: null, areas: [], appearance }];
      }
      if (closed) return;
      floors = next;
      const nextSignature = JSON.stringify(next.map(({ updatedAt: _, ...f }) => f));
      status.textContent = anonymous ? T.local : `${next.length} ${T.count}${next.length > 24 ? ` · ${T.limited}` : ''}`;
      canvas.hidden = false; labelLayer.hidden = false;
      if (signature !== nextSignature) { const keep = selected; signature = nextSignature; if (windowStart >= next.length) windowStart = 0; build(); if (keep && next.some(f => f.id === keep)) select(keep, false); }

    } catch { if (!closed) { models.clear(); rings.clear(); floors = []; selected = null; signature = ''; canvas.hidden = true; labelLayer.replaceChildren(); directory.innerHTML = `<button data-action="retry">${T.retry}</button>`; detail.replaceChildren(); status.textContent = T.error; root.dataset.controlsOpen = 'true'; root.dataset.directoryOpen = 'true'; } }
    finally { busy = false; }
  }
  function close() {
    if (closed) return; closed = true; closeCurrent = undefined; cancelAnimationFrame(raf); clearInterval(poll); observer.disconnect();
    window.removeEventListener('office-elevator-move', moveCabin); window.removeEventListener('office-building-close', close); window.removeEventListener('pagehide', close); window.removeEventListener('office-departure', fit);
    fallback?.dispose(); sun.shadow.map?.dispose(); unit.dispose(); leaves.dispose(); edges.dispose(); ringMaterial.dispose(); figureGeometries.forEach(g => g.dispose()); textured.forEach(m => { m.map?.dispose(); m.dispose(); });
    // Cached toon materials and the host canvas/pipeline belong to the original office.
    canvas.hidden = false;
    if (canvasMarker) { canvasMarker.replaceWith(canvas); }
    if (originalHud && hudMarker) hudMarker.replaceWith(originalHud);
    if (import.meta.env.DEV) delete (window as unknown as { __buildingView?: unknown }).__buildingView;
    root.remove(); document.body.classList.remove('building-view-open'); previous?.focus();
  }
  if (import.meta.env.DEV) (window as unknown as { __buildingView: unknown }).__buildingView = { camera, models, selected: () => selected };
  const moveCabin = (event: Event) => { const id = (event as CustomEvent<string>).detail; if (rowY.has(id)) cabinTarget = rowY.get(id)!; };
  window.addEventListener('office-elevator-move', moveCabin);
  closeCurrent = close; window.addEventListener('office-building-close', close); window.addEventListener('pagehide', close, { once: true }); window.addEventListener('office-departure', fit);
  root.addEventListener('click', event => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button'); if (!button) return;
    if (button.dataset.floor) return select(button.dataset.floor);
    const action = button.dataset.action;
    if (action === 'close') close(); else if (action === 'all') fit(); else if (action === 'directory') { root.dataset.directoryOpen = String(root.dataset.directoryOpen !== 'true'); paintSelection(); } else if (action === 'retry') void refresh();
    else if (action === 'friends') { close(); openFriends(); }
    else if (action === 'enter') { const f = floors.find(f => f.id === selected); if (!f) return; if (f.id === 'local-own' || (f.isOwner && new URLSearchParams(location.search).get('source') !== 'shared')) close(); else void travelToFloor(f.isOwner ? null : f.id); }
  });
  root.addEventListener('keydown', event => { event.stopPropagation(); if (event.key === 'Escape') { event.preventDefault(); selected ? fit() : close(); } if (event.key === 'Tab') { const buttons = [...root.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], input:not([disabled]), select, textarea, [tabindex="0"]')].filter(b => b.offsetParent !== null && getComputedStyle(b).visibility !== 'hidden'); const i = buttons.indexOf(document.activeElement as HTMLButtonElement); if (event.shiftKey && i <= 0) { event.preventDefault(); buttons.at(-1)?.focus(); } else if (!event.shiftKey && i === buttons.length - 1) { event.preventDefault(); buttons[0]?.focus(); } } });
  for (const kind of ['pointerdown', 'pointerup', 'pointermove', 'wheel']) root.addEventListener(kind, e => e.stopPropagation());
  const ray = new THREE.Raycaster(); let drag: { x: number; y: number; yaw: number; moved: boolean } | undefined;
  stage.addEventListener('pointerdown', e => { if ((e.target as HTMLElement).closest('button')) return; drag = { x: e.clientX, y: e.clientY, yaw: goalYaw, moved: false }; canvas.setPointerCapture(e.pointerId); });
  stage.addEventListener('pointermove', e => { if (!drag) return; if (Math.abs(e.clientX - drag.x) > 5) drag.moved = true; if (drag.moved) goalYaw = THREE.MathUtils.clamp(drag.yaw + (e.clientX - drag.x) * .005, -.9, 1.1); });
  stage.addEventListener('pointerup', e => { const click = drag && !drag.moved; drag = undefined; if (!click) return; const r = canvas.getBoundingClientRect(); ray.setFromCamera(new THREE.Vector2((e.clientX - r.left) / r.width * 2 - 1, -(e.clientY - r.top) / r.height * 2 + 1), camera); for (const hit of ray.intersectObjects(models.children, true)) { let o: THREE.Object3D | null = hit.object; while (o && !o.userData.floorId) o = o.parent; if (o?.userData.floorId) { select(o.userData.floorId); break; } } });
  stage.addEventListener('wheel', e => { e.preventDefault(); zoom = THREE.MathUtils.clamp(zoom + Math.sign(e.deltaY) * .08, .65, 1.6); }, { passive: false });
  let last = performance.now(); let rendered = 0;
  function loop(now: number) {
    if (closed) return; raf = requestAnimationFrame(loop); if (now - rendered < 30) return; rendered = now;
    const dt = Math.min(.05, (now - last) / 1000); last = now; const k = motion.matches ? 1 : 1 - Math.exp(-dt * 6);
    target.lerp(wanted, k); half += (wantedHalf * zoom - half) * k; yaw += (goalYaw - yaw) * k;
    camera.position.set(target.x + Math.sin(yaw) * 35, target.y + 16, target.z + Math.cos(yaw) * 35); camera.lookAt(target);
    camera.left = -half * width / height; camera.right = half * width / height; camera.top = half; camera.bottom = -half; camera.updateProjectionMatrix(); camera.updateMatrixWorld();
    if (cabin) cabin.position.y += (cabinTarget + 1.3 - cabin.position.y) * k;
    host?.sync(scene, sun, hemi);
    figures.forEach((ch, i) => ch.setPose('typing', motion.matches ? 0 : now / 1000 + i));
    if (host) host.render(scene, camera); else fallback!.render(scene, camera);
    for (const label of labelLayer.querySelectorAll<HTMLElement>('button')) { const y = rowY.get(label.dataset.floor!) ?? 0; const p = new THREE.Vector3(host ? 0 : -6.8, y + 1.6, 3.9).project(camera); label.style.left = `${Math.max(10, Math.min(width - 150, (p.x + 1) / 2 * width - (host ? 70 : 130)))}px`; label.style.top = `${(1 - p.y) / 2 * height}px`; label.hidden = (!!selected && selected !== label.dataset.floor) || p.y < -.94 || p.y > .94; }
    root.dataset.rendered = 'true';
  }
  raf = requestAnimationFrame(loop); root.querySelector<HTMLButtonElement>('[data-action=close]')!.focus();
  await refresh(); if (!closed) poll = setInterval(() => { void refresh(); }, 5000);
}

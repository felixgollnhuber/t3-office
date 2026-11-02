/** Isolated, loopback-only two-player demonstration. Never uses real T3 data or accounts. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const checking = process.argv.includes('--check');
const browserCheck = process.argv.includes('--check-browser');
const tourCheck = process.argv.includes('--check-tour');
const index = process.argv.indexOf('--port');
const port = checking || browserCheck || tourCheck ? 0 : index < 0 ? 5175 : Number(process.argv[index + 1]);
if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Choose a valid local port.');
const directory = await mkdtemp(join(tmpdir(), 'office-friend-preview-'));
process.env.BUILDING_DB = join(directory, 'demo.sqlite');
delete process.env.T3_LOCAL_DATA;
const { createServer } = await import('vite');
let visitorCookie = '';
let floorId = '';
let interval;
let browser;
let stopping = false;
let peopleDemo=false;let preparePeople=async()=>{};let tickPeople=async()=>{};
let doorbellDemo = false;
let prepareDoorbell = async () => {};
const banner = `<script type="module">
import { travelToFloor } from "/src/elevator.ts";
if (window === parent) {
 const bar = document.createElement('aside'); bar.id = 'friend-preview-banner';
 bar.style.cssText = 'position:fixed;bottom:12px;left:50%;transform:translateX(-50%);z-index:9990;background:#f8f3de;color:#263a34;border:2px solid #263a34;padding:10px 14px;font:14px monospace;max-width:94vw;box-sizing:border-box;display:flex;gap:12px;flex-wrap:wrap;justify-content:center';
 const label = document.createElement('span'); label.textContent = location.search.includes('source=shared') ? 'SIMULATION · Visiting Maya’s office' : 'SIMULATION · Your office · no real activity';
 const visit = document.createElement('a'); visit.href='/preview/visit'; visit.textContent='Visit Maya';
 const tour = document.createElement('a'); tour.href='/preview/tour'; tour.textContent='30-second tour';
 const bell = document.createElement('a'); bell.href='/preview/doorbell'; bell.textContent='Simulate a doorbell';
 if(new URLSearchParams(location.search).has('doorbell'))label.textContent='SIMULATION · Maya automatically accepts demo rings';
 const people=document.createElement('a');people.href='/preview/people';people.textContent='Meet simulated Maya';
 if(new URLSearchParams(location.search).has('people'))label.textContent='SIMULATION · Maya is a scripted human visitor, not a real person';
 const home = document.createElement('a'); home.href='/preview/start'; home.textContent='Your demo office';
 visit.addEventListener('click', event => { event.preventDefault(); void travelToFloor(__DEMO_FLOOR__); });
 home.addEventListener('click', event => { event.preventDefault(); void travelToFloor(null); });
 for (const a of [visit,home,tour,bell,people]) a.style.color='#263a34';
 const tools=document.createElement('details'); const summary=document.createElement('summary');summary.textContent='Demo shortcuts';tools.append(summary,visit,home,tour,bell,people);bar.append(label,tools); document.body.append(bar);
}
</script>`;
const server = await createServer({
  root: fileURLToPath(new URL('..', import.meta.url)),
  server: { host: '127.0.0.1', port, strictPort: true }, logLevel: 'error',
  plugins: [{ name: 'isolated-friend-preview', enforce: 'pre',
    transformIndexHtml(html) { return html.replace("if (location.hostname === '127.0.0.1')", 'if (false)').replace('</body>', `${banner.replace('__DEMO_FLOOR__', JSON.stringify(floorId))}</body>`); },
    configureServer(s) { s.middlewares.use((req, res, next) => {
      if (req.headers.host?.split(':')[0] !== '127.0.0.1') {
        const address = s.httpServer.address();
        res.statusCode = 302; res.setHeader('Location', `http://127.0.0.1:${address.port}${req.url?.startsWith('/') ? req.url : '/'}`); res.end(); return;
      }
      const path = (req.url ?? '').split('?')[0];
      if (!['/preview/start', '/preview/visit', '/preview/building', '/preview/tour', '/preview/doorbell','/preview/people'].includes(path)) return next();
      if (req.method !== 'GET') { res.statusCode = 405; res.end(); return; }
      res.setHeader('Cache-Control', 'no-store');
      if (!visitorCookie) { res.statusCode = 503; res.end('Preparing synthetic building…'); return; }
      if(path==='/preview/people'){void preparePeople().then(()=>{res.setHeader('Set-Cookie',`${visitorCookie}; Path=/; HttpOnly; SameSite=Strict`);res.statusCode=302;res.setHeader('Location',`/?source=shared&floor=${floorId}&weather=clear&people=1`);res.end();}).catch(()=>{res.statusCode=503;res.end('Preparing simulated human office…');});return;}
      if(path==='/preview/doorbell'){void prepareDoorbell().then(()=>{res.setHeader('Set-Cookie',`${visitorCookie}; Path=/; HttpOnly; SameSite=Strict`);res.statusCode=302;res.setHeader('Location','/?source=demo&agents=6&weather=clear&doorbell=1');res.end();}).catch(()=>{res.statusCode=503;res.end('Synthetic doorbell unavailable.');});return;}
      // Automatic sign-in is deliberately confined to this disposable demo server.
      res.setHeader('Set-Cookie', `${visitorCookie}; Path=/; HttpOnly; SameSite=Strict`);
      res.statusCode = 302;
      res.setHeader('Location', path === '/preview/tour' ? '/?source=demo&agents=6&weather=clear&tour=1' : path === '/preview/visit' ? `/?source=shared&floor=${floorId}&weather=clear&agents=6` : path === '/preview/building' ? '/?source=demo&agents=6&weather=clear&building=1' : '/?source=demo&agents=6&weather=clear');
      res.end();
    }); },
  }],
});
async function stop() {
  if (stopping) return;
  stopping = true; clearInterval(interval);
  await browser?.close(); await server.close();
  await rm(directory, { recursive: true, force: true });
}
process.once('SIGINT', () => { void stop(); });
process.once('SIGTERM', () => { void stop(); });
try {
  await server.listen();
  const base = server.resolvedUrls.local[0];
  const call = async (path, body, cookie = '', method = body === undefined ? 'GET' : 'POST') => {
    const res = await fetch(`${base}api/building${path}`, { method, headers: { ...(cookie ? { Cookie: cookie } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, body: body === undefined ? undefined : JSON.stringify(body) });
    const data = await res.json();
    if (!res.ok) throw new Error(`${path}: ${res.status} ${data.error}`);
    return { data, cookie: res.headers.get('set-cookie')?.split(';')[0] ?? cookie };
  };
  const create = (handle, name) => call('/register', { handle, name, password: randomUUID() });
  const friend = await create('maya_demo', 'Maya (simulated)');
  const visitor = await create('you_demo', 'You (simulated)');
  visitorCookie = visitor.cookie; floorId = friend.data.office.id;
  await call('/office', { name: 'Maya’s creative studio · simulation', appearance: { theme: 'loft', layout: 'lounge', lighting: 'warm',identity:{accent:'amber',emblem:'star',slots:{west:'plant',center:'books',east:'lamp'}} } }, friend.cookie);
  await call('/office', { name: 'Your demo office' }, visitor.cookie);
  const invite = await call('/invites', { scope: 'activity' }, friend.cookie);
  await call('/accept', { token: invite.data.token }, visitor.cookie);
  // Demo-only reciprocal consent lets the simulated friend receive the visitor's manual moments.
  const reciprocal = await call('/invites', { scope: 'activity' }, visitor.cookie);
  await call('/accept', { token: reciprocal.data.token }, friend.cookie);
  await call('/focus', { minutes: 25, quiet: true }, friend.cookie);
  await call('/moments', { title: 'Our first shared office is ready · simulation', kind: 'milestone' }, friend.cookie);
  prepareDoorbell = async () => { await call('/doorbell/settings',{enabled:true,dnd:false},friend.cookie);const social=await call('/social',undefined,friend.cookie);if(!social.data.sessions.some(s=>s.isHost))await call('/focus',{minutes:25,quiet:true},friend.cookie);doorbellDemo=true; };
  let humanLease='',humanStep=0;const replied=new Set();
  preparePeople=async()=>{await call('/human',{name:'Maya · simulated human',color:'rose',hair:'long',availability:'available'},friend.cookie);await call(`/rooms/${floorId}/settings`,{open:true,dnd:false},friend.cookie);const joined=await call(`/rooms/${floorId}/enter`,{},friend.cookie);humanLease=joined.data.lease;peopleDemo=true;};
  tickPeople=async()=>{
    if(!peopleDemo)return;
    const pending=(await call(`/rooms/${floorId}/requests`,undefined,friend.cookie)).data.requests;
    for(const r of pending)await call(`/rooms/${floorId}/requests/${r.id}/accept`,{},friend.cookie).catch(()=>{});
    const points=[{x:0,z:7},{x:-1,z:6.5},{x:-2,z:7},{x:-1,z:7.5}];const p=points[humanStep++%points.length];
    try{await call(`/rooms/${floorId}/presence`,{lease:humanLease,...p},friend.cookie);}catch{humanLease=(await call(`/rooms/${floorId}/enter`,{},friend.cookie)).data.lease;}
    const state=(await call(`/rooms/${floorId}/state`,undefined,friend.cookie)).data;
    const incoming=state.messages.find(m=>m.userId!==friend.data.user.id&&!replied.has(m.id));
    if(incoming){await call(`/rooms/${floorId}/messages`,{lease:humanLease,text:'Hi! I am Maya’s simulated human avatar. Your message arrived.',clientId:randomUUID()},friend.cookie);replied.add(incoming.id);}
  };
  const names = ['Nova', 'Pixel', 'Echo', 'Atlas', 'Quinn', 'Rui', 'Sage', 'Orbit'];
  const areas = ['design', 'design', 'frontend', 'frontend', 'backend', 'backend', 'testing', 'research'];
  const statuses = ['running', 'running', 'waiting', 'idle'];
  let step = 0;
  const publish = () => call('/publish', { agents: names.map((_, i) => ({ id: `demo-agent-${i}`, provider: i % 2 ? 'claude' : 'codex', status: statuses[(i + step) % statuses.length] })) }, friend.cookie);
  await publish();
  for (const [i, name] of names.entries()) await call(`/characters/demo-agent-${i}`, { name, area: areas[i] }, friend.cookie);
  if (checking || browserCheck || tourCheck) {
    const headers = { Cookie: visitorCookie };
    const before = await call(`/offices/${floorId}`, undefined, visitorCookie);
    assert.equal(before.data.agents.length, 8);
    assert.equal(before.data.office.appearance.layout, 'lounge');
    step++; await publish();
    const after = await call(`/offices/${floorId}`, undefined, visitorCookie);
    assert.ok(after.data.agents.some((agent, i) => agent.status !== before.data.agents[i].status));
    assert.equal(after.data.agents[0].name, 'Nova');
    assert.equal((await fetch(`${base}api/building/offices/${floorId}`)).status, 401);
    assert.equal((await fetch(`${base}api/t3/status`, { headers })).status, 404);
    const alternate = new URL(base); alternate.hostname = 'localhost';
    const redirected = await fetch(`${alternate}preview/start`, { redirect: 'manual' });
    assert.equal(redirected.headers.has('set-cookie'), false);
    assert.ok(redirected.headers.get('location').startsWith('http://127.0.0.1:'));
    const entry = await fetch(`${base}preview/start`, { redirect: 'manual' });
    assert.equal(entry.status, 302); assert.ok(entry.headers.get('set-cookie')?.includes('HttpOnly'));
    const floors = await call('/floors', undefined, visitorCookie); assert.equal(floors.data.floors.length, 2);
    if (browserCheck) {
      const { chromium } = await import('playwright');
      browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-webgl'] });
      const page = await browser.newPage({ viewport: { width: 1100, height: 760 } });
      const errors = []; page.on('pageerror', (e) => errors.push(e.message));
      await page.goto(`${base}preview/visit`);
      await page.waitForFunction(() => window.__source?.threads().length === 8);
      assert.equal(await page.locator('#friend-preview-banner').isVisible(), true);
      assert.equal(await page.locator('body').getAttribute('data-office-theme'), 'loft');
      assert.equal(await page.evaluate(()=>window.__office.scene.getObjectByName('personal-floor').userData.identity.accent),'amber');
      await page.getByRole('button', { name: 'Friends & characters', exact: true }).click();
      const menu = page.frameLocator('.office-friends-dialog iframe');
      await menu.locator('#floor-list .floor').nth(1).waitFor();
      assert.equal(await menu.locator('#floor-list .floor').count(), 2);
      await menu.getByRole('button', { name: 'Close', exact: true }).click();
      await page.getByRole('link', { name: 'Your demo office', exact: true }).click();
      await page.waitForURL(url => !url.searchParams.has('floor'));
      await page.waitForFunction(() => window.__source?.threads().length >= 6 && !document.body.classList.contains('shared-office')); 
      await page.locator('.elevator-overlay').waitFor({ state: 'detached' });
      await page.getByRole('button', { name: 'Friends & characters', exact: true }).click();
      await menu.getByRole('button', { name: 'Office style', exact: true }).click();
      await menu.locator('#style-form select[name=accent]').selectOption('rose');
      await menu.locator('#style-form select[name=emblem]').selectOption('leaf');
      await menu.locator('#style-form select[name=west]').selectOption('books');
      await menu.locator('#style-form select[name=center]').selectOption('plant');
      await menu.locator('#style-form select[name=east]').selectOption('lamp');
      await page.screenshot({path:'shots/personal-floor-settings.png',timeout:60000});
      await menu.locator('#style-form button[type=submit]').click();
      await page.waitForFunction(()=>window.__ready&&JSON.parse(document.body.dataset.floorIdentity??'null')?.accent==='rose');
      assert.equal((await call('/session',undefined,visitorCookie)).data.office.appearance.identity.emblem,'leaf');
      assert.equal(await page.evaluate(()=>window.__office.scene.getObjectByName('personal-floor').userData.identity.slots.west),'books');
      await page.screenshot({path:'shots/personal-own-office.png',timeout:60000});
      await page.evaluate(() => { window.__originalOfficeCanvas = document.getElementById('scene'); });
      await page.getByRole('button', { name: 'Building view', exact: true }).click();
      await page.locator('.building-world[data-rendered=true]').waitFor();
      assert.equal(await page.evaluate(() => document.querySelector('.building-world #scene') === window.__originalOfficeCanvas), true);
      await page.screenshot({ path: 'shots/building-original-style.png', timeout: 60000 });
      const officeTime = await page.evaluate(() => window.__world.time);
      await page.locator('.building-world [data-action=close]').click();
      assert.equal(await page.evaluate(() => document.getElementById('scene') === window.__originalOfficeCanvas && document.getElementById('hud').parentElement === document.body), true);
      await page.waitForFunction(t => window.__world.time > t, officeTime);
      assert.equal(await page.evaluate(() => document.getElementById('scene').getContext('webgl2').isContextLost()), false);
      await page.getByRole('button', { name: 'Building view', exact: true }).click();
      await page.locator('.building-world[data-rendered=true]').waitFor();
      await page.getByRole('button', { name: 'Floors', exact: true }).click();
      await page.locator('.building-world-directory button').nth(1).waitFor();
      await page.locator(`.building-world-directory [data-floor="${floorId}"]`).click();
      await page.getByRole('button', { name: 'Enter this office', exact: true }).click();
      await page.waitForURL(url => url.searchParams.get('floor') === floorId);
      await page.locator('.elevator-overlay').waitFor({ state: 'detached' });
      await page.waitForFunction(() => window.__source?.threads().length === 8 && window.__ready);
      assert.equal(await page.locator('.building-world').count(), 0);
      // Closing after a failed refresh must restore the shared office canvas too.
      await page.route('**/api/building/floors', route => route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"synthetic failure"}' }));
      await page.getByRole('button', { name: 'Building view', exact: true }).click();
      await page.getByText('Building unavailable.', { exact: false }).waitFor();
      await page.locator('.building-world [data-action=close]').click();
      assert.equal(await page.locator('#scene').isVisible(), true);
      assert.equal(await page.evaluate(() => document.getElementById('scene').getContext('webgl2').isContextLost()), false);
      await page.unrouteAll({ behavior: 'wait' });
      await page.goto(`${base}preview/doorbell`);await page.locator('.doorbell-office[open] [data-ring-session]').waitFor();
      await page.locator('[data-ring-session]').click();await page.locator('[data-outgoing]').waitFor();
      const waiting=(await call('/doorbell',undefined,friend.cookie)).data.incoming[0];assert.ok(waiting);
      await call(`/doorbell/${waiting.id}/accept`,{},friend.cookie);
      await page.getByText('Accepted',{exact:true}).waitFor({timeout:12000});await page.locator('.social-focus-badge').waitFor();
      await page.screenshot({path:'shots/doorbell-real-office.png',timeout:60000});
      assert.deepEqual(errors, []);
    }
    if (tourCheck) {
      // Keep the synthetic host online throughout slow screenshot runs; retain real freshness enforcement.
      interval = setInterval(() => { void publish().catch(error => console.error('Synthetic tour heartbeat failed:', error.message)); }, 8000);
      const { chromium } = await import('playwright');
      browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-webgl'] });
      const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce', acceptDownloads: true });
      const errors = []; page.on('pageerror', e => errors.push(e.message));
      await page.goto(`${base}preview/tour`); await page.waitForFunction(() => window.__ready);
      await page.locator('.office-tour[data-step="0"]').waitFor();
      await page.screenshot({ path: 'shots/tour-welcome.png', timeout: 60000 });
      await page.locator('[data-tour-action=next]').click(); await page.locator('.office-tour[data-step="1"]').waitFor();
      await page.locator('[data-tour-action=next]').click(); await page.locator('.office-tour[data-step="2"]').waitFor();
      assert.equal(await page.locator('.building-world').getAttribute('data-selected-floor'), floorId);
      await page.screenshot({ path: 'shots/tour-building.png', timeout: 60000 });
      await page.locator('[data-tour-action=next]').click(); await page.waitForURL(u => u.searchParams.get('floor') === floorId);
      await page.waitForFunction(() => window.__ready); await page.locator('.elevator-overlay').waitFor({ state: 'detached' });
      await page.locator('.office-tour[data-step="3"]').waitFor();
      await page.locator('[data-tour-action=next]').click(); await page.locator('.social-office[open] [data-join]').waitFor();
      assert.equal((await call('/social', undefined, visitorCookie)).data.sessions[0].joined, false);
      await page.locator('[data-join]').click(); await page.locator('[data-leave]').waitFor();
      await page.screenshot({ path: 'shots/tour-focus.png', timeout: 60000 });
      await page.locator('[data-social=close]').click(); await page.locator('.social-focus-badge').waitFor();
      await page.locator('.office-tour[data-step="4"]').waitFor(); await page.locator('[data-tour-action=next]').click();
      await page.locator('.social-moment-form input[name=title]').fill('We built our first floor · simulation');
      await page.locator('.social-moment-form button[type=submit]').click(); await page.locator('.social-publication-preview').waitFor();
      assert.equal((await call('/social', undefined, visitorCookie)).data.moments.filter(m => m.isOwner).length, 0, 'Tour preview must not publish');
      await page.screenshot({ path: 'shots/tour-moment-preview.png', timeout: 60000 });
      await page.locator('[data-social=publish]').click(); await page.locator('[data-moment] [data-export]').waitFor();
      await page.locator('[data-export]').click(); await page.locator('.social-export canvas').waitFor();
      await page.screenshot({ path: 'shots/tour-share-card.png', timeout: 60000 });
      const cardImage = await page.locator('.social-export canvas').evaluate(c => c.toDataURL('image/png').split(',')[1]);
      await writeFile('shots/t3-office-moment-card.png', Buffer.from(cardImage, 'base64'));
      await page.locator('[data-social=close]').click(); await page.locator('.office-tour[data-step="5"]').waitFor();
      await page.locator('[data-tour-action=next]').click(); await page.waitForURL(u => !u.searchParams.has('floor'));
      await page.waitForFunction(() => window.__ready); await page.locator('.elevator-overlay').waitFor({ state: 'detached' });
      assert.equal(await page.locator('.office-tour').isVisible(), false);
      await page.locator('.social-focus-badge').waitFor();
      assert.equal((await call('/session', undefined, visitorCookie)).data.office.paused, false);
      // A tour must not start activity publishing on behalf of the visitor.
      assert.equal((await call(`/offices/${visitor.data.office.id}`, undefined, visitorCookie)).data.agents.length, 0);
      await page.getByRole('button', { name: 'Friends & characters', exact: true }).click();
      const menu = page.frameLocator('.office-friends-dialog iframe'); await menu.locator('.social-extra-tools summary').click();await menu.locator('[data-action=tour]').click();
      await page.locator('.office-tour[data-step="0"]').waitFor(); await page.locator('[data-tour-action=skip]').click();
      assert.equal(await page.locator('.office-tour').isVisible(), false);
      const phone = await browser.newPage({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' }); phone.on('pageerror', e => errors.push(e.message));
      await phone.goto(`${base}preview/tour`); await phone.waitForFunction(() => window.__ready); await phone.locator('.office-tour').waitFor();
      assert.equal(await phone.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      await phone.screenshot({ path: 'shots/tour-mobile.png', timeout: 60000 });
      await phone.locator('[data-tour-action=skip]').click(); assert.equal(await phone.locator('.office-tour').isVisible(), false);
      assert.deepEqual(errors, []);
      console.log('PASS: guided office/building/friend/focus/moment tour, explicit joins/publication, safe card preview, return home, replay/Skip, mobile and no implicit activity publication.');
    }
    console.log('PASS: isolated two-player preview, accepted invitation, changing synthetic agents, saved style, elevator, home and private API isolation.');
    await stop();
  } else {
    let busy = false;
    interval = setInterval(async () => { if (busy) return; busy = true; try { step++; await publish(); await tickPeople(); if(doorbellDemo){const rings=(await call('/doorbell',undefined,friend.cookie)).data.incoming;for(const r of rings)await call(`/doorbell/${r.id}/accept`,{},friend.cookie).catch(()=>{});} } catch (e) { console.error('Simulation paused:', e.message); clearInterval(interval); } finally { busy = false; } }, 8000);
    console.log(`Human visit and chat: ${base}preview/people\nSimulated doorbell: ${base}preview/doorbell\nGuided first tour: ${base}preview/tour\nWhole building: ${base}preview/building\nYour demo office: ${base}preview/start\nVisit Maya: ${base}preview/visit\nDisposable synthetic building only. Ctrl+C stops it and removes its temporary database.`);
  }
} catch (error) { await stop(); throw error; }

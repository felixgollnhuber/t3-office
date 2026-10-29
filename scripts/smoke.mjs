/** Office-first acceptance checks with synthetic sources, two browser identities and an isolated database. */
import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const dir = await mkdtemp(join(tmpdir(), 'building-browser-'));
process.env.BUILDING_DB = join(dir, 'building.sqlite'); delete process.env.T3_LOCAL_DATA;
const server = await createServer({ server: { host: 'localhost', port: 0, strictPort: false }, logLevel: 'error' });
let browser;
const errors = []; const privateRequests = [];
try {
  await server.listen(); const base = server.resolvedUrls.local[0];
  browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-webgl'] });
  const ownerContext = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const guestContext = await browser.newContext({ viewport: { width: 1100, height: 760 } });
  const owner = await ownerContext.newPage(); const guest = await guestContext.newPage();
  for (const page of [owner, guest]) {
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('request', (r) => { if (page.url().includes('source=shared') && /\/api\/(t3|board)/.test(r.url())) privateRequests.push(r.url()); });
  }
  const menu = (page) => page.frameLocator('.office-friends-dialog iframe');
  const openMenu = async (page) => { await page.getByRole('button', { name: 'Friends & characters', exact: true }).click(); await menu(page).locator('#friends-menu').waitFor(); };
  const register = async (page, handle, name) => {
    await menu(page).locator('#auth-form input[name="name"]').fill(name);
    await menu(page).locator('#auth-form input[name="handle"]').fill(handle);
    await menu(page).locator('#auth-form input[name="password"]').fill('synthetic-test-password');
    await menu(page).locator('#auth-form button[type="submit"]').click();
    await menu(page).locator('#invite-form').waitFor();
  };
  const call = (path, method = 'GET', body) => ownerContext.request.fetch(`${base}api/building${path}`, { method, data: body, headers: method === 'GET' ? {} : { 'Content-Type': 'application/json' } });
  await owner.goto(`${base}?weather=clear&agents=8`);
  await owner.waitForFunction(() => window.__source?.threads().length >= 8);
  assert.equal(await owner.locator('body > #auth-form').count(), 0);
  assert.equal(await owner.locator('#hud .receipt').isVisible(), true);
  assert.equal(await owner.locator('#hud .deck').isVisible(), true);
  await mkdir('shots', { recursive: true });
  await owner.screenshot({ path: 'shots/office-first.png', fullPage: true, timeout: 60000 });
  const firstLocal = await owner.evaluate(() => window.__source.threads()[0].id);
  await openMenu(owner);
  await menu(owner).getByRole('button', { name: 'Your characters', exact: true }).click();
  await menu(owner).locator('.character-form').first().waitFor();
  await menu(owner).locator('.character-form').first().locator('input[name="name"]').fill('Cody');
  await menu(owner).locator('.character-form').first().locator('select[name="area"]').selectOption('frontend');
  await menu(owner).locator('.character-form').first().getByRole('button', { name: 'Save character', exact: true }).click();
  try { await owner.waitForFunction((id) => window.__source?.threads().find((t) => t.id === id)?.name === 'Cody', firstLocal, { timeout: 10_000 }); }
  catch (error) {
    console.log('Synthetic rename diagnostics:', await owner.evaluate(() => ({ profiles: localStorage.getItem('office.character-profiles.v1'), agents: window.__source?.threads().map((t) => ({ id: t.id, name: t.name })) })));
    console.log('Form diagnostics:', await menu(owner).locator('.character-form').first().evaluate((f) => ({ id: f.dataset.character, name: f.querySelector('input').value, area: f.querySelector('select').value })));
    throw error;
  }
  await menu(owner).getByRole('button', { name: 'Close', exact: true }).click();
  await owner.reload();
  await owner.waitForFunction((id) => window.__source?.threads().find((t) => t.id === id)?.name === 'Cody', firstLocal);
  await openMenu(owner);
  await menu(owner).getByRole('button', { name: 'Office style', exact: true }).click();
  await menu(owner).locator('#style-form select[name="theme"]').selectOption('loft');
  await menu(owner).locator('#style-form select[name="layout"]').selectOption('lounge');
  await menu(owner).locator('#style-form select[name="lighting"]').selectOption('warm');
  await menu(owner).getByRole('button', { name: 'Apply style & reopen office', exact: true }).click();
  await owner.waitForFunction(() => document.body.dataset.officeTheme === 'loft' && document.body.dataset.officeLayout === 'lounge' && document.body.dataset.officeLighting === 'warm');
  await owner.reload();
  await owner.waitForFunction(() => document.body.dataset.officeLayout === 'lounge');
  assert.ok(await owner.evaluate(() => window.__office.spots.couch.length >= 2 && window.__office.spots.pingpong.length === 2));
  console.log('PASS: local theme, lighting and lounge furniture survive reload.');
  await openMenu(owner); await register(owner, 'alice', 'Alice');
  await menu(owner).getByRole('button', { name: 'Sharing', exact: true }).click();
  await menu(owner).getByRole('button', { name: 'Share this office with my invited friends', exact: true }).click();
  await menu(owner).getByRole('button', { name: 'Stop sharing', exact: true }).waitFor();
  await menu(owner).locator('#snapshot-state').getByText('Last activity received', { exact: false }).waitFor();
  await menu(owner).getByRole('button', { name: 'Friends', exact: true }).click();
  await menu(owner).locator('#invite-form select').selectOption('activity');
  await menu(owner).locator('#invite-form button[type="submit"]').click();
  const area = menu(owner).locator('#invite-result textarea'); await area.waitFor(); const invite = await area.inputValue();
  assert.ok(!new URL(invite).searchParams.has('view'));
  await guest.goto(invite);
  await guest.locator('.office-friends-dialog[open]').waitFor();
  await register(guest, 'bobby', 'Bobby');
  await menu(guest).locator('#accept-form button[type="submit"]').click();
  await guest.waitForURL(/source=shared/);
  console.log('PASS: invitation accepted and shared floor opened.');
  await guest.waitForFunction(() => window.__source?.threads().some((t) => t.name === 'Cody' && t.workArea === 'Frontend'));
  assert.equal(await guest.locator('body').getAttribute('data-office-layout'), 'lounge');
  assert.equal(await guest.locator('body').getAttribute('data-office-theme'), 'loft');
  const publicId = await guest.evaluate(() => window.__source.threads().find((t) => t.name === 'Cody').id);
  assert.notEqual(publicId, firstLocal);
  await openMenu(guest);
  await menu(guest).locator('#floor-list').getByText('Frontend (1)', { exact: false }).waitFor();
  assert.equal(await menu(guest).locator('#floor-list [aria-current="location"]').count(), 1);
  await menu(guest).getByRole('button', { name: 'Office style', exact: true }).click();
  await menu(guest).getByText('You are visiting a friend.', { exact: false }).waitFor();
  await menu(guest).getByRole('button', { name: 'Close', exact: true }).click();
  await guest.screenshot({ path: 'shots/friends-office.png', fullPage: true, timeout: 60000 });
  await guest.getByRole('button', { name: '← Your floor', exact: true }).click();
  await guest.waitForURL((url) => !url.searchParams.has('floor'));
  await guest.waitForFunction(() => document.body.dataset.officeLayout === 'original');
  await openMenu(guest);
  await menu(guest).locator('#floor-list .floor[data-own="false"]').click();
  await guest.waitForURL(/source=shared/);
  await guest.waitForFunction(() => document.body.dataset.officeLayout === 'lounge');
  await menu(owner).getByRole('button', { name: 'Sharing', exact: true }).click();
  await menu(owner).locator('#sharing-audience').getByText('Bobby · @bobby', { exact: false }).waitFor();
  await menu(owner).locator('#sharing-audience').getByText('Activity guests:', { exact: false }).waitFor();
  // Closing the publisher page stops its heartbeat; direct synthetic API requests test subsequent renderer reconciliation.
  await owner.close();
  assert.equal((await call('/publish', 'POST', { agents: [{ id: publicId, provider: 'codex', status: 'waiting' }] })).status(), 200);
  try { await guest.waitForFunction((id) => window.__world?.workers.get(id)?.thread.status === 'waiting', publicId, { timeout: 30_000, polling: 500 }); }
  catch (error) {
    console.log('Synthetic status diagnostics:', await guest.evaluate((id) => ({ url: location.href, source: window.__source?.threads().map((t) => ({ id: t.id, status: t.status })), worker: window.__world?.workers.get(id)?.thread.status }), publicId));
    console.log('Stored snapshot:', await (await call(`/offices/${(await (await call('/session')).json()).office.id}`)).json());
    throw error;
  }
  await call('/publish', 'POST', { agents: [{ id: publicId, provider: 'codex', status: 'idle' }] });
  await guest.waitForFunction((id) => window.__world?.workers.get(id)?.thread.status === 'idle', publicId);
  const own = (await (await call('/session')).json()).office;
  await call('/office', 'POST', { paused: true });
  // A valid-but-empty paused office must not leave old character labels in the renderer.
  await guest.waitForFunction(() => window.__source?.threads().length === 0);
  await call('/office', 'POST', { paused: false });
  assert.equal((await (await call(`/offices/${own.id}`)).json()).agents.length, 0);
  await call('/publish', 'POST', { agents: [{ id: publicId, provider: 'codex', status: 'running' }] });
  await guest.waitForFunction(() => window.__source?.threads().some((t) => t.name === 'Cody'));
  const grants = (await (await call('/grants')).json()).grants;
  await call(`/grants/${grants[0].id}`, 'DELETE', {});
  await guest.waitForURL((url) => !url.searchParams.has('source'));
  assert.equal((await guestContext.request.get(`${base}api/building/offices/${own.id}`)).status(), 404);
  assert.equal((await guestContext.request.get(`${base}api/t3/status`)).status(), 404);
  assert.equal((await guestContext.request.get(`${base}.local/building.sqlite`)).status(), 403);
  await openMenu(guest);
  let held; let release;
  const heldReady = new Promise((resolve) => { held = resolve; }); const allowRelease = new Promise((resolve) => { release = resolve; });
  await guest.route('**/api/building/floors', async (route) => { const response = await route.fetch(); held(); await allowRelease; await route.fulfill({ response }); });
  await heldReady;
  await menu(guest).getByRole('button', { name: 'Sign out', exact: true }).click();
  await menu(guest).locator('#auth-form').waitFor(); release(); await guest.unrouteAll({ behavior: 'wait' });
  assert.equal(await menu(guest).locator('.account').count(), 0);
  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await mobile.goto(`${base}?source=demo&weather=clear&agents=8`);
  await mobile.getByRole('button', { name: 'Friends & characters', exact: true }).waitFor();
  await openMenu(mobile); await menu(mobile).getByRole('button', { name: 'Your characters', exact: true }).click();
  await menu(mobile).locator('.character-form').first().waitFor();
  assert.equal(await menu(mobile).locator('html').evaluate((el) => el.scrollWidth <= innerWidth), true);
  await mobile.screenshot({ path: 'shots/office-menu-mobile.png', fullPage: true, timeout: 60000 });
  await menu(mobile).getByRole('button', { name: 'Office style', exact: true }).click();
  assert.equal(await menu(mobile).locator('html').evaluate((el) => el.scrollWidth <= innerWidth), true);
  await menu(mobile).locator('#style-form select[name="layout"]').selectOption('focus');
  await menu(mobile).locator('#style-form select[name="lighting"]').selectOption('cool');
  await menu(mobile).locator('#style-form button[type="submit"]').click();
  await mobile.waitForFunction(() => window.__office && document.body.dataset.officeLayout === 'focus' && document.body.dataset.officeLighting === 'cool' && window.__office.spots.couch.length === 0 && !window.__office.spots.pingpong?.length);

  await mobile.goto(`${base}?source=demo&weather=clear&lang=de`);
  await mobile.getByRole('button', { name: 'Freunde & Charaktere', exact: true }).waitFor();
  assert.deepEqual(privateRequests, []); assert.deepEqual(errors, []);
  console.log('PASS: elevator/current-floor/home, scoped sharing audience and guest room style; original office/HUD first, optional account, persistent local names/areas, scoped live sharing/invites, renderer updates, pause/revoke, logout race, mobile and German menu.');
} finally { await browser?.close(); await server.close(); await rm(dir, { recursive: true, force: true }); }

/** Real HTTP permissions plus lightweight browser travel, without private data or WebGL. */
import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir } from 'node:fs/promises';
import { join } from 'node:path'; import { tmpdir } from 'node:os';
import { chromium } from 'playwright';
const dir = await mkdtemp(join(tmpdir(), 'office-elevator-'));
process.env.BUILDING_DB = join(dir, 'test.sqlite'); delete process.env.T3_LOCAL_DATA;
const { createServer } = await import('vite');
const harness = '<!doctype html><body><p>Original office</p><script type="module">import {travelToFloor,resumeArrival} from "/src/elevator.ts";resumeArrival();window.__travel=travelToFloor;window.addEventListener("office-departure",()=>window.__pullback=true);</script></body>';
const server = await createServer({ server: { host: 'localhost', port: 0 }, logLevel: 'error', plugins: [{ name: 'travel-harness', configureServer(s) { s.middlewares.use((req, res, next) => { if (!new URL(req.url, 'http://local').searchParams.has('harness')) return next(); res.setHeader('Content-Type', 'text/html'); res.end(harness); }); } }] });
let browser;
try {
 await server.listen(); const base = server.resolvedUrls.local[0]; browser = await chromium.launch();
 const owner = await browser.newContext(); const friend = await browser.newContext(); const presence = await browser.newContext(); const stranger = await browser.newContext();
 const call = async (ctx, path, body, method = body === undefined ? 'GET' : 'POST') => { const res = await ctx.request.fetch(`${base}api/building${path}`, { method, data: body }); assert.equal(res.ok(), true, `${path}: ${res.status()}`); return res.json(); };
 const register = (ctx, handle) => call(ctx, '/register', { handle, name: handle, password: 'synthetic-test-password' });
 await register(owner, 'you_demo'); const maya = await register(friend, 'maya_demo'); const quiet = await register(presence, 'presence_demo'); const secret = await register(stranger, 'secret_person');
 await call(friend, '/office', { name: 'Maya studio', appearance: { theme: 'loft', layout: 'lounge', lighting: 'warm' } });
 await call(friend, '/publish', { agents: [{ id: 'demo-agent', provider: 'codex', status: 'running' }] });
 const invite = await call(friend, '/invites', { scope: 'activity' }); await call(owner, '/accept', { token: invite.token });
 const quietInvite = await call(presence, '/invites', { scope: 'presence' }); await call(owner, '/accept', { token: quietInvite.token });
 const page = await owner.newPage(); const errors = []; page.on('pageerror', e => errors.push(e.message));
 const goHome = async () => { await page.goto(`${base}?harness=1`); await page.waitForFunction(() => !!window.__travel); };
 await goHome(); const started = Date.now(); await page.evaluate(id => { void window.__travel(id); }, maya.office.id);
 await page.locator('.elevator-overlay[data-phase=moving]').waitFor();
 assert.equal(await page.evaluate(() => window.__pullback), true);
 assert.equal(await page.locator('.elevator-floor').count(), 3);
 assert.equal(await page.locator('.elevator-stage').getByText('secret_person', { exact: false }).count(), 0);
 assert.equal(await page.locator(`.elevator-floor[data-floor="${quiet.office.id}"] .mini-desk`).count(), 0);
 await mkdir('shots', { recursive: true }); await page.screenshot({ path: 'shots/elevator-cutaway.png' });
 await page.waitForURL(url => url.searchParams.get('floor') === maya.office.id); assert.ok(Date.now() - started >= 1200);
 await page.locator('.elevator-overlay[data-phase=arrival-loading]').waitFor();
 await page.getByRole('button', { name: 'Skip animation', exact: true }).click();
 assert.equal(await page.locator('.elevator-overlay').count(), 1, 'Skip must not reveal the scene before it is ready');
 await page.evaluate(() => window.dispatchEvent(new Event('office-ready'))); await page.locator('.elevator-overlay').waitFor({ state: 'detached' });
 // Reduced motion bypasses travel animation and arrival motion, but preserves authorization and readiness.
 await page.emulateMedia({ reducedMotion: 'reduce' }); const reducedStart = Date.now();
 await page.evaluate(() => { void window.__travel(null); }); await page.waitForURL(url => !url.searchParams.has('floor'));
 assert.ok(Date.now() - reducedStart < 1200);
 await page.locator('.elevator-overlay[data-phase=arrival-loading]').waitFor();
 await page.evaluate(() => window.dispatchEvent(new Event('office-ready'))); await page.locator('.elevator-overlay').waitFor({ state: 'detached' });
 // Invalid destinations never paint the inaccessible floor, even when Skip is used.
 await page.evaluate(id => { void window.__travel(id); }, secret.office.id);
 await page.locator('.elevator-overlay[data-phase=failed]').waitFor(); assert.equal(await page.locator('.elevator-floor').count(), 0);
 await page.getByRole('button', { name: 'Back to office', exact: true }).click();
 // A real revocation while the cabin moves is checked again before navigation.
 await page.setViewportSize({ width: 390, height: 844 });
 await page.emulateMedia({ reducedMotion: 'no-preference' }); await page.evaluate(id => { void window.__travel(id); }, maya.office.id);
 await page.locator('.elevator-overlay[data-phase=moving]').waitFor();
 assert.equal(await page.locator('.elevator-overlay').evaluate(el => el.scrollWidth <= innerWidth), true);
 await page.screenshot({ path: 'shots/elevator-mobile.png' });
 const grants = await call(friend, '/grants'); await call(friend, `/grants/${grants.grants[0].id}`, {}, 'DELETE');
 await page.getByRole('button', { name: 'Skip animation', exact: true }).click();
 await page.locator('.elevator-overlay[data-phase=failed]').waitFor(); assert.equal(new URL(page.url()).searchParams.has('floor'), false);
 assert.equal(await page.locator('.elevator-floor').count(), 0); await page.getByRole('button', { name: 'Back to office', exact: true }).click();
 // Returning from browser history must not retain a frozen boarding overlay or finish an old trip.
 let release, captured;
 const gate = new Promise(r => { release = r; }); const ready = new Promise(r => { captured = r; });
 await page.route('**/api/building/floors', async route => { const response = await route.fetch(); captured(); await gate; await route.fulfill({ response }); });
 await page.evaluate(id => { void window.__travel(id); }, quiet.office.id); await ready;
 await page.evaluate(() => { window.dispatchEvent(new PageTransitionEvent('pagehide')); window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })); });
 release(); await page.unrouteAll({ behavior: 'wait' });
 await page.locator('.elevator-overlay').waitFor({ state: 'detached' });
 assert.equal(new URL(page.url()).searchParams.has('floor'), false);
 assert.deepEqual(errors, []);
 console.log('PASS: cutaway/cabin/timing, authorized-only floors, presence privacy, ready-gated arrival, Skip, reduced motion and mid-trip revocation.');
} finally { await browser?.close(); await server.close(); await rm(dir, { recursive: true, force: true }); }

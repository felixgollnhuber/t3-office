/** Synthetic multi-user social acceptance; never reads private T3 data. */
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const dir = await mkdtemp(join(tmpdir(), 'office-social-'));
process.env.BUILDING_DB = join(dir, 'state.sqlite'); delete process.env.T3_LOCAL_DATA;
const harness = `<!doctype html><html lang="en"><meta name="viewport" content="width=device-width"><style>:root{--paper:#f8f4e8;--ink:#263c35;--edge:#385148;--muted:#52685e;--accent:#a8492d;--shadow:#b8b8a1}body{font:18px monospace;margin:20px;background:var(--paper);color:var(--ink)}</style><button id="open-focus">Open focus</button><button id="open-moments">Open moments</button><script type="module">import {installSocialOffice} from '/src/social.ts';const social=installSocialOffice();document.querySelector('#open-focus').onclick=()=>social.open('focus');document.querySelector('#open-moments').onclick=()=>social.open('moments');</script></html>`;
const server = await createServer({ server: { host: 'localhost', port: 0, strictPort: false }, logLevel: 'error', plugins: [{ name: 'synthetic-social-harness', configureServer(s) { s.middlewares.use((req, res, next) => { if (!new URL(req.url, 'http://local').searchParams.has('social-harness')) return next(); res.setHeader('Content-Type', 'text/html'); res.end(harness); }); } }] });
let browser;
try {
  await server.listen(); const base = server.resolvedUrls.local[0]; browser = await chromium.launch();
  const owner = await browser.newContext({ reducedMotion: 'reduce', acceptDownloads: true });
  const guest = await browser.newContext({ reducedMotion: 'reduce', acceptDownloads: true });
  const presence = await browser.newContext({ reducedMotion: 'reduce' });
  const errors = [];
  const watch = page => page.on('pageerror', e => errors.push(e.message));
  const call = async (ctx, path, data, method = data === undefined ? 'GET' : 'POST') => {
    const response = await ctx.request.fetch(`${base}api/building${path}`, { method, ...(data === undefined ? {} : { data }) });
    const body = await response.json(); assert.ok(response.ok(), `${method} ${path}: ${response.status()} ${JSON.stringify(body)}`); return body;
  };
  const password = 'synthetic-test-password';
  const alice = await call(owner, '/register', { handle: 'alice_social', name: 'Alice', password });
  const bobby = await call(guest, '/register', { handle: 'bobby_social', name: 'Bobby', password });
  await call(presence, '/register', { handle: 'presence_social', name: 'Presence guest', password });
  const invite = await call(owner, '/invites', { scope: 'activity' }); await call(guest, '/accept', { token: invite.token });
  const presenceInvite = await call(owner, '/invites', { scope: 'presence' }); await call(presence, '/accept', { token: presenceInvite.token });
  const page = await owner.newPage(); const guestPage = await guest.newPage(); const presencePage = await presence.newPage();
  for (const p of [page, guestPage, presencePage]) { watch(p); await p.goto(`${base}?social-harness=1`); }
  const open = async (p, tab = 'focus') => { await p.locator(`#open-${tab}`).click(); await p.locator('dialog[open]').waitFor(); };
  // Focus is explicit, quiet is per participant and timers use the server's expiry.
  await open(page); await page.locator('.social-focus-form').waitFor();
  await page.locator('.social-focus-form select[name=minutes]').selectOption('25');
  assert.equal(await page.locator('.social-focus-form input[name=quiet]').isChecked(), true);
  await page.locator('.social-focus-form button[type=submit]').click();
  const ownerCard = page.locator('[data-session]').first(); await ownerCard.waitFor();
  const sessionId = await ownerCard.getAttribute('data-session');
  const session = (await call(owner, '/social')).sessions.find(s => s.id === sessionId);
  assert.equal(session.endsAt - session.startedAt, 25 * 60_000);
  assert.equal(session.participants[0].quiet, true);
  assert.match(await ownerCard.locator('[data-ends]').innerText(), /^(24|25):[0-5][0-9]$/);
  await open(guestPage); const guestCard = guestPage.locator(`[data-session="${sessionId}"]`); await guestCard.waitFor();
  assert.equal(await guestCard.locator('li').count(), 0, 'Participant names are hidden before explicit joining');
  await guestCard.locator('[data-join-quiet]').uncheck(); await guestCard.locator('[data-join]').click();
  await guestCard.locator('[data-leave]').waitFor();
  assert.match(await guestCard.locator('ul').innerText(), /Alice/); assert.match(await guestCard.locator('ul').innerText(), /Bobby/);
  await page.waitForFunction(id => document.querySelector(`[data-session="${id}"] ul`)?.textContent.includes('Bobby'), sessionId, { timeout: 12_000 });
  const joinedState = (await call(guest, '/social')).sessions.find(s => s.id === sessionId);
  assert.equal(joinedState.participants.find(p => p.userId === bobby.user.id).quiet, false);
  // Closing and navigating preserves the timer only after the server revalidates membership.
  await guestPage.locator('[data-social=close]').click(); await guestPage.locator('.social-focus-badge').waitFor();
  await guestPage.reload(); await guestPage.locator('.social-focus-badge').waitFor();
  assert.equal(await guestPage.locator('.social-office').isVisible(), false);
  await guestPage.locator('.social-focus-badge').click(); await guestPage.locator(`[data-session="${sessionId}"] [data-leave]`).waitFor();
  // Model a legitimate server-timed halfway state; quiet friends never receive a check-in.
  const halfway = async route => { const response = await route.fetch(); const data = await response.json(); data.sessions = data.sessions.map(s => ({...s, startedAt:data.serverNow-13*60_000,endsAt:data.serverNow+12*60_000})); await route.fulfill({response,json:data}); };
  await guestPage.route('**/api/building/social', halfway); await page.route('**/api/building/social', halfway);
  await guestPage.locator('[data-social=close]').click(); await guestPage.locator('.social-checkin').waitFor({timeout:12_000});
  await guestPage.locator('.social-checkin button').click(); assert.equal(await guestPage.locator('.social-checkin').isVisible(), false);
  await page.waitForTimeout(5500); assert.equal(await page.locator('.social-checkin').isVisible(), false, 'Quiet suppresses the halfway check-in');
  await guestPage.unrouteAll({behavior:'wait'}); await page.unrouteAll({behavior:'wait'});
  await guestPage.locator('.social-focus-badge').click(); await guestPage.locator(`[data-session="${sessionId}"] [data-leave]`).waitFor();
  await open(presencePage); const presenceCard = presencePage.locator(`[data-session="${sessionId}"]`); await presenceCard.waitFor();
  assert.equal(await presenceCard.locator('li').count(), 0, 'Presence access alone does not reveal joined participant names');
  await guestCard.locator('[data-leave]').click(); await guestCard.locator('[data-join]').waitFor();
  assert.equal((await call(guest, '/social')).sessions.find(s => s.id === sessionId).joined, false);
  await guestCard.locator('[data-join]').click(); await guestCard.locator('[data-leave]').waitFor();

  // Preview is local. A separate explicit publish action is required.
  await page.locator('[data-tab=moments]').click();
  const title = 'Our first <shared> build';
  await page.locator('.social-moment-form input[name=title]').fill(title);
  await page.locator('.social-moment-form select[name=kind]').selectOption('shipped');
  await page.locator('.social-moment-form button[type=submit]').click();
  await page.locator('.social-publication-preview').waitFor();
  assert.match(await page.locator('.social-publication-preview').innerText(), /Our first <shared> build/);
  assert.equal((await call(owner, '/social')).moments.length, 0, 'Preview must never publish');
  await page.locator('[data-social=publish]').click();
  const ownMoment = page.locator('[data-moment]').first(); await ownMoment.waitFor(); const momentId = await ownMoment.getAttribute('data-moment');
  assert.equal(await ownMoment.locator('shared').count(), 0, 'Owner text must be escaped rather than interpreted as markup');
  assert.match(await ownMoment.innerText(), /Owner-published.*not automatically verified/);
  await guestPage.locator('[data-tab=moments]').click();
  const guestMoment = guestPage.locator(`[data-moment="${momentId}"]`); await guestMoment.waitFor({ timeout: 12_000 });
  assert.equal(await guestMoment.locator('[data-export], [data-delete-moment]').count(), 0, 'Visitors cannot export or delete owner cards');
  await presencePage.locator('[data-tab=moments]').click();
  assert.equal(await presencePage.locator('[data-moment]').count(), 0, 'Presence-only friends cannot view moments');
  assert.equal((await call(presence, '/social')).moments.length, 0);

  // Export only creates a safe, owner-approved card after a second preview.
  await ownMoment.locator('[data-export]').click();
  await page.locator('.social-export canvas').waitFor();
  assert.match(await page.locator('.social-export canvas').getAttribute('aria-label'), /Our first <shared> build.*Alice/);
  const downloadPromise = page.waitForEvent('download'); await page.locator('[data-social=download]').click();
  const download = await downloadPromise; const png = await readFile(await download.path());
  assert.equal(download.suggestedFilename(), 't3-office-moment.png');
  assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  assert.equal(png.readUInt32BE(16), 1200); assert.equal(png.readUInt32BE(20), 630);
  await page.locator('[data-social=cancel-export]').click();

  // Mobile/reduced-motion retains readable controls without horizontal overflow.
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.locator('.social-office').evaluate(el => el.scrollWidth <= el.clientWidth), true);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  assert.equal(await page.locator('.social-office').evaluate(el => getComputedStyle(el).animationName), 'none');
  await ownMoment.locator('[data-delete-moment]').click(); await ownMoment.waitFor({ state: 'detached' });
  await guestMoment.waitFor({ state: 'detached', timeout: 12_000 });

  // Revoking the office revokes its social content and membership too.
  await guestPage.locator('[data-tab=focus]').click(); await guestPage.locator(`[data-session="${sessionId}"] [data-leave]`).waitFor();
  const grants = (await call(owner, '/grants')).grants; const guestGrant = grants.find(g => g.userHandle === 'bobby_social');
  await call(owner, `/grants/${guestGrant.id}`, {}, 'DELETE');
  await guestPage.locator(`[data-session="${sessionId}"]`).waitFor({ state: 'detached', timeout: 12_000 });
  const afterRevoke = (await call(owner, '/social')).sessions.find(s => s.id === sessionId);
  assert.equal(afterRevoke.participants.some(p => p.userId === bobby.user.id), false);
  const again = await call(owner, '/invites', { scope: 'activity' }); await call(guest, '/accept', { token: again.token });
  await guestPage.locator('[data-social=close]').click(); await open(guestPage);
  await guestPage.locator(`[data-session="${sessionId}"] [data-join]`).waitFor();
  assert.equal((await call(guest, '/social')).sessions.find(s => s.id === sessionId).joined, false, 'Regrant does not silently rejoin');

  // A failed refresh clears the old content; recovery requires a successful read.
  await guestPage.route('**/api/building/social', route => route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"synthetic outage"}' }));
  await guestPage.getByText('Connection unavailable.', { exact: false }).waitFor({ timeout: 12_000 });
  assert.equal(await guestPage.locator('[data-session], [data-moment]').count(), 0);
  await guestPage.unrouteAll({ behavior: 'wait' }); await guestPage.locator('[data-social=retry]').click();
  await guestPage.locator(`[data-session="${sessionId}"]`).waitFor();
  await call(guest, '/logout', {});
  await guestPage.getByRole('button', { name: 'Open Friends & characters', exact: true }).waitFor({ timeout: 12_000 });
  assert.equal(await guestPage.locator('[data-session], [data-moment]').count(), 0, 'Logout must clear social content');
  await page.locator('[data-tab=focus]').click(); await page.locator(`[data-session="${sessionId}"] [data-end]`).click();
  await page.locator(`[data-session="${sessionId}"]`).waitFor({ state: 'detached' });

  // Switch accounts after a preflight session response was captured, before POST dispatch.
  // The actor precondition prevents Alice's draft being published to Bobby's audience.
  await page.locator('[data-tab=moments]').click();
  await page.locator('.social-moment-form input[name=title]').fill('Alice private draft must never transfer');
  await page.locator('.social-moment-form button[type=submit]').click();
  let releaseIntent, capturedIntent, heldIntent=false;
  const intentGate=new Promise(r=>{releaseIntent=r;});const intentReady=new Promise(r=>{capturedIntent=r;});
  await page.route('**/api/building/session', async route=>{if(heldIntent)return route.continue();heldIntent=true;const response=await route.fetch();capturedIntent();await intentGate;await route.fulfill({response});});
  await page.locator('[data-social=publish]').click();await intentReady;
  await call(owner,'/logout',{});await call(owner,'/login',{handle:'bobby_social',password});
  const rejected=page.waitForResponse(r=>r.url().endsWith('/api/building/moments')&&r.request().method()==='POST');
  releaseIntent();assert.equal((await rejected).status(),409);await page.unrouteAll({behavior:'wait'});
  assert.equal((await call(owner,'/social')).moments.some(m=>m.title==='Alice private draft must never transfer'),false);
  await page.waitForFunction(()=>!document.querySelector('.social-publication-preview'));

  assert.deepEqual(errors, []);
  console.log('PASS: social focus create/join/quiet/leave/end, explicit moment preview/publication/deletion, owner-only PNG export, presence/revocation/logout isolation, outage recovery and mobile reduced motion.');
} finally { await browser?.close(); await server.close(); await rm(dir, { recursive: true, force: true }); }

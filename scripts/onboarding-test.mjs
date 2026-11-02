/** First-visit acceptance in the real office. Fresh browser profiles and disposable synthetic accounts only. */
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,rm} from 'node:fs/promises';
import {join} from 'node:path';import{tmpdir}from'node:os';
import{createServer}from'vite';import{chromium}from'playwright';
const dir=await mkdtemp(join(tmpdir(),'office-onboarding-'));process.env.BUILDING_DB=join(dir,'test.sqlite');delete process.env.T3_LOCAL_DATA;
const server=await createServer({server:{host:'localhost',port:0,hmr:false},logLevel:'error'});let browser;const errors=[];
try{
 await server.listen();const base=server.resolvedUrls.local[0];browser=await chromium.launch({args:['--use-angle=swiftshader','--enable-webgl']});
 const host=await browser.newContext({viewport:{width:1280,height:900},reducedMotion:'reduce'}),guest=await browser.newContext({viewport:{width:1280,height:900},reducedMotion:'reduce'});
 const hp=await host.newPage(),gp=await guest.newPage();for(const p of[hp,gp])p.on('pageerror',e=>{errors.push(e.message);console.error('Onboarding browser:',e.message);});
 const get=async(ctx,path)=>{const r=await ctx.request.get(base+'api/building'+path);assert.ok(r.ok(),path+':'+r.status());return r.json();};
 const ready=async p=>{await p.waitForFunction(()=>window.__ready);};
 const capture=async(p,name)=>{await mkdir('shots',{recursive:true});await p.screenshot({path:`shots/onboarding-${name}.png`,timeout:60000});};
 await hp.goto(base+'?source=demo&agents=2&weather=clear');await ready(hp);
 assert.equal((await host.request.get(base+'api/building/session')).status(),401);assert.equal(await hp.locator('dialog[open]').count(),0);await hp.locator('.office-welcome:not([hidden])').waitFor();
 await capture(hp,'welcome');await hp.locator('[data-onboarding=start]').click();await hp.locator('.office-tour[data-step="0"]').waitFor();
 await hp.locator('[data-tour-action=next]').click();await hp.locator('.office-tour[data-step="1"]').waitFor();await hp.locator('[data-tour-action=next]').click();
 await hp.locator('.character-editor').waitFor();await hp.locator('.character-editor input[name=name]').fill('My first coworker');await hp.locator('.character-editor button[type=submit]').click();
 await hp.locator('.office-tour[data-step="2"]').waitFor();assert.equal(await hp.locator('.focus-view.on .character-editor').count(),0);
 await hp.locator('[data-tour-action=next]').click();await hp.locator('.human-auth').waitFor();
 assert.equal(await hp.locator('.office-friends-dialog[open]').count(),0,'First-time setup stays in Friends');
 await hp.locator('.human-auth input[name=name]').fill('First Host');await hp.locator('.human-auth input[name=handle]').fill('onboarding_host');
 const password='synthetic-onboarding-password';await hp.locator('.human-auth input[name=password]').fill(password);
 // An expected unauthenticated poll must not replace fields while someone is typing.
 await hp.waitForTimeout(4700);assert.equal(await hp.locator('.human-auth input[name=password]').inputValue(),password);assert.equal(await hp.locator('.human-auth input[name=name]').inputValue(),'First Host');
 await capture(hp,'account');await hp.locator('.human-auth button[type=submit]').click();await hp.locator('[data-human=invite]').waitFor();
 const h=await get(host,'/session');assert.equal((await get(host,'/invites')).invites.length,0);assert.equal((await get(host,'/rooms')).rooms[0].open,false);
 assert.equal((await get(host,'/social')).moments.length,0);assert.equal((await get(host,`/offices/${h.office.id}`)).agents.length,0);
 await hp.locator('[data-human=invite]').click();await hp.locator('.office-tour[data-step="3"]').waitFor();const link=await hp.locator('.human-invite-result textarea').inputValue();assert.equal((await get(host,'/invites')).invites[0].scope,'presence');
 await capture(hp,'invite');await hp.locator('[data-tour-action=pause]').click();await hp.locator('[data-human=close]').click();await hp.locator('[data-onboarding=start]').click();await hp.locator('.office-tour[data-step="3"]').waitFor();
 await hp.reload();await ready(hp);await hp.locator('.office-tour[data-step="3"]').waitFor();assert.equal((await get(host,'/invites')).invites.length,1,'Reload must not create another invitation');
 await hp.locator('[data-tour-action=next]').click();await hp.locator('[data-human=host]').waitFor();
 await hp.setViewportSize({width:390,height:844});assert.equal(await hp.locator('.human-panel').evaluate(e=>e.scrollWidth<=e.clientWidth),true);await capture(hp,'mobile-friends');await hp.setViewportSize({width:1280,height:900});
 await hp.locator('[data-human=host]').click();await hp.waitForFunction(()=>window.__humans.state()?.people.length===1);assert.equal(await hp.locator('.office-tour').getAttribute('data-step'),'3','An owner entering alone does not claim a friend joined');
 const destination=new URL(link);destination.search='?source=demo&agents=2&weather=clear';await gp.goto(destination.href);await ready(gp);await gp.locator('.human-auth').waitFor();assert.equal(new URL(gp.url()).hash,'','Invitation removed from browser address');
 await gp.locator('.human-auth input[name=name]').fill('First Guest');await gp.locator('.human-auth input[name=handle]').fill('onboarding_guest');await gp.locator('.human-auth input[name=password]').fill(password);await gp.locator('.human-auth button[type=submit]').click();
 await gp.locator('[data-human=accept-incoming]').waitFor();assert.equal((await get(guest,'/floors')).floors.length,1,'Account creation must not accept invitation');
 await gp.locator('[data-human=accept-incoming]').click();await gp.locator(`[data-human-room="${h.office.id}"] [data-request]`).waitFor();
 assert.equal(await gp.evaluate(()=>sessionStorage.getItem('building.invitation')),null);
 await gp.locator(`[data-human-room="${h.office.id}"] [data-request]`).click();await hp.locator('.human-panel [data-tab=visits]').click();await hp.locator('[data-admit]').waitFor({timeout:12000});await capture(hp,'admission');await hp.locator('[data-admit]').click();
 await gp.locator(`[data-human-room="${h.office.id}"] [data-enter]`).waitFor({timeout:12000});await gp.locator(`[data-human-room="${h.office.id}"] [data-enter]`).click();await gp.waitForURL(u=>u.searchParams.get('floor')===h.office.id);await ready(gp);
 await gp.waitForFunction(()=>window.__humans.state()?.people.length===2);await hp.locator('.office-tour[data-step="4"]').waitFor();
 await hp.locator('[data-tour-action=next]').click();await hp.locator('[data-human=walk]').click();const position=await hp.evaluate(()=>window.__humans.position());await hp.locator('[data-tour-action=continue]').focus();await hp.locator('[data-tour-action=continue]').press('ArrowUp');await hp.waitForTimeout(400);assert.deepEqual(await hp.evaluate(()=>window.__humans.position()),position,'Guide keyboard input must not move a walking avatar');await hp.locator('[data-human=walk]').click();await hp.locator('.human-send textarea').fill('Hello from my first office');await hp.locator('.human-send button[type=submit]').click();await hp.locator('.office-tour[data-step="5"]').waitFor();
 await gp.locator('.human-messages li').filter({hasText:'Hello from my first office'}).waitFor();await capture(hp,'conversation');
 await hp.locator('[data-tour-action=next]').click();await hp.locator('.human-room-settings').waitFor();assert.equal(await hp.locator('.human-room-settings input[name=dnd]').isChecked(),false,'Showing controls must not enable DND');
 await hp.locator('[data-tour-action=finish]').click();assert.equal(await hp.locator('.office-tour').isVisible(),false);assert.equal(await hp.evaluate(()=>sessionStorage.getItem('office.onboarding.v1')),null);
 // Replay through the actual original menu, then Skip; guide never alters activity publication.
 await hp.locator('[data-human=close]').click();await hp.getByRole('button',{name:'Friends & characters',exact:true}).click();const menu=hp.frameLocator('.office-friends-dialog iframe');await menu.locator('.account').filter({hasText:'First Host'}).waitFor();await menu.locator('.social-extra-tools summary').click();await menu.locator('[data-action=tour]').click();await hp.locator('.office-tour[data-step="0"]').waitFor();await hp.locator('[data-tour-action=skip]').click();
 assert.equal((await get(host,`/offices/${h.office.id}`)).agents.length,0);assert.equal((await get(host,'/social')).sessions.length,0);
 // A returning account can sign in without the advanced iframe.
 await guest.request.post(base+'api/building/logout',{data:{}});await gp.goto(base+'?source=demo&agents=2&weather=clear');await ready(gp);await gp.locator('.human-launcher').click();await gp.locator('[data-human=auth-mode]').click();await gp.locator('.human-auth input[name=handle]').fill('onboarding_guest');await gp.locator('.human-auth input[name=password]').fill(password);await gp.locator('.human-auth button[type=submit]').click();await gp.locator('[data-human=invite]').waitFor();assert.equal((await get(guest,'/session')).user.handle,'onboarding_guest');
 assert.deepEqual(errors,[]);console.log('PASS: fresh office/welcome, optional customization, inline registration/login, typing preservation, invitation landing and explicit acceptance, owner open/join, admitted two-user chat, pause/reload/replay/Skip, mobile, controls and no implicit publication.');
} catch(error){if(browser)for(const p of browser.contexts().flatMap(c=>c.pages()))console.error('Synthetic onboarding diagnostics',await p.evaluate(()=>({url:location.href,step:document.querySelector('.office-tour')?.getAttribute('data-step'),notice:document.querySelector('.human-notice')?.textContent,panel:document.querySelector('.human-panel')?.textContent?.slice(-1800)})).catch(()=>null));throw error;
}finally{await browser?.close();await server.close();await rm(dir,{recursive:true,force:true});}

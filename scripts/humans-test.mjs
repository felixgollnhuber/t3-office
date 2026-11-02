/** Real original-office, two-human conversation and walking checks. Synthetic data only. */
import assert from 'node:assert/strict';import{mkdtemp,rm,mkdir}from'node:fs/promises';import{join}from'node:path';import{tmpdir}from'node:os';import{chromium}from'playwright';import{createServer}from'vite';
const dir=await mkdtemp(join(tmpdir(),'office-people-'));process.env.BUILDING_DB=join(dir,'test.sqlite');delete process.env.T3_LOCAL_DATA;
const server=await createServer({server:{host:'localhost',port:0},logLevel:'error'});let browser;const errors=[];
try{
 await server.listen();const base=server.resolvedUrls.local[0];browser=await chromium.launch({args:['--use-angle=swiftshader','--enable-webgl']});
 const owner=await browser.newContext({viewport:{width:1280,height:900},reducedMotion:'reduce'}),guest=await browser.newContext({viewport:{width:1280,height:900},reducedMotion:'reduce'});
 const call=async(ctx,p,data,method=data===undefined?'GET':'POST')=>{const r=await ctx.request.fetch(base+'api/building'+p,{method,...(data===undefined?{}:{data})});assert.ok(r.ok(),p+':'+r.status());return r.json();};
 const password='synthetic-people-password';const h=await call(owner,'/register',{handle:'human_owner',name:'Alice',password}),g=await call(guest,'/register',{handle:'human_guest',name:'Bob',password});

 const hp=await owner.newPage(),gp=await guest.newPage();
 for(const p of[hp,gp]){p.on('pageerror',e=>{errors.push(e.message);console.error('Human browser error:',e.message);});await p.goto(base+'?source=demo&agents=2&weather=clear');await p.waitForFunction(()=>window.__ready,{},{timeout:60000});await p.locator('.human-launcher').click();await p.locator('.human-panel [data-tab=avatar]').click();await p.locator('.human-profile-form').waitFor();}
 // Add a friend in the same panel; generated access stays presence-only.
 await hp.locator('.human-panel [data-tab=visits]').click();await hp.locator('[data-human=invite]').click();
 const link=await hp.locator('.human-invite-result textarea').inputValue();const invitations=await call(owner,'/invites');assert.equal(invitations.invites[0].scope,'presence');
 await gp.locator('.human-panel [data-tab=visits]').click();await gp.locator('details').filter({has:gp.locator('.human-accept')}).locator('summary').click();await gp.locator('.human-accept input').fill(link);await gp.locator('.human-accept button').click();await gp.locator(`[data-human-room="${h.office.id}"]`).waitFor();
 await hp.locator('.human-panel [data-tab=avatar]').click();await gp.locator('.human-panel [data-tab=avatar]').click();
 await hp.locator('.human-profile-form input[name=name]').fill('Alice Human');await hp.locator('.human-profile-form select[name=color]').selectOption('rose');await hp.locator('.human-profile-form button[type=submit]').click();await hp.waitForResponse(r=>r.url().endsWith('/api/building/human')&&r.request().method()==='GET');
 await gp.locator('.human-profile-form input[name=name]').fill('Bob Human');await gp.locator('.human-profile-form select[name=color]').selectOption('sage');await gp.locator('.human-profile-form button[type=submit]').click();await gp.waitForResponse(r=>r.url().endsWith('/api/building/human')&&r.request().method()==='GET');
 await hp.locator('.human-panel [data-tab=visits]').click();await mkdir('shots',{recursive:true});await hp.screenshot({path:'shots/simplified-friends.png',timeout:60000});await hp.locator('[data-human=host]').click();await hp.waitForFunction(()=>window.__humans.state()?.people.length===1);
 await hp.waitForFunction(()=>document.querySelector('.human-panel h2')?.textContent.includes('Alice'));
 await hp.locator('.human-panel [data-tab=chat]').click();await hp.waitForFunction(()=>window.__humans.state()?.people.length===1);
 await gp.locator('.human-panel [data-tab=visits]').click();await gp.locator(`[data-human-room="${h.office.id}"] [data-request]`).waitFor({timeout:12000});await gp.locator(`[data-human-room="${h.office.id}"] [data-request]`).click();
 await hp.locator('.human-panel [data-tab=visits]').click();await hp.locator('[data-admit]').waitFor({timeout:12000});assert.match(await hp.locator('.human-requests').innerText(),/Bob Human/);await hp.locator('[data-admit]').click();
 await gp.locator(`[data-human-room="${h.office.id}"] [data-enter]`).waitFor({timeout:12000});await gp.locator(`[data-human-room="${h.office.id}"] [data-enter]`).click();
 await gp.waitForURL(u=>u.searchParams.get('floor')===h.office.id);await gp.waitForFunction(()=>window.__ready&&window.__humans?.state()?.people.length===2,{},{timeout:60000});await gp.locator('.elevator-overlay').waitFor({state:'detached'});
 await hp.waitForFunction(()=>window.__humans.state()?.people.length===2);assert.equal(await gp.locator('.human-name').count(),2);assert.ok((await gp.locator('.human-name').allTextContents()).some(t=>t.includes('YOU · Bob Human')));
 await hp.locator('.human-panel [data-tab=chat]').click();
 await gp.locator('.human-send textarea').fill('Hello <script>this stays text</script>');await gp.locator('.human-send button[type=submit]').click();await hp.locator('.human-messages li').filter({hasText:'this stays text'}).waitFor({timeout:12000});assert.equal(await hp.locator('.human-messages script').count(),0);
 await hp.locator('.human-send textarea').fill('Welcome to my office, Bob!');await hp.locator('.human-send button[type=submit]').click();await gp.locator('.human-messages li').filter({hasText:'Welcome to my office'}).waitFor({timeout:12000});
 await mkdir('shots',{recursive:true});await gp.screenshot({path:'shots/humans-conversation.png',timeout:60000});
 // A failed transport keeps a manual retry; a server acknowledgement never duplicates a message.
 let aborted=false;await gp.route('**/api/building/rooms/*/messages',route=>{if(!aborted&&route.request().method()==='POST'){aborted=true;return route.abort();}return route.continue();});
 await gp.locator('.human-send textarea').fill('A retried synthetic greeting');await gp.locator('.human-send button[type=submit]').click();await gp.locator('[data-retry-message]').waitFor();
 await gp.unrouteAll({behavior:'wait'});await gp.waitForTimeout(1050);await gp.locator('[data-retry-message]').click();await hp.locator('.human-messages li').filter({hasText:'A retried synthetic greeting'}).waitFor({timeout:12000});
 assert.equal(await hp.locator('.human-messages li').filter({hasText:'A retried synthetic greeting'}).count(),1);
 await hp.locator('.human-messages li').filter({hasText:'A retried synthetic greeting'}).getByRole('button',{name:'Delete',exact:true}).click();
 await gp.locator('.human-messages li').filter({hasText:'A retried synthetic greeting'}).waitFor({state:'detached'});assert.equal((await gp.locator('.human-pending').innerText()).includes('retried synthetic'),false,'Deleted messages must not reappear as optimistic sent text');
 await gp.locator('[data-human=walk]').click();await gp.locator('[data-human=close]').click();
 const target=await gp.evaluate(()=>{const nav=window.__office.nav,start=window.__humans.position();for(const dz of[-1,-2,1])for(const dx of[1.5,-1.5,2]){const x=start.x+dx,z=start.z+dz;if(!nav.walkable(x,z))continue;const v=window.__camera;const p=new window.__office.scene.position.constructor(x,0,z);p.project(v);if(Math.abs(p.x)<.8&&Math.abs(p.y)<.8)return{x,z,sx:(p.x+1)/2*innerWidth,sy:(1-p.y)/2*innerHeight};}return null;});assert.ok(target,'Find a reachable open-floor click');
 const start=await gp.evaluate(()=>window.__humans.position());
 await gp.locator('#scene').click({position:{x:target.sx,y:target.sy}});
 await gp.waitForFunction(start=>Math.hypot(window.__humans.position().x-start.x,window.__humans.position().z-start.z)>.6,start,{timeout:12000});
 await hp.waitForFunction(({id,start})=>{const p=window.__humans.state()?.people.find(p=>p.id===id);return p&&Math.hypot(p.x-start.x,p.z-start.z)>.5;},{id:g.user.id,start},{timeout:12000});
 await gp.screenshot({path:'shots/humans-walking.png',timeout:60000});
 await gp.locator('.human-launcher').click();await gp.locator('[data-human=walk]').click();await gp.locator('[data-human=close]').click();
 await hp.locator('.human-send textarea').fill('A new message while your panel is closed');await hp.locator('.human-send button[type=submit]').click();await gp.waitForFunction(()=>/· [1-9]/.test(document.querySelector('.human-launcher').textContent),{},{timeout:12000});
 await gp.locator('.human-launcher').click();await gp.locator('.human-messages li').filter({hasText:'A new message'}).waitFor();
 await gp.setViewportSize({width:390,height:844});assert.equal(await gp.locator('.human-panel').evaluate(e=>e.scrollWidth<=e.clientWidth),true);await gp.screenshot({path:'shots/humans-mobile.png',timeout:60000});
 await hp.locator('.human-member-details summary').click();await hp.locator(`[data-kick="${g.user.id}"]`).click();await gp.waitForFunction(()=>window.__humans.state()===null);assert.equal(await gp.locator('.human-name').count(),0);assert.equal(await gp.locator('[data-message]').count(),0);assert.equal(await gp.locator('.human-send').count(),0);
 assert.equal((await call(guest,'/rooms')).rooms.find(r=>r.id===h.office.id).admitted,false);
 // Failed room reads must clear messages/avatars; an explicit entry can reconnect.
 await hp.route('**/api/building/rooms/*/state',route=>route.fulfill({status:503,contentType:'application/json',body:'{"error":"synthetic outage"}'}));
 await hp.waitForFunction(()=>window.__humans.state()===null);assert.equal(await hp.locator('.human-name').count(),0);assert.equal(await hp.locator('[data-message]').count(),0);
 await hp.unrouteAll({behavior:'wait'});await hp.locator('.human-panel [data-enter]').click();await hp.waitForFunction(()=>window.__humans.state()?.people.length===1);
 // Preserve Alice's displayed draft while switching the browser cookie to Bob; POST must fail actor validation.
 await hp.locator('.human-send textarea').fill('A draft that must never transfer accounts');const held=[];
 await hp.route('**/api/building/rooms/*/state',route=>held.push(route));await hp.route('**/api/building/session',route=>held.push(route));
 await call(owner,'/logout',{});await call(owner,'/login',{handle:'human_guest',password});
 const rejected=hp.waitForResponse(r=>r.url().endsWith('/messages')&&r.request().method()==='POST');await hp.locator('.human-send button[type=submit]').click();assert.equal((await rejected).status(),409);
 for(const route of held)await route.abort().catch(()=>{});await hp.unrouteAll({behavior:'ignoreErrors'});await hp.waitForFunction(()=>window.__humans.state()===null);
 assert.equal(await hp.locator('[data-message]').count(),0);assert.equal(await hp.locator('.human-name').count(),0);
 assert.deepEqual(errors,[]);console.log('PASS: human profile, explicit visit request/admission/travel, distinct real-office avatars, synchronized walking, escaped bidirectional chat, unread badge, mobile, host removal, retry/moderation, outage recovery and account-switch rejection.');
}catch(error){if(browser)for(const [i,p]of browser.contexts().flatMap(c=>c.pages()).entries()){await p.screenshot({path:`shots/humans-failure-${i}.png`,timeout:10000}).catch(()=>{});console.log('Synthetic human diagnostics',i,await p.evaluate(()=>({url:location.href,notice:document.querySelector('.human-notice')?.textContent,people:window.__humans?.state()?.people,messages:window.__humans?.state()?.messages.length,panel:document.querySelector('.human-panel')?.textContent})).catch(()=>null));}throw error;
}finally{await browser?.close();await server.close();await rm(dir,{recursive:true,force:true});}

/** Production-built original office served by the local Worker/D1 on one origin. Two browsers: invite → accept → admit → enter → chat → building view → revoke. Synthetic data only; no private T3 routes. */
import assert from'node:assert/strict';import{spawn,execFileSync}from'node:child_process';import{mkdtemp,rm,mkdir,access}from'node:fs/promises';import{join}from'node:path';import{tmpdir}from'node:os';import{chromium}from'playwright';
const port=Number(process.env.CLOUD_UI_PORT??8791),base=`http://localhost:${port}/`,wrangler='./node_modules/.bin/wrangler',config='cloud/wrangler.jsonc';
await access('dist/index.html').catch(()=>{throw new Error('Run npm run build first; the Worker serves dist/.');});
const dir=await mkdtemp(join(tmpdir(),'office-cloud-ui-'));let worker,browser;const errors=[],forbidden=[],log=[];
try{
 execFileSync(wrangler,['d1','migrations','apply','office-permissions-local','--local','--config',config,'--persist-to',dir],{stdio:'ignore',env:{...process.env,CI:'1'}});
 worker=spawn(wrangler,['dev','--local','--config',config,'--persist-to',dir,'--ip','localhost','--port',String(port),'--var',`APP_ORIGIN:http://localhost:${port}`,'--show-interactive-dev-session=false','--log-level','warn'],{stdio:['ignore','pipe','pipe'],env:{...process.env,CI:'1'}});
 worker.stdout.on('data',d=>log.push(String(d)));worker.stderr.on('data',d=>log.push(String(d)));
 for(let i=0;;i++){try{if((await fetch(base)).ok)break;}catch{}if(i>120)throw new Error('Worker did not start:\n'+log.join(''));await new Promise(r=>setTimeout(r,500));}

 // Same-origin static serving and private-route isolation.
 assert.equal((await fetch(base+'?building=1')).headers.get('content-type')?.startsWith('text/html'),true);
 const page=await fetch(base);assert.equal(page.headers.get('x-frame-options'),'SAMEORIGIN');assert.match(page.headers.get('content-security-policy')??'',/frame-ancestors 'self'/);assert.equal(page.headers.get('x-content-type-options'),'nosniff');assert.equal(page.headers.get('strict-transport-security'),null,'No HSTS on plain loopback development');
 for(const p of['api/t3/threads','api/board','.env','api/building/../t3/threads'])assert.equal((await fetch(base+p)).status,404,p);
 assert.equal((await fetch(base+'api/building/session')).status,401);

 browser=await chromium.launch({args:['--use-angle=swiftshader','--enable-webgl']});
 // The original home screen probes /api/t3/status once to choose live vs demo; the Worker must answer 404 and nothing else may be requested.
 const watchPrivate=r=>{const u=new URL(r.url());if(!/^\/api\/(t3|board)(\/|$)/.test(u.pathname))return;if(u.pathname!=='/api/t3/status')forbidden.push(u.pathname);else r.response().then(x=>{if(x?.status()!==404)forbidden.push(u.pathname+':'+x?.status());}).catch(()=>{});};
 const ctx=()=>browser.newContext({viewport:{width:1280,height:900},reducedMotion:'reduce'});const owner=await ctx(),guest=await ctx();
 const call=async(c,p,data,method=data===undefined?'GET':'POST')=>{const r=await c.request.fetch(base+'api/building'+p,{method,headers:method==='GET'?{}:{Origin:base.slice(0,-1)},...(data===undefined?{}:{data})});assert.ok(r.ok(),p+':'+r.status()+' '+await r.text());return r.json();};
 const password='synthetic-cloud-ui-password';const h=await call(owner,'/register',{handle:'cloud_owner',name:'Alice',password});await call(guest,'/register',{handle:'cloud_guest',name:'Bob',password});
 const hp=await owner.newPage(),gp=await guest.newPage();
 for(const p of[hp,gp]){p.on('pageerror',e=>{errors.push(e.message);console.error('Browser error:',e.message);});p.on('requestfinished',watchPrivate);
  await p.goto(base+'?source=demo&agents=2&weather=clear');await p.waitForFunction(()=>window.__ready,{},{timeout:90000});await p.locator('.human-launcher').click();await p.locator('.human-panel [data-tab=avatar]').click();await p.locator('.human-profile-form').waitFor();}

 // Invite and accept through the original Friends panel.
 await hp.locator('.human-panel [data-tab=visits]').click();await hp.locator('[data-human=invite]').click();const link=await hp.locator('.human-invite-result textarea').inputValue();assert.match(link,/^http:\/\/localhost:\d+\//);
 assert.equal((await call(owner,'/invites')).invites[0].scope,'presence');
 await gp.locator('.human-panel [data-tab=visits]').click();await gp.locator('details').filter({has:gp.locator('.human-accept')}).locator('summary').click();await gp.locator('.human-accept input').fill(link);await gp.locator('.human-accept button').click();await gp.locator(`[data-human-room="${h.office.id}"]`).waitFor({timeout:15000});

 // Profiles, host, request, admit, enter.
 await hp.locator('.human-panel [data-tab=avatar]').click();await hp.locator('.human-profile-form input[name=name]').fill('Alice Human');await hp.locator('.human-profile-form button[type=submit]').click();await hp.waitForResponse(r=>r.url().endsWith('/api/building/human')&&r.request().method()==='GET');
 await gp.locator('.human-panel [data-tab=avatar]').click();await gp.locator('.human-profile-form input[name=name]').fill('Bob Human');await gp.locator('.human-profile-form button[type=submit]').click();await gp.waitForResponse(r=>r.url().endsWith('/api/building/human')&&r.request().method()==='GET');
 await hp.locator('.human-panel [data-tab=visits]').click();await hp.locator('[data-human=host]').click();await hp.locator('[data-human=leave]').waitFor({timeout:15000});
 await gp.locator('.human-panel [data-tab=visits]').click();const room=gp.locator(`[data-human-room="${h.office.id}"]`);await room.locator('[data-request]').waitFor({timeout:15000});await room.locator('[data-request]').click();
 await hp.locator('.human-panel [data-tab=visits]').click();await hp.locator('[data-admit]').waitFor({timeout:15000});assert.match(await hp.locator('.human-requests').innerText(),/Bob Human/);await hp.locator('[data-admit]').click();
 await room.locator('[data-enter]').waitFor({timeout:15000});await room.locator('[data-enter]').click();
 await gp.waitForURL(u=>u.searchParams.get('floor')===h.office.id,{timeout:30000});await gp.waitForFunction(()=>window.__ready,{},{timeout:90000});await gp.locator('.elevator-overlay').waitFor({state:'detached',timeout:30000});
 await gp.waitForFunction(()=>document.querySelectorAll('.human-name').length===2,{},{timeout:20000});await hp.waitForFunction(()=>document.querySelectorAll('.human-name').length===2,{},{timeout:20000});
 assert.ok((await gp.locator('.human-name').allTextContents()).some(t=>t.includes('Bob Human')));

 // Chat both ways; markup stays text.
 await gp.locator('.human-panel').waitFor();if(await gp.locator('.human-panel').isHidden())await gp.locator('.human-launcher').click();await gp.locator('.human-panel [data-tab=chat]').click();await hp.locator('.human-panel [data-tab=chat]').click();
 await gp.locator('.human-send textarea').fill('Hello from the Worker <script>stays text</script>');await gp.locator('.human-send button[type=submit]').click();await hp.locator('.human-messages li').filter({hasText:'Hello from the Worker'}).waitFor({timeout:15000});assert.equal(await hp.locator('.human-messages script').count(),0);
 await hp.locator('.human-send textarea').fill('Welcome, Bob!');await hp.locator('.human-send button[type=submit]').click();await gp.locator('.human-messages li').filter({hasText:'Welcome, Bob!'}).waitFor({timeout:15000});
 await mkdir('shots',{recursive:true});await gp.screenshot({path:'shots/cloud-ui-conversation.png',timeout:60000});

 // Building directory over the Worker lists only authorized floors.
 const floors=(await call(guest,'/floors')).floors;assert.deepEqual(floors.map(f=>f.ownerName).sort(),['Alice','Bob']);
 const bp=await guest.newPage();bp.on('pageerror',e=>errors.push(e.message));bp.on('requestfinished',watchPrivate);
 const floorsSeen=bp.waitForResponse(r=>r.url().endsWith('/api/building/floors')&&r.ok(),{timeout:60000});await bp.goto(base+'?building=1&weather=clear');await bp.waitForFunction(()=>window.__ready,{},{timeout:90000});await floorsSeen;await bp.screenshot({path:'shots/cloud-ui-building.png',timeout:60000});await bp.close();

 // Owner revokes; the guest's live visit ends and the floor disappears.
 const grant=(await call(owner,'/grants')).grants.find(g=>g.userHandle==='cloud_guest');await call(owner,'/grants/'+grant.id,{},'DELETE');
 await gp.waitForFunction(()=>!document.querySelector('[data-human="leave"]')&&document.querySelectorAll('.human-name').length===0,{},{timeout:20000});
 assert.equal((await guest.request.get(base+'api/building/offices/'+h.office.id)).status(),404);assert.deepEqual((await call(guest,'/floors')).floors.map(f=>f.ownerName),['Bob']);

 assert.deepEqual(forbidden,[],'The Worker-served UI may only probe /api/t3/status, which must be 404');assert.deepEqual(errors,[]);
 console.log('PASS: Worker-served production UI: same-origin assets, private-route isolation, two-browser invite/accept/admit/enter/chat, building directory and live revocation.');
}catch(e){if(log.length)console.error(log.join('').slice(-3000));throw e;}
finally{await browser?.close();worker?.kill('SIGTERM');await new Promise(r=>setTimeout(r,500));await rm(dir,{recursive:true,force:true});}

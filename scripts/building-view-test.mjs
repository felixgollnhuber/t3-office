/** Synthetic permission and actual 3D picking checks for the persistent building UI. */
import assert from 'node:assert/strict'; import { chromium } from 'playwright';
import { mkdtemp, mkdir, rm } from 'node:fs/promises'; import { join } from 'node:path'; import { tmpdir } from 'node:os';
const dir=await mkdtemp(join(tmpdir(),'office-building-world-'));process.env.BUILDING_DB=join(dir,'test.sqlite');delete process.env.T3_LOCAL_DATA;
const {createServer}=await import('vite');
const html='<!doctype html><body><button id="open">Open building</button><script type="module">import{openBuildingView}from"/src/building-view.ts";document.querySelector("#open").onclick=()=>openBuildingView(()=>window.__friendsOpened=true);</script></body>';
const server=await createServer({server:{host:'localhost',port:0},logLevel:'error',plugins:[{name:'building-world-harness',configureServer(s){s.middlewares.use((req,res,next)=>{if(!new URL(req.url,'http://local').searchParams.has('harness'))return next();res.setHeader('Content-Type','text/html');res.end(html);});}}]});let browser;
try{
 await server.listen();const base=server.resolvedUrls.local[0];browser=await chromium.launch({args:['--use-angle=swiftshader','--enable-webgl']});
 const owner=await browser.newContext({reducedMotion:'reduce',viewport:{width:1440,height:1000}}),friend=await browser.newContext(),presence=await browser.newContext(),stranger=await browser.newContext();
 const call=async(ctx,path,body,method=body===undefined?'GET':'POST')=>{const r=await ctx.request.fetch(`${base}api/building${path}`,{method,data:body});assert.equal(r.ok(),true,`${path}:${r.status()}`);return r.json();};
 const register=(ctx,handle)=>call(ctx,'/register',{handle,name:handle,password:'synthetic-test-password'});
 await register(owner,'you_demo');const maya=await register(friend,'maya_demo'),quiet=await register(presence,'presence_demo');await register(stranger,'secret_person');
 await call(friend,'/office',{name:'Maya creative studio',appearance:{theme:'loft',layout:'lounge',lighting:'warm'}});
 await call(friend,'/publish',{agents:[{id:'demo-1',provider:'codex',status:'running'},{id:'demo-2',provider:'claude',status:'waiting'}]});
 for(const[ctx,scope]of[[friend,'activity'],[presence,'presence']]){const i=await call(ctx,'/invites',{scope});await call(owner,'/accept',{token:i.token});}
 const page=await owner.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(`${base}?harness=1`);await page.locator('#open').click();await page.locator('.building-world[data-rendered=true]').waitFor();
 await page.locator('.building-world-directory button').nth(2).waitFor();assert.equal(await page.getByText('secret_person',{exact:false}).count(),0);
 assert.equal(await page.evaluate(id=>window.__buildingView.models.children.find(g=>g.userData.floorId===id).children.length,quiet.office.id),4,'Presence floor is a solid private volume, without desks or agents');
 await page.waitForTimeout(200);await mkdir('shots',{recursive:true});await page.screenshot({path:'shots/building-world.png',timeout:60000});
 // Project a real front-edge mesh point and click the actual WebGL canvas, not a mock selection hook.
 const point=await page.evaluate(id=>{const v=window.__buildingView;const g=v.models.children.find(g=>g.userData.floorId===id);const p=g.position.clone();p.y+=.38;p.z+=3.95;p.project(v.camera);const r=document.querySelector('.building-world canvas').getBoundingClientRect();return{x:r.left+(p.x+1)/2*r.width,y:r.top+(1-p.y)/2*r.height};},maya.office.id);
 await page.mouse.click(point.x,point.y);await page.waitForFunction(id=>document.querySelector('.building-world').dataset.selectedFloor===id,maya.office.id);
 assert.ok(await page.locator('.building-world-detail').innerText().then(t=>t.includes('Maya creative studio')&&t.includes('2 coworkers')));
 await page.waitForTimeout(200);await page.screenshot({path:'shots/building-floor-focus.png',timeout:60000});
 await page.getByRole('button',{name:'Whole building',exact:true}).click();assert.equal(await page.locator('.building-world').getAttribute('data-selected-floor'),'');
 await page.setViewportSize({width:390,height:844});await page.locator(`.building-world-directory [data-floor="${quiet.office.id}"]`).click();
 assert.equal(await page.locator('.building-world').evaluate(el=>el.scrollWidth<=innerWidth),true);
 assert.ok((await page.locator('.building-world-detail').innerText()).includes('Presence only'));assert.equal((await page.locator('.building-world-detail').innerText()).includes('coworkers'),false);
 await page.screenshot({path:'shots/building-world-mobile.png',timeout:60000});
 await page.locator(`.building-world-directory [data-floor="${maya.office.id}"]`).click();const grants=await call(friend,'/grants');await call(friend,`/grants/${grants.grants[0].id}`,{},'DELETE');
 await page.locator(`.building-world-directory [data-floor="${maya.office.id}"]`).waitFor({state:'detached',timeout:12000});assert.equal((await page.locator('.building-world-detail').innerText()).includes('Maya'),false);
 await page.route('**/api/building/floors',route=>route.fulfill({status:503,contentType:'application/json',body:'{"error":"synthetic outage"}'}));
 await page.getByText('Building unavailable.',{exact:false}).waitFor({timeout:12000});assert.equal(await page.locator('.building-world canvas').isVisible(),false);assert.equal(await page.locator('.building-world-labels button').count(),0);
 await page.unrouteAll({behavior:'wait'});await page.getByRole('button',{name:'Try again',exact:true}).click();await page.locator('.building-world-directory button').nth(1).waitFor();
 await call(owner,'/logout',{});await page.locator('.building-world-directory [data-floor="local-own"]').waitFor({timeout:12000});assert.equal(await page.locator('.building-world-directory button').count(),1);
 await page.getByRole('button',{name:'Friends & invitations',exact:true}).click();await page.waitForFunction(()=>window.__friendsOpened===true);assert.equal(await page.locator('.building-world').count(),0);assert.equal(await page.evaluate(()=>!!window.__buildingView),false);
 assert.deepEqual(errors,[]);console.log('PASS: persistent 3D building, actual mesh picking/focus, directory, presence privacy, mobile, revocation, outage clearing, anonymous office and renderer disposal.');
}finally{await browser?.close();await server.close();await rm(dir,{recursive:true,force:true});}

/** Real office input boundaries with a synthetic raycast target and disposable database. */
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createServer} from 'vite';
import {chromium} from 'playwright';
const dir=await mkdtemp(join(tmpdir(),'office-ui-input-'));
process.env.BUILDING_DB=join(dir,'test.sqlite');delete process.env.T3_LOCAL_DATA;
const server=await createServer({server:{host:'localhost',port:0,hmr:false},logLevel:'error'});let browser;
try{
 await server.listen();const base=server.resolvedUrls.local[0];browser=await chromium.launch({args:['--use-angle=swiftshader','--enable-webgl']});
 const page=await browser.newPage({viewport:{width:1440,height:1000},reducedMotion:'reduce'}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(base+'?source=demo&agents=8&weather=clear');await page.waitForFunction(()=>window.__ready,{},{timeout:60000});if(await page.locator('[data-onboarding=dismiss]').isVisible())await page.locator('[data-onboarding=dismiss]').click();
 await page.evaluate(async()=>{const THREE=await import('/node_modules/three/build/three.module.js');window.__settings.set('director',false);window.__uiHits=0;const mesh=new THREE.Mesh(new THREE.PlaneGeometry(10000,10000),new THREE.MeshBasicMaterial({side:THREE.DoubleSide}));mesh.position.z=-0.2;window.__camera.add(mesh);window.__camera.updateMatrixWorld(true);window.__clickables.push({objects:[mesh],hint:'Synthetic input probe',onClick:()=>window.__uiHits++,onDouble:()=>window.__uiHits++});});
 const hits=()=>page.evaluate(()=>window.__uiHits),pose=()=>page.evaluate(()=>window.__director.rig.pose());
 const canvasPoint=()=>page.evaluate(()=>{for(let y=100;y<innerHeight-60;y+=35)for(let x=20;x<innerWidth-20;x+=35)if(document.elementFromPoint(x,y)?.id==='scene')return{x,y};throw Error('No exposed canvas');});
 const point=await canvasPoint();await page.mouse.click(point.x,point.y);assert.equal(await hits(),1,'Genuine canvas click must still activate the scene');
 for(const selector of ['.deck .title','.deck .eq','.deck header','.pulse','.ticker']){
  const el=page.locator('#hud '+selector);if(!await el.count())continue;const box=await el.boundingBox();assert.ok(box);

  assert.equal(await page.evaluate(({x,y})=>!!document.elementFromPoint(x,y)?.closest('#hud .panel'),{x:box.x+box.width/2,y:box.y+box.height/2}),true,selector+' surface must receive input');
  const before=await hits(),camera=await pose();await el.click();await el.dblclick();await el.hover();await page.mouse.wheel(0,300);assert.equal(await hits(),before,selector+' must not pick the scene');assert.deepEqual(await pose(),camera,selector+' must not move/reset/zoom the scene');
 }
 await page.locator('#hud [data-tab=likes]').click();assert.ok(await page.locator('#hud [data-tab=likes]').evaluate(el=>el.classList.contains('on')),'HUD tabs remain functional');
 // A canvas gesture ending over an overlay must clear drag, even if the overlay stops bubbling.
 const p=await canvasPoint();const before=await hits();await page.mouse.move(p.x,p.y);await page.mouse.down();await page.mouse.move(20,20);await page.mouse.up();assert.equal(await hits(),before);assert.equal(await page.locator('body').evaluate(el=>el.classList.contains('grabbing')),false);
 // Cancelled pointers cannot be interpreted as clicks.
 await page.locator('#scene').dispatchEvent('pointerdown',{pointerId:99,clientX:p.x,clientY:p.y});await page.locator('#scene').dispatchEvent('pointercancel',{pointerId:99,clientX:p.x,clientY:p.y});assert.equal(await hits(),before);
 await page.locator('.human-launcher').click();await page.locator('.human-panel').waitFor({state:'visible'});await page.locator('#scene').dispatchEvent('pointerdown',{pointerId:101,clientX:500,clientY:200});await page.locator('.human-panel').dispatchEvent('pointerup',{pointerId:101,clientX:500,clientY:200});assert.equal(await hits(),before);assert.equal(await page.locator('body').evaluate(el=>el.classList.contains('grabbing')),false,'UI release must clean drag even when bubbling is stopped');const camera=await pose();await page.locator('.human-panel').click({position:{x:12,y:12}});await page.locator('.human-panel').hover();await page.mouse.wheel(0,200);assert.equal(await hits(),before);assert.deepEqual(await pose(),camera);
 await page.locator('.human-panel [data-human=close]').click();const finalPoint=await canvasPoint();await page.mouse.move(finalPoint.x,finalPoint.y);await page.mouse.down();await page.mouse.move(finalPoint.x+30,finalPoint.y+10,{steps:4});await page.mouse.up();assert.notDeepEqual(await pose(),camera,'Canvas drag remains functional');
 const changed=await pose();await page.locator('#hud [data-tab=radio]').focus();await page.keyboard.press('0');assert.deepEqual(await pose(),changed,'UI keyboard input must not reset scene camera');await page.evaluate(()=>document.body.classList.add('focused'));assert.equal(await page.locator('#hud [data-tab=radio]').evaluate(el=>getComputedStyle(el).pointerEvents),'none','Hidden HUD buttons must not remain interactive');assert.equal(await page.locator('#hud .deck').evaluate(el=>getComputedStyle(el).pointerEvents),'none');await page.evaluate(()=>document.body.classList.remove('focused'));assert.deepEqual(errors,[]);
 console.log('PASS: HUD surfaces and tabs, panel clicks/double-clicks/wheel, UI keyboard isolation, release over UI, pointer cancellation and genuine scene click/drag.');
}finally{await browser?.close();await server.close();await rm(dir,{recursive:true,force:true});}

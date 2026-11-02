/** Original HUD panels never overlap or leave the window: sizes × themes × languages, live resize both ways, and launchers stay clickable. Synthetic demo office only. */
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createServer} from 'vite';
import {chromium} from 'playwright';
const dir=await mkdtemp(join(tmpdir(),'office-hud-layout-'));process.env.BUILDING_DB=join(dir,'test.sqlite');delete process.env.T3_LOCAL_DATA;
const server=await createServer({server:{host:'localhost',port:0},logLevel:'error'});let browser;let checked=0;
const SIZES=[[1440,900],[1280,800],[1280,700],[1024,640],[1280,571],[1100,520],[1280,441],[1280,360],[800,600],[720,700],[700,500]];
const VARIANTS=['&theme=campus&lang=en','&theme=boiler&lang=de','&theme=loft&lang=de','&theme=soma&lang=en'];
const PANELS=['.clock','.deck','.receipt','.pulse','.ticker'];
const inspect=(page)=>page.evaluate((panels)=>{
 const boxes=[];for(const s of panels){const e=document.querySelector('#hud '+s);if(!e)continue;const st=getComputedStyle(e),r=e.getBoundingClientRect();if(st.display==='none'||st.visibility==='hidden'||!r.width)continue;boxes.push([s,r]);}
 const problems=[];for(let i=0;i<boxes.length;i++){const[a,ra]=boxes[i];if(ra.left<0||ra.top<0||ra.right>innerWidth||ra.bottom>innerHeight)problems.push(a+' leaves the window');for(let j=i+1;j<boxes.length;j++){const[b,rb]=boxes[j];if(ra.left<rb.right&&rb.left<ra.right&&ra.top<rb.bottom&&rb.top<ra.bottom)problems.push(a+' overlaps '+b);}}
 const unreachable=['.wx.friends','.human-launcher','.office-building-launcher'].filter(s=>{const e=document.querySelector(s);if(!e)return true;const r=e.getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return !(e===hit||e.contains(hit));});
 return{level:Number(document.body.dataset.hudFit),problems,unreachable};
},PANELS);
try{
 await server.listen();const base=server.resolvedUrls.local[0];browser=await chromium.launch({args:['--use-angle=swiftshader','--enable-webgl']});
 for(const variant of VARIANTS){
  const page=await browser.newPage({viewport:{width:1440,height:900}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base+'?source=demo&agents=4&weather=clear&time=12:00'+variant);await page.waitForFunction(()=>window.__ready,{},{timeout:90000});
  await page.evaluate(()=>document.querySelector('.office-welcome')?.remove());
  for(const[w,h]of SIZES){await page.setViewportSize({width:w,height:h});await page.waitForTimeout(350);const r=await inspect(page);
   assert.deepEqual(r.problems,[],`${variant} ${w}x${h} (fit ${r.level})`);assert.deepEqual(r.unreachable,[],`${variant} ${w}x${h}: launchers must stay clickable`);checked++;}
  // Growing back restores the full layout; nothing stays compacted.
  await page.setViewportSize({width:1440,height:900});await page.waitForTimeout(350);assert.equal((await inspect(page)).level,0,variant+' returns to level 0');
  assert.deepEqual(errors,[]);await page.close();
 }
 // A roomy default window is untouched: teams, sun line and pulse stay visible.
 const page=await browser.newPage({viewport:{width:1280,height:800}});await page.goto(base+'?source=demo&agents=4&weather=clear&time=12:00');await page.waitForFunction(()=>window.__ready,{},{timeout:90000});await page.waitForTimeout(350);
 assert.equal(await page.evaluate(()=>document.body.dataset.hudFit),'0');for(const s of['#hud .receipt .teams','#hud .sun','#hud .pulse','#hud .deck .eq'])assert.ok(await page.locator(s).isVisible(),s+' visible at 1280x800');
 console.log(`PASS: HUD fit across ${checked} size/theme/language cases: no panel overlap or overflow, launchers clickable, reversible on resize, roomy layout unchanged.`);
}finally{await browser?.close();await server.close();await rm(dir,{recursive:true,force:true});}

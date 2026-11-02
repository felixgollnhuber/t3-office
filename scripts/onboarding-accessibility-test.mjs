/** Targeted keyboard, small-screen and localization checks in the real office; not a full accessibility certification. */
import assert from 'node:assert/strict';import{mkdtemp,mkdir,rm}from'node:fs/promises';import{join}from'node:path';import{tmpdir}from'node:os';import{createServer}from'vite';import{chromium}from'playwright';
const dir=await mkdtemp(join(tmpdir(),'office-first-visit-layout-'));process.env.BUILDING_DB=join(dir,'test.sqlite');delete process.env.T3_LOCAL_DATA;
const server=await createServer({server:{host:'localhost',port:0,hmr:false},logLevel:'error'});let browser;const errors=[];
try{
 await server.listen();const base=server.resolvedUrls.local[0];browser=await chromium.launch({args:['--use-angle=swiftshader','--enable-webgl']});await mkdir('shots',{recursive:true});
 for(const [theme,lang]of[['loft','en'],['campus','de'],['soma','en'],['boiler','de']]){
  const ctx=await browser.newContext({viewport:{width:390,height:660},reducedMotion:'reduce'}),p=await ctx.newPage();p.on('pageerror',e=>errors.push(e.message));
  await p.goto(base+`?source=demo&agents=1&weather=clear&theme=${theme}&lang=${lang}`);await p.waitForFunction(()=>window.__ready);await p.locator('.office-welcome:not([hidden])').waitFor();assert.equal(await p.locator('body').getAttribute('data-office-theme'),theme);
  assert.equal(await p.locator('dialog[open]').count(),0);assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await p.locator('[data-onboarding=start]').click();assert.equal(await p.locator('[data-tour-action=next]').evaluate(e=>e===document.activeElement),true);await p.locator('[data-tour-action=next]').press('Enter');await p.locator('.office-tour[data-step="1"]').waitFor();await p.locator('[data-tour-action=customize-skip]').click();await p.locator('[data-tour-action=next]').click();await p.locator('.human-auth').waitFor();
  assert.equal(await p.locator('.human-panel').evaluate(e=>e.scrollWidth<=e.clientWidth),true);
  // Contrast is checked for the current guide's primary text, not an entire WCAG audit.
  const contrast=await p.locator('.office-tour').evaluate(e=>{const style=getComputedStyle(e),c=document.createElement('canvas');c.width=c.height=1;const g=c.getContext('2d');const rgb=value=>{g.clearRect(0,0,1,1);g.fillStyle=value;g.fillRect(0,0,1,1);return[...g.getImageData(0,0,1,1).data].slice(0,3);};const lum=v=>v.map(x=>{x/=255;return x<=.04045?x/12.92:((x+.055)/1.055)**2.4;}).reduce((s,x,i)=>s+x*[.2126,.7152,.0722][i],0);const a=lum(rgb(style.color)),b=lum(rgb(style.backgroundColor));return(Math.max(a,b)+.05)/(Math.min(a,b)+.05);});assert.ok(contrast>=4.5,`${theme} guide text contrast ${contrast}`);
  await p.locator('.human-auth input[name=name]').fill('Keyboard User');await p.locator('.human-auth input[name=handle]').fill('keyboard_user');await p.locator('.human-auth input[name=password]').fill('synthetic-keyboard-password');
  await p.setViewportSize({width:390,height:460});await p.locator('.human-auth button[type=submit]').scrollIntoViewIfNeeded();assert.equal(await p.locator('.human-auth button[type=submit]').isVisible(),true);assert.equal(await p.locator('.human-panel').evaluate(e=>e.scrollWidth<=e.clientWidth),true);
  await p.setViewportSize({width:390,height:660});await p.screenshot({path:`shots/onboarding-${theme}-${lang}-mobile-account.png`,timeout:60000});
  await p.locator('[data-tour-action=pause]').focus();await p.locator('[data-tour-action=pause]').press('Escape');assert.equal(await p.locator('.office-tour').isVisible(),false);assert.equal(await p.evaluate(()=>JSON.parse(sessionStorage.getItem('office.onboarding.v1')).paused),true);
  await p.locator('[data-human=close]').click();await p.locator('[data-onboarding=start]').click();await p.locator('.office-tour[data-step="2"]').waitFor();await p.locator('[data-tour-action=skip]').click();assert.equal(await p.evaluate(()=>sessionStorage.getItem('office.onboarding.v1')),null);assert.equal(await p.locator('.office-tour').isVisible(),false);
  await p.reload();await p.waitForFunction(()=>window.__ready);assert.equal(await p.locator('.office-welcome').isVisible(),false,'Dismissal is respected on reload');
  // Explicit replay remains available even after the first-visit prompt was dismissed.
  await p.goto(base+`?source=demo&agents=1&weather=clear&tour=1&lang=${lang}`);await p.waitForFunction(()=>window.__ready);await p.locator('.office-tour[data-step="0"]').waitFor();await p.locator('[data-tour-action=skip]').click();assert.equal(new URL(p.url()).searchParams.has('tour'),false);
  await ctx.close();console.log(`PASS: ${theme}/${lang} small-screen guide/account layout, reduced motion, primary text contrast ${contrast.toFixed(2)}:1, keyboard start/Escape, pause/resume, Skip, dismissed prompt and explicit replay.`);
 }
 assert.deepEqual(errors,[]);
}finally{await browser?.close();await server.close();await rm(dir,{recursive:true,force:true});}

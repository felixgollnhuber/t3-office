/** Hosted-trial helpers. `preflight` checks cloud/wrangler.jsonc env.trial before any deploy (no network, no account).
 * `smoke <https-origin>` checks a deployed trial from outside without signing in or creating data. */
import assert from 'node:assert/strict';import {readFile,stat} from 'node:fs/promises';
const [command,arg]=process.argv.slice(2);
const problems=[];const check=(ok,message)=>{if(!ok)problems.push(message);};

if(command==='preflight'){
 const config=JSON.parse(await readFile('cloud/wrangler.jsonc','utf8')),trial=config.env?.trial;assert.ok(trial,'cloud/wrangler.jsonc has no env.trial');
 const v=trial.vars??{},db=trial.d1_databases?.[0]??{};let origin;
 try{origin=new URL(v.APP_ORIGIN);}catch{problems.push('APP_ORIGIN is not a URL');}
 if(origin){check(origin.protocol==='https:','APP_ORIGIN must use https');check(origin.pathname==='/'&&!origin.search&&!origin.hash,'APP_ORIGIN must be an origin only (no path)');check(!/REPLACE/i.test(origin.host),'APP_ORIGIN still has a placeholder');
  if(origin.hostname.endsWith('.workers.dev'))check(origin.hostname.startsWith(trial.name+'.'),`APP_ORIGIN host must start with the Worker name "${trial.name}."`);}
 check(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(db.database_id??''),'D1 database_id is not set (run: npx wrangler d1 create t3-office-trial)');
 const logins=String(v.GITHUB_ALLOWED_LOGINS??'').split(',').map(s=>s.trim()).filter(Boolean);
 check(logins.length>0&&!logins.some(l=>/REPLACE/i.test(l)),'GITHUB_ALLOWED_LOGINS must list the trial GitHub logins (an empty list would admit any GitHub user)');
 check(logins.every(l=>/^[A-Za-z0-9-]{1,39}$/.test(l)),'GITHUB_ALLOWED_LOGINS contains an invalid GitHub login');
 check(v.ALLOW_PASSWORD_SIGNUP==='0','ALLOW_PASSWORD_SIGNUP should be "0" for the trial (GitHub-only sign-up)');
 check(v.API_OPEN!=='0','API_OPEN is "0": the deployed API would be closed');
 check(trial.observability?.logs?.invocation_logs===false,'Keep invocation_logs off so request URLs (OAuth callback codes) are not stored');
 for(const s of['GITHUB_CLIENT_ID','GITHUB_CLIENT_SECRET'])check(!(s in v),`${s} must be a secret (wrangler secret put), never a var`);
 try{const built=await stat('dist/index.html');check(Date.now()-built.mtimeMs<3600000,'dist/ is older than an hour; run npm run build');}catch{problems.push('dist/ is missing; run npm run build');}
 if(problems.length){console.error('Trial preflight failed:\n - '+problems.join('\n - '));process.exit(1);}
 console.log(`PASS: trial preflight for ${origin.origin}: HTTPS origin, D1 id, ${logins.length} GitHub guest(s), password sign-up closed, invocation logs off, fresh build.`);
}else if(command==='smoke'){
 const origin=new URL(arg??'').origin;assert.ok(origin.startsWith('https://'),'Usage: node scripts/cloud-trial.mjs smoke https://<trial-origin>');
 const get=(p,init)=>fetch(origin+p,{redirect:'manual',...init});
 const home=await get('/');check(home.status===200&&home.headers.get('content-type')?.includes('text/html'),'Home page did not load');
 for(const h of['strict-transport-security','x-content-type-options','x-frame-options','content-security-policy'])check(home.headers.has(h),`Home page is missing ${h}`);
 for(const p of['/api/t3/threads','/api/t3/status','/api/board','/.env'])check((await get(p)).status===404,`${p} must be 404`);
 check((await get('/api/building/session')).status===401,'Anonymous /session must be 401');
 const providers=await get('/api/building/auth/providers');const body=await providers.json().catch(()=>null);check(providers.status===200&&body?.github===true,'GitHub sign-in is not configured (check the two secrets)');
 check(providers.headers.getSetCookie().every(c=>/; Secure/.test(c)&&/HttpOnly/.test(c)),'Cookies must be Secure and HttpOnly');
 check((await get('/api/building/register',{method:'POST',headers:{'Content-Type':'application/json',Origin:origin},body:JSON.stringify({handle:'smoke_probe',name:'Smoke',password:'smoke-probe-password'})})).status===403,'Password sign-up must be closed');
 check((await get('/api/building/session',{headers:{Origin:'https://evil.example'}})).status===403,'Cross-origin API requests must be refused');
 if(problems.length){console.error('Trial smoke failed:\n - '+problems.join('\n - '));process.exit(1);}
 console.log(`PASS: trial smoke for ${origin}: page and security headers, private routes 404, anonymous API locked, GitHub configured, Secure cookies, sign-up closed, cross-origin refused.`);
}else{console.error('Usage: node scripts/cloud-trial.mjs preflight | smoke <https-origin>');process.exit(2);}

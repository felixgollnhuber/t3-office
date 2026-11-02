/** Hosted-trial configuration of the Worker: single HTTPS origin, Secure cookies, per-client/per-handle limits (no global lockout), sign-up switch, GitHub guest list and API off-switch. Synthetic data and a simulated GitHub only. */
import assert from'node:assert/strict';import{cloudFixture}from'./cloud-test-harness.mjs';
const HOST='https://office.example.test';const password='synthetic-hosted-password';let count=0;
const ip=a=>({'CF-Connecting-IP':a});

// 1. Origin rules, Secure cookies.
let f=await cloudFixture({origin:HOST});
try{
 const r=await f.call(f.jar(),'/register','POST',{handle:'hosted_owner',name:'Owner',password});assert.equal(r.status,201);
 assert.ok(r.cookies.length&&r.cookies.every(c=>/; Secure(;|$)/.test(c)&&/HttpOnly/.test(c)&&/SameSite=Strict/.test(c)),'Session cookie must be Secure, HttpOnly, SameSite=Strict on HTTPS');
 for(const other of['http://office.example.test','https://evil.example.test','https://office.example.test.evil.example'])assert.equal((await f.mf.dispatchFetch(other+'/api/building/session')).status,503,other);
 assert.equal((await f.mf.dispatchFetch(HOST+'/api/building/invites',{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://evil.example.test'},body:'{}'})).status,403);count++;
}finally{await f.close();}
f=await cloudFixture({origin:'http://office.example.test'});
try{assert.equal((await f.call(f.jar(),'/register','POST',{handle:'plain_http',name:'X',password})).status,503,'Non-loopback HTTP must fail closed');count++;}finally{await f.close();}
f=await cloudFixture();
try{const r=await f.call(f.jar(),'/register','POST',{handle:'local_dev',name:'Dev',password});assert.equal(r.status,201);assert.ok(r.cookies.every(c=>!/Secure/.test(c)),'Loopback development keeps plain cookies');count++;}finally{await f.close();}

// 2. Limits are per connection and per handle: one caller cannot lock everyone out.
f=await cloudFixture({origin:HOST});
try{
 const reg=(c,handle,addr)=>f.call(c,'/register','POST',{handle,name:handle,password},ip(addr));
 for(let i=0;i<10;i++)assert.equal((await reg(f.jar(),'many_'+i,'203.0.113.1')).status,201);
 assert.equal((await reg(f.jar(),'many_10','203.0.113.1')).status,429,'Daily account creation is limited per connection');
 assert.equal((await reg(f.jar(),'victim','198.51.100.7')).status,201,'Other connections can still register');
 // A stranger hammering logins from one address is stopped without blocking the real user elsewhere.
 const login=(handle,pass,addr)=>f.call(f.jar(),'/login','POST',{handle,password:pass},ip(addr));
 let blocked=false;for(let i=0;i<25&&!blocked;i++){const s=(await login('nobody_'+i,'synthetic-wrong-guess',"192.0.2.66")).status;if(s===429)blocked=true;else assert.equal(s,401);}assert.ok(blocked,'Per-connection sign-in limit applies');
 assert.equal((await login('victim',password,'198.51.100.7')).status,200,'A different connection is unaffected');
 // Guessing one account's password from many addresses is limited per handle.
 let handleBlocked=false;for(let i=0;i<12&&!handleBlocked;i++){const s=(await login('many_0','synthetic-wrong-guess','192.0.2.'+(100+i))).status;if(s===429)handleBlocked=true;else assert.equal(s,401);}assert.ok(handleBlocked,'Per-account sign-in limit applies');
 assert.equal((await login('victim',password,'198.51.100.8')).status,200,'Other accounts are unaffected');count++;
}finally{await f.close();}

// 3. Trial switches: password sign-up closed, API off-switch.
f=await cloudFixture({origin:HOST,bindings:{ALLOW_PASSWORD_SIGNUP:'0',GITHUB_CLIENT_ID:'synthetic-client',GITHUB_CLIENT_SECRET:'synthetic-secret'}});
try{const r=await f.call(f.jar(),'/register','POST',{handle:'closed_signup',name:'X',password});assert.equal(r.status,403);assert.match(r.data.error,/GitHub/);const c=f.jar();await f.call(c,'/auth/providers');assert.equal((await f.call(c,'/login','POST',{handle:'closed_signup',password})).status,401,'Sign-in itself stays available');count++;}finally{await f.close();}
f=await cloudFixture({origin:HOST,bindings:{API_OPEN:'0'}});
try{const r=await f.call(f.jar(),'/session');assert.equal(r.status,503);assert.match(r.data.error,/maintenance/);assert.equal((await f.call(f.jar(),'/register','POST',{handle:'off_switch',name:'X',password})).status,503);count++;}finally{await f.close();}

// 4. GitHub guest list and per-connection sign-in contexts.
let login='synthetic-octo';const provider=async req=>{const url=new URL(req.url);assert.ok(['github.com','api.github.com'].includes(url.hostname));if(url.pathname.includes('access_token'))return Response.json({access_token:'synthetic-token',token_type:'bearer'});return Response.json({id:login==='synthetic-octo'?1001:1002,login,name:'Synthetic '+login});};
f=await cloudFixture({origin:HOST,provider,bindings:{GITHUB_CLIENT_ID:'synthetic-client',GITHUB_CLIENT_SECRET:'synthetic-secret',GITHUB_ALLOWED_LOGINS:' Allowed-Octo , friend-octo '}});
try{
 const signIn=async(addr)=>{const c=f.jar();await f.call(c,'/auth/providers','GET',undefined,ip(addr));const start=await f.call(c,'/auth/github/start','POST',{},ip(addr));assert.equal(start.status,200,JSON.stringify(start.data));const state=new URL(start.data.authorizationUrl).searchParams.get('state');assert.equal((await f.call(c,'/auth/github/callback?'+new URLSearchParams({state,code:'synthetic-code'}),'GET',undefined,ip(addr))).status,303);return c;};
 let c=await signIn('203.0.113.20');const denied=await f.call(c,'/auth/github/confirm','POST',{},ip('203.0.113.20'));assert.equal(denied.status,403);assert.match(denied.data.error,/guest list/);
 assert.equal((await f.db.prepare('SELECT COUNT(*) n FROM users').first()).n,0,'A login outside the guest list never creates an account');assert.equal((await f.call(c,'/auth/github/confirm','POST',{},ip('203.0.113.20'))).status,409,'Denied confirmations cannot be retried');
 login='allowed-octo';c=await signIn('203.0.113.21');const ok=await f.call(c,'/auth/github/confirm','POST',{},ip('203.0.113.21'));assert.equal(ok.status,200,JSON.stringify(ok.data));assert.ok(ok.cookies.some(v=>v.startsWith('office_cloud_session=')&&/; Secure/.test(v)));count++;
 let limited=false;for(let i=0;i<25&&!limited;i++){if((await f.call(f.jar(),'/auth/providers','GET',undefined,ip('192.0.2.77'))).status===429)limited=true;}assert.ok(limited,'New sign-in contexts are limited per connection');
 assert.equal((await f.call(f.jar(),'/auth/providers','GET',undefined,ip('198.51.100.30'))).status,200,'Other connections still get a sign-in context');count++;
}finally{await f.close();}
console.log(`PASS: ${count} hosted-trial scenarios: single HTTPS origin and fail-closed HTTP/other hosts, Secure cookies, per-connection and per-account limits without global lockout, sign-up switch, API off-switch, GitHub guest list and per-connection sign-in contexts.`);

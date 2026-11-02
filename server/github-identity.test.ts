/** Synthetic OAuth responses only. Never contacts GitHub or reads real credentials. */
import assert from 'node:assert/strict';import{test}from'node:test';
import{GitHubIdentityBroker,IdentityError,type GitHubIdentityConfig}from'./github-identity.ts';
const config:GitHubIdentityConfig={clientId:'synthetic-client',clientSecret:'synthetic-secret',callbackUrl:'http://localhost:5173/api/building/auth/github/callback'};
const reply=(v:unknown,status=200)=>new Response(JSON.stringify(v),{status});
const setup=()=>{let now=1000;const calls:{url:string;init:RequestInit}[]=[];const transport=async(url:string,init:RequestInit)=>{calls.push({url,init});return url.includes('access_token')?reply({access_token:'synthetic-provider-token',token_type:'bearer'}):reply({id:12345,login:'synthetic-user',name:'Public Name',email:'private@example.test',private_repos:999});};return{broker:new GitHubIdentityBroker(config,transport,()=>now),calls,advance:(ms:number)=>{now+=ms;}};};
const callback=(start:{authorizationUrl:string;browserToken:string})=>({state:new URL(start.authorizationUrl).searchParams.get('state'),code:'synthetic-code',browserToken:start.browserToken});
const rejected=(p:Promise<unknown>,code:string)=>assert.rejects(p,e=>e instanceof IdentityError&&e.code===code);
test('GitHub foundation requests identity only with S256 and returns a bounded public allowlist',async()=>{
 const f=setup(),start=await f.broker.begin(),url=new URL(start.authorizationUrl);assert.equal(url.origin,'https://github.com');assert.equal(url.searchParams.get('scope'),'');assert.equal(url.searchParams.get('code_challenge_method'),'S256');assert.equal(url.searchParams.get('allow_signup'),'false');assert.equal(start.expiresAt,601000);
 const identity=await f.broker.complete(callback(start));assert.deepEqual(identity,{provider:'github',subject:'12345',login:'synthetic-user',displayName:'Public Name'});assert.equal(f.calls.length,2);
 const body=f.calls[0].init.body as URLSearchParams;const challenge=Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(body.get('code_verifier')!))).toString('base64url');assert.equal(challenge,url.searchParams.get('code_challenge'));assert.equal(body.get('client_secret'),'synthetic-secret');assert.equal(body.get('redirect_uri'),config.callbackUrl);assert.equal(body.get('code'),'synthetic-code');
 for(const c of f.calls){assert.equal(c.init.redirect,'error');assert.ok(c.init.signal instanceof AbortSignal);}assert.equal(f.calls[1].url,'https://api.github.com/user');assert.equal(new Headers(f.calls[1].init.headers).get('Authorization'),'Bearer synthetic-provider-token');
 assert.equal(JSON.stringify(identity).includes('private'),false);assert.equal(JSON.stringify(identity).includes('token'),false);
});
test('GitHub callback rejects a missing/wrong browser binding or state without contacting a provider',async()=>{
 const f=setup(),start=await f.broker.begin(),valid=callback(start);
 for(const input of[{...valid,state:null},{...valid,browserToken:''},{...valid,browserToken:'x'.repeat(43)},{...valid,state:'y'.repeat(43)},{...valid,code:'bad\ncode'},{...valid,code:'x'.repeat(513)}])await rejected(f.broker.complete(input),'state');
 assert.equal(f.calls.length,0);assert.equal((await f.broker.complete(valid)).subject,'12345');
});
test('GitHub challenges expire and are one-use, including simultaneous callbacks',async()=>{
 const f=setup(),a=await f.broker.begin();f.advance(600000);await rejected(f.broker.complete(callback(a)),'state');assert.equal(f.calls.length,0);
 const b=callback(await f.broker.begin());const results=await Promise.allSettled([f.broker.complete(b),f.broker.complete(b)]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(f.calls.length,2);await rejected(f.broker.complete(b),'state');
});
test('GitHub pending storage has a hard cap and recovers after expiry',async()=>{
 const f=setup();await Promise.all(Array.from({length:100},()=>f.broker.begin()));await rejected(f.broker.begin(),'capacity');f.advance(600001);await f.broker.begin();
});
test('GitHub configuration forbids insecure remote callbacks, credentials and callback redirection',()=>{
 for(const callbackUrl of['http://example.test/api/building/auth/github/callback','https://u:p@example.test/api/building/auth/github/callback','https://example.test/other','https://example.test/api/building/auth/github/callback?next=https://evil.test','https://example.test/api/building/auth/github/callback#fragment','file:///api/building/auth/github/callback'])assert.throws(()=>new GitHubIdentityBroker({...config,callbackUrl}),IdentityError);
 for(const callbackUrl of['https://office.example.test/api/building/auth/github/callback','http://127.0.0.1:5173/api/building/auth/github/callback','http://[::1]:5173/api/building/auth/github/callback'])assert.doesNotThrow(()=>new GitHubIdentityBroker({...config,callbackUrl}));
 assert.throws(()=>new GitHubIdentityBroker({...config,clientSecret:''}),IdentityError);
});
test('GitHub provider failure is sanitized and consumes the attempt instead of retrying automatically',async()=>{
 for(const response of[reply({error:'private-provider-detail synthetic-secret'},401),reply({access_token:'synthetic-token',token_type:'mac'}),new Response('not json'),new Response('x'.repeat(17000))]){
  const broker=new GitHubIdentityBroker(config,async()=>response),input=callback(await broker.begin());try{await broker.complete(input);assert.fail('must fail');}catch(e){assert.ok(e instanceof IdentityError);assert.equal(e.code,'provider');assert.equal(e.message.includes('synthetic'),false);}await rejected(broker.complete(input),'state');
 }
 const broker=new GitHubIdentityBroker(config,async()=>{throw new Error('synthetic-token leaked by provider');});await rejected(broker.complete(callback(await broker.begin())),'provider');
});
test('GitHub validates subject and login; provider username changes do not change stable identity',async()=>{
 for(const user of[{id:0,login:'valid'},{id:1.5,login:'valid'},{id:Number.MAX_SAFE_INTEGER+1,login:'valid'},{id:'123',login:'valid'},{id:1,login:'<script>'},{id:1,login:'x'.repeat(40)}]){
  const broker=new GitHubIdentityBroker(config,async url=>url.includes('access_token')?reply({access_token:'synthetic-token',token_type:'bearer'}):reply(user));await rejected(broker.complete(callback(await broker.begin())),'provider');
 }
 let login='before';const broker=new GitHubIdentityBroker(config,async url=>url.includes('access_token')?reply({access_token:'synthetic-token',token_type:'Bearer'}):reply({id:42,login,name:'\u0000 Public \nName'}));const a=await broker.complete(callback(await broker.begin()));login='after';const b=await broker.complete(callback(await broker.begin()));assert.equal(a.subject,b.subject);assert.notEqual(a.login,b.login);assert.equal(a.displayName.includes('\n'),false);
});
test('GitHub profile response size is bounded and untrusted redirects are not followed',async()=>{
 const broker=new GitHubIdentityBroker(config,async url=>url.includes('access_token')?reply({access_token:'synthetic-token',token_type:'bearer'}):new Response('x'.repeat(66000)));await rejected(broker.complete(callback(await broker.begin())),'provider');
 const redirect=new GitHubIdentityBroker(config,async()=>new Response(null,{status:302,headers:{Location:'https://evil.test'}}));await rejected(redirect.complete(callback(await redirect.begin())),'provider');
});


test('GitHub network and slow response bodies have hard deadlines even for a custom transport',async()=>{
 const hanging=new GitHubIdentityBroker(config,async()=>new Promise<Response>(()=>{}));const a=callback(await hanging.begin());const before=Date.now();await rejected(hanging.complete(a),'provider');assert.ok(Date.now()-before<11000);await rejected(hanging.complete(a),'state');
 let cancelled=false;const slow=new GitHubIdentityBroker(config,async()=>new Response(new ReadableStream({start(controller){controller.enqueue(new TextEncoder().encode('{'));},cancel(){cancelled=true;}})));const start=Date.now();await rejected(slow.complete(callback(await slow.begin())),'provider');assert.ok(Date.now()-start<11000);assert.equal(cancelled,true);
});


test('GitHub consent cancellation consumes only the bound attempt and never exchanges a token',async()=>{
 const f=setup(),start=await f.broker.begin(),input=callback(start);await rejected(f.broker.cancel({...input,browserToken:'x'.repeat(43)}),'state');await f.broker.cancel(input);assert.equal(f.calls.length,0);await rejected(f.broker.complete(input),'state');await rejected(f.broker.cancel(input),'state');
 const next=callback(await f.broker.begin());const race=await Promise.allSettled([f.broker.cancel(next),f.broker.complete(next)]);assert.equal(race.filter(v=>v.status==='fulfilled').length,1);assert.ok(f.calls.length===0||f.calls.length===2);
});


test('GitHub callback snapshots validated fields before asynchronous verification',async()=>{
 const f=setup(),input=callback(await f.broker.begin());const completion=f.broker.complete(input);input.code='mutated-after-validation';input.state='x'.repeat(43);input.browserToken='y'.repeat(43);assert.equal((await completion).subject,'12345');assert.equal((f.calls[0].init.body as URLSearchParams).get('code'),'synthetic-code');
});

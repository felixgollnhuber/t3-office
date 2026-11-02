/** Gated local HTTP integration. Callback stages public identity; explicit same-origin confirmation creates a session. */
import{randomBytes,randomUUID,createHash}from'node:crypto';import type{IncomingMessage,ServerResponse}from'node:http';import type{DatabaseSync}from'node:sqlite';
import{GitHubIdentityBroker,IdentityError,type GitHubIdentity}from'./github-identity.ts';
type User={id:string;handle:string;name:string};
type Context={req:IncomingMessage;res:ServerResponse;route:string;method:string;body:()=>Promise<Record<string,unknown>>;reply:(status:number,data:unknown)=>void;fail:(status:number,message:string)=>never;current:()=>User|null;limit:()=>void;startSession:(user:User)=>void};
const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
const nonce=()=>randomBytes(32).toString('base64url');
const BIND='office_github_login',FINISH='office_github_confirm',DEVICE='office_auth_context',PATH='/';
function appendCookie(res:ServerResponse,value:string){const previous=res.getHeader('Set-Cookie');res.setHeader('Set-Cookie',[...(Array.isArray(previous)?previous:previous?[String(previous)]:[]),value]);}
const readCookie=(req:IncomingMessage,key:string)=>req.headers.cookie?.split(';').map(v=>v.trim()).find(v=>v.startsWith(key+'='))?.slice(key.length+1)??'';
export function githubLogin(db:DatabaseSync,broker:GitHubIdentityBroker|undefined,now:()=>number){
 db.exec("CREATE TABLE IF NOT EXISTS external_identities(provider TEXT NOT NULL CHECK(provider='github'),subject TEXT NOT NULL,user TEXT NOT NULL REFERENCES users(id),login TEXT NOT NULL,PRIMARY KEY(provider,subject),UNIQUE(provider,user))");
 type Device={version:number;expires:number};type Intent={key:string;entry:Device;version:number};const devices=new Map<string,Device>();
 type Attempt={intent:Intent;expires:number;stage:'pending'|'callback'|'confirmed'};const active=new Map<string,Attempt>();
 const pending=new Map<string,{identity:GitHubIdentity;expires:number;binding:string;attempt:Attempt}>();
 const cookie=(ctx:Pick<Context,'req'|'res'>,key:string,value:string,age:number,lax=false)=>appendCookie(ctx.res,`${key}=${value}; Path=${PATH}; HttpOnly; SameSite=${lax?'Lax':'Strict'}; Max-Age=${age}${(ctx.req.socket as {encrypted?:boolean}).encrypted?'; Secure':''}`);
 const clear=(ctx:Pick<Context,'req'|'res'>,key:string)=>cookie(ctx,key,'',0,key===BIND);
 const prune=()=>{for(const[k,v]of devices)if(v.expires<=now())devices.delete(k);for(const[k,v]of active)if(v.expires<=now())active.delete(k);for(const[k,v]of pending)if(v.expires<=now())pending.delete(k);};
 const anonymous=(ctx:Context)=>{if(ctx.current())ctx.fail(409,'An account is already signed in. Sign out before choosing another account. Account linking is not enabled.');};
 const localIntent=(req:IncomingMessage,fail:Context['fail']):Intent|null=>{if(!broker)return null;const key=hash(readCookie(req,DEVICE)),entry=devices.get(key);if(!entry||entry.expires<=now())fail(428,'Refresh sign-in context and try again.');return{key,entry,version:entry.version};};
 const checkIntent=(intent:Intent|null,fail:Context['fail'])=>{if(intent&&(devices.get(intent.key)!==intent.entry||intent.entry.expires<=now()||intent.entry.version!==intent.version))fail(409,'Sign-in context changed. Start again.');};
 const clearProof=(req:IncomingMessage,res:ServerResponse)=>{const deviceKey=hash(readCookie(req,DEVICE)),device=devices.get(deviceKey);if(device)device.version++;for(const[key,value]of active)if(value.intent.key===deviceKey)active.delete(key);for(const[key,value]of pending)if(value.attempt.intent.key===deviceKey)pending.delete(key);pending.delete(hash(readCookie(req,FINISH)));const binding=hash(readCookie(req,BIND));active.delete(binding);for(const[key,value]of pending)if(value.binding===binding)pending.delete(key);clear({req,res},FINISH);clear({req,res},BIND);};
 const handle=async(ctx:Context)=>{
  if(ctx.route!=='/auth/providers'&&!ctx.route.startsWith('/auth/github/'))return false;
  if(ctx.req.headers.authorization)ctx.fail(401,'Publisher credentials cannot sign in.');
  const expected=ctx.route==='/auth/github/start'||ctx.route==='/auth/github/confirm'||ctx.route==='/auth/github/cancel'?'POST':'GET';if(ctx.method!==expected)ctx.fail(405,'Method not allowed.');
  if(ctx.route==='/auth/providers'){if(broker){prune();const existing=devices.get(hash(readCookie(ctx.req,DEVICE)));if(!existing){ctx.limit();if(devices.size>=1000)ctx.fail(429,'Too many sign-in contexts. Try again later.');const value=nonce();devices.set(hash(value),{version:0,expires:now()+604800000});cookie(ctx,DEVICE,value,604800);}}ctx.reply(200,{github:!!broker});return true;}
  if(!broker)ctx.fail(503,'GitHub sign-in is not configured.');
  const target=new URL(broker.callbackUrl),protocol=(ctx.req.socket as {encrypted?:boolean}).encrypted?'https:':'http:';
  if(ctx.req.headers.host!==target.host||protocol!==target.protocol)ctx.fail(403,'GitHub sign-in requires the configured origin.');
  prune();
  let callbackAttempt:{key:string;entry:Attempt}|undefined;
  const currentIntent=(intent:Intent)=>devices.get(intent.key)===intent.entry&&intent.entry.expires>now()&&intent.entry.version===intent.version;
  const validAttempt=()=>!!callbackAttempt&&currentIntent(callbackAttempt.entry.intent)&&active.get(callbackAttempt.key)===callbackAttempt.entry&&callbackAttempt.entry.expires>now();
  try{
   if(ctx.route==='/auth/github/start'){
    ctx.limit();const initial=localIntent(ctx.req,ctx.fail);await ctx.body();checkIntent(initial,ctx.fail);anonymous(ctx);clearProof(ctx.req,ctx.res);if(pending.size>=100||active.size>=100)ctx.fail(429,'Too many sign-in attempts. Try again later.');
    const intent=localIntent(ctx.req,ctx.fail)!;const attempt=await broker.begin();checkIntent(intent,ctx.fail);active.set(hash(attempt.browserToken),{expires:attempt.expiresAt,stage:'pending',intent});cookie(ctx,BIND,attempt.browserToken,600,true);ctx.reply(200,{authorizationUrl:attempt.authorizationUrl});return true;
   }
   if(ctx.route==='/auth/github/callback'){
    ctx.limit();const query=new URL(ctx.req.url??'/',target.origin).searchParams;const input={state:query.get('state'),browserToken:readCookie(ctx.req,BIND)};const key=hash(input.browserToken),entry=active.get(key);if(!entry||entry.stage!=='pending'||!currentIntent(entry.intent))ctx.fail(400,'Sign-in attempt changed or expired. Start again.');entry.stage='callback';callbackAttempt={key,entry};
    if(query.has('error')){await broker.cancel(input);if(!validAttempt())ctx.fail(400,'Sign-in attempt changed or expired. Start again.');active.delete(key);clear(ctx,BIND);ctx.res.statusCode=303;ctx.res.setHeader('Location',target.origin+'/?people=1&github=cancelled');ctx.res.end();return true;}
    const identity=await broker.complete({...input,code:query.get('code')});
    if(!validAttempt()||ctx.res.destroyed)ctx.fail(400,'Sign-in attempt changed or expired. Start again.');entry.stage='confirmed';entry.expires=now()+600000;cookie(ctx,BIND,input.browserToken,600,true);
    if(pending.size>=100)ctx.fail(429,'Too many sign-in attempts. Try again later.');const confirmation=nonce();pending.set(hash(confirmation),{identity,expires:now()+600000,binding:key,attempt:entry});cookie(ctx,FINISH,confirmation,600);
    // No app account or session exists yet. Confirmation uses a fresh same-origin request/cookie set.
    ctx.res.statusCode=303;ctx.res.setHeader('Location',target.origin+'/?people=1&github=confirm');ctx.res.end();return true;
   }
   if(ctx.route==='/auth/github/cancel'){await ctx.body();clearProof(ctx.req,ctx.res);ctx.reply(200,{ok:true});return true;}
   if(ctx.route==='/auth/github/pending'){
    anonymous(ctx);const entry=pending.get(hash(readCookie(ctx.req,FINISH)));if(!entry||!currentIntent(entry.attempt.intent)||entry.binding!==hash(readCookie(ctx.req,BIND))||active.get(entry.binding)!==entry.attempt||entry.attempt.stage!=='confirmed'||entry.attempt.expires<=now())ctx.fail(401,'GitHub confirmation expired. Start sign-in again.');ctx.reply(200,{identity:entry.identity});return true;
   }
   if(ctx.route==='/auth/github/confirm'){
    ctx.limit();const intent=localIntent(ctx.req,ctx.fail);await ctx.body();checkIntent(intent,ctx.fail);anonymous(ctx);const key=hash(readCookie(ctx.req,FINISH)),entry=pending.get(key);if(!entry||!currentIntent(entry.attempt.intent)||entry.binding!==hash(readCookie(ctx.req,BIND))||active.get(entry.binding)!==entry.attempt||entry.attempt.stage!=='confirmed'||entry.attempt.expires<=now())ctx.fail(401,'GitHub confirmation expired. Start sign-in again.');pending.delete(key);active.delete(entry.binding);clear(ctx,FINISH);
    const identity=entry.identity;let user:User;
    db.exec('BEGIN IMMEDIATE');try{
     const existing=db.prepare("SELECT u.id,u.handle,u.name FROM users u JOIN external_identities e ON e.user=u.id WHERE e.provider='github' AND e.subject=?").get(identity.subject) as User|undefined;
     if(existing){user=existing;db.prepare("UPDATE external_identities SET login=? WHERE provider='github' AND subject=?").run(identity.login,identity.subject);}
     else{user={id:randomUUID(),handle:`gh_${identity.subject}_${randomBytes(4).toString('hex')}`,name:identity.displayName};db.prepare('INSERT INTO users VALUES(?,?,?,?,?)').run(user.id,user.handle,user.name,randomBytes(16).toString('hex'),randomBytes(64).toString('hex'));db.prepare('INSERT INTO offices(id,owner,name) VALUES(?,?,?)').run(randomUUID(),user.id,`${user.name}’s office`);db.prepare("INSERT INTO external_identities VALUES('github',?,?,?)").run(identity.subject,user.id,identity.login);}
     db.exec('COMMIT');
    }catch(error){db.exec('ROLLBACK');throw error;}
    ctx.startSession(user);ctx.reply(200,{user});return true;
   }
   ctx.fail(404,'Sign-in endpoint not found.');
  }catch(error){if(error instanceof IdentityError&&error.code==='state'&&validAttempt())callbackAttempt!.entry.stage='pending';if(error instanceof IdentityError&&error.code==='provider'&&ctx.route==='/auth/github/callback'){if(!validAttempt())ctx.fail(400,'Sign-in attempt changed or expired. Start again.');active.delete(callbackAttempt!.key);clear(ctx,BIND);ctx.res.statusCode=303;ctx.res.setHeader('Location',target.origin+'/?people=1&github=failed');ctx.res.end();return true;}if(error instanceof IdentityError)ctx.fail(error.code==='state'?400:error.code==='capacity'?429:502,error.message);throw error;}
 };
 return Object.assign(handle,{clearProof,localIntent,checkIntent});
}

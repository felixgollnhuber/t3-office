/** Local-only permission migration slice. No private companion, OAuth, publication or chat routes. */
import {scrypt,randomBytes,randomUUID,createHash,timingSafeEqual} from 'node:crypto';
import {promisify} from 'node:util';
import {Buffer} from 'node:buffer';
interface Env{DB:D1Database;APP_ORIGIN:string}
type User={id:string;handle:string;name:string};
const derive=promisify(scrypt),DAY=86400000,COOKIE='office_cloud_session';
const hash=(v:string)=>createHash('sha256').update(v).digest('hex');
const nonce=()=>randomBytes(32).toString('base64url');
class Failure extends Error{constructor(readonly status:number,message:string){super(message);}}
function fail(status:number,message:string):never{throw new Failure(status,message);}
function text(v:unknown,max:number,min=1):string{if(typeof v!=='string'||v.trim().length<min||v.length>max||/[\u0000-\u001f\u007f]/.test(v))fail(400,'Invalid text.');return v.trim();}
function password(v:unknown):string{if(typeof v!=='string'||v.length<12||v.length>256)fail(400,'Use a password between12 and256 characters.');return v;}
async function body(req:Request):Promise<Record<string,unknown>>{
 if(req.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase()!=='application/json')fail(415,'Send application/json.');
 const reader=req.body?.getReader();if(!reader)fail(400,'Expected JSON.');const chunks:Uint8Array[]=[];let size=0;const deadline=Date.now()+7000;
 try{while(true){let timer:ReturnType<typeof setTimeout>|undefined;const step=await Promise.race([reader.read(),new Promise<never>((_,reject)=>{timer=setTimeout(()=>{reject(new Failure(408,'Request timed out.'));void reader.cancel().catch(()=>{});},Math.max(0,deadline-Date.now()));})]).finally(()=>clearTimeout(timer));const {done,value}=step;if(done)break;size+=value.byteLength;if(size>32768){await reader.cancel();fail(413,'Request too large.');}chunks.push(value);}}finally{reader.releaseLock();}
 const bytes=new Uint8Array(size);let i=0;for(const chunk of chunks){bytes.set(chunk,i);i+=chunk.byteLength;}
 try{const value=JSON.parse(new TextDecoder().decode(bytes));if(!value||typeof value!=='object'||Array.isArray(value))fail(400,'Expected JSON object.');return value;}catch{fail(400,'Invalid JSON object.');}
}
export default {async fetch(req:Request,env:Env):Promise<Response>{
 const headers=new Headers({'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'});
 const reply=(status:number,data:unknown)=>new Response(JSON.stringify(data),{status,headers});
 try{
  const url=new URL(req.url),origin=new URL(env.APP_ORIGIN);
  // Fail closed even if the prototype is accidentally uploaded. Public hosting is a later gate.
  if(!['localhost','127.0.0.1','[::1]'].includes(origin.hostname)||url.origin!==origin.origin)fail(503,'Local permission prototype only.');
  if(req.headers.has('Authorization'))fail(401,'Publisher credentials are not supported here.');
  if(req.headers.has('Origin')&&req.headers.get('Origin')!==origin.origin)fail(403,'Cross-origin request denied.');
  const base='/api/building',path=url.pathname.startsWith(base+'/')?url.pathname.slice(base.length):'';
  if(!path)fail(404,'Endpoint not found.');const method=req.method;
  const db=env.DB.withSession('first-primary'),sql=(query:string,...values:(string|number)[])=>db.prepare(query).bind(...values);
  const raw=req.headers.get('Cookie')?.split(';').map(v=>v.trim()).find(v=>v.startsWith(COOKIE+'='))?.slice(COOKIE.length+1)??'',token=hash(raw);
  const alive='EXISTS(SELECT 1 FROM sessions WHERE token=? AND user=? AND expires>?)';
  const current=()=>sql('SELECT u.id,u.handle,u.name FROM users u JOIN sessions s ON s.user=u.id WHERE s.token=? AND s.expires>?',token,Date.now()).first<User>();
  const auth=async()=>{const user=await current();if(!user)fail(401,'Sign in first.');return user;};
  const cookie=(v:string,age:number)=>headers.append('Set-Cookie',`${COOKIE}=${v}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${age}`);
  const summary=(o:{id:string;name:string;ownerName:string;owner:string;scope?:string},u:User)=>({id:o.id,name:o.name,ownerName:o.ownerName,isOwner:o.owner===u.id,scope:o.owner===u.id?'owner':o.scope,online:false,updatedAt:null,agentCount:0,areas:[]});
  const session=async(u:User)=>{const office=await sql('SELECT id,name FROM offices WHERE owner=?',u.id).first();return{user:u,office:{...office,paused:false}};};
  if(path==='/auth/providers'){if(method!=='GET')fail(405,'Method not allowed.');return reply(200,{github:false});}
  if(path==='/register'||path==='/login'){
   if(method!=='POST')fail(405,'Method not allowed.');
   const key='local-auth';await sql('DELETE FROM auth_limits WHERE expires<=?',Date.now()).run();const rate=await sql('INSERT INTO auth_limits VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1 RETURNING count',key,Date.now()+900000).first<{count:number}>();if(rate!.count>20)fail(429,'Too many sign-in attempts.');
   const input=await body(req),handle=text(input.handle,32,3).toLowerCase(),pass=password(input.password);if(!/^[a-z0-9_-]+$/.test(handle))fail(400,'Invalid handle.');
   const found=await sql('SELECT * FROM users WHERE handle=?',handle).first<User&{salt:string;password:string}>();
   const salt=path==='/register'?randomBytes(16).toString('hex'):found?.salt??'invalid-account-salt';const derived=await derive(pass,salt,64) as Buffer;
   const sessionToken=nonce(),expires=Date.now()+7*DAY;let user:User;
   if(path==='/register'){
    if(found)fail(409,'That handle is already taken.');user={id:randomUUID(),handle,name:text(input.name,60)};
    try{await db.batch([sql('INSERT INTO users VALUES(?,?,?,?,?)',user.id,handle,user.name,salt,derived.toString('hex')),sql('INSERT INTO offices VALUES(?,?,?)',randomUUID(),user.id,`${user.name}’s office`),sql('INSERT INTO sessions VALUES(?,?,?)',hash(sessionToken),user.id,expires)]);}catch(e){if(String(e).includes('UNIQUE'))fail(409,'That handle is already taken.');throw e;}
   }else{if(!found||!timingSafeEqual(derived,Buffer.from(found.password,'hex')))fail(401,'Incorrect handle or password.');user={id:found.id,handle:found.handle,name:found.name};await sql('INSERT INTO sessions VALUES(?,?,?)',hash(sessionToken),user.id,expires).run();}
   cookie(sessionToken,7*DAY/1000);return reply(path==='/register'?201:200,await session(user));
  }
  const u=await auth();
  if(path==='/session'){if(method!=='GET')fail(405,'Method not allowed.');return reply(200,await session(u));}
  if(method==='POST'||method==='DELETE'){const input=await body(req);const again=await auth();if(again.id!==u.id||(input.actorId!==undefined&&input.actorId!==u.id))fail(409,'Account changed.');
   if(path==='/logout'&&method==='POST'){await sql('DELETE FROM sessions WHERE token=?',token).run();cookie('',0);return reply(200,{ok:true});}
   if(path==='/invites'&&method==='POST'){
    if(!['presence','activity'].includes(String(input.scope)))fail(400,'Choose presence or activity.');await sql('DELETE FROM invites WHERE expires<=?',Date.now()).run();const value=nonce(),expiresAt=Date.now()+DAY;
    const result=await sql(`INSERT INTO invites SELECT ?,?,o.id,?,? FROM offices o WHERE o.owner=? AND ${alive} AND (SELECT COUNT(*) FROM invites WHERE office=o.id AND expires>?)<50`,randomUUID(),hash(value),String(input.scope),expiresAt,u.id,token,u.id,Date.now(),Date.now()).run();if(!result.meta.changes)fail(409,'Invitation unavailable.');return reply(201,{token:value,expiresAt});
   }
   if(path==='/accept'&&method==='POST'){
    const invite=hash(text(input.token,100));const results=await db.batch([
     sql(`INSERT INTO grants SELECT ?,i.office,?,i.scope FROM invites i JOIN offices o ON o.id=i.office WHERE i.token=? AND i.expires>? AND o.owner<>? AND ${alive} ON CONFLICT(office,user) DO UPDATE SET scope=excluded.scope RETURNING office AS officeId`,randomUUID(),u.id,invite,Date.now(),u.id,token,u.id,Date.now()),
     sql(`DELETE FROM invites WHERE token=? AND expires>? AND office IN(SELECT id FROM offices WHERE owner<>?) AND ${alive}`,invite,Date.now(),u.id,token,u.id,Date.now())]);
    const accepted=results[0].results[0];if(!accepted)fail(404,'Invitation invalid, expired or already used.');return reply(200,accepted);
   }
   const item=path.match(/^\/(invites|grants)\/([\w-]+)$/);if(item&&method==='DELETE'){const result=await sql(`DELETE FROM ${item[1]} WHERE id=? AND office IN(SELECT id FROM offices WHERE owner=?) AND ${alive}`,item[2],u.id,token,u.id,Date.now()).run();if(!result.meta.changes)fail(404,'Item not found.');return reply(200,{ok:true});}
   fail(404,'Endpoint not implemented in this slice.');
  }
  if(method!=='GET')fail(405,'Method not allowed.');
  if(path==='/floors'){const rows=await sql(`SELECT o.id,o.owner,o.name,u.name ownerName,g.scope FROM offices o JOIN users u ON u.id=o.owner LEFT JOIN grants g ON g.office=o.id AND g.user=? WHERE (o.owner=? OR g.user IS NOT NULL) AND ${alive}`,u.id,u.id,token,u.id,Date.now()).all<{id:string;owner:string;name:string;ownerName:string;scope:string}>();return reply(200,{floors:rows.results.map(o=>summary(o,u))});}
  const office=path.match(/^\/offices\/([\w-]+)$/);if(office){const row=await sql(`SELECT o.id,o.owner,o.name,u.name ownerName,g.scope FROM offices o JOIN users u ON u.id=o.owner LEFT JOIN grants g ON g.office=o.id AND g.user=? WHERE o.id=? AND (o.owner=? OR g.user IS NOT NULL) AND ${alive}`,u.id,office[1],u.id,token,u.id,Date.now()).first<{id:string;owner:string;name:string;ownerName:string;scope:string}>();if(!row)fail(404,'Office not found.');return reply(200,{office:summary(row,u),agents:[]});}
  if(path==='/invites')return reply(200,{invites:(await sql(`SELECT i.id,i.scope,i.expires expiresAt FROM invites i JOIN offices o ON o.id=i.office WHERE o.owner=? AND i.expires>? AND ${alive}`,u.id,Date.now(),token,u.id,Date.now()).all()).results});
  if(path==='/grants')return reply(200,{grants:(await sql(`SELECT g.id,g.scope,u.name userName,u.handle userHandle FROM grants g JOIN offices o ON o.id=g.office JOIN users u ON u.id=g.user WHERE o.owner=? AND ${alive}`,u.id,token,u.id,Date.now()).all()).results});
  fail(404,'Endpoint not implemented in this slice.');
 }catch(e){return reply(e instanceof Failure?e.status:500,{error:e instanceof Failure?e.message:'Permission prototype could not complete the request.'});}
}};

/** Opt-in human rooms. This service never reads agent/provider data. */
import type { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
type User={id:string;name:string;handle:string};type Row=Record<string,string|number|null>;
export function humanSchema(db:DatabaseSync){db.exec(`
 CREATE TABLE IF NOT EXISTS human_profiles(user TEXT PRIMARY KEY REFERENCES users(id),name TEXT NOT NULL,color TEXT NOT NULL,hair TEXT NOT NULL,availability TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS human_rooms(office TEXT PRIMARY KEY REFERENCES offices(id),open INTEGER NOT NULL,dnd INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS human_admissions(office TEXT NOT NULL REFERENCES offices(id),user TEXT NOT NULL REFERENCES users(id),since INTEGER NOT NULL,PRIMARY KEY(office,user));
 CREATE TABLE IF NOT EXISTS human_requests(id TEXT PRIMARY KEY,office TEXT NOT NULL REFERENCES offices(id),user TEXT NOT NULL REFERENCES users(id),created INTEGER NOT NULL,expires INTEGER NOT NULL,status TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS human_cooldown(office TEXT NOT NULL,user TEXT NOT NULL,last INTEGER NOT NULL,PRIMARY KEY(office,user));
 CREATE TABLE IF NOT EXISTS human_presence(user TEXT PRIMARY KEY REFERENCES users(id),office TEXT NOT NULL REFERENCES offices(id),x REAL NOT NULL,z REAL NOT NULL,updated INTEGER NOT NULL,lease TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS human_messages(id TEXT PRIMARY KEY,office TEXT NOT NULL REFERENCES offices(id),user TEXT NOT NULL REFERENCES users(id),name TEXT NOT NULL,body TEXT NOT NULL,created INTEGER NOT NULL,client TEXT NOT NULL,UNIQUE(user,client));
 CREATE INDEX IF NOT EXISTS human_messages_room ON human_messages(office,created);
 CREATE TABLE IF NOT EXISTS human_clock(id INTEGER PRIMARY KEY CHECK(id=1),value INTEGER NOT NULL);
 INSERT OR IGNORE INTO human_clock VALUES(1,0);
 CREATE TABLE IF NOT EXISTS human_receipts(user TEXT NOT NULL,client TEXT NOT NULL,office TEXT NOT NULL,id TEXT NOT NULL,created INTEGER NOT NULL,PRIMARY KEY(user,client));
`);
 const admissions=db.prepare('PRAGMA table_info(human_admissions)').all() as {name:string}[];if(!admissions.some(c=>c.name==='history'))db.exec('ALTER TABLE human_admissions ADD COLUMN history INTEGER NOT NULL DEFAULT 0');
 const messages=db.prepare('PRAGMA table_info(human_messages)').all() as {name:string}[];if(!messages.some(c=>c.name==='seq')){db.exec('ALTER TABLE human_messages ADD COLUMN seq INTEGER NOT NULL DEFAULT 0');db.exec('UPDATE human_messages SET seq=rowid; UPDATE human_clock SET value=MAX(value,COALESCE((SELECT MAX(seq) FROM human_messages),0)) WHERE id=1; UPDATE human_admissions SET history=(SELECT value FROM human_clock WHERE id=1)');}
}
export function revokeHumanAccess(db:DatabaseSync,office:string,user:string){
 for(const table of ['human_admissions','human_requests','human_presence'])db.prepare(`DELETE FROM ${table} WHERE office=? AND user=?`).run(office,user);
}
export function leaveHumanRooms(db:DatabaseSync,user:string){db.prepare('DELETE FROM human_presence WHERE user=?').run(user);}
export async function humanRoute(ctx:{db:DatabaseSync;now:()=>number;user:()=>User;route:string;method:string;body:()=>Promise<Record<string,unknown>>;reply:(status:number,data:unknown)=>void;fail:(status:number,message:string)=>never}){
 const{db,now,route,method,reply,fail}=ctx;
 const one=(sql:string,...v:(string|number)[])=>db.prepare(sql).get(...v) as Row|undefined;
 const all=(sql:string,...v:(string|number)[])=>db.prepare(sql).all(...v) as Row[];
 const run=(sql:string,...v:(string|number)[])=>db.prepare(sql).run(...v);
 const text=(v:unknown,max:number)=>{if(typeof v!=='string'||!v.trim()||v.length>max||/[\u0000-\u0008\u000b-\u001f\u007f]/.test(v))fail(400,'Use a short visible name or message.');return(v as string).trim();};
 const profile=(id:string)=>{const p=one('SELECT * FROM human_profiles WHERE user=?',id);return{id,name:p?.name??one('SELECT name FROM users WHERE id=?',id)!.name,color:p?.color??'sky',hair:p?.hair??'short',availability:p?.availability??'available'};};
 const room=(id:string)=>{const o=one('SELECT id,name,owner FROM offices WHERE id=?',id);if(!o)fail(404,'Office unavailable.');return o!;};
 const grant=(id:string,user:string)=>!!one('SELECT id FROM grants WHERE office=? AND user=?',id,user);
 const settings=(id:string)=>{const p=one('SELECT open,dnd FROM human_rooms WHERE office=?',id);return{open:!!p?.open,dnd:!!p?.dnd};};
 const admitted=(id:string,user:string)=>{const o=room(id);return o.owner===user||(settings(id).open&&grant(id,user)&&!!one('SELECT user FROM human_admissions WHERE office=? AND user=?',id,user));};
 const allowed=(id:string,user:string)=>{const o=room(id);if(o.owner!==user&&!grant(id,user))fail(404,'Office unavailable.');return o;};
 const member=(id:string,user:string)=>{if(!admitted(id,user))fail(403,'Ask the host to admit you to this conversation.');const p=one('SELECT * FROM human_presence WHERE office=? AND user=? AND updated>?',id,user,now()-20_000);if(!p)fail(403,'Enter the conversation room first.');return p!;};
 const lease=(p:Row,input:Record<string,unknown>)=>{if(input.lease!==p.lease)fail(409,'This room is active in another tab. Enter again to take control.');};
 const prune=()=>{run('DELETE FROM human_presence WHERE updated<=?',now()-20_000);run('DELETE FROM human_requests WHERE expires<=?',now());run('DELETE FROM human_messages WHERE created<?',now()-7*86_400_000);run('DELETE FROM human_cooldown WHERE last<?',now()-86_400_000);run('DELETE FROM human_receipts WHERE created<?',now()-7*86_400_000);
  run('DELETE FROM human_admissions WHERE NOT EXISTS(SELECT 1 FROM grants g WHERE g.office=human_admissions.office AND g.user=human_admissions.user)');
  run('DELETE FROM human_presence WHERE NOT EXISTS(SELECT 1 FROM offices o WHERE o.id=human_presence.office AND (o.owner=human_presence.user OR EXISTS(SELECT 1 FROM human_admissions a JOIN human_rooms r ON r.office=a.office WHERE a.office=o.id AND a.user=human_presence.user AND r.open=1)))');
  run('DELETE FROM human_requests WHERE NOT EXISTS(SELECT 1 FROM grants g WHERE g.office=human_requests.office AND g.user=human_requests.user)');
 };
 prune();
 if(route==='/human'){
  if(method==='GET')return reply(200,{viewerId:ctx.user().id,profile:profile(ctx.user().id)});
  if(method!=='POST')fail(405,'Method not allowed.');const input=await ctx.body(),u=ctx.user();
  const name=text(input.name,32);if(/[\r\n\t]/.test(name)||!['sky','sage','amber','rose','violet'].includes(String(input.color))||!['short','long','curly','cap'].includes(String(input.hair))||!['available','busy','away'].includes(String(input.availability)))fail(400,'Choose a valid human appearance and availability.');
  run('INSERT INTO human_profiles VALUES(?,?,?,?,?) ON CONFLICT(user) DO UPDATE SET name=excluded.name,color=excluded.color,hair=excluded.hair,availability=excluded.availability',u.id,name,String(input.color),String(input.hair),String(input.availability));return reply(200,{viewerId:u.id,profile:profile(u.id)});
 }
 if(route==='/rooms'){
  if(method!=='GET')fail(405,'Method not allowed.');const u=ctx.user();const rooms=all('SELECT o.id,o.name,o.owner FROM offices o WHERE o.owner=? OR EXISTS(SELECT 1 FROM grants g WHERE g.office=o.id AND g.user=?) ORDER BY o.owner=? DESC,o.name',u.id,u.id,u.id).map(o=>{
   const id=String(o.id),r=one('SELECT id,status FROM human_requests WHERE office=? AND user=? ORDER BY created DESC LIMIT 1',id,u.id);
   return{id,name:o.name,ownerName:one('SELECT name FROM users WHERE id=?',String(o.owner))!.name,isOwner:o.owner===u.id,...settings(id),admitted:admitted(id,u.id),present:!!one('SELECT user FROM human_presence WHERE office=? AND user=?',id,u.id),request:r?{id:r.id,status:r.status}:null};});
  return reply(200,{viewerId:u.id,rooms});
 }
 const m=route.match(/^\/rooms\/([\w-]+)(?:\/(settings|request|requests|enter|presence|leave|state|messages|kick)(?:\/([\w-]+)(?:\/(accept|decline))?)?)?$/);
 if(!m)fail(404,'Room endpoint unavailable.');const id=m![1],action=m![2],target=m![3],choice=m![4];
 let input:Record<string,unknown>={};if(method!=='GET'){input=await ctx.body();prune();}const u=ctx.user(),o=allowed(id,u.id);const owner=o.owner===u.id;
 const requireMethod=(want:string)=>{if(method!==want)fail(405,'Method not allowed.');};
 const requireOwner=()=>{if(!owner)fail(404,'Room control unavailable.');};
 if(action==='settings'){
  requireMethod('POST');requireOwner();if(typeof input.open!=='boolean'||typeof input.dnd!=='boolean')fail(400,'Choose room settings.');
  run('INSERT INTO human_rooms VALUES(?,?,?) ON CONFLICT(office) DO UPDATE SET open=excluded.open,dnd=excluded.dnd',id,Number(input.open),Number(input.dnd));
  if(!input.open){run('DELETE FROM human_admissions WHERE office=?',id);run('DELETE FROM human_presence WHERE office=? AND user<>?',id,u.id);}
  if(!input.open||input.dnd)run("UPDATE human_requests SET status='declined' WHERE office=? AND status='pending'",id);
  return reply(200,{ok:true});
 }
 if(action==='request'){
  requireMethod('POST');if(owner||admitted(id,u.id))fail(409,'You can already enter this room.');const s=settings(id);if(!s.open||s.dnd)fail(409,'The host is not accepting visits.');
  if(one('SELECT last FROM human_cooldown WHERE office=? AND user=? AND last>?',id,u.id,now()-60_000))fail(429,'Wait one minute before asking again.');
  if(Number(one("SELECT COUNT(*) AS n FROM human_requests WHERE office=? AND status='pending'",id)!.n)>=12)fail(429,'The host has enough pending visits.');
  const rid=randomUUID();run('INSERT INTO human_requests VALUES(?,?,?,?,?,?)',rid,id,u.id,now(),now()+120_000,'pending');run('INSERT INTO human_cooldown VALUES(?,?,?) ON CONFLICT(office,user) DO UPDATE SET last=excluded.last',id,u.id,now());return reply(201,{id:rid});
 }
 if(action==='requests'){
  if(method==='GET'){requireOwner();return reply(200,{viewerId:u.id,requests:all("SELECT id,user,expires FROM human_requests WHERE office=? AND status='pending' ORDER BY created",id).map(r=>({id:r.id,name:profile(String(r.user)).name,expiresAt:r.expires}))});}
  if(method==='DELETE'){const r=one('SELECT user FROM human_requests WHERE office=? AND id=?',id,target??'');if(!r||r.user!==u.id)fail(404,'Request unavailable.');run('DELETE FROM human_requests WHERE id=?',target!);return reply(200,{ok:true});}
  requireMethod('POST');requireOwner();const r=one("SELECT * FROM human_requests WHERE office=? AND id=? AND status='pending'",id,target??'');if(!r)fail(404,'Request unavailable.');
  if(choice==='decline'){run("UPDATE human_requests SET status='declined' WHERE id=?",String(r!.id));return reply(200,{ok:true});}
  if(choice!=='accept')fail(404,'Action unavailable.');const s=settings(id);if(!s.open||s.dnd||!grant(id,String(r!.user)))fail(403,'Admission unavailable.');
  if(Number(one('SELECT COUNT(*) AS n FROM human_admissions WHERE office=?',id)!.n)>=12)fail(409,'This conversation room is full.');
  run('INSERT INTO human_admissions(office,user,since,history) VALUES(?,?,?,?) ON CONFLICT(office,user) DO NOTHING',id,String(r!.user),now(),Number(one('SELECT value FROM human_clock WHERE id=1')!.value));run("UPDATE human_requests SET status='accepted' WHERE id=?",String(r!.id));return reply(200,{ok:true});
 }
 if(action==='enter'){
  requireMethod('POST');if(!admitted(id,u.id))fail(403,'Ask the host to admit you first.');if(!owner&&settings(id).dnd&&!one('SELECT user FROM human_presence WHERE office=? AND user=? AND updated>?',id,u.id,now()-20_000))fail(409,'The host is not accepting new visits.');const token=randomUUID();
  const positions=all('SELECT x,z FROM human_presence WHERE office=? AND user<>?',id,u.id);
  const x=[0,2,-2,4,-4,6,-6,8,-8,10,-10,12,-12].find(x=>positions.every(p=>Math.hypot(x-Number(p.x),7-Number(p.z))>1))??0;
  run('INSERT INTO human_presence VALUES(?,?,?,?,?,?) ON CONFLICT(user) DO UPDATE SET office=excluded.office,x=excluded.x,z=excluded.z,updated=excluded.updated,lease=excluded.lease',u.id,id,x,7,now(),token);
  return reply(200,{viewerId:u.id,lease:token,x,z:7,officeId:id});
 }
 if(action==='presence'){
  requireMethod('POST');const p=member(id,u.id);lease(p,input);const x=Number(input.x),z=Number(input.z);
  if(typeof input.x!=='number'||typeof input.z!=='number'||!Number.isFinite(x)||!Number.isFinite(z)||x< -12||x>13||z< -8||z>8)fail(400,'Walk within the main office.');
  const elapsed=now()-Number(p.updated);const max=Math.min(20,elapsed/1000*4+.25);const distance=Math.hypot(x-Number(p.x),z-Number(p.z));if(elapsed<100&&distance>.05)fail(429,'Send walking updates at a gentle pace.');if(distance>max)fail(400,'Walk to that position gradually.');
  run('UPDATE human_presence SET x=?,z=?,updated=? WHERE user=? AND office=? AND lease=?',x,z,now(),u.id,id,String(p.lease));return reply(200,{ok:true});
 }
 if(action==='leave'){
  requireMethod('POST');const p=one('SELECT * FROM human_presence WHERE office=? AND user=?',id,u.id);if(p&&input.lease===p.lease)run('DELETE FROM human_presence WHERE user=? AND lease=?',u.id,String(p.lease));return reply(200,{ok:true});
 }
 if(action==='kick'){
  requireMethod('POST');requireOwner();if(!target||target===u.id)fail(400,'Choose a guest.');revokeHumanAccess(db,id,target);return reply(200,{ok:true});
 }
 const p=member(id,u.id);const since=owner?-1:Number(one('SELECT history FROM human_admissions WHERE office=? AND user=?',id,u.id)!.history);
 if(action==='state'){
  requireMethod('GET');return reply(200,{viewerId:u.id,officeId:id,serverNow:now(),lease:p.lease,isOwner:owner,people:all('SELECT user,x,z,updated FROM human_presence WHERE office=? ORDER BY user',id).map(r=>({...profile(String(r.user)),x:r.x,z:r.z})),messages:all('SELECT id,user,name,body,created,client FROM human_messages WHERE office=? AND seq>? ORDER BY seq DESC LIMIT 100',id,since).reverse().map(r=>({id:r.id,userId:r.user,name:r.name,text:r.body,createdAt:r.created,clientId:r.client}))});
 }
 if(action==='messages'){
  if(method==='DELETE'){if(!target)fail(404,'Message unavailable.');const r=one('SELECT user FROM human_messages WHERE id=? AND office=?',target,id);if(!r||(!owner&&r.user!==u.id))fail(404,'Message unavailable.');run('DELETE FROM human_messages WHERE id=?',target);return reply(200,{ok:true});}
  requireMethod('POST');lease(p,input);const body=text(input.text,500),client=text(input.clientId,80);if(!/^[\w-]+$/.test(client))fail(400,'Invalid message identifier.');
  const prior=one('SELECT id,office FROM human_receipts WHERE user=? AND client=?',u.id,client);if(prior){if(prior.office!==id)fail(409,'Message belongs to another room.');return reply(200,{id:prior.id});}
  if(one('SELECT id FROM human_receipts WHERE user=? AND created>?',u.id,now()-1000)||Number(one('SELECT COUNT(*) AS n FROM human_receipts WHERE user=? AND created>?',u.id,now()-60_000)!.n)>=20)fail(429,'Slow down before sending another message.');
  const mid=randomUUID();db.exec('BEGIN IMMEDIATE');try{run('UPDATE human_clock SET value=value+1 WHERE id=1');const seq=Number(one('SELECT value FROM human_clock WHERE id=1')!.value);run('INSERT INTO human_receipts VALUES(?,?,?,?,?)',u.id,client,id,mid,now());run('INSERT INTO human_messages(id,office,user,name,body,created,client,seq) VALUES(?,?,?,?,?,?,?,?)',mid,id,u.id,String(profile(u.id).name),body,now(),client,seq);run('DELETE FROM human_messages WHERE office=? AND id NOT IN(SELECT id FROM human_messages WHERE office=? ORDER BY seq DESC LIMIT 200)',id,id);db.exec('COMMIT');}catch(error){db.exec('ROLLBACK');throw error;}return reply(201,{id:mid});
 }
 fail(404,'Room endpoint unavailable.');
}

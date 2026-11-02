/** D1-backed admitted rooms. Every protected read/write includes current session + room membership predicates. */
import {randomUUID}from'node:crypto';
import{authorizedInput,fail,quote,visibleText,type AuthContext}from'./context';
export async function cloudHumans(ctx:AuthContext):Promise<Response|null>{
 const{sql,db,path,method,user,reply}=ctx;if(path!=='/human'&&path!=='/rooms'&&!path.startsWith('/rooms/'))return null;
 if(ctx.publisher)fail(401,'Publisher credentials cannot access people.');
 // Cleanup uses retention only; it never creates permission or marks a human online.
 await db.batch([sql('DELETE FROM human_presence WHERE updated<=?',Date.now()-20000),sql('DELETE FROM human_requests WHERE expires<=?',Date.now()),sql('DELETE FROM human_messages WHERE created<?',Date.now()-7*86400000),sql('DELETE FROM human_receipts WHERE created<?',Date.now()-7*86400000),sql('DELETE FROM human_cooldown WHERE last<?',Date.now()-86400000)]);
 const uid=quote(user.id),readProfile=`SELECT u.id,COALESCE(p.name,u.name) name,COALESCE(p.color,'sky') color,COALESCE(p.hair,'short') hair,COALESCE(p.availability,'available') availability FROM users u LEFT JOIN human_profiles p ON p.user=u.id`;
 const ownProfile=()=>sql(`${readProfile} WHERE u.id=? AND ${ctx.live()}`,user.id).first();
 if(path==='/human'){
  if(method==='GET'){const profile=await ownProfile();if(!profile)fail(401,'Session expired.');return reply(200,{viewerId:user.id,profile});}
  if(method!=='POST')fail(405,'Method not allowed.');const input=await authorizedInput(ctx),name=visibleText(input.name,32);
  if(!['sky','sage','amber','rose','violet'].includes(String(input.color))||!['short','long','curly','cap'].includes(String(input.hair))||!['available','busy','away'].includes(String(input.availability)))fail(400,'Invalid appearance or availability.');
  if(!(await sql(`INSERT INTO human_profiles SELECT ?,?,?,?,? WHERE ${ctx.live()} ON CONFLICT(user) DO UPDATE SET name=excluded.name,color=excluded.color,hair=excluded.hair,availability=excluded.availability`,user.id,name,String(input.color),String(input.hair),String(input.availability)).run()).meta.changes)fail(401,'Session expired.');return reply(200,{viewerId:user.id,profile:await ownProfile()});
 }
 const access=(office:string)=>`EXISTS(SELECT 1 FROM offices o WHERE o.id=${quote(office)} AND (o.owner=${uid} OR EXISTS(SELECT 1 FROM grants g WHERE g.office=o.id AND g.user=${uid})))`;
 const host=(office:string)=>`EXISTS(SELECT 1 FROM offices WHERE id=${quote(office)} AND owner=${uid})`;
 const admitted=(office:string,who=user.id)=>`EXISTS(SELECT 1 FROM offices o WHERE o.id=${quote(office)} AND (o.owner=${quote(who)} OR EXISTS(SELECT 1 FROM human_admissions a JOIN grants g ON g.office=a.office AND g.user=a.user JOIN human_rooms r ON r.office=a.office WHERE a.office=o.id AND a.user=${quote(who)} AND r.open=1)))`;
 const active=(office:string)=>`EXISTS(SELECT 1 FROM human_presence WHERE office=${quote(office)} AND user=${uid} AND updated>${Date.now()-20000})`;
 const member=(office:string)=>`${ctx.live()} AND ${admitted(office)} AND ${active(office)}`;
 if(path==='/rooms'){
  if(method!=='GET')fail(405,'Method not allowed.');const rows=await sql(`SELECT o.id,o.name,u.name ownerName,o.owner,COALESCE(r.open,0) open,COALESCE(r.dnd,0) dnd,(SELECT history FROM human_admissions a WHERE a.office=o.id AND a.user=?) history,(SELECT id FROM human_requests q WHERE q.office=o.id AND q.user=? ORDER BY created DESC LIMIT 1) requestId,(SELECT status FROM human_requests q WHERE q.office=o.id AND q.user=? ORDER BY created DESC LIMIT 1) requestStatus,EXISTS(SELECT 1 FROM human_presence p WHERE p.office=o.id AND p.user=? AND p.updated>?) present FROM offices o JOIN users u ON u.id=o.owner LEFT JOIN human_rooms r ON r.office=o.id WHERE (o.owner=? OR EXISTS(SELECT 1 FROM grants g WHERE g.office=o.id AND g.user=?)) AND ${ctx.live()}`,user.id,user.id,user.id,user.id,Date.now()-20000,user.id,user.id).all<{id:string;name:string;ownerName:string;owner:string;open:number;dnd:number;history:number|null;present:number;requestId:string|null;requestStatus:string|null}>();
  return reply(200,{viewerId:user.id,rooms:rows.results.map(r=>({id:r.id,name:r.name,ownerName:r.ownerName,isOwner:r.owner===user.id,open:!!r.open,dnd:!!r.dnd,admitted:r.owner===user.id||!!r.open&&r.history!==null,present:!!r.present,request:r.requestId?{id:r.requestId,status:r.requestStatus}:null}))});
 }
 const match=path.match(/^\/rooms\/([-\w]+)\/(settings|request|requests|enter|presence|leave|state|messages|kick)(?:\/([-\w]+)(?:\/(accept|decline))?)?$/);if(!match)fail(404,'Unknown room endpoint.');const[,office,action,target,choice]=match;
 let input:Record<string,unknown>={};if(method!=='GET')input=await authorizedInput(ctx);
 if(!await sql(`SELECT id FROM offices WHERE id=? AND ${ctx.live()} AND ${access(office)}`,office).first())fail(404,'Office unavailable.');
 const ensureMethod=(expected:string)=>{if(method!==expected)fail(405,'Method not allowed.');};
 const own=async()=>{if(!await sql(`SELECT id FROM offices WHERE id=? AND ${host(office)} AND ${ctx.live()}`,office).first())fail(404,'Room control unavailable.');};
 const changed=(result:D1Result)=>{if(!result.meta.changes)fail(403,'Permission changed or operation unavailable.');};
 if(action==='settings'){
  ensureMethod('POST');await own();if(typeof input.open!=='boolean'||typeof input.dnd!=='boolean')fail(400,'Choose room settings.');changed(await sql(`INSERT INTO human_rooms SELECT ?,?,? WHERE ${host(office)} AND ${ctx.live()} ON CONFLICT(office) DO UPDATE SET open=excluded.open,dnd=excluded.dnd`,office,Number(input.open),Number(input.dnd)).run());return reply(200,{ok:true});
 }
 if(action==='request'){
  ensureMethod('POST');if(await sql(`SELECT id FROM offices WHERE ${admitted(office)} AND id=?`,office).first())fail(409,'You can already enter.');const id=randomUUID();
  const valid=`${ctx.live()} AND ${access(office)} AND EXISTS(SELECT 1 FROM human_rooms WHERE office=${quote(office)} AND open=1 AND dnd=0) AND NOT EXISTS(SELECT 1 FROM human_cooldown WHERE office=${quote(office)} AND user=${uid} AND last>${Date.now()-60000}) AND (SELECT COUNT(*) FROM human_requests WHERE office=${quote(office)} AND status='pending' AND expires>${Date.now()})<12`;
  const results=await db.batch([sql(`INSERT INTO human_requests SELECT ?,?,?,?,?, 'pending' WHERE ${valid}`,id,office,user.id,Date.now(),Date.now()+120000),sql('INSERT INTO human_cooldown SELECT office,user,created FROM human_requests WHERE id=? ON CONFLICT(office,user) DO UPDATE SET last=excluded.last',id)]);changed(results[0]);return reply(201,{id});
 }
 if(action==='requests'){
  if(method==='GET'){await own();return reply(200,{viewerId:user.id,requests:(await sql(`SELECT q.id,COALESCE(p.name,u.name) name,q.expires expiresAt FROM human_requests q JOIN users u ON u.id=q.user LEFT JOIN human_profiles p ON p.user=u.id WHERE q.office=? AND q.status='pending' AND q.expires>? AND ${host(office)} AND ${ctx.live()}`,office,Date.now()).all()).results});}
  if(method==='DELETE'){changed(await sql(`DELETE FROM human_requests WHERE id=? AND office=? AND user=? AND ${ctx.live()}`,target??'',office,user.id).run());return reply(200,{ok:true});}
  ensureMethod('POST');await own();if(choice==='decline'){changed(await sql(`UPDATE human_requests SET status='declined' WHERE id=? AND office=? AND status='pending' AND ${host(office)} AND ${ctx.live()}`,target??'',office).run());return reply(200,{ok:true});}
  if(choice!=='accept')fail(404,'Unknown action.');const results=await db.batch([
   sql(`INSERT INTO human_admissions(office,user,history,request) SELECT q.office,q.user,COALESCE((SELECT seq FROM sqlite_sequence WHERE name='human_messages'),0),q.id FROM human_requests q JOIN grants g ON g.office=q.office AND g.user=q.user JOIN human_rooms r ON r.office=q.office WHERE q.id=? AND q.office=? AND q.status='pending' AND q.expires>? AND r.open=1 AND r.dnd=0 AND ${host(office)} AND ${ctx.live()} AND (SELECT COUNT(*) FROM human_admissions WHERE office=q.office)<12 ON CONFLICT(office,user) DO NOTHING`,target??'',office,Date.now()),
   sql(`UPDATE human_requests SET status='accepted' WHERE id=? AND office=? AND status='pending' AND EXISTS(SELECT 1 FROM human_admissions WHERE office=human_requests.office AND user=human_requests.user AND request=human_requests.id) AND ${host(office)} AND ${ctx.live()}`,target??'',office)]);changed(results[0]);return reply(200,{ok:true});
 }
 if(action==='enter'){
  ensureMethod('POST');const lease=randomUUID();changed(await sql(`INSERT INTO human_presence(user,office,x,z,updated,lease) SELECT ?,?,COALESCE((WITH slots(x) AS(VALUES(0),(2),(-2),(4),(-4),(6),(-6),(8),(-8),(10),(-10),(12),(-12)) SELECT x FROM slots WHERE NOT EXISTS(SELECT 1 FROM human_presence p WHERE p.office=${quote(office)} AND p.user<>${uid} AND p.updated>${Date.now()-20000} AND (p.x-slots.x)*(p.x-slots.x)+(p.z-7)*(p.z-7)<1) LIMIT 1),0),7,?,? WHERE ${ctx.live()} AND ${admitted(office)} AND (${host(office)} OR EXISTS(SELECT 1 FROM human_rooms WHERE office=${quote(office)} AND dnd=0) OR ${active(office)}) ON CONFLICT(user) DO UPDATE SET office=excluded.office,x=excluded.x,z=excluded.z,updated=excluded.updated,lease=excluded.lease,budget=0.25`,user.id,office,Date.now(),lease).run());const position=await sql(`SELECT x,z FROM human_presence WHERE user=? AND office=? AND lease=? AND ${ctx.live()}`,user.id,office,lease).first<{x:number;z:number}>();if(!position)fail(409,'Room changed.');return reply(200,{viewerId:user.id,lease,...position,officeId:office});
 }
 if(action==='leave'){
  ensureMethod('POST');await sql(`DELETE FROM human_presence WHERE user=? AND office=? AND lease=? AND ${ctx.live()}`,user.id,office,String(input.lease??'')).run();return reply(200,{ok:true});
 }
 if(action==='kick'){
  ensureMethod('POST');await own();if(!target||target===user.id)fail(400,'Choose a guest.');await db.batch(['human_admissions','human_requests','human_presence'].map(table=>sql(`DELETE FROM ${table} WHERE office=? AND user=? AND ${host(office)} AND ${ctx.live()}`,office,target)));return reply(200,{ok:true});
 }
 if(!await sql(`SELECT user FROM human_presence WHERE office=? AND user=? AND ${member(office)}`,office,user.id).first())fail(403,'Enter an admitted room first.');
 if(action==='presence'){
  ensureMethod('POST');const p=await sql(`SELECT * FROM human_presence WHERE office=? AND user=? AND lease=? AND ${member(office)}`,office,user.id,String(input.lease??'')).first<{x:number;z:number;updated:number;lease:string;budget:number}>();if(!p)fail(409,'Room lease changed.');
  const{x,z}=input;if(typeof x!=='number'||typeof z!=='number'||!Number.isFinite(x)||!Number.isFinite(z)||x< -12||x>13||z< -8||z>8)fail(400,'Walk within the office.');const elapsed=Date.now()-p.updated,distance=Math.hypot(x-p.x,z-p.z);const allowance=Math.min(20,p.budget+elapsed/1000*4);if((elapsed<100&&distance>.05)||distance>allowance+1e-6)fail(400,'Walk gradually.');
  changed(await sql(`UPDATE human_presence SET x=?,z=?,updated=?,budget=? WHERE office=? AND user=? AND lease=? AND updated=? AND ${member(office)}`,x,z,Date.now(),Math.max(0,allowance-distance),office,user.id,p.lease,p.updated).run());return reply(200,{ok:true});
 }
 const history=`CASE WHEN ${host(office)} THEN -1 ELSE (SELECT history FROM human_admissions WHERE office=${quote(office)} AND user=${uid}) END`;
 if(action==='state'){
  ensureMethod('GET');const state=await sql(`SELECT (SELECT lease FROM human_presence WHERE office=o.id AND user=${uid}) lease,(o.owner=${uid}) isOwner,
   (SELECT json_group_array(json_object('id',p.user,'name',COALESCE(h.name,u.name),'color',COALESCE(h.color,'sky'),'hair',COALESCE(h.hair,'short'),'availability',COALESCE(h.availability,'available'),'x',p.x,'z',p.z)) FROM human_presence p JOIN users u ON u.id=p.user LEFT JOIN human_profiles h ON h.user=p.user WHERE p.office=o.id AND p.updated>${Date.now()-20000} AND (p.user=o.owner OR EXISTS(SELECT 1 FROM human_admissions a JOIN grants g ON g.office=a.office AND g.user=a.user JOIN human_rooms r ON r.office=a.office WHERE a.office=o.id AND a.user=p.user AND r.open=1))) people,
   (SELECT json_group_array(json_object('id',m.id,'userId',m.user,'name',m.name,'text',m.body,'createdAt',m.created,'clientId',m.client)) FROM (SELECT * FROM human_messages WHERE office=${quote(office)} AND seq>${history} AND created>${Date.now()-7*86400000} ORDER BY seq DESC LIMIT 100) m) messages
   FROM offices o WHERE o.id=? AND ${member(office)}`,office).first<{lease:string;isOwner:number;people:string;messages:string}>();if(!state)fail(403,'Room permission changed.');return reply(200,{viewerId:user.id,officeId:office,serverNow:Date.now(),lease:state.lease,isOwner:!!state.isOwner,people:JSON.parse(state.people),messages:JSON.parse(state.messages).reverse()});
 }
 if(action==='messages'){
  if(method==='DELETE'){changed(await sql(`DELETE FROM human_messages WHERE id=? AND office=? AND (user=? OR ${host(office)}) AND ${member(office)}`,target??'',office,user.id).run());return reply(200,{ok:true});}
  ensureMethod('POST');if(typeof input.text!=='string'||!input.text.trim()||input.text.length>500||/[\u0000-\u0008\u000b-\u001f\u007f]/.test(input.text))fail(400,'Use a short visible message.');const text=input.text.trim(),client=visibleText(input.clientId,80);if(!/^[-\w]+$/.test(client))fail(400,'Invalid message identifier.');const lease=String(input.lease??'');if(!/^[a-f0-9-]{36}$/i.test(lease))fail(409,'Invalid room lease.');const valid=`${member(office)} AND EXISTS(SELECT 1 FROM human_presence WHERE user=${uid} AND office=${quote(office)} AND lease=${quote(lease)})`;
  if(!await sql(`SELECT user FROM human_presence WHERE user=? AND ${valid}`,user.id).first())fail(409,'Room lease changed.');
  const prior=await sql(`SELECT id,office FROM human_receipts WHERE user=? AND client=? AND ${valid}`,user.id,client).first<{id:string;office:string}>();if(prior){if(prior.office!==office)fail(409,'Message belongs to another room.');return reply(200,{id:prior.id});}
  const mid=randomUUID(),now=Date.now();const results=await db.batch([
   sql(`INSERT OR IGNORE INTO human_receipts SELECT ?,?,?,?,? WHERE ${valid} AND NOT EXISTS(SELECT 1 FROM human_receipts WHERE user=? AND created>?) AND (SELECT COUNT(*) FROM human_receipts WHERE user=? AND created>?)<20`,user.id,client,office,mid,now,user.id,now-1000,user.id,now-60000),
   sql(`INSERT INTO human_messages(id,office,user,name,body,created,client) SELECT r.id,r.office,r.user,COALESCE(p.name,u.name),?,r.created,r.client FROM human_receipts r JOIN users u ON u.id=r.user LEFT JOIN human_profiles p ON p.user=u.id WHERE r.id=? AND ${valid}`,text,mid),
   sql('DELETE FROM human_messages WHERE office=? AND id NOT IN(SELECT id FROM human_messages WHERE office=? ORDER BY seq DESC LIMIT 200)',office,office)
  ]);
  if(results[1].meta.changes)return reply(201,{id:mid});const duplicate=await sql(`SELECT id,office FROM human_receipts WHERE user=? AND client=? AND ${valid}`,user.id,client).first<{id:string;office:string}>();if(duplicate?.office===office)return reply(200,{id:duplicate.id});fail(429,'Slow down or re-enter the room.');
 }
 fail(404,'Room endpoint unavailable.');
}

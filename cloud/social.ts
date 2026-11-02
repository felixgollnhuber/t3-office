/** D1-backed optional focus, moments and doorbell. Social data is explicitly entered/published; it is never inferred from agent work. Every protected read/write carries current-session and grant predicates. */
import{randomUUID}from'node:crypto';
import{authorizedInput,fail,quote,visibleText,type AuthContext,type User}from'./context';
const DAY=86400000,MINUTE=60000,MOMENT_LIMIT=20,FOCUS_LIMIT=24,RING_LIFETIME=120000,RING_COOLDOWN=MINUTE,PENDING_LIMIT=12;
type Member={userId:string;name:string;quiet:number};
type SessionRow={id:string;officeId:string;officeName:string;hostId:string;hostName:string;startedAt:number;endsAt:number;doorbell:'open'|'approval'|'dnd';members:string};
type MomentRow={id:string;officeId:string;officeName:string;ownerName:string;ownerId:string;title:string;kind:string;createdAt:number};
type RingRow={id:string;sessionId:string;requesterName:string;hostName:string;officeName:string;quiet:number;expiresAt:number;status:string;host:string;requester:string};
export type WithMoment={moment?:string|null};
/** Latest owner/activity-visible moment for floor summaries; the caller decides visibility with momentOf. */
export const momentProjection=()=>`(SELECT json_object('id',m.id,'title',m.title,'kind',m.kind,'createdAt',m.created) FROM moments m WHERE m.office=o.id AND m.created>=${Date.now()-7*DAY} ORDER BY m.created DESC,m.id DESC LIMIT 1) moment`;
export const momentOf=(o:{owner:string;scope?:string;moment?:string|null},u:User)=>o.moment&&(o.owner===u.id||o.scope==='activity')?{moment:JSON.parse(o.moment) as unknown}:{};
const isPath=(path:string)=>['/social','/focus','/moments','/doorbell','/doorbell/settings'].includes(path)||/^\/(focus|moments|doorbell)\/[-\w]+(?:\/(?:join|leave|accept|decline))?$/.test(path);
export async function cloudSocial(ctx:AuthContext):Promise<Response|null>{
 const{sql,db,path,method,user,reply}=ctx;if(!isPath(path))return null;
 if(ctx.publisher)fail(401,'Publisher credentials cannot access social features.');
 const uid=quote(user.id),now=()=>Date.now();
 // Retention only: this never creates permission, membership or presence.
 const n=now();await db.batch([
  sql('DELETE FROM focus_sessions WHERE ends<=?',n),
  sql('DELETE FROM doorbell_cooldown WHERE last<?',n-DAY),
  sql('DELETE FROM moments WHERE created<?',n-7*DAY),
  sql('DELETE FROM doorbell_requests WHERE expires<=? OR NOT EXISTS(SELECT 1 FROM focus_sessions f JOIN grants g ON g.office=f.office WHERE f.id=doorbell_requests.session AND g.user=doorbell_requests.requester)',n),
  sql('DELETE FROM focus_members WHERE session NOT IN(SELECT id FROM focus_sessions) OR (NOT EXISTS(SELECT 1 FROM focus_sessions f JOIN offices o ON o.id=f.office WHERE f.id=focus_members.session AND o.owner=focus_members.user) AND NOT EXISTS(SELECT 1 FROM focus_sessions f JOIN grants g ON g.office=f.office WHERE f.id=focus_members.session AND g.user=focus_members.user))')]);
 const alive=async()=>!!await sql(`SELECT 1 ok WHERE ${ctx.live()}`).first();
 const denied=async(status:number,message:string):Promise<never>=>{if(!await alive())fail(401,'Session expired.');return fail(status,message);};
 const ensureMethod=(...allowed:string[])=>{if(!allowed.includes(method))fail(405,'Method not allowed.');};
 const flag=(v:unknown,message:string)=>{if(typeof v!=='boolean')fail(400,message);return Number(v);};
 // Reusable predicates. Callers build them after the request body is consumed so Date.now() and the session are current.
 const access=(office:string)=>`(EXISTS(SELECT 1 FROM offices WHERE id=${office} AND owner=${uid}) OR EXISTS(SELECT 1 FROM grants WHERE office=${office} AND user=${uid}))`;
 const active=(who:string,except='')=>`EXISTS(SELECT 1 FROM focus_members am JOIN focus_sessions af ON af.id=am.session WHERE am.user=${who} AND af.ends>${now()}${except?` AND af.id<>${except}`:''})`;
 const bellOpen=(host:string)=>`EXISTS(SELECT 1 FROM doorbell_prefs WHERE user=${host} AND enabled=1 AND dnd=0)`;
 const sessionSql=(extra='',order='f.started DESC,f.id')=>`SELECT f.id,f.office officeId,o.name officeName,o.owner hostId,hu.name hostName,f.started startedAt,f.ends endsAt,CASE WHEN COALESCE(p.dnd,0)=1 THEN 'dnd' WHEN COALESCE(p.enabled,0)=1 THEN 'approval' ELSE 'open' END doorbell,(SELECT json_group_array(json_object('userId',m.user,'name',mu.name,'quiet',m.quiet)) FROM focus_members m JOIN users mu ON mu.id=m.user WHERE m.session=f.id AND (mu.id=o.owner OR EXISTS(SELECT 1 FROM grants g WHERE g.office=o.id AND g.user=mu.id))) members FROM focus_sessions f JOIN offices o ON o.id=f.office JOIN users hu ON hu.id=o.owner LEFT JOIN doorbell_prefs p ON p.user=o.owner WHERE f.ends>${now()} AND ${access('o.id')} AND ${ctx.live()} ${extra} ORDER BY ${order}`;
 const focus=(r:SessionRow)=>{const members=(JSON.parse(r.members) as Member[]).sort((a,b)=>a.userId<b.userId?-1:1),isHost=r.hostId===user.id,joined=members.some(m=>m.userId===user.id);return{doorbell:r.doorbell,id:r.id,officeId:r.officeId,officeName:r.officeName,hostId:r.hostId,hostName:r.hostName,startedAt:r.startedAt,endsAt:r.endsAt,participantCount:members.length,participants:isHost||joined?members.map(m=>({userId:m.userId,name:m.name,quiet:!!m.quiet})):[],isHost,joined};};
 const momentSql=(extra='',limit=MOMENT_LIMIT)=>`SELECT m.id,m.office officeId,o.name officeName,u.name ownerName,o.owner ownerId,m.title,m.kind,m.created createdAt FROM moments m JOIN offices o ON o.id=m.office JOIN users u ON u.id=o.owner WHERE m.created>=${now()-7*DAY} AND (o.owner=${uid} OR EXISTS(SELECT 1 FROM grants g WHERE g.office=o.id AND g.user=${uid} AND g.scope='activity')) AND ${ctx.live()} ${extra} ORDER BY m.created DESC,m.id DESC LIMIT ${limit}`;
 const moment=(r:MomentRow)=>({id:r.id,officeId:r.officeId,officeName:r.officeName,ownerName:r.ownerName,title:r.title,kind:r.kind,createdAt:r.createdAt,isOwner:r.ownerId===user.id});
 const prefs=()=>sql(`SELECT COALESCE(p.enabled,0) enabled,COALESCE(p.dnd,0) dnd FROM users u LEFT JOIN doorbell_prefs p ON p.user=u.id WHERE u.id=? AND ${ctx.live()}`,user.id);
 const sessionById=async(id:string)=>{const row=await sql(sessionSql('AND f.id=?'),id).first<SessionRow>();return row?focus(row):null;};

 if(path==='/social'){
  ensureMethod('GET');const[check,sessions,moments]=await db.batch([sql(`SELECT 1 ok WHERE ${ctx.live()}`),sql(sessionSql()),sql(momentSql())]);
  if(!check.results.length)fail(401,'Session expired.');
  return reply(200,{viewerId:user.id,serverNow:now(),sessions:(sessions.results as SessionRow[]).map(focus),moments:(moments.results as MomentRow[]).map(moment)});
 }

 if(path==='/focus'){
  ensureMethod('POST');const input=await authorizedInput(ctx);
  if(input.minutes!==25&&input.minutes!==50)fail(400,'Choose a 25 or 50 minute session.');const quiet=flag(input.quiet,'Choose a quiet preference.');
  const id=randomUUID(),started=now(),ends=started+input.minutes*MINUTE;let results:D1Result[];
  try{results=await db.batch([
   sql('DELETE FROM focus_sessions WHERE ends<=?',started),
   sql(`INSERT INTO focus_sessions SELECT ?,o.id,?,? FROM offices o WHERE o.owner=? AND ${ctx.live()} AND NOT EXISTS(SELECT 1 FROM focus_sessions WHERE office=o.id) AND NOT ${active(uid)}`,id,started,ends,user.id),
   sql(`INSERT INTO focus_members SELECT f.id,?,? FROM focus_sessions f JOIN offices o ON o.id=f.office WHERE f.id=? AND o.owner=? AND ${ctx.live()}`,user.id,quiet,id,user.id)]);}
  catch(error){if(String(error).includes('UNIQUE'))await denied(409,'Leave or end your current focus session first.');throw error;}
  if(!results[1].meta.changes||!results[2].meta.changes)await denied(409,'Leave or end your current focus session first.');
  const created=await sessionById(id);if(!created)return denied(409,'Focus session ended.');return reply(201,created);
 }

 const focusMatch=path.match(/^\/focus\/([-\w]+)(?:\/(join|leave))?$/);
 if(focusMatch){
  const[,id,action]=focusMatch;ensureMethod(action?'POST':'DELETE');const input=await authorizedInput(ctx);
  const quiet=action==='join'?flag(input.quiet,'Choose a quiet preference.'):0;
  const selected=await sql(`SELECT f.id,o.owner FROM focus_sessions f JOIN offices o ON o.id=f.office WHERE f.id=? AND f.ends>? AND ${access('o.id')} AND ${ctx.live()}`,id,now()).first<{id:string;owner:string}>();
  if(!selected)return denied(404,'Focus session not found.');const isHost=selected.owner===user.id;
  if(!action){
   if(!isHost)fail(404,'Focus session not found.');
   const mine=`id=? AND ends>${now()} AND office IN(SELECT id FROM offices WHERE owner=${uid}) AND ${ctx.live()}`;
   const results=await db.batch([sql(`DELETE FROM doorbell_requests WHERE session IN(SELECT id FROM focus_sessions WHERE ${mine})`,id),sql(`DELETE FROM focus_members WHERE session IN(SELECT id FROM focus_sessions WHERE ${mine})`,id),sql(`DELETE FROM focus_sessions WHERE ${mine}`,id)]);
   if(!results[2].meta.changes)return denied(404,'Focus session not found.');return reply(200,{ok:true});
  }
  if(action==='leave'){
   if(isHost)fail(409,'End your hosted session instead of leaving it.');
   await sql(`DELETE FROM focus_members WHERE session=? AND user=? AND ${ctx.live()}`,id,user.id).run();if(!await alive())fail(401,'Session expired.');return reply(200,{ok:true});
  }
  // Join: grant gates discovery, the host's doorbell gates new membership, one active session per person, 24 seats.
  const member=`EXISTS(SELECT 1 FROM focus_members WHERE session=f.id AND user=${uid})`;
  const joined=await sql(`INSERT INTO focus_members SELECT f.id,?,? FROM focus_sessions f JOIN offices o ON o.id=f.office WHERE f.id=? AND f.ends>${now()} AND ${access('o.id')} AND ${ctx.live()} AND (o.owner=${uid} OR ${member} OR NOT EXISTS(SELECT 1 FROM doorbell_prefs WHERE user=o.owner AND (enabled=1 OR dnd=1))) AND NOT ${active(uid,'f.id')} AND (${member} OR (SELECT COUNT(*) FROM focus_members WHERE session=f.id)<${FOCUS_LIMIT}) ON CONFLICT(session,user) DO UPDATE SET quiet=excluded.quiet`,user.id,quiet,id).run();
  if(!joined.meta.changes){
   const state=await sql(`SELECT ${active(uid,'?')} busy,${member.replace('f.id','?')} member,(SELECT COUNT(*) FROM focus_members WHERE session=?) seats,EXISTS(SELECT 1 FROM doorbell_prefs WHERE user=? AND (enabled=1 OR dnd=1)) bell`,id,id,id,selected.owner).first<{busy:number;member:number;seats:number;bell:number}>();
   if(state?.bell&&!isHost&&!state.member)return denied(403,'Ring the doorbell and wait for host approval.');
   if(state?.busy)return denied(409,'Leave or end your current focus session first.');
   if(state&&!state.member&&state.seats>=FOCUS_LIMIT)return denied(409,'This focus session is full.');
   return denied(404,'Focus session not found.');
  }
  const result=await sessionById(id);if(!result)return denied(404,'Focus session not found.');return reply(200,result);
 }

 if(path==='/moments'){
  ensureMethod('POST');const input=await authorizedInput(ctx),title=visibleText(input.title,80);
  if(!['shipped','milestone','helped'].includes(String(input.kind)))fail(400,'Choose a milestone type.');
  // Only the owner's own office; every guest scope, including activity, is read-only.
  const id=randomUUID(),created=now(),own='(SELECT id FROM offices WHERE owner=?)';
  const results=await db.batch([
   sql(`INSERT INTO moments SELECT ?,o.id,?,?,? FROM offices o WHERE o.owner=? AND ${ctx.live()}`,id,title,String(input.kind),created,user.id),
   sql(`DELETE FROM moments WHERE office=${own} AND id<>? AND id NOT IN(SELECT id FROM moments WHERE office=${own} AND id<>? ORDER BY created DESC,id DESC LIMIT ${MOMENT_LIMIT-1}) AND EXISTS(SELECT 1 FROM moments WHERE id=?) AND ${ctx.live()}`,user.id,id,user.id,id,id)]);
  if(!results[0].meta.changes)await denied(409,'Milestone unavailable.');
  const row=await sql(momentSql('AND m.id=?',1),id).first<MomentRow>();if(!row)return denied(409,'Milestone unavailable.');return reply(201,moment(row));
 }
 const momentMatch=path.match(/^\/moments\/([-\w]+)$/);
 if(momentMatch){
  ensureMethod('DELETE');await authorizedInput(ctx);
  if(!(await sql(`DELETE FROM moments WHERE id=? AND office IN(SELECT id FROM offices WHERE owner=?) AND ${ctx.live()}`,momentMatch[1],user.id).run()).meta.changes)return denied(404,'Milestone not found.');return reply(200,{ok:true});
 }

 const project=(r:RingRow)=>({id:r.id,sessionId:r.sessionId,requesterName:r.requesterName,hostName:r.hostName,officeName:r.officeName,quiet:!!r.quiet,expiresAt:r.expiresAt,status:r.status});
 if(path==='/doorbell'&&method==='GET'){
  // One transaction: the prefs row doubles as the live-session check.
  const[settings,rings,sessions]=await db.batch([prefs(),
   sql(`SELECT r.id,r.session sessionId,r.requester,r.host,u.name requesterName,h.name hostName,o.name officeName,r.quiet,r.expires expiresAt,r.status FROM doorbell_requests r JOIN users u ON u.id=r.requester JOIN users h ON h.id=r.host JOIN focus_sessions f ON f.id=r.session JOIN offices o ON o.id=f.office WHERE (r.requester=? OR (r.host=? AND r.status='pending')) AND r.expires>? AND f.ends>? AND EXISTS(SELECT 1 FROM grants g WHERE g.office=f.office AND g.user=r.requester) AND ${ctx.live()} ORDER BY r.created DESC,r.id`,user.id,user.id,now(),now()),
   sql(sessionSql(`AND o.owner<>${uid}`))]);
  const own=settings.results[0] as{enabled:number;dnd:number}|undefined;if(!own)fail(401,'Session expired.');
  const list=rings.results as RingRow[];return reply(200,{viewerId:user.id,enabled:!!own.enabled,dnd:!!own.dnd,incoming:list.filter(r=>r.host===user.id).map(project),outgoing:list.filter(r=>r.requester===user.id).map(project),sessions:(sessions.results as SessionRow[]).map(focus)});
 }
 if(path==='/doorbell'){
  ensureMethod('POST');const input=await authorizedInput(ctx),session=visibleText(input.sessionId,80),quiet=flag(input.quiet,'Choose a quiet preference.'),id=randomUUID(),created=now();
  const results=await db.batch([
   sql(`INSERT INTO doorbell_requests SELECT ?,?,o.owner,f.id,?,?,?,'pending' FROM focus_sessions f JOIN offices o ON o.id=f.office WHERE f.id=? AND f.ends>${created} AND o.owner<>${uid} AND EXISTS(SELECT 1 FROM grants WHERE office=o.id AND user=${uid}) AND ${ctx.live()} AND ${bellOpen('o.owner')} AND NOT ${active(uid)} AND NOT EXISTS(SELECT 1 FROM doorbell_cooldown WHERE requester=${uid} AND host=o.owner AND last>${created-RING_COOLDOWN}) AND (SELECT COUNT(*) FROM doorbell_requests WHERE session=f.id AND status='pending' AND expires>${created})<${PENDING_LIMIT}`,id,user.id,quiet,created,created+RING_LIFETIME,session),
   sql('INSERT INTO doorbell_cooldown SELECT requester,host,created FROM doorbell_requests WHERE id=? ON CONFLICT(requester,host) DO UPDATE SET last=excluded.last',id)]);
  if(!results[0].meta.changes){
   const f=await sql(`SELECT o.owner,EXISTS(SELECT 1 FROM doorbell_prefs WHERE user=o.owner AND enabled=1 AND dnd=0) open,EXISTS(SELECT 1 FROM doorbell_cooldown WHERE requester=? AND host=o.owner AND last>?) cooling,${active(uid)} busy FROM focus_sessions f JOIN offices o ON o.id=f.office WHERE f.id=? AND f.ends>? AND o.owner<>? AND EXISTS(SELECT 1 FROM grants WHERE office=o.id AND user=?)`,user.id,created-RING_COOLDOWN,session,created,user.id,user.id).first<{open:number;cooling:number;busy:number}>();
   if(!f)return denied(404,'Session unavailable.');if(!f.open)return denied(409,'The doorbell is unavailable.');if(f.busy)return denied(409,'Leave your current focus session first.');if(f.cooling)return denied(429,'Wait one minute before ringing again.');return denied(429,'The doorbell is busy. Try later.');
  }
  return reply(201,{id});
 }
 if(path==='/doorbell/settings'){
  ensureMethod('POST');const input=await authorizedInput(ctx),enabled=flag(input.enabled,'Choose doorbell and quiet settings.'),dnd=flag(input.dnd,'Choose doorbell and quiet settings.');
  // A trigger declines pending requests in the same statement when the bell turns off or DND turns on.
  if(!(await sql(`INSERT INTO doorbell_prefs SELECT ?,?,? WHERE ${ctx.live()} ON CONFLICT(user) DO UPDATE SET enabled=excluded.enabled,dnd=excluded.dnd`,user.id,enabled,dnd).run()).meta.changes)fail(401,'Session expired.');
  return reply(200,{ok:true});
 }
 const bell=path.match(/^\/doorbell\/([-\w]+)(?:\/(accept|decline))?$/);
 if(bell){
  const[,id,choice]=bell;ensureMethod(choice?'POST':'DELETE');await authorizedInput(ctx);
  if(!choice){
   if(!(await sql(`DELETE FROM doorbell_requests WHERE id=? AND requester=? AND ${ctx.live()}`,id,user.id).run()).meta.changes)return denied(404,'Request unavailable.');return reply(200,{ok:true});
  }
  const t=now(),mine=await sql(`SELECT r.status,r.expires,r.session,r.requester,f.office,f.ends FROM doorbell_requests r LEFT JOIN focus_sessions f ON f.id=r.session WHERE r.id=? AND r.host=? AND r.expires>? AND ${ctx.live()}`,id,user.id,t).first<{status:string;session:string;requester:string;office:string|null;ends:number|null}>();
  if(!mine)return denied(404,'Request unavailable.');if(mine.status!=='pending')fail(409,'Request already handled.');
  if(choice==='decline'){
   if(!(await sql(`UPDATE doorbell_requests SET status='declined' WHERE id=? AND host=? AND status='pending' AND expires>? AND ${ctx.live()}`,id,user.id,t).run()).meta.changes)return denied(409,'Request already handled.');return reply(200,{ok:true});
  }
  // Accept only seats an already-granted friend; it never creates, widens or restores a grant.
  const valid=`r.id=? AND r.host=${uid} AND r.status='pending' AND r.expires>${t} AND f.ends>${t} AND o.owner=${uid} AND ${ctx.live()} AND ${bellOpen(uid)} AND EXISTS(SELECT 1 FROM grants WHERE office=o.id AND user=r.requester)`;
  const results=await db.batch([
   sql(`INSERT INTO focus_members SELECT r.session,r.requester,r.quiet FROM doorbell_requests r JOIN focus_sessions f ON f.id=r.session JOIN offices o ON o.id=f.office WHERE ${valid} AND NOT ${active('r.requester','f.id')} AND (EXISTS(SELECT 1 FROM focus_members WHERE session=f.id AND user=r.requester) OR (SELECT COUNT(*) FROM focus_members WHERE session=f.id)<${FOCUS_LIMIT}) ON CONFLICT(session,user) DO NOTHING`,id),
   sql(`UPDATE doorbell_requests SET status='accepted' WHERE id=? AND EXISTS(SELECT 1 FROM doorbell_requests r JOIN focus_sessions f ON f.id=r.session JOIN offices o ON o.id=f.office JOIN focus_members m ON m.session=r.session AND m.user=r.requester WHERE ${valid})`,id,id)]);
  if(!results[1].meta.changes){
   const f=await sql(`SELECT ${bellOpen(uid)} bell,EXISTS(SELECT 1 FROM grants WHERE office=? AND user=?) granted,${active('?',"?")} busy FROM users WHERE id=?`,mine.office??'',mine.requester,mine.requester,mine.session,user.id).first<{bell:number;granted:number;busy:number}>();
   if(!f?.bell)return denied(409,'The doorbell is silenced.');if(!mine.office||!f.granted||!mine.ends||mine.ends<=t)return denied(404,'Request unavailable.');if(f.busy)return denied(409,'Your friend is already in another session.');return denied(409,'This session is full.');
  }
  return reply(200,{ok:true});
 }
 fail(404,'Unknown social endpoint.');
}

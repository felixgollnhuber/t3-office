import{randomUUID}from'node:crypto';
import{authorizedInput,fail,hash,nonce,quote,visibleText,type AuthContext,type User}from'./context';
export const profileProjection="(SELECT json_group_array(json_object('id',agent,'name',name,'area',area)) FROM characters WHERE office=o.id) profiles";
export type Office={id:string;owner:string;name:string;ownerName:string;scope?:string;paused:number;updated:number|null;agents:string;profiles?:string};
const areas=['general','frontend','backend','design','testing','research','operations'];
export function activitySnapshot(o:Office,u:User){
 const owner=o.owner===u.id,online=!o.paused&&o.updated!==null&&Date.now()-o.updated<45000,visible=owner||(o.scope==='activity'&&online),profiles=JSON.parse(o.profiles??'[]') as {id:string;name:string;area:string}[];
 const agents=visible?(JSON.parse(o.agents) as {id:string;name:string;provider:string;status:string}[]).map(a=>({...a,name:profiles.find(p=>p.id===a.id)?.name??a.name,area:profiles.find(p=>p.id===a.id)?.area??'general'})):[];
 const counts=new Map<string,number>();if(visible&&online)for(const a of agents)counts.set(a.area,(counts.get(a.area)??0)+1);
 return{office:{id:o.id,name:o.name,ownerName:o.ownerName,isOwner:owner,scope:owner?'owner':o.scope,online,...(owner?{paused:!!o.paused}:{}),updatedAt:owner||o.scope==='activity'?o.updated:null,agentCount:agents.length,areas:[...counts].map(([area,count])=>({area,count}))},agents};
}
export async function cloudActivity(ctx:AuthContext):Promise<Response|null>{
 const{sql,db,path,method,user,reply}=ctx;
 if(!['/office','/publish','/characters','/publisher-tokens'].includes(path)&&!/^\/(publisher-tokens|characters)\/[-\w]+$/.test(path))return null;
 if(path==='/characters'&&method==='GET'){const rows=await sql(`SELECT c.agent id,c.name,c.area FROM characters c JOIN offices o ON o.id=c.office WHERE o.owner=? AND ${ctx.live()}`,user.id).all();return reply(200,{characters:rows.results});}
 if(path==='/publisher-tokens'&&method==='GET')return reply(200,{tokens:(await sql(`SELECT id,expires expiresAt FROM publisher_tokens WHERE user=? AND expires>? AND ${ctx.live()}`,user.id,Date.now()).all()).results});
 if(!['POST','DELETE'].includes(method))fail(405,'Method not allowed.');
 const epoch=path==='/publish'?await sql(`SELECT epoch FROM offices WHERE owner=? AND ${ctx.live()}`,user.id).first<{epoch:number}>():null;
 const input=await authorizedInput(ctx);
 if(path==='/publish'&&method==='POST'){
  if(!Array.isArray(input.agents)||input.agents.length>24)fail(400,'Publish up to24 agents.');const seen=new Set<string>();
  const agents=input.agents.map((v,i)=>{if(!v||typeof v!=='object'||Array.isArray(v))fail(400,'Invalid agent.');const a=v as Record<string,unknown>,id=visibleText(a.id,100);if(!/^[-\w]+$/.test(id)||seen.has(id)||!['claude','codex','cursor','gemini'].includes(String(a.provider))||!['running','waiting','idle','failed','completed'].includes(String(a.status)))fail(400,'Invalid or duplicate agent.');seen.add(id);return{id,name:`Agent ${i+1}`,provider:a.provider,status:a.status};});
  const rate=await sql(`INSERT INTO publish_rate SELECT ?,?,1 WHERE ${ctx.live()} AND EXISTS(SELECT 1 FROM offices WHERE owner=? AND paused=0 AND epoch=?) ON CONFLICT(user) DO UPDATE SET count=CASE WHEN publish_rate.window=excluded.window THEN count+1 ELSE 1 END,window=excluded.window RETURNING count`,user.id,Math.floor(Date.now()/1000),user.id,epoch?.epoch??-1).first<{count:number}>();if(!rate)fail(409,'Publishing paused or superseded.');if(rate.count>5)fail(429,'Publish at a gentle pace.');
  const result=await sql(`UPDATE offices SET agents=?,updated=? WHERE owner=? AND paused=0 AND epoch=? AND ${ctx.live()}`,JSON.stringify(agents),Date.now(),user.id,epoch?.epoch??-1).run();if(!result.meta.changes)fail(409,'Publishing paused, superseded or credential revoked.');return reply(200,{ok:true,agentCount:agents.length});
 }
 if(ctx.publisher)fail(401,'Publish-only credential.');
 if(path==='/office'&&method==='POST'){
  if(input.name===undefined&&input.paused===undefined)fail(400,'Choose a name or sharing status.');if(input.paused!==undefined&&typeof input.paused!=='boolean')fail(400,'Invalid sharing status.');const name=input.name===undefined?null:visibleText(input.name,80),paused=input.paused===undefined?null:Number(input.paused);
  if(!(await sql(`UPDATE offices SET name=COALESCE(NULLIF(?,''),name),paused=COALESCE(NULLIF(?,-1),paused),epoch=epoch+CASE WHEN ?=-1 THEN 0 ELSE 1 END,agents=CASE WHEN ?=1 THEN '[]' ELSE agents END,updated=CASE WHEN ?=1 THEN NULL ELSE updated END WHERE owner=? AND ${ctx.live()}`,name??'',paused??-1,paused??-1,paused??-1,paused??-1,user.id).run()).meta.changes)fail(401,'Session expired.');
  return reply(200,{ok:true});
 }
 if(path==='/publisher-tokens'&&method==='POST'){const id=randomUUID(),raw=nonce(),expiresAt=Date.now()+30*86400000;await sql('DELETE FROM publisher_tokens WHERE expires<=?',Date.now()).run();if(!(await sql(`INSERT INTO publisher_tokens SELECT ?,?,?,? WHERE ${ctx.live()} AND (SELECT COUNT(*) FROM publisher_tokens WHERE user=?)<10`,id,hash(raw),user.id,expiresAt,user.id).run()).meta.changes)fail(409,'Publisher limit or session expired.');return reply(201,{id,token:raw,expiresAt});}
 const key=path.match(/^\/publisher-tokens\/([-\w]+)$/);if(key&&method==='DELETE'){if(!(await sql(`DELETE FROM publisher_tokens WHERE id=? AND user=? AND ${ctx.live()}`,key[1],user.id).run()).meta.changes)fail(404,'Publisher not found.');return reply(200,{ok:true});}
 const character=path.match(/^\/characters\/([-\w]+)$/);if(character&&method==='POST'){
  const name=visibleText(input.name,32),area=String(input.area);if(!areas.includes(area))fail(400,'Choose a work area.');
  const result=await sql(`INSERT INTO characters SELECT o.id,?,?,? FROM offices o WHERE o.owner=? AND ${ctx.live()} AND EXISTS(SELECT 1 FROM json_each(o.agents) WHERE json_extract(value,'$.id')=?) AND ((SELECT COUNT(*) FROM characters WHERE office=o.id)<256 OR EXISTS(SELECT 1 FROM characters WHERE office=o.id AND agent=?)) ON CONFLICT(office,agent) DO UPDATE SET name=excluded.name,area=excluded.area`,character[1],name,area,user.id,character[1],character[1]).run();if(!result.meta.changes)fail(404,'Character unavailable.');return reply(200,{ok:true});
 }
 fail(405,'Method not allowed.');
}

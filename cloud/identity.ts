/** Durable browser-bound OAuth. The provider protocol is shared with the existing Node implementation. */
import {GitHubIdentityBroker,IdentityError,type GitHubChallengeStore,type GitHubIdentity} from '../server/github-identity';
import {hash,nonce,fail,readCookie,type Context,type IdentityEnv,type User} from './context';
import {randomUUID,randomBytes,createHash} from 'node:crypto';
const DEVICE='office_cloud_auth',BIND='office_cloud_github',FINISH='office_cloud_confirm',TTL=600000;
type Intent={id:string;version:number};
export function cloudIdentity(ctx:Context,env:IdentityEnv){
 const {req,sql,db,headers}=ctx;const enabled=!!env.GITHUB_CLIENT_ID&&!!env.GITHUB_CLIENT_SECRET;
 const cookie=(key:string,value:string,age:number,lax=false)=>headers.append('Set-Cookie',`${key}=${value}; Path=/; HttpOnly; SameSite=${lax?'Lax':'Strict'}; Max-Age=${age}`);
 const intent=async():Promise<Intent|null>=>{if(!enabled)return null;const id=hash(readCookie(req,DEVICE)),row=await sql('SELECT version FROM auth_contexts WHERE id=? AND expires>?',id,Date.now()).first<{version:number}>();if(!row)fail(428,'Refresh sign-in context and try again.');return{id,version:row.version};};
 const check=async(value:Intent|null)=>{if(value&&!await sql('SELECT id FROM auth_contexts WHERE id=? AND version=? AND expires>?',value.id,value.version,Date.now()).first())fail(409,'Sign-in context changed. Start again.');};
 const invalidate=async(value:Intent|null)=>{if(!value)return;const row=await sql('UPDATE auth_contexts SET version=version+1 WHERE id=? AND version=? AND expires>? RETURNING version',value.id,value.version,Date.now()).first<{version:number}>();if(!row)fail(409,'Sign-in context changed.');cookie(BIND,'',0,true);cookie(FINISH,'',0);return{id:value.id,version:row.version};};
 
 const store:GitHubChallengeStore={async reserve(state,c,now){await sql('DELETE FROM github_challenges WHERE expires<=?',now).run();return !!(await sql('INSERT INTO github_challenges SELECT ?,?,?,? WHERE (SELECT COUNT(*) FROM github_challenges)<100',hash(state),c.binding,c.verifier,c.expiresAt).run()).meta.changes;},async claim(state,binding,now){const row=await sql('DELETE FROM github_challenges WHERE state=? AND binding=? AND expires>? RETURNING binding,verifier,expires AS expiresAt',hash(state),binding,now).first<{binding:string;verifier:string;expiresAt:number}>();return row??null;}};
 const broker=enabled?new GitHubIdentityBroker({clientId:env.GITHUB_CLIENT_ID!,clientSecret:env.GITHUB_CLIENT_SECRET!,callbackUrl:ctx.origin+'/api/building/auth/github/callback'},env.GITHUB_TRANSPORT?async(url,init)=>env.GITHUB_TRANSPORT!.fetch(url,init as RequestInit):undefined,Date.now,store):undefined;
 const anonymous=async()=>{if(await ctx.current())fail(409,'An account is already signed in. Sign out first; account linking is not enabled.');};
 const guardSql=(i:Intent)=>`EXISTS(SELECT 1 FROM auth_contexts WHERE id='${i.id}' AND version=${i.version} AND expires>${Date.now()})`;
 // id is a locally produced hexadecimal SHA-256 and version is a DB integer; no request strings enter this predicate.
 const handle=async():Promise<Response|null>=>{
  if(ctx.path==='/auth/providers'){
   if(ctx.method!=='GET')fail(405,'Method not allowed.');if(enabled){const id=hash(readCookie(req,DEVICE));if(!await sql('SELECT id FROM auth_contexts WHERE id=? AND expires>?',id,Date.now()).first()){
    await sql('DELETE FROM github_flows WHERE expires<=?',Date.now()).run();await sql('DELETE FROM auth_contexts WHERE expires<=? AND NOT EXISTS(SELECT 1 FROM github_flows WHERE context=auth_contexts.id)',Date.now()).run();
    await sql('DELETE FROM auth_limits WHERE expires<=?',Date.now()).run();const rate=await sql("INSERT INTO auth_limits VALUES('local-contexts',1,?) ON CONFLICT(key) DO UPDATE SET count=count+1 RETURNING count",Date.now()+900000).first<{count:number}>();if(rate!.count>20)fail(429,'Too many new sign-in contexts.');const value=nonce();if(!(await sql('INSERT INTO auth_contexts SELECT ?,0,? WHERE (SELECT COUNT(*) FROM auth_contexts)<1000',hash(value),Date.now()+1800000).run()).meta.changes)fail(429,'Too many sign-in contexts.');cookie(DEVICE,value,604800);
   }}return ctx.reply(200,{github:enabled});
  }
  if(!ctx.path.startsWith('/auth/github/'))return null;await sql('DELETE FROM github_flows WHERE expires<=?',Date.now()).run();if(!broker)fail(503,'GitHub sign-in is not configured.');
  const action=ctx.path.slice('/auth/github/'.length);if(!['start','callback','pending','confirm','cancel'].includes(action))fail(404,'Unknown sign-in endpoint.');if(ctx.method!==(['callback','pending'].includes(action)?'GET':'POST'))fail(405,'Method not allowed.');
  if(action==='start'){
   const before=await intent();await ctx.body();await check(before);await anonymous();const i=(await invalidate(before))!;const rate=await sql("INSERT INTO auth_limits VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1 RETURNING count",'oauth:'+i.id,Date.now()+900000).first<{count:number}>();if(rate!.count>5)fail(429,'Too many sign-in attempts.');let attempt;try{attempt=await broker.begin();}catch(error){if(error instanceof IdentityError)fail(error.code==='capacity'?429:502,error.message);throw error;}
   const inserted=await sql(`INSERT INTO github_flows SELECT ?,?,?,'pending',?,NULL,NULL WHERE ${guardSql(i)} AND (SELECT COUNT(*) FROM github_flows)<100`,hash(attempt.browserToken),i.id,i.version,attempt.expiresAt).run();if(!inserted.meta.changes)fail(409,'Sign-in context changed or capacity reached.');cookie(BIND,attempt.browserToken,600,true);return ctx.reply(200,{authorizationUrl:attempt.authorizationUrl});
  }
  if(action==='cancel'){const i=await intent();await ctx.body();await invalidate(i);return ctx.reply(200,{ok:true});}
  if(action==='callback'){
   const binding=hash(readCookie(req,BIND)),query=new URL(req.url).searchParams,state=query.get('state');if(!state||!/^[-_A-Za-z0-9]{43}$/.test(state))fail(400,'Invalid sign-in state.');
   const flow=await sql("UPDATE github_flows SET stage='callback' WHERE binding=? AND stage='pending' AND expires>? AND EXISTS(SELECT 1 FROM github_challenges WHERE state=? AND binding=? AND expires>?) AND EXISTS(SELECT 1 FROM auth_contexts c WHERE c.id=context AND c.version=github_flows.version AND c.expires>?) RETURNING context,version",binding,Date.now(),hash(state),createHash('sha256').update(readCookie(req,BIND)).digest('base64url'),Date.now(),Date.now()).first<{context:string;version:number}>();if(!flow)fail(400,'Sign-in attempt changed or expired.');
   const input={state:query.get('state'),browserToken:readCookie(req,BIND)};let identity:GitHubIdentity;
   try{if(query.has('error')){await broker.cancel(input);if(!(await sql('DELETE FROM github_flows WHERE binding=?',binding).run()).meta.changes)fail(400,'Sign-in attempt changed.');cookie(BIND,'',0,true);headers.set('Location',ctx.origin+'/?people=1&github=cancelled');return new Response(null,{status:303,headers});}identity=await broker.complete({...input,code:query.get('code')});}
   catch(error){await sql('DELETE FROM github_flows WHERE binding=?',binding).run();if(error instanceof IdentityError)fail(error.code==='state'?400:502,error.message);throw error;}
   const proof=nonce();if(!(await sql("UPDATE github_flows SET stage='confirmed',proof=?,identity=?,expires=? WHERE binding=? AND stage='callback' AND EXISTS(SELECT 1 FROM auth_contexts c WHERE c.id=context AND c.version=github_flows.version AND c.expires>?)",hash(proof),JSON.stringify(identity),Date.now()+TTL,binding,Date.now()).run()).meta.changes)fail(400,'Sign-in attempt changed.');cookie(FINISH,proof,600);headers.set('Location',ctx.origin+'/?people=1&github=confirm');return new Response(null,{status:303,headers});
  }
  await anonymous();const i=await intent();if(!i)fail(401,'Sign-in unavailable.');
  if(action==='pending'){const row=await sql("SELECT identity FROM github_flows WHERE binding=? AND proof=? AND stage='confirmed' AND context=? AND version=? AND expires>? AND EXISTS(SELECT 1 FROM auth_contexts WHERE id=? AND version=? AND expires>?)",hash(readCookie(req,BIND)),hash(readCookie(req,FINISH)),i.id,i.version,Date.now(),i.id,i.version,Date.now()).first<{identity:string}>();if(!row)fail(401,'Confirmation expired.');return ctx.reply(200,{identity:JSON.parse(row.identity)});}
  await ctx.body();await check(i);await anonymous();
  // Claim context + identity and create session in one D1 batch. A temporary claim marker scopes every write.
  const marker=nonce(),uid=randomUUID(),oid=randomUUID(),session=nonce(),binding=hash(readCookie(req,BIND)),proof=hash(readCookie(req,FINISH));
  const valid=`binding=? AND proof=? AND stage='confirmed' AND context=? AND version=? AND expires>? AND ${guardSql(i)}`;
  const results=await db.batch([
   sql(`UPDATE github_flows SET stage=?,expires=expires WHERE ${valid}`,marker,binding,proof,i.id,i.version,Date.now()),
   sql(`INSERT INTO users SELECT ?, 'gh_'||json_extract(identity,'$.subject')||'_'||?, json_extract(identity,'$.displayName'),?,? FROM github_flows WHERE binding=? AND stage=? AND NOT EXISTS(SELECT 1 FROM external_identities WHERE provider='github' AND subject=json_extract(github_flows.identity,'$.subject'))`,uid,randomBytes(4).toString('hex'),randomBytes(16).toString('hex'),randomBytes(64).toString('hex'),binding,marker),
   sql('INSERT INTO offices(id,owner,name) SELECT ?,id,name||\'’s office\' FROM users WHERE id=?',oid,uid),
   sql("INSERT INTO external_identities SELECT 'github',json_extract(identity,'$.subject'),COALESCE((SELECT user FROM external_identities WHERE provider='github' AND subject=json_extract(github_flows.identity,'$.subject')),?),json_extract(identity,'$.login') FROM github_flows WHERE binding=? AND stage=? ON CONFLICT(provider,subject) DO UPDATE SET login=excluded.login",uid,binding,marker),
   sql("INSERT INTO sessions SELECT ?,e.user,? FROM external_identities e JOIN github_flows f ON e.subject=json_extract(f.identity,'$.subject') WHERE e.provider='github' AND f.binding=? AND f.stage=?",hash(session),Date.now()+7*86400000,binding,marker),
   sql(`UPDATE auth_contexts SET version=version+1 WHERE id=? AND version=? AND EXISTS(SELECT 1 FROM github_flows WHERE binding=? AND stage=?)`,i.id,i.version,binding,marker)
  ]);
  if(!results[4].meta.changes)fail(409,'Confirmation expired or already used.');cookie('office_cloud_session',session,604800);cookie(BIND,'',0,true);cookie(FINISH,'',0);
  const user=await sql('SELECT u.id,u.handle,u.name FROM users u JOIN sessions s ON s.user=u.id WHERE s.token=?',hash(session)).first<User>();return ctx.reply(200,{user});
 };
 return {enabled,intent,check,invalidate,guardSql,handle};
}

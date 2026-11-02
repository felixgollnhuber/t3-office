/** Portable GitHub protocol adapter. Gated local HTTP/session integration lives in github-login.ts. */
export type GitHubIdentity={provider:'github';subject:string;login:string;displayName:string};
export type GitHubIdentityConfig={clientId:string;clientSecret:string;callbackUrl:string};
type Transport=(url:string,init:RequestInit)=>Promise<Response>;
type Pending={binding:string;verifier:string;expiresAt:number};
const AUTHORIZE='https://github.com/login/oauth/authorize',TOKEN='https://github.com/login/oauth/access_token',USER='https://api.github.com/user';
const MAX_PENDING=100,TTL=10*60_000,DEADLINE=8000;
export class IdentityError extends Error{code:'configuration'|'state'|'capacity'|'provider';constructor(code:'configuration'|'state'|'capacity'|'provider'){super(code==='configuration'?'GitHub sign-in is not configured safely.':code==='state'?'GitHub sign-in expired or could not be verified. Start again.':code==='capacity'?'Too many sign-in attempts. Try again later.':'GitHub sign-in is unavailable. Try again.');this.code=code;}}
const bytes=(n:number)=>crypto.getRandomValues(new Uint8Array(n));
const encode=(b:Uint8Array)=>btoa(String.fromCharCode(...b)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
const digest=async(value:string)=>encode(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))));
const equal=(a:string,b:string)=>{let d=a.length^b.length;for(let i=0;i<Math.max(a.length,b.length);i++)d|=(a.charCodeAt(i)||0)^(b.charCodeAt(i)||0);return d===0;};
const random=()=>encode(bytes(32));
const opaque=(v:unknown):v is string=>typeof v==='string'&&/^[A-Za-z0-9_-]{43}$/.test(v);
function configuration(input:GitHubIdentityConfig){
 let callback:URL;try{callback=new URL(input.callbackUrl);}catch{throw new IdentityError('configuration');}
 const local=callback.hostname==='localhost'||callback.hostname==='127.0.0.1'||callback.hostname==='[::1]';
 if(typeof input.clientId!=='string'||!input.clientId||input.clientId.length>200||/[\u0000-\u0020\u007f]/.test(input.clientId)||typeof input.clientSecret!=='string'||!input.clientSecret||input.clientSecret.length>512||/[\u0000-\u0020\u007f]/.test(input.clientSecret)||callback.username||callback.password||callback.search||callback.hash||callback.pathname!=='/api/building/auth/github/callback'||!(callback.protocol==='https:'||(callback.protocol==='http:'&&local)))throw new IdentityError('configuration');
 return Object.freeze({...input,callbackUrl:callback.href});
}
async function json(response:Response,limit:number,signal:AbortSignal){
 if(!response.ok||!response.body)throw new IdentityError('provider');
 const reader=response.body.getReader(),chunks:Uint8Array[]=[];let size=0;const cancel=()=>{void reader.cancel().catch(()=>{});};signal.addEventListener('abort',cancel,{once:true});if(signal.aborted)cancel();
 try{while(true){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>limit)throw new IdentityError('provider');chunks.push(value);}}
 catch{cancel();throw new IdentityError('provider');}finally{signal.removeEventListener('abort',cancel);reader.releaseLock();}
 const buffer=new Uint8Array(size);let at=0;for(const chunk of chunks){buffer.set(chunk,at);at+=chunk.length;}
 try{const result=JSON.parse(new TextDecoder().decode(buffer));if(!result||typeof result!=='object'||Array.isArray(result))throw 0;return result as Record<string,unknown>;}catch{throw new IdentityError('provider');}
}
/** Pending challenges are deliberately ephemeral: a restart makes unfinished login start over safely.
 * Integration must set browserToken as a 10-minute HttpOnly, SameSite=Lax cookie, Secure on HTTPS.
 * Keep tokens and provider responses out of logs; issue a separate local session only after complete().
 */
export class GitHubIdentityBroker{
 private config:Readonly<GitHubIdentityConfig>;private pending=new Map<string,Pending>();private transport:Transport;private now:()=>number;
 constructor(config:GitHubIdentityConfig,transport:Transport=(url,init)=>fetch(url,init),now:()=>number=Date.now){this.config=configuration(config);this.transport=transport;this.now=now;}
 get callbackUrl(){return this.config.callbackUrl;}
 private prune(){for(const[key,value]of this.pending)if(value.expiresAt<=this.now())this.pending.delete(key);}
 async begin(){
  this.prune();if(this.pending.size>=MAX_PENDING)throw new IdentityError('capacity');
  const state=random(),browserToken=random(),verifier=random(),expiresAt=this.now()+TTL;
  // Reserve before awaiting crypto so concurrent begins cannot exceed the cap.
  const entry={binding:'',verifier,expiresAt};this.pending.set(state,entry);
  try{entry.binding=await digest(browserToken);const challenge=await digest(verifier);const url=new URL(AUTHORIZE);url.search=new URLSearchParams({client_id:this.config.clientId,redirect_uri:this.config.callbackUrl,scope:'',state,code_challenge:challenge,code_challenge_method:'S256',allow_signup:'false'}).toString();return{authorizationUrl:url.href,browserToken,expiresAt};}
  catch{this.pending.delete(state);throw new IdentityError('provider');}
 }
 private async request(url:string,init:RequestInit,limit:number){
  const controller=new AbortController();const timeout=setTimeout(()=>controller.abort(),DEADLINE);
  const expired=new Promise<never>((_,reject)=>controller.signal.addEventListener('abort',()=>reject(new IdentityError('provider')),{once:true}));
  try{const response=await Promise.race([this.transport(url,{...init,signal:controller.signal}),expired]);return await Promise.race([json(response,limit,controller.signal),expired]);}
  finally{clearTimeout(timeout);controller.abort();}
 }
 private async claim(input:{state:unknown;browserToken:unknown}){
  const {state,browserToken}=input;this.prune();if(!opaque(state)||!opaque(browserToken))throw new IdentityError('state');
  const entry=this.pending.get(state);if(!entry||!entry.binding||!equal(entry.binding,await digest(browserToken)))throw new IdentityError('state');
  // Claim after async digest: callback/cancellation races cannot spend one challenge twice.
  if(this.pending.get(state)!==entry||entry.expiresAt<=this.now())throw new IdentityError('state');this.pending.delete(state);return entry;
 }
 async cancel(input:{state:unknown;browserToken:unknown}){await this.claim(input);}
 async complete(input:{state:unknown;code:unknown;browserToken:unknown}):Promise<GitHubIdentity>{
  const {state,browserToken,code}=input;if(typeof code!=='string'||!code||code.length>512||/[^\x21-\x7e]/.test(code))throw new IdentityError('state');
  const entry=await this.claim({state,browserToken});
  try{
   const token=await this.request(TOKEN,{method:'POST',redirect:'error',headers:{Accept:'application/json','Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:this.config.clientId,client_secret:this.config.clientSecret,code,redirect_uri:this.config.callbackUrl,code_verifier:entry.verifier})},16_384);
   if(typeof token.access_token!=='string'||!token.access_token||token.access_token.length>2048||/[\s\u0000-\u001f\u007f]/.test(token.access_token)||typeof token.token_type!=='string'||token.token_type.toLowerCase()!=='bearer')throw new IdentityError('provider');
   const user=await this.request(USER,{method:'GET',redirect:'error',headers:{Accept:'application/vnd.github+json',Authorization:`Bearer ${token.access_token}`,'X-GitHub-Api-Version':'2026-03-10','User-Agent':'t3-office-identity'}},65_536);
   if(typeof user.id!=='number'||!Number.isSafeInteger(user.id)||user.id<=0||typeof user.login!=='string'||!/^[a-z\d](?:[a-z\d-]{0,37}[a-z\d])?$/i.test(user.login))throw new IdentityError('provider');
   const displayName=typeof user.name==='string'?user.name.replace(/[\u0000-\u001f\u007f]/g,'').trim().slice(0,60):'';
   return{provider:'github',subject:String(user.id),login:user.login,displayName:displayName||user.login};
  }catch{throw new IdentityError('provider');}
 }
}

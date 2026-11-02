import {createHash,randomBytes} from 'node:crypto';
export const hash=(v:string)=>createHash('sha256').update(v).digest('hex');
export const nonce=()=>randomBytes(32).toString('base64url');
export type User={id:string;handle:string;name:string};
export class Failure extends Error {constructor(readonly status:number,message:string){super(message);}}
export function fail(status:number,message:string):never{throw new Failure(status,message);}
export function readCookie(req:Request,key:string){return req.headers.get('Cookie')?.split(';').map(v=>v.trim()).find(v=>v.startsWith(key+'='))?.slice(key.length+1)??'';}
export type Sql=(query:string,...values:(string|number)[])=>D1PreparedStatement;
export type IdentityEnv={GITHUB_CLIENT_ID?:string;GITHUB_CLIENT_SECRET?:string;GITHUB_TRANSPORT?:Fetcher};
export interface Context {req:Request;path:string;method:string;origin:string;db:D1DatabaseSession;sql:Sql;headers:Headers;body:()=>Promise<Record<string,unknown>>;current:()=>Promise<User|null>;reply:(status:number,data:unknown)=>Response;}
export const quote=(value:string)=>"'"+value.replace(/'/g,"''")+"'";
export const sessionGuard=(token:string,user:string)=>`EXISTS(SELECT 1 FROM sessions WHERE token=${quote(token)} AND user=${quote(user)} AND expires>${Date.now()})`;
export interface AuthContext extends Context{user:User;token:string;publisher:boolean;live:()=>string;}
export function visibleText(value:unknown,max:number):string{if(typeof value!=='string'||!value.trim()||value.length>max||/[\u0000-\u001f\u007f]/.test(value))fail(400,'Use short visible text.');return value.trim();}
export async function authorizedInput(ctx:AuthContext){const input=await ctx.body();const user=await ctx.current();if(!user||user.id!==ctx.user.id)fail(401,'Session expired.');if(input.actorId!==undefined&&input.actorId!==user.id)fail(409,'Account changed.');return input;}

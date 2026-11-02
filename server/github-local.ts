/** Explicit localhost-only OAuth configuration. No credential discovery or client-side env variables. */
import {openSync,closeSync,fstatSync,readSync,constants} from 'node:fs';
import {resolve} from 'node:path';
import {GitHubIdentityBroker} from './github-identity.ts';
export const LOCAL_GITHUB_CALLBACK='http://localhost:5173/api/building/auth/github/callback';
export function localGitHubBroker(enabled:boolean,credentialsPath=resolve('.local/github-oauth.json')):GitHubIdentityBroker|undefined{
 if(!enabled)return undefined;
 let fd:number|undefined;
 try{
  fd=openSync(credentialsPath,constants.O_RDONLY|constants.O_NOFOLLOW);
  const info=fstatSync(fd);
  if(!info.isFile()||info.size>4096||(process.platform!=='win32'&&((info.mode&0o077)!==0||info.uid!==process.getuid?.())))throw new Error();
  const bytes=Buffer.alloc(4097);const size=readSync(fd,bytes,0,bytes.length,0);if(size>4096)throw new Error();
  const value=JSON.parse(bytes.subarray(0,size).toString('utf8'));
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!['clientId','clientSecret'].includes(k)))throw new Error();
  return new GitHubIdentityBroker({clientId:value.clientId,clientSecret:value.clientSecret,callbackUrl:LOCAL_GITHUB_CALLBACK});
 }catch{throw new Error('Local GitHub login could not load its private configuration. Use an owner-readable .local/github-oauth.json containing only clientId and clientSecret.');}
 finally{if(fd!==undefined)closeSync(fd);}
}

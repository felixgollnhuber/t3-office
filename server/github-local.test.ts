import {test} from 'node:test';import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,chmodSync,symlinkSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {localGitHubBroker,LOCAL_GITHUB_CALLBACK} from './github-local.ts';
test('local OAuth remains off without reading configuration unless explicitly enabled',()=>{assert.equal(localGitHubBroker(false,'/nonexistent/private.json'),undefined);});
test('local OAuth reads only bounded private credentials, fixes callback and sanitizes failures',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'office-github-config-')),path=join(dir,'credentials.json');const save=(value:unknown)=>writeFileSync(path,JSON.stringify(value),{mode:0o600});
 try{
  save({clientId:'synthetic-client',clientSecret:'synthetic-secret'});const broker=localGitHubBroker(true,path)!;assert.equal(broker.callbackUrl,LOCAL_GITHUB_CALLBACK);const begun=await broker.begin();assert.equal(new URL(begun.authorizationUrl).searchParams.get('client_id'),'synthetic-client');assert.ok(!begun.authorizationUrl.includes('synthetic-secret'));
  for(const value of [null,[],{clientId:'synthetic-client'},{clientId:'synthetic-client',clientSecret:'synthetic-secret',callbackUrl:'https://evil.test/'},{clientId:'synthetic-client',clientSecret:'bad secret'}]){save(value);assert.throws(()=>localGitHubBroker(true,path),e=>e instanceof Error&&!e.message.includes('synthetic-secret')&&e.message.includes('private configuration'));}
  writeFileSync(path,'x'.repeat(4097));assert.throws(()=>localGitHubBroker(true,path));assert.throws(()=>localGitHubBroker(true,dir));
  save({clientId:'synthetic-client',clientSecret:'synthetic-secret'});if(process.platform!=='win32'){chmodSync(path,0o644);assert.throws(()=>localGitHubBroker(true,path));chmodSync(path,0o600);const link=join(dir,'linked.json');symlinkSync(path,link);assert.throws(()=>localGitHubBroker(true,link));}
 }finally{rmSync(dir,{recursive:true,force:true});}
});

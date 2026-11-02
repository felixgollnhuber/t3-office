/** Native Vite configuration with fake private-file credentials. Never exchanges provider codes. */
import assert from 'node:assert/strict';import{mkdtemp,mkdir,writeFile,rm}from'node:fs/promises';import{tmpdir}from'node:os';import{join,dirname,resolve}from'node:path';import{fileURLToPath}from'node:url';import{createServer}from'vite';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),original=process.cwd(),dir=await mkdtemp(join(tmpdir(),'office-github-config-ui-'));let server;
try{
 process.chdir(dir);delete process.env.T3_LOCAL_DATA;process.env.BUILDING_DB=join(dir,'test.sqlite');await mkdir(join(dir,'.local'),{mode:0o700});await writeFile(join(dir,'.local/github-oauth.json'),JSON.stringify({clientId:'synthetic-config-client',clientSecret:'synthetic-config-secret'}),{mode:0o600});
 const start=async enabled=>{process.env.OFFICE_GITHUB_LOGIN=enabled?'1':'0';server=await createServer({root,configFile:join(root,'vite.config.ts'),server:{host:'localhost',port:0,strictPort:false,hmr:false,fs:{allow:[root,dir]}},logLevel:'silent'});await server.listen();return server.resolvedUrls.local[0];};
 let base=await start(false);assert.deepEqual(await(await fetch(base+'api/building/auth/providers')).json(),{github:false});await server.close();
 base=await start(true);const providers=await fetch(base+'api/building/auth/providers');assert.deepEqual(await providers.json(),{github:true});const cookie=providers.headers.getSetCookie().map(c=>c.split(';')[0]).join('; ');
 const fail=await fetch(base+'api/building/auth/github/start',{method:'POST',headers:{'Content-Type':'application/json',Origin:new URL(base).origin,Cookie:cookie},body:'{}'});assert.equal(fail.status,403,'Local trial requires the registered localhost:5173 origin, not a fallback port');
 const direct=await fetch(base+'@fs'+join(dir,'.local/github-oauth.json'));assert.ok([403,404].includes(direct.status));assert.ok(!(await direct.text()).includes('synthetic-config-secret'));
 const privateData=await fetch(base+'api/t3/threads');assert.ok(!privateData.ok);console.log('PASS: native config keeps GitHub off by default, enables it only explicitly, denies private config over HTTP, rejects wrong callback port and leaves private T3 data disabled.');
}finally{await server?.close();process.chdir(original);await rm(dir,{recursive:true,force:true});}

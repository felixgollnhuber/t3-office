/** Worker/D1 room appearance and character-style contract parity with the Node service. Synthetic data only. */
import assert from'node:assert/strict';import{cloudFixture}from'./cloud-test-harness.mjs';
const f=await cloudFixture();let count=0;
const DEFAULT={theme:'campus',layout:'original',lighting:'original'};
const STYLE={hairStyle:'bun',outfit:'blazer',skin:'#d39a6e',hair:'#916347',shirt:'#5b63d6',glasses:true};
try{
 const owner=f.jar(),guest=f.jar(),presence=f.jar(),other=f.jar();const reg=async(c,handle)=>(await f.call(c,'/register','POST',{handle,name:handle,password:'synthetic-cloud-password'})).data;
 const a=await reg(owner,'owner');await reg(guest,'guest');await reg(presence,'presence');await reg(other,'other');
 const grant=async(c,scope)=>{const inv=await f.call(owner,'/invites','POST',{scope});assert.equal((await f.call(c,'/accept','POST',{token:inv.data.token})).status,200);};await grant(guest,'activity');await grant(presence,'presence');

 // Default appearance is reported for the owner's session before anything is saved.
 assert.deepEqual((await f.call(owner,'/session')).data.office.appearance,DEFAULT);assert.deepEqual(a.office.appearance??DEFAULT,DEFAULT);count++;

 // Saving appearance returns the cleaned value; unknown keys are dropped and invalid values are rejected without side effects.
 const chosen={theme:'loft',layout:'lounge',lighting:'warm',identity:{accent:'sage',emblem:'leaf',slots:{west:'plant',center:'none',east:'lamp'},extra:'x'},secret:'NEVER_SHARE'};
 let r=await f.call(owner,'/office','POST',{appearance:chosen});assert.equal(r.status,200);const clean={theme:'loft',layout:'lounge',lighting:'warm',identity:{accent:'sage',emblem:'leaf',slots:{west:'plant',center:'none',east:'lamp'}}};assert.deepEqual(r.data.office.appearance,clean);assert.ok(!JSON.stringify(r.data).includes('NEVER_SHARE'));
 assert.equal((await f.call(owner,'/office','POST',{appearance:{theme:'mars',layout:'original',lighting:'original'}})).status,400);assert.deepEqual((await f.call(owner,'/session')).data.office.appearance,clean);
 assert.equal((await f.call(owner,'/office','POST',{name:'Renamed floor'})).status,200);assert.deepEqual((await f.call(owner,'/session')).data.office.appearance,clean,'Renaming must keep appearance');count++;

 // Activity guests receive the room style; presence guests and strangers do not.
 assert.deepEqual((await f.call(guest,'/offices/'+a.office.id)).data.office.appearance,clean);
 const floor=(await f.call(guest,'/floors')).data.floors.find(x=>x.id===a.office.id);assert.deepEqual(floor.appearance,clean);
 const p=await f.call(presence,'/offices/'+a.office.id);assert.equal(p.status,200);assert.equal(p.data.office.appearance,undefined);assert.equal((await f.call(presence,'/floors')).data.floors.find(x=>x.id===a.office.id).appearance,undefined);
 assert.equal((await f.call(other,'/offices/'+a.office.id)).status,404);count++;

 // Character style is stored, shown to the owner and activity guests, and preserved when a later save omits it.
 const key=(await f.call(owner,'/publisher-tokens','POST',{})).data;const publish=()=>f.call(f.jar(),'/publish','POST',{agents:[{id:'opaque_1',provider:'claude',status:'running'}]},{Authorization:'Bearer '+key.token});assert.equal((await publish()).status,200);
 assert.equal((await f.call(owner,'/characters/opaque_1','POST',{name:'Maya',area:'design',style:{...STYLE,secret:'NEVER_SHARE'}})).status,200);
 const own=(await f.call(owner,'/characters')).data.characters;assert.deepEqual(own[0].style,STYLE);assert.equal(own[0].name,'Maya');
 r=await f.call(guest,'/offices/'+a.office.id);assert.deepEqual(r.data.agents[0].style,STYLE);assert.ok(!JSON.stringify(r.data).includes('NEVER_SHARE'));
 assert.equal((await f.call(owner,'/characters/opaque_1','POST',{name:'Maya B',area:'backend'})).status,200);r=await f.call(guest,'/offices/'+a.office.id);assert.equal(r.data.agents[0].name,'Maya B');assert.deepEqual(r.data.agents[0].style,STYLE,'Omitted style must keep the saved style');count++;

 // Invalid styles are rejected; guests cannot style someone else's characters; presence guests never see agents.
 assert.equal((await f.call(owner,'/characters/opaque_1','POST',{name:'Maya',area:'design',style:{...STYLE,hairStyle:'spikes'}})).status,400);assert.equal((await f.call(owner,'/characters/opaque_1','POST',{name:'Maya',area:'design',style:{...STYLE,skin:'#000000'}})).status,400);
 assert.deepEqual((await f.call(owner,'/characters')).data.characters[0].style,STYLE);
 assert.equal((await f.call(guest,'/characters/opaque_1','POST',{name:'X',area:'design',style:STYLE})).status,404);assert.deepEqual((await f.call(presence,'/offices/'+a.office.id)).data.agents,[]);count++;

 // Pausing clears activity but keeps owner preferences; revocation removes the guest's view of appearance.
 await f.call(owner,'/office','POST',{paused:true});assert.deepEqual((await f.call(owner,'/session')).data.office.appearance,clean);assert.deepEqual((await f.call(guest,'/offices/'+a.office.id)).data.agents,[]);
 const g=(await f.call(owner,'/grants')).data.grants.find(x=>x.userHandle==='guest');await f.call(owner,'/grants/'+g.id,'DELETE',{});assert.equal((await f.call(guest,'/offices/'+a.office.id)).status,404);count++;

 // A publisher key cannot change appearance or character style.
 assert.equal((await f.call(f.jar(),'/office','POST',{appearance:DEFAULT},{Authorization:'Bearer '+key.token})).status,401);assert.equal((await f.call(f.jar(),'/characters/opaque_1','POST',{name:'X',area:'design',style:STYLE},{Authorization:'Bearer '+key.token})).status,401);assert.deepEqual((await f.call(owner,'/session')).data.office.appearance,clean);count++;
 console.log(`PASS: ${count} cloud appearance scenarios: default/session parity, cleaned allowlisted room style, activity-only visibility, character style persistence/omission/validation, pause/revocation and publisher scope.`);
}finally{await f.close();}

/** Human avatars and office conversation. No agent identity, transcript or tool access. */
import * as THREE from 'three';
import { api, ApiError, type Session } from './building-api';
import { createCharacter, type Character } from './character';
import { HUMAN_COLORS, type HumanProfile, type HumanRoom, type HumanState, type HumanPerson } from './human-api';
import type { NavGrid, P2 } from './nav';
import { travelToFloor } from './elevator';
import { locale, hhmm } from './i18n';
import './humans.css';
const T=locale({en:{privacy:'Room privacy',entered:'You are in this conversation.',title:'People & chat',chat:'Conversation',avatar:'My avatar',visits:'Visits',close:'Close',signin:'Use your optional office account to meet people.',account:'Open Friends & characters',name:'Your human name',color:'Clothing color',hair:'Hairstyle',availability:'Availability',save:'Save human avatar',profileHint:'This is you, separate from your AI coworkers. Your chosen name is sent with visit requests. Appearance and availability are shared only when you enter.',consent:'Entering shares your human name, appearance, availability, position and messages with admitted people in this office. Conversations are stored on this local server for up to seven days; they are not end-to-end encrypted. Guests see messages since admission. Never paste secrets.',enter:'Enter conversation',leave:'Leave room',walk:'Walk · tap the floor',stopWalk:'Stop walking',send:'Send',placeholder:'Say hello to the people here…',empty:'No messages yet. Say hello.',roomHint:'Join this office’s conversation to appear here and talk.',loading:'Checking your office…',error:'Connection lost. People and chat were cleared.',retry:'Reconnect',request:'Ring for an office visit',waiting:'Waiting for the host',declined:'The host declined this visit.',open:'Open my office for conversations',dnd:'Do Not Disturb · no new visits',saveRoom:'Save visit settings',requests:'Office visit requests',accept:'Admit to conversation',decline:'Not now',remove:'Remove visitor',visit:'Walk into office',notOpen:'Not accepting visits',saved:'Saved.',requestConsent:'A visit request shares your chosen human name with this host. Admission is separate from agent activity or focus access. Requests expire after two minutes.',sending:'Sending…',sent:'Sent',failed:'Not sent',retrySend:'Retry',delete:'Delete',person:'PERSON',you:'YOU',walkingHint:'Walk mode: tap open floor, or use arrow keys. Turn it off to pan the camera.',path:'Choose open floor in the main office.',changed:'Your account or room changed. Re-enter before continuing.',available:'Available',busy:'Busy',away:'Away',nothing:'No one is waiting.',cancel:'Cancel request'},de:{privacy:'Privatsphäre im Raum',entered:'Du bist im Gespräch.',title:'Menschen & Chat',chat:'Gespräch',avatar:'Mein Avatar',visits:'Besuche',close:'Schließen',signin:'Nutze dein optionales Bürokonto, um Menschen zu treffen.',account:'Freunde & Charaktere öffnen',name:'Dein menschlicher Name',color:'Kleidungsfarbe',hair:'Frisur',availability:'Verfügbarkeit',save:'Avatar speichern',profileHint:'Das bist du, getrennt von KI-Kollegen. Besuchsanfragen teilen deinen gewählten Namen. Aussehen und Verfügbarkeit werden erst beim Betreten geteilt.',consent:'Beim Betreten sehen zugelassene Menschen Namen, Aussehen, Verfügbarkeit, Position und Nachrichten. Gespräche liegen bis zu sieben Tage auf diesem lokalen Server; sie sind nicht Ende-zu-Ende-verschlüsselt. Gäste sehen Nachrichten seit ihrer Zulassung. Keine Geheimnisse einfügen.',enter:'Gespräch betreten',leave:'Raum verlassen',walk:'Gehen · Boden antippen',stopWalk:'Gehen beenden',send:'Senden',placeholder:'Sag den Menschen hier Hallo…',empty:'Noch keine Nachrichten. Sag Hallo.',roomHint:'Tritt dem Gespräch bei, um hier zu erscheinen und zu sprechen.',loading:'Büro wird geprüft…',error:'Verbindung verloren. Menschen und Chat wurden entfernt.',retry:'Neu verbinden',request:'Für einen Bürobesuch klingeln',waiting:'Wartet auf Gastgeber',declined:'Der Gastgeber hat abgelehnt.',open:'Mein Büro für Gespräche öffnen',dnd:'Nicht stören · keine neuen Besuche',saveRoom:'Besuchseinstellungen speichern',requests:'Bürobesuchsanfragen',accept:'Zum Gespräch zulassen',decline:'Jetzt nicht',remove:'Besucher entfernen',visit:'Büro betreten',notOpen:'Keine Besuche möglich',saved:'Gespeichert.',requestConsent:'Eine Besuchsanfrage teilt deinen gewählten Namen mit diesem Gastgeber. Zulassung ist getrennt von Agenten- oder Fokuszugriff. Anfragen verfallen nach zwei Minuten.',sending:'Wird gesendet…',sent:'Gesendet',failed:'Nicht gesendet',retrySend:'Erneut senden',delete:'Löschen',person:'MENSCH',you:'DU',walkingHint:'Gehmodus: freien Boden antippen oder Pfeiltasten nutzen. Zum Kameraschwenken ausschalten.',path:'Wähle freien Boden im Hauptbüro.',changed:'Konto oder Raum geändert. Bitte erneut betreten.',available:'Verfügbar',busy:'Beschäftigt',away:'Abwesend',nothing:'Niemand wartet.',cancel:'Anfrage zurückziehen'}});
const U=locale({en:{friends:'Friends',you:'You',invite:'Invite a friend',accept:'Have an invite?',paste:'Paste invitation link',join:'Add friend',inviteHint:'Office access only. Visits still need your approval; agent activity stays private.',copy:'Copy link',copied:'Copied.',host:'Open & join my office',hostHint:'Open your office to visit requests and enter the conversation. Friends still need your approval.',settings:'Visit settings',manage:'People in this room',more:'More office tools',added:'Friend added. Choose their office below.',account:'Account & office settings'},de:{friends:'Freunde',you:'Du',invite:'Freund einladen',accept:'Einladung erhalten?',paste:'Einladungslink einfügen',join:'Freund hinzufügen',inviteHint:'Nur Bürozugriff. Besuche brauchen weiter deine Zustimmung; Agentenaktivität bleibt privat.',copy:'Link kopieren',copied:'Kopiert.',host:'Büro öffnen & beitreten',hostHint:'Öffne dein Büro für Besuchsanfragen und tritt dem Gespräch bei. Freunde brauchen weiter deine Zustimmung.',settings:'Besuchseinstellungen',manage:'Menschen im Raum',more:'Weitere Bürofunktionen',added:'Freund hinzugefügt. Wähle unten das Büro.',account:'Konto & Büroeinstellungen'}});
const esc=(s:string)=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]!);
const HINT='office.human-room.v1',MONITOR='office.human-visits.v1';
type Host={scene:THREE.Scene;camera:THREE.Camera;canvas:HTMLCanvasElement;nav:NavGrid;floorId:string|null};
type Actor={ch:Character;label:HTMLButtonElement;ring:THREE.Mesh;person:HumanPerson;signature:string};
export function installHumanOffice(host:Host){
 const launcher=document.createElement('button');launcher.className='human-launcher';launcher.textContent=T.title;document.body.append(launcher);
 const panel=document.createElement('aside');panel.className='human-panel';panel.hidden=true;panel.setAttribute('aria-label',T.title);document.body.append(panel);
 panel.innerHTML=`<header><h1>${T.title}</h1><button data-human="close" aria-label="${T.close}">×</button></header><nav><button data-tab="chat">${T.chat}</button><button data-tab="avatar">${U.you}</button><button data-tab="visits">${U.friends}</button></nav><p class="human-notice" role="status" aria-live="polite"></p><main></main>`;
 const labels=document.createElement('div');labels.className='human-labels';document.body.append(labels);
 const group=new THREE.Group();group.name='human-visitors';host.scene.add(group);const actors=new Map<string,Actor>();
 const main=panel.querySelector('main')!,notice=panel.querySelector('.human-notice')!;
 let session:Session|null=null,profile:HumanProfile|null=null,rooms:HumanRoom[]=[],state:HumanState|null=null;
 let tab:'chat'|'avatar'|'visits'='visits',generation=0,activeId='',lease='',walking=false,unread=0,loading=false,mutating=false,refreshing=false,stateBusy=false,beatBusy=false,timer:ReturnType<typeof setInterval>|undefined,metaAt=0,lastBeat=0,path:P2[]=[],ownPos={x:0,z:7},seen=new Set<string>(),requestCount=0,clockPhase=0;
 let pending:{clientId:string;text:string;status:'sending'|'failed'|'sent'}[]=[];
 const currentRoom=()=>host.floorId??session?.office.id??'';
 const say=(s:string)=>{notice.textContent=s;};
 const disposeActor=(a:Actor)=>{a.label.remove();group.remove(a.ch.root,a.ring);const geometries=new Set<THREE.BufferGeometry>();a.ch.root.traverse(o=>{if(o instanceof THREE.Mesh)geometries.add(o.geometry);});geometries.forEach(g=>g.dispose());a.ring.geometry.dispose();(a.ring.material as THREE.Material).dispose();};
 const clearActors=()=>{actors.forEach(disposeActor);actors.clear();};
 function clearRoom(removeHint=true){generation++;activeId='';lease='';state=null;path=[];walking=false;pending=[];seen.clear();unread=0;clearActors();if(removeHint)sessionStorage.removeItem(HINT);launcher.textContent=T.title;}
 const active=()=>!!activeId&&!!lease;
 const availability=(s:string)=>s==='busy'?T.busy:s==='away'?T.away:T.available;
 function render(){
  panel.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.tab===tab)));
  if(!session||!profile){main.innerHTML=`<p>${T.signin}</p><button data-human="account">${T.account}</button>`;return;}
  if(tab==='avatar'){
   main.innerHTML=`<p>${T.profileHint}</p><form class="human-profile-form"><label>${T.name}<input name="name" required maxlength="32" value="${esc(profile.name)}"></label><label>${T.color}<select name="color">${Object.keys(HUMAN_COLORS).map(c=>`<option ${profile!.color===c?'selected':''}>${c}</option>`).join('')}</select></label><label>${T.hair}<select name="hair">${['short','long','curly','cap'].map(c=>`<option ${profile!.hair===c?'selected':''}>${c}</option>`).join('')}</select></label><label>${T.availability}<select name="availability">${['available','busy','away'].map(c=>`<option value="${c}" ${profile!.availability===c?'selected':''}>${availability(c)}</option>`).join('')}</select></label><button type="submit">${T.save}</button></form>`;return;
  }
  if(tab==='visits'){
   const own=rooms.find(r=>r.isOwner);
   main.innerHTML=`<button data-human="invite">${U.invite}</button><div class="human-invite-result"></div><details><summary>${U.accept}</summary><form class="human-accept"><label>${U.paste}<input name="token" required autocomplete="off"></label><button type="submit">${U.join}</button></form></details>${own?`<details><summary>${U.settings}</summary><form class="human-room-settings"><label><input type="checkbox" name="open" ${own.open?'checked':''}>${T.open}</label><label><input type="checkbox" name="dnd" ${own.dnd?'checked':''}>${T.dnd}</label><button type="submit">${T.saveRoom}</button></form></details><h2>${T.requests}</h2><div class="human-requests"></div>`:''}<p class="human-consent">${T.requestConsent}</p><div class="human-directory"></div><button data-human="account">${U.account}</button>`;renderVisits();return;
  }
  const room=rooms.find(r=>r.id===currentRoom());
  main.innerHTML=`<h2>${esc(room?.name??'Office')}</h2>${active()?`<details class="human-consent"><summary>${T.privacy}</summary><p>${T.consent}</p></details>`:`<p class="human-consent">${T.consent}</p>`}${active()?`<div class="human-room-actions"><button data-human="walk" aria-pressed="${walking}">${walking?T.stopWalk:T.walk}</button><button data-human="leave">${T.leave}</button></div><p class="human-walk-hint">${walking?T.walkingHint:''}</p><details class="human-member-details"><summary>${U.manage}</summary><div class="human-members"></div></details><ol class="human-messages" aria-label="${T.chat}" aria-live="polite"></ol><div class="human-pending"></div><form class="human-send"><label>${T.chat}<textarea name="text" maxlength="500" required placeholder="${T.placeholder}"></textarea></label><button type="submit">${T.send}</button></form>`:`<p>${T.roomHint}</p>${room?.isOwner&&!room.open?`<p>${U.hostHint}</p><details class="human-consent"><summary>${T.privacy}</summary><p>${T.consent}</p></details><button data-human="host">${U.host}</button>`:room?.admitted&&(!room.dnd||room.isOwner||room.present)?`<button data-enter="${esc(room.id)}">${T.enter}</button>`:room?.request?.status==='pending'?`<p>${T.waiting}</p>`:room?.open&&!room.dnd?`<button data-request="${esc(room.id)}">${T.request}</button>`:`<p>${T.notOpen}</p>`}<button data-human="visits">${T.visits}</button>`}`;
  renderChat();
 }
 function renderChat(){
  if(tab!=='chat'||!state)return;const list=main.querySelector<HTMLOListElement>('.human-messages');
  if(list){const signature=JSON.stringify(state.messages);if(list.dataset.signature!==signature){const bottom=list.scrollTop+list.clientHeight>=list.scrollHeight-40;list.dataset.signature=signature;list.innerHTML=state.messages.map(m=>`<li data-message="${esc(m.id)}"><b>${esc(m.name)}</b><time>${hhmm(new Date(m.createdAt))}</time><p>${esc(m.text)}</p><small>${T.sent}</small>${m.userId===session?.user.id||state!.isOwner?`<button data-delete-message="${esc(m.id)}" aria-label="${T.delete}">${T.delete}</button>`:''}</li>`).join('')||`<li>${T.empty}</li>`;if(bottom)list.scrollTop=list.scrollHeight;}}
  const members=main.querySelector('.human-members');if(members){const html=state.people.map(p=>`<span class="human-member">${esc(p.name)} · ${availability(p.availability)}${state!.isOwner&&p.id!==session?.user.id?` <button data-kick="${esc(p.id)}">${T.remove}</button>`:''}</span>`).join('');if(members.innerHTML!==html)members.innerHTML=html;}
  renderPending();
 }
 function renderPending(){const box=main.querySelector<HTMLElement>('.human-pending');if(!box)return;const signature=JSON.stringify(pending);if(box.dataset.signature===signature)return;box.dataset.signature=signature;box.innerHTML=pending.filter(p=>!state?.messages.some(m=>m.clientId===p.clientId)).map(p=>`<p>${esc(p.text)} <small>${p.status==='sending'?T.sending:p.status==='sent'?T.sent:T.failed}</small>${p.status==='failed'?`<button data-retry-message="${p.clientId}">${T.retrySend}</button>`:''}</p>`).join('');}
 async function renderVisits(){
  const list=main.querySelector('.human-directory');if(list)list.innerHTML=rooms.map(r=>`<article data-human-room="${esc(r.id)}"><h3>${esc(r.name)}</h3><p>${esc(r.ownerName)}</p>${r.isOwner&&!r.open?`<p>${U.hostHint}</p><details class="human-consent"><summary>${T.privacy}</summary><p>${T.consent}</p></details><button data-human="host">${U.host}</button>`:r.admitted&&(!r.dnd||r.isOwner||r.present)?`<button data-enter="${esc(r.id)}">${T.visit}</button>`:r.request?.status==='pending'?`<p>${T.waiting}</p><button data-cancel-request="${r.request.id}" data-office="${r.id}">${T.cancel}</button>`:`${r.request?.status==='declined'?`<p>${T.declined}</p>`:''}${r.open&&!r.dnd?`<button data-request="${esc(r.id)}">${T.request}</button>`:`<p>${T.notOpen}</p>`}`}</article>`).join('');
  const own=rooms.find(r=>r.isOwner),box=main.querySelector('.human-requests');if(!own||!box)return;
  const epoch=generation;try{const data=await api<{viewerId:string;requests:{id:string;name:string}[]}>(`/rooms/${own.id}/requests`);if(epoch!==generation||data.viewerId!==session?.user.id)return;requestCount=data.requests.length;box.innerHTML=data.requests.map(r=>`<article data-visit-request="${r.id}"><b>${esc(r.name)}</b><button data-admit="${r.id}" data-office="${own.id}">${T.accept}</button><button data-decline="${r.id}" data-office="${own.id}">${T.decline}</button></article>`).join('')||`<p>${T.nothing}</p>`;}catch{box.textContent=T.error;}
 }
 function monitor(){timer??=setInterval(()=>{if(active()){void readState();void heartbeat();}if(Date.now()-metaAt>4000&&(!panel.hidden||rooms.some(r=>r.isOwner&&r.open)||sessionStorage.getItem(MONITOR)==='1'))void refreshMeta();if(!active()&&panel.hidden&&!rooms.some(r=>r.isOwner&&r.open)&&sessionStorage.getItem(MONITOR)!=='1'){clearInterval(timer);timer=undefined;}},750);}
 async function refreshMeta(){
  if(refreshing)return;refreshing=true;const epoch=generation;
  try{const before=await api<Session>('/session'),p=await api<{viewerId:string;profile:HumanProfile}>('/human'),r=await api<{viewerId:string;rooms:HumanRoom[]}>('/rooms'),after=await api<Session>('/session');if(epoch!==generation)return;
   if(before.user.id!==after.user.id||p.viewerId!==after.user.id||r.viewerId!==after.user.id||(session&&session.user.id!==after.user.id)){clearRoom();sessionStorage.removeItem(MONITOR);session=null;profile=null;rooms=[];say(T.changed);render();return;}
   const first=!session;const changedRooms=JSON.stringify(rooms)!==JSON.stringify(r.rooms);session=after;profile=p.profile;rooms=r.rooms;metaAt=Date.now();
   if(rooms.some(r=>r.isOwner&&r.open))sessionStorage.setItem(MONITOR,'1');else sessionStorage.removeItem(MONITOR);
   if(!panel.hidden&&(first||!main.childElementCount))render();else if(!panel.hidden&&tab==='visits')void renderVisits();else if(!active()&&changedRooms&&tab==='chat')render();
   const own=rooms.find(r=>r.isOwner);if(own?.open&&tab!=='visits'){const pendingRequests=await api<{viewerId:string;requests:unknown[]}>(`/rooms/${own.id}/requests`);if(epoch===generation&&pendingRequests.viewerId===session.user.id)requestCount=pendingRequests.requests.length;}
   launcher.textContent=`${T.title}${requestCount?` · ${requestCount} ${T.visits}`:unread?` · ${unread}`:''}`;
  }catch(error){if(epoch!==generation)return;clearRoom();if(error instanceof ApiError&&error.status===401)sessionStorage.removeItem(MONITOR);session=null;profile=null;rooms=[];if(!panel.hidden){say(error instanceof ApiError&&error.status===401?T.signin:T.error);render();}}
  finally{refreshing=false;metaAt=Date.now();monitor();}
 }
 async function enter(id:string){
  if(mutating||!session)return;mutating=true;const userId=session.user.id;
  try{if(!rooms.find(r=>r.id===id)?.admitted)throw new Error(T.waiting);
   if(id!==currentRoom()){await leave(false);sessionStorage.setItem(HINT,JSON.stringify({officeId:id,userId,at:Date.now()}));void travelToFloor(id===session.office.id?null:id);return;}
   clearRoom();const epoch=generation;const joined=await api<{viewerId:string;lease:string;x:number;z:number}>(`/rooms/${id}/enter`,'POST',{actorId:userId});if(epoch!==generation||joined.viewerId!==session?.user.id)return;
   activeId=id;lease=joined.lease;ownPos={x:joined.x,z:joined.z};sessionStorage.setItem(HINT,JSON.stringify({officeId:id,userId,at:Date.now()}));tab='chat';panel.hidden=false;await readState();render();monitor();say(T.entered);
  }catch(error){clearRoom();say(error instanceof Error?error.message:T.error);render();}finally{mutating=false;}
 }
 async function leave(clearHint=true){const id=activeId,token=lease,actorId=session?.user.id;clearRoom(clearHint);if(id&&actorId)try{await api(`/rooms/${id}/leave`,'POST',{actorId,lease:token});}catch{/* Lease expiry also removes presence. */}render();}
 async function readState(){
  if(!active()||stateBusy)return;stateBusy=true;const epoch=generation,id=activeId;
  try{const next=await api<HumanState>(`/rooms/${id}/state`);if(epoch!==generation)return;if(next.viewerId!==session?.user.id||next.lease!==lease||next.officeId!==id)throw new Error(T.changed);
   if(!panel.hidden&&tab==='chat')unread=0;else if(state)unread+=next.messages.filter(m=>!seen.has(m.id)&&m.userId!==session?.user.id).length;
   next.messages.forEach(m=>seen.add(m.id));state=next;pending=pending.filter(p=>!next.messages.some(m=>m.clientId===p.clientId&&m.userId===session?.user.id));syncActors();renderChat();launcher.textContent=`${T.title}${unread?` · ${unread}`:''}`;
  }catch(error){if(epoch!==generation)return;clearRoom();say(error instanceof ApiError&&[401,403,404].includes(error.status)?T.changed:T.error);render();}finally{stateBusy=false;}
 }
 async function heartbeat(){
  if(!active()||beatBusy||Date.now()-lastBeat<1000)return;beatBusy=true;lastBeat=Date.now();const epoch=generation;
  try{await api(`/rooms/${activeId}/presence`,'POST',{actorId:session!.user.id,lease,x:ownPos.x,z:ownPos.z});}catch(error){if(epoch!==generation)return;if(error instanceof ApiError&&[400,429].includes(error.status)){path=[];const p=state?.people.find(p=>p.id===session?.user.id);if(p)ownPos={x:p.x,z:p.z};say(T.path);}else{clearRoom();say(T.error);render();}}finally{beatBusy=false;}
 }
 async function action(path:string,body:unknown={},method='POST'){
  if(mutating||!session)return;mutating=true;const epoch=generation,actorId=session.user.id;
  try{const result=await api<{profile?:HumanProfile}>(path,method,{...(body as object),actorId});if(epoch===generation){if(path==='/human'&&result.profile?.id===actorId)profile=result.profile;say(T.saved);metaAt=0;await refreshMeta();if(active())await readState();}}
  catch(error){if(epoch===generation)say(error instanceof Error?error.message:T.error);}finally{mutating=false;}
 }
 async function sendMessage(item:{clientId:string;text:string;status:'sending'|'failed'|'sent'}){
  if(!active()||!session)return;const epoch=generation,id=activeId;item.status='sending';renderPending();
  try{await api(`/rooms/${id}/messages`,'POST',{actorId:session.user.id,lease,text:item.text,clientId:item.clientId});if(epoch!==generation)return;item.status='sent';pending=pending.filter(p=>p!==item);await readState();}
  catch(error){if(epoch!==generation)return;if(error instanceof ApiError&&[401,403,404,409].includes(error.status)){clearRoom();say(T.changed);render();return;}item.status='failed';say(error instanceof Error?error.message:T.error);}finally{if(epoch===generation)renderPending();}
 }
 async function invitationAction(token?:string){
  if(mutating||!session)return;mutating=true;const epoch=generation,actorId=session.user.id;
  try{const result=token===undefined?await api<{token:string}>('/invites','POST',{scope:'presence',actorId}):await api('/accept','POST',{token,actorId});
   const check=await api<Session>('/session');if(epoch!==generation||check.user.id!==actorId){clearRoom();session=null;profile=null;rooms=[];render();return;}
   if(token===undefined){const link=new URL(location.origin+'/');link.hash=new URLSearchParams({invite:(result as {token:string}).token}).toString();const box=main.querySelector('.human-invite-result');if(box)box.innerHTML=`<p>${U.inviteHint}</p><textarea readonly aria-label="${U.invite}">${esc(link.href)}</textarea><button data-human="copy-invite">${U.copy}</button>`;}
   else{await refreshMeta();render();say(U.added);}
  }catch(error){if(epoch===generation)say(error instanceof Error?error.message:T.error);}finally{mutating=false;}
 }
 async function hostRoom(){
  if(mutating||!session)return;mutating=true;const id=session.office.id,actorId=session.user.id,epoch=generation;let ready=false;
  try{await api(`/rooms/${id}/settings`,'POST',{open:true,dnd:false,actorId});
   const check=await api<Session>('/session'),next=await api<{viewerId:string;rooms:HumanRoom[]}>('/rooms');
   if(epoch!==generation||check.user.id!==actorId||next.viewerId!==actorId||session?.user.id!==actorId){clearRoom();session=null;profile=null;rooms=[];render();return;}
   rooms=next.rooms;ready=!!rooms.find(r=>r.id===id&&r.open);
  }catch(error){if(epoch===generation)say(error instanceof Error?error.message:T.error);}finally{mutating=false;}
  if(ready)await enter(id);
 }
 function syncActors(){
  if(!state)return;const ids=new Set(state.people.map(p=>p.id));for(const[id,a]of actors)if(!ids.has(id)){disposeActor(a);actors.delete(id);}
  for(const p of state.people){const signature=JSON.stringify([p.name,p.color,p.hair]);let a=actors.get(p.id);if(a&&a.signature!==signature){disposeActor(a);actors.delete(p.id);a=undefined;}
   if(!a){const ch=createCharacter({skin:'#dca681',hair:'#49372f',hairStyle:p.hair,shirt:HUMAN_COLORS[p.color],shirtTrim:'#f1e8c8',pants:'#283c4b',shoes:'#24272d',outfit:'hoodie'},1.1);ch.root.position.set(p.x,0,p.z);ch.root.userData.humanId=p.id;
    const ring=new THREE.Mesh(new THREE.RingGeometry(.48,.62,16),new THREE.MeshBasicMaterial({color:HUMAN_COLORS[p.color],side:THREE.DoubleSide}));ring.rotation.x=-Math.PI/2;ring.position.set(p.x,.035,p.z);group.add(ch.root,ring);
    const label=document.createElement('button');label.className='human-name';label.dataset.person=p.id;label.textContent=`${p.id===session?.user.id?T.you:T.person} · ${p.name}`;label.onclick=()=>{tab=p.id===session?.user.id?'avatar':'chat';panel.hidden=false;render();};labels.append(label);a={ch,ring,label,person:p,signature};actors.set(p.id,a);
   }a.person=p;
  }
 }
 const walkTo=(x:number,z:number)=>{if(!active())return false;if(x< -12||x>13||z< -8||z>8||!host.nav.walkable(x,z)){say(T.path);return false;}const route=host.nav.findPath(ownPos,{x,z});path=route.filter(p=>p.x>=-12&&p.x<=13&&p.z>=-8&&p.z<=8);return!!path.length;};
 const ray=new THREE.Raycaster(),ground=new THREE.Plane(new THREE.Vector3(0,1,0),0);
 host.canvas.addEventListener('pointerdown',e=>{
  if(!active()||document.body.classList.contains('building-view-open'))return;const r=host.canvas.getBoundingClientRect();ray.setFromCamera(new THREE.Vector2((e.clientX-r.left)/r.width*2-1,1-(e.clientY-r.top)/r.height*2),host.camera);
  const hit=ray.intersectObjects([...actors.values()].map(a=>a.ch.root),true)[0];if(hit&&!walking){e.preventDefault();e.stopPropagation();panel.hidden=false;tab='chat';render();return;}
  if(!walking)return;e.preventDefault();e.stopPropagation();const p=new THREE.Vector3();if(ray.ray.intersectPlane(ground,p))walkTo(p.x,p.z);
 });
 host.canvas.addEventListener('pointerup',e=>{if(walking&&active()){e.preventDefault();e.stopPropagation();}});
 panel.addEventListener('submit',e=>{e.preventDefault();const form=e.target as HTMLFormElement,d=Object.fromEntries(new FormData(form));
  if(form.matches('.human-accept')){let token=String(d.token??'').trim();try{token=new URLSearchParams(new URL(token).hash.slice(1)).get('invite')??token;}catch{}void invitationAction(token);}
  else if(form.matches('.human-profile-form'))void action('/human',d).then(()=>{if(profile){render();if(active())void readState();}});
  else if(form.matches('.human-room-settings'))void action(`/rooms/${session!.office.id}/settings`,{open:d.open==='on',dnd:d.dnd==='on'});
  else if(form.matches('.human-send')){const text=String(d.text??'').trim();if(!text||text.length>500)return;const item={clientId:crypto.randomUUID(),text,status:'sending' as const};pending.push(item);form.reset();void sendMessage(item);}
 });
 panel.addEventListener('click',e=>{const b=(e.target as HTMLElement).closest<HTMLButtonElement>('button');if(!b)return;
  if(b.dataset.tab){tab=b.dataset.tab as typeof tab;if(tab==='chat')unread=0;render();return;}const a=b.dataset.human;
  if(a==='invite')void invitationAction();else if(a==='host')void hostRoom();else if(a==='copy-invite'){const field=main.querySelector<HTMLTextAreaElement>('.human-invite-result textarea');if(field){field.select();void navigator.clipboard?.writeText(field.value).then(()=>say(U.copied)).catch(()=>{});}}else if(a==='close')panel.hidden=true;else if(a==='account'){panel.hidden=true;window.dispatchEvent(new Event('office-social-account'));}else if(a==='visits'){tab='visits';render();}else if(a==='walk'){walking=!walking;render();}else if(a==='leave')void leave();
  else if(b.dataset.enter)void enter(b.dataset.enter);else if(b.dataset.request)void action(`/rooms/${b.dataset.request}/request`);else if(b.dataset.admit)void action(`/rooms/${b.dataset.office}/requests/${b.dataset.admit}/accept`);else if(b.dataset.decline)void action(`/rooms/${b.dataset.office}/requests/${b.dataset.decline}/decline`);else if(b.dataset.cancelRequest)void action(`/rooms/${b.dataset.office}/requests/${b.dataset.cancelRequest}`,{},'DELETE');else if(b.dataset.kick)void action(`/rooms/${activeId}/kick/${b.dataset.kick}`);else if(b.dataset.deleteMessage)void action(`/rooms/${activeId}/messages/${b.dataset.deleteMessage}`,{},'DELETE');else if(b.dataset.retryMessage){const p=pending.find(p=>p.clientId===b.dataset.retryMessage);if(p&&p.status==='failed')void sendMessage(p);}
 });
 for(const kind of ['pointerdown','pointerup','pointermove','wheel','dblclick','keydown']as const)panel.addEventListener(kind,e=>{if(kind==='keydown'&&(e as KeyboardEvent).key==='Escape')panel.hidden=true;e.stopPropagation();});
 launcher.addEventListener('click',()=>{panel.hidden=!panel.hidden;if(!panel.hidden){unread=0;render();void refreshMeta();monitor();}});for(const kind of ['pointerdown','pointerup','dblclick']as const)launcher.addEventListener(kind,e=>e.stopPropagation());
 window.addEventListener('office-open-people',event=>{if((event as CustomEvent).detail?.tab==='visits')tab='visits';panel.hidden=false;render();void refreshMeta();monitor();});
 window.addEventListener('keydown',e=>{if(!walking||!active()||(e.target as HTMLElement).closest('input,textarea,select,dialog'))return;const d:Record<string,P2>={ArrowUp:{x:0,z:-1},ArrowDown:{x:0,z:1},ArrowLeft:{x:-1,z:0},ArrowRight:{x:1,z:0}};if(d[e.key]){e.preventDefault();e.stopImmediatePropagation();walkTo(ownPos.x+d[e.key].x,ownPos.z+d[e.key].z);}},true);
 window.addEventListener('pagehide',()=>{generation++;clearInterval(timer);if(activeId&&session)void fetch(`/api/building/rooms/${activeId}/leave`,{method:'POST',credentials:'same-origin',keepalive:true,headers:{'Content-Type':'application/json'},body:JSON.stringify({actorId:session.user.id,lease})}).catch(()=>{});clearActors();});
 async function resume(){let ticket;try{ticket=JSON.parse(sessionStorage.getItem(HINT)??'null');}catch{sessionStorage.removeItem(HINT);}if(!ticket&&sessionStorage.getItem(MONITOR)!=='1')return;await refreshMeta();if(ticket&&session?.user.id===ticket.userId&&currentRoom()===ticket.officeId&&Date.now()-ticket.at<86_400_000){await enter(ticket.officeId);}else if(ticket)sessionStorage.removeItem(HINT);monitor();}
 for(const kind of ['pointerdown','pointerup','dblclick','keydown']as const)labels.addEventListener(kind,e=>e.stopPropagation());
 window.addEventListener('office-ready',()=>{void resume();if(new URLSearchParams(location.search).get('people')==='1'){panel.hidden=false;render();void refreshMeta();monitor();}},{once:true});
 const update=(dt:number)=>{
  clockPhase+=dt;if(active()&&path.length){const p=path[0],dx=p.x-ownPos.x,dz=p.z-ownPos.z,d=Math.hypot(dx,dz),step=Math.min(d,dt*2.6);const x=ownPos.x+(d?dx/d*step:0),z=ownPos.z+(d?dz/d*step:0);if(host.nav.walkable(x,z)){ownPos={x,z};if(d<.06)path.shift();}else{path=[];say(T.path);}}
  const placed:{x:number;y:number;w:number;h:number}[]=[];
  for(const[id,a]of actors){const mine=id===session?.user.id;const dest=mine?ownPos:a.person;const before=a.ch.root.position.clone();a.ch.root.position.x+= (dest.x-a.ch.root.position.x)*Math.min(1,dt*10);a.ch.root.position.z+=(dest.z-a.ch.root.position.z)*Math.min(1,dt*10);const dx=a.ch.root.position.x-before.x,dz=a.ch.root.position.z-before.z,moving=Math.hypot(dx,dz)>.0002;if(moving)a.ch.root.rotation.y=Math.atan2(dx,dz);a.ch.setPose(moving?'walk':'stand',clockPhase);a.ring.position.set(a.ch.root.position.x,.035,a.ch.root.position.z);
   const p=a.ch.root.position.clone();p.y+=2.1;p.project(host.camera);const w=a.label.offsetWidth||160,h=a.label.offsetHeight||25;const x=Math.max(w/2+5,Math.min(innerWidth-w/2-5,(p.x+1)/2*innerWidth));let y=(1-p.y)/2*innerHeight;for(let n=0;n<16&&placed.some(r=>Math.abs(r.x-x)<(r.w+w)/2+5&&Math.abs(r.y-y)<(r.h+h)/2+3);n++)y-=h+4;placed.push({x,y,w,h});a.label.style.left=`${x}px`;a.label.style.top=`${y}px`;a.label.hidden=Math.abs(p.x)>1||Math.abs(p.y)>1;
  }
 };
 if(import.meta.env.DEV)Object.assign(window,{__humans:{walkTo,actors,state:()=>state,position:()=>ownPos,enter,leave}});
 return{update};
}

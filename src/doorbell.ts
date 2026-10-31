/** Polite, invitation-scoped requests. No messages, transcripts or visitor tracking. */
import { api, ApiError, type Session } from './building-api';
import type { FocusSession } from './social-api';
import { locale } from './i18n';
import './doorbell.css';
type Ring = {id:string;sessionId:string;requesterName:string;hostName:string;officeName:string;quiet:boolean;expiresAt:number;status:'pending'|'accepted'|'declined'};
type State = {viewerId:string;enabled:boolean;dnd:boolean;incoming:Ring[];outgoing:Ring[];sessions:FocusSession[]};
const T=locale({en:{officeVisits:'Office visits & chat',title:'A polite doorbell',close:'Close',intro:'Ask to join a friend’s focus session. A ring never grants access to private work.',enable:'Allow invited friends to ring',dnd:'Do Not Disturb',settings:'Your doorbell',save:'Save doorbell settings',settingsHint:'Off by default. While enabled, new focus participants need your approval. Do Not Disturb blocks new rings and declines pending requests; existing participants stay.',incoming:'At your door',empty:'No one is waiting.',accept:'Let them join',decline:'Not now',outgoing:'Your requests',dismiss:'Dismiss',cancel:'Cancel request',pending:'Waiting for host',accepted:'Accepted',declined:'Not this time',available:'Visit a focus session',ring:'Ring doorbell',quiet:'Join quietly · no check-in',consent:'Ringing asks the host to add you to this session. If accepted, your display name and quiet preference are shared with the host and joined peers. No work details are sent.',none:'No open doorbells. Your friend must enable their doorbell and host a focus session.',silenced:'Do Not Disturb',focus:'Open focus sessions',signin:'Use your optional office account to ring or manage your doorbell.',account:'Open Friends & characters',retry:'Try again',error:'Connection unavailable. Requests have been cleared.',loading:'Checking the door…',saved:'Done.',badge:'Doorbell',expires:'Requests expire after two minutes. Wait a minute between rings to the same host.',off:'Doorbell is off'},de:{officeVisits:'Bürobesuche & Chat',title:'Eine höfliche Türklingel',close:'Schließen',intro:'Frage nach einer Fokusrunde. Klingeln gibt keinen Zugriff auf private Arbeit.',enable:'Eingeladene Freunde dürfen klingeln',dnd:'Nicht stören',settings:'Deine Türklingel',save:'Klingeleinstellungen speichern',settingsHint:'Standardmäßig aus. Bei aktivierter Klingel brauchen neue Teilnehmer deine Zustimmung. Nicht stören blockiert Klingeln und lehnt wartende Anfragen ab. Teilnehmer bleiben.',incoming:'Vor deiner Tür',empty:'Niemand wartet.',accept:'Beitreten lassen',decline:'Jetzt nicht',outgoing:'Deine Anfragen',dismiss:'Ausblenden',cancel:'Anfrage zurückziehen',pending:'Wartet auf Gastgeber',accepted:'Angenommen',declined:'Diesmal nicht',available:'Eine Fokusrunde besuchen',ring:'Klingeln',quiet:'Ruhig beitreten · kein Check-in',consent:'Klingeln bittet um Aufnahme. Bei Annahme sehen Gastgeber und Teilnehmer deinen Namen und Ruhemodus. Keine Arbeitsdetails werden gesendet.',none:'Keine offene Klingel. Dein Freund muss die Klingel aktivieren und eine Fokusrunde starten.',silenced:'Nicht stören',focus:'Fokusrunden öffnen',signin:'Nutze dein optionales Bürokonto, um zu klingeln oder deine Klingel zu verwalten.',account:'Freunde & Charaktere öffnen',retry:'Erneut versuchen',error:'Verbindung nicht verfügbar. Anfragen wurden entfernt.',loading:'Tür wird geprüft…',saved:'Fertig.',badge:'Türklingel',expires:'Anfragen verfallen nach zwei Minuten. Zwischen Klingeln beim selben Gastgeber eine Minute warten.',off:'Klingel ist aus'}});
const esc=(s:string)=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]!);
const HINT='office.doorbell-active.v1';
export function installDoorbell(){
 const existing=document.querySelector<HTMLDialogElement>('.doorbell-office');if(existing)return {open:()=>existing.dispatchEvent(new Event('doorbell-open'))};
 const dialog=document.createElement('dialog');dialog.className='doorbell-office';dialog.setAttribute('aria-label',T.title);document.body.append(dialog);
 const badge=document.createElement('button');badge.className='doorbell-badge';badge.hidden=true;document.body.append(badge);
 let generation=0,busy=false,refreshing=false,user:Session|null=null,state:State|null=null,timer:ReturnType<typeof setInterval>|undefined,prior:HTMLElement|null=null;
 const seenAccepted=new Set<string>();
 const notice=(s:string)=>{const p=dialog.querySelector('[role=status]');if(p)p.textContent=s;};
 const clear=()=>{user=null;state=null;dialog.replaceChildren();badge.hidden=true;sessionStorage.removeItem(HINT);};
 const timers=()=>{if(dialog.open||state?.enabled||state?.outgoing.length){timer??=setInterval(()=>{void refresh();},5000);sessionStorage.setItem(HINT,'1');}else{clearInterval(timer);timer=undefined;sessionStorage.removeItem(HINT);}};
 const shell=()=>{dialog.innerHTML=`<header><h1>${T.title}</h1><button data-bell="close" aria-label="${T.close}">×</button></header><p>${T.intro}</p><button data-bell="office-visits">${T.officeVisits}</button><p role="status" aria-live="polite"></p><section><h2>${T.settings}</h2><form class="doorbell-settings"><label><input name="enabled" type="checkbox" ${state?.enabled?'checked':''}>${T.enable}</label><label><input name="dnd" type="checkbox" ${state?.dnd?'checked':''}>${T.dnd}</label><p>${T.settingsHint}</p><button type="submit">${T.save}</button></form></section><section><h2>${T.incoming}</h2><div class="doorbell-incoming"></div></section><section><h2>${T.outgoing}</h2><div class="doorbell-outgoing"></div></section><section><h2>${T.available}</h2><p>${T.consent}</p><p>${T.expires}</p><div class="doorbell-sessions"></div></section>`;};
 const lists=()=>{
  if(!state)return;
  const incoming=dialog.querySelector('.doorbell-incoming'),outgoing=dialog.querySelector('.doorbell-outgoing'),sessions=dialog.querySelector('.doorbell-sessions');
  const set=(el:Element|null,value:string)=>{if(el&&el.innerHTML!==value)el.innerHTML=value;};
  set(incoming,state.incoming.map(r=>`<article data-ring="${esc(r.id)}"><h3>${esc(r.requesterName)}</h3><p>${esc(r.officeName)} · ${r.quiet?T.quiet:'Focus'}</p><button data-accept="${esc(r.id)}">${T.accept}</button><button data-decline="${esc(r.id)}">${T.decline}</button></article>`).join('')||`<p>${T.empty}</p>`);
  set(outgoing,state.outgoing.map(r=>`<article data-outgoing="${esc(r.id)}"><h3>${esc(r.hostName)} · ${esc(r.officeName)}</h3><p>${r.status==='pending'?T.pending:r.status==='accepted'?T.accepted:T.declined}</p>${r.status==='accepted'?`<button data-bell="focus">${T.focus}</button>`:''}<button data-cancel="${esc(r.id)}">${r.status==='pending'?T.cancel:T.dismiss}</button></article>`).join('')||`<p>${T.empty}</p>`);
  const eligible=state.sessions.filter(s=>s.doorbell==='approval'&&!s.joined);
  // Preserve a guest's unsaved quiet choice across refreshes.
  const quiet=new Map([...dialog.querySelectorAll<HTMLInputElement>('[data-quiet]')].map(e=>[e.dataset.quiet,e.checked]));
  set(sessions,eligible.map(s=>`<article data-bell-session="${esc(s.id)}"><h3>${esc(s.hostName)} · ${esc(s.officeName)}</h3><label><input data-quiet="${esc(s.id)}" type="checkbox" checked>${T.quiet}</label><button data-ring-session="${esc(s.id)}" ${state!.outgoing.some(r=>r.sessionId===s.id&&r.status==='pending')?'disabled':''}>${T.ring}</button></article>`).join('')||`<p>${T.none}</p>`);
  dialog.querySelectorAll<HTMLInputElement>('[data-quiet]').forEach(e=>{if(quiet.has(e.dataset.quiet))e.checked=quiet.get(e.dataset.quiet)!;});
  dialog.querySelectorAll<HTMLButtonElement>('button:not([data-bell=close])').forEach(b=>{b.disabled=busy||!!(b.dataset.ringSession&&state!.outgoing.some(r=>r.sessionId===b.dataset.ringSession&&r.status==='pending'));});
 };
 async function refresh(){
  if(refreshing||busy)return;refreshing=true;const epoch=generation;
  try{const before=await api<Session>('/session'),next=await api<State>('/doorbell'),after=await api<Session>('/session');if(epoch!==generation)return;
   if(before.user.id!==after.user.id||next.viewerId!==after.user.id||(user&&user.user.id!==after.user.id)){clear();if(dialog.open)shell();return;}
   const first=!user;user=after;state=next;
   if(dialog.open){if(first||!dialog.querySelector('.doorbell-settings'))shell();lists();}
   badge.hidden=!state.enabled&&!state.outgoing.length&&!state.incoming.length;badge.textContent=`${T.badge} · ${state.dnd?T.silenced:state.incoming.length?state.incoming.length:state.outgoing.some(r=>r.status==='accepted')?T.accepted:state.enabled?'✓':T.off}`;
   for(const r of state.outgoing)if(r.status==='accepted'&&!seenAccepted.has(r.id)){seenAccepted.add(r.id);sessionStorage.setItem('office.focus-active.v1','1');window.dispatchEvent(new Event('office-focus-updated'));}
  }catch(error){if(epoch!==generation)return;clear();if(dialog.open){shell();dialog.querySelectorAll('section').forEach(e=>e.remove());notice(error instanceof ApiError&&error.status===401?T.signin:T.error);const b=document.createElement('button');b.dataset.bell=error instanceof ApiError&&error.status===401?'account':'retry';b.textContent=b.dataset.bell==='account'?T.account:T.retry;dialog.append(b);}}
  finally{refreshing=false;timers();}
 }
 async function mutate(path:string,method='POST',body:Record<string,unknown>={}){
  if(busy||!user)return;const epoch=generation,actorId=user.user.id;busy=true;lists();
  try{await api(path,method,{...body,actorId});if(epoch===generation)notice(T.saved);}
  catch(error){if(epoch===generation)notice(error instanceof Error?error.message:T.error);}
  finally{busy=false;if(epoch===generation){await refresh();lists();window.dispatchEvent(new Event('office-focus-updated'));}}
 }
 const open=()=>{prior=document.activeElement as HTMLElement;generation++;clear();shell();if(!dialog.open)dialog.showModal();notice(T.loading);void refresh();timers();};
 dialog.addEventListener('submit',e=>{e.preventDefault();const f=e.target as HTMLFormElement;if(!f.matches('.doorbell-settings'))return;const d=new FormData(f);void mutate('/doorbell/settings','POST',{enabled:d.has('enabled'),dnd:d.has('dnd')});});
 dialog.addEventListener('click',e=>{const b=(e.target as HTMLElement).closest<HTMLButtonElement>('button');if(!b||b.disabled)return;const a=b.dataset.bell;if(a==='close')dialog.close();else if(a==='office-visits'){dialog.close();window.dispatchEvent(new CustomEvent('office-open-people',{detail:{tab:'visits'}}));}else if(a==='retry')void refresh();else if(a==='account'){dialog.close();window.dispatchEvent(new Event('office-social-account'));}else if(a==='focus'){dialog.close();window.dispatchEvent(new CustomEvent('office-open-social',{detail:{tab:'focus'}}));}else if(b.dataset.ringSession){const id=b.dataset.ringSession;const quiet=[...dialog.querySelectorAll<HTMLInputElement>('[data-quiet]')].find(x=>x.dataset.quiet===id)?.checked??true;void mutate('/doorbell','POST',{sessionId:id,quiet});}else if(b.dataset.accept)void mutate(`/doorbell/${b.dataset.accept}/accept`);else if(b.dataset.decline)void mutate(`/doorbell/${b.dataset.decline}/decline`);else if(b.dataset.cancel)void mutate(`/doorbell/${b.dataset.cancel}`,'DELETE');});
 for(const kind of ['keydown','pointerdown','pointerup','wheel','dblclick']as const)dialog.addEventListener(kind,e=>e.stopPropagation());
 dialog.addEventListener('close',()=>{generation++;dialog.replaceChildren();timers();prior?.focus();});badge.addEventListener('click',open);for(const kind of ['pointerdown','pointerup','wheel','keydown']as const)badge.addEventListener(kind,e=>e.stopPropagation());dialog.addEventListener('doorbell-open',open);
 window.addEventListener('pagehide',()=>{generation++;clearInterval(timer);});
 if(sessionStorage.getItem(HINT)==='1'){void refresh();timers();}
 return{open};
}

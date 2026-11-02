/** Contextual first visit. Guides explicit actions; never creates accounts, grants or publications. */
import { locale } from './i18n';
import './tour.css';
const KEY='office.onboarding.v1',SEEN='office.welcome.v1';
const T=locale({
 en:{label:'Make yourself at home',welcome:'Your office is ready',intro:'Your characters are AI coworkers. Invite friends when you are ready.',start:'Show me around',skip:'Skip tour',later:'Continue later',resume:'Continue setup',done:'Finish tour',back:'Back',next:'Continue',optional:'Skip customization',privacy:'Only explicit choices share information. The guide never publishes your work.',
 titles:['An office of your own','Make it yours','Invite a friend','Welcome them in','Walk and talk','You stay in control'],
 text:['Your AI coworkers live here. You can use this office without an account.','Click a coworker to change their name or look. This is optional and stays local until you choose to share.','Create a local account only when you want friends. Make an invitation, or accept one you received, in the Friends panel.','Open & join your office to receive requests. Admit your friend, then let them choose to enter. Visiting a friend? Ring at their office.','Enter a conversation to share your human avatar and position. Send a greeting, or turn on Walk and tap open floor.','Leave room stops your presence. Visit settings contains Do Not Disturb and closing; Account & office settings lets you revoke access.'],
 actions:['Continue','Customize a coworker','Open Friends','Open Friends','Open conversation','Show visit controls'],waiting:'Your invitation is ready. Your friend still needs to accept, request a visit and be admitted.',requested:'Request sent. Wait for the host to admit you; then choose Walk into office.',admitted:'Your guest is admitted. They choose when to enter.',inline:['','','Create an account below, then invite a friend or accept an invitation.','Open your office below. Admit incoming requests, or ring at a friend’s office.','Send a greeting below, or turn on Walk to move.','Leave room stops presence. Visit controls contain Do Not Disturb, closing and access settings.'],progress:(n:number)=>`Step ${n} of 6`},
 de:{label:'Fühl dich wie zu Hause',welcome:'Dein Büro ist bereit',intro:'Deine Figuren sind KI-Kollegen. Lade Freunde ein, wenn du bereit bist.',start:'Zeig es mir',skip:'Tour überspringen',later:'Später fortsetzen',resume:'Einrichtung fortsetzen',done:'Tour beenden',back:'Zurück',next:'Weiter',optional:'Anpassung überspringen',privacy:'Nur ausdrückliche Entscheidungen teilen Daten. Die Tour veröffentlicht keine Arbeit.',
 titles:['Ein eigenes Büro','Mach es zu deinem','Freund einladen','Willkommen heißen','Gehen und sprechen','Du behältst die Kontrolle'],
 text:['Hier leben deine KI-Kollegen. Du brauchst kein Konto für dein Büro.','Klicke einen Kollegen an, um Namen oder Aussehen zu ändern. Das ist optional und bleibt lokal, bis du etwas teilst.','Erstelle ein lokales Konto erst für Freunde. Erstelle oder akzeptiere eine Einladung im Freunde-Bereich.','Öffne dein Büro und tritt bei, um Anfragen zu erhalten. Lass deinen Freund zu; er entscheidet selbst, wann er eintritt. Bei Freunden klingelst du am Büro.','Ein Gespräch teilt deinen menschlichen Avatar und Standort. Sende einen Gruß oder aktiviere Gehen und tippe auf freien Boden.','Raum verlassen beendet deine Anwesenheit. Besuchseinstellungen enthalten Nicht stören und Schließen; unter Konto & Büroeinstellungen widerrufst du Zugriff.'],
 actions:['Weiter','Kollegen anpassen','Freunde öffnen','Freunde öffnen','Gespräch öffnen','Besuchseinstellungen zeigen'],waiting:'Einladung bereit. Dein Freund muss sie annehmen, einen Besuch anfragen und zugelassen werden.',requested:'Anfrage gesendet. Warte auf Zustimmung, dann wähle Büro betreten.',admitted:'Dein Gast ist zugelassen. Er entscheidet, wann er eintritt.',inline:['','','Erstelle unten ein Konto und lade Freunde ein oder nimm eine Einladung an.','Öffne unten dein Büro. Lass Anfragen zu oder klingle bei Freunden.','Sende unten einen Gruß oder aktiviere Gehen.','Raum verlassen beendet Anwesenheit. Besuchseinstellungen enthalten Nicht stören, Schließen und Zugriff.'],progress:(n:number)=>`Schritt ${n} von 6`}
});
type Ticket={step:number;at:number;paused:boolean};
const read=(key:string)=>{try{return sessionStorage.getItem(key);}catch{return null;}};
export function installOfficeTour(){
 let ticket:Ticket|null=null,message='',generation=0;
 const card=document.createElement('section');card.className='office-tour';card.hidden=true;card.setAttribute('aria-label',T.label);document.body.append(card);
 const welcome=document.createElement('aside');welcome.className='office-welcome';welcome.hidden=true;welcome.setAttribute('aria-label',T.welcome);
 const heading=document.createElement('b'),hint=document.createElement('p'),startButton=document.createElement('button'),dismiss=document.createElement('button');
 heading.textContent=T.welcome;hint.textContent=T.intro;startButton.textContent=T.start;startButton.dataset.onboarding='start';dismiss.textContent='×';dismiss.setAttribute('aria-label',T.skip);dismiss.dataset.onboarding='dismiss';welcome.append(heading,hint,startButton,dismiss);document.body.append(welcome);
 const markSeen=()=>{try{localStorage.setItem(SEEN,'1');}catch{/* Browser privacy settings must not block the office. */}};
 const save=()=>{try{if(ticket)sessionStorage.setItem(KEY,JSON.stringify(ticket));else sessionStorage.removeItem(KEY);}catch{/* Session-only guide when storage is blocked. */}};
 const moveCard=()=>{const panel=document.querySelector<HTMLElement>('.human-panel:not([hidden])');const inDialog=!!document.querySelector('dialog[open]');const parent=panel&&!inDialog?panel:document.body;if(card.parentElement!==parent){if(parent===panel)parent.insertBefore(card,parent.querySelector('main'));else parent.append(card);}card.classList.toggle('in-people',parent===panel);};
 const contextKey=()=>{const p=document.querySelector('.human-panel:not([hidden])');return p?p.querySelector('[data-tab][aria-pressed=true]')?.getAttribute('data-tab')??'panel':'office';};
 const paint=()=>{
  if(!ticket||ticket.paused){card.hidden=true;if(ticket?.paused){welcome.hidden=false;heading.textContent=T.label;hint.textContent=T.text[ticket.step];startButton.textContent=T.resume;}return;}
  layout=contextKey();welcome.hidden=true;card.hidden=false;moveCard();card.dataset.step=String(ticket.step);card.replaceChildren();
  const inline=(ticket.step===2||ticket.step===3||ticket.step===5)?contextKey()==='visits':ticket.step===4&&contextKey()==='chat';
  card.classList.toggle('compact-guide',card.classList.contains('in-people'));
  const header=document.createElement('header'),progress=document.createElement('small'),skip=document.createElement('button'),title=document.createElement('h2'),text=document.createElement('p'),footer=document.createElement('footer');
  progress.textContent=T.progress(ticket.step+1);skip.textContent=T.skip;skip.dataset.tourAction='skip';title.textContent=T.titles[ticket.step];text.textContent=message||((card.classList.contains('in-people')&&ticket.step>=2)?T.inline[ticket.step]:T.text[ticket.step]);text.setAttribute('role','status');header.append(progress,skip);
  if(ticket.step>0&&!card.classList.contains('in-people')){const back=document.createElement('button');back.textContent=T.back;back.dataset.tourAction='back';footer.append(back);}
  const primary=document.createElement('button');primary.className='guide-primary';primary.textContent=inline&&ticket.step===4?T.next:inline&&ticket.step===5?T.done:T.actions[ticket.step];primary.dataset.tourAction=inline&&ticket.step===4?'continue':inline&&ticket.step===5?'finish':'next';if(!inline||ticket.step>=4)footer.append(primary);
  if(ticket.step>0&&!(inline&&ticket.step>=4)){const secondary=document.createElement('button');secondary.textContent=ticket.step===1?T.optional:ticket.step===5?T.done:ticket.step===4?T.next:T.later;secondary.dataset.tourAction=ticket.step===1?'customize-skip':ticket.step===5?'finish':ticket.step===4?'continue':'pause';footer.append(secondary);}
  card.append(header,title,text,footer);
 };
 const focusOffice=()=>{(document.querySelector<HTMLButtonElement>('.human-panel:not([hidden]) [data-tab][aria-pressed=true]')??document.querySelector<HTMLButtonElement>('.human-launcher'))?.focus();};
 const pause=()=>{if(ticket){ticket.paused=true;save();paint();focusOffice();}};
 const finish=()=>{generation++;ticket=null;save();markSeen();card.hidden=true;welcome.hidden=true;const u=new URL(location.href);u.searchParams.delete('tour');history.replaceState(null,'',u);focusOffice();};
 const setStep=(step:number)=>{if(!ticket)return;ticket.step=Math.max(0,Math.min(5,step));ticket.at=Date.now();message='';save();paint();};
 const start=()=>{generation++;ticket={step:0,at:Date.now(),paused:false};message='';markSeen();save();paint();card.querySelector<HTMLButtonElement>('[data-tour-action=next]')?.focus();};
 const openPeople=(tab:'visits'|'chat',controls=false)=>{window.dispatchEvent(new Event('office-building-close'));window.dispatchEvent(new CustomEvent('office-open-people',{detail:{tab,controls}}));paint();};
 card.addEventListener('click',event=>{
  const action=(event.target as HTMLElement).closest<HTMLElement>('[data-tour-action]')?.dataset.tourAction;if(!ticket||!action)return;event.stopPropagation();
  if(action==='skip'||action==='finish')return finish();if(action==='back')return setStep(ticket.step-1);if(action==='customize-skip')return setStep(2);if(action==='continue')return setStep(5);
  if(action==='pause'){pause();return;}
  if(action!=='next')return;
  if(ticket.step===0)setStep(1);
  else if(ticket.step===1)window.dispatchEvent(new Event('office-onboarding-customize'));
  else openPeople(ticket.step===4?'chat':'visits',ticket.step===5);
 });
 for(const kind of ['pointerdown','pointerup','pointermove','wheel','dblclick']as const)card.addEventListener(kind,event=>event.stopPropagation());
 card.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();pause();}if(event.key!=='Tab')event.stopPropagation();});
 welcome.addEventListener('click',event=>{const action=(event.target as HTMLElement).closest<HTMLElement>('[data-onboarding]')?.dataset.onboarding;if(action==='dismiss')finish();else if(action==='start'){if(ticket?.paused){ticket.paused=false;save();paint();}else start();}});
 const onProgress=(event:Event)=>{
  if(!ticket||ticket.paused)return;const {type,isOwner}=((event as CustomEvent).detail??{});
  if(type==='character-saved'&&ticket.step===1)setStep(2);
  else if((type==='invite-created'||type==='invite-accepted'||type==='friends-ready')&&ticket.step===2){setStep(3);if(type==='invite-created'){message=T.waiting;paint();}}
  else if((type==='people-together'||(type==='room-entered'&&isOwner===false))&&ticket.step===3)setStep(4);
  else if(type==='chat-sent'&&ticket.step===4)setStep(5);
  else if(type==='visit-requested'&&ticket.step===3){message=T.requested;paint();}
  else if(type==='guest-admitted'&&ticket.step===3){message=T.admitted;paint();}
 };
 window.addEventListener('office-onboarding-progress',onProgress);
 window.addEventListener('office-start-tour',start);
 let layout='';const observer=new MutationObserver(()=>{if(ticket&&!ticket.paused){const next=contextKey();if(next!==layout){layout=next;paint();}else moveCard();}});observer.observe(document.body,{subtree:true,attributes:true,attributeFilter:['hidden','open','aria-pressed']});
 window.addEventListener('pagehide',event=>{generation++;save();observer.disconnect();if(!event.persisted){card.remove();welcome.remove();}});
 window.addEventListener('pageshow',event=>{if(event.persisted){observer.observe(document.body,{subtree:true,attributes:true,attributeFilter:['hidden','open','aria-pressed']});ready();}});
 const ready=()=>{const epoch=generation;try{const value=JSON.parse(read(KEY)??'null');if(value&&Number.isInteger(value.step)&&value.step>=0&&value.step<6&&typeof value.paused==='boolean'&&typeof value.at==='number'&&Number.isFinite(value.at)&&Date.now()-value.at<7*86_400_000&&Date.now()>=value.at)ticket={step:value.step,at:value.at,paused:value.paused};else try{sessionStorage.removeItem(KEY);}catch{}}catch{/* Discard malformed hints, never load account data. */}
  if(epoch!==generation)return;if(new URLSearchParams(location.search).get('tour')==='1'&&!ticket)start();else if(ticket)paint();else{let seen=false;try{seen=localStorage.getItem(SEEN)==='1';}catch{}welcome.hidden=seen||new URLSearchParams(location.search).get('source')==='shared';}
 };
 if((window as unknown as {__ready?:boolean}).__ready)ready();else window.addEventListener('office-ready',ready,{once:true});
 return{start,stop:finish};
}

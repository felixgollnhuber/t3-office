/** Original-style decor on three raised shelves; no arbitrary coordinates, assets or navigation obstacles. */
import * as THREE from 'three';
import { toon } from './materials';
import { DEFAULT_IDENTITY, type FloorIdentity } from './appearance';
export const ACCENT_COLORS = { original:'#a5c2b1',sage:'#729c7c',amber:'#d9aa55',rose:'#bd798c',sky:'#71a4c2' };
export function addFloorIdentity(parent: THREE.Object3D, identity: FloorIdentity = DEFAULT_IDENTITY, miniature = false) {
  const root = new THREE.Group(); root.name = 'personal-floor'; root.userData.identity = identity; parent.add(root);
  if (identity.accent === 'original' && identity.emblem === 'none' && Object.values(identity.slots).every(v => v === 'none')) return root;
  const unit = new THREE.BoxGeometry(1,1,1); const accent = ACCENT_COLORS[identity.accent];
  const box = (color:string,x:number,y:number,z:number,w:number,h:number,d:number) => { const m=new THREE.Mesh(unit,toon(color));m.position.set(x,y,z);m.scale.set(w,h,d);m.castShadow=m.receiveShadow=true;root.add(m);return m; };
  const z = miniature ? -3.13 : -8.55; const y = miniature ? 1.2 : 1.85;
  const xs = miniature ? [-4.5,0,4.5] : [-6,0,6];
  box(accent,0,miniature?.32:.08,miniature?3.8:8.65,miniature?12:24,.07,.15);
  Object.values(identity.slots).forEach((item,i)=>{
    if(item==='none')return;const x=xs[i];box(accent,x,y,z,1.9,.12,.65);
    if(item==='plant'){box('#b88259',x,y+.28,z,.5,.45,.45);box('#537b58',x-.15,y+.68,z,.45,.5,.4);box('#6b9867',x+.18,y+.9,z,.38,.5,.35);}
    if(item==='books')for(let n=0;n<4;n++)box([accent,'#d9c6a0','#7e98b1','#a5736e'][n],x-.55+n*.34,y+.38,z,.24,.6+n%2*.15,.4);
    if(item==='lamp'){box('#384944',x,y+.09,z,.6,.12,.5);box('#9c9276',x,y+.48,z,.1,.7,.1);box('#ffe0a1',x,y+.84,z,.8,.28,.55);}
  });
  if(identity.emblem!=='none'){
    const x=miniature?5.5:10;box(accent,x,2.55,z,.95,.95,.12);
    if(identity.emblem==='star'){box('#fff1bb',x,2.55,z+.1,.22,.75,.08);box('#fff1bb',x,2.55,z+.1,.75,.22,.08);}
    if(identity.emblem==='leaf'){const leaf=box('#eff2d4',x,2.55,z+.1,.35,.65,.08);leaf.rotation.z=-.55;}
    if(identity.emblem==='moon'){box('#fff1bb',x-.12,2.55,z+.1,.35,.65,.08);box('#fff1bb',x+.12,2.25,z+.1,.3,.18,.08);box('#fff1bb',x+.12,2.85,z+.1,.3,.18,.08);}
  }
  root.userData.dispose=()=>unit.dispose();return root;
}

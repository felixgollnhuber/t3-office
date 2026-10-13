import * as THREE from 'three';
import { toon } from './materials';

export type HairStyle = 'short' | 'long' | 'bun' | 'curly' | 'bald' | 'cap' | 'ponytail' | 'mohawk';
export type Outfit = 'hoodie' | 'blazer' | 'tee' | 'sweater';

export interface Look {
  skin: string;
  hair: string;
  hairStyle: HairStyle;
  shirt: string;
  shirtTrim: string;
  pants: string;
  shoes: string;
  outfit: Outfit;
  glasses?: boolean;
  headphones?: string;
  lanyard?: string;
}

export type Pose =
  | 'typing'
  | 'sitIdle'
  | 'sleepDesk'
  | 'raiseHand'
  | 'headInHands'
  | 'cheerSeated'
  | 'stand'
  | 'walk'
  | 'coffee'
  | 'phone'
  | 'dance'
  // two more dance moves for the dance floor
  | 'dance2'
  | 'dance3'
  | 'cheer'
  | 'sitCouch'
  | 'water'
  | 'paddle'
  | 'crossLegs'
  | 'point'
  | 'carry'
  | 'wave'
  | 'knock'
  | 'watering'
  | 'stretch'
  | 'dj'
  // at the desk, by what the agent is doing or what just happened
  | 'hack'
  | 'mouse'
  | 'watch'
  | 'facepalm'
  | 'proud'
  | 'lookUp'
  | 'shrug'
  // on their feet
  | 'read'
  | 'handUp'
  | 'handUpL'
  | 'carryPapers'
  | 'feed'
  | 'strike'
  | 'highFive'
  | 'highFiveL'
  | 'pace'
  // elsewhere
  | 'sitTalk'
  | 'sitListen'
  | 'lie';

export interface Character {
  root: THREE.Group;
  head: THREE.Object3D;
  setPose(p: Pose, phase?: number): void;
  headHeight: number;
  backpack: THREE.Object3D;
  scale: number;
  /** Overlay on top of the current pose: keeps a mug or phone in the right hand. */
  hold(kind: 'mug' | 'phone' | 'umbrella'): void;
  /** Overlay on top of the current pose: the left hand wipes the forehead. */
  wipe(phase: number): void;
}

function part(w: number, h: number, d: number, color: string, y = -h / 2) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), toon(color));
  m.position.y = y;
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

export function createCharacter(look: Look, scale = 1): Character {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);

  const thighL = 0.2, shinL = 0.2, legW = 0.15;
  const torsoH = 0.42, torsoW = 0.42, torsoD = 0.26;
  const armL = 0.38, armW = 0.12;

  const hips = new THREE.Group();
  hips.position.y = thighL + shinL;
  body.add(hips);

  const makeLeg = (x: number) => {
    const thigh = new THREE.Group();
    thigh.position.x = x;
    thigh.add(part(legW, thighL, legW + 0.02, look.pants));
    const shin = new THREE.Group();
    shin.position.y = -thighL;
    shin.add(part(legW, shinL - 0.05, legW, look.pants, -(shinL - 0.05) / 2));
    const shoe = part(legW + 0.02, 0.06, legW + 0.08, look.shoes, -shinL + 0.03);
    shoe.position.z = 0.03;
    shin.add(shoe);
    thigh.add(shin);
    hips.add(thigh);
    return { thigh, shin };
  };
  const legLeft = makeLeg(-0.11);
  const legRight = makeLeg(0.11);

  const torso = new THREE.Group();
  hips.add(torso);
  torso.add(part(torsoW, torsoH, torsoD, look.shirt, torsoH / 2));
  if (look.outfit === 'blazer') {
    const shirtFront = part(0.12, torsoH - 0.06, 0.02, '#f2efe6', torsoH / 2 + 0.02);
    shirtFront.position.z = torsoD / 2 + 0.005;
    torso.add(shirtFront);
    const tie = part(0.04, 0.22, 0.02, look.shirtTrim, torsoH - 0.14);
    tie.position.z = torsoD / 2 + 0.015;
    torso.add(tie);
  } else if (look.outfit === 'hoodie') {
    const pocket = part(0.26, 0.1, 0.02, look.shirtTrim, 0.1);
    pocket.position.z = torsoD / 2 + 0.005;
    torso.add(pocket);
    const hood = part(torsoW - 0.04, 0.1, 0.12, look.shirtTrim, torsoH - 0.02);
    hood.position.z = -torsoD / 2;
    torso.add(hood);
  } else if (look.outfit === 'sweater') {
    const stripe = part(torsoW + 0.01, 0.06, torsoD + 0.01, look.shirtTrim, torsoH * 0.55);
    torso.add(stripe);
  } else {
    const print = part(0.12, 0.1, 0.02, look.shirtTrim, torsoH * 0.6);
    print.position.z = torsoD / 2 + 0.005;
    torso.add(print);
  }
  if (look.lanyard) {
    const strap = part(0.03, 0.2, 0.02, look.lanyard, torsoH - 0.1);
    strap.position.z = torsoD / 2 + 0.01;
    torso.add(strap);
    const badge = part(0.08, 0.1, 0.02, '#f7f4ea', torsoH - 0.25);
    badge.position.z = torsoD / 2 + 0.015;
    torso.add(badge);
  }

  const head = new THREE.Group();
  head.position.y = torsoH;
  torso.add(head);
  const hs = 0.44;
  head.add(part(hs, hs - 0.02, hs - 0.04, look.skin, (hs - 0.02) / 2 + 0.02));
  const eyeY = hs * 0.48;
  for (const x of [-0.09, 0.09]) {
    const eye = part(0.05, 0.07, 0.02, '#221a22', eyeY);
    eye.position.set(x, eyeY, (hs - 0.04) / 2 + 0.005);
    head.add(eye);
    const blush = part(0.06, 0.03, 0.02, '#f08c8c', eyeY - 0.08);
    blush.position.set(x * 1.45, eyeY - 0.08, (hs - 0.04) / 2 + 0.004);
    blush.material = toon('#f2a19a');
    head.add(blush);
  }
  if (look.glasses) {
    const frame = part(0.34, 0.03, 0.02, '#1f1b22', eyeY + 0.05);
    frame.position.z = (hs - 0.04) / 2 + 0.015;
    head.add(frame);
  }

  const hair = toon(look.hair);
  const hairBox = (w: number, h: number, d: number, x: number, y: number, z: number) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), hair);
    m.position.set(x, y, z);
    m.castShadow = true;
    head.add(m);
  };
  const top = hs + 0.02;
  switch (look.hairStyle) {
    case 'short':
      hairBox(hs + 0.04, 0.1, hs, 0, top, -0.01);
      hairBox(hs + 0.04, 0.22, 0.08, 0, top - 0.12, -hs / 2 + 0.02);
      hairBox(hs * 0.6, 0.06, 0.04, -0.06, top - 0.06, hs / 2 - 0.01);
      break;
    case 'long':
      hairBox(hs + 0.06, 0.1, hs + 0.02, 0, top, 0);
      hairBox(hs + 0.06, 0.48, 0.1, 0, top - 0.24, -hs / 2 + 0.01);
      hairBox(0.06, 0.36, hs * 0.7, -hs / 2 - 0.02, top - 0.18, -0.06);
      hairBox(0.06, 0.36, hs * 0.7, hs / 2 + 0.02, top - 0.18, -0.06);
      hairBox(hs + 0.04, 0.07, 0.04, 0, top - 0.05, hs / 2 - 0.01);
      break;
    case 'bun':
      hairBox(hs + 0.04, 0.08, hs, 0, top - 0.01, -0.01);
      hairBox(hs + 0.04, 0.2, 0.08, 0, top - 0.1, -hs / 2 + 0.02);
      hairBox(0.18, 0.16, 0.18, 0, top + 0.1, -0.06);
      break;
    case 'curly':
      hairBox(hs + 0.12, 0.18, hs + 0.08, 0, top + 0.03, -0.02);
      hairBox(hs + 0.12, 0.3, 0.12, 0, top - 0.14, -hs / 2);
      hairBox(0.08, 0.2, hs * 0.8, -hs / 2 - 0.04, top - 0.08, -0.03);
      hairBox(0.08, 0.2, hs * 0.8, hs / 2 + 0.04, top - 0.08, -0.03);
      break;
    case 'ponytail':
      hairBox(hs + 0.04, 0.09, hs, 0, top - 0.01, -0.01);
      hairBox(hs + 0.04, 0.22, 0.08, 0, top - 0.1, -hs / 2 + 0.02);
      hairBox(0.12, 0.3, 0.12, 0, top - 0.2, -hs / 2 - 0.08);
      break;
    case 'mohawk':
      hairBox(0.1, 0.16, hs, 0, top + 0.05, 0);
      break;
    case 'cap': {
      const capMat = toon(look.shirtTrim);
      const cap = new THREE.Mesh(new THREE.BoxGeometry(hs + 0.04, 0.12, hs + 0.02), capMat);
      cap.position.set(0, top, 0);
      head.add(cap);
      const brim = new THREE.Mesh(new THREE.BoxGeometry(hs, 0.03, 0.18), capMat);
      brim.position.set(0, top - 0.05, hs / 2 + 0.08);
      head.add(brim);
      hairBox(hs + 0.02, 0.12, 0.06, 0, top - 0.12, -hs / 2 + 0.02);
      break;
    }
    case 'bald':
      break;
  }
  if (look.headphones) {
    const hp = toon(look.headphones);
    const band = new THREE.Mesh(new THREE.BoxGeometry(hs + 0.12, 0.05, 0.08), hp);
    band.position.set(0, top + 0.06, 0);
    head.add(band);
    for (const x of [-1, 1]) {
      const cup = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.16, 0.16), hp);
      cup.position.set(x * (hs / 2 + 0.05), eyeY, 0);
      head.add(cup);
    }
  }

  const makeArm = (side: number) => {
    const shoulder = new THREE.Group();
    shoulder.position.set(side * (torsoW / 2 + armW / 2), torsoH - 0.06, 0);
    shoulder.add(part(armW, armL - 0.08, armW + 0.02, look.shirt, -(armL - 0.08) / 2));
    shoulder.add(part(armW - 0.01, 0.08, armW, look.skin, -armL + 0.04));
    torso.add(shoulder);
    return shoulder;
  };
  const armLeft = makeArm(-1);
  const armRight = makeArm(1);

  const prop = new THREE.Group();
  prop.position.y = -armL;
  armRight.add(prop);
  // a sticky note, one for each hand
  const [noteL, noteR] = [armLeft, armRight].map((arm) => {
    const n = part(0.17, 0.17, 0.03, '#ffe07a', -armL - 0.07);
    n.visible = false;
    arm.add(n);
    return n;
  });

  const mug = new THREE.Group();
  mug.add(part(0.1, 0.12, 0.1, '#f4efe4', 0));
  mug.add(part(0.04, 0.06, 0.02, '#f4efe4', 0).translateX(0.07));
  const phone = part(0.08, 0.14, 0.03, '#22202a', 0);
  const paddle = new THREE.Group();
  paddle.add(part(0.04, 0.12, 0.04, '#8a5a35', 0));
  paddle.add(part(0.2, 0.2, 0.03, '#c9423b', 0.14));
  const cup = part(0.08, 0.1, 0.08, '#cfe8ff', 0);
  const can = new THREE.Group();
  can.add(part(0.14, 0.14, 0.2, '#3d8a6e', 0));
  can.add(part(0.03, 0.03, 0.16, '#3d8a6e', 0.04).translateZ(0.16));

  const umbrella = new THREE.Group();
  umbrella.add(part(0.03, 0.6, 0.03, '#2a2a30', -0.3));
  umbrella.add(part(0.12, 0.4, 0.12, ['#2f6f73', '#c9423b', '#2a2a30', '#f2c94c'][Math.floor(Math.random() * 4)], -0.36));
  umbrella.add(part(0.05, 0.07, 0.05, '#6b4a2f', 0));
  umbrella.visible = false;

  const book = new THREE.Group();
  book.add(part(0.3, 0.03, 0.22, '#c9423b', 0));
  book.add(part(0.27, 0.02, 0.2, '#f6f2ea', 0.02));
  const mallet = new THREE.Group();
  mallet.add(part(0.04, 0.5, 0.04, '#c9a26b', -0.2));
  mallet.add(part(0.14, 0.14, 0.14, '#c9423b', -0.5));

  const props = { mug, phone, paddle, cup, can, umbrella, book, mallet };

  const crate = new THREE.Group();
  crate.add(part(0.46, 0.28, 0.34, '#c9a26b', 0.14));
  crate.add(part(0.2, 0.12, 0.12, '#4f9a3c', 0.32).translateX(0.08));
  crate.add(part(0.08, 0.1, 0.08, '#e8556b', 0.31).translateX(-0.12));
  crate.position.set(0, torsoH * 0.35, torsoD / 2 + 0.24);
  crate.visible = false;
  torso.add(crate);

  // a stack of paper carried in both arms
  const papers = new THREE.Group();
  for (let i = 0; i < 6; i++) papers.add(part(0.26, 0.045, 0.32, i % 2 ? '#f6f2ea' : '#dcd5c6', 0.045 * i + 0.02).translateX(i % 2 ? 0.012 : -0.012));
  papers.position.set(0, torsoH * 0.32, torsoD / 2 + 0.22);
  papers.visible = false;
  torso.add(papers);

  const backpack = new THREE.Group();
  backpack.add(part(0.32, 0.34, 0.14, look.shirtTrim, torsoH * 0.5 + 0.17));
  backpack.add(part(0.24, 0.1, 0.04, look.pants, torsoH * 0.3 + 0.05).translateZ(-0.08));
  backpack.position.z = -torsoD / 2 - 0.07;
  backpack.visible = false;
  torso.add(backpack);
  for (const p of Object.values(props)) {
    p.visible = false;
    prop.add(p);
  }

  root.scale.setScalar(scale);

  const reset = () => {
    body.position.set(0, 0, 0);
    body.rotation.set(0, 0, 0);
    hips.position.y = thighL + shinL;
    torso.rotation.set(0, 0, 0);
    torso.scale.z = 1;
    head.rotation.set(0, 0, 0);
    props.book.position.set(0, 0, 0);
    for (const l of [legLeft, legRight]) {
      l.thigh.rotation.set(0, 0, 0);
      l.shin.rotation.set(0, 0, 0);
    }
    armLeft.rotation.set(0, 0, 0);
    armRight.rotation.set(0, 0, 0);
    for (const p of Object.values(props)) p.visible = false;
    crate.visible = false;
    papers.visible = false;
    noteL.visible = noteR.visible = false;
  };

  const sit = (seatH: number) => {
    hips.position.y = seatH;
    for (const l of [legLeft, legRight]) {
      l.thigh.rotation.x = -Math.PI / 2;
      l.shin.rotation.x = Math.PI / 2;
    }
  };

  const setPose = (p: Pose, phase = 0) => {
    reset();
    const s = Math.sin(phase);
    switch (p) {
      case 'typing':
        sit(0.46);
        torso.rotation.x = 0.12;
        armLeft.rotation.x = -1.25 + s * 0.08;
        armRight.rotation.x = -1.25 - s * 0.08;
        armLeft.rotation.z = 0.18;
        armRight.rotation.z = -0.18;
        head.rotation.x = 0.05 + s * 0.04;
        break;
      case 'sitIdle':
        sit(0.46);
        torso.rotation.x = -0.12;
        armLeft.rotation.x = -0.5;
        armRight.rotation.x = -2.6;
        armRight.rotation.z = 0.5;
        head.rotation.x = -0.15;
        head.rotation.z = 0.15;
        break;
      case 'sleepDesk':
        sit(0.46);
        torso.rotation.x = 0.85;
        armLeft.rotation.x = -1.6;
        armRight.rotation.x = -1.6;
        armLeft.rotation.z = 0.5;
        armRight.rotation.z = -0.5;
        head.rotation.x = 0.4;
        break;
      case 'raiseHand':
        sit(0.46);
        armRight.rotation.x = -Math.PI + 0.15;
        armRight.rotation.z = -0.15;
        armLeft.rotation.x = -1.1;
        head.rotation.x = -0.15;
        break;
      case 'headInHands':
        sit(0.46);
        torso.rotation.x = 0.35;
        armLeft.rotation.x = -2.5;
        armRight.rotation.x = -2.5;
        armLeft.rotation.z = 0.4;
        armRight.rotation.z = -0.4;
        head.rotation.x = 0.35;
        break;
      case 'cheerSeated':
        sit(0.46);
        armLeft.rotation.z = -2.6;
        armRight.rotation.z = 2.6;
        head.rotation.x = -0.2;
        break;
      case 'stand':
        armLeft.rotation.z = 0.08;
        armRight.rotation.z = -0.08;
        break;
      case 'walk':
        legLeft.thigh.rotation.x = s * 0.5;
        legRight.thigh.rotation.x = -s * 0.5;
        legLeft.shin.rotation.x = Math.max(0, s) * 0.35;
        legRight.shin.rotation.x = Math.max(0, -s) * 0.35;
        armLeft.rotation.x = -s * 0.45;
        armRight.rotation.x = s * 0.45;
        armLeft.rotation.z = 0.06;
        armRight.rotation.z = -0.06;
        body.position.y = Math.abs(Math.cos(phase)) * 0.03;
        break;
      case 'coffee':
        armRight.rotation.x = -1.4;
        armRight.rotation.z = 0.2;
        props.mug.visible = true;
        props.mug.rotation.x = 1.4;
        armLeft.rotation.z = 0.1;
        break;
      case 'water':
        armRight.rotation.x = -1.4;
        armRight.rotation.z = 0.2;
        props.cup.visible = true;
        props.cup.rotation.x = 1.4;
        armLeft.rotation.x = -0.3;
        armLeft.rotation.z = 0.6;
        head.rotation.z = 0.12;
        break;
      case 'phone':
        armRight.rotation.x = -2.6;
        armRight.rotation.z = -0.45;
        props.phone.visible = true;
        armLeft.rotation.x = 0.2;
        head.rotation.z = 0.2;
        break;
      case 'dance': {
        const b = Math.abs(Math.sin(phase));
        const alt = Math.sin(phase * 0.5) > 0;
        armLeft.rotation.z = alt ? -2.5 + s * 0.35 : -0.6 - b * 0.4;
        armRight.rotation.z = alt ? 0.6 + b * 0.4 : 2.5 - s * 0.35;
        armLeft.rotation.x = alt ? 0 : -0.8;
        armRight.rotation.x = alt ? -0.8 : 0;
        torso.rotation.z = s * 0.12;
        head.rotation.x = -0.1 + b * 0.25;
        legLeft.thigh.rotation.x = -b * 0.35;
        legLeft.shin.rotation.x = b * 0.6;
        legRight.thigh.rotation.x = -(1 - b) * 0.2;
        legRight.shin.rotation.x = (1 - b) * 0.3;
        body.position.y = 0.01 + b * 0.07;
        break;
      }
      // ---- dance floor: two more moves, both down on the beat (phase = beat * PI) ----
      case 'dance2': {
        // two-step: the weight shifts every two beats, one fist pumps on every beat
        const b = Math.abs(s);
        const side = Math.sin(phase * 0.5) > 0 ? 1 : -1;
        body.position.x = side * 0.05;
        body.position.y = 0.01 + b * 0.05;
        torso.rotation.z = side * 0.13;
        torso.rotation.y = side * 0.3;
        head.rotation.z = -side * 0.1;
        head.rotation.x = 0.28 - b * 0.3;
        const fist = side > 0 ? armRight : armLeft, other = side > 0 ? armLeft : armRight;
        fist.rotation.x = -2.9 + b * 0.8;
        fist.rotation.z = side * 0.25;
        other.rotation.x = -0.9 + b * 0.25;
        other.rotation.z = -side * 0.4;
        const step = side > 0 ? legLeft : legRight;
        step.thigh.rotation.x = -b * 0.5;
        step.shin.rotation.x = b * 0.8;
        break;
      }
      case 'dance3': {
        // jumping: both hands in the air, off the floor between the beats
        const b = Math.abs(s);
        armLeft.rotation.z = -2.8 + s * 0.22;
        armRight.rotation.z = 2.8 + s * 0.22;
        armLeft.rotation.x = armRight.rotation.x = -0.3;
        head.rotation.x = 0.2 - b * 0.4;
        for (const l of [legLeft, legRight]) {
          l.thigh.rotation.x = -(1 - b) * 0.35;
          l.shin.rotation.x = (1 - b) * 0.7;
        }
        body.position.y = b * 0.17;
        break;
      }
      case 'dj': {
        const b = Math.abs(Math.sin(phase));
        armLeft.rotation.z = -2.2;
        armLeft.rotation.x = -0.6;
        armRight.rotation.x = -1.1 + s * 0.2;
        armRight.rotation.z = -0.2;
        head.rotation.x = 0.1 + b * 0.3;
        head.rotation.z = -0.15;
        body.position.y = b * 0.03;
        break;
      }
      case 'cheer':
        armLeft.rotation.z = -2.7;
        armRight.rotation.z = 2.7;
        head.rotation.x = -0.25;
        body.position.y = 0.1;
        break;
      case 'sitCouch':
        sit(0.36);
        torso.rotation.x = -0.35;
        armLeft.rotation.x = -0.4;
        armRight.rotation.x = -1.0;
        props.phone.visible = true;
        head.rotation.x = 0.3;
        break;
      case 'paddle':
        armRight.rotation.x = -1.2;
        armRight.rotation.z = -0.6;
        props.paddle.visible = true;
        props.paddle.rotation.x = 1.2;
        legLeft.thigh.rotation.x = -0.3;
        legRight.thigh.rotation.x = 0.2;
        torso.rotation.x = 0.2;
        hips.position.y -= 0.04;
        break;
      case 'crossLegs':
        legLeft.thigh.rotation.z = -0.18;
        legRight.thigh.rotation.z = 0.18;
        armLeft.rotation.x = -0.4;
        armRight.rotation.x = -0.4;
        armLeft.rotation.z = -0.5;
        armRight.rotation.z = 0.5;
        head.rotation.x = -0.1;
        head.rotation.z = -0.15;
        break;
      case 'point':
        armRight.rotation.x = -1.6;
        armRight.rotation.z = -0.3;
        head.rotation.y = -0.3;
        break;
      case 'carry':
        armLeft.rotation.x = -1.25;
        armRight.rotation.x = -1.25;
        armLeft.rotation.z = 0.25;
        armRight.rotation.z = -0.25;
        crate.visible = true;
        legLeft.thigh.rotation.x = s * 0.4;
        legRight.thigh.rotation.x = -s * 0.4;
        legLeft.shin.rotation.x = Math.max(0, s) * 0.3;
        legRight.shin.rotation.x = Math.max(0, -s) * 0.3;
        body.position.y = Math.abs(Math.cos(phase)) * 0.025;
        break;
      case 'wave':
        armRight.rotation.z = 2.6 + s * 0.35;
        armLeft.rotation.z = 0.08;
        head.rotation.z = -0.1;
        break;
      case 'knock':
        armRight.rotation.x = -1.7 + Math.max(0, s) * 0.35;
        armRight.rotation.z = -0.15;
        armLeft.rotation.z = 0.1;
        break;
      case 'watering':
        armRight.rotation.x = -1.1;
        props.can.visible = true;
        props.can.rotation.x = 1.1 + 0.5 + s * 0.1;
        head.rotation.x = 0.35;
        break;
      case 'stretch':
        sit(0.46);
        torso.rotation.x = -0.25;
        armLeft.rotation.z = -2.9;
        armRight.rotation.z = 2.9;
        head.rotation.x = -0.35;
        break;
      case 'hack':
        // hammering the keyboard: hunched over, both hands flying
        sit(0.46);
        torso.rotation.x = 0.3;
        armLeft.rotation.x = -1.1 + s * 0.26;
        armRight.rotation.x = -1.1 - s * 0.26;
        armLeft.rotation.z = 0.2;
        armRight.rotation.z = -0.2;
        head.rotation.x = 0.1 + Math.abs(s) * 0.08;
        body.position.y = Math.abs(s) * 0.012;
        break;
      case 'mouse':
        // one hand on the mouse, chin in the other, eyes going down a list
        sit(0.46);
        torso.rotation.x = 0.16;
        armRight.rotation.x = -1.2;
        armRight.rotation.z = 0.32 + s * 0.07;
        armLeft.rotation.x = -2.45;
        armLeft.rotation.z = 0.42;
        head.rotation.x = 0.12;
        head.rotation.y = s * 0.16;
        break;
      case 'watch':
        // leaning back with crossed arms while something runs
        sit(0.46);
        torso.rotation.x = -0.22;
        armLeft.rotation.x = -1.0;
        armRight.rotation.x = -1.0;
        armLeft.rotation.z = 0.85;
        armRight.rotation.z = -0.85;
        head.rotation.x = 0.1 + s * 0.03;
        break;
      case 'facepalm':
        sit(0.46);
        torso.rotation.x = 0.22;
        armRight.rotation.x = -2.55;
        armRight.rotation.z = -0.55;
        armLeft.rotation.x = -1.0;
        head.rotation.x = 0.32;
        head.rotation.z = s * 0.05;
        break;
      case 'proud': {
        // both fists pumping
        const b = Math.abs(s);
        sit(0.46);
        torso.rotation.x = -0.18;
        armLeft.rotation.x = -2.0 - b * 0.5;
        armRight.rotation.x = -2.0 - b * 0.5;
        armLeft.rotation.z = -0.35;
        armRight.rotation.z = 0.35;
        head.rotation.x = -0.25;
        body.position.y = b * 0.03;
        break;
      }
      case 'lookUp':
        sit(0.46);
        torso.rotation.x = -0.1;
        armLeft.rotation.x = -0.7;
        armRight.rotation.x = -0.7;
        head.rotation.x = -0.4;
        break;
      case 'shrug':
        sit(0.46);
        torso.rotation.x = -0.1;
        armLeft.rotation.x = -0.9;
        armRight.rotation.x = -0.9;
        armLeft.rotation.z = -0.8 - Math.abs(s) * 0.25;
        armRight.rotation.z = 0.8 + Math.abs(s) * 0.25;
        head.rotation.z = 0.22;
        body.position.y = Math.abs(s) * 0.02;
        break;
      case 'read':
        // an open book in both hands, turning a page now and then
        armRight.rotation.x = -1.15;
        armRight.rotation.z = 0.28;
        armLeft.rotation.x = -1.15 - Math.max(0, s) * 0.4;
        armLeft.rotation.z = -0.28;
        props.book.visible = true;
        props.book.rotation.x = 1.15;
        props.book.position.set(-0.14, 0, 0.04);
        head.rotation.x = 0.38;
        break;
      case 'handUp':
      case 'handUpL': {
        // a hand up beside the head (the head is too big to reach over), holding up a note with the question
        const left = p === 'handUpL';
        (left ? armLeft : armRight).rotation.z = (left ? -1 : 1) * (2.7 + s * 0.16);
        (left ? armRight : armLeft).rotation.z = left ? -0.08 : 0.08;
        (left ? noteL : noteR).visible = true;
        head.rotation.x = -0.12;
        break;
      }
      case 'carryPapers':
        armLeft.rotation.x = -1.2;
        armRight.rotation.x = -1.2;
        armLeft.rotation.z = 0.2;
        armRight.rotation.z = -0.2;
        papers.visible = true;
        legLeft.thigh.rotation.x = s * 0.4;
        legRight.thigh.rotation.x = -s * 0.4;
        legLeft.shin.rotation.x = Math.max(0, s) * 0.3;
        legRight.shin.rotation.x = Math.max(0, -s) * 0.3;
        body.position.y = Math.abs(Math.cos(phase)) * 0.025;
        torso.rotation.x = -0.08;
        break;
      case 'feed':
        // bent over a machine, pushing something in
        torso.rotation.x = 0.3;
        armLeft.rotation.x = -0.95 + s * 0.08;
        armRight.rotation.x = -0.95 - s * 0.08;
        armLeft.rotation.z = 0.2;
        armRight.rotation.z = -0.2;
        head.rotation.x = 0.35;
        break;
      case 'strike': {
        // phase 0..1: the mallet goes back over the shoulder and comes down
        const k = THREE.MathUtils.clamp(phase, 0, 1);
        const back = Math.sin(Math.min(1, k / 0.55) * Math.PI * 0.5), fwd = THREE.MathUtils.smoothstep(k, 0.55, 0.8);
        armRight.rotation.x = -0.4 - back * 2.5 + fwd * 1.6;
        armRight.rotation.z = -0.1;
        torso.rotation.y = -0.35 * back + 0.5 * fwd;
        torso.rotation.x = fwd * 0.18;
        armLeft.rotation.z = 0.25;
        props.mallet.visible = true;
        break;
      }
      case 'highFive':
      case 'highFiveL': {
        // phase 0..1: the hand goes up, then forward into the other one. Two people facing each other use opposite hands.
        const k = THREE.MathUtils.clamp(phase, 0, 1);
        const up = THREE.MathUtils.smoothstep(k, 0, 0.3), slap = THREE.MathUtils.smoothstep(k, 0.38, 0.5), down = THREE.MathUtils.smoothstep(k, 0.8, 1);
        const left = p === 'highFiveL';
        const arm = left ? armLeft : armRight, other = left ? armRight : armLeft;
        arm.rotation.x = (-2.95 + slap * 0.75) * up * (1 - down);
        arm.rotation.z = left ? 0.08 : -0.08;
        other.rotation.z = (left ? -0.3 : 0.3) * up * (1 - down);
        torso.rotation.x = slap * 0.14 * (1 - down);
        head.rotation.x = -0.15 * up * (1 - down);
        body.position.y = Math.sin(THREE.MathUtils.clamp((k - 0.3) / 0.3, 0, 1) * Math.PI) * 0.09;
        break;
      }
      case 'pace':
        // walking up and down with the hands behind the back
        legLeft.thigh.rotation.x = s * 0.42;
        legRight.thigh.rotation.x = -s * 0.42;
        legLeft.shin.rotation.x = Math.max(0, s) * 0.3;
        legRight.shin.rotation.x = Math.max(0, -s) * 0.3;
        armLeft.rotation.x = 0.55;
        armRight.rotation.x = 0.55;
        armLeft.rotation.z = 0.35;
        armRight.rotation.z = -0.35;
        torso.rotation.x = 0.12;
        head.rotation.x = 0.3;
        body.position.y = Math.abs(Math.cos(phase)) * 0.025;
        break;
      case 'sitTalk':
        // on a meeting chair, one hand doing the talking
        sit(0.36);
        torso.rotation.x = -0.08;
        armLeft.rotation.x = -0.6;
        armRight.rotation.x = -1.35 + s * 0.3;
        armRight.rotation.z = 0.25 + Math.cos(phase) * 0.15;
        head.rotation.x = -0.05;
        break;
      case 'sitListen':
        // on a meeting chair, hands on the table
        sit(0.36);
        torso.rotation.x = 0.06;
        armLeft.rotation.x = -1.15;
        armRight.rotation.x = -1.15;
        armLeft.rotation.z = 0.2;
        armRight.rotation.z = -0.2;
        head.rotation.x = -0.06;
        break;
      case 'lie':
        // flat on the back: the root is the middle of the mattress, the head lies towards -z
        body.rotation.x = -Math.PI / 2;
        body.position.set(0, 0.2, (thighL + shinL + torsoH + hs) / 2);
        armLeft.rotation.z = 0.06;
        armRight.rotation.z = -0.06;
        torso.scale.z = 1 + s * 0.04;
        break;
    }
  };

  setPose('stand');
  const hold = (kind: 'mug' | 'phone' | 'umbrella') => {
    if (kind === 'umbrella') {
      props.umbrella.visible = true;
      armRight.rotation.x = 0.15;
    } else if (kind === 'mug') {
      armRight.rotation.set(-1.3, 0, 0.2);
      props.mug.visible = true;
      props.mug.rotation.x = 1.3;
    } else {
      armRight.rotation.set(-2.6, 0, -0.45);
      props.phone.visible = true;
    }
  };

  const wipe = (phase: number) => {
    armLeft.rotation.set(-2.6, 0, 0.5 + Math.sin(phase) * 0.16);
    head.rotation.x += 0.12;
  };

  return { root, head, setPose, hold, wipe, headHeight: (thighL + shinL + torsoH + hs + 0.15) * scale, backpack, scale };
}

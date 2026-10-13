import type { PostConfig } from './pixel';
import type { View } from './textures';
import type { Activity } from './data';
import { S } from './i18n/themes';

export interface Theme {
  id: string;
  index: number;
  label: string;
  tagline: string;
  bg: string;
  slab: string;
  floor: { kind: 'planks' | 'concrete' | 'carpet'; a: string; b: string; scale: number };
  wall: { kind: 'brick' | 'plaster' | 'livingwall'; a: string; b: string; trim: string };
  view: View;
  frame: string;
  desk: { kind: 'wood' | 'white' | 'cubicle'; top: string; leg: string; chair: string; monitor: 'slim' | 'crt'; screenBg: string };
  rug: boolean;
  lights: {
    sky: string;
    ground: string;
    hemi: number;
    sun: string;
    sunIntensity: number;
    sunDir: [number, number, number];
    lamp: string;
    lamp2?: string;
    lampIntensity: number;
    screenGlow: number;
  };
  fog?: { color: string; density: number };
  post: PostConfig;
  props: {
    recordPlayer?: boolean;
    hangingPlants?: boolean;
    fairyLights?: boolean;
    pendants?: 'edison' | 'globe' | 'fluorescent';
    beanbags?: boolean;
    pingpong?: boolean;
    couch?: boolean;
    neon?: { text: string; color: string };
    cubicles?: boolean;
    cat?: boolean;
    lasers?: boolean;
    ledWall?: boolean;
    poster?: string;
    beams?: boolean;
    plants: number;
    kombucha?: boolean;
    crowdAtDj?: boolean;
  };
  djCentral: boolean;
  /** 'quiet' keeps full tags only for the DJ and agents that need attention. */
  tagMode?: 'full' | 'quiet';
  activityOverride?: Partial<Record<Activity, Activity>>;
  music: { title: string; artist: string; bpm: number; source: string; mood: string };
  clock: { time: string; weather: string };
  hud: {
    font: string;
    numFont: string;
    paper: string;
    ink: string;
    muted: string;
    accent: string;
    accent2: string;
    edge: string;
    shadow: string;
    tagBg: string;
    tagInk: string;
  };
}

const basePost: PostConfig = {
  exposure: 1,
  saturation: 1,
  contrast: 1,
  tint: [1, 1, 1],
  vignette: 0.25,
  bloom: 0.6,
  bloomThreshold: 0.85,
  levels: 40,
  dither: 0.7,
  outline: 0.42,
  highlight: 0.22,
};

export const THEMES: Theme[] = [
  {
    id: 'loft',
    index: 1,
    label: 'Lo-Fi Loft',
    tagline: S.loft.tagline,
    bg: '#1a1630',
    slab: '#2b2238',
    floor: { kind: 'planks', a: '#8a5a3c', b: '#5e3a28', scale: 1 },
    wall: { kind: 'brick', a: '#8c4a3e', b: '#4a2f33', trim: '#3a2630' },
    view: 'rainNight',
    frame: '#2a2230',
    desk: { kind: 'wood', top: '#a9774f', leg: '#2a2228', chair: '#3d3346', monitor: 'slim', screenBg: '#1b1830' },
    rug: true,
    lights: {
      sky: '#6b5fb0',
      ground: '#3a2430',
      hemi: 0.55,
      sun: '#8f9cff',
      sunIntensity: 0.9,
      sunDir: [-0.4, 0.75, -1],
      lamp: '#ffb066',
      lamp2: '#ff8a7a',
      lampIntensity: 7,
      screenGlow: 1.7,
    },
    post: { ...basePost, exposure: 1.4, saturation: 1.05, tint: [1.02, 0.97, 1.04], vignette: 0.4, bloom: 1.1, bloomThreshold: 0.75 },
    props: { recordPlayer: true, hangingPlants: true, fairyLights: true, pendants: 'edison', couch: true, cat: true, plants: 9, neon: { text: 'stay cozy', color: '#ff8fb1' } },
    djCentral: false,
    music: { title: 'beats to ship code to', artist: 'Lofi Girl · Live', bpm: 78, source: 'YouTube', mood: 'Lo-Fi' },
    clock: { time: '22:52', weather: S.loft.weather },
    hud: {
      font: '"Bitcount Prop Single"',
      numFont: '"Pixelify Sans"',
      paper: 'oklch(0.27 0.05 300 / 0.92)',
      ink: 'oklch(0.95 0.03 80)',
      muted: 'oklch(0.75 0.05 300)',
      accent: 'oklch(0.8 0.14 60)',
      accent2: 'oklch(0.78 0.13 0)',
      edge: 'oklch(0.18 0.04 300)',
      shadow: 'oklch(0.12 0.03 300 / 0.8)',
      tagBg: 'oklch(0.22 0.04 300 / 0.9)',
      tagInk: 'oklch(0.96 0.02 80)',
    },
  },
  {
    id: 'campus',
    index: 2,
    label: 'Valley Campus',
    tagline: S.campus.tagline,
    bg: '#cfe6e2',
    slab: '#e8e1d2',
    floor: { kind: 'planks', a: '#e4c9a0', b: '#c9a87c', scale: 1 },
    wall: { kind: 'livingwall', a: '#f3eee4', b: '#d9d2c3', trim: '#ffffff' },
    view: 'daylightHills',
    frame: '#f7f5ef',
    desk: { kind: 'white', top: '#f4f1ea', leg: '#c8c4bb', chair: '#2f6f73', monitor: 'slim', screenBg: '#20262e' },
    rug: true,
    lights: {
      sky: '#f2f6ff',
      ground: '#c9b48e',
      hemi: 1.25,
      sun: '#fff1d6',
      sunIntensity: 2.6,
      sunDir: [-0.5, 1, -0.8],
      lamp: '#fff0d0',
      lampIntensity: 0,
      screenGlow: 1.1,
    },
    post: { ...basePost, exposure: 1.0, saturation: 1.1, contrast: 1.04, vignette: 0.12, bloom: 0.4, bloomThreshold: 0.95, outline: 0.3, highlight: 0.18 },
    props: { beanbags: true, pingpong: true, kombucha: true, neon: { text: 'ship it', color: '#ff6b6b' }, pendants: 'globe', plants: 16 },
    djCentral: false,
    music: { title: 'Sunday Morning Deep House', artist: 'Café de Anatolia', bpm: 118, source: 'YouTube', mood: 'Deep House' },
    clock: { time: '10:24', weather: S.campus.weather },
    hud: {
      font: '"Bitcount Prop Single"',
      numFont: '"Pixelify Sans"',
      paper: 'oklch(0.98 0.012 95 / 0.95)',
      ink: 'oklch(0.28 0.03 200)',
      muted: 'oklch(0.55 0.03 200)',
      accent: 'oklch(0.62 0.15 25)',
      accent2: 'oklch(0.6 0.11 180)',
      edge: 'oklch(0.3 0.03 200)',
      shadow: 'oklch(0.35 0.04 200 / 0.35)',
      tagBg: 'oklch(0.99 0.01 95 / 0.95)',
      tagInk: 'oklch(0.28 0.03 200)',
    },
  },
  {
    id: 'soma',
    index: 3,
    label: 'SoMa Warehouse',
    tagline: S.soma.tagline,
    bg: '#3b2a33',
    slab: '#4a3638',
    floor: { kind: 'concrete', a: '#9c948a', b: '#857c73', scale: 1 },
    wall: { kind: 'brick', a: '#b5654a', b: '#6e4a40', trim: '#2c2a2c' },
    view: 'goldenCity',
    frame: '#1f1f22',
    desk: { kind: 'wood', top: '#c08a58', leg: '#1d1d20', chair: '#2a2a2e', monitor: 'slim', screenBg: '#15161c' },
    rug: false,
    lights: {
      sky: '#ffc58a',
      ground: '#6a4a44',
      hemi: 0.8,
      sun: '#ffa45c',
      sunIntensity: 3.2,
      sunDir: [-0.9, 0.55, -0.7],
      lamp: '#ffc070',
      lampIntensity: 4,
      screenGlow: 1.4,
    },
    post: { ...basePost, exposure: 1.05, saturation: 1.1, tint: [1.04, 0.98, 0.94], vignette: 0.32, bloom: 0.9, bloomThreshold: 0.8 },
    props: { pendants: 'edison', beams: true, couch: true, pingpong: true, kombucha: true, neon: { text: 'move fast', color: '#5ef0ff' }, plants: 10 },
    djCentral: false,
    music: { title: 'Golden Hour Set', artist: 'Rooftop Sessions', bpm: 112, source: 'YouTube', mood: 'Nu Disco' },
    clock: { time: '18:41', weather: S.soma.weather },
    hud: {
      font: '"Bitcount Prop Single"',
      numFont: '"Pixelify Sans"',
      paper: 'oklch(0.24 0.02 30 / 0.92)',
      ink: 'oklch(0.95 0.03 75)',
      muted: 'oklch(0.72 0.05 50)',
      accent: 'oklch(0.85 0.12 200)',
      accent2: 'oklch(0.78 0.15 55)',
      edge: 'oklch(0.14 0.01 30)',
      shadow: 'oklch(0.1 0.02 30 / 0.7)',
      tagBg: 'oklch(0.18 0.02 30 / 0.9)',
      tagInk: 'oklch(0.96 0.03 75)',
    },
  },
  {
    id: 'boiler',
    index: 4,
    label: 'Boiler Room',
    tagline: S.boiler.tagline,
    bg: '#07050a',
    slab: '#1a1218',
    floor: { kind: 'concrete', a: '#5a4e56', b: '#463d44', scale: 1 },
    wall: { kind: 'brick', a: '#5a3434', b: '#241819', trim: '#120c10' },
    view: 'none',
    frame: '#0e0a0d',
    desk: { kind: 'wood', top: '#5a4032', leg: '#111014', chair: '#1e1a22', monitor: 'slim', screenBg: '#0c0a10' },
    rug: false,
    lights: {
      sky: '#b89ad8',
      ground: '#2a1030',
      hemi: 0.7,
      sun: '#ff3355',
      sunIntensity: 0.6,
      sunDir: [0.3, 1, -0.6],
      lamp: '#ff2266',
      lamp2: '#3344ff',
      lampIntensity: 18,
      screenGlow: 2.2,
    },
    fog: { color: '#12060e', density: 0.03 },
    post: { ...basePost, exposure: 1.25, saturation: 1.25, contrast: 1.12, tint: [1.05, 0.95, 1.02], vignette: 0.7, bloom: 1.8, bloomThreshold: 0.55, levels: 28 },
    props: { lasers: true, ledWall: true, crowdAtDj: true, plants: 2, pendants: undefined },
    djCentral: true,
    tagMode: 'quiet',
    activityOverride: { coffee: 'dance', toilet: 'dance', pingpong: 'dance', couch: 'dance', watercooler: 'dance', plants: 'dance', phone: 'dance' },
    music: { title: 'Boiler Room: Berlin', artist: 'Live B2B Set', bpm: 132, source: 'YouTube', mood: 'Techno' },
    clock: { time: '01:37', weather: S.boiler.weather },
    hud: {
      font: '"Silkscreen"',
      numFont: '"VT323"',
      paper: 'oklch(0.1 0.01 10 / 0.88)',
      ink: 'oklch(0.94 0.01 20)',
      muted: 'oklch(0.6 0.05 15)',
      accent: 'oklch(0.66 0.25 15)',
      accent2: 'oklch(0.62 0.2 265)',
      edge: 'oklch(0.66 0.25 15)',
      shadow: 'oklch(0.6 0.25 15 / 0.35)',
      tagBg: 'oklch(0.08 0.01 10 / 0.9)',
      tagInk: 'oklch(0.94 0.01 20)',
    },
  },
];

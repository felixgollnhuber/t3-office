import * as THREE from 'three';

export type Draw = (ctx: CanvasRenderingContext2D, w: number, h: number) => void;

export function canvasTexture(w: number, h: number, draw: Draw, repeat?: [number, number]) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  draw(ctx, w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  if (repeat) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(repeat[0], repeat[1]);
  }
  return t;
}

let seed = 1337;
export function rand() {
  seed = (seed * 16807) % 2147483647;
  return (seed - 1) / 2147483646;
}
export function reseed(s: number) {
  seed = s;
}
export const pick = <T,>(arr: readonly T[]) => arr[Math.floor(rand() * arr.length)];

function shade(hex: string, amt: number) {
  const c = new THREE.Color(hex);
  const hsl = { h: 0, s: 0, l: 0 };
  c.getHSL(hsl);
  c.setHSL(hsl.h, hsl.s, Math.min(1, Math.max(0, hsl.l + amt)));
  return '#' + c.getHexString();
}

export function brick(base: string, mortar: string) {
  return canvasTexture(32, 32, (g) => {
    g.fillStyle = mortar;
    g.fillRect(0, 0, 32, 32);
    for (let row = 0; row < 8; row++) {
      const off = row % 2 ? 4 : 0;
      for (let col = -1; col < 4; col++) {
        g.fillStyle = shade(base, (rand() - 0.5) * 0.12);
        g.fillRect(col * 8 + off, row * 4, 7, 3);
        if (rand() < 0.3) {
          g.fillStyle = shade(base, -0.08);
          g.fillRect(col * 8 + off + Math.floor(rand() * 6), row * 4 + 2, 1, 1);
        }
      }
    }
  });
}

export function planks(base: string, line: string, plankW = 6) {
  return canvasTexture(32, 32, (g) => {
    for (let x = 0; x < 32; x += plankW) {
      g.fillStyle = shade(base, (rand() - 0.5) * 0.08);
      g.fillRect(x, 0, plankW, 32);
      g.fillStyle = line;
      g.fillRect(x, 0, 1, 32);
      const cut = Math.floor(rand() * 32);
      g.fillRect(x, cut, plankW, 1);
      for (let i = 0; i < 3; i++) {
        g.fillStyle = shade(base, -0.04);
        g.fillRect(x + 2 + Math.floor(rand() * (plankW - 3)), Math.floor(rand() * 32), 1, 2 + Math.floor(rand() * 3));
      }
    }
  });
}

export function speckle(base: string, spread = 0.05, density = 0.25) {
  return canvasTexture(32, 32, (g) => {
    g.fillStyle = base;
    g.fillRect(0, 0, 32, 32);
    for (let i = 0; i < 1024 * density; i++) {
      g.fillStyle = shade(base, (rand() - 0.5) * spread * 2);
      g.fillRect(Math.floor(rand() * 32), Math.floor(rand() * 32), 1, 1);
    }
  });
}

export function carpetTiles(a: string, b: string) {
  return canvasTexture(32, 32, (g) => {
    for (let y = 0; y < 2; y++)
      for (let x = 0; x < 2; x++) {
        const base = (x + y) % 2 ? a : b;
        g.fillStyle = base;
        g.fillRect(x * 16, y * 16, 16, 16);
        for (let i = 0; i < 70; i++) {
          g.fillStyle = shade(base, (rand() - 0.5) * 0.1);
          g.fillRect(x * 16 + Math.floor(rand() * 16), y * 16 + Math.floor(rand() * 16), 1, 1);
        }
      }
  });
}

export function plaster(base: string) {
  return speckle(base, 0.025, 0.15);
}

export function livingWall() {
  return canvasTexture(32, 32, (g) => {
    g.fillStyle = '#2f5a2a';
    g.fillRect(0, 0, 32, 32);
    const greens = ['#3f7a34', '#4f9a3c', '#62b04a', '#2c6a33', '#7cc35a', '#376e2f'];
    for (let i = 0; i < 260; i++) {
      g.fillStyle = pick(greens);
      const x = Math.floor(rand() * 32), y = Math.floor(rand() * 32);
      g.fillRect(x, y, 2, 1);
      g.fillRect(x, y + 1, 1, 1);
    }
    for (let i = 0; i < 8; i++) {
      g.fillStyle = pick(['#f2d36b', '#e88aa0', '#f6f0e4']);
      g.fillRect(Math.floor(rand() * 32), Math.floor(rand() * 32), 1, 1);
    }
  }, [1, 1]);
}

export type View = 'rainNight' | 'daylightHills' | 'goldenCity' | 'none' | 'overcastLot';

/** Pixel-painted scenery behind the windows. */
export function windowView(kind: View) {
  return canvasTexture(256, 48, (g, w, h) => {
    const band = (cols: string[]) => {
      const bh = Math.ceil(h / cols.length);
      cols.forEach((c, i) => {
        g.fillStyle = c;
        g.fillRect(0, i * bh, w, bh);
      });
    };
    const city = (cols: string[], lit: string[], litChance: number, minH: number, maxH: number) => {
      let x = 0;
      while (x < w) {
        const bw = 6 + Math.floor(rand() * 12);
        const bh = minH + Math.floor(rand() * (maxH - minH));
        g.fillStyle = pick(cols);
        g.fillRect(x, h - bh, bw, bh);
        for (let wy = h - bh + 2; wy < h - 1; wy += 3)
          for (let wx = x + 1; wx < x + bw - 1; wx += 2)
            if (rand() < litChance) {
              g.fillStyle = pick(lit);
              g.fillRect(wx, wy, 1, 1);
            }
        x += bw + Math.floor(rand() * 2);
      }
    };
    if (kind === 'rainNight') {
      band(['#1d1b3a', '#25224a', '#2f2a5c', '#3b3170', '#4a3a7e', '#5c4386']);
      g.fillStyle = '#f4e9c8';
      g.fillRect(200, 6, 5, 5);
      g.fillStyle = '#5c4386';
      g.fillRect(203, 6, 2, 2);
      city(['#151330', '#1b1840', '#211c48'], ['#f7c46c', '#f39b5b', '#9fe3ff', '#ffde8a'], 0.28, 14, 40);
      g.fillStyle = 'rgba(190,200,255,0.35)';
      for (let i = 0; i < 260; i++) g.fillRect(Math.floor(rand() * w), Math.floor(rand() * h), 1, 2 + Math.floor(rand() * 3));
    } else if (kind === 'goldenCity') {
      band(['#f7c87a', '#f5b56e', '#f2a061', '#ec8a5a', '#de7558', '#c86452']);
      g.fillStyle = '#fff1c4';
      g.fillRect(150, 14, 9, 9);
      g.fillStyle = '#9b4f4a';
      g.fillRect(0, h - 8, w, 8);
      g.fillStyle = '#c9483b';
      for (let x = 30; x < 140; x += 1) {
        const y = h - 14 + Math.round(Math.sin((x - 30) / 110 * Math.PI) * -6);
        g.fillRect(x, y, 1, 1);
      }
      g.fillRect(52, h - 26, 2, 18);
      g.fillRect(110, h - 26, 2, 18);
      city(['#7d4a4f', '#8e5452', '#6c4049'], ['#ffd98a', '#fff0b8'], 0.12, 10, 34);
    } else if (kind === 'daylightHills') {
      band(['#9fd6f2', '#acdcf2', '#bbe2f0', '#cbe8ee', '#dcefe9']);
      g.fillStyle = '#ffffff';
      for (const [cx, cy] of [[30, 8], [120, 5], [200, 10]]) {
        g.fillRect(cx, cy, 16, 3);
        g.fillRect(cx + 4, cy - 2, 8, 2);
      }
      g.fillStyle = '#8fbf7a';
      for (let x = 0; x < w; x++) g.fillRect(x, h - 20 - Math.round(Math.sin(x / 30) * 5 + Math.sin(x / 11) * 2), 1, 30);
      g.fillStyle = '#6aa65a';
      for (let x = 0; x < w; x++) g.fillRect(x, h - 10 - Math.round(Math.sin(x / 17 + 2) * 3), 1, 20);
      for (let i = 0; i < 26; i++) {
        const tx = Math.floor(rand() * w), ty = h - 8 - Math.floor(rand() * 6);
        g.fillStyle = pick(['#3f7d46', '#4b8f4f', '#2f6a3d']);
        g.fillRect(tx, ty - 6, 3, 6);
        g.fillRect(tx - 1, ty - 4, 5, 3);
        g.fillStyle = '#6b4a2f';
        g.fillRect(tx + 1, ty, 1, 2);
      }
    } else if (kind === 'overcastLot') {
      band(['#b9bfc4', '#c1c6c9', '#c8ccce', '#cfd2d2']);
      g.fillStyle = '#8e9599';
      g.fillRect(0, h - 12, w, 12);
      for (let x = 4; x < w; x += 22) {
        g.fillStyle = pick(['#a3423a', '#3e5f8a', '#d9d4c7', '#556b4f', '#27303a']);
        g.fillRect(x, h - 9, 10, 4);
        g.fillStyle = '#20262c';
        g.fillRect(x + 1, h - 5, 2, 1);
        g.fillRect(x + 7, h - 5, 2, 1);
      }
      g.fillStyle = '#7d8489';
      g.fillRect(0, h - 26, w, 14);
      city(['#9aa1a6', '#a7adb1'], ['#e2e6e8'], 0.05, 8, 18);
    } else {
      band(['#1a0d14']);
    }
  });
}

/** Little code screen for a monitor, 32x20 px. */
export function screenTexture(state: string, accent: string, bg: string, seedVal: number) {
  reseed(seedVal);
  return canvasTexture(32, 20, (g, w, h) => {
    g.fillStyle = bg;
    g.fillRect(0, 0, w, h);
    if (state === 'running' || state === 'boss') {
      const cols = [accent, '#f6f1e7', '#8fd3ff', '#ffd27a', '#c39bff'];
      for (let y = 2; y < h - 1; y += 2) {
        let x = 2 + (rand() < 0.4 ? 2 : 0) + (rand() < 0.2 ? 2 : 0);
        while (x < w - 3 && rand() < 0.85) {
          const len = 1 + Math.floor(rand() * 6);
          g.fillStyle = pick(cols);
          g.fillRect(x, y, Math.min(len, w - 2 - x), 1);
          x += len + 1;
        }
      }
      g.fillStyle = '#ffffff';
      g.fillRect(2 + Math.floor(rand() * 20), h - 3, 2, 1);
    } else if (state === 'waiting') {
      g.fillStyle = '#ffc94a';
      g.fillRect(14, 4, 4, 8);
      g.fillRect(14, 14, 4, 3);
    } else if (state === 'failed') {
      g.fillStyle = '#ff5a4f';
      for (let i = 0; i < 7; i++) {
        g.fillRect(9 + i * 2, 4 + i * 2, 2, 2);
        g.fillRect(21 - i * 2, 4 + i * 2, 2, 2);
      }
    } else if (state === 'completed') {
      g.fillStyle = '#6ee08a';
      for (let i = 0; i < 4; i++) g.fillRect(8 + i * 2, 9 + i * 2, 2, 2);
      for (let i = 0; i < 7; i++) g.fillRect(14 + i * 2, 13 - i * 2, 2, 2);
    } else {
      for (let i = 0; i < 18; i++) {
        g.fillStyle = pick(['#ffffff', accent, '#8fd3ff']);
        g.fillRect(Math.floor(rand() * w), Math.floor(rand() * h), 1, 1);
      }
    }
  });
}

/** Text drawn into a canvas texture with a chunky bitmap feel. */
export function labelTexture(text: string, opts: { w: number; h: number; bg: string; fg: string; font?: string; size?: number; border?: string }) {
  return canvasTexture(opts.w, opts.h, (g, w, h) => {
    g.fillStyle = opts.bg;
    g.fillRect(0, 0, w, h);
    if (opts.border) {
      g.strokeStyle = opts.border;
      g.lineWidth = 2;
      g.strokeRect(1, 1, w - 2, h - 2);
    }
    g.fillStyle = opts.fg;
    g.font = `${opts.size ?? Math.floor(h * 0.6)}px ${opts.font ?? '"Silkscreen"'}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(text, w / 2, h / 2 + 1);
  });
}

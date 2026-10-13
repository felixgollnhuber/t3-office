export interface P2 {
  x: number;
  z: number;
}

/** Walkability grid over the office floor with A* and line-of-sight smoothing. */
export class NavGrid {
  readonly cell = 0.25;
  readonly cols: number;
  readonly rows: number;
  private blocked: Uint8Array;
  /** people standing around, only while one path is being searched */
  private crowd: Uint8Array | null = null;

  constructor(private minX: number, private minZ: number, maxX: number, maxZ: number) {
    this.cols = Math.ceil((maxX - minX) / this.cell);
    this.rows = Math.ceil((maxZ - minZ) / this.cell);
    this.blocked = new Uint8Array(this.cols * this.rows);
  }

  private ci(x: number) {
    return Math.floor((x - this.minX) / this.cell);
  }
  private cj(z: number) {
    return Math.floor((z - this.minZ) / this.cell);
  }

  rect(x0: number, z0: number, x1: number, z1: number, pad = 0.28, value = 1) {
    const i0 = Math.max(0, this.ci(Math.min(x0, x1) - pad));
    const i1 = Math.min(this.cols - 1, this.ci(Math.max(x0, x1) + pad));
    const j0 = Math.max(0, this.cj(Math.min(z0, z1) - pad));
    const j1 = Math.min(this.rows - 1, this.cj(Math.max(z0, z1) + pad));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) this.blocked[j * this.cols + i] = value;
  }

  free(x0: number, z0: number, x1: number, z1: number) {
    this.rect(x0, z0, x1, z1, 0, 0);
  }

  isFree(i: number, j: number) {
    return i >= 0 && j >= 0 && i < this.cols && j < this.rows && !this.blocked[j * this.cols + i] && !this.crowd?.[j * this.cols + i];
  }

  walkable(x: number, z: number) {
    return this.isFree(this.ci(x), this.cj(z));
  }

  private center(i: number, j: number): P2 {
    return { x: this.minX + (i + 0.5) * this.cell, z: this.minZ + (j + 0.5) * this.cell };
  }

  private nearestFree(i: number, j: number): [number, number] {
    if (this.isFree(i, j)) return [i, j];
    for (let r = 1; r < 12; r++)
      for (let dj = -r; dj <= r; dj++)
        for (let di = -r; di <= r; di++) {
          if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
          if (this.isFree(i + di, j + dj)) return [i + di, j + dj];
        }
    return [i, j];
  }

  private los(a: P2, b: P2) {
    const d = Math.hypot(b.x - a.x, b.z - a.z);
    const steps = Math.ceil(d / (this.cell * 0.5));
    for (let s = 1; s < steps; s++) {
      const t = s / steps;
      if (!this.isFree(this.ci(a.x + (b.x - a.x) * t), this.cj(a.z + (b.z - a.z) * t))) return false;
    }
    return true;
  }

  /** `avoid`: people standing in the way; the route leads around them. */
  findPath(from: P2, to: P2, avoid: P2[] = []): P2[] {
    this.crowd = null;
    if (avoid.length) {
      const crowd = new Uint8Array(this.cols * this.rows);
      const R = 0.36;
      for (const p of avoid) {
        // whoever stands right at the start or the goal is not something to walk around
        if (Math.hypot(p.x - from.x, p.z - from.z) < 0.5 || Math.hypot(p.x - to.x, p.z - to.z) < 0.5) continue;
        for (let j = this.cj(p.z - R); j <= this.cj(p.z + R); j++)
          for (let i = this.ci(p.x - R); i <= this.ci(p.x + R); i++) {
            if (i < 0 || j < 0 || i >= this.cols || j >= this.rows) continue;
            const c = this.center(i, j);
            if (Math.hypot(c.x - p.x, c.z - p.z) <= R) crowd[j * this.cols + i] = 1;
          }
      }
      this.crowd = crowd;
    }
    try {
      const path = this.search(from, to);
      // boxed in by people: better to squeeze past than to walk through a desk
      return path ?? ((this.crowd = null), this.search(from, to)) ?? [to];
    } finally {
      this.crowd = null;
    }
  }

  private search(from: P2, to: P2): P2[] | null {
    const [si, sj] = this.nearestFree(this.ci(from.x), this.cj(from.z));
    const [gi, gj] = this.nearestFree(this.ci(to.x), this.cj(to.z));
    const N = this.cols * this.rows;
    const g = new Float32Array(N).fill(Infinity);
    const came = new Int32Array(N).fill(-1);
    const closed = new Uint8Array(N);
    const heap: [number, number][] = [];
    const push = (f: number, n: number) => {
      heap.push([f, n]);
      let k = heap.length - 1;
      while (k > 0) {
        const p = (k - 1) >> 1;
        if (heap[p][0] <= heap[k][0]) break;
        [heap[p], heap[k]] = [heap[k], heap[p]];
        k = p;
      }
    };
    const pop = () => {
      const top = heap[0];
      const last = heap.pop()!;
      if (heap.length) {
        heap[0] = last;
        let k = 0;
        for (;;) {
          const l = 2 * k + 1, r = l + 1;
          let m = k;
          if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
          if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
          if (m === k) break;
          [heap[m], heap[k]] = [heap[k], heap[m]];
          k = m;
        }
      }
      return top;
    };
    const h = (i: number, j: number) => {
      const dx = Math.abs(i - gi), dy = Math.abs(j - gj);
      return dx + dy + (Math.SQRT2 - 2) * Math.min(dx, dy);
    };
    const start = sj * this.cols + si, goal = gj * this.cols + gi;
    g[start] = 0;
    push(h(si, sj), start);
    let found = false;
    while (heap.length) {
      const [, n] = pop();
      if (closed[n]) continue;
      if (n === goal) {
        found = true;
        break;
      }
      closed[n] = 1;
      const i = n % this.cols, j = (n / this.cols) | 0;
      for (let dj = -1; dj <= 1; dj++)
        for (let di = -1; di <= 1; di++) {
          if (!di && !dj) continue;
          const ni = i + di, nj = j + dj;
          if (!this.isFree(ni, nj)) continue;
          if (di && dj && (!this.isFree(i + di, j) || !this.isFree(i, j + dj))) continue;
          const m = nj * this.cols + ni;
          const cost = g[n] + (di && dj ? Math.SQRT2 : 1);
          if (cost < g[m]) {
            g[m] = cost;
            came[m] = n;
            push(cost + h(ni, nj), m);
          }
        }
    }
    if (!found) return null;
    const cells: P2[] = [];
    for (let n = goal; n !== -1; n = came[n]) cells.push(this.center(n % this.cols, (n / this.cols) | 0));
    cells.reverse();
    cells[0] = from;
    cells.push(to);
    const out: P2[] = [cells[0]];
    let anchor = cells[0];
    for (let k = 2; k < cells.length; k++) {
      if (!this.los(anchor, cells[k])) {
        anchor = cells[k - 1];
        out.push(anchor);
      }
    }
    out.push(to);
    return out.slice(1);
  }
}

/**
 * Sidestep for someone walking: bends the direction around people close ahead, always passing on the same side
 * so two who meet do not mirror each other. Returns a unit vector.
 */
export function steer(nav: NavGrid, self: P2, dx: number, dz: number, step: number, others: P2[]): P2 {
  const R = 0.8;
  let px = 0, pz = 0;
  for (const o of others) {
    if (o === self) continue;
    const ox = o.x - self.x, oz = o.z - self.z;
    const d = Math.hypot(ox, oz);
    if (d >= R || d < 1e-4) continue;
    const ahead = (ox * dx + oz * dz) / d;
    if (ahead < 0.15) {
      // beside or behind: only keep bodies from overlapping
      if (d < 0.42) {
        px -= (ox / d) * 0.8;
        pz -= (oz / d) * 0.8;
      }
      continue;
    }
    // which side they are on; dead ahead counts as "on my left", so I pass on the right
    const side = ox * dz - oz * dx > 0.05 ? -1 : 1;
    const w = (1 - d / R) * (0.6 + ahead) * 2.2;
    px += dz * side * w - (d < 0.42 ? (ox / d) * 0.8 : 0);
    pz += -dx * side * w - (d < 0.42 ? (oz / d) * 0.8 : 0);
  }
  if (!px && !pz) return { x: dx, z: dz };
  const sx = dx + px, sz = dz + pz;
  const n = Math.hypot(sx, sz);
  if (n < 1e-3) return { x: dz, z: -dx };
  const out = { x: sx / n, z: sz / n };
  // never sidestep into furniture
  if (nav.walkable(self.x, self.z) && !nav.walkable(self.x + out.x * Math.max(step, 0.2), self.z + out.z * Math.max(step, 0.2))) return { x: dx, z: dz };
  return out;
}

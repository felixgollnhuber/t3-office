import * as THREE from 'three';
import { TEAMS } from './data';
import { toon } from './materials';
import type { NavGrid } from './nav';
import { pixelSign, ROOM, rugMesh, type Seat } from './office';
import type { Theme } from './themes';

/** Two bands of desk columns; teams get contiguous runs of columns sized to how many agents they have. */
export const BANDS = [-1.4, 4.4];
export const COLS = 9;
export const colX = (c: number) => -6.8 + 1.6 * c;

export interface Segment {
  team: number;
  band: number;
  c0: number;
  c1: number;
}

export interface Sign {
  mesh: THREE.Mesh;
  texW: number;
  texH: number;
  team: number;
  anchor: THREE.Vector3;
}

export function floorSeats(): Seat[] {
  const seats: Seat[] = [];
  BANDS.forEach((cz, band) => {
    for (let col = 0; col < COLS; col++) {
      seats.push({ index: seats.length, team: -1, band, col, x: colX(col), z: cz - 1.45, rot: 0 });
      seats.push({ index: seats.length, team: -1, band, col, x: colX(col), z: cz + 1.45, rot: Math.PI });
    }
  });
  return seats;
}

export class Floor {
  segments: Segment[] = [];
  readonly signs: Sign[] = [];
  private wires: THREE.Mesh[] = [];
  private names: string[] = [];
  private rugs: THREE.Object3D[] = [];
  private home = new Map<number, number>();
  private key = '';

  constructor(private scene: THREE.Scene, private theme: Theme, private nav: NavGrid, readonly seats: Seat[]) {
    for (let team = 0; team < TEAMS.length; team++)
      for (let band = 0; band < BANDS.length; band++) {
        const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial());
        mesh.rotation.order = 'YXZ';
        mesh.visible = false;
        const back = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 0.04), toon(TEAMS[team].color));
        back.position.z = -0.025;
        mesh.add(back);
        scene.add(mesh);
        const wire = new THREE.Mesh(new THREE.BoxGeometry(0.02, 1, 0.02), toon('#2a2a30'));
        wire.visible = false;
        scene.add(wire);
        this.wires.push(wire);
        this.signs.push({ mesh, texW: 1, texH: 1, team, anchor: new THREE.Vector3() });
      }
    this.paintSigns();
  }

  /** Repaints boards whose team was renamed (e.g. a new T3 project took the pod). */
  paintSigns() {
    for (const s of this.signs) {
      const name = TEAMS[s.team].name;
      if (this.names[this.signs.indexOf(s)] === name) continue;
      this.names[this.signs.indexOf(s)] = name;
      const { tex, w, h } = pixelSign((name || ' ').toUpperCase(), TEAMS[s.team].color);
      const mat = s.mesh.material as THREE.MeshBasicMaterial;
      mat.map?.dispose();
      mat.map = tex;
      mat.needsUpdate = true;
      s.texW = w;
      s.texH = h;
    }
  }

  /**
   * Lay the teams out for `demand[team]` seats. Seats that are occupied keep their team (their
   * worker moves over once the new desk is free), every other seat takes the new assignment.
   */
  layout(demand: number[], occupied: (seat: Seat) => boolean) {
    const need = demand.map((d) => Math.ceil(Math.max(0, d) / 2));
    const cap = COLS * BANDS.length;
    while (need.reduce((s, n) => s + n, 0) > cap) need[need.indexOf(Math.max(...need))]--;

    const free = BANDS.map(() => COLS);
    const parts: { team: number; band: number; n: number; split: boolean }[] = [];
    const used = (b: number) => parts.some((p) => p.band === b);
    const room = (b: number, gap: boolean) => free[b] - (gap && used(b) ? 1 : 0);
    const put = (team: number, band: number, n: number, split: boolean, gap: boolean) => {
      free[band] -= n + (gap && used(band) ? 1 : 0);
      parts.push({ team, band, n, split });
    };
    const teams = need.map((n, t) => [n, t]).filter(([n]) => n > 0).sort((a, b) => b[0] - a[0]).map(([, t]) => t);
    for (const team of teams) {
      const n = need[team];
      const pref = this.home.get(team);
      const order = pref !== undefined ? [pref, 1 - pref] : free[0] >= free[1] ? [0, 1] : [1, 0];
      const fit = [true, false].flatMap((gap) => order.map((b) => [b, gap] as const)).find(([b, gap]) => room(b, gap) >= n);
      if (fit) {
        put(team, fit[0], n, false, fit[1]);
        continue;
      }
      // bigger than a band: fill one, continue straight across the aisle
      const a = order[0], b = 1 - a;
      const first = Math.max(0, room(a, false));
      if (first) put(team, a, first, true, false);
      const rest = Math.min(n - first, room(b, false));
      if (rest > 0) put(team, b, rest, true, false);
    }

    const segments: Segment[] = [];
    BANDS.forEach((_, band) => {
      const mine = parts.filter((p) => p.band === band).sort((x, y) => Number(y.split) - Number(x.split) || x.team - y.team);
      const total = mine.reduce((s, p) => s + p.n, 0);
      const gaps = Math.max(0, mine.length - 1);
      const spare = COLS - total;
      const gap = gaps && spare >= gaps ? 1 : 0;
      let c = 0;
      for (const p of mine) {
        segments.push({ team: p.team, band, c0: c, c1: c + p.n - 1 });
        c += p.n + gap;
      }
    });
    for (const t of teams) {
      const own = segments.filter((s) => s.team === t).sort((a, b) => b.c1 - b.c0 - (a.c1 - a.c0));
      if (own[0]) this.home.set(t, own[0].band);
    }

    const colTeam = BANDS.map(() => new Array<number>(COLS).fill(-1));
    for (const s of segments) for (let c = s.c0; c <= s.c1; c++) colTeam[s.band][c] = s.team;
    for (const seat of this.seats) if (!occupied(seat)) seat.team = colTeam[seat.band][seat.col];

    this.segments = segments;
    const key = JSON.stringify(segments);
    if (key !== this.key) {
      this.key = key;
      this.paint();
    }
    this.paintSigns();
  }

  /** Columns with a team (or a desk still standing from an old layout) are not walkable. */
  refreshNav(present: (seat: Seat) => boolean) {
    BANDS.forEach((cz, band) => {
      this.nav.free(colX(0) - 1.0, cz - 1.27, colX(COLS - 1) + 1.0, cz + 1.27);
      for (let col = 0; col < COLS; col++) {
        const seats = this.seats.filter((s) => s.band === band && s.col === col);
        if (!seats.some((s) => s.team >= 0 || present(s))) continue;
        this.nav.rect(colX(col) - 0.81, cz - 1.08, colX(col) + 0.81, cz + 1.08, 0.18);
        // the chairs (and whoever sits on them) behind the desk
        for (const s of seats) this.nav.rect(s.x - 0.3, s.z - (s.z < cz ? 0.35 : 0.2), s.x + 0.3, s.z + (s.z < cz ? 0.2 : 0.35), 0.06);
      }
    });
  }

  private paint() {
    for (const r of this.rugs) {
      r.removeFromParent();
      r.traverse((o) => {
        if (o instanceof THREE.Mesh) {
          o.geometry.dispose();
          const m = o.material as THREE.MeshStandardMaterial;
          m.map?.dispose();
          m.dispose();
        }
      });
    }
    this.rugs = [];
    const base = new THREE.Color(this.theme.floor.a);
    for (const s of this.segments) {
      const cz = BANDS[s.band];
      const x0 = colX(s.c0) - 0.8, x1 = colX(s.c1) + 0.8;
      const cx = (x0 + x1) / 2, w = x1 - x0 + 0.55, d = 5.4;
      const c = new THREE.Color(TEAMS[s.team].color);
      if (this.theme.rug) {
        this.rugs.push(rugMesh(this.scene, cx, cz, w, d, '#' + base.clone().lerp(c, 0.45).getHexString(), '#' + base.clone().lerp(c, 0.6).multiplyScalar(0.85).getHexString()));
      } else {
        const g = new THREE.Group();
        const tape = toon(TEAMS[s.team].color);
        for (const [bw, bd, bx, bz] of [[w, 0.08, 0, -d / 2], [w, 0.08, 0, d / 2], [0.08, d, -w / 2, 0], [0.08, d, w / 2, 0]]) {
          const m = new THREE.Mesh(new THREE.BoxGeometry(bw, 0.012, bd), tape);
          m.position.set(cx + bx, 0.006, cz + bz);
          g.add(m);
        }
        this.scene.add(g);
        this.rugs.push(g);
      }
    }
    // one hanging board per run, at its outer end over the aisle
    this.signs.forEach((sign, i) => {
      const seg = this.segments.find((s) => s.team === sign.team && s.band === i % BANDS.length);
      sign.mesh.visible = !!seg;
      this.wires[i].visible = !!seg;
      if (!seg) return;
      const x = colX(seg.c0) - 0.8, z = BANDS[seg.band], y = 2.28;
      sign.mesh.position.set(x, y, z);
      sign.anchor.set(x, y, z);
      this.wires[i].scale.y = ROOM.h - y - 0.1;
      this.wires[i].position.set(x, (ROOM.h + y + 0.1) / 2, z);
    });
  }
}

import * as THREE from 'three';

/**
 * Walkable grid for one floor, built once from the physics world, with A* path finding.
 * Coworkers use it to walk their patrols around furniture and to come after you without
 * walking through walls. Cells are 0.5 m; a cell is walkable when there is floor under it and
 * a person-sized cylinder standing there touches nothing (closed doors count as walls).
 */
const SQ2 = Math.SQRT2;

export class NavGrid {
  constructor(world, R, { y, width = 32, depth = 24, cell = 0.5, radius = 0.32, skip = () => false }) {
    this.y = y;
    this.cell = cell;
    this.nx = Math.round(width / cell);
    this.nz = Math.round(depth / cell);
    this.free = new Uint8Array(this.nx * this.nz);
    const shape = new R.Cylinder(0.6, radius);
    const rot = { x: 0, y: 0, z: 0, w: 1 };
    const ray = new R.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 });
    const pos = { x: 0, y: y + 0.95, z: 0 };
    const keep = (c) => !skip(c);
    for (let iz = 0; iz < this.nz; iz++) {
      for (let ix = 0; ix < this.nx; ix++) {
        const x = (ix + 0.5) * cell, z = (iz + 0.5) * cell;
        pos.x = x; pos.z = z;
        if (world.intersectionWithShape(pos, rot, shape, undefined, undefined, undefined, undefined, keep)) continue;
        ray.origin.x = x; ray.origin.y = y + 0.3; ray.origin.z = z;
        const floor = world.castRay(ray, 0.6, true, undefined, undefined, undefined, undefined, keep);
        if (!floor) continue;
        this.free[iz * this.nx + ix] = 1;
      }
    }
    this.g = new Float32Array(this.nx * this.nz);
    this.from = new Int32Array(this.nx * this.nz);
    this.seen = new Uint32Array(this.nx * this.nz);
    this.stamp = 0;
    this.heap = [];
  }

  idx(x, z) {
    const ix = Math.floor(x / this.cell), iz = Math.floor(z / this.cell);
    if (ix < 0 || iz < 0 || ix >= this.nx || iz >= this.nz) return -1;
    return iz * this.nx + ix;
  }

  walkable(x, z) { const i = this.idx(x, z); return i >= 0 && this.free[i] === 1; }

  // Closest walkable cell to a point (within ~2 m), or -1.
  nearestFree(x, z) {
    const i0 = this.idx(x, z);
    if (i0 >= 0 && this.free[i0]) return i0;
    const cx = Math.floor(x / this.cell), cz = Math.floor(z / this.cell);
    for (let r = 1; r <= 4; r++) {
      let best = -1, bd = Infinity;
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          const ix = cx + dx, iz = cz + dz;
          if (ix < 0 || iz < 0 || ix >= this.nx || iz >= this.nz) continue;
          const i = iz * this.nx + ix;
          if (!this.free[i]) continue;
          const d = dx * dx + dz * dz;
          if (d < bd) { bd = d; best = i; }
        }
      }
      if (best >= 0) return best;
    }
    return -1;
  }

  center(i, out) { return out.set(((i % this.nx) + 0.5) * this.cell, this.y, (Math.floor(i / this.nx) + 0.5) * this.cell); }

  // Can you walk in a straight line from a to b without leaving walkable cells?
  clearLine(ax, az, bx, bz) {
    const d = Math.hypot(bx - ax, bz - az);
    const n = Math.max(1, Math.ceil(d / (this.cell * 0.4)));
    for (let k = 0; k <= n; k++) {
      const t = k / n;
      if (!this.walkable(ax + (bx - ax) * t, az + (bz - az) * t)) return false;
    }
    return true;
  }

  // A* from a to b. Returns a list of Vector3 corners (smoothed, excluding the start), or null.
  find(a, b) {
    const s = this.nearestFree(a.x, a.z), t = this.nearestFree(b.x, b.z);
    if (s < 0 || t < 0) return null;
    if (this.clearLine(a.x, a.z, b.x, b.z)) return [new THREE.Vector3(b.x, this.y, b.z)];
    const { nx, g, from, seen, free } = this;
    const stamp = ++this.stamp;
    const tx = t % nx, tz = Math.floor(t / nx);
    const h = (i) => {
      const dx = Math.abs((i % nx) - tx), dz = Math.abs(Math.floor(i / nx) - tz);
      return (dx + dz + (SQ2 - 2) * Math.min(dx, dz));
    };
    const heap = this.heap;
    heap.length = 0;
    const push = (i, f) => {
      heap.push([f, i]);
      let k = heap.length - 1;
      while (k > 0) { const p = (k - 1) >> 1; if (heap[p][0] <= heap[k][0]) break; [heap[p], heap[k]] = [heap[k], heap[p]]; k = p; }
    };
    const pop = () => {
      const top = heap[0], last = heap.pop();
      if (heap.length) {
        heap[0] = last;
        let k = 0;
        for (;;) {
          const l = 2 * k + 1, r = l + 1;
          let m = k;
          if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
          if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
          if (m === k) break;
          [heap[m], heap[k]] = [heap[k], heap[m]]; k = m;
        }
      }
      return top;
    };
    seen[s] = stamp; g[s] = 0; from[s] = -1;
    push(s, h(s));
    let found = false;
    while (heap.length) {
      const [, i] = pop();
      if (i === t) { found = true; break; }
      const ix = i % nx, iz = Math.floor(i / nx);
      for (let dz = -1; dz <= 1; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dz) continue;
          const jx = ix + dx, jz = iz + dz;
          if (jx < 0 || jz < 0 || jx >= nx || jz >= this.nz) continue;
          const j = jz * nx + jx;
          if (!free[j]) continue;
          if (dx && dz && (!free[iz * nx + jx] || !free[jz * nx + ix])) continue;   // no corner cutting
          const ng = g[i] + (dx && dz ? SQ2 : 1);
          if (seen[j] === stamp && ng >= g[j]) continue;
          seen[j] = stamp; g[j] = ng; from[j] = i;
          push(j, ng + h(j));
        }
      }
    }
    if (!found) return null;
    const cells = [];
    for (let i = t; i !== -1; i = from[i]) cells.push(i);
    cells.reverse();
    // String-pull: keep only the corners you can't see past.
    const pts = cells.map((i) => this.center(i, new THREE.Vector3()));
    pts[0].set(a.x, this.y, a.z);
    pts[pts.length - 1].set(b.x, this.y, b.z);
    const out = [];
    let anchor = pts[0];
    for (let k = 1; k < pts.length; k++) {
      const next = pts[k + 1];
      if (!next || !this.clearLine(anchor.x, anchor.z, next.x, next.z)) { out.push(pts[k]); anchor = pts[k]; }
    }
    return out.length ? out : [new THREE.Vector3(b.x, this.y, b.z)];
  }
}

// Grid navigation for ground enemies. The arena is rasterised into 1 m cells with a walkable height per
// column; edges allow <= step rises, any drop, and one-way jump-pad launches onto the dais. A reverse
// Dijkstra from the target cell yields a flow field that every enemy of the same size class shares.
import { HALF } from './layout.js';
import { circleOverlapsBox } from './geometry.js';

const DIRS = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2]];

export function createNavGrid(layout, { cell = 1, radius = 0.42, step = 0.45, clearance = 1.8, usePads = true } = {}) {
  const n = Math.round((HALF * 2) / cell), origin = -HALF, count = n * n;
  const height = new Float64Array(count), blocked = new Uint8Array(count), pad = new Int8Array(count).fill(-1);
  const cx = i => origin + ((i % n) + 0.5) * cell, cz = i => origin + (Math.floor(i / n) + 0.5) * cell;
  for (let k = 0; k < count; k++) {
    const x = cx(k), z = cz(k);
    let h = 0;
    for (const b of layout.boxes) if (b.walkable && x >= b.minX && x <= b.maxX && z >= b.minZ && z <= b.maxZ) h = Math.max(h, b.maxY);
    height[k] = h;
    for (const b of layout.boxes) {
      if (b.maxY <= h + step + 1e-6 || b.minY >= h + clearance) continue;
      if (circleOverlapsBox(x, z, radius, b)) { blocked[k] = 1; break; }
    }
  }
  const cellAt = (x, z) => {
    const i = Math.floor((x - origin) / cell), j = Math.floor((z - origin) / cell);
    return i < 0 || j < 0 || i >= n || j >= n ? -1 : j * n + i;
  };
  layout.pads.forEach((p, index) => {
    for (let k = 0; k < count; k++) {
      if (blocked[k] || Math.hypot(cx(k) - p.x, cz(k) - p.z) > p.r + (usePads ? 0.2 : radius + 0.2)) continue;
      if (usePads) pad[k] = index; else blocked[k] = 1; // large bodies never use pads: route around them
    }
  });
  const outFrom = Array.from({ length: count }, () => []);
  const inTo = Array.from({ length: count }, () => []);
  const link = (u, v, cost, padIndex = -1) => { outFrom[u].push({ to: v, cost, pad: padIndex }); inTo[v].push({ from: u, cost }); };
  for (let u = 0; u < count; u++) {
    if (blocked[u]) continue;
    const i = u % n, j = Math.floor(u / n);
    // Pad cells are ordinary floor plus one optional launch edge onto the dais; a body only launches when
    // its route actually chooses that edge (see enemies.js pathTo), otherwise it just walks across.
    if (pad[u] >= 0) {
      const p = layout.pads[pad[u]];
      const v = p.axis === 'z' ? cellAt(cx(u), p.land) : cellAt(p.land, cz(u));
      if (v >= 0 && !blocked[v]) link(u, v, 3, pad[u]);
    }
    for (const [di, dj, base] of DIRS) {
      const ni = i + di, nj = j + dj;
      if (ni < 0 || nj < 0 || ni >= n || nj >= n) continue;
      const v = nj * n + ni;
      if (blocked[v]) continue;
      const dh = height[v] - height[u];
      if (dh > step + 1e-6) continue;
      if (di && dj) {
        const a = j * n + ni, b = nj * n + i;
        if (blocked[a] || blocked[b]) continue;
        if (Math.abs(height[a] - height[u]) > step + 1e-6 || Math.abs(height[b] - height[u]) > step + 1e-6) continue;
      }
      link(u, v, base + (dh < -step ? 0.6 : 0));
    }
  }
  function nearestOpen(k, maxRing = 5) {
    if (k < 0) return -1;
    if (!blocked[k]) return k;
    const i0 = k % n, j0 = Math.floor(k / n);
    for (let r = 1; r <= maxRing; r++) {
      let best = -1, bestD = Infinity;
      for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) {
        if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
        const i = i0 + di, j = j0 + dj;
        if (i < 0 || j < 0 || i >= n || j >= n) continue;
        const v = j * n + i, d = di * di + dj * dj;
        if (!blocked[v] && d < bestD) { best = v; bestD = d; }
      }
      if (best >= 0) return best;
    }
    return -1;
  }
  // True when a body can walk the straight segment without entering a blocked cell or changing level.
  function straightWalkable(ax, az, bx, bz, level) {
    const len = Math.hypot(bx - ax, bz - az), steps = Math.max(1, Math.ceil(len / (cell * 0.25)));
    for (let s = 1; s <= steps; s++) {
      const t = s / steps, k = cellAt(ax + (bx - ax) * t, az + (bz - az) * t);
      if (k < 0 || blocked[k] || Math.abs(height[k] - level) > step + 1e-6) return false;
    }
    return true;
  }
  return { n, cell, origin, count, radius, step, height, blocked, pad, outFrom, inTo, cellAt, nearestOpen, straightWalkable, cx, cz, pads: layout.pads };
}

function heapPush(heap, item) {
  heap.push(item);
  let i = heap.length - 1;
  while (i > 0) {
    const p = (i - 1) >> 1;
    if (heap[p][0] <= heap[i][0]) break;
    [heap[p], heap[i]] = [heap[i], heap[p]];
    i = p;
  }
}
function heapPop(heap) {
  const top = heap[0], last = heap.pop();
  if (heap.length) {
    heap[0] = last;
    let i = 0;
    for (;;) {
      const l = i * 2 + 1, r = l + 1;
      let m = i;
      if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
      if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
      if (m === i) break;
      [heap[m], heap[i]] = [heap[i], heap[m]];
      i = m;
    }
  }
  return top;
}

export function createFlowField(grid) {
  const dist = new Float64Array(grid.count).fill(Infinity);
  let target = -1;
  function compute(x, z, force = false) {
    const t = grid.nearestOpen(grid.cellAt(x, z));
    if (t < 0 || (t === target && !force)) return false;
    target = t;
    dist.fill(Infinity);
    dist[t] = 0;
    const heap = [[0, t]];
    while (heap.length) {
      const [d, v] = heapPop(heap);
      if (d > dist[v]) continue;
      for (const e of grid.inTo[v]) {
        const nd = d + e.cost;
        if (nd < dist[e.from]) { dist[e.from] = nd; heapPush(heap, [nd, e.from]); }
      }
    }
    return true;
  }
  function bestEdge(u) {
    let best = null, bestD = Infinity;
    for (const e of grid.outFrom[u]) {
      const d = dist[e.to] + e.cost;
      if (d < bestD) { bestD = d; best = e; }
    }
    return best;
  }
  // Conservative rasterisation can mark the cell a body physically stands in as blocked (corner clipping).
  // Instead of pulling the body back, continue from the open neighbour with the best remaining cost.
  function bestOpenNear(u, x, z, maxRing = 3) {
    const i0 = u % grid.n, j0 = Math.floor(u / grid.n);
    let best = -1, bestScore = Infinity;
    for (let r = 1; r <= maxRing; r++) {
      for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) {
        if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
        const i = i0 + di, j = j0 + dj;
        if (i < 0 || j < 0 || i >= grid.n || j >= grid.n) continue;
        const v = j * grid.n + i;
        if (grid.blocked[v] || !Number.isFinite(dist[v])) continue;
        const score = dist[v] + 1.5 * Math.hypot(grid.cx(v) - x, grid.cz(v) - z);
        if (score < bestScore) { bestScore = score; best = v; }
      }
      if (best >= 0) return best;
    }
    return -1;
  }
  // Next steering point for a body at (x,z). Returns null when already in the target cell or unreachable.
  function waypoint(x, z, lookahead = 4) {
    let u = grid.cellAt(x, z);
    if (u < 0) return null;
    let point = null;
    if (grid.blocked[u] || !Number.isFinite(dist[u])) {
      const alt = bestOpenNear(u, x, z);
      if (alt < 0) return null;
      u = alt;
      point = { x: grid.cx(u), z: grid.cz(u), pad: false };
    }
    if (u === target) return point;
    const level = grid.height[u];
    for (let k = 0; k < lookahead; k++) {
      const e = bestEdge(u);
      if (!e) break;
      if (e.pad >= 0) {
        // Only steer onto a pad when it is the immediate next edge or reachable on the same level.
        const p = grid.pads[e.pad];
        if (!point || (Math.abs(grid.height[u] - level) <= grid.step && grid.straightWalkable(x, z, p.x, p.z, level))) point = { x: p.x, z: p.z, pad: true };
        break;
      }
      const v = e.to, px = grid.cx(v), pz = grid.cz(v);
      if (!point) point = { x: px, z: pz, pad: false };
      else if (Math.abs(grid.height[v] - level) <= grid.step && grid.straightWalkable(x, z, px, pz, level)) point = { x: px, z: pz, pad: false };
      else break;
      if (v === target) break;
      u = v;
    }
    return point;
  }
  const distanceAt = (x, z) => { const u = grid.cellAt(x, z); return u < 0 ? Infinity : dist[u]; };
  return { compute, waypoint, distanceAt, get target() { return target; }, dist };
}

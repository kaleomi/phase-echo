// ECHO-7 arena as pure data: collision boxes, jump pads, spawn gates and pickup spots. The Three.js
// arena builder, the navigation grid and the Node tests all read this, so visuals and rules never drift.
import { box, boxAt } from './geometry.js';

export const HALF = 32;
export const WALL_HEIGHT = 7;
export const DAIS_HEIGHT = 3;
export const PLAYER_SPAWN = Object.freeze({ x: 0, y: 0, z: 27, yaw: 0 });
export const BOSS_HOME = Object.freeze({ x: 0, y: 9, z: 0 });
export const PAD_LAUNCH = 15;

export function createLayout() {
  const boxes = [];
  const add = (x, z, w, d, h, kind, o = {}) => {
    const b = boxAt(x, z, w, d, h, o.y ?? 0, { kind, id: boxes.length, walkable: !!o.walkable, trim: o.trim ?? null });
    boxes.push(b);
    return b;
  };
  // Outer walls.
  add(0, -HALF - 0.5, HALF * 2 + 2, 1, WALL_HEIGHT, 'wall', { trim: 'cyan' });
  add(0, HALF + 0.5, HALF * 2 + 2, 1, WALL_HEIGHT, 'wall', { trim: 'cyan' });
  add(-HALF - 0.5, 0, 1, HALF * 2, WALL_HEIGHT, 'wall', { trim: 'cyan' });
  add(HALF + 0.5, 0, 1, HALF * 2, WALL_HEIGHT, 'wall', { trim: 'cyan' });
  // Centre dais: only reachable through the four jump pads (enemies use them too).
  add(0, 0, 10, 10, DAIS_HEIGHT, 'dais', { walkable: true, trim: 'magenta' });
  // Corner platforms with three-step stairs facing the middle row and a crate on top.
  for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    const cx = 20 * sx, cz = 20 * sz, edge = cz - sz * 4;
    add(cx, cz, 8, 8, 1.6, 'platform', { walkable: true, trim: 'cyan' });
    for (let k = 1; k <= 3; k++) add(cx, edge - sz * (3.5 - k), 4, 1, 0.4 * k, 'step', { walkable: true, trim: 'dim' });
    add(cx + 2.3 * sx, cz + 2.3 * sz, 1.4, 1.4, 1.1, 'crate', { y: 1.6, trim: 'orange' });
  }
  // Full-height pillars and waist-high cover (1.15 m: jumpable; standing on it lifts you above ground shockwaves).
  for (const [x, z] of [[11, 11], [11, -11], [-11, 11], [-11, -11]]) add(x, z, 2, 2, 6.5, 'pillar', { trim: 'orange' });
  // Pinwheel pillars: offset from the axes so the spawn has a clear view of the dais and lanes stay open.
  for (const [x, z] of [[4, 19], [-4, -19], [19, -4], [-19, 4]]) add(x, z, 2, 2, 6.5, 'pillar', { trim: 'cyan' });
  for (const s of [1, -1]) {
    add(6.5, 15 * s, 4, 1, 1.15, 'cover', { trim: 'dim' });
    add(-6.5, 15 * s, 4, 1, 1.15, 'cover', { trim: 'dim' });
    add(15 * s, 6.5, 1, 4, 1.15, 'cover', { trim: 'dim' });
    add(15 * s, -6.5, 1, 4, 1.15, 'cover', { trim: 'dim' });
  }
  // Jump pads launch towards a fixed landing line on the dais (axis/land) with a 1 s ballistic arc.
  const pads = [
    { x: 0, z: 8.6, axis: 'z', land: 2.2 }, { x: 0, z: -8.6, axis: 'z', land: -2.2 },
    { x: 8.6, z: 0, axis: 'x', land: 2.2 }, { x: -8.6, z: 0, axis: 'x', land: -2.2 },
  ].map(p => ({ ...p, y: 0, r: 1.1, vy: PAD_LAUNCH, landY: DAIS_HEIGHT }));
  const gates = [];
  for (const s of [1, -1]) for (const o of [10, -10]) {
    gates.push({ x: (HALF - 0.02) * s, z: o, nx: -s, nz: 0, spawn: { x: (HALF - 2.5) * s, z: o } });
    gates.push({ x: o, z: (HALF - 0.02) * s, nx: 0, nz: -s, spawn: { x: o, z: (HALF - 2.5) * s } });
  }
  gates.forEach((g, i) => { g.id = i; });
  const healthSpots = [{ x: 0, y: DAIS_HEIGHT, z: 0 }, { x: 20, y: 1.6, z: 20 }, { x: -20, y: 1.6, z: 20 }, { x: 20, y: 1.6, z: -20 }, { x: -20, y: 1.6, z: -20 }];
  const ammoSpots = [{ x: 27, y: 0, z: 0 }, { x: -27, y: 0, z: 0 }, { x: 0, y: 0, z: -27 }];
  // Rays (shots, projectiles) also collide with the floor; bodies use the implicit y=0 ground instead.
  const floor = box(-HALF - 1, -1, -HALF - 1, HALF + 1, 0, HALF + 1, { kind: 'floor', id: -1 });
  return { boxes, rayBoxes: [...boxes, floor], pads, gates, healthSpots, ammoSpots, bounds: { x: HALF - 0.3, z: HALF - 0.3 } };
}

// Highest box top under (x,z) at or below `fromY` (pickups, ground height); 0 is the floor.
export function groundAt(boxes, x, z, fromY = Infinity) {
  let top = 0;
  for (const b of boxes) {
    if (x >= b.minX && x <= b.maxX && z >= b.minZ && z <= b.maxZ && b.maxY <= fromY + 1e-3 && b.maxY > top) top = b.maxY;
  }
  return top;
}

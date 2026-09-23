import assert from 'node:assert/strict';
import { createLayout } from '../src/sim/layout.js';
import { createNavGrid, createFlowField } from '../src/sim/nav.js';
import { createBody, stepBody } from '../src/sim/physics.js';
import { groundAt } from '../src/sim/layout.js';
const groundY = p => groundAt(createLayout().boxes, p.x, p.z);

const layout = createLayout();
const world = { boxes: layout.boxes, pads: layout.pads, bounds: layout.bounds };
const small = createNavGrid(layout, { radius: 0.45 });
const large = createNavGrid(layout, { radius: 0.95, usePads: false });

// Every gate can reach every region for small bodies (dais only through pads).
const targets = [[0, 0], [20, 20], [-20, -20], [0, 27], [25, -8], [-6.5, 13]];
for (const [tx, tz] of targets) {
  const f = createFlowField(small);
  assert.ok(f.compute(tx, tz, true));
  for (const g of layout.gates) assert.ok(Number.isFinite(f.distanceAt(g.spawn.x, g.spawn.z)), `small: gate ${g.id} reaches ${tx},${tz}`);
}
// Large bodies reach the floor and the platforms but never the dais.
const lf = createFlowField(large);
lf.compute(20, 20, true);
for (const g of layout.gates) assert.ok(Number.isFinite(lf.distanceAt(g.spawn.x, g.spawn.z)), `large: gate ${g.id} reaches the NE platform`);
lf.compute(0, 0, true);
assert.ok(!Number.isFinite(lf.distanceAt(27, 10)), 'large bodies cannot path onto the dais');

// Follow the flow field with a real physics body from every gate to several goals.
function walk(grid, radius, height, goal, start, usePads = true) {
  const f = createFlowField(grid);
  f.compute(goal.x, goal.z, true);
  const b = createBody({ x: start.x, y: groundY(start), z: start.z }, { radius, height, usePads });
  for (let t = 0; t < 30; t += 1 / 60) {
    const wp = f.waypoint(b.x, b.z);
    const cellGoal = grid.cellAt(b.x, b.z) === f.target;
    const wx = wp ? wp.x : goal.x, wz = wp ? wp.z : goal.z;
    const dx = wx - b.x, dz = wz - b.z, d = Math.hypot(dx, dz);
    if (b.grounded) b.usePads = usePads && !!wp?.pad; // same rule as enemies.js: ride a pad only when routed onto it
    if (b.grounded && b.padLock <= 0) { const s = d > 0.05 ? 5 : 0; b.vx = d > 0 ? dx / d * s : 0; b.vz = d > 0 ? dz / d * s : 0; }
    stepBody(b, 1 / 60, world);
    if (cellGoal && Math.hypot(goal.x - b.x, goal.z - b.z) < 1.2) return { ok: true, t, b };
  }
  return { ok: false, b };
}
for (const goal of [{ x: 0, z: 0 }, { x: 20, z: 20 }, { x: -20, z: -21 }, { x: 0, z: 26 }]) {
  for (const g of layout.gates) {
    const r = walk(small, 0.45, 1.4, goal, g.spawn);
    assert.ok(r.ok, `stalker-size body from gate ${g.id} reaches ${goal.x},${goal.z} (stuck at ${r.b.x.toFixed(1)},${r.b.y.toFixed(1)},${r.b.z.toFixed(1)})`);
  }
}
for (const start of [{ x: 0, z: 0 }, { x: 3, z: -3 }]) {
  for (const goal of [{ x: 0, z: 26 }, { x: 26, z: 0 }, { x: -20, z: -20 }]) {
    const r = walk(small, 0.45, 1.4, goal, start);
    assert.ok(r.ok, `body on the dais walks down to ${goal.x},${goal.z} (stuck at ${r.b.x.toFixed(1)},${r.b.y.toFixed(1)},${r.b.z.toFixed(1)})`);
  }
}
for (const goal of [{ x: 20, z: 20 }, { x: 0, z: 26 }, { x: -24, z: 0 }]) {
  for (const g of layout.gates) {
    const r = walk(large, 0.9, 2.6, goal, g.spawn, false);
    assert.ok(r.ok, `bulwark-size body from gate ${g.id} reaches ${goal.x},${goal.z} (stuck at ${r.b.x.toFixed(1)},${r.b.y.toFixed(1)},${r.b.z.toFixed(1)})`);
  }
}
console.log('PASS nav: full reachability for both size classes, dais via pads only, physical walks from all 8 gates');

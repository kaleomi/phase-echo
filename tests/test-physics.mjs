import assert from 'node:assert/strict';
import { createLayout, DAIS_HEIGHT } from '../src/sim/layout.js';
import { createBody, stepBody, padFlightTime, canStand } from '../src/sim/physics.js';

const layout = createLayout();
const world = { boxes: layout.boxes, pads: layout.pads, bounds: layout.bounds };
const run = (b, seconds, fn) => { for (let t = 0; t < seconds; t += 1 / 60) { fn?.(b, t); stepBody(b, 1 / 60, world); } };

// Settles on the floor.
let b = createBody({ x: 0, y: 2, z: 25 });
b.grounded = false;
run(b, 1.5);
assert.ok(b.grounded && Math.abs(b.y) < 1e-6, 'lands on the floor');

// Walls stop horizontal motion and never let the body tunnel, even at dash speed.
b = createBody({ x: 5.5, y: 0, z: 25 });
run(b, 1, bb => { bb.vx = 0; bb.vz = 30; });
assert.ok(b.z <= layout.bounds.z + 1e-6 && b.z > 30, `stopped at the outer wall (z=${b.z})`);
b = createBody({ x: 11, y: 0, z: 16 });
run(b, 1, bb => { bb.vx = 0; bb.vz = -22; });
assert.ok(b.z > 12 - 1e-6, `pillar blocks a dash (z=${b.z})`);

// Stairs: walking toward the NE platform climbs 0.4/0.8/1.2/1.6.
b = createBody({ x: 20, y: 0, z: 12 });
run(b, 2.0, bb => { bb.vx = 0; bb.vz = 5; });
assert.ok(Math.abs(b.y - 1.6) < 1e-6, `climbed the stairs onto the platform (y=${b.y})`);
// Walking off the platform's west edge drops back to the floor (east is blocked by the crate).
run(b, 2, bb => { bb.vx = -6; bb.vz = 0; });
assert.ok(b.y < 1e-6, 'fell off the platform edge');

// Cover (1.15 m) is not a step: blocks walking but can be jumped onto.
b = createBody({ x: 6.5, y: 0, z: 17 });
run(b, 1, bb => { bb.vx = 0; bb.vz = -5; });
assert.ok(b.z > 15.5 + 0.38 - 1e-3 && b.y < 1e-6, 'cover blocks walking');
b.vy = 8.4; b.grounded = false;
run(b, 1, bb => { bb.vx = 0; bb.vz = -2; });
assert.ok(Math.abs(b.y - 1.15) < 1e-6, `jumped onto the cover (y=${b.y})`);

// Jump pads: every pad lands the body on the dais.
for (const pad of layout.pads) {
  b = createBody({ x: pad.x + (pad.axis === 'x' ? Math.sign(pad.x) * 2 : 0), y: 0, z: pad.z + (pad.axis === 'z' ? Math.sign(pad.z) * 2 : 0) });
  let launched = false;
  run(b, 3, bb => {
    if (bb.launched) launched = true;
    if (!launched && bb.grounded) { const dx = pad.x - bb.x, dz = pad.z - bb.z, l = Math.hypot(dx, dz) || 1; bb.vx = dx / l * 5; bb.vz = dz / l * 5; }
    else if (launched && bb.grounded && bb.padLock <= 0) { bb.vx = 0; bb.vz = 0; }
  });
  assert.ok(launched, 'pad triggered');
  assert.ok(Math.abs(b.y - DAIS_HEIGHT) < 1e-6 && Math.abs(b.x) < 5 && Math.abs(b.z) < 5, `pad ${pad.x},${pad.z} lands on the dais (${b.x.toFixed(2)},${b.y.toFixed(2)},${b.z.toFixed(2)})`);
}
assert.ok(padFlightTime(layout.pads[0]) > 0.9 && padFlightTime(layout.pads[0]) < 1.1);

// Large bodies do not use pads.
b = createBody({ x: 0, y: 0, z: 11 }, { radius: 0.9, height: 2.6, usePads: false });
run(b, 1, bb => { bb.vx = 0; bb.vz = -3; });
assert.ok(b.y < 1e-6, 'heavy body is not launched');

// Spawn gates are free and on the floor.
for (const g of layout.gates) assert.ok(canStand(layout.boxes, g.spawn.x, g.spawn.z, 0.95, 0, 2.6), `gate ${g.id} spawn is clear`);
console.log('PASS physics: floor, walls/pillars without tunnelling, stairs up/down, cover jump, four jump pads, heavy bodies, clear gates');

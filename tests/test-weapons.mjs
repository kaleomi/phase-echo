import assert from 'node:assert/strict';
import { WEAPONS, createArsenal, updateArsenal, falloff, pelletDirections, addAmmo, magSize, SWAP_TIME } from '../src/sim/weapons.js';
import { baseStats } from '../src/sim/upgrades.js';
import { createRng } from '../src/sim/rng.js';
import { dirFromYawPitch } from '../src/sim/geometry.js';

const events = [];
const ctx = { emit: (type, data) => events.push({ type, ...data }), rng: createRng(7), yaw: 0, pitch: 0, moving: false, airborne: false };
const none = { fire: false, firePressed: false, ads: false, reload: false, weapon: null, cycle: 0 };
const tick = (a, dt, input = {}) => updateArsenal(a, dt, { ...none, ...input }, ctx);

// Carbine: ~11 rounds/second, 32 per magazine, infinite reserve, auto reload after the last round.
let a = createArsenal(baseStats());
let shots = 0;
for (let t = 0; t < 1; t += 1 / 120) if (tick(a, 1 / 120, { fire: true })) shots++;
assert.ok(shots >= 10 && shots <= 12, `carbine cadence ${shots}/s`);
for (let t = 0; t < 4; t += 1 / 120) tick(a, 1 / 120, { fire: true });
assert.ok(events.some(e => e.type === 'reloadStart' && e.weapon === 'carbine'), 'auto reload when the mag empties');
events.length = 0;
a = createArsenal(baseStats());
a.slots[0].mag = 3;
tick(a, 0.01, { reload: true });
for (let t = 0; t < 1.5; t += 1 / 60) tick(a, 1 / 60);
assert.equal(a.slots[0].mag, 32, 'magazine reload refills');
assert.equal(a.slots[0].reserve, Infinity);

// Scatter: semi-auto, 10 pellets, per-shell reload interrupted by firing keeps loaded shells.
a = createArsenal(baseStats());
tick(a, 0.01, { weapon: 1 });
assert.equal(a.index, 1);
assert.equal(tick(a, 0.01, { firePressed: true, fire: true }), null, 'cannot fire during the swap');
for (let t = 0; t < SWAP_TIME; t += 1 / 60) tick(a, 1 / 60);
const s = tick(a, 0.01, { firePressed: true, fire: true });
assert.ok(s && s.directions.length === 10, 'scatter fires ten pellets (buffered click)');
assert.equal(tick(a, 0.05, { fire: true }), null, 'holding does not refire a semi-auto');
a.slots[1].mag = 1;
a.cooldown = 0;
tick(a, 0.01, { reload: true });
for (let t = 0; t < 0.2 + 0.44 * 2 + 0.05; t += 1 / 120) tick(a, 1 / 120);
assert.equal(a.slots[1].mag, 3, 'two shells inserted');
assert.ok(a.reloading);
a.cooldown = 0;
assert.ok(tick(a, 0.01, { firePressed: true, fire: true }), 'firing interrupts a per-shell reload');
assert.equal(a.slots[1].mag, 2);
assert.ok(!a.reloading);

// Rail: pierce 5, precise when ADS, finite reserve that ammo pickups top up.
const rail = WEAPONS[2];
assert.equal(rail.pierce, 5);
assert.equal(falloff(rail, 150), 1);
assert.equal(falloff(WEAPONS[0], 10), 1);
assert.ok(Math.abs(falloff(WEAPONS[0], 55) - 0.6) < 1e-9);
a = createArsenal(baseStats());
a.slots[2].reserve = 0;
assert.equal(addAmmo(a, 'rail', 4), 4);
assert.equal(addAmmo(a, 'rail', 400), 26, 'capped at the reserve max');
assert.equal(addAmmo(a, 'carbine', 50), 0, 'infinite reserve ignores pickups');

// Pellet directions stay inside the spread cone; the scatter pattern is centred.
const rng = createRng(3);
const f = dirFromYawPitch(0.4, 0.1);
for (const d of pelletDirections(0.4, 0.1, 0.078, 10, rng, true)) {
  const ang = Math.acos(Math.min(1, d.x * f.x + d.y * f.y + d.z * f.z));
  assert.ok(ang <= 0.078 * 1.1 + 1e-6, `pellet within cone (${ang})`);
}
const stats = baseStats(); stats.magMult = 1.4;
assert.equal(magSize(WEAPONS[0], stats), 45);
console.log('PASS weapons: carbine cadence/auto reload, scatter pellets/buffer/per-shell interrupt, rail pierce/reserve, cones, mag upgrades');

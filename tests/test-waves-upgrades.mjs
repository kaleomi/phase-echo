import assert from 'node:assert/strict';
import { WAVES, WAVE_COUNT, DIFFICULTY, buildSpawnQueue, maxAlive, isBossWave } from '../src/sim/waves.js';
import { UPGRADES, baseStats, rollOffers, applyUpgrade } from '../src/sim/upgrades.js';
import { createScore, addKill, stepScore, multiplierFor, waveBonus, rankFor } from '../src/sim/scoring.js';
import { createRng } from '../src/sim/rng.js';

assert.equal(WAVE_COUNT, 10);
assert.ok(isBossWave(10) && !isBossWave(9));
for (let w = 1; w < 10; w++) {
  const q = buildSpawnQueue(createRng(w), w, DIFFICULTY.normal);
  const expected = Object.values(WAVES[w - 1]).reduce((a, b) => a + b, 0);
  assert.equal(q.length, expected, `wave ${w} queue size`);
  const heavyAt = q.map((t, i) => (t === 'bulwark' ? i : -1)).filter(i => i >= 0);
  for (const i of heavyAt) assert.ok(i >= Math.floor(q.length * 0.3), 'heavies never open a wave');
}
assert.ok(buildSpawnQueue(createRng(1), 8, DIFFICULTY.nightmare).length > buildSpawnQueue(createRng(1), 8, DIFFICULTY.normal).length);
assert.ok(maxAlive(9) <= 16);

// Upgrades: offers are unique, respect max stacks, and apply their stat changes.
const rng = createRng(11), owned = {}, stats = baseStats();
for (let i = 0; i < 40; i++) {
  const offers = rollOffers(rng, owned, 3);
  assert.equal(new Set(offers).size, offers.length);
  for (const id of offers) assert.ok((owned[id] || 0) < UPGRADES.find(u => u.id === id).max);
  if (offers.length) applyUpgrade(stats, owned, offers[0]);
}
assert.equal(rollOffers(rng, Object.fromEntries(UPGRADES.map(u => [u.id, u.max]))).length, 0, 'nothing offered when all maxed');
const s2 = baseStats(), o2 = {};
applyUpgrade(s2, o2, 'overcharge'); applyUpgrade(s2, o2, 'overcharge');
assert.ok(Math.abs(s2.damageMult - 1.3) < 1e-9);
assert.equal(applyUpgrade(s2, { dashcell: 1 }, 'dashcell'), null, 'max stack enforced');

// Scoring.
const sc = createScore();
assert.equal(addKill(sc, 100), 100);
assert.equal(addKill(sc, 100), 110);
assert.equal(multiplierFor(100), 3);
stepScore(sc, 4.1);
assert.equal(sc.combo, 0);
assert.equal(sc.multiplier, 1);
assert.equal(waveBonus(3, 10, 40, true).total, 1200 + 450 + 1000);
assert.equal(rankFor(100000, true), 'S');
assert.equal(rankFor(100000, false), 'B');
console.log('PASS waves/upgrades/scoring: queues, heavies placement, difficulty scaling, unique capped offers, combo decay, bonuses, ranks');

// Daily challenge (stable per-day seed + rotating mutator, mutators really change the rules) and the best-run
// ghost track (10 Hz recording, compact round trip, interpolation, splits, size cap, bad data rejected).
import assert from 'node:assert/strict';
import { createGame } from '../src/sim/game.js';
import { MUTATORS, dailySetup, dailySeed, dailyMutator, dailyKey } from '../src/sim/daily.js';
import { buildSpawnQueue, DIFFICULTY } from '../src/sim/waves.js';
import { createRng } from '../src/sim/rng.js';
import { createGhostRecorder, decodeGhost, ghostPoseAt, GHOST_MAX, GHOST_RATE } from '../src/sim/ghost.js';

// Seeds: stable for a day, different across days; the UTC date decides the day.
const a = dailySetup(new Date('2026-10-21T00:30:00Z')), b = dailySetup(new Date('2026-10-21T23:30:00Z')), c = dailySetup(new Date('2026-10-22T00:30:00Z'));
assert.equal(a.key, '2026-10-21');
assert.equal(a.seed, b.seed, 'same seed all day');
assert.notEqual(a.seed, c.seed, 'new seed tomorrow');
assert.equal(dailySeed('2026-10-21'), a.seed);
assert.equal(dailyKey(new Date('2026-01-02T12:00:00Z')), '2026-01-02');
// Mutators rotate: six consecutive days show all six.
const week = new Set();
for (let d = 0; d < MUTATORS.length; d++) week.add(dailyMutator(dailyKey(new Date(Date.UTC(2026, 9, 21 + d)))).id);
assert.equal(week.size, MUTATORS.length, 'every mutator appears within a rotation');

// Same daily seed => same opening wave for everyone.
const q1 = createGame({ seed: a.seed, mutator: a.mutator.id }), q2 = createGame({ seed: a.seed, mutator: a.mutator.id });
q1.startWave(1); q2.startWave(1);
assert.deepEqual(q1.spawnQueue, q2.spawnQueue, 'daily waves are identical across runs');

// Each mutator changes something measurable.
const base = createGame({ seed: 1 });
const m = id => createGame({ seed: 1, mutator: id });
assert.ok(m('storm').stats.phaseGain === 2 * base.stats.phaseGain && m('storm').stats.implodeMult > base.stats.implodeMult, 'phase storm');
assert.ok(m('glass').player.hp === 60 && m('glass').stats.damageMult === 1.5, 'glass cannon');
assert.ok(m('arsenal').arsenal.slots[0].mag > base.arsenal.slots[0].mag && m('arsenal').stats.reserveMult === 2, 'arsenal');
assert.ok(m('elite').diff.hp > base.diff.hp && m('elite').diff.score > base.diff.score && m('elite').diff.id === 'normal', 'elite tide');
assert.ok(m('tailwind').player.dash.charges === 3 && m('tailwind').stats.speedMult > 1, 'tailwind');
const chrono = m('chrono');
const plain = buildSpawnQueue(createRng(4), 3, DIFFICULTY.normal), tide = buildSpawnQueue(createRng(4), 3, chrono.diff);
assert.equal(tide.filter(t => t === 'rewinder').length - plain.filter(t => t === 'rewinder').length, 2, 'chrono tide adds two rewinders');
assert.equal(buildSpawnQueue(createRng(4), 1, chrono.diff).filter(t => t === 'rewinder').length, 0, 'but not in wave 1');
assert.equal(chrono.summary().mutator, 'chrono');

// Ghost: record a known path, round-trip through JSON, interpolate.
const rec = createGhostRecorder();
const path = t => ({ x: 10 * Math.sin(t * 0.3), y: Math.max(0, Math.sin(t * 2)), z: 3 * t - 20 });
for (let t = 0; t <= 60; t += 1 / 120) { const p = path(t); rec.sample(t, p, t * 0.5); }
rec.split(1, 31.234); rec.split(2, 58.9);
assert.ok(Math.abs(rec.length - 60 * GHOST_RATE - 1) <= 1, `10 Hz samples (${rec.length})`);
const json = JSON.stringify(rec.serialize({ score: 1234 }));
assert.ok(json.length < 60 * GHOST_RATE * 4 * 6, `compact encoding (${json.length} bytes for 60 s)`);
const g = decodeGhost(JSON.parse(json));
assert.ok(g && g.meta.score === 1234 && g.splits[1] === 31.23, 'meta + splits survive');
for (const t of [0, 5.55, 17.3, 42.01, 59.5]) {
  const p = ghostPoseAt(g, t), q = path(t);
  assert.ok(Math.hypot(p.x - q.x, p.z - q.z) < 0.06, `pose at ${t}s within 6 cm (${Math.hypot(p.x - q.x, p.z - q.z).toFixed(3)})`);
}
assert.equal(ghostPoseAt(g, 61), null, 'ghost vanishes after its run ended');
assert.equal(decodeGhost({ v: 99 }), null, 'unknown versions are ignored');
assert.equal(decodeGhost({ v: 1, n: 3, x: [1], y: [], z: [], yaw: [] }), null, 'truncated data is ignored');
assert.equal(decodeGhost(null), null);
// Cap: a never-ending run stops recording at GHOST_MAX samples.
const long = createGhostRecorder();
long.sample(GHOST_MAX / GHOST_RATE + 100, { x: 0, y: 0, z: 0 }, 0);
assert.equal(long.length, GHOST_MAX);
console.log(`PASS daily + ghost: stable daily seed, ${MUTATORS.length} mutators rotate and apply, ghost round trip (${json.length} B / 60 s), interpolation, splits, cap`);

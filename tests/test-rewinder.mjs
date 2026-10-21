// REWINDER: flies at range and fires chrono bolts; every cycle it snaps back to its anchor (where it was three
// seconds ago) and regains the HP lost since; shooting the exposed anchor shatters it (no rewind, stagger,
// damage); an echo collapse wipes the anchor; it appears from wave 4.
import assert from 'node:assert/strict';
import { createGame } from '../src/sim/game.js';
import { ENEMY_TYPES, anchorExposed } from '../src/sim/enemies.js';
import { WEAPONS } from '../src/sim/weapons.js';
import { WAVES } from '../src/sim/waves.js';
import { eyeOf } from '../src/sim/player.js';

const R = ENEMY_TYPES.rewinder.rewind;
const idle = { moveX: 0, moveZ: 0, fire: false, firePressed: false, ads: false, reload: false, weapon: null, cycle: 0 };
const step = g => { g.step(1 / 60, { ...idle, yaw: g.player.yaw, pitch: g.player.pitch }); return g.drainEvents(); };
const run = (g, seconds, until) => { for (let t = 0; t < seconds; t += 1 / 60) { const evs = step(g); const hit = until && evs.find(until); if (hit) return hit; } return null; };
function arena(seed = 5) { const g = createGame({ seed, firstDelay: 999 }); g.mode = 'test'; return g; }
const place = (g, x, z) => g.spawnEnemy('rewinder', { id: 99, spawn: { x, z } });
const shootAt = (g, p, weapon = WEAPONS[2]) => {
  const eye = eyeOf(g.player), d = { x: p.x - eye.x, y: p.y - eye.y, z: p.z - eye.z }, l = Math.hypot(d.x, d.y, d.z);
  g.fireShot(eye, [{ x: d.x / l, y: d.y / l, z: d.z / l }], weapon, false);
};

assert.ok(WAVES.slice(3, 9).some(w => w.rewinder) && !WAVES.slice(0, 3).some(w => w.rewinder), 'rewinders join from wave 4');

// Attacks: telegraphs, then chrono bolts land on a passive player.
{
  const g = arena();
  place(g, 6, 12);
  let told = false;
  const hurt = run(g, 12, e => { if (e.type === 'enemyTell' && e.kind === 'chrono') told = true; return e.type === 'playerHurt'; });
  assert.ok(told && hurt?.kind === 'chrono', `rewinder telegraphs and hits with chrono bolts (${hurt?.kind})`);
}

// Rewind: HP lost inside the window comes back and it snaps to its anchor position.
{
  const g = arena(7);
  g.debug.invulnerable = true;
  const e = place(g, 8, 8);
  for (let i = 0; i < 900 && e.rewindT > R.tell + 0.15; i++) step(g); // history builds, anchor appears
  assert.ok(e.anchor, 'anchor exists once history is old enough');
  const anchorHp = e.anchor.hp;
  e.hp -= 120; // damage taken after the anchor sample
  const told = run(g, 0.3, ev => ev.type === 'enemyTell' && ev.kind === 'rewind');
  assert.ok(told, 'rewind is telegraphed');
  let anchorAt = null, ev = null;
  for (let i = 0; i < 90 && !ev; i++) { anchorAt = { ...e.anchor }; ev = step(g).find(x => x.type === 'rewind'); }
  assert.ok(ev, 'rewind happened');
  assert.ok(ev.healed > 100, `HP restored (${ev.healed.toFixed(0)})`);
  assert.ok(anchorHp === e.maxHp && e.hp === e.maxHp, `back to the anchor's full HP (${e.hp})`);
  assert.ok(Math.hypot(ev.to.x - anchorAt.x, ev.to.z - anchorAt.z) < 0.8, 'snapped to the anchor');
  assert.ok(Math.hypot(e.x - ev.to.x, e.z - ev.to.z) < 0.3 && Math.hypot(ev.from.x - ev.to.x, ev.from.z - ev.to.z) > 0.5, 'actually moved back');
}

// Shooting the exposed anchor shatters it: damage + stagger, and the next cycle has nothing to rewind to.
{
  const g = arena(3);
  g.debug.invulnerable = true;
  const e = place(g, -6, 14);
  let exposed = false;
  for (let t = 0; t < 8 && !exposed; t += 1 / 60) { step(g); exposed = anchorExposed(e); if (e.rewindT < 0.9) e.rewindT = 3; }
  assert.ok(exposed, 'anchor drifts clear of the body');
  const hp0 = e.hp, at = { ...e.anchor };
  shootAt(g, at);
  const evs = g.drainEvents();
  assert.ok(evs.some(x => x.type === 'anchorBreak' && x.cause === 'shot'), 'anchor shattered');
  assert.ok(!e.anchor && e.stagger > 0, 'stagger after the break');
  assert.ok(Math.abs(hp0 - e.hp - R.breakDamage) < 1e-6, `break damage (${hp0 - e.hp})`);
  const rewound = run(g, R.cycle - 0.3, x => x.type === 'rewind');
  assert.ok(!rewound, 'the break resets the cycle: no rewind for a full cycle');
}

// An echo collapse pulls the rewinder in and erases its anchor.
{
  const g = arena(4);
  const e = place(g, 5, 15);
  for (let i = 0; i < 900 && e.rewindT > R.tell + 0.2; i++) step(g);
  assert.ok(e.anchor);
  e.pull = { x: e.x, y: e.y, z: e.z, t: 0.4 };
  const brk = run(g, 0.1, x => x.type === 'anchorBreak');
  assert.ok(brk?.cause === 'echo', 'echo collapse erases the anchor');
}

// Burst inside one window kills it for good.
{
  const g = arena(6);
  const e = place(g, 0, 14);
  run(g, 1.5);
  for (let i = 0; i < 3 && e.alive; i++) shootAt(g, { x: e.x, y: e.y, z: e.z });
  assert.ok(!e.alive, 'three rail hits kill it before it can rewind');
  assert.ok(g.drainEvents().some(x => x.type === 'kill' && x.enemy === 'rewinder'));
}
console.log('PASS rewinder: chrono bolts, telegraphed rewind restores HP and position, anchor break, echo wipe, burst kill, wave placement');

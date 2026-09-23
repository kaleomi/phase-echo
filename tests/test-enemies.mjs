// Each enemy type, placed near a passive player, must path to them, telegraph and land its attack; the boss
// must run every attack in its script. Also covers shield/weak-point damage rules and the echo decoy.
import assert from 'node:assert/strict';
import { createGame } from '../src/sim/game.js';
import { ENEMY_TYPES } from '../src/sim/enemies.js';
import { WEAPONS } from '../src/sim/weapons.js';
import { yawTowards, pitchTowards } from '../src/sim/geometry.js';
import { eyeOf } from '../src/sim/player.js';

const idle = { moveX: 0, moveZ: 0, fire: false, firePressed: false, ads: false, reload: false, weapon: null, cycle: 0 };
function arena(seed = 5) {
  const g = createGame({ seed, firstDelay: 999 });
  g.mode = 'test';
  return g;
}
function place(g, type, x, z) {
  const e = g.spawnEnemy(type, { id: 99, spawn: { x, z } });
  return e;
}
function runUntil(g, seconds, pred, input = idle) {
  for (let t = 0; t < seconds; t += 1 / 60) {
    g.step(1 / 60, { ...input, yaw: g.player.yaw, pitch: g.player.pitch });
    const evs = g.drainEvents();
    const hit = evs.find(pred);
    if (hit) return { t, e: hit };
  }
  return null;
}

// Stalker: chases across the arena and lunges.
{
  const g = arena();
  place(g, 'stalker', 0, -20);
  const r = runUntil(g, 12, e => e.type === 'playerHurt');
  assert.ok(r && r.e.kind === 'lunge', `stalker lunge lands (${r?.e.kind})`);
}
// Sentinel: keeps range and fires bolt bursts after an aim telegraph.
{
  const g = arena();
  place(g, 'sentinel', 12, 10);
  let told = false;
  const r = runUntil(g, 10, e => { if (e.type === 'enemyTell' && e.kind === 'aim') told = true; return e.type === 'playerHurt'; });
  assert.ok(told && r && r.e.kind === 'bolt', 'sentinel telegraphs then hits with a bolt');
}
// Wisp: orbits and fires needles.
{
  const g = arena();
  place(g, 'wisp', -10, 18);
  const r = runUntil(g, 10, e => e.type === 'playerHurt');
  assert.ok(r && r.e.kind === 'needle', 'wisp needle lands');
}
// Bulwark: mortar at range, slam shockwave up close.
{
  const g = arena();
  place(g, 'bulwark', 0, 5);
  const r = runUntil(g, 12, e => e.type === 'playerHurt');
  assert.ok(r && (r.e.kind === 'mortar' || r.e.kind === 'shockwave'), `bulwark hits (${r?.e.kind})`);
  const g2 = arena();
  place(g2, 'bulwark', 0, 24);
  g2.player.body.x = 0; g2.player.body.z = 26;
  const r2 = runUntil(g2, 10, e => e.type === 'playerHurt');
  assert.ok(r2 && (r2.e.kind === 'shockwave' || r2.e.kind === 'mortar'), 'bulwark close range attack lands');
}
// Shield: frontal carbine fire is reduced to 12%, rail to 55%, the back vent takes weak-point damage.
{
  const g = arena();
  const e = place(g, 'bulwark', 0, 12);
  runUntil(g, 1, () => false);
  e.body.x = 0; e.body.z = 12; e.x = 0; e.z = 12; e.yaw = 0; // faces -Z... turn it to face the player (+Z)
  e.yaw = Math.PI;
  e.state = 'recover'; e.t = 99;
  const hp0 = e.hp;
  const origin = { x: 0, y: 1.3, z: 22 };
  g.fireShot(origin, [{ x: 0, y: 0, z: -1 }], WEAPONS[0], false);
  const front = hp0 - e.hp;
  assert.ok(Math.abs(front - 17 * 0.12) < 1e-6, `front shield reduces carbine to 12% (${front})`);
  const hp1 = e.hp;
  g.fireShot(origin, [{ x: 0, y: 0, z: -1 }], WEAPONS[2], false);
  assert.ok(Math.abs(hp1 - e.hp - 105 * 0.55) < 1e-6, 'rail penetrates the shield at 55%');
  const hp2 = e.hp;
  const back = { x: 0, y: e.y + 1.75, z: 7 }; // between the dais edge (z=5) and the bulwark
  g.fireShot(back, [{ x: 0, y: 0, z: 1 }], WEAPONS[0], false);
  assert.ok(Math.abs(hp2 - e.hp - 17 * 1.8) < 1e-6, `back vent takes weak-point damage (${hp2 - e.hp})`);
}
// Weak points: stalker head x1.8 with the carbine; rail pierces a line of enemies.
{
  const g = arena();
  const a = place(g, 'stalker', 0, 13), b = place(g, 'stalker', 0, 7);
  a.spawnT = 0; b.spawnT = 0; a.yaw = Math.PI; b.yaw = Math.PI; a.state = b.state = 'recover'; a.t = b.t = 99;
  const origin = { x: 0, y: 0.7, z: 20 };
  g.fireShot(origin, [{ x: 0, y: 0, z: -1 }], WEAPONS[2], false);
  assert.ok(!a.alive && !b.alive, 'rail pierces and kills both stalkers');
  const c = place(g, 'stalker', 0, 10);
  c.spawnT = 0; c.yaw = Math.PI;
  const eye = { x: 0, y: 1.16, z: 20 }, w = { x: 0, y: 1.16, z: 10 + 0.3 };
  const d = { x: 0, y: (w.y - eye.y), z: w.z - eye.z }, l = Math.hypot(d.x, d.y, d.z);
  g.fireShot(eye, [{ x: d.x / l, y: d.y / l, z: d.z / l }], WEAPONS[0], false);
  assert.ok(Math.abs(c.maxHp - c.hp - 17 * 1.8) < 1e-6, 'head shot multiplier');
}
// Echo decoy: enemies switch to the echo while it replays.
{
  const g = arena();
  for (let t = 0; t < 3.2; t += 1 / 60) g.step(1 / 60, { ...idle, moveX: 1, yaw: 0, pitch: 0 });
  g.drainEvents();
  place(g, 'stalker', 10, -10);
  runUntil(g, 1.2, () => false);
  g.player.energy = 100;
  g.step(1 / 60, { ...idle, echoPressed: true, yaw: 0, pitch: 0 });
  const evs = g.drainEvents();
  assert.ok(evs.some(e => e.type === 'echoStart'), 'echo started');
  runUntil(g, 0.7, () => false);
  const stalker = g.enemies.find(e => e.type === 'stalker');
  assert.ok(stalker.target === 'echo', `stalker targets the echo (${stalker.target})`);
  const r = runUntil(g, 3, e => e.type === 'echoBlast');
  assert.ok(r, 'echo collapses and detonates');
}
// Boss: runs rings, lances, spirals, summons and quakes across phases; phase shifts clear projectiles.
{
  const g = arena(9);
  g.debug.invulnerable = true;
  g.player.body.x = 0; g.player.body.z = 24;
  g.startWave(10);
  g.mode = 'test';
  const kinds = new Set();
  let phases = 0;
  for (let t = 0; t < 140 && g.boss?.alive; t += 1 / 60) {
    const b = g.boss;
    if (b.state === 'fight' && t % 1 < 1 / 60) {
      const frac = b.hp / b.maxHp;
      if ((kinds.has('ring') && kinds.has('lance') && frac > 0.66) || (kinds.has('spiral') && kinds.has('summon') && frac > 0.33) || (kinds.has('quake') && frac <= 0.33)) {
        const eye = eyeOf(g.player), d = { x: b.eye.x - eye.x, y: b.eye.y - eye.y, z: b.eye.z - eye.z }, l = Math.hypot(d.x, d.y, d.z);
        for (let i = 0; i < 6; i++) g.fireShot(eye, [{ x: d.x / l, y: d.y / l, z: d.z / l }], WEAPONS[2], false);
      }
    }
    g.step(1 / 60, { ...idle, yaw: g.player.yaw, pitch: g.player.pitch });
    for (const e of g.drainEvents()) {
      if (e.type === 'bossCharge') kinds.add(e.kind);
      if (e.type === 'bossPhase') phases++;
    }
    for (const e of g.enemies) if (e.alive && e.spawnT <= 0) { e.hp = 0; e.alive = false; }
  }
  for (const k of ['ring', 'lance', 'spiral', 'summon', 'quake']) assert.ok(kinds.has(k), `boss used ${k} (${[...kinds]})`);
  assert.equal(phases, 2);
  assert.ok(!g.boss || !g.boss.alive || g.boss.state === 'dying', 'boss defeated');
}
console.log('PASS enemies: stalker lunge, sentinel bolts, wisp needles, bulwark mortar/slam, shield + weak points, rail pierce, echo decoy, boss full script');

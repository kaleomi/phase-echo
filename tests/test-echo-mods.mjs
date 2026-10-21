// Echo depth: PHASE SWAP (trade places mid-replay, echo collapses where you stood), PARADOX kills (you and
// the echo both hit it within a second), the three echo mods (LONG ECHO, ECHO SIPHON, SWAP SURGE) and boss
// lances that lock onto the echo.
import assert from 'node:assert/strict';
import { createGame } from '../src/sim/game.js';
import { ECHO } from '../src/sim/echo.js';
import { WEAPONS } from '../src/sim/weapons.js';

const idle = { moveX: 0, moveZ: 0, fire: false, firePressed: false, ads: false, reload: false, weapon: null, cycle: 0 };
const step = (g, input = {}) => { g.step(1 / 60, { ...idle, yaw: g.player.yaw, pitch: g.player.pitch, ...input }); return g.drainEvents(); };
const run = (g, seconds, input = {}) => { const out = []; for (let t = 0; t < seconds - 1e-9; t += 1 / 60) out.push(...step(g, input)); return out; };
function arena(seed = 5) {
  const g = createGame({ seed, firstDelay: 999 });
  g.mode = 'test';
  return g;
}
function place(g, type, x, z) { const e = g.spawnEnemy(type, { id: 99, spawn: { x, z } }); e.spawnT = 0; e.state = 'recover'; e.t = 99; return e; }
// Walk sideways for a while so the recorder holds a 3 s path, then fire the echo.
function startEcho(g) {
  run(g, 3.4, { moveX: 1, yaw: 0, pitch: 0 });
  g.player.energy = 100;
  const evs = step(g, { echoPressed: true });
  assert.ok(evs.some(e => e.type === 'echoStart'), 'echo started');
}

// PHASE SWAP: second press mid-replay swaps places; the echo collapses at the old player position.
{
  const g = arena();
  startEcho(g);
  const early = step(g, { echoPressed: true });
  assert.ok(early.some(e => e.type === 'echoDenied' && e.reason === 'swapEarly'), 'swap needs a short arming delay');
  run(g, 0.6);
  const before = { ...g.player.body }, echoAt = { ...g.echo.pose };
  const chaser = place(g, 'stalker', before.x + 2, before.z);
  const evs = step(g, { echoPressed: true });
  const swap = evs.find(e => e.type === 'echoSwap');
  assert.ok(swap, 'phase swap event');
  assert.ok(Math.hypot(g.player.body.x - echoAt.x, g.player.body.z - echoAt.z) < 0.3, 'player moved to the echo');
  assert.equal(g.echo.state, 'collapse', 'echo stops replaying');
  assert.ok(Math.hypot(g.echo.center.x - before.x, g.echo.center.z - before.z) < 0.3, 'echo collapses where the player stood');
  assert.ok(chaser.pull, 'enemies near the old position are dragged into the collapse');
  assert.ok(g.player.invuln > 0, 'brief invulnerability after swapping');
  assert.ok(g.recorder.samples.length <= 1 && g.recorder.samples.every(s => Math.hypot(s.x - echoAt.x, s.z - echoAt.z) < 0.3), 'recording restarts at the new position (no teleport inside it)');
  const again = step(g, { echoPressed: true });
  assert.ok(!again.some(e => e.type === 'echoSwap'), 'only one swap per echo');
  const rest = run(g, 1);
  assert.ok(rest.some(e => e.type === 'echoBlast'), 'collapse still detonates');
  assert.ok(!chaser.alive || chaser.hp < chaser.maxHp, 'blast hits the pulled enemy');
  assert.equal(g.summary().swaps, 1);
}

// PARADOX: a kill where both you and the echo landed damage inside the window scores x1.5 and refunds energy.
{
  const g = arena();
  const a = place(g, 'stalker', 0, 10), b = place(g, 'stalker', 6, 10);
  const down = { x: 0, y: -1, z: 0 };
  g.fireShot({ x: a.x, y: a.y + 6, z: a.z }, [down], WEAPONS[0], false); // player hit
  a.hp = 1;
  g.player.energy = 0;
  g.fireShot({ x: a.x, y: a.y + 6, z: a.z }, [down], WEAPONS[0], true); // echo finishes it
  const kill = g.drainEvents().find(e => e.type === 'kill' && e.id === a.id);
  assert.ok(kill?.paradox, 'paradox kill flagged');
  assert.ok(g.player.energy >= ECHO.paradoxEnergy, 'paradox kill refunds energy');
  b.hp = 1;
  g.score.combo = 0; g.score.multiplier = 1;
  g.fireShot({ x: b.x, y: b.y + 6, z: b.z }, [down], WEAPONS[0], false); // solo kill
  const solo = g.drainEvents().find(e => e.type === 'kill' && e.id === b.id);
  assert.ok(!solo.paradox, 'solo kill is not a paradox');
  assert.equal(g.summary().paradoxKills, 1);
  // Same multiplier context: paradox points are 1.5x a plain kill of the same type.
  const g2 = arena(), c = place(g2, 'stalker', 0, 10), d = place(g2, 'stalker', 6, 10);
  g2.fireShot({ x: c.x, y: c.y + 6, z: c.z }, [down], WEAPONS[0], false); c.hp = 1;
  g2.fireShot({ x: c.x, y: c.y + 6, z: c.z }, [down], WEAPONS[0], true);
  const p1 = g2.drainEvents().find(e => e.type === 'kill').points;
  g2.score.combo = 0; d.hp = 1;
  g2.fireShot({ x: d.x, y: d.y + 6, z: d.z }, [down], WEAPONS[0], false);
  const p2 = g2.drainEvents().find(e => e.type === 'kill').points;
  assert.equal(p1, Math.round(100 * ECHO.paradoxBonus), `paradox points (${p1})`);
  assert.equal(p2, 100, `plain points (${p2})`);
}

// LONG ECHO: the replay window grows from 3 to 4 seconds.
{
  const g = arena();
  g.mode = 'upgrade'; g.offers = ['longecho'];
  assert.ok(g.chooseUpgrade('longecho'));
  g.mode = 'test';
  run(g, 4.6, { moveX: 1, yaw: 0, pitch: 0 });
  g.player.energy = 100;
  step(g, { echoPressed: true });
  assert.ok(Math.abs(g.echo.end - g.echo.start - 4) < 0.05, `replay lasts 4 s (${(g.echo.end - g.echo.start).toFixed(2)})`);
}

// ECHO SIPHON: every attack the echo absorbs charges the player.
{
  const g = arena();
  g.mode = 'upgrade'; g.offers = ['echosiphon'];
  g.chooseUpgrade('echosiphon');
  g.mode = 'test';
  startEcho(g);
  const e0 = g.player.energy;
  const q = g.echo.pose;
  g.projectiles.push({ id: 999, kind: 'bolt', x: q.x + 3, y: q.y + 1.2, z: q.z, vx: -30, vy: 0, vz: 0, r: 0.2, damage: 10, life: 2, owner: 0 });
  const evs = run(g, 0.3);
  assert.ok(evs.some(e => e.type === 'echoHit'), 'echo absorbed the bolt');
  assert.ok(g.player.energy - e0 >= ECHO.siphonEnergy - 1e-6, `siphon charged the player (${(g.player.energy - e0).toFixed(1)})`);
}

// SWAP SURGE: +40% damage for a short window after swapping, dash charges refilled.
{
  const g = arena();
  g.mode = 'upgrade'; g.offers = ['swapsurge'];
  g.chooseUpgrade('swapsurge');
  g.mode = 'test';
  startEcho(g);
  run(g, 0.5);
  g.player.dash.charges = 0;
  step(g, { echoPressed: true });
  assert.ok(g.surgeT > 0, 'surge active');
  assert.equal(g.player.dash.charges, g.stats.dashCharges, 'dash refilled');
  const e = place(g, 'sentinel', 0, -20);
  g.fireShot({ x: e.x, y: e.y + 6, z: e.z }, [{ x: 0, y: -1, z: 0 }], WEAPONS[0], false);
  assert.ok(Math.abs(e.maxHp - e.hp - 17 * 1.4) < 1e-6, `surge damage (${e.maxHp - e.hp})`);
  run(g, ECHO.surgeTime + 0.1);
  assert.equal(g.surgeT, 0, 'surge expires');
}

// Boss lances lock onto the echo while it replays (so the decoy matters in the final fight too).
{
  let echoTargeted = 0, echoStruck = 0;
  for (const seed of [1, 2, 3]) {
    const g = arena(seed);
    g.debug.invulnerable = true;
    g.player.body.x = 0; g.player.body.z = 24;
    g.startWave(10);
    g.mode = 'test';
    for (let t = 0; t < 60; t += 1 / 60) {
      if (!g.echo && g.boss?.state === 'fight' && g.recorder.length(g.time) > 3) g.player.energy = 100;
      const evs = step(g, { moveX: Math.sin(t) > 0 ? 1 : -1, echoPressed: g.player.energy >= 100 });
      for (const e of evs) {
        if (e.type === 'beamTell' && e.target === 'echo') echoTargeted++;
        if (e.type === 'beamFire' && e.echo) echoStruck++;
      }
      for (const e of g.enemies) if (e.alive && e.spawnT <= 0) { e.hp = 0; e.alive = false; }
    }
  }
  assert.ok(echoTargeted > 0, `boss lances targeted the echo (${echoTargeted})`);
  assert.ok(echoStruck > 0, `a lance struck the echo (${echoStruck})`);
}
console.log('PASS echo mods: phase swap, paradox kills, long echo, echo siphon, swap surge, boss lances vs echo');

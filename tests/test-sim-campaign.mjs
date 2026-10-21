// Full-campaign soak: an invulnerable autopilot plays all ten waves including RESONATOR PRIME on two seeds
// and a vulnerable autopilot must survive at least the first wave. Validates spawning, targeting, pathing,
// damage, upgrades, the boss script and victory flow end to end with no Three.js or DOM.
import assert from 'node:assert/strict';
import { createGame } from '../src/sim/game.js';
import { createBot, runGame } from './bot.mjs';

let hurtTotal = 0;
for (const seed of [101, 202]) {
  const game = createGame({ seed, invulnerable: true, firstDelay: 1 });
  const waves = new Set();
  let bossPhases = 0, finite = true;
  const { t, counts } = runGame(game, createBot(game), {
    onEvent(e) {
      if (e.type === 'waveStart') waves.add(e.wave);
      if (e.type === 'bossPhase') bossPhases++;
      if (e.type === 'hit' && !Number.isFinite(e.damage)) finite = false;
    },
  });
  const s = game.summary();
  assert.equal(game.mode, 'victory', `seed ${seed}: campaign ends in victory (mode=${game.mode}, wave=${game.wave}, t=${t.toFixed(0)}s, alive=${game.enemies.filter(e => e.alive).length}, boss=${game.boss?.hp})`);
  assert.equal(waves.size, 10);
  assert.equal(bossPhases, 2, 'boss went through both phase shifts');
  assert.ok(finite, 'no NaN damage');
  assert.ok(counts.upgradeChosen === 9, `nine upgrades chosen (${counts.upgradeChosen})`);
  assert.ok(counts.echoStart > 0 && counts.echoBlast > 0, 'echo used and detonated');
  assert.ok(counts.playerHurt > 0, 'enemies actually deal damage to the player');
  hurtTotal += counts.playerHurt;
  for (const k of ['enemyTell', 'enemyFire', 'mortar', 'shockwave', 'beamFire', 'bossFire', 'pickup']) assert.ok(counts[k] > 0, `event ${k} occurred`);
  assert.ok(Number.isFinite(game.player.body.x) && Number.isFinite(game.player.body.y), 'player position finite');
  console.log(`seed ${seed}: victory in ${t.toFixed(0)} s sim, score ${s.score}, kills ${s.kills}, acc ${(s.accuracy * 100).toFixed(0)}%, echoes ${s.echoes}, hurt ${counts.playerHurt}x / ${s.damageTaken} hp, rank ${s.rank}`);
}

assert.ok(hurtTotal > 10, `enemies land hits regularly across both campaigns (${hurtTotal})`);

// A vulnerable autopilot must clear wave 1 on normal (the opening must be fair).
{
  const game = createGame({ seed: 7, firstDelay: 1 });
  let clearedFirst = false;
  runGame(game, createBot(game), { maxSeconds: 400, onEvent(e) { if (e.type === 'waveClear' && e.wave === 1) clearedFirst = true; } });
  assert.ok(clearedFirst, `vulnerable bot clears wave 1 (reached wave ${game.wave}, mode ${game.mode})`);
  console.log(`vulnerable bot: reached wave ${game.wave} (${game.mode}), score ${game.score.total}`);
}
console.log('PASS sim campaign: 10 waves + boss on two seeds, upgrades, echo, all attack types, fair opening');

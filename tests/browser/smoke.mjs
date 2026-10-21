// Browser smoke test (Playwright + software WebGL). Boots its own static server on a free port, then walks
// the real page: menu -> how-to/settings -> start -> move/look/jump/dash -> shoot and kill -> swap/reload ->
// phase echo -> wave clear -> upgrade pick -> pause/resume -> boss wave -> defeat -> results -> menu.
// Game time is fast-forwarded with window.__phaseEcho.advance() so the run is deterministic even when
// software rendering only manages a few frames per second. Fails on any page error.
// Env: PLAYWRIGHT_MODULE (path to playwright's index.mjs, optional), SHOTS_DIR (screenshots, optional).
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const pwModule = process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright';
const { chromium } = await import(pwModule);
const shots = process.env.SHOTS_DIR || '';
if (shots) mkdirSync(shots, { recursive: true });
const t0 = Date.now();
const log = (...a) => console.log(`[smoke ${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...a);

const port = await new Promise((res, rej) => { const s = createServer(); s.on('error', rej); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });
const server = spawn(process.execPath, ['server.cjs'], { cwd: root, env: { ...process.env, PORT: String(port), HOST: '127.0.0.1' }, stdio: ['ignore', 'pipe', 'pipe'] });
await new Promise((res, rej) => { const t = setTimeout(() => rej(new Error('server timeout')), 15000); server.stdout.on('data', d => { if (String(d).includes('ready')) { clearTimeout(t); res(); } }); server.on('exit', c => rej(new Error('server exit ' + c))); });
const base = `http://127.0.0.1:${port}`;

// Default: deterministic software WebGL (SwiftShader). GPU=1 uses the machine's GPU instead.
const gpuArgs = process.env.GPU === '1' ? ['--enable-gpu', '--ignore-gpu-blocklist'] : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
const browser = await chromium.launch({ headless: true, args: [...gpuArgs, '--autoplay-policy=no-user-gesture-required'] });
const results = [];
let page;
async function step(name, fn) {
  const t = Date.now();
  try {
    await fn();
    results.push({ name, ok: true });
    const m = await page.evaluate(() => ({ heap: Math.round((performance.memory?.usedJSHeapSize || 0) / 1048576), ...window.__phaseEcho.stats() })).catch(() => ({}));
    log('ok  ', name, `${Date.now() - t}ms`, `heap=${m.heap}MB fps=${m.fps?.toFixed?.(1)} calls=${m.calls} geos=${m.geos} tex=${m.tex} programs=${m.programs}`);
  }
  catch (e) { results.push({ name, ok: false, e }); log('FAIL', name, '\n', e?.stack || e); if (shots) await page?.screenshot({ path: path.join(shots, `fail-${results.length}.png`) }).catch(() => {}); }
}
const shot = async name => { if (shots) { await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))); await page.screenshot({ path: path.join(shots, `${name}.png`) }); } };
const pe = (fn, arg) => page.evaluate(fn, arg);
const advance = s => pe(sec => window.__phaseEcho.advance(sec), s);

try {
  const [vw, vh] = (process.env.VIEWPORT || '1280x720').split('x').map(Number);
  const context = await browser.newContext({ viewport: { width: vw, height: vh } });
  page = await context.newPage();
  page.setDefaultTimeout(45000);
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('crash', () => log('PAGE CRASHED'));
  page.on('console', m => { if (m.type() === 'error' && !/WebGL|GPU|swiftshader|fallback|AudioContext/i.test(m.text())) errors.push(m.text()); });

  await step('menu boots with a WebGL scene and no errors', async () => {
    await page.goto(`${base}/?seed=4${process.env.QUALITY ? `&quality=${process.env.QUALITY}` : ''}`);
    await page.waitForFunction(() => window.__phaseEcho && document.body.dataset.state === 'menu');
    await page.waitForFunction(() => window.__phaseEcho.stats().calls > 5);
    assert.ok(await page.isVisible('#screen-menu'));
    await shot('01-menu');
    assert.deepEqual(errors, []);
  });

  await step('how-to and settings screens open; a setting persists', async () => {
    await page.click('#btn-howto');
    assert.ok(await page.isVisible('#screen-howto'));
    await shot('02-howto');
    await page.click('#btn-howto-back');
    await page.click('#btn-settings');
    await page.fill('#set-fov', '96');
    await page.dispatchEvent('#set-fov', 'input');
    assert.equal(await page.textContent('#set-fov-v'), '96°');
    await page.click('#btn-settings-back');
    assert.equal(await pe(() => JSON.parse(localStorage.getItem('phase-echo.settings.v1')).fov), 96);
    assert.ok(await page.isVisible('#screen-menu'));
  });

  await step('start run: HUD visible, first wave spawns', async () => {
    await page.click('[data-diff="normal"]');
    await pe(() => window.__phaseEcho.start());
    await page.waitForFunction(() => window.__phaseEcho.state === 'play' && !!window.__phaseEcho.game);
    // The scripted player often stands still while aiming; balance is covered by tests/test-sim-campaign.mjs,
    // so keep the player alive here and switch damage back on for the defeat step at the end.
    await pe(() => { window.__phaseEcho.game.debug.invulnerable = true; });
    assert.ok(await page.isVisible('#hud'));
    await advance(8.5);
    assert.equal(await pe(() => window.__phaseEcho.game.mode), 'wave');
    assert.ok(await pe(() => window.__phaseEcho.game.enemies.some(e => e.alive && e.spawnT <= 0)), 'enemies on the field');
    await shot('03-wave1');
  });

  await step('movement, look, jump and dash', async () => {
    const before = await pe(() => ({ ...window.__phaseEcho.game.player.body }));
    await pe(() => window.__phaseEcho.input.inject({ keys: ['KeyW'], yaw: 0.6, pitch: -0.1 }));
    await advance(0.8);
    await pe(() => window.__phaseEcho.input.inject({ jump: true }));
    await advance(0.15);
    const air = await pe(() => window.__phaseEcho.game.player.body.y);
    await pe(() => window.__phaseEcho.input.inject({ dash: true }));
    await advance(0.3);
    const dashCharges = await pe(() => window.__phaseEcho.game.player.dash.charges);
    await pe(() => window.__phaseEcho.input.release(['KeyW']));
    const after = await pe(() => ({ ...window.__phaseEcho.game.player.body, yaw: window.__phaseEcho.game.player.yaw }));
    assert.ok(Math.hypot(after.x - before.x, after.z - before.z) > 4, 'player moved');
    assert.ok(air > 0.3, `jumped (${air})`);
    assert.equal(dashCharges, 1, 'dash consumed a charge');
    assert.ok(Math.abs(after.yaw - 0.6) < 1e-6, 'look applied');
  });

  await step('carbine: track, hit and kill enemies', async () => {
    const r = await pe(() => {
      const P = window.__phaseEcho, g = P.game, start = g.record.kills;
      for (let i = 0; i < 1200 && g.record.kills - start < 3 && g.mode === 'wave'; i++) {
        const p = g.player.body, eye = { x: p.x, y: p.y + 1.62, z: p.z };
        const e = g.enemies.filter(x => x.alive && x.spawnT <= 0).sort((a, b) => Math.hypot(a.x - p.x, a.z - p.z) - Math.hypot(b.x - p.x, b.z - p.z))[0];
        if (e) {
          const ty = e.def.flying ? e.y : e.y + e.def.height * 0.6, dx = e.x - eye.x, dy = ty - eye.y, dz = e.z - eye.z;
          P.input.inject({ yaw: Math.atan2(-dx, -dz), pitch: Math.atan2(dy, Math.hypot(dx, dz)) - g.arsenal.aimOffset.pitch, fire: true });
        }
        P.advance(1 / 60);
      }
      P.input.inject({ fire: false });
      return { kills: g.record.kills - start, shots: g.record.shots, hits: g.record.hits, score: g.score.total };
    });
    assert.ok(r.shots > 5 && r.hits > 0, `shots fired and hit (${JSON.stringify(r)})`);
    assert.ok(r.kills >= 1 && r.score > 0, `kills scored (${JSON.stringify(r)})`);
    await shot('04-combat');
  });

  await step('weapon swap, scatter fire, per-shell reload, rail ADS + fire', async () => {
    await pe(() => window.__phaseEcho.input.inject({ weapon: 1 }));
    await advance(0.4);
    assert.equal(await pe(() => window.__phaseEcho.game.arsenal.index), 1);
    const m0 = await pe(() => window.__phaseEcho.game.arsenal.slots[1].mag);
    await pe(() => window.__phaseEcho.input.inject({ fire: true }));
    await advance(0.05);
    await pe(() => window.__phaseEcho.input.inject({ fire: false }));
    assert.equal(await pe(() => window.__phaseEcho.game.arsenal.slots[1].mag), m0 - 1, 'one scatter shell spent');
    await pe(() => window.__phaseEcho.input.inject({ reload: true }));
    await advance(0.8);
    assert.equal(await pe(() => window.__phaseEcho.game.arsenal.slots[1].mag), m0, 'shell reloaded');
    await pe(() => window.__phaseEcho.input.inject({ weapon: 2 }));
    await advance(0.4);
    await pe(() => window.__phaseEcho.input.inject({ ads: true }));
    await advance(0.35);
    assert.ok(await pe(() => window.__phaseEcho.game.arsenal.ads) > 0.95, 'aiming down sights');
    await shot('05-rail-ads');
    await pe(() => window.__phaseEcho.input.inject({ fire: true }));
    await advance(0.05);
    await pe(() => window.__phaseEcho.input.inject({ fire: false, ads: false }));
    assert.equal(await pe(() => window.__phaseEcho.game.arsenal.slots[2].mag), 4, 'rail round spent');
    await pe(() => window.__phaseEcho.input.inject({ weapon: 0 }));
    await advance(0.4);
    await shot('05b-carbine-hip');
  });

  await step('phase echo: rewind, replay, collapse', async () => {
    // Freeze wave progression ('test' mode) so an echo kill cannot end the wave mid-replay.
    await pe(() => { const g = window.__phaseEcho.game; g.mode = 'test'; g.player.energy = 100; window.__phaseEcho.input.inject({ keys: ['KeyA'] }); });
    await advance(1.5);
    const before = await pe(() => ({ ...window.__phaseEcho.game.player.body }));
    await pe(() => { window.__phaseEcho.input.release(['KeyA']); window.__phaseEcho.input.inject({ echo: true }); });
    await advance(0.05);
    const after = await pe(() => ({ ...window.__phaseEcho.game.player.body, echo: !!window.__phaseEcho.game.echo }));
    assert.ok(after.echo, 'echo active');
    assert.ok(Math.hypot(after.x - before.x, after.z - before.z) > 3, 'player rewound to the recorded position');
    await advance(0.6);
    await shot('06-echo');
    await advance(3.5);
    const ev = await pe(() => window.__phaseEcho.events);
    for (const k of ['echoStart', 'echoCollapse', 'echoBlast']) assert.ok(ev.includes(k), `event ${k}`);
    assert.ok(await pe(() => !window.__phaseEcho.game.echo && window.__phaseEcho.game.record.echoes === 1), 'echo finished');
    await pe(() => { window.__phaseEcho.game.mode = 'wave'; });
  });

  await step('phase swap: second Q mid-replay trades places, echo collapses at the old spot', async () => {
    await pe(() => { const g = window.__phaseEcho.game; g.mode = 'test'; g.player.energy = 100; window.__phaseEcho.input.inject({ keys: ['KeyD'] }); });
    await advance(1.5);
    await pe(() => { window.__phaseEcho.input.release(['KeyD']); window.__phaseEcho.input.inject({ echo: true }); });
    await advance(0.6);
    const r = await pe(() => {
      const P = window.__phaseEcho, g = P.game, before = { ...g.player.body }, at = { ...g.echo.pose };
      P.input.inject({ echo: true });
      P.advance(0.02);
      return { moved: Math.hypot(g.player.body.x - at.x, g.player.body.z - at.z), center: g.echo && Math.hypot(g.echo.center.x - before.x, g.echo.center.z - before.z), swaps: g.record.swaps };
    });
    assert.ok(r.moved < 0.4 && r.center < 0.4 && r.swaps === 1, `swap moved the player to the echo (${JSON.stringify(r)})`);
    await shot('06b-swap');
    await advance(1.2);
    assert.ok((await pe(() => window.__phaseEcho.events)).includes('echoSwap'));
    await pe(() => { window.__phaseEcho.game.mode = 'wave'; });
  });

  await step('rewinder renders, telegraphs and rewinds without shader churn', async () => {
    const programs0 = (await pe(() => window.__phaseEcho.stats())).programs;
    await pe(() => { const g = window.__phaseEcho.game; g.mode = 'test'; g.debug.invulnerable = true; window.__rw = g.spawnEnemy('rewinder', { id: 0, spawn: { x: g.player.body.x + 4, z: g.player.body.z - 12 } }); });
    let rewound = false;
    for (let i = 0; i < 40 && !rewound; i++) { await advance(0.25); rewound = (await pe(() => window.__phaseEcho.events)).includes('rewind'); }
    assert.ok(rewound, 'rewinder snapped back in time');
    const programs1 = (await pe(() => window.__phaseEcho.stats())).programs;
    assert.ok(programs1 - programs0 <= 1, `rewinder shaders were pre-compiled (${programs0} -> ${programs1})`);
    await pe(() => { window.__rw.alive = false; const g = window.__phaseEcho.game; g.debug.invulnerable = false; g.mode = 'wave'; });
  });

  await step('wave clears -> upgrade screen -> pick -> intermission', async () => {
    await pe(() => {
      const P = window.__phaseEcho, g = P.game;
      g.debug.invulnerable = true;
      for (let i = 0; i < 400 && g.mode === 'wave'; i++) {
        for (const e of g.enemies) if (e.alive && e.spawnT <= 0) { e.hp = 1; g.fireShot({ x: e.x, y: e.y + 6, z: e.z }, [{ x: 0, y: -1, z: 0 }], { id: 'probe', damage: 999, pellets: 1, pierce: 1, range: 20, falloffStart: 99, falloffEnd: 99, minFalloff: 1, weakMult: 1 }, true); }
        P.advance(0.1);
      }
      P.advance(3);
    });
    await page.waitForFunction(() => window.__phaseEcho.state === 'upgrade');
    assert.ok(await page.isVisible('#screen-upgrade'));
    assert.equal(await page.locator('#upgrade-cards .card').count(), 3);
    await shot('07-upgrade');
    await page.click('#upgrade-cards .card >> nth=1');
    await page.waitForFunction(() => window.__phaseEcho.state === 'play' && window.__phaseEcho.game.mode === 'intermission');
    assert.equal(await pe(() => Object.keys(window.__phaseEcho.game.owned).length), 1);
  });

  await step('pause freezes the simulation; resume continues', async () => {
    await pe(() => window.__phaseEcho.pause());
    assert.ok(await page.isVisible('#screen-pause'));
    const t = await pe(() => window.__phaseEcho.game.time);
    await page.waitForTimeout(500);
    assert.equal(await pe(() => window.__phaseEcho.game.time), t, 'frozen while paused');
    await shot('08-pause');
    await page.click('#btn-resume');
    await page.waitForFunction(() => window.__phaseEcho.state === 'play');
  });

  await step('boss wave: RESONATOR PRIME renders, attacks and takes damage', async () => {
    await pe(() => { const g = window.__phaseEcho.game; g.enemies.forEach(e => { e.alive = false; }); g.spawnQueue.length = 0; g.pending.length = 0; g.startWave(10); const b = g.player.body; b.x = 0; b.z = 22; window.__phaseEcho.input.inject({ yaw: 0, pitch: 0.3 }); });
    await advance(5.5);
    assert.equal(await pe(() => window.__phaseEcho.game.boss?.state), 'fight');
    await shot('09-boss');
    const programs0 = (await pe(() => window.__phaseEcho.stats())).programs;
    const r = await pe(() => {
      const P = window.__phaseEcho, g = P.game, hp0 = g.boss.hp;
      P.input.inject({ weapon: 2 });
      P.advance(0.4);
      for (let i = 0; i < 360 && g.boss?.alive; i++) {
        const p = g.player.body, eye = { x: p.x, y: p.y + 1.62, z: p.z }, t = g.boss.eye;
        const dx = t.x - eye.x, dy = t.y - eye.y, dz = t.z - eye.z;
        P.input.inject({ yaw: Math.atan2(-dx, -dz), pitch: Math.atan2(dy, Math.hypot(dx, dz)) - g.arsenal.aimOffset.pitch, fire: i % 20 < 2 });
        P.advance(1 / 30);
      }
      P.input.inject({ fire: false });
      return { hp0, hp: g.boss?.hp, phase: g.boss?.phase, projectiles: g.projectiles.length };
    });
    assert.ok(r.hp < r.hp0, `boss took damage (${JSON.stringify(r)})`);
    const programs1 = (await pe(() => window.__phaseEcho.stats())).programs;
    assert.ok(programs1 - programs0 <= 2, `no shader program churn during the boss fight (${programs0} -> ${programs1})`);
    await shot('09b-boss-fight');
  });

  await step('defeat -> results screen -> main menu', async () => {
    assert.equal(await pe(() => window.__phaseEcho.state), 'play', 'still in play before the forced defeat');
    await pe(() => { const g = window.__phaseEcho.game; g.debug.invulnerable = false; g.player.invuln = 0; g.hurtPlayer(9999, null, 'probe'); });
    // The death camera runs on real frame time: give slow software rendering room.
    await page.waitForFunction(() => window.__phaseEcho.state === 'results', null, { timeout: 60000 });
    assert.match(await page.textContent('#results-stats'), /得分/);
    await shot('10-results');
    await page.click('#btn-menu');
    await page.waitForFunction(() => window.__phaseEcho.state === 'menu');
  });

  await step('daily challenge: fixed seed + mutator, best run saved as a ghost and replayed next time', async () => {
    const info = await page.textContent('#daily-info');
    assert.match(info, /\d\d-\d\d · /, `daily info on the menu (${info})`);
    await page.click('#btn-daily');
    await page.waitForFunction(() => window.__phaseEcho.state === 'play');
    const run1 = await pe(() => ({ daily: window.__phaseEcho.game.daily, mutator: window.__phaseEcho.game.mutator, seed: window.__phaseEcho.game.seed, tag: document.getElementById('run-tag').textContent }));
    assert.ok(run1.daily && run1.mutator && run1.tag.startsWith('DAILY'), JSON.stringify(run1));
    await pe(() => window.__phaseEcho.input.inject({ keys: ['KeyW'] }));
    await advance(3);
    await pe(() => window.__phaseEcho.input.release(['KeyW']));
    assert.ok((await pe(() => window.__phaseEcho.ghost.recorded)) >= 25, 'ghost track recording');
    await pe(() => { const g = window.__phaseEcho.game; g.player.invuln = 0; g.hurtPlayer(9999, null, 'probe'); });
    await page.waitForFunction(() => window.__phaseEcho.state === 'results', null, { timeout: 60000 });
    assert.match(await page.textContent('#results-sub'), /每日挑战/);
    await page.click('#btn-again');
    await page.waitForFunction(() => window.__phaseEcho.state === 'play');
    const run2 = await pe(() => ({ seed: window.__phaseEcho.game.seed, ghost: window.__phaseEcho.ghost }));
    assert.equal(run2.seed, run1.seed, 'same daily seed');
    assert.ok(run2.ghost.best, 'previous best replays as a ghost');
    await advance(1.5);
    await shot('11-daily-ghost');
    await pe(() => window.__phaseEcho.pause());
    await page.click('#btn-quit');
    await page.waitForFunction(() => window.__phaseEcho.state === 'menu');
  });

  await step('no page errors during the whole run', async () => { assert.deepEqual(errors, []); });
  log('render stats', JSON.stringify(await pe(() => window.__phaseEcho.stats())));
  log('viewport', `${vw}x${vh}`, 'GPU mode', process.env.GPU === '1' ? 'hardware' : 'swiftshader');
} finally {
  await browser.close();
  server.kill();
}
const failed = results.filter(r => !r.ok);
log(`${results.length - failed.length}/${results.length} steps passed`);
process.exit(failed.length ? 1 : 0);

// PHASE ECHO game simulation. Owns every rule-level object (player, arsenal, enemies, boss, projectiles,
// echo, waves, pickups, score) and advances them with step(dt, input). It never touches the DOM or Three.js:
// the renderer reads state and consumes `events`, which keeps the whole game playable headless in Node.
import { createRng } from './rng.js';
import { createLayout, PLAYER_SPAWN, groundAt, HALF } from './layout.js';
import { firstBoxHit, raySphere, rayCapsule, segmentBlocked, segmentHitsCapsule, segSegDist2, normalize, clamp, yawTowards } from './geometry.js';
import { createNavGrid, createFlowField } from './nav.js';
import { GRAVITY, separateBodies } from './physics.js';
import { createPlayer, stepPlayer, eyeOf, PLAYER } from './player.js';
import { WEAPONS, createArsenal, updateArsenal, refreshArsenal, falloff, addAmmo, ammoFull, reserveMax, magSize } from './weapons.js';
import { baseStats, rollOffers, applyUpgrade } from './upgrades.js';
import { createScore, addKill, stepScore, waveBonus, accuracy, rankFor } from './scoring.js';
import { DIFFICULTY, WAVE_COUNT, isBossWave, buildSpawnQueue, maxAlive, spawnInterval, waveParTime, INTERMISSION, FIRST_DELAY, GATE_WARNING } from './waves.js';
import { ENEMY_TYPES, createEnemy, updateEnemy, weakCenter, forwardOf, isStaggerable } from './enemies.js';
import { BOSS, createBoss, stepBoss, damageBoss, platePositions } from './boss.js';
import { ECHO, createRecorder, beginEcho, advanceEcho } from './echo.js';

export const PICKUP = Object.freeze({ health: 25, scatter: 8, rail: 4, life: 25, collect: 1.15, station: { refill: 0.5, cooldown: 25, radius: 1.7 } });
export const ENERGY_PER_DAMAGE = 0.12;
export const BOSS_ENERGY_PER_DAMAGE = 0.05;

// The arena and its navigation grids are static and read-only, so they are built once per page and shared by
// every run (rasterising both grids costs ~100 ms, which used to stall each start / restart).
let shared = null;
function sharedArena() {
  if (!shared) {
    const layout = createLayout();
    shared = { layout, navSmall: createNavGrid(layout, { radius: 0.45 }), navLarge: createNavGrid(layout, { radius: 0.95, usePads: false }) };
  }
  return shared;
}

export function createGame(opts = {}) {
  const seed = (opts.seed ?? Math.floor(Math.random() * 2 ** 31)) >>> 0;
  const diff = DIFFICULTY[opts.difficulty] || DIFFICULTY.normal;
  const rng = createRng(seed);
  const { layout, navSmall, navLarge } = sharedArena();
  const world = { boxes: layout.boxes, pads: layout.pads, bounds: layout.bounds };
  const flows = {
    small: { player: createFlowField(navSmall), echo: createFlowField(navSmall) },
    large: { player: createFlowField(navLarge), echo: createFlowField(navLarge) },
  };
  const stats = baseStats();
  const player = createPlayer(PLAYER_SPAWN, stats);
  const stations = [[1, 1], [1, -1], [-1, 1], [-1, -1]].map(([sx, sz], i) => ({ id: i, x: 28 * sx, y: 0, z: 28 * sz, cd: 0 }));
  const g = {
    seed, diff, rng, layout, world, stats, owned: {}, time: 0, mode: 'intermission', modeT: opts.firstDelay ?? FIRST_DELAY, wave: (opts.startWave ?? 1) - 1,
    player, arsenal: createArsenal(stats), enemies: [], boss: null, projectiles: [], beams: [], shockwaves: [], pickups: [], stations,
    pending: [], echo: null, recorder: createRecorder(), score: createScore(), offers: null, events: [], nextId: 1, slowT: 0,
    spawnQueue: [], spawnT: 0, waveTime: 0, waveHurt: false, waveQueueLength: 0, lastGate: -1, contactCd: 0,
    record: { shots: 0, hits: 0, kills: 0, weakKills: 0, echoes: 0, echoKills: 0, damageTaken: 0, damageDealt: 0 },
    debug: { invulnerable: !!opts.invulnerable },
  };
  const emit = (type, data = {}) => { g.events.push({ ...data, type, t: g.time }); }; // payload can never overwrite the event name
  const nextId = () => g.nextId++;

  // ---------------------------------------------------------------- targets / facades
  const echoLive = () => !!(g.echo && g.echo.state === 'replay');
  function targetPoint(t) {
    if (t === 'echo' && echoLive()) {
      const q = g.echo.pose;
      return { x: q.x, y: q.y, z: q.z, r: PLAYER.radius, h: PLAYER.height, chest: 1.2, vx: g.echo.vx, vz: g.echo.vz };
    }
    const b = player.body;
    return { x: b.x, y: b.y, z: b.z, r: PLAYER.radius, h: PLAYER.height, chest: 1.2, vx: b.vx, vz: b.vz };
  }
  function pickTarget(e) {
    if (echoLive()) {
      const p = player.body, q = g.echo.pose;
      const dp = Math.hypot(p.x - e.x, p.z - e.z), dq = Math.hypot(q.x - e.x, q.z - e.z);
      if (dq < dp * 1.25 || e.id % 3 !== 0) return 'echo';
    }
    return 'player';
  }
  const facade = {
    emit, rng, diff, world, boxes: layout.boxes, bounds: layout.bounds,
    get time() { return g.time; },
    pickTarget, targetPoint,
    targetValid: t => t === 'player' || (t === 'echo' && echoLive()),
    los: (a, b) => !segmentBlocked(a, b, layout.boxes),
    flowFor: e => flows[e.type === 'bulwark' ? 'large' : 'small'][e.target === 'echo' && echoLive() ? 'echo' : 'player'],
    walkable: (e, ax, az, bx, bz, level) => (e.type === 'bulwark' ? navLarge : navSmall).straightWalkable(ax, az, bx, bz, level),
    hurt(target, amount, source, kind) {
      if (target === 'echo' && echoLive()) { g.echo.hitFlash = 0.15; emit('echoHit', { kind }); return; }
      hurtPlayer(amount, source, kind);
    },
    fire(e, kind, from, tgt, o) {
      const aim = { x: tgt.x, y: tgt.y + tgt.chest, z: tgt.z };
      const tFlight = Math.hypot(aim.x - from.x, aim.y - from.y, aim.z - from.z) / o.speed;
      aim.x += (tgt.vx || 0) * tFlight * o.lead; aim.z += (tgt.vz || 0) * tFlight * o.lead;
      let d = normalize({ x: aim.x - from.x, y: aim.y - from.y, z: aim.z - from.z });
      d = normalize({ x: d.x + (rng.next() - 0.5) * 2 * o.spread, y: d.y + (rng.next() - 0.5) * 2 * o.spread, z: d.z + (rng.next() - 0.5) * 2 * o.spread });
      g.projectiles.push({ id: nextId(), kind, x: from.x, y: from.y, z: from.z, vx: d.x * o.speed, vy: d.y * o.speed, vz: d.z * o.speed, r: o.r, damage: o.damage, life: 4, owner: e.id });
      emit('enemyFire', { kind, x: from.x, y: from.y, z: from.z, id: e.id });
    },
    lob(e, from, tgt, o) {
      const T = o.flight;
      const tx = clamp(tgt.x + (tgt.vx || 0) * T * 0.5, -HALF + 1, HALF - 1), tz = clamp(tgt.z + (tgt.vz || 0) * T * 0.5, -HALF + 1, HALF - 1);
      const ty = groundAt(layout.boxes, tx, tz, tgt.y + 0.2);
      const vy = (ty - from.y + 0.5 * GRAVITY * T * T) / T;
      g.projectiles.push({ id: nextId(), kind: 'shell', x: from.x, y: from.y, z: from.z, vx: (tx - from.x) / T, vy, vz: (tz - from.z) / T, r: 0.3, damage: o.damage, radius: o.radius, gravity: true, life: T + 2, owner: e.id, target: { x: tx, y: ty, z: tz }, eta: T });
      emit('mortar', { x: tx, y: ty, z: tz, r: o.radius, time: T });
    },
    shockwave(o) { g.shockwaves.push({ id: nextId(), hit: false, ...o }); emit('shockwave', { x: o.x, y: o.y, z: o.z, maxR: o.maxR, speed: o.speed }); },
  };
  const bossFacade = {
    emit, rng, diff, player,
    get time() { return g.time; },
    orb(boss, dir, speed) {
      const o = { x: boss.x + dir.x * (BOSS.coreR + 0.2), y: boss.y + dir.y * (BOSS.coreR + 0.2), z: boss.z + dir.z * (BOSS.coreR + 0.2) };
      g.projectiles.push({ id: nextId(), kind: 'orb', ...o, vx: dir.x * speed, vy: dir.y * speed, vz: dir.z * speed, r: 0.34, damage: 12 * diff.damage, life: 6, owner: boss.id });
    },
    beam(boss, tell) {
      const b = player.body;
      g.beams.push({ id: nextId(), t: tell, tell, aim: { x: b.x, y: b.y + 1.1, z: b.z }, from: { ...boss.eye }, fired: false, life: 0.3, end: null });
      emit('beamTell', { time: tell });
    },
    shockwave: facade.shockwave,
    summon(types) {
      const gates = layout.gates.slice().sort((a, b) => a.id - b.id);
      types.forEach((type, i) => {
        const gate = gates[(Math.floor(rng.next() * gates.length) + i * 3) % gates.length];
        g.pending.push({ type, gate, t: GATE_WARNING });
        emit('gateWarn', { gate: gate.id, enemy: type, x: gate.x, z: gate.z });
      });
    },
    clearProjectiles() {
      for (const p of g.projectiles) emit('projectileHit', { kind: p.kind, x: p.x, y: p.y, z: p.z, target: 'fizzle' });
      g.projectiles.length = 0;
      g.beams.length = 0;
    },
  };

  // ---------------------------------------------------------------- damage
  function gainEnergy(amount) {
    if (!(amount > 0)) return;
    const before = player.energy;
    player.energy = Math.min(ECHO.cost, player.energy + amount * stats.phaseGain);
    if (before < ECHO.cost && player.energy >= ECHO.cost && !g.echo) emit('echoReady', {});
  }

  function hurtPlayer(amount, source, kind = 'hit') {
    if (!player.alive || !(amount > 0) || g.mode === 'victory') return 0;
    if (player.invuln > 0) return 0;
    const sx = source?.x ?? player.body.x, sz = source?.z ?? player.body.z;
    const lost = g.debug.invulnerable ? 0 : Math.min(player.hp, amount); // record real HP lost only
    if (!g.debug.invulnerable) player.hp -= amount;
    player.lastHurt = g.time;
    player.hurtT = 0.35;
    g.waveHurt = true;
    g.record.damageTaken += lost;
    emit('playerHurt', { amount, kind, fromX: sx, fromZ: sz, hp: player.hp });
    if (player.hp <= 0) {
      player.hp = 0;
      player.alive = false;
      g.mode = 'defeat';
      emit('defeat', summary());
    }
    return amount;
  }

  function hitEnemy(o, d, e, maxT) {
    const s = e.def.shape;
    let tBody, tWeak, shielded = false;
    if (e.def.flying) {
      tBody = raySphere(o, d, { x: e.x, y: e.y, z: e.z }, s.body.sphere, maxT);
      const f = forwardOf(e);
      tWeak = raySphere(o, d, { x: e.x + f.x * 0.4, y: e.y, z: e.z + f.z * 0.4 }, s.weak.r, maxT);
    } else {
      tBody = rayCapsule(o, d, e.x, e.y + s.body.y0, e.y + s.body.y1, e.z, s.body.r, maxT);
      tWeak = raySphere(o, d, weakCenter(e), s.weak.r, maxT);
    }
    if (tWeak !== null && (tBody === null || tWeak <= tBody + 0.15)) return { t: tWeak, weak: true, target: e };
    if (tBody === null) return null;
    if (e.def.shield) {
      const f = forwardOf(e), hl = Math.hypot(d.x, d.z) || 1;
      shielded = -(d.x * f.x + d.z * f.z) / hl > e.def.shield.cos;
    }
    return { t: tBody, weak: false, target: e, shielded };
  }

  function hitBoss(o, d, maxT) {
    const boss = g.boss, out = [];
    for (const pl of platePositions(boss)) {
      const t = raySphere(o, d, pl, BOSS.plateR, maxT);
      if (t !== null) out.push({ t, plate: true, target: boss });
    }
    const te = raySphere(o, d, boss.eye, BOSS.eyeR, maxT), tc = raySphere(o, d, boss, BOSS.coreR, maxT);
    if (te !== null && (tc === null || te <= tc + 0.35)) out.push({ t: te, weak: true, target: boss });
    else if (tc !== null) out.push({ t: tc, weak: false, target: boss });
    return out;
  }

  // Echo shots get a light aim assist so replayed fire stays useful against enemies that have moved.
  function assist(o, d) {
    let best = null, bestA = 0.1;
    const consider = (p, target) => {
      const v = { x: p.x - o.x, y: p.y - o.y, z: p.z - o.z }, l = Math.hypot(v.x, v.y, v.z);
      if (l < 0.5 || l > 60) return;
      const a = Math.acos(clamp((v.x * d.x + v.y * d.y + v.z * d.z) / l, -1, 1));
      if (a < bestA && !segmentBlocked(o, p, layout.boxes)) { bestA = a; best = { x: v.x / l, y: v.y / l, z: v.z / l }; }
    };
    for (const e of g.enemies) if (e.alive && e.spawnT <= 0) consider(e.def.flying ? e : { x: e.x, y: e.y + e.def.height * 0.55, z: e.z }, e);
    if (g.boss?.alive) consider(g.boss.eye, g.boss);
    return best || d;
  }

  function fireShot(origin, dirs, weapon, fromEcho) {
    const ends = [], perTarget = new Map();
    let anyHit = false;
    const mult = stats.damageMult * (fromEcho ? ECHO.damage : 1);
    for (const d0 of dirs) {
      const d = fromEcho ? assist(origin, d0) : d0;
      const wall = firstBoxHit(origin, d, layout.rayBoxes, weapon.range);
      const maxT = wall ? wall.t : weapon.range;
      const hits = [];
      for (const e of g.enemies) {
        if (!e.alive || e.spawnT > 0) continue;
        const h = hitEnemy(origin, d, e, maxT);
        if (h) hits.push(h);
      }
      if (g.boss && g.boss.alive && g.boss.state !== 'intro') hits.push(...hitBoss(origin, d, maxT));
      hits.sort((a, b) => a.t - b.t);
      let pierce = weapon.pierce, endT = maxT, kind = wall ? 'wall' : 'none', normal = wall ? wall.normal : null;
      for (const h of hits) {
        if (h.plate) { endT = h.t; kind = 'plate'; normal = null; emit('plateHit', { x: origin.x + d.x * h.t, y: origin.y + d.y * h.t, z: origin.z + d.z * h.t }); break; }
        let dmg = weapon.damage * falloff(weapon, h.t) * mult;
        if (h.weak) dmg *= h.target === g.boss ? BOSS.eyeMult + stats.weakBonus * 0.5 : weapon.weakMult + stats.weakBonus;
        if (h.shielded) dmg *= weapon.id === 'rail' ? h.target.def.shield.railFactor : h.target.def.shield.factor;
        const acc = perTarget.get(h.target) || { dmg: 0, weak: false, shielded: false, point: null };
        acc.dmg += dmg; acc.weak = acc.weak || h.weak; acc.shielded = acc.shielded || !!h.shielded;
        if (!acc.point) acc.point = { x: origin.x + d.x * h.t, y: origin.y + d.y * h.t, z: origin.z + d.z * h.t };
        perTarget.set(h.target, acc);
        anyHit = true;
        if (--pierce <= 0) { endT = h.t; kind = 'enemy'; normal = null; break; }
      }
      ends.push({ x: origin.x + d.x * endT, y: origin.y + d.y * endT, z: origin.z + d.z * endT, kind, normal });
    }
    for (const [target, acc] of perTarget) applyDamage(target, acc, fromEcho, weapon.id);
    if (!fromEcho) { g.record.shots += 1; if (anyHit) g.record.hits += 1; }
    emit('shot', { weapon: weapon.id, origin: { ...origin }, ends, echo: fromEcho, hit: anyHit });
  }

  function applyDamage(target, acc, fromEcho, cause) {
    if (target === g.boss) {
      const r = damageBoss(g.boss, acc.dmg, bossFacade);
      if (r.applied > 0) {
        g.record.damageDealt += r.applied;
        gainEnergy(r.applied * BOSS_ENERGY_PER_DAMAGE);
        emit('hit', { id: g.boss.id, boss: true, damage: r.applied, weak: acc.weak, ...acc.point, echo: fromEcho });
      } else emit('hit', { id: g.boss.id, boss: true, damage: 0, immune: true, ...acc.point, echo: fromEcho });
      if (r.killed) {
        const points = addKill(g.score, BOSS.score, { weak: acc.weak, diffScore: diff.score });
        g.record.kills += 1;
        g.slowT = 1.6;
        emit('kill', { id: g.boss.id, enemy: 'boss', x: g.boss.x, y: g.boss.y, z: g.boss.z, weak: acc.weak, points, echo: fromEcho });
      }
      return;
    }
    const e = target;
    if (!e.alive) return;
    const dealt = Math.min(e.hp, acc.dmg);
    e.hp -= acc.dmg;
    e.flash = 0.09;
    g.record.damageDealt += dealt;
    gainEnergy(dealt * ENERGY_PER_DAMAGE);
    if (isStaggerable(e) && acc.dmg >= e.maxHp * 0.4 && e.hp > 0) {
      e.stagger = 0.32;
      if (e.state !== 'spawn') e.state = { stalker: 'chase', sentinel: 'move', wisp: 'fly' }[e.type];
    }
    emit('hit', { id: e.id, enemy: e.type, damage: acc.dmg, weak: acc.weak, shielded: acc.shielded, kill: e.hp <= 0, ...acc.point, echo: fromEcho });
    if (e.hp <= 0) killEnemy(e, acc.weak, fromEcho, cause);
  }

  function killEnemy(e, weak, fromEcho, cause) {
    if (!e.alive) return;
    e.alive = false;
    e.hp = 0;
    const points = addKill(g.score, e.def.score, { weak, diffScore: diff.score });
    g.record.kills += 1;
    if (weak) g.record.weakKills += 1;
    if (fromEcho) g.record.echoKills += 1;
    gainEnergy(e.def.energy * (fromEcho ? ECHO.killEnergy : 1));
    if (stats.siphon && player.alive) player.hp = Math.min(stats.maxHp, player.hp + stats.siphon);
    emit('kill', { id: e.id, enemy: e.type, x: e.x, y: e.y, z: e.z, weak, points, echo: fromEcho, combo: g.score.combo });
    dropLoot(e);
    if (stats.chain > 0 && cause !== 'chain') {
      const cy = e.y + (e.def.flying ? 0 : e.def.height * 0.5);
      emit('explosion', { kind: 'chain', x: e.x, y: cy, z: e.z, r: 3.5 });
      for (const o of g.enemies) {
        if (!o.alive || o === e || o.spawnT > 0) continue;
        if (Math.hypot(o.x - e.x, o.y - e.y, o.z - e.z) < 3.5) applyDamage(o, { dmg: stats.chain * stats.damageMult, weak: false, point: { x: o.x, y: o.y + 1, z: o.z } }, fromEcho, 'chain');
      }
    }
  }

  function dropLoot(e) {
    const d = e.def.drop, baseY = e.def.flying ? e.y : e.y + 0.2;
    const place = (kind, spread) => {
      const x = clamp(e.x + (rng.next() - 0.5) * spread, -HALF + 1, HALF - 1), z = clamp(e.z + (rng.next() - 0.5) * spread, -HALF + 1, HALF - 1);
      g.pickups.push({ id: nextId(), kind, x, y: groundAt(layout.boxes, x, z, baseY) + 0.55, z, life: PICKUP.life, t: 0 });
    };
    if (rng.next() < d.health * stats.dropMult) place('health', d.count > 1 ? 2.2 : 0.6);
    if (rng.next() < d.ammo * stats.dropMult) place('ammo', d.count > 1 ? 2.2 : 0.6);
  }

  // ---------------------------------------------------------------- echo
  function triggerEcho() {
    if (g.echo || !player.alive || player.energy < ECHO.cost - 1e-6) { emit('echoDenied', { energy: player.energy }); return false; }
    const echo = beginEcho(g.recorder, g.time);
    if (!echo) { emit('echoDenied', { energy: player.energy, reason: 'history' }); return false; }
    const b = player.body, from = { x: b.x, y: b.y, z: b.z }, s = echo.origin;
    player.energy = 0;
    b.x = s.x; b.y = s.y; b.z = s.z; b.vx = 0; b.vy = 0; b.vz = 0; b.grounded = false; b.noGravity = false; b.padLock = 0;
    player.dash.t = 0;
    const lost = s.hp - player.hp;
    if (lost > 0) player.hp = Math.min(stats.maxHp, player.hp + lost * ECHO.heal);
    player.invuln = ECHO.invuln;
    g.echo = echo;
    g.recorder.clear();
    g.record.echoes += 1;
    for (const e of g.enemies) e.targetT = 0;
    emit('echoStart', { from, to: { x: s.x, y: s.y, z: s.z }, healed: Math.max(0, lost) });
    return true;
  }

  function stepEcho(dt) {
    const e = g.echo;
    if (!e) return;
    if (e.state === 'replay') {
      const { shots, finished } = advanceEcho(e, dt);
      for (const s of shots) fireShot(s.origin, s.dirs, WEAPONS.find(w => w.id === s.weapon) || WEAPONS[0], true);
      if (finished) {
        e.state = 'collapse';
        e.collapseT = ECHO.pullTime;
        e.center = { x: e.pose.x, y: e.pose.y, z: e.pose.z };
        const R = ECHO.radius + stats.implodeRadius;
        for (const o of g.enemies) {
          if (o.alive && o.spawnT <= 0 && Math.hypot(o.x - e.center.x, o.z - e.center.z) < R && Math.abs(o.y - e.center.y) < 5) {
            o.pull = { x: e.center.x, y: e.center.y, z: e.center.z, t: ECHO.pullTime };
          }
        }
        emit('echoCollapse', { ...e.center, r: R });
      }
    } else if (e.state === 'collapse') {
      e.collapseT -= dt;
      if (e.collapseT <= 0) {
        const c = e.center, R = ECHO.radius + stats.implodeRadius, base = ECHO.blast * stats.implodeMult * stats.damageMult;
        emit('echoBlast', { x: c.x, y: c.y + 1, z: c.z, r: R });
        for (const o of g.enemies) {
          if (!o.alive || o.spawnT > 0) continue;
          const d = Math.hypot(o.x - c.x, o.y - c.y, o.z - c.z);
          if (d < R) applyDamage(o, { dmg: base * (1 - 0.5 * (d / R)), weak: false, point: { x: o.x, y: o.y + 1, z: o.z } }, true, 'implode');
        }
        if (g.boss?.alive && Math.hypot(g.boss.x - c.x, g.boss.y - c.y, g.boss.z - c.z) < R + BOSS.coreR) {
          applyDamage(g.boss, { dmg: base * 1.5, weak: false, point: { x: g.boss.x, y: g.boss.y, z: g.boss.z } }, true, 'implode');
        }
        g.echo = null;
      }
    }
  }

  // ---------------------------------------------------------------- waves
  function spawnEnemy(type, gate) {
    const def = ENEMY_TYPES[type];
    const pos = { x: gate.spawn.x, z: gate.spawn.z, y: def.flying ? 3.5 : 0, yaw: yawTowards(-gate.spawn.x, -gate.spawn.z) };
    const e = createEnemy(type, nextId(), pos, diff, rng);
    g.enemies.push(e);
    emit('enemySpawn', { id: e.id, enemy: type, x: e.x, y: e.y, z: e.z, gate: gate.id });
    return e;
  }

  function chooseGate() {
    const p = player.body;
    const far = layout.gates.filter(gt => gt.id !== g.lastGate && Math.hypot(gt.spawn.x - p.x, gt.spawn.z - p.z) > 14);
    const pool = far.length ? far : layout.gates;
    const gate = pool[Math.floor(rng.next() * pool.length)];
    g.lastGate = gate.id;
    return gate;
  }

  function startWave(n) {
    g.wave = n;
    g.mode = 'wave';
    g.waveTime = 0;
    g.waveHurt = false;
    g.offers = null;
    if (isBossWave(n)) {
      g.boss = createBoss(nextId(), diff);
      g.spawnQueue = [];
      g.waveQueueLength = 12;
      emit('bossIntro', { hp: g.boss.maxHp });
    } else {
      g.spawnQueue = buildSpawnQueue(rng, n, diff);
      g.waveQueueLength = g.spawnQueue.length;
      g.spawnT = 0.8;
    }
    emit('waveStart', { wave: n, boss: isBossWave(n), count: g.waveQueueLength });
  }

  function waveCleared() {
    const bonus = waveBonus(g.wave, g.waveTime, waveParTime(g.waveQueueLength), !g.waveHurt, diff.score);
    g.score.total += bonus.total;
    g.mode = 'cleared';
    g.modeT = g.wave >= WAVE_COUNT ? 3 : 2.2;
    if (g.slowT <= 0) g.slowT = 0.7;
    emit('waveClear', { wave: g.wave, bonus, final: g.wave >= WAVE_COUNT });
  }

  function offerUpgrades() {
    g.offers = rollOffers(rng, g.owned, 3);
    if (!g.offers.length) { beginIntermission(); return; }
    g.mode = 'upgrade';
    emit('upgradeOffer', { offers: g.offers.slice() });
  }

  function beginIntermission() {
    g.mode = 'intermission';
    g.modeT = INTERMISSION;
    g.offers = null;
    const spots = rng.shuffle(layout.healthSpots).slice(0, 2);
    for (const s of spots) {
      if (!g.pickups.some(p => p.kind === 'health' && Math.hypot(p.x - s.x, p.z - s.z) < 1)) {
        g.pickups.push({ id: nextId(), kind: 'health', x: s.x, y: s.y + 0.55, z: s.z, life: INTERMISSION + 40, t: 0 });
      }
    }
    emit('intermission', { next: g.wave + 1, time: INTERMISSION, boss: isBossWave(g.wave + 1) });
  }

  function chooseUpgrade(id) {
    if (g.mode !== 'upgrade' || !g.offers?.includes(id)) return false;
    const u = applyUpgrade(stats, g.owned, id);
    if (!u) return false;
    if (u.heal) player.hp = Math.min(stats.maxHp, player.hp + u.heal);
    refreshArsenal(g.arsenal, stats);
    if (id === 'extmag') g.arsenal.slots.forEach((s, i) => { s.mag = magSize(WEAPONS[i], stats); });
    if (id === 'dashcell') player.dash.charges = stats.dashCharges;
    emit('upgradeChosen', { id, name: u.cn });
    beginIntermission();
    return true;
  }

  function stepWaves(dt) {
    switch (g.mode) {
      case 'intermission':
        g.modeT -= dt;
        if (g.modeT <= 0) startWave(g.wave + 1);
        break;
      case 'wave': {
        g.waveTime += dt;
        g.spawnT -= dt;
        const alive = g.enemies.reduce((n, e) => n + (e.alive ? 1 : 0), 0) + g.pending.length;
        if (g.spawnQueue.length && g.spawnT <= 0 && alive < maxAlive(g.wave, diff)) {
          const type = g.spawnQueue.shift(), gate = chooseGate();
          g.pending.push({ type, gate, t: GATE_WARNING });
          emit('gateWarn', { gate: gate.id, enemy: type, x: gate.x, z: gate.z });
          g.spawnT = spawnInterval(g.wave, diff, rng);
        }
        if (g.boss && !g.boss.alive) {
          for (const e of g.enemies) if (e.alive) { e.alive = false; emit('kill', { id: e.id, enemy: e.type, x: e.x, y: e.y, z: e.z, points: 0, silent: true }); }
          g.pending.length = 0;
          g.projectiles.length = 0;
          g.beams.length = 0;
          g.shockwaves.length = 0;
          g.boss = null;
          waveCleared();
        } else if (!g.boss && !g.spawnQueue.length && !g.pending.length && !g.enemies.some(e => e.alive)) waveCleared();
        break;
      }
      case 'cleared':
        g.modeT -= dt;
        if (g.modeT <= 0) {
          if (g.wave >= WAVE_COUNT) { g.mode = 'victory'; emit('victory', summary()); }
          else offerUpgrades();
        }
        break;
      default:
        break;
    }
    for (let i = g.pending.length - 1; i >= 0; i--) {
      const s = g.pending[i];
      s.t -= dt;
      if (s.t <= 0) { g.pending.splice(i, 1); spawnEnemy(s.type, s.gate); }
    }
  }

  // ---------------------------------------------------------------- flows / separation
  const FLOW_KEYS = [['small', 'player'], ['large', 'player'], ['small', 'echo'], ['large', 'echo']];
  let flowTurn = 0;
  function updateFlows() {
    const need = { small: { player: false, echo: false }, large: { player: false, echo: false } };
    for (const e of g.enemies) {
      if (!e.alive || e.def.flying) continue;
      need[e.type === 'bulwark' ? 'large' : 'small'][e.target === 'echo' && echoLive() ? 'echo' : 'player'] = true;
    }
    const pb = player.body, q = echoLive() ? g.echo.pose : null;
    // At most one Dijkstra pass per step, round-robin over the fields that are stale. A player cell crossing
    // plus a moving echo used to stack up to four passes into a single step (multi-ms spikes); now a field
    // lags its target by a few milliseconds at most, and close-range steering is direct anyway (pathTo).
    for (let i = 0; i < FLOW_KEYS.length; i++) {
      const k = (flowTurn + i) % FLOW_KEYS.length, [size, who] = FLOW_KEYS[k];
      const at = who === 'player' ? pb : q;
      if (!need[size][who] || !at) continue;
      if (flows[size][who].compute(at.x, at.z)) { flowTurn = (k + 1) % FLOW_KEYS.length; break; }
    }
  }

  function separate() {
    const ground = g.enemies.filter(e => e.alive && e.body && e.spawnT <= 0);
    for (let i = 0; i < ground.length; i++) {
      const a = ground[i];
      for (let j = i + 1; j < ground.length; j++) {
        const b = ground[j], share = a.type === 'bulwark' ? 0.1 : b.type === 'bulwark' ? 0.9 : 0.5;
        separateBodies(a.body, b.body, share);
      }
      if (player.alive) separateBodies(player.body, a.body, a.type === 'bulwark' ? 0.85 : 0.3);
      a.x = a.body.x; a.z = a.body.z;
    }
  }

  // ---------------------------------------------------------------- projectiles / beams / shockwaves
  function explode(x, y, z, r, damage, kind) {
    emit('explosion', { kind, x, y, z, r });
    const pb = player.body;
    const d = Math.hypot(pb.x - x, pb.y + 0.9 - y, pb.z - z);
    if (d < r + PLAYER.radius && !segmentBlocked({ x, y: y + 0.3, z }, { x: pb.x, y: pb.y + 1.0, z: pb.z }, layout.boxes)) {
      hurtPlayer(damage * (1 - 0.5 * clamp(d / r, 0, 1)), { x, z }, kind);
    }
    if (echoLive()) {
      const q = g.echo.pose;
      if (Math.hypot(q.x - x, q.z - z) < r) g.echo.hitFlash = 0.15;
    }
  }

  function stepProjectiles(dt) {
    const pb = player.body, keep = [];
    for (const p of g.projectiles) {
      p.life -= dt;
      if (p.gravity) p.vy -= GRAVITY * dt;
      const a = { x: p.x, y: p.y, z: p.z }, b = { x: p.x + p.vx * dt, y: p.y + p.vy * dt, z: p.z + p.vz * dt };
      const len = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
      let tWall = Infinity, wallHit = null;
      if (len > 1e-9) {
        wallHit = firstBoxHit(a, { x: (b.x - a.x) / len, y: (b.y - a.y) / len, z: (b.z - a.z) / len }, layout.rayBoxes, len);
        if (wallHit) tWall = wallHit.t / len;
      }
      let tP = null, tE = null;
      if (player.alive) tP = segmentHitsCapsule(a, b, pb.x, pb.y, pb.y + PLAYER.height, pb.z, PLAYER.radius, p.r);
      if (echoLive()) { const q = g.echo.pose; tE = segmentHitsCapsule(a, b, q.x, q.y, q.y + PLAYER.height, q.z, PLAYER.radius, p.r); }
      const first = Math.min(tWall, tP ?? Infinity, tE ?? Infinity);
      if (first === Infinity) {
        p.x = b.x; p.y = b.y; p.z = b.z;
        if (p.life > 0 && p.y > -1) keep.push(p);
        continue;
      }
      const hx = a.x + (b.x - a.x) * first, hy = a.y + (b.y - a.y) * first, hz = a.z + (b.z - a.z) * first;
      if (p.kind === 'shell') { explode(hx, hy, hz, p.radius, p.damage, 'mortar'); continue; }
      if (first === tE && tE !== null) {
        g.echo.hitFlash = 0.15;
        emit('projectileHit', { kind: p.kind, x: hx, y: hy, z: hz, target: 'echo' });
      } else if (first === tP && tP !== null) {
        const dealt = hurtPlayer(p.damage, { x: a.x - p.vx, z: a.z - p.vz }, p.kind);
        emit('projectileHit', { kind: p.kind, x: hx, y: hy, z: hz, target: dealt > 0 ? 'player' : 'phase' });
      } else {
        emit('projectileHit', { kind: p.kind, x: hx, y: hy, z: hz, target: 'wall', normal: wallHit?.normal });
      }
    }
    g.projectiles = keep;
  }

  function stepBeams(dt) {
    const boss = g.boss, pb = player.body, keep = [];
    for (const bm of g.beams) {
      if (boss?.alive) bm.from = { ...boss.eye };
      if (!bm.fired) {
        bm.t -= dt;
        if (bm.t > 0.22) {
          const k = 1 - Math.exp(-6 * dt);
          bm.aim.x += (pb.x - bm.aim.x) * k; bm.aim.y += (pb.y + 1.1 - bm.aim.y) * k; bm.aim.z += (pb.z - bm.aim.z) * k;
        }
        if (bm.t <= 0) {
          const d = normalize({ x: bm.aim.x - bm.from.x, y: bm.aim.y - bm.from.y, z: bm.aim.z - bm.from.z });
          const wall = firstBoxHit(bm.from, d, layout.rayBoxes, 90), L = wall ? wall.t : 90;
          bm.end = { x: bm.from.x + d.x * L, y: bm.from.y + d.y * L, z: bm.from.z + d.z * L };
          bm.fired = true;
          const res = segSegDist2(bm.from, bm.end, { x: pb.x, y: pb.y + PLAYER.radius, z: pb.z }, { x: pb.x, y: pb.y + PLAYER.height - PLAYER.radius, z: pb.z });
          const hit = player.alive && res.d2 < (PLAYER.radius + 0.32) ** 2;
          if (hit) hurtPlayer(22 * diff.damage, bm.from, 'beam');
          emit('beamFire', { from: { ...bm.from }, to: { ...bm.end }, hit });
        }
        keep.push(bm);
      } else {
        bm.life -= dt;
        if (bm.life > 0) keep.push(bm);
      }
    }
    g.beams = keep;
  }

  function stepShockwaves(dt) {
    const pb = player.body, keep = [];
    for (const s of g.shockwaves) {
      s.r += s.speed * dt;
      if (!s.hit && player.alive) {
        const d = Math.hypot(pb.x - s.x, pb.z - s.z);
        if (Math.abs(d - s.r) < 0.55 + PLAYER.radius && pb.y <= s.y + s.height && pb.y >= s.y - 0.3) {
          s.hit = true;
          if (hurtPlayer(s.damage, { x: s.x, z: s.z }, 'shockwave') > 0) {
            const k = d > 1e-3 ? 5 / d : 0;
            pb.vx += (pb.x - s.x) * k; pb.vz += (pb.z - s.z) * k; pb.vy = Math.max(pb.vy, 5); pb.grounded = false;
          }
        }
      }
      if (s.r < s.maxR) keep.push(s);
    }
    g.shockwaves = keep;
  }

  function bossContact(dt) {
    const boss = g.boss;
    g.contactCd = Math.max(0, g.contactCd - dt);
    if (!boss?.alive || boss.state === 'intro' || !player.alive) return;
    const pb = player.body;
    const res = segSegDist2({ x: pb.x, y: pb.y, z: pb.z }, { x: pb.x, y: pb.y + PLAYER.height, z: pb.z }, boss, boss);
    const min = BOSS.coreR + PLAYER.radius;
    if (res.d2 < min * min) {
      const dx = pb.x - boss.x, dz = pb.z - boss.z, d = Math.hypot(dx, dz) || 1;
      pb.vx = (dx / d) * 9; pb.vz = (dz / d) * 9; pb.vy = Math.min(pb.vy, 0);
      if (g.contactCd <= 0) { g.contactCd = 0.8; hurtPlayer(10 * diff.damage, boss, 'contact'); }
    }
  }

  // ---------------------------------------------------------------- pickups / stations
  function stepPickups(dt) {
    const pb = player.body, center = { x: pb.x, y: pb.y + 0.9, z: pb.z }, keep = [];
    for (const p of g.pickups) {
      p.t += dt;
      p.life -= dt;
      const useful = p.kind === 'health' ? player.hp < stats.maxHp - 0.5 : !ammoFull(g.arsenal);
      const d = Math.hypot(p.x - center.x, p.y - center.y, p.z - center.z);
      if (useful && player.alive && d < stats.magnet) {
        const k = Math.min(1, (12 * dt) / Math.max(d, 1e-3));
        p.x += (center.x - p.x) * k; p.y += (center.y - p.y) * k; p.z += (center.z - p.z) * k;
      }
      if (useful && player.alive && d < PICKUP.collect) {
        if (p.kind === 'health') {
          const before = player.hp;
          player.hp = Math.min(stats.maxHp, player.hp + PICKUP.health);
          emit('pickup', { kind: 'health', amount: player.hp - before, x: p.x, y: p.y, z: p.z });
        } else {
          const s = addAmmo(g.arsenal, 'scatter', PICKUP.scatter), r = addAmmo(g.arsenal, 'rail', PICKUP.rail);
          emit('pickup', { kind: 'ammo', scatter: s, rail: r, x: p.x, y: p.y, z: p.z });
        }
        continue;
      }
      if (p.life > 0) keep.push(p);
    }
    g.pickups = keep;
    for (const st of g.stations) {
      st.cd = Math.max(0, st.cd - dt);
      if (st.cd > 0 || !player.alive || ammoFull(g.arsenal)) continue;
      if (Math.hypot(pb.x - st.x, pb.z - st.z) < PICKUP.station.radius && pb.y < 1) {
        let total = 0;
        WEAPONS.forEach(w => { if (w.reserve !== Infinity) total += addAmmo(g.arsenal, w.id, Math.ceil(reserveMax(w, stats) * PICKUP.station.refill)); });
        st.cd = PICKUP.station.cooldown;
        emit('ammoStation', { id: st.id, amount: total, x: st.x, z: st.z });
      }
    }
  }

  // ---------------------------------------------------------------- main step
  function summary() {
    const victory = g.mode === 'victory';
    return {
      victory, wave: g.wave, score: g.score.total, time: g.time, kills: g.record.kills, weakKills: g.record.weakKills,
      accuracy: accuracy(g.record), echoes: g.record.echoes, echoKills: g.record.echoKills, maxCombo: g.score.maxCombo,
      damageTaken: Math.round(g.record.damageTaken), damageDealt: Math.round(g.record.damageDealt), difficulty: diff.id,
      rank: rankFor(g.score.total, victory), upgrades: { ...g.owned }, seed,
    };
  }

  function step(rawDt, input = {}) {
    const dt = clamp(Number.isFinite(rawDt) ? rawDt : 0, 0, 0.05);
    if (g.mode === 'victory' || g.mode === 'defeat') return g;
    const sdt = dt * (g.slowT > 0 ? 0.35 : 1);
    g.slowT = Math.max(0, g.slowT - dt);
    g.time += sdt;
    if (g.mode === 'upgrade' && Number.isInteger(input.choose) && g.offers?.[input.choose]) chooseUpgrade(g.offers[input.choose]);
    stepPlayer(player, sdt, input, world, stats, g.time, emit, g.arsenal.ads);
    if (input.echoPressed) triggerEcho();
    const shot = updateArsenal(g.arsenal, sdt, input, { emit, rng, yaw: player.yaw, pitch: player.pitch, moving: player.moving, airborne: !player.body.grounded });
    if (shot) {
      const origin = eyeOf(player);
      g.recorder.shot(g.time, origin, shot.directions, shot.weapon.id);
      fireShot(origin, shot.directions, shot.weapon, false);
    }
    g.recorder.sample(g.time, { x: player.body.x, y: player.body.y, z: player.body.z, yaw: player.yaw, pitch: player.pitch, hp: player.hp, w: g.arsenal.index });
    stepEcho(sdt);
    stepWaves(sdt);
    updateFlows();
    for (const e of g.enemies) if (e.alive) updateEnemy(e, facade, sdt);
    separate();
    if (g.boss) { stepBoss(g.boss, bossFacade, sdt); bossContact(sdt); }
    stepProjectiles(sdt);
    stepBeams(sdt);
    stepShockwaves(sdt);
    stepPickups(sdt);
    stepScore(g.score, sdt);
    if (g.enemies.length > 24) g.enemies = g.enemies.filter(e => e.alive);
    else if (g.enemies.some(e => !e.alive)) g.enemies = g.enemies.filter(e => e.alive);
    return g;
  }

  function drainEvents() { const out = g.events; g.events = []; return out; }

  Object.assign(g, { step, drainEvents, chooseUpgrade, triggerEcho, summary, hurtPlayer, spawnEnemy, startWave, fireShot, flows, navSmall, navLarge });
  return g;
}

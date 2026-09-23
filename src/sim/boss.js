// RESONATOR PRIME — the wave-10 boss. A hovering core above the dais with orbiting shield plates, three
// phases and five telegraphed attacks (rings, lances, summons, spirals, quake rings). Pure rules; the game
// supplies the facade `g` (emit, rng, diff, player, orb, beam, shockwave, summon).
import { dirFromYawPitch, normalize } from './geometry.js';
import { BOSS_HOME, DAIS_HEIGHT } from './layout.js';

export const BOSS = Object.freeze({
  hp: 4200, score: 5000, coreR: 1.7, eyeR: 0.55, eyeMult: 1.6, plateR: 1.1, plateOrbit: 2.35, plateDrop: 1.2,
  yLow: 6.6, introTime: 2.6, shiftTime: 2.0, dieTime: 3.2,
  gap: { 1: 2.2, 2: 1.8, 3: 1.3 },
});

export function createBoss(id, diff) {
  const hp = Math.round(BOSS.hp * diff.bossHp);
  return {
    id, type: 'boss', x: BOSS_HOME.x, y: 22, z: BOSS_HOME.z, hp, maxHp: hp, phase: 1, alive: true, state: 'intro', t: BOSS.introTime,
    spin: 0, spinRate: 0.9, plates: 3, cooldown: 2.5, flash: 0, invuln: true, script: [], last: null, summonCd: 6, hoverY: BOSS_HOME.y,
    attack: null, charge: 0, eye: { x: 0, y: BOSS_HOME.y, z: 1.2 }, yaw: 0,
  };
}

export function platePositions(boss) {
  const out = [];
  for (let i = 0; i < boss.plates; i++) {
    const a = boss.spin + (i * Math.PI * 2) / boss.plates;
    out.push({ x: boss.x + Math.cos(a) * BOSS.plateOrbit, y: boss.y - BOSS.plateDrop, z: boss.z + Math.sin(a) * BOSS.plateOrbit, a });
  }
  return out;
}

const ATTACKS = { 1: ['ring', 'lance', 'ring', 'lance'], 2: ['ring', 'lance', 'spiral', 'summon'], 3: ['ring', 'lance', 'spiral', 'quake', 'summon'] };

function chooseAttack(boss, g) {
  let pool = ATTACKS[boss.phase].filter(a => a !== boss.last);
  if (boss.summonCd > 0) pool = pool.filter(a => a !== 'summon');
  if (!pool.length) pool = ['ring'];
  return g.rng.pick(pool);
}

// Direction from the core to a point on the circle (at chest height) that passes through the player.
function ringDir(boss, g, angle) {
  const p = g.player.body, R = Math.max(6, Math.hypot(p.x - boss.x, p.z - boss.z));
  const tx = boss.x + Math.cos(angle) * R, tz = boss.z + Math.sin(angle) * R, ty = p.y + 1.0;
  return normalize({ x: tx - boss.x, y: ty - boss.y, z: tz - boss.z });
}

function schedule(boss, g, kind) {
  const P = boss.phase, script = [];
  const pAngle = () => { const p = g.player.body; return Math.atan2(p.z - boss.z, p.x - boss.x); };
  if (kind === 'ring') {
    const n = P === 1 ? 16 : P === 2 ? 20 : 24, speed = P === 3 ? 14 : 12, rings = P === 1 ? 1 : 2;
    for (let r = 0; r < rings; r++) {
      script.push({ at: 0.85 + r * 0.55, run: () => {
        const base = pAngle() + (r % 2 ? Math.PI / n : 0) + Math.PI / n / 2;
        for (let i = 0; i < n; i++) g.orb(boss, ringDir(boss, g, base + (i * Math.PI * 2) / n), speed);
        g.emit('bossFire', { kind: 'ring' });
      } });
    }
    boss.charge = 0.85;
  } else if (kind === 'lance') {
    const n = P === 3 ? 5 : 3, tell = P === 3 ? 0.6 : 0.85;
    for (let i = 0; i < n; i++) script.push({ at: i * 0.5, run: () => g.beam(boss, tell) });
    boss.charge = 0.4;
  } else if (kind === 'spiral') {
    const dur = 2.4, step = P === 3 ? 0.07 : 0.09, arms = P === 3 ? 3 : 2, speed = P === 3 ? 11 : 10;
    let a0 = pAngle();
    for (let t = 0.6; t < 0.6 + dur; t += step) {
      script.push({ at: t, run: () => {
        a0 += 2.3 * step;
        for (let k = 0; k < arms; k++) g.orb(boss, ringDir(boss, g, a0 + (k * Math.PI * 2) / arms), speed);
      } });
    }
    script.push({ at: 0.6, run: () => g.emit('bossFire', { kind: 'spiral' }) });
    boss.charge = 0.6;
  } else if (kind === 'summon') {
    script.push({ at: 0.9, run: () => { g.summon(P === 3 ? ['stalker', 'stalker', 'wisp', 'sentinel'] : ['stalker', 'stalker', 'wisp']); g.emit('bossFire', { kind: 'summon' }); } });
    boss.summonCd = 16;
    boss.charge = 0.9;
  } else if (kind === 'quake') {
    script.push({ at: 1.0, run: () => {
      g.shockwave({ x: 0, y: 0, z: 0, r: 5.4, speed: 11, maxR: 34, damage: 24 * g.diff.damage, height: 0.9, source: boss.id, boss: true });
      g.shockwave({ x: 0, y: DAIS_HEIGHT, z: 0, r: 0.6, speed: 6, maxR: 5.2, damage: 24 * g.diff.damage, height: 0.9, source: boss.id, boss: true });
      g.emit('bossFire', { kind: 'quake' });
    } });
    boss.charge = 1.0;
  }
  boss.attack = { kind, t: 0, script, end: Math.max(...script.map(s => s.at)) + 0.3 };
  boss.last = kind;
  g.emit('bossCharge', { kind, time: boss.charge });
}

export function stepBoss(boss, g, dt) {
  boss.flash = Math.max(0, boss.flash - dt);
  boss.charge = Math.max(0, boss.charge - dt);
  boss.spin += boss.spinRate * dt;
  boss.summonCd -= dt;
  const p = g.player.body;
  const toP = normalize({ x: p.x - boss.x, y: p.y + 1.4 - boss.y, z: p.z - boss.z });
  boss.eye = { x: boss.x + toP.x * (BOSS.coreR - 0.3), y: boss.y + toP.y * (BOSS.coreR - 0.3), z: boss.z + toP.z * (BOSS.coreR - 0.3) };
  boss.yaw = Math.atan2(-toP.x, -toP.z);
  const bob = Math.sin(g.time * 1.3) * 0.35;
  if (boss.state === 'intro') {
    boss.t -= dt;
    boss.y = boss.hoverY + (22 - boss.hoverY) * Math.max(0, boss.t / BOSS.introTime) ** 2;
    if (boss.t <= 0) { boss.state = 'fight'; boss.invuln = false; g.emit('bossReady', {}); }
    return;
  }
  if (boss.state === 'dying') {
    boss.t -= dt;
    boss.y -= dt * 1.2;
    boss.spinRate = 4;
    if (boss.t <= 0) { boss.alive = false; boss.state = 'dead'; g.emit('bossDead', { x: boss.x, y: boss.y, z: boss.z }); }
    return;
  }
  const targetY = boss.phase === 3 ? BOSS.yLow : BOSS_HOME.y;
  boss.hoverY += (targetY - boss.hoverY) * (1 - Math.exp(-dt * 0.8));
  boss.y = boss.hoverY + bob;
  if (boss.state === 'shift') {
    boss.t -= dt;
    if (boss.t <= 0) { boss.state = 'fight'; boss.invuln = false; boss.cooldown = 0.8; }
    return;
  }
  if (boss.attack) {
    const a = boss.attack;
    a.t += dt;
    while (a.script.length && a.script[0].at <= a.t) a.script.shift().run();
    if (a.t >= a.end) { boss.attack = null; boss.cooldown = BOSS.gap[boss.phase]; }
    return;
  }
  boss.cooldown -= dt;
  if (boss.cooldown <= 0) schedule(boss, g, chooseAttack(boss, g));
}

// Applies damage; returns {applied, phaseChanged, killed}.
export function damageBoss(boss, amount, g) {
  if (!boss.alive || boss.invuln || boss.state !== 'fight') return { applied: 0 };
  const before = boss.hp;
  boss.hp = Math.max(0, boss.hp - amount);
  boss.flash = 0.1;
  const frac = boss.hp / boss.maxHp;
  if (boss.hp <= 0) {
    boss.state = 'dying'; boss.t = BOSS.dieTime; boss.invuln = true; boss.attack = null;
    g.emit('bossDying', { x: boss.x, y: boss.y, z: boss.z });
    return { applied: before, killed: true };
  }
  const next = frac <= 1 / 3 ? 3 : frac <= 2 / 3 ? 2 : 1;
  if (next > boss.phase) {
    boss.phase = next;
    boss.plates = next === 2 ? 2 : 0;
    boss.spinRate = next === 2 ? 1.3 : 1.8;
    boss.state = 'shift'; boss.t = BOSS.shiftTime; boss.invuln = true; boss.attack = null;
    g.emit('bossPhase', { phase: next, x: boss.x, y: boss.y, z: boss.z });
    g.clearProjectiles?.();
    return { applied: before - boss.hp, phaseChanged: next };
  }
  return { applied: before - boss.hp };
}

export { dirFromYawPitch };

// Enemy definitions and per-type AI. Every enemy exposes x/y/z/yaw for the renderer; ground enemies own a
// physics body, wisps fly kinematically. AI talks to the game only through the small `g` facade
// (pickTarget, targetPoint, los, flowFor, walkable, hurt, fire, lob, shockwave, emit, rng, diff).
import { createBody, stepBody } from './physics.js';
import { yawTowards, turnTowards, circleBoxPush, clamp } from './geometry.js';

const DEG = Math.PI / 180;

export const ENEMY_TYPES = Object.freeze({
  stalker: Object.freeze({
    cn: '潜猎者', hp: 60, speed: 7.0, radius: 0.45, height: 1.4, score: 100, turn: 10, energy: 6,
    drop: { health: 0.14, ammo: 0.12, count: 1 },
    shape: { body: { r: 0.45, y0: 0, y1: 1.35 }, weak: { y: 1.16, fwd: 0.3, r: 0.25 } },
    lunge: { range: 3.4, windup: 0.34, time: 0.3, speed: 15, damage: 14, recover: 0.55, cooldown: 0.6 },
  }),
  sentinel: Object.freeze({
    cn: '哨卫', hp: 90, speed: 3.8, radius: 0.45, height: 2.2, score: 150, turn: 6, energy: 8,
    drop: { health: 0.2, ammo: 0.22, count: 1 },
    shape: { body: { r: 0.45, y0: 0, y1: 2.2 }, weak: { y: 1.98, fwd: 0.3, r: 0.23 } },
    gun: { aim: 0.7, shots: 3, interval: 0.16, speed: 26, damage: 11, cooldown: [1.8, 2.8], minRange: 9, maxRange: 26, lead: 0.45 },
  }),
  wisp: Object.freeze({
    cn: '游魂', hp: 38, speed: 5.5, radius: 0.5, height: 1, score: 120, flying: true, energy: 6,
    drop: { health: 0.1, ammo: 0.12, count: 1 },
    shape: { body: { sphere: 0.55 }, weak: { r: 0.27 } },
    needle: { tell: 0.35, speed: 34, damage: 7, cooldown: [1.4, 2.3], orbit: [8, 13], altitude: [3.2, 6], lead: 0.3 },
  }),
  bulwark: Object.freeze({
    cn: '壁垒', hp: 480, speed: 2.6, radius: 0.9, height: 2.6, score: 500, turn: 1.5, energy: 20,
    drop: { health: 1, ammo: 1, count: 2 },
    shape: { body: { r: 0.9, y0: 0, y1: 2.6 }, weak: { y: 1.75, fwd: -0.78, r: 0.38 } },
    shield: { cos: Math.cos(62 * DEG), factor: 0.12, railFactor: 0.55 },
    slam: { range: 5.2, windup: 0.85, recover: 1.0, radius: 9, speed: 11, damage: 26, cooldown: 2.5 },
    mortar: { windup: 0.6, flight: 1.35, radius: 3.2, damage: 22, cooldown: [4, 5.5], minRange: 9, maxRange: 32 },
  }),
  // REWINDER: a hovering chrono-construct that mirrors the player's mechanic. It keeps its own last three
  // seconds; every `cycle` seconds it snaps back to where it was three seconds ago and regains the HP it lost
  // since. Its past self (the anchor) hangs in the air on a tether: shooting the anchor shatters it (no rewind,
  // stagger + damage), and an echo collapse wipes it too. Otherwise: burst it down inside one window.
  rewinder: Object.freeze({
    cn: '逆时体', hp: 220, speed: 3.4, radius: 0.6, height: 1.2, score: 260, flying: true, energy: 12,
    drop: { health: 0.25, ammo: 0.3, count: 1 },
    shape: { body: { sphere: 0.62 }, weak: { r: 0.26 }, anchor: 0.6 },
    bolt: { tell: 0.5, speed: 17, damage: 9, count: 2, cooldown: [2.2, 3.2], orbit: [10, 15], altitude: [2.4, 4.2], lead: 0.2 },
    rewind: { window: 3, cycle: 5, tell: 0.75, minLag: 1.5, breakDamage: 35, breakStagger: 0.7 },
  }),
});

export const LIGHT_TYPES = ['stalker', 'sentinel', 'wisp', 'rewinder'];

export function createEnemy(type, id, pos, diff, rng) {
  const def = ENEMY_TYPES[type];
  const hp = Math.round(def.hp * diff.hp);
  const e = {
    id, type, def, hp, maxHp: hp, alive: true, spawnT: 0.8, state: 'spawn', t: 0, yaw: pos.yaw ?? 0, flash: 0, stagger: 0,
    target: null, targetT: 0, cooldown: rng.range(0.4, 1.2), slamCd: 0, strafe: rng.chance(0.5) ? 1 : -1, strafeT: rng.range(1.2, 2.6),
    shots: 0, hitDone: false, pull: null, anim: rng.range(0, 10), losT: 0, los: false, tell: 0, x: pos.x, y: pos.y ?? 0, z: pos.z,
    vx: 0, vy: 0, vz: 0, lunge: null,
  };
  if (def.flying) {
    const n = def.needle || def.bolt;
    e.alt = rng.range(n.altitude[0], n.altitude[1]);
    e.y = pos.y ?? e.alt;
    e.orbitA = rng.range(0, Math.PI * 2);
    e.orbitDir = rng.chance(0.5) ? 1 : -1;
    e.orbitR = rng.range(n.orbit[0], n.orbit[1]);
    if (def.rewind) { e.hist = []; e.histAt = -1; e.anchor = null; e.rewindT = def.rewind.cycle; e.rewindTold = false; }
  } else {
    e.body = createBody({ x: pos.x, y: pos.y ?? 0, z: pos.z }, { radius: def.radius, height: def.height, stepHeight: 0.45, usePads: false });
  }
  return e;
}

function syncPos(e) {
  if (!e.body) return;
  e.x = e.body.x; e.y = e.body.y; e.z = e.body.z; e.vx = e.body.vx; e.vy = e.body.vy; e.vz = e.body.vz;
}

// Horizontal velocity control toward (tvx, tvz); bodies keep their momentum while airborne (pads, drops).
function drive(b, tvx, tvz, dt, rate = 10) {
  if (!b.grounded || b.padLock > 0) return;
  const a = 1 - Math.exp(-rate * dt);
  b.vx += (tvx - b.vx) * a;
  b.vz += (tvz - b.vz) * a;
}
const brake = (b, dt) => drive(b, 0, 0, dt, 12);

// Moves along the shared flow field toward a target (direct when the straight line is walkable on one level).
function pathTo(e, g, tgt, speed, dt) {
  const b = e.body;
  let wx = tgt.x, wz = tgt.z;
  if (!(Math.abs(tgt.y - b.y) < 0.5 && g.walkable(e, b.x, b.z, tgt.x, tgt.z, b.y))) {
    const wp = g.flowFor(e).waypoint(b.x, b.z);
    if (wp) { wx = wp.x; wz = wp.z; if (wp.pad) b.usePads = true; }
  }
  const dx = wx - b.x, dz = wz - b.z, d = Math.hypot(dx, dz);
  if (d > 1e-3) drive(b, (dx / d) * speed, (dz / d) * speed, dt);
  return d > 1e-3 ? yawTowards(dx, dz) : e.yaw;
}

function lineOfSight(e, g, from, to, dt) {
  e.losT -= dt;
  if (e.losT <= 0) { e.los = g.los(from, to); e.losT = 0.15 + g.rng.next() * 0.1; }
  return e.los;
}

function stalker(e, g, tgt, dt) {
  const L = e.def.lunge, b = e.body;
  const dx = tgt.x - b.x, dz = tgt.z - b.z, dist = Math.hypot(dx, dz), dy = tgt.y - b.y;
  e.t -= dt;
  e.cooldown = Math.max(0, e.cooldown - dt);
  switch (e.state) {
    case 'chase': {
      const moveYaw = pathTo(e, g, tgt, e.def.speed, dt);
      e.yaw = turnTowards(e.yaw, dist < 6 ? yawTowards(dx, dz) : moveYaw, e.def.turn * dt);
      const see = lineOfSight(e, g, { x: b.x, y: b.y + 1.1, z: b.z }, { x: tgt.x, y: tgt.y + 1, z: tgt.z }, dt);
      if (dist < L.range && Math.abs(dy) < 1.2 && e.cooldown <= 0 && see && b.grounded) {
        e.state = 'windup'; e.t = L.windup; e.tell = L.windup;
        g.emit('enemyTell', { id: e.id, enemy: e.type, kind: 'lunge', x: b.x, y: b.y, z: b.z });
      }
      break;
    }
    case 'windup':
      brake(b, dt);
      e.yaw = turnTowards(e.yaw, yawTowards(dx, dz), 14 * dt);
      if (e.t <= 0) {
        const d = Math.max(0.01, dist);
        e.lunge = { x: dx / d, z: dz / d };
        e.state = 'lunge'; e.t = L.time; e.hitDone = false;
        g.emit('enemyAttack', { id: e.id, enemy: e.type, kind: 'lunge', x: b.x, y: b.y, z: b.z });
      }
      break;
    case 'lunge':
      if (b.grounded) { b.vx = e.lunge.x * L.speed; b.vz = e.lunge.z * L.speed; }
      if (!e.hitDone) {
        const reach = e.def.radius + tgt.r + 0.35;
        if (Math.hypot(tgt.x - b.x, tgt.z - b.z) < reach && tgt.y < b.y + 1.5 && tgt.y + tgt.h > b.y) {
          e.hitDone = true;
          g.hurt(e.target, L.damage * g.diff.damage, e, 'lunge');
        }
      }
      if (e.t <= 0) { e.state = 'recover'; e.t = L.recover; e.cooldown = L.cooldown; }
      break;
    case 'recover':
      brake(b, dt);
      if (e.t <= 0) e.state = 'chase';
      break;
    default:
      e.state = 'chase';
  }
}

function sentinel(e, g, tgt, dt) {
  const G = e.def.gun, b = e.body;
  const eye = { x: b.x, y: b.y + 1.98, z: b.z };
  const aim = { x: tgt.x, y: tgt.y + tgt.chest, z: tgt.z };
  const dx = tgt.x - b.x, dz = tgt.z - b.z, dist = Math.hypot(dx, dz);
  const see = lineOfSight(e, g, eye, aim, dt);
  e.t -= dt;
  e.cooldown -= dt;
  e.strafeT -= dt;
  const face = rate => { e.yaw = turnTowards(e.yaw, yawTowards(dx, dz), rate * dt); };
  switch (e.state) {
    case 'move': {
      if (!see || dist > G.maxRange) {
        const moveYaw = pathTo(e, g, tgt, e.def.speed, dt);
        e.yaw = turnTowards(e.yaw, see ? yawTowards(dx, dz) : moveYaw, e.def.turn * dt);
      } else {
        const ux = dx / Math.max(dist, 0.01), uz = dz / Math.max(dist, 0.01);
        let vx = -uz * e.strafe * e.def.speed * 0.75, vz = ux * e.strafe * e.def.speed * 0.75;
        if (dist < G.minRange) { vx -= ux * e.def.speed; vz -= uz * e.def.speed; }
        if (e.strafeT <= 0 || (b.grounded && Math.hypot(b.vx, b.vz) < 0.4 && e.strafeT < 1.2)) {
          e.strafe *= -1; e.strafeT = g.rng.range(1.3, 2.8);
        }
        drive(b, vx, vz, dt, 6);
        face(e.def.turn);
      }
      if (see && dist <= G.maxRange && e.cooldown <= 0 && b.grounded) {
        e.state = 'aim'; e.t = G.aim; e.tell = G.aim;
        g.emit('enemyTell', { id: e.id, enemy: e.type, kind: 'aim', x: b.x, y: b.y, z: b.z });
      }
      break;
    }
    case 'aim':
      brake(b, dt);
      face(8);
      if (!see) { e.state = 'move'; e.cooldown = 0.4; e.tell = 0; break; }
      if (e.t <= 0) { e.state = 'burst'; e.shots = G.shots; e.t = 0; }
      break;
    case 'burst':
      brake(b, dt);
      face(8);
      if (e.t <= 0) {
        g.fire(e, 'bolt', eye, tgt, { speed: G.speed, damage: G.damage * g.diff.damage, lead: G.lead, spread: 0.018, r: 0.2 });
        e.shots -= 1; e.t = G.interval;
        if (e.shots <= 0) { e.state = 'move'; e.cooldown = g.rng.range(G.cooldown[0], G.cooldown[1]); }
      }
      break;
    default:
      e.state = 'move';
  }
}

function wisp(e, g, tgt, dt) {
  const N = e.def.needle;
  e.strafeT -= dt;
  if (e.strafeT <= 0) {
    e.strafeT = g.rng.range(2, 4);
    if (g.rng.chance(0.35)) e.orbitDir *= -1;
    e.orbitR = g.rng.range(N.orbit[0], N.orbit[1]);
    e.alt = g.rng.range(N.altitude[0], N.altitude[1]);
  }
  e.orbitA += e.orbitDir * (e.def.speed / e.orbitR) * dt;
  const want = { x: tgt.x + Math.cos(e.orbitA) * e.orbitR, y: tgt.y + e.alt + Math.sin(e.anim * 1.7) * 0.4, z: tgt.z + Math.sin(e.orbitA) * e.orbitR };
  const dx = want.x - e.x, dy = want.y - e.y, dz = want.z - e.z, d = Math.hypot(dx, dy, dz);
  const sp = Math.min(e.def.speed * 1.6, d * 2.2), k = d > 1e-3 ? sp / d : 0, a = 1 - Math.exp(-4 * dt);
  e.vx += (dx * k - e.vx) * a; e.vy += (dy * k - e.vy) * a; e.vz += (dz * k - e.vz) * a;
  flyMove(e, g, dt);
  e.yaw = yawTowards(tgt.x - e.x, tgt.z - e.z);
  e.cooldown -= dt;
  const aim = { x: tgt.x, y: tgt.y + tgt.chest, z: tgt.z };
  const see = lineOfSight(e, g, { x: e.x, y: e.y, z: e.z }, aim, dt);
  if (e.state === 'fly' && e.cooldown <= 0 && see) {
    e.state = 'tell'; e.t = N.tell; e.tell = N.tell;
    g.emit('enemyTell', { id: e.id, enemy: e.type, kind: 'needle', x: e.x, y: e.y, z: e.z });
  } else if (e.state === 'tell') {
    e.t -= dt;
    if (e.t <= 0) {
      g.fire(e, 'needle', { x: e.x, y: e.y, z: e.z }, tgt, { speed: N.speed, damage: N.damage * g.diff.damage, lead: N.lead, spread: 0.02, r: 0.14 });
      e.state = 'fly'; e.cooldown = g.rng.range(N.cooldown[0], N.cooldown[1]);
    }
  } else if (e.state !== 'fly' && e.state !== 'tell') e.state = 'fly';
}

function rewinder(e, g, tgt, dt) {
  const B = e.def.bolt;
  e.strafeT -= dt;
  if (e.strafeT <= 0) {
    e.strafeT = g.rng.range(2.5, 4.5);
    if (g.rng.chance(0.4)) e.orbitDir *= -1;
    e.orbitR = g.rng.range(B.orbit[0], B.orbit[1]);
    e.alt = g.rng.range(B.altitude[0], B.altitude[1]);
  }
  e.orbitA += e.orbitDir * (e.def.speed / e.orbitR) * dt;
  const want = { x: tgt.x + Math.cos(e.orbitA) * e.orbitR, y: tgt.y + e.alt + Math.sin(e.anim * 1.3) * 0.3, z: tgt.z + Math.sin(e.orbitA) * e.orbitR };
  const dx = want.x - e.x, dy = want.y - e.y, dz = want.z - e.z, d = Math.hypot(dx, dy, dz);
  const sp = Math.min(e.def.speed * 1.5, d * 1.8), k = d > 1e-3 ? sp / d : 0, a = 1 - Math.exp(-3 * dt);
  e.vx += (dx * k - e.vx) * a; e.vy += (dy * k - e.vy) * a; e.vz += (dz * k - e.vz) * a;
  flyMove(e, g, dt);
  e.yaw = yawTowards(tgt.x - e.x, tgt.z - e.z);
  e.cooldown -= dt;
  const aim = { x: tgt.x, y: tgt.y + tgt.chest, z: tgt.z };
  const see = lineOfSight(e, g, { x: e.x, y: e.y, z: e.z }, aim, dt);
  if (e.state === 'fly' && e.cooldown <= 0 && see) {
    e.state = 'tell'; e.t = B.tell; e.tell = Math.max(e.tell, B.tell);
    g.emit('enemyTell', { id: e.id, enemy: e.type, kind: 'chrono', x: e.x, y: e.y, z: e.z });
  } else if (e.state === 'tell') {
    e.t -= dt;
    if (e.t <= 0) {
      for (let i = 0; i < B.count; i++) g.fire(e, 'chrono', { x: e.x, y: e.y, z: e.z }, tgt, { speed: B.speed, damage: B.damage * g.diff.damage, lead: B.lead, spread: 0.035, r: 0.22 });
      e.state = 'fly'; e.cooldown = g.rng.range(B.cooldown[0], B.cooldown[1]);
    }
  } else if (e.state !== 'fly' && e.state !== 'tell') e.state = 'fly';
}

// The rewinder's own timeline: 10 Hz history of position + HP, the anchor (oldest sample once it is old enough)
// and the periodic snap back. Runs even while staggered: only breaking the anchor (or an echo collapse) stops it.
function stepRewind(e, g, dt) {
  const R = e.def.rewind, now = g.time;
  if (now - e.histAt >= 0.1) { e.hist.push({ t: now, x: e.x, y: e.y, z: e.z, hp: e.hp }); e.histAt = now; }
  while (e.hist.length > 1 && e.hist[1].t <= now - R.window) e.hist.shift();
  const a = e.hist[0];
  e.anchor = a && now - a.t >= R.minLag ? { x: a.x, y: a.y, z: a.z, hp: a.hp } : null;
  e.rewindT -= dt;
  if (e.rewindT <= R.tell && !e.rewindTold && e.anchor) {
    e.rewindTold = true;
    e.tell = Math.max(e.tell, R.tell);
    g.emit('enemyTell', { id: e.id, enemy: e.type, kind: 'rewind', x: e.x, y: e.y, z: e.z });
  }
  if (e.rewindT > 0) return;
  e.rewindT = R.cycle; e.rewindTold = false;
  if (!e.anchor) return;
  const from = { x: e.x, y: e.y, z: e.z }, to = e.anchor, healed = Math.max(0, to.hp - e.hp);
  e.x = to.x; e.y = to.y; e.z = to.z; e.vx = e.vy = e.vz = 0;
  e.hp = Math.max(e.hp, to.hp);
  e.hist = []; e.histAt = -1; e.anchor = null;
  g.emit('rewind', { id: e.id, from, to: { x: to.x, y: to.y, z: to.z }, healed });
}

// Shattering the anchor (shot or echo collapse): no rewind this cycle, history restarts from now.
export function breakAnchor(e, g, cause = 'shot') {
  if (!e.def.rewind || !e.anchor) return false;
  const at = e.anchor;
  e.hist = []; e.histAt = -1; e.anchor = null; e.rewindT = e.def.rewind.cycle; e.rewindTold = false; e.tell = 0;
  if (cause === 'shot') e.stagger = e.def.rewind.breakStagger;
  g.emit('anchorBreak', { id: e.id, x: at.x, y: at.y, z: at.z, cause });
  return true;
}

// The anchor is only a separate target once it hangs clear of the body (otherwise it is hidden inside it).
export function anchorExposed(e) {
  return !!(e.anchor && e.alive && Math.hypot(e.anchor.x - e.x, e.anchor.y - e.y, e.anchor.z - e.z) > 1.3);
}

// Kinematic flight with box push-out; used by wisps and by implosion pulls on flyers.
function flyMove(e, g, dt) {
  e.x += e.vx * dt; e.y += e.vy * dt; e.z += e.vz * dt;
  for (const b of g.boxes) {
    if (e.y > b.maxY + 0.5 || e.y < b.minY - 0.5) continue;
    const push = circleBoxPush(e.x, e.z, 0.5, b);
    if (push) {
      if (b.maxY - e.y < 1.2 && b.kind !== 'wall') e.y = Math.max(e.y, b.maxY + 0.55);
      else { e.x += push.x; e.z += push.z; }
    }
  }
  e.x = clamp(e.x, -g.bounds.x + 0.5, g.bounds.x - 0.5);
  e.z = clamp(e.z, -g.bounds.z + 0.5, g.bounds.z - 0.5);
  e.y = clamp(e.y, 1.6, 12);
}

function bulwark(e, g, tgt, dt) {
  const S = e.def.slam, M = e.def.mortar, b = e.body;
  const dx = tgt.x - b.x, dz = tgt.z - b.z, dist = Math.hypot(dx, dz), dy = tgt.y - b.y;
  e.t -= dt;
  e.cooldown -= dt;
  e.slamCd -= dt;
  const face = () => { e.yaw = turnTowards(e.yaw, yawTowards(dx, dz), e.def.turn * dt); };
  switch (e.state) {
    case 'advance': {
      if (dist > 2.2) pathTo(e, g, tgt, e.def.speed, dt); else brake(b, dt);
      face();
      const see = lineOfSight(e, g, { x: b.x, y: b.y + 2.3, z: b.z }, { x: tgt.x, y: tgt.y + 1, z: tgt.z }, dt);
      if (dist < S.range && Math.abs(dy) < 1.5 && e.slamCd <= 0 && b.grounded) {
        e.state = 'slam'; e.t = S.windup; e.tell = S.windup;
        g.emit('enemyTell', { id: e.id, enemy: e.type, kind: 'slam', x: b.x, y: b.y, z: b.z });
      } else if (dist > M.minRange && dist < M.maxRange && e.cooldown <= 0 && see && b.grounded) {
        e.state = 'mortar'; e.t = M.windup; e.tell = M.windup;
        g.emit('enemyTell', { id: e.id, enemy: e.type, kind: 'mortar', x: b.x, y: b.y, z: b.z });
      }
      break;
    }
    case 'slam':
      brake(b, dt);
      face();
      if (e.t <= 0) {
        g.shockwave({ x: b.x, y: b.y, z: b.z, r: 0.9, speed: S.speed, maxR: S.radius, damage: S.damage * g.diff.damage, height: 0.9, source: e.id });
        g.emit('enemyAttack', { id: e.id, enemy: e.type, kind: 'slam', x: b.x, y: b.y, z: b.z });
        e.state = 'recover'; e.t = S.recover; e.slamCd = S.cooldown;
      }
      break;
    case 'mortar':
      brake(b, dt);
      face();
      if (e.t <= 0) {
        g.lob(e, { x: b.x, y: b.y + 2.7, z: b.z }, tgt, { flight: M.flight, radius: M.radius, damage: M.damage * g.diff.damage });
        g.emit('enemyAttack', { id: e.id, enemy: e.type, kind: 'mortar', x: b.x, y: b.y, z: b.z });
        e.state = 'advance'; e.cooldown = g.rng.range(M.cooldown[0], M.cooldown[1]);
      }
      break;
    case 'recover':
      brake(b, dt);
      if (e.t <= 0) e.state = 'advance';
      break;
    default:
      e.state = 'advance';
  }
}

const INITIAL = { stalker: 'chase', sentinel: 'move', wisp: 'fly', bulwark: 'advance', rewinder: 'fly' };
const THINK = { stalker, sentinel, wisp, bulwark, rewinder };

export function updateEnemy(e, g, dt) {
  e.anim += dt;
  e.flash = Math.max(0, e.flash - dt);
  e.tell = Math.max(0, e.tell - dt);
  if (e.spawnT > 0) {
    e.spawnT -= dt;
    if (e.spawnT <= 0) { e.spawnT = 0; e.state = INITIAL[e.type]; g.emit('enemyReady', { id: e.id, enemy: e.type }); }
    return;
  }
  if (e.pull) {
    // Echo implosion: dragged toward the collapse point, no AI. The collapse also erases a rewinder's anchor.
    if (e.anchor) breakAnchor(e, g, 'echo');
    e.pull.t -= dt;
    const px = e.pull.x - e.x, pz = e.pull.z - e.z, d = Math.hypot(px, pz), sp = d > 0.6 ? Math.min(14, 4 + d * 2.2) : 0;
    if (e.body) {
      e.body.vx = d > 1e-3 ? (px / d) * sp : 0; e.body.vz = d > 1e-3 ? (pz / d) * sp : 0;
      stepBody(e.body, dt, g.world);
      syncPos(e);
    } else {
      const py = e.pull.y + 1 - e.y;
      e.vx = d > 1e-3 ? (px / d) * sp : 0; e.vz = d > 1e-3 ? (pz / d) * sp : 0; e.vy = py * 3;
      flyMove(e, g, dt);
    }
    if (e.pull.t <= 0) e.pull = null;
    return;
  }
  if (e.def.rewind) stepRewind(e, g, dt);
  if (e.stagger > 0) {
    e.stagger -= dt;
    e.tell = 0;
    if (e.body) { brake(e.body, dt); stepBody(e.body, dt, g.world); syncPos(e); }
    else { e.vx *= Math.exp(-5 * dt); e.vz *= Math.exp(-5 * dt); flyMove(e, g, dt); }
    return;
  }
  e.targetT -= dt;
  if (e.targetT <= 0 || !g.targetValid(e.target)) { e.target = g.pickTarget(e); e.targetT = 0.5; }
  const tgt = g.targetPoint(e.target);
  // Enemies only ride a jump pad when their route asks for it (never by falling or lunging onto one).
  if (e.body && e.body.grounded) e.body.usePads = false;
  THINK[e.type](e, g, tgt, dt);
  if (e.body) { stepBody(e.body, dt, g.world); syncPos(e); }
}

// Returns {t, weak} for a ray against the enemy's body/weak point, or null.
export function forwardOf(e) { return { x: -Math.sin(e.yaw), z: -Math.cos(e.yaw) }; }
export function weakCenter(e) {
  const s = e.def.shape;
  if (e.def.flying) return { x: e.x, y: e.y, z: e.z };
  const f = forwardOf(e);
  return { x: e.x + f.x * s.weak.fwd, y: e.y + s.weak.y, z: e.z + f.z * s.weak.fwd };
}
export function isStaggerable(e) { return e.type !== 'bulwark'; }

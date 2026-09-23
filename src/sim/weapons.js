// Weapon data and the arsenal state machine: fire cadence, per-shell / magazine reload, swap lock, ADS
// blend, spread bloom and recoil offsets. Pure: pellet directions are produced here, the game resolves hits.
import { cross, dirFromYawPitch, normalize } from './geometry.js';

export const WEAPONS = Object.freeze([
  Object.freeze({
    id: 'carbine', slot: 1, name: 'PULSE CARBINE', cn: '脉冲步枪', color: '#22e6ff', auto: true, rpm: 660,
    damage: 17, pellets: 1, pierce: 1, range: 90, falloffStart: 24, falloffEnd: 55, minFalloff: 0.6, weakMult: 1.8,
    spreadHip: 0.012, spreadAds: 0.0025, moveSpread: 0.012, airSpread: 0.02, bloomPerShot: 0.0035, bloomMax: 0.026,
    recoilPitch: 0.0055, recoilYaw: 0.0035, mag: 32, reserve: Infinity, reload: 1.35, adsZoom: 1.35, adsTime: 0.13,
    tracer: 'thin',
  }),
  Object.freeze({
    id: 'scatter', slot: 2, name: 'HAILSTORM', cn: '冰雹霰弹', color: '#ff8a1f', auto: false, rpm: 78,
    damage: 12, pellets: 10, pierce: 1, range: 42, falloffStart: 7, falloffEnd: 24, minFalloff: 0.25, weakMult: 1.5,
    spreadHip: 0.078, spreadAds: 0.058, moveSpread: 0.01, airSpread: 0.012, bloomPerShot: 0, bloomMax: 0,
    recoilPitch: 0.045, recoilYaw: 0.012, mag: 6, reserve: 30, reserveMax: 42, reload: 0.44, reloadStart: 0.2,
    perShell: true, adsZoom: 1.12, adsTime: 0.16, tracer: 'pellet',
  }),
  Object.freeze({
    id: 'rail', slot: 3, name: 'RAIL LANCE', cn: '磁轨长矛', color: '#ff2bd6', auto: false, rpm: 66,
    damage: 105, pellets: 1, pierce: 5, range: 220, falloffStart: 1e9, falloffEnd: 1e9, minFalloff: 1, weakMult: 2.0,
    spreadHip: 0.02, spreadAds: 0, moveSpread: 0.02, airSpread: 0.03, bloomPerShot: 0, bloomMax: 0,
    recoilPitch: 0.03, recoilYaw: 0.006, mag: 5, reserve: 20, reserveMax: 30, reload: 2.05, adsZoom: 2.7, adsTime: 0.2,
    tracer: 'beam',
  }),
]);

export const SWAP_TIME = 0.3;

export function falloff(weapon, distance) {
  if (distance <= weapon.falloffStart) return 1;
  if (distance >= weapon.falloffEnd) return weapon.minFalloff;
  const t = (distance - weapon.falloffStart) / (weapon.falloffEnd - weapon.falloffStart);
  return 1 - t * (1 - weapon.minFalloff);
}

export function magSize(weapon, stats) { return Math.max(1, Math.round(weapon.mag * (stats?.magMult ?? 1))); }
export function reserveMax(weapon, stats) { return weapon.reserve === Infinity ? Infinity : Math.round(weapon.reserveMax * (stats?.reserveMult ?? 1)); }

// Scatter uses a fixed, randomly rotated pattern (centre + inner 3 + outer 6) so spread is learnable.
const SCATTER_PATTERN = [[0, 0], ...[0, 1, 2].map(i => [0.42, i * (Math.PI * 2 / 3)]), ...[0, 1, 2, 3, 4, 5].map(i => [0.92, i * (Math.PI / 3) + Math.PI / 6])];

export function pelletDirections(yaw, pitch, spread, count, rng, patterned = false) {
  const f = dirFromYawPitch(yaw, pitch);
  let r = normalize(cross(f, { x: 0, y: 1, z: 0 }));
  if (Math.hypot(r.x, r.y, r.z) < 0.5) r = { x: 1, y: 0, z: 0 };
  const u = cross(r, f), out = [], spin = rng.next() * Math.PI * 2;
  for (let i = 0; i < count; i++) {
    let radius, angle;
    if (patterned && i < SCATTER_PATTERN.length) {
      radius = spread * (SCATTER_PATTERN[i][0] + (rng.next() - 0.5) * 0.14);
      angle = SCATTER_PATTERN[i][1] + spin + (rng.next() - 0.5) * 0.25;
    } else {
      radius = spread * Math.sqrt(rng.next());
      angle = rng.next() * Math.PI * 2;
    }
    const k = Math.tan(radius);
    out.push(normalize({ x: f.x + (r.x * Math.cos(angle) + u.x * Math.sin(angle)) * k, y: f.y + (r.y * Math.cos(angle) + u.y * Math.sin(angle)) * k, z: f.z + (r.z * Math.cos(angle) + u.z * Math.sin(angle)) * k }));
  }
  return out;
}

export function createArsenal(stats) {
  const slots = WEAPONS.map(w => ({ id: w.id, mag: magSize(w, stats), reserve: w.reserve === Infinity ? Infinity : w.reserve }));
  const a = {
    index: 0, slots, cooldown: 0, swap: 0, reloading: false, reloadT: 0, shellPhase: false, ads: 0, bloom: 0,
    aimOffset: { pitch: 0, yaw: 0 }, lastFire: -1, buffered: 0, autoReload: 0, stats,
    get weapon() { return WEAPONS[a.index]; },
    get slot() { return slots[a.index]; },
  };
  return a;
}

export function refreshArsenal(a, stats) {
  a.stats = stats;
  a.slots.forEach((s, i) => {
    const w = WEAPONS[i];
    if (s.reserve !== Infinity) s.reserve = Math.min(s.reserve, reserveMax(w, stats));
    s.mag = Math.min(s.mag, magSize(w, stats));
  });
}

export function canReload(a) {
  const w = a.weapon, s = a.slot;
  return !a.reloading && a.swap <= 0 && s.mag < magSize(w, a.stats) && s.reserve > 0;
}

function startReload(a, emit) {
  const w = a.weapon;
  a.reloading = true;
  a.shellPhase = !!w.perShell;
  a.reloadT = w.perShell ? (w.reloadStart + w.reload) * a.stats.reloadMult : w.reload * a.stats.reloadMult;
  emit('reloadStart', { weapon: w.id, duration: a.reloadT, perShell: !!w.perShell });
}

export function switchWeapon(a, index, emit) {
  if (index === a.index || index < 0 || index >= WEAPONS.length) return false;
  a.index = index;
  a.reloading = false;
  a.swap = SWAP_TIME * (a.stats.swapMult ?? 1);
  a.cooldown = Math.max(a.cooldown, 0);
  a.bloom = 0;
  a.autoReload = 0;
  emit('switch', { weapon: WEAPONS[index].id, index });
  return true;
}

// Advances timers and handles input. Returns a shot descriptor {weapon, directions, spread} or null.
export function updateArsenal(a, dt, input, ctx) {
  const emit = ctx.emit, w = a.weapon, s = a.slot, stats = a.stats;
  a.cooldown = Math.max(-0.05, a.cooldown - dt);
  a.swap = Math.max(0, a.swap - dt);
  a.bloom = Math.max(0, a.bloom - dt * 0.09);
  a.buffered = Math.max(0, a.buffered - dt);
  const recover = Math.exp(-dt * (input.fire && w.auto ? 3.5 : 8));
  a.aimOffset.pitch *= recover;
  a.aimOffset.yaw *= recover;
  if (input.weapon !== null && input.weapon !== undefined) switchWeapon(a, input.weapon, emit);
  else if (input.cycle) switchWeapon(a, (a.index + input.cycle + WEAPONS.length) % WEAPONS.length, emit);
  const wantAds = !!input.ads && a.swap <= 0 && !(a.reloading && !w.perShell);
  const adsRate = dt / (WEAPONS[a.index].adsTime || 0.15);
  a.ads = wantAds ? Math.min(1, a.ads + adsRate) : Math.max(0, a.ads - adsRate * 1.4);
  const cur = a.weapon, slot = a.slot;
  if (input.reload && canReload(a)) startReload(a, emit);
  if (a.autoReload > 0) {
    a.autoReload -= dt;
    if (a.autoReload <= 0 && slot.mag === 0 && canReload(a)) startReload(a, emit);
  }
  if (a.reloading) {
    a.reloadT -= dt;
    if (cur.perShell) {
      while (a.reloading && a.reloadT <= 0) {
        slot.mag += 1;
        if (slot.reserve !== Infinity) slot.reserve -= 1;
        emit('shellIn', { weapon: cur.id, mag: slot.mag });
        if (slot.mag >= magSize(cur, stats) || slot.reserve <= 0) { a.reloading = false; emit('reloadEnd', { weapon: cur.id }); }
        else a.reloadT += cur.reload * stats.reloadMult;
      }
    } else if (a.reloadT <= 0) {
      const need = magSize(cur, stats) - slot.mag, take = Math.min(need, slot.reserve);
      slot.mag += take;
      if (slot.reserve !== Infinity) slot.reserve -= take;
      a.reloading = false;
      emit('reloadEnd', { weapon: cur.id });
    }
  }
  if (input.firePressed) a.buffered = 0.14;
  const wants = cur.auto ? !!input.fire : a.buffered > 0;
  if (!wants || a.swap > 0 || a.cooldown > 0) return null;
  if (slot.mag <= 0) {
    if (input.firePressed && !a.reloading) {
      emit('empty', { weapon: cur.id, reserve: slot.reserve });
      if (canReload(a)) startReload(a, emit);
    }
    a.buffered = 0;
    return null;
  }
  if (a.reloading) {
    if (!cur.perShell) return null;
    a.reloading = false; // shell-by-shell reload is interrupted by firing, keeping the shells already loaded
    emit('reloadEnd', { weapon: cur.id, interrupted: true });
  }
  a.buffered = 0;
  slot.mag -= 1;
  a.cooldown = Math.max(0, a.cooldown) + 60 / cur.rpm;
  const moving = ctx.moving ? cur.moveSpread * (1 - a.ads * 0.7) : 0;
  const air = ctx.airborne ? cur.airSpread : 0;
  const spread = cur.spreadHip + (cur.spreadAds - cur.spreadHip) * a.ads + a.bloom + moving + air;
  const directions = pelletDirections(ctx.yaw + a.aimOffset.yaw, ctx.pitch + a.aimOffset.pitch, spread, cur.pellets, ctx.rng, cur.id === 'scatter');
  a.bloom = Math.min(cur.bloomMax, a.bloom + cur.bloomPerShot);
  const kick = 1 - a.ads * 0.35;
  a.aimOffset.pitch = Math.min(0.16, a.aimOffset.pitch + cur.recoilPitch * kick);
  a.aimOffset.yaw = Math.max(-0.05, Math.min(0.05, a.aimOffset.yaw + (ctx.rng.next() - 0.5) * 2 * cur.recoilYaw));
  if (slot.mag === 0 && slot.reserve > 0 && !cur.perShell) a.autoReload = 0.25;
  return { weapon: cur, directions, spread };
}

export function addAmmo(a, id, amount) {
  const i = WEAPONS.findIndex(w => w.id === id);
  if (i < 0) return 0;
  const w = WEAPONS[i], s = a.slots[i];
  if (s.reserve === Infinity) return 0;
  const before = s.reserve;
  s.reserve = Math.min(reserveMax(w, a.stats), s.reserve + amount);
  return s.reserve - before;
}

export function ammoFull(a) {
  return a.slots.every((s, i) => s.reserve === Infinity || s.reserve >= reserveMax(WEAPONS[i], a.stats));
}

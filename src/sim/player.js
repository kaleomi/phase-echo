// Player controller: acceleration-based ground movement, limited air control, coyote time + jump buffer,
// two-charge dash, jump-pad arcs and low-health regeneration. Look angles come straight from input.
import { createBody, stepBody } from './physics.js';
import { clamp } from './geometry.js';

export const PLAYER = Object.freeze({
  radius: 0.38, height: 1.8, eye: 1.62, speed: 7.4, adsMult: 0.62, groundAccel: 70, airAccel: 18, friction: 12,
  jumpSpeed: 8.4, coyote: 0.12, jumpBuffer: 0.14, dashSpeed: 22, dashTime: 0.17, dashRecharge: 1.8,
  regenDelay: 4, regenRate: 5, regenCap: 0.5, pitchLimit: 1.5,
});

export function createPlayer(spawn, stats) {
  return {
    body: createBody(spawn, { radius: PLAYER.radius, height: PLAYER.height, stepHeight: 0.45 }),
    yaw: spawn.yaw ?? 0, pitch: 0, hp: stats.maxHp, alive: true,
    dash: { charges: stats.dashCharges, recharge: 0, t: 0, dx: 0, dz: 0 },
    energy: 0, coyote: 0, jumpBuffer: 0, invuln: 0, lastHurt: -99, hurtT: 0, moving: false, speed: 0,
  };
}

export const eyeOf = p => ({ x: p.body.x, y: p.body.y + PLAYER.eye, z: p.body.z });

export function stepPlayer(p, dt, input, world, stats, time, emit, adsBlend = 0) {
  const b = p.body, d = p.dash;
  p.yaw = Number.isFinite(input.yaw) ? input.yaw : p.yaw;
  p.pitch = clamp(Number.isFinite(input.pitch) ? input.pitch : p.pitch, -PLAYER.pitchLimit, PLAYER.pitchLimit);
  const fx = -Math.sin(p.yaw), fz = -Math.cos(p.yaw), rx = Math.cos(p.yaw), rz = -Math.sin(p.yaw);
  let mx = input.moveX || 0, mz = input.moveZ || 0;
  const ml = Math.hypot(mx, mz);
  if (ml > 1) { mx /= ml; mz /= ml; }
  const wx = fx * mz + rx * mx, wz = fz * mz + rz * mx, wl = Math.hypot(wx, wz);
  const maxSpeed = PLAYER.speed * stats.speedMult * (1 - (1 - PLAYER.adsMult) * adsBlend);

  p.invuln = Math.max(0, p.invuln - dt);
  p.hurtT = Math.max(0, p.hurtT - dt);
  p.coyote = b.grounded ? PLAYER.coyote : Math.max(0, p.coyote - dt);
  p.jumpBuffer = input.jumpPressed ? PLAYER.jumpBuffer : Math.max(0, p.jumpBuffer - dt);

  if (d.charges < stats.dashCharges) {
    d.recharge += dt;
    const need = PLAYER.dashRecharge * stats.dashRechargeMult;
    if (d.recharge >= need) {
      d.charges += 1;
      d.recharge = d.charges >= stats.dashCharges ? 0 : d.recharge - need;
      emit('dashReady', { charges: d.charges });
    }
  } else { d.charges = stats.dashCharges; d.recharge = 0; }

  if (input.dashPressed && d.charges >= 1 && d.t <= 0) {
    d.dx = wl > 0.01 ? wx / wl : fx; d.dz = wl > 0.01 ? wz / wl : fz;
    d.t = PLAYER.dashTime; d.charges -= 1; b.padLock = 0;
    emit('dash', { x: b.x, y: b.y, z: b.z, dx: d.dx, dz: d.dz });
  }
  if (d.t > 0) {
    d.t -= dt;
    b.vx = d.dx * PLAYER.dashSpeed; b.vz = d.dz * PLAYER.dashSpeed; b.vy = Math.max(b.vy, 0); b.noGravity = true;
    if (d.t <= 0) {
      b.noGravity = false;
      const k = Math.min(1, (maxSpeed * 1.15) / Math.max(1e-6, Math.hypot(b.vx, b.vz)));
      b.vx *= k; b.vz *= k;
    }
  } else if (b.padLock <= 0) {
    if (b.grounded) {
      const tx = wx * maxSpeed, tz = wz * maxSpeed, dvx = tx - b.vx, dvz = tz - b.vz, dl = Math.hypot(dvx, dvz);
      const rate = wl > 0.01 ? PLAYER.groundAccel : PLAYER.friction * maxSpeed;
      const step = Math.min(dl, rate * dt);
      if (dl > 1e-6) { b.vx += (dvx / dl) * step; b.vz += (dvz / dl) * step; }
    } else if (wl > 0.01) {
      const cur = Math.hypot(b.vx, b.vz);
      b.vx += wx * PLAYER.airAccel * dt; b.vz += wz * PLAYER.airAccel * dt;
      const nl = Math.hypot(b.vx, b.vz), cap = Math.max(maxSpeed, cur);
      if (nl > cap) { b.vx *= cap / nl; b.vz *= cap / nl; }
    }
  }
  if (p.jumpBuffer > 0 && p.coyote > 0 && d.t <= 0) {
    b.vy = PLAYER.jumpSpeed; b.grounded = false; p.coyote = 0; p.jumpBuffer = 0;
    emit('jump', { x: b.x, y: b.y, z: b.z });
  }
  stepBody(b, dt, world);
  if (b.launched) emit('jumpPad', { x: b.x, y: b.y, z: b.z });
  if (b.landed && b.landSpeed > 5) emit('land', { speed: b.landSpeed });
  const cap = stats.maxHp * PLAYER.regenCap;
  if (p.alive && time - p.lastHurt > PLAYER.regenDelay && p.hp < cap) p.hp = Math.min(cap, p.hp + PLAYER.regenRate * dt);
  p.speed = Math.hypot(b.vx, b.vz);
  p.moving = p.speed > 1.2;
}

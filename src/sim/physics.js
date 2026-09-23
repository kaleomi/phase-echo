// Shared kinematic body used by the player and every ground enemy: vertical cylinder vs axis-aligned boxes,
// sub-stepped so nothing tunnels, with step-up/step-down for stairs and ballistic jump pads.
import { clamp, circleBoxPush, circleOverlapsBox } from './geometry.js';

export const GRAVITY = 24;
export const SUBSTEP = 1 / 120;
const EPS = 1e-4;

export function createBody(pos, { radius = 0.4, height = 1.8, stepHeight = 0.45, usePads = true } = {}) {
  return {
    x: pos.x, y: pos.y ?? 0, z: pos.z, vx: 0, vy: 0, vz: 0, radius, height, stepHeight, usePads,
    grounded: true, noGravity: false, padCooldown: 0, padLock: 0, landed: false, landSpeed: 0, launched: null,
  };
}

export function supportHeight(boxes, x, z, r, fromY) {
  let top = 0;
  for (const b of boxes) {
    if (b.maxY <= fromY + 0.002 && b.maxY > top && circleOverlapsBox(x, z, r * 0.8, b)) top = b.maxY;
  }
  return top;
}

export function canStand(boxes, x, z, r, y, h) {
  for (const b of boxes) {
    if (b.maxY > y + EPS && b.minY < y + h - EPS && circleOverlapsBox(x, z, r, b)) return false;
  }
  return true;
}

function resolveHorizontal(b, boxes) {
  for (let iter = 0; iter < 4; iter++) {
    let hit = false;
    for (const box of boxes) {
      if (b.y >= box.maxY - EPS || b.y + b.height <= box.minY + EPS) continue;
      const push = circleBoxPush(b.x, b.z, b.radius, box);
      if (!push) continue;
      const rise = box.maxY - b.y;
      if (b.grounded && !b.noGravity && rise <= b.stepHeight + EPS && canStand(boxes, b.x, b.z, b.radius, box.maxY, b.height)) {
        b.y = box.maxY;
        continue;
      }
      b.x += push.x; b.z += push.z;
      const len = Math.hypot(push.x, push.z);
      if (len > 1e-9) {
        const nx = push.x / len, nz = push.z / len, vn = b.vx * nx + b.vz * nz;
        if (vn < 0) { b.vx -= vn * nx; b.vz -= vn * nz; }
      }
      hit = true;
    }
    if (!hit) break;
  }
}

function stepVertical(b, h, boxes) {
  const oldY = b.y;
  if (!b.noGravity) b.vy -= GRAVITY * h;
  let ny = oldY + b.vy * h;
  if (b.vy > 0) {
    for (const box of boxes) {
      if (oldY + b.height <= box.minY + EPS && ny + b.height > box.minY && circleOverlapsBox(b.x, b.z, b.radius * 0.9, box)) {
        ny = box.minY - b.height; b.vy = 0;
      }
    }
    b.grounded = false;
  } else {
    const top = supportHeight(boxes, b.x, b.z, b.radius, oldY);
    if (ny <= top) {
      if (!b.grounded && b.vy < -0.5) { b.landed = true; b.landSpeed = Math.max(b.landSpeed, -b.vy); }
      ny = top; b.vy = 0; b.grounded = true;
    } else if (b.grounded && !b.noGravity && oldY - top <= b.stepHeight + EPS) {
      ny = top; b.vy = 0; // step-down snap keeps bodies glued to stairs instead of hopping down them
    } else {
      b.grounded = false;
    }
  }
  b.y = ny;
}

export function padFlightTime(pad) {
  return (pad.vy + Math.sqrt(Math.max(0, pad.vy * pad.vy - 2 * GRAVITY * pad.landY))) / GRAVITY;
}

export function launchFromPad(b, pad) {
  const T = padFlightTime(pad);
  b.vy = pad.vy;
  if (pad.axis === 'z') { b.vz = (pad.land - b.z) / T; b.vx = 0; } else { b.vx = (pad.land - b.x) / T; b.vz = 0; }
  b.grounded = false; b.padCooldown = 0.5; b.padLock = T * 0.8; b.launched = pad;
}

export function stepBody(b, dt, world) {
  b.landed = false; b.launched = null; b.landSpeed = 0;
  if (dt <= 0) return b;
  const n = Math.max(1, Math.ceil(dt / SUBSTEP - 1e-9)), h = dt / n;
  for (let i = 0; i < n; i++) {
    b.padCooldown = Math.max(0, b.padCooldown - h);
    b.padLock = Math.max(0, b.padLock - h);
    b.x += b.vx * h; b.z += b.vz * h;
    resolveHorizontal(b, world.boxes);
    stepVertical(b, h, world.boxes);
    if (world.pads && b.usePads && b.grounded && b.padCooldown <= 0) {
      for (const pad of world.pads) {
        if (Math.abs(b.y - pad.y) < 0.05 && Math.hypot(b.x - pad.x, b.z - pad.z) < pad.r) { launchFromPad(b, pad); break; }
      }
    }
  }
  if (world.bounds) {
    b.x = clamp(b.x, -world.bounds.x, world.bounds.x);
    b.z = clamp(b.z, -world.bounds.z, world.bounds.z);
  }
  if (b.y < 0) { b.y = 0; if (b.vy < 0) b.vy = 0; b.grounded = true; }
  return b;
}

// Pushes two vertical cylinders apart if they overlap horizontally and vertically. `share` is the fraction
// of the correction applied to `a` (the rest goes to `b`).
export function separateBodies(a, b, share = 0.5) {
  if (a.y >= b.y + b.height || b.y >= a.y + a.height) return false;
  const dx = a.x - b.x, dz = a.z - b.z, d = Math.hypot(dx, dz), min = a.radius + b.radius;
  if (d >= min) return false;
  const nx = d > 1e-6 ? dx / d : 1, nz = d > 1e-6 ? dz / d : 0, push = min - d;
  a.x += nx * push * share; a.z += nz * push * share;
  b.x -= nx * push * (1 - share); b.z -= nz * push * (1 - share);
  return true;
}

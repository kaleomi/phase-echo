// Pure ray / segment / overlap helpers on plain {x,y,z} objects. Shared by hitscan shots, enemy line of
// sight, projectiles and body collision. No Three.js dependency so every rule is testable in Node.
export const EPS = 1e-6;
export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a, b, t) => a + (b - a) * t;
// Frame-rate independent exponential approach of `a` towards `b`.
export const damp = (a, b, rate, dt) => b + (a - b) * Math.exp(-rate * dt);
export const approach = (v, target, step) => (v < target ? Math.min(target, v + step) : Math.max(target, v - step));

export function wrapAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}
// Camera convention (Three.js, rotation order YXZ): yaw 0 looks down -Z, positive yaw turns left,
// positive pitch looks up.
export function dirFromYawPitch(yaw, pitch) {
  const c = Math.cos(pitch);
  return { x: -Math.sin(yaw) * c, y: Math.sin(pitch), z: -Math.cos(yaw) * c };
}
export function yawTowards(dx, dz) { return Math.atan2(-dx, -dz); }
export function pitchTowards(dx, dy, dz) { return Math.atan2(dy, Math.hypot(dx, dz)); }
export function turnTowards(current, target, maxStep) {
  const d = wrapAngle(target - current);
  return Math.abs(d) <= maxStep ? target : wrapAngle(current + Math.sign(d) * maxStep);
}
export function normalize(v) {
  const y = v.y ?? 0, l = Math.hypot(v.x, y, v.z);
  return l < EPS ? { x: 0, y: 0, z: 0 } : { x: v.x / l, y: y / l, z: v.z / l };
}
export function cross(a, b) {
  return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x };
}
export function box(minX, minY, minZ, maxX, maxY, maxZ, extra = {}) {
  return { minX, minY, minZ, maxX, maxY, maxZ, ...extra };
}
export function boxAt(x, z, w, d, h, y = 0, extra = {}) {
  return box(x - w / 2, y, z - d / 2, x + w / 2, y + h, z + d / 2, extra);
}

// Slab test with a normalised direction. Returns {t, normal} of the entry face or null.
export function rayBox(o, d, b, maxT = Infinity) {
  let tmin = 0, tmax = maxT, axis = -1, sign = 0;
  const lo = [b.minX, b.minY, b.minZ], hi = [b.maxX, b.maxY, b.maxZ];
  const oo = [o.x, o.y, o.z], dd = [d.x, d.y, d.z];
  for (let i = 0; i < 3; i++) {
    if (Math.abs(dd[i]) < EPS) {
      if (oo[i] < lo[i] || oo[i] > hi[i]) return null;
      continue;
    }
    const inv = 1 / dd[i];
    let t0 = (lo[i] - oo[i]) * inv, t1 = (hi[i] - oo[i]) * inv, s = -1;
    if (t0 > t1) { const tmp = t0; t0 = t1; t1 = tmp; s = 1; }
    if (t0 > tmin) { tmin = t0; axis = i; sign = s; }
    if (t1 < tmax) tmax = t1;
    if (tmin > tmax) return null;
  }
  const normal = { x: 0, y: 0, z: 0 };
  if (axis === 0) normal.x = sign; else if (axis === 1) normal.y = sign; else if (axis === 2) normal.z = sign;
  return { t: tmin, normal };
}

export function raySphere(o, d, c, r, maxT = Infinity) {
  const ox = o.x - c.x, oy = o.y - c.y, oz = o.z - c.z;
  const b = ox * d.x + oy * d.y + oz * d.z;
  const cc = ox * ox + oy * oy + oz * oz - r * r;
  if (cc > 0 && b > 0) return null;
  const disc = b * b - cc;
  if (disc < 0) return null;
  let t = -b - Math.sqrt(disc);
  if (t < 0) t = 0;
  return t <= maxT ? t : null;
}

// Vertical capsule whose rounded ends span y0..y1 (the caps are included in that span), radius r.
export function rayCapsule(o, d, x, y0, y1, z, r, maxT = Infinity) {
  const a0 = y0 + r, a1 = Math.max(a0, y1 - r);
  let best = null;
  const ox = o.x - x, oz = o.z - z, A = d.x * d.x + d.z * d.z;
  if (A > EPS) {
    const B = ox * d.x + oz * d.z, C = ox * ox + oz * oz - r * r, disc = B * B - A * C;
    if (disc >= 0) {
      let t = (-B - Math.sqrt(disc)) / A;
      if (t < 0 && C < 0) t = 0;
      if (t >= 0 && t <= maxT) {
        const yy = o.y + d.y * t;
        if (yy >= a0 && yy <= a1) best = t;
      }
    }
  }
  const s0 = raySphere(o, d, { x, y: a0, z }, r, maxT), s1 = raySphere(o, d, { x, y: a1, z }, r, maxT);
  if (s0 !== null && (best === null || s0 < best)) best = s0;
  if (s1 !== null && (best === null || s1 < best)) best = s1;
  return best;
}

export function firstBoxHit(o, d, boxes, maxT = Infinity) {
  let best = null;
  for (const b of boxes) {
    const h = rayBox(o, d, b, best ? best.t : maxT);
    if (h && (!best || h.t < best.t)) best = { t: h.t, normal: h.normal, box: b };
  }
  return best;
}

export function segmentBlocked(a, b, boxes) {
  const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z, len = Math.hypot(dx, dy, dz);
  if (len < EPS) return false;
  const d = { x: dx / len, y: dy / len, z: dz / len };
  for (const bx of boxes) {
    const h = rayBox(a, d, bx, len);
    if (h && h.t > EPS) return true;
  }
  return false;
}

// Earliest normalised time in [0,1] at which segment a->b comes within r of c (sweep test), or null.
export function segmentSphere(a, b, c, r) {
  const x = a.x - c.x, y = a.y - c.y, z = a.z - c.z;
  const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
  const cc = x * x + y * y + z * z - r * r;
  if (cc <= 0) return 0;
  const aa = dx * dx + dy * dy + dz * dz;
  if (aa < 1e-12) return null;
  const bb = x * dx + y * dy + z * dz, disc = bb * bb - aa * cc;
  if (disc < 0) return null;
  const t = (-bb - Math.sqrt(disc)) / aa;
  return t >= 0 && t <= 1 ? t : null;
}

export function circleOverlapsBox(x, z, r, b) {
  const cx = clamp(x, b.minX, b.maxX), cz = clamp(z, b.minZ, b.maxZ);
  const dx = x - cx, dz = z - cz;
  return dx * dx + dz * dz < r * r - 1e-9;
}

// Push vector that moves a circle (x,z,r) out of an axis-aligned rectangle, or null if not overlapping.
export function circleBoxPush(x, z, r, b) {
  const cx = clamp(x, b.minX, b.maxX), cz = clamp(z, b.minZ, b.maxZ);
  const dx = x - cx, dz = z - cz, d2 = dx * dx + dz * dz;
  if (d2 >= r * r) return null;
  if (d2 > EPS) {
    const d = Math.sqrt(d2), k = (r - d) / d;
    return { x: dx * k, z: dz * k };
  }
  const left = x - b.minX, right = b.maxX - x, back = z - b.minZ, front = b.maxZ - z;
  const m = Math.min(left, right, back, front);
  if (m === left) return { x: -(left + r), z: 0 };
  if (m === right) return { x: right + r, z: 0 };
  if (m === back) return { x: 0, z: -(back + r) };
  return { x: 0, z: front + r };
}

// Squared distance between segments p1-q1 and p2-q2 (Ericson, Real-Time Collision Detection 5.1.9).
export function segSegDist2(p1, q1, p2, q2) {
  const d1 = { x: q1.x - p1.x, y: q1.y - p1.y, z: q1.z - p1.z }, d2 = { x: q2.x - p2.x, y: q2.y - p2.y, z: q2.z - p2.z };
  const r = { x: p1.x - p2.x, y: p1.y - p2.y, z: p1.z - p2.z };
  const a = d1.x * d1.x + d1.y * d1.y + d1.z * d1.z, e = d2.x * d2.x + d2.y * d2.y + d2.z * d2.z;
  const f = d2.x * r.x + d2.y * r.y + d2.z * r.z;
  let s, t;
  if (a <= EPS && e <= EPS) { s = 0; t = 0; }
  else if (a <= EPS) { s = 0; t = clamp(f / e, 0, 1); }
  else {
    const c = d1.x * r.x + d1.y * r.y + d1.z * r.z;
    if (e <= EPS) { t = 0; s = clamp(-c / a, 0, 1); }
    else {
      const b = d1.x * d2.x + d1.y * d2.y + d1.z * d2.z, denom = a * e - b * b;
      s = denom > EPS ? clamp((b * f - c * e) / denom, 0, 1) : 0;
      t = (b * s + f) / e;
      if (t < 0) { t = 0; s = clamp(-c / a, 0, 1); } else if (t > 1) { t = 1; s = clamp((b - c) / a, 0, 1); }
    }
  }
  const cx = p1.x + d1.x * s - (p2.x + d2.x * t), cy = p1.y + d1.y * s - (p2.y + d2.y * t), cz = p1.z + d1.z * s - (p2.z + d2.z * t);
  return { d2: cx * cx + cy * cy + cz * cz, s, t };
}

// Does segment a->b pass within `r` of a vertical capsule (x, y0..y1, z, radius cr)? Returns s in [0,1] or null.
export function segmentHitsCapsule(a, b, x, y0, y1, z, cr, r = 0) {
  const rad = cr + r, lo = { x, y: y0 + cr, z }, hi = { x, y: Math.max(y0 + cr, y1 - cr), z };
  const res = segSegDist2(a, b, lo, hi);
  return res.d2 <= rad * rad ? res.s : null;
}

export function pointInBox(p, b, pad = 0) {
  return p.x > b.minX - pad && p.x < b.maxX + pad && p.y > b.minY - pad && p.y < b.maxY + pad && p.z > b.minZ - pad && p.z < b.maxZ + pad;
}

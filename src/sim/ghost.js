// Best-run ghost ("最佳残影"): the echo idea stretched across runs. A run is recorded as a compact 10 Hz pose
// track (positions in cm, yaw in centiradians, delta-encoded) plus the game time of every wave clear. The best
// run per mode is kept in localStorage; the next run of that mode replays it as a gold ghost racing you, and
// each wave clear shows the split against it. Pure data: no DOM, no Three.js.
export const GHOST_RATE = 10;
export const GHOST_MAX = 15 * 60 * GHOST_RATE; // 15 minutes of game time
export const GHOST_VERSION = 1;

export function createGhostRecorder() {
  const x = [], y = [], z = [], yaw = [], splits = {};
  let next = 0;
  return {
    get length() { return x.length; },
    // Call every simulation step; stores one sample per 1/GHOST_RATE s of game time.
    sample(t, body, heading) {
      while (t >= next && x.length < GHOST_MAX) {
        x.push(Math.round(body.x * 100)); y.push(Math.round(body.y * 100)); z.push(Math.round(body.z * 100)); yaw.push(Math.round(heading * 100));
        next = x.length / GHOST_RATE;
      }
    },
    split(wave, t) { splits[wave] = Math.round(t * 100) / 100; },
    get splits() { return { ...splits }; },
    serialize(meta = {}) {
      const delta = a => a.map((v, i) => (i ? v - a[i - 1] : v));
      return { v: GHOST_VERSION, rate: GHOST_RATE, n: x.length, x: delta(x), y: delta(y), z: delta(z), yaw: delta(yaw), splits: { ...splits }, ...meta };
    },
  };
}

// Decodes a stored ghost into float tracks. Returns null for anything malformed or from another version.
export function decodeGhost(data) {
  try {
    if (!data || data.v !== GHOST_VERSION || !(data.n > 1)) return null;
    const n = data.n, out = { rate: data.rate || GHOST_RATE, n, x: new Float32Array(n), y: new Float32Array(n), z: new Float32Array(n), yaw: new Float32Array(n), splits: data.splits || {}, meta: data };
    for (const k of ['x', 'y', 'z', 'yaw']) {
      const src = data[k];
      if (!Array.isArray(src) || src.length !== n) return null;
      let acc = 0;
      for (let i = 0; i < n; i++) { acc += src[i]; out[k][i] = acc / 100; }
    }
    return out;
  } catch { return null; }
}

// Interpolated pose at game time t, or null once the recorded run is over.
export function ghostPoseAt(g, t) {
  if (!g || t < 0) return null;
  const k = t * g.rate, i = Math.floor(k);
  if (i >= g.n - 1) return null;
  const f = k - i;
  let dy = g.yaw[i + 1] - g.yaw[i];
  while (dy > Math.PI) dy -= Math.PI * 2;
  while (dy < -Math.PI) dy += Math.PI * 2;
  return { x: g.x[i] + (g.x[i + 1] - g.x[i]) * f, y: g.y[i] + (g.y[i + 1] - g.y[i]) * f, z: g.z[i] + (g.z[i + 1] - g.z[i]) * f, yaw: g.yaw[i] + dy * f };
}

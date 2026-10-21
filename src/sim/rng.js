// Derives an independent seed for a named sub-stream (e.g. stream 1 = wave n's spawns). Streams that the
// player's actions never touch keep the daily challenge identical for everyone: the shared game rng is also
// drawn by shot spread, drops and AI jitter, so its sequence diverges as soon as two players act differently.
export function streamSeed(seed, stream, index = 0) {
  let h = (seed >>> 0) ^ Math.imul(stream + 1, 0x9e3779b1) ^ Math.imul(index + 1, 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d);
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b);
  return (h ^ (h >>> 16)) >>> 0;
}

// Deterministic PRNG (mulberry32). Waves, spread patterns and AI timings draw from it so the
// headless simulation tests are reproducible for a given seed.
export function createRng(seed = 1) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    range: (min, max) => min + (max - min) * next(),
    int: (min, max) => Math.floor(min + (max - min + 1) * next()),
    pick: list => list[Math.floor(next() * list.length)],
    chance: p => next() < p,
    shuffle(list) {
      const out = list.slice();
      for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        [out[i], out[j]] = [out[j], out[i]];
      }
      return out;
    },
  };
}

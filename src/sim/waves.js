// Difficulty presets, the ten-wave campaign table and spawn scheduling helpers.
export const DIFFICULTY = Object.freeze({
  normal: Object.freeze({ id: 'normal', cn: '标准', hp: 1, damage: 1, count: 1, spawnRate: 1, bossHp: 1, score: 1 }),
  hard: Object.freeze({ id: 'hard', cn: '困难', hp: 1.25, damage: 1.3, count: 1.2, spawnRate: 1.15, bossHp: 1.3, score: 1.5 }),
  nightmare: Object.freeze({ id: 'nightmare', cn: '噩梦', hp: 1.5, damage: 1.65, count: 1.4, spawnRate: 1.3, bossHp: 1.6, score: 2.2 }),
});

// Rewinders (time-anchored flyers) arrive from wave 4 and take a couple of wisp slots in the later waves.
export const WAVES = Object.freeze([
  { stalker: 4, wisp: 2 },
  { stalker: 6, wisp: 3 },
  { stalker: 4, sentinel: 3, wisp: 2 },
  { stalker: 6, sentinel: 3, wisp: 3, rewinder: 1 },
  { bulwark: 1, stalker: 5, wisp: 3 },
  { stalker: 8, sentinel: 4, wisp: 3, rewinder: 1 },
  { bulwark: 2, stalker: 6, sentinel: 3, wisp: 2, rewinder: 1 },
  { stalker: 10, sentinel: 5, wisp: 3, rewinder: 2 },
  { bulwark: 3, stalker: 6, sentinel: 4, wisp: 4, rewinder: 2 },
  { boss: 1 },
].map(w => Object.freeze(w)));

export const WAVE_COUNT = WAVES.length;
export const isBossWave = wave => !!WAVES[wave - 1]?.boss;

export function buildSpawnQueue(rng, wave, diff = DIFFICULTY.normal) {
  const comp = WAVES[wave - 1];
  if (!comp || comp.boss) return [];
  const light = [], heavy = [];
  // Mutators can add extra units to every wave from the second one on (e.g. CHRONO TIDE: +2 rewinders).
  const extra = wave >= 2 && diff.extra ? diff.extra : {};
  for (const [type, n] of Object.entries(extra)) for (let i = 0; i < n; i++) (type === 'bulwark' ? heavy : light).push(type);
  for (const [type, n] of Object.entries(comp)) {
    const count = Math.max(1, Math.round(n * diff.count));
    for (let i = 0; i < count; i++) (type === 'bulwark' ? heavy : light).push(type);
  }
  const queue = rng.shuffle(light);
  // Heavies are spread evenly through the back two thirds so the opening of each wave stays readable.
  heavy.forEach((type, i) => {
    const at = Math.min(queue.length, Math.floor(queue.length * (0.33 + (0.6 * (i + 1)) / (heavy.length + 1))));
    queue.splice(at, 0, type);
  });
  return queue;
}

export const maxAlive = (wave, diff = DIFFICULTY.normal) => Math.min(16, Math.round((5 + wave) * diff.count));
export const spawnInterval = (wave, diff, rng) => Math.max(0.55, (1.55 - wave * 0.07) / diff.spawnRate) * rng.range(0.8, 1.2);
export const waveParTime = queueLength => 18 + queueLength * 3.2;
export const INTERMISSION = 6;
export const FIRST_DELAY = 4;
export const GATE_WARNING = 1.1;

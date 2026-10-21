// Daily challenge: every UTC day gets one fixed seed (same waves, same upgrade offers for the same choices -
// waves and offers draw from their own seeded streams, see rng.streamSeed)
// and one mutator that bends the rules. Mutators rotate by day number so a week shows every one of them.
import { DIFFICULTY } from './waves.js';

export const MUTATORS = Object.freeze([
  { id: 'storm', cn: '相位风暴', en: 'PHASE STORM', desc: '相位能量获取 ×2，残影坍缩伤害 +50%', stats: s => { s.phaseGain *= 2; s.implodeMult += 0.5; } },
  { id: 'glass', cn: '玻璃大炮', en: 'GLASS CANNON', desc: '你的伤害 +50%，生命上限降为 60', stats: s => { s.damageMult += 0.5; s.maxHp = 60; } },
  { id: 'chrono', cn: '逆时潮汐', en: 'CHRONO TIDE', desc: '从第 2 波起每波额外出现 2 个逆时体，得分 ×1.2', diff: d => ({ score: d.score * 1.2, extra: { rewinder: 2 } }) },
  { id: 'arsenal', cn: '军火库', en: 'ARSENAL', desc: '弹匣 +50%，备弹上限 ×2，掉落率 +50%', stats: s => { s.magMult += 0.5; s.reserveMult += 1; s.dropMult *= 1.5; } },
  { id: 'elite', cn: '精英潮', en: 'ELITE TIDE', desc: '敌人（含首领）生命 +35%，得分 ×1.4', diff: d => ({ hp: d.hp * 1.35, bossHp: d.bossHp * 1.35, score: d.score * 1.4 }) },
  { id: 'tailwind', cn: '疾风', en: 'TAILWIND', desc: '移动速度 +20%，冲刺 +1 次且充能更快', stats: s => { s.speedMult += 0.2; s.dashCharges += 1; s.dashRechargeMult *= 0.75; } },
].map(m => Object.freeze(m)));

export const getMutator = id => MUTATORS.find(m => m.id === id) || null;

// 'YYYY-MM-DD' of the UTC day (everyone on Earth shares the same daily at the same moment).
export const dailyKey = (date = new Date()) => date.toISOString().slice(0, 10);

// FNV-1a over the key: a stable 32-bit seed per day.
export function dailySeed(key) {
  let h = 0x811c9dc5;
  for (const ch of `phase-echo:${key}`) { h ^= ch.charCodeAt(0); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}

export function dailyMutator(key) {
  const day = Math.floor(Date.parse(`${key}T00:00:00Z`) / 86400000);
  return MUTATORS[((day % MUTATORS.length) + MUTATORS.length) % MUTATORS.length];
}

export function dailySetup(date = new Date()) {
  const key = dailyKey(date);
  return { key, seed: dailySeed(key), mutator: dailyMutator(key), difficulty: 'normal' };
}

// Applies a mutator: returns the (possibly modified) difficulty and edits `stats` in place.
export function applyMutator(mutator, stats, diff = DIFFICULTY.normal) {
  if (!mutator) return diff;
  mutator.stats?.(stats);
  return mutator.diff ? Object.freeze({ ...diff, ...mutator.diff(diff) }) : diff;
}

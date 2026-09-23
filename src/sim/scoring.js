// Score, combo multiplier and wave bonuses.
export const COMBO_WINDOW = 4;
export const MAX_MULTIPLIER = 3;

export function createScore() { return { total: 0, combo: 0, comboT: 0, multiplier: 1, maxCombo: 0 }; }

export function multiplierFor(combo) { return Math.min(MAX_MULTIPLIER, 1 + 0.1 * Math.max(0, combo - 1)); }

export function addKill(sc, base, { weak = false, diffScore = 1 } = {}) {
  sc.combo += 1;
  sc.comboT = COMBO_WINDOW;
  sc.maxCombo = Math.max(sc.maxCombo, sc.combo);
  sc.multiplier = multiplierFor(sc.combo);
  const points = Math.round(base * (weak ? 1.5 : 1) * sc.multiplier * diffScore);
  sc.total += points;
  return points;
}

export function stepScore(sc, dt) {
  if (sc.comboT <= 0) return;
  sc.comboT -= dt;
  if (sc.comboT <= 0) { sc.comboT = 0; sc.combo = 0; sc.multiplier = 1; }
}

export function waveBonus(wave, elapsed, par, flawless, diffScore = 1) {
  const base = 400 * wave, time = Math.max(0, Math.round((par - elapsed) * 15)), clean = flawless ? 1000 : 0;
  return { base, time, flawless: clean, total: Math.round((base + time + clean) * diffScore) };
}

export function accuracy(record) { return record.shots > 0 ? record.hits / record.shots : 0; }

export function rankFor(score, victory) {
  if (victory && score >= 90000) return 'S';
  if (victory && score >= 55000) return 'A';
  if (score >= 30000) return 'B';
  if (score >= 12000) return 'C';
  return 'D';
}

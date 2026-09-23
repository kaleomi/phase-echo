// Roguelite modules offered between waves: pick one of three. Stats are a flat object read by every system.
export function baseStats() {
  return {
    damageMult: 1, reloadMult: 1, swapMult: 1, magMult: 1, reserveMult: 1, maxHp: 100, siphon: 0,
    dashCharges: 2, dashRechargeMult: 1, phaseGain: 1, implodeMult: 1, implodeRadius: 0, weakBonus: 0,
    chain: 0, dropMult: 1, magnet: 3.2, speedMult: 1,
  };
}

export const UPGRADES = Object.freeze([
  { id: 'overcharge', icon: '✦', cn: '高能弹芯', en: 'OVERCHARGE', desc: '所有武器伤害 +15%', max: 3, apply: s => { s.damageMult += 0.15; } },
  { id: 'quickhands', icon: '⟳', cn: '快速装填', en: 'QUICK HANDS', desc: '换弹时间 -25%，切枪速度 +20%', max: 2, apply: s => { s.reloadMult *= 0.75; s.swapMult *= 0.8; } },
  { id: 'extmag', icon: '▤', cn: '扩容弹匣', en: 'EXTENDED MAGS', desc: '弹匣容量 +40%，备弹上限 +30%', max: 2, apply: s => { s.magMult += 0.4; s.reserveMult += 0.3; } },
  { id: 'plating', icon: '⬢', cn: '纳米装甲', en: 'NANO PLATING', desc: '生命上限 +25，并立即回复 25 点', max: 3, apply: s => { s.maxHp += 25; }, heal: 25 },
  { id: 'siphon', icon: '♥', cn: '汲能回路', en: 'SIPHON', desc: '每次击杀回复 5 点生命', max: 2, apply: s => { s.siphon += 5; } },
  { id: 'dashcell', icon: '»', cn: '冲刺电池', en: 'DASH CELL', desc: '冲刺次数 +1，充能速度 +20%', max: 1, apply: s => { s.dashCharges += 1; s.dashRechargeMult *= 0.8; } },
  { id: 'resonance', icon: '◎', cn: '相位共振', en: 'RESONANCE', desc: '相位能量获取 +40%', max: 2, apply: s => { s.phaseGain += 0.4; } },
  { id: 'overload', icon: '✺', cn: '残影过载', en: 'ECHO OVERLOAD', desc: '残影坍缩伤害 +50%，半径 +1.5 米', max: 2, apply: s => { s.implodeMult += 0.5; s.implodeRadius += 1.5; } },
  { id: 'deadeye', icon: '⌖', cn: '弱点专精', en: 'DEADEYE', desc: '弱点伤害倍率 +0.5', max: 2, apply: s => { s.weakBonus += 0.5; } },
  { id: 'chain', icon: '⚡', cn: '连锁反应', en: 'CHAIN REACTION', desc: '被你击杀的敌人会爆炸，对 3.5 米内敌人造成 35 伤害', max: 1, apply: s => { s.chain = 35; } },
  { id: 'scavenger', icon: '⊕', cn: '拾荒协议', en: 'SCAVENGER', desc: '掉落概率 +50%，拾取吸附范围翻倍', max: 1, apply: s => { s.dropMult *= 1.5; s.magnet *= 2; } },
  { id: 'fleet', icon: '➶', cn: '疾风步', en: 'FLEET FOOT', desc: '移动速度 +10%', max: 2, apply: s => { s.speedMult += 0.1; } },
].map(u => Object.freeze(u)));

export const getUpgrade = id => UPGRADES.find(u => u.id === id) || null;

export function rollOffers(rng, owned = {}, count = 3) {
  const pool = UPGRADES.filter(u => (owned[u.id] || 0) < u.max);
  return rng.shuffle(pool).slice(0, count).map(u => u.id);
}

export function applyUpgrade(stats, owned, id) {
  const u = getUpgrade(id);
  if (!u || (owned[id] || 0) >= u.max) return null;
  u.apply(stats);
  owned[id] = (owned[id] || 0) + 1;
  return u;
}

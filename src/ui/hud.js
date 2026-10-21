// DOM HUD: health/energy/dash, ammo, crosshair with dynamic spread, hitmarkers, damage direction arcs,
// floating damage numbers, kill feed, wave banner, boss bar, echo timeline and toasts.
import { WEAPONS, magSize } from '../sim/weapons.js';
import { ENEMY_TYPES } from '../sim/enemies.js';
import { ECHO } from '../sim/echo.js';
import { WAVE_COUNT } from '../sim/waves.js';

const $ = id => document.getElementById(id);
const NAMES = { stalker: '潜猎者', sentinel: '哨卫', wisp: '游魂', bulwark: '壁垒', boss: 'RESONATOR PRIME' };

export function createHud(camera) {
  const el = {
    root: $('hud'), hp: $('hp-fill'), hpText: $('hp-text'), hpGhost: $('hp-ghost'), energy: $('echo-fill'), energyText: $('echo-text'), echoBox: $('echo-box'),
    dash: $('dash-pips'), ammo: $('ammo-mag'), reserve: $('ammo-reserve'), weaponName: $('weapon-name'), weaponSlots: $('weapon-slots'),
    cross: $('crosshair'), hit: $('hitmarker'), dmgLayer: $('damage-layer'), indicators: $('indicators'), feed: $('killfeed'),
    wave: $('wave-label'), enemies: $('enemy-count'), score: $('score'), combo: $('combo'), banner: $('banner'), bannerTitle: $('banner-title'), bannerSub: $('banner-sub'),
    boss: $('boss-bar'), bossFill: $('boss-fill'), bossGhost: $('boss-ghost'), bossPhase: $('boss-phase'), toast: $('toast'), vignette: $('vignette'), echoTint: $('echo-tint'),
    timeline: $('echo-timeline'), timelineFill: $('echo-timeline-fill'), timelineLabel: document.querySelector('#echo-timeline span'), reload: $('reload-ring'), reloadFill: $('reload-fill'), scope: $('scope'), lowHp: $('lowhp'), intermission: $('intermission'),
  };
  let hitT = 0, hpGhost = 100, bossGhost = 1, toastT = 0, bannerT = 0, lastWeapon = -1, lastSlots = '', lastDash = '';
  const numbers = [];
  // Weapon slot cards.
  el.weaponSlots.innerHTML = WEAPONS.map((w, i) => `<div class="slot" data-i="${i}" style="--c:${w.color}"><b>${i + 1}</b><span>${w.cn}</span><em></em></div>`).join('');
  const slotEls = [...el.weaponSlots.children];

  function banner(title, sub, time = 2.2, cls = '') {
    el.bannerTitle.textContent = title;
    el.bannerSub.textContent = sub || '';
    el.banner.className = `show ${cls}`;
    bannerT = time;
  }
  function toast(text, time = 1.6, cls = '') {
    el.toast.textContent = text;
    el.toast.className = `show ${cls}`;
    toastT = time;
  }

  function update(game, dt, fxState) {
    const p = game.player, a = game.arsenal, w = a.weapon, s = a.slot, st = game.stats;
    const hpFrac = Math.max(0, p.hp / st.maxHp);
    hpGhost += (hpFrac * 100 - hpGhost) * Math.min(1, dt * (hpGhost > hpFrac * 100 ? 2.2 : 10));
    el.hp.style.width = `${hpFrac * 100}%`;
    el.hpGhost.style.width = `${hpGhost}%`;
    el.hp.classList.toggle('low', hpFrac < 0.3);
    el.hpText.textContent = `${Math.ceil(p.hp)}`;
    const ef = Math.min(1, p.energy / ECHO.cost);
    el.energy.style.width = `${ef * 100}%`;
    const canSwap = game.echo?.state === 'replay' && !game.echo.swapped && game.echo.clock - game.echo.start >= ECHO.swapMin;
    el.energyText.textContent = game.echo ? (canSwap ? '[Q] 换位' : 'ECHO ACTIVE') : ef >= 1 ? 'READY  [Q]' : `${Math.floor(ef * 100)}%`;
    el.echoBox.classList.toggle('swap', canSwap);
    el.root.classList.toggle('surge', game.surgeT > 0);
    el.echoBox.classList.toggle('ready', ef >= 1 && !game.echo);
    const dashKey = `${p.dash.charges}/${st.dashCharges}/${Math.round(p.dash.recharge * 10)}`;
    if (dashKey !== lastDash) {
      lastDash = dashKey;
      let html = '';
      for (let i = 0; i < st.dashCharges; i++) {
        const fill = i < p.dash.charges ? 1 : i === p.dash.charges ? p.dash.recharge / (1.8 * st.dashRechargeMult) : 0;
        html += `<i style="--f:${fill.toFixed(2)}" class="${fill >= 1 ? 'full' : ''}"></i>`;
      }
      el.dash.innerHTML = html;
    }
    el.ammo.textContent = s.mag;
    el.ammo.classList.toggle('empty', s.mag === 0);
    el.ammo.classList.toggle('low', s.mag > 0 && s.mag <= Math.ceil(magSize(w, st) * 0.25));
    el.reserve.textContent = s.reserve === Infinity ? '∞' : s.reserve;
    if (a.index !== lastWeapon) { lastWeapon = a.index; el.weaponName.textContent = `${w.name} · ${w.cn}`; el.root.style.setProperty('--wc', w.color); }
    const slotsKey = a.slots.map(x => `${x.mag}/${x.reserve}`).join('|') + a.index;
    if (slotsKey !== lastSlots) {
      lastSlots = slotsKey;
      slotEls.forEach((e, i) => {
        e.classList.toggle('active', i === a.index);
        const sl = a.slots[i];
        e.querySelector('em').textContent = `${sl.mag}${sl.reserve === Infinity ? '' : ' / ' + sl.reserve}`;
        e.classList.toggle('dry', sl.mag + (sl.reserve === Infinity ? 1 : sl.reserve) === 0);
      });
    }
    // Reload ring.
    if (a.reloading) {
      const total = w.perShell ? (w.reload * st.reloadMult) : w.reload * st.reloadMult;
      el.reload.classList.add('show');
      el.reloadFill.style.strokeDashoffset = `${113 * Math.max(0, Math.min(1, a.reloadT / total))}`;
    } else el.reload.classList.remove('show');
    // Crosshair spread.
    const spreadRad = w.spreadHip + (w.spreadAds - w.spreadHip) * a.ads + a.bloom + (p.moving ? w.moveSpread * (1 - a.ads * 0.7) : 0) + (!p.body.grounded ? w.airSpread : 0);
    const px = Math.tan(spreadRad) / Math.tan((camera.fov * Math.PI) / 360) * (window.innerHeight / 2);
    el.cross.style.setProperty('--gap', `${Math.max(4, Math.min(80, px))}px`);
    el.cross.classList.toggle('ads', a.ads > 0.6);
    el.cross.dataset.weapon = w.id;
    el.scope.classList.toggle('show', a.index === 2 && a.ads > 0.92);
    hitT = Math.max(0, hitT - dt);
    el.hit.style.opacity = hitT > 0 ? Math.min(1, hitT * 6) : 0;
    // Score / combo / wave.
    el.score.textContent = game.score.total.toLocaleString('en-US');
    if (game.score.combo > 1) {
      el.combo.textContent = `x${game.score.multiplier.toFixed(1)}  ·  ${game.score.combo} COMBO`;
      el.combo.classList.add('show');
      el.combo.style.setProperty('--t', (game.score.comboT / 4).toFixed(2));
    } else el.combo.classList.remove('show');
    const alive = game.enemies.filter(e => e.alive).length + game.pending.length + game.spawnQueue.length;
    el.wave.textContent = game.wave > 0 ? `WAVE ${game.wave}/${WAVE_COUNT}` : 'STANDBY';
    el.enemies.textContent = game.mode === 'wave' && !game.boss ? `敌人 ${alive}` : game.boss ? 'BOSS' : '';
    if (game.mode === 'intermission') {
      el.intermission.classList.add('show');
      el.intermission.textContent = `下一波 ${Math.max(0, game.modeT).toFixed(1)}s`;
    } else el.intermission.classList.remove('show');
    // Boss bar.
    if (game.boss && game.boss.state !== 'intro') {
      const f = game.boss.hp / game.boss.maxHp;
      bossGhost += (f - bossGhost) * Math.min(1, dt * 2);
      el.boss.classList.add('show');
      el.bossFill.style.width = `${f * 100}%`;
      el.bossGhost.style.width = `${bossGhost * 100}%`;
      el.bossPhase.textContent = `PHASE ${['I', 'II', 'III'][game.boss.phase - 1]}${game.boss.invuln ? ' · 屏障' : ''}`;
      el.boss.classList.toggle('shield', !!game.boss.invuln);
    } else { el.boss.classList.remove('show'); bossGhost = 1; }
    // Echo timeline.
    if (game.echo && game.echo.state === 'replay') {
      el.timeline.classList.add('show');
      el.timelineFill.style.width = `${(1 - (game.echo.end - game.echo.clock) / Math.max(0.1, game.echo.end - game.echo.start)) * 100}%`;
      el.timelineLabel.textContent = canSwap ? 'ECHO REPLAY · [Q] 相位换位' : 'ECHO REPLAY';
    } else el.timeline.classList.remove('show');
    el.vignette.style.opacity = Math.min(1, fxState.hurtFx * 0.9 + (hpFrac < 0.3 ? 0.35 + 0.15 * Math.sin(performance.now() / 150) : 0));
    el.echoTint.style.opacity = fxState.echoFx * 0.8 + (game.echo ? 0.18 : 0);
    el.lowHp.classList.toggle('show', hpFrac < 0.3 && p.alive);
    // Banner / toast timers.
    if (bannerT > 0) { bannerT -= dt; if (bannerT <= 0) el.banner.className = ''; }
    if (toastT > 0) { toastT -= dt; if (toastT <= 0) el.toast.className = ''; }
    // Damage numbers.
    const w2 = window.innerWidth / 2, h2 = window.innerHeight / 2;
    for (let i = numbers.length - 1; i >= 0; i--) {
      const n = numbers[i];
      n.t -= dt;
      n.pos.y += dt * 0.9;
      const v = n.pos.clone().project(camera);
      if (n.t <= 0 || v.z > 1) { n.el.remove(); numbers.splice(i, 1); continue; }
      n.el.style.transform = `translate(${(v.x * w2 + w2).toFixed(1)}px, ${(-v.y * h2 + h2).toFixed(1)}px) translate(-50%,-50%) scale(${(0.8 + n.t * 0.4).toFixed(2)})`;
      n.el.style.opacity = Math.min(1, n.t * 2.5).toFixed(2);
    }
    // Indicator fade.
    for (const d of [...el.indicators.children]) {
      const t = Number(d.dataset.t) - dt;
      d.dataset.t = t;
      d.style.opacity = Math.max(0, Math.min(1, t)).toFixed(2);
      if (t <= 0) d.remove();
    }
  }

  return {
    update, banner, toast,
    show(v) { el.root.classList.toggle('hidden', !v); },
    hitmarker(weak, kill, blocked) {
      hitT = kill ? 0.3 : 0.18;
      el.hit.className = kill ? 'kill' : weak ? 'weak' : blocked ? 'blocked' : '';
    },
    damageNumber(pos, amount, weak, echo) {
      if (numbers.length > 40) { numbers[0].el.remove(); numbers.shift(); }
      const d = document.createElement('div');
      d.className = `dmg${weak ? ' weak' : ''}${echo ? ' echo' : ''}`;
      d.textContent = Math.round(amount);
      el.dmgLayer.appendChild(d);
      numbers.push({ el: d, pos: pos.clone().add({ x: (Math.random() - 0.5) * 0.4, y: 0.2, z: (Math.random() - 0.5) * 0.4 }), t: 0.9 });
    },
    damageIndicator(angle, amount) {
      const d = document.createElement('div');
      d.className = 'ind';
      d.style.transform = `rotate(${(-angle * 180) / Math.PI}deg)`;
      d.style.setProperty('--s', Math.min(1.5, 0.7 + amount / 30));
      d.dataset.t = 1.2;
      el.indicators.appendChild(d);
      while (el.indicators.children.length > 8) el.indicators.firstChild.remove();
    },
    killfeed(ev) {
      const d = document.createElement('div');
      d.className = `kf${ev.weak ? ' weak' : ''}${ev.echo ? ' echo' : ''}${ev.paradox ? ' paradox' : ''}`;
      d.innerHTML = `<span>${ev.echo ? '◈ 残影' : '▸'} ${NAMES[ev.enemy] || ev.enemy}</span><b>+${ev.points}</b>${ev.paradox ? '<i class="px">悖论</i>' : ''}${ev.weak ? '<i>弱点</i>' : ''}`;
      el.feed.prepend(d);
      setTimeout(() => d.classList.add('out'), 2200);
      setTimeout(() => d.remove(), 2700);
      while (el.feed.children.length > 6) el.feed.lastChild.remove();
    },
    pickup(ev) {
      if (ev.kind === 'health') toast(`+${Math.round(ev.amount)} 生命`, 1, 'green');
      else if (ev.kind === 'ammo') toast(`弹药补给  霰弹 +${ev.scatter} · 磁轨 +${ev.rail}`, 1.2, 'orange');
      else toast('弹药站：备弹补充', 1.4, 'orange');
    },
    flashAmmo() { el.ammo.classList.remove('flash'); void el.ammo.offsetWidth; el.ammo.classList.add('flash'); toast('弹药耗尽 — 切换武器或寻找补给', 1.4, 'red'); },
    dash() { el.dash.classList.remove('pulse'); void el.dash.offsetWidth; el.dash.classList.add('pulse'); },
    echoReady() { toast('相位残影就绪 — 按 Q 回溯', 1.8, 'cyan'); el.echoBox.classList.remove('pulse'); void el.echoBox.offsetWidth; el.echoBox.classList.add('pulse'); },
    echoDenied(reason) {
      if (reason === 'busy') return; // second press while the echo is already collapsing: nothing to say
      toast(reason === 'history' ? '相位记录不足' : reason === 'swapEarly' ? '残影尚未稳定 — 稍后再按 Q 换位' : '相位能量不足', 0.9, 'red');
    },
    echoSwap(surge) { toast(surge ? '相位换位 · 换位冲击 伤害 +40%' : '相位换位 — 残影在原位坍缩', 1.3, 'cyan'); },
    paradox() { toast('悖论击杀 · 得分 ×1.5 · 相位能量 +10', 1.1, 'cyan'); },
    echoStart(healed) { toast(healed > 1 ? `相位回溯 · 恢复 ${Math.round(healed)} 生命` : '相位回溯', 1.2, 'cyan'); },
    bossIntro() { banner('RESONATOR PRIME', '共振主脑 — 击碎护盾板，瞄准核心之眼', 3.2, 'boss'); },
    bossPhase(n) { banner(`PHASE ${['I', 'II', 'III'][n - 1]}`, n === 2 ? '护盾板减少 — 螺旋弹幕与召唤' : '核心暴露 — 全面过载', 2.2, 'boss'); },
    enemyName: t => ENEMY_TYPES[t]?.cn || t,
  };
}

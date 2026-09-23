// PHASE ECHO entry: wires settings, menus, input, the simulation, renderer, HUD and audio together.
import { createGame } from './sim/game.js';
import { getUpgrade } from './sim/upgrades.js';
import { DIFFICULTY } from './sim/waves.js';
import { PLAYER } from './sim/player.js';
import { createRenderer } from './world/renderer.js';
import { createHud } from './ui/hud.js';
import { createInput } from './ui/input.js';
import { createAudio } from './audio/sfx.js';

const $ = id => document.getElementById(id);
const SETTINGS_KEY = 'phase-echo.settings.v1', BEST_KEY = 'phase-echo.best.v1';
const DEFAULTS = { sensitivity: 1, fov: 90, volume: 0.8, music: 0.45, quality: 'auto', invertY: false, toggleAds: false, shake: true, damageNumbers: true, difficulty: 'normal' };
function load(key, fallback) { try { return { ...fallback, ...JSON.parse(localStorage.getItem(key) || '{}') }; } catch { return { ...fallback }; } }
const settings = load(SETTINGS_KEY, DEFAULTS);
const saveSettings = () => { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch { /* storage disabled */ } };
const bests = load(BEST_KEY, {});

const canvas = $('game');
const params = new URLSearchParams(location.search);
// URL override for testing / weak GPUs (not persisted): ?quality=low|medium|high|auto
const urlQuality = ['low', 'medium', 'high', 'auto'].includes(params.get('quality')) ? params.get('quality') : null;
const audio = createAudio();
audio.setVolume(settings.volume);
audio.setMusicVolume(settings.music);
// The renderer reads settings.quality as the *effective* quality ('high' | 'medium' | 'low').
const renderSettings = Object.create(settings, { quality: { value: 'high', writable: true } });
let view = null;
try {
  view = createRenderer(canvas, renderSettings);
} catch (err) {
  $('webgl-error').classList.add('show');
  console.error(err);
  throw err;
}
const gpu = view.rendererInfo();
// 'auto' = high on a GPU, low on a software rasteriser (SwiftShader / llvmpipe: no hardware acceleration).
const effectiveQuality = () => { const q = urlQuality || settings.quality; return q === 'auto' ? (gpu.software ? 'low' : 'high') : q; };
renderSettings.quality = effectiveQuality();
view.setQuality(renderSettings.quality);
const hud = createHud(view.camera);
const lockHint = $('lock-hint');
const input = createInput(canvas, settings);
let game = null, menuGame = null, state = 'menu', last = performance.now(), acc = 0, frameTimes = [], deathCam = 0, pausedAt = 0;

// ---------------------------------------------------------------- screens
const screens = ['menu', 'pause', 'upgrade', 'results', 'settings', 'howto'];
function show(name) {
  for (const s of screens) $(`screen-${s}`)?.classList.toggle('show', s === name);
  document.body.dataset.screen = name || 'play';
}
function setState(s) {
  state = s;
  document.body.dataset.state = s;
  hud.show(s === 'play' || s === 'upgrade' || s === 'pause' || s === 'dead' || s === 'ending');
}

function startRun() {
  audio.unlock();
  audio.startMusic();
  const diff = settings.difficulty in DIFFICULTY ? settings.difficulty : 'normal';
  const seed = params.has('seed') ? Number(params.get('seed')) : undefined;
  game = createGame({ seed, difficulty: diff, startWave: Number(params.get('wave')) || 1, invulnerable: params.has('god'), firstDelay: params.has('fast') ? 0.5 : undefined });
  window.__phaseEcho.game = game;
  menuGame = null;
  view.hideViewmodel = false;
  view.setup(game);
  input.setLook(game.player.yaw, 0);
  deathCam = 0;
  hud.banner('ECHO-7 竞技场', `难度：${DIFFICULTY[diff].cn} — 存活十波，击败 RESONATOR PRIME`, 3);
  show(null);
  setState('play');
  input.enable(true);
  input.lock();
}

function pause() {
  if (state !== 'play') return;
  pausedAt = performance.now();
  setState('pause');
  show('pause');
  input.enable(false);
  input.unlock();
  audio.suspend();
}
function resume() {
  if (state !== 'pause') return;
  audio.resume();
  show(null);
  setState('play');
  input.enable(true);
  input.lock();
}
function quitToMenu() {
  input.enable(false);
  input.unlock();
  audio.stopMusic();
  audio.resume();
  view.clearWorld();
  game = null;
  menuGame = null;
  window.__phaseEcho.game = null;
  renderMenuBest();
  show('menu');
  setState('menu');
}

function showUpgrades() {
  setState('upgrade');
  input.enable(false);
  input.unlock();
  const cards = $('upgrade-cards');
  cards.innerHTML = game.offers.map((id, i) => {
    const u = getUpgrade(id), n = game.owned[id] || 0;
    return `<button class="card" data-i="${i}" data-id="${id}"><div class="icon">${u.icon}</div><h3>${u.cn}</h3><h4>${u.en}</h4><p>${u.desc}</p><small>${'◆'.repeat(n)}${'◇'.repeat(u.max - n)}</small><kbd>${i + 1}</kbd></button>`;
  }).join('');
  $('upgrade-wave').textContent = `第 ${game.wave} 波完成 — 选择一个模块`;
  show('upgrade');
  [...cards.children].forEach(c => {
    c.addEventListener('mouseenter', () => audio.play('uiHover'));
    c.addEventListener('click', () => chooseUpgrade(Number(c.dataset.i)));
  });
}
function chooseUpgrade(i) {
  if (state !== 'upgrade' || !game?.offers?.[i]) return;
  const id = game.offers[i];
  if (game.chooseUpgrade(id)) {
    audio.play('upgrade');
    hud.toast(`已安装：${getUpgrade(id).cn}`, 1.6, 'cyan');
    show(null);
    setState('play');
    input.enable(true);
    input.lock();
  }
}

function showResults(summary) {
  input.enable(false);
  input.unlock();
  audio.stopMusic();
  const key = summary.difficulty, prev = bests[key];
  const isBest = !prev || summary.score > prev.score;
  if (isBest) { bests[key] = { score: summary.score, wave: summary.wave, rank: summary.rank, victory: summary.victory, date: new Date().toISOString().slice(0, 10) }; try { localStorage.setItem(BEST_KEY, JSON.stringify(bests)); } catch { /* ignore */ } }
  $('results-title').textContent = summary.victory ? '任务完成' : '信号中断';
  $('results-title').className = summary.victory ? 'win' : 'lose';
  $('results-sub').textContent = summary.victory ? 'RESONATOR PRIME 已被摧毁 — ECHO-7 恢复静默' : `在第 ${summary.wave} 波倒下`;
  $('results-rank').textContent = summary.rank;
  $('results-rank').dataset.rank = summary.rank;
  const mins = Math.floor(summary.time / 60), secs = Math.floor(summary.time % 60);
  const rows = [
    ['得分', summary.score.toLocaleString('en-US') + (isBest ? '  ★ 新纪录' : '')], ['波次', `${summary.wave} / 10`], ['用时', `${mins}:${String(secs).padStart(2, '0')}`],
    ['击杀', summary.kills], ['弱点击杀', summary.weakKills], ['命中率', `${Math.round(summary.accuracy * 100)}%`], ['最高连击', summary.maxCombo],
    ['相位残影', `${summary.echoes} 次 · ${summary.echoKills} 击杀`], ['承受伤害', summary.damageTaken], ['难度', DIFFICULTY[summary.difficulty].cn],
  ];
  $('results-stats').innerHTML = rows.map(([k, v]) => `<div><span>${k}</span><b>${v}</b></div>`).join('');
  const ups = Object.entries(summary.upgrades).map(([id, n]) => `${getUpgrade(id)?.icon || ''} ${getUpgrade(id)?.cn || id}${n > 1 ? ' ×' + n : ''}`);
  $('results-upgrades').textContent = ups.length ? ups.join('   ') : '未安装模块';
  show('results');
  setState('results');
}

function renderMenuBest() {
  const b = bests[settings.difficulty];
  $('menu-best').textContent = b ? `最佳（${DIFFICULTY[settings.difficulty].cn}）：${b.score.toLocaleString('en-US')} · 波次 ${b.wave} · 评级 ${b.rank}${b.victory ? ' · 通关' : ''}` : '尚无记录';
  document.querySelectorAll('[data-diff]').forEach(btn => btn.classList.toggle('active', btn.dataset.diff === settings.difficulty));
}

// ---------------------------------------------------------------- settings UI
function bindSettings() {
  const bind = (id, key, parse = Number, fmt = v => v) => {
    const elx = $(id), out = $(`${id}-v`);
    const setOut = () => { if (out) out.textContent = fmt(settings[key]); };
    if (elx.type === 'checkbox') elx.checked = !!settings[key]; else elx.value = settings[key];
    setOut();
    elx.addEventListener('input', () => {
      settings[key] = elx.type === 'checkbox' ? elx.checked : parse(elx.value);
      setOut();
      saveSettings();
      apply(key);
    });
  };
  bind('set-sens', 'sensitivity', Number, v => v.toFixed(2));
  bind('set-fov', 'fov', Number, v => `${v}°`);
  bind('set-vol', 'volume', Number, v => `${Math.round(v * 100)}%`);
  bind('set-music', 'music', Number, v => `${Math.round(v * 100)}%`);
  bind('set-quality', 'quality', String);
  bind('set-invert', 'invertY');
  bind('set-toggleads', 'toggleAds');
  bind('set-shake', 'shake');
  bind('set-dmgnum', 'damageNumbers');
}
function apply(key) {
  if (key === 'volume') audio.setVolume(settings.volume);
  if (key === 'music') audio.setMusicVolume(settings.music);
  if (key === 'quality') { renderSettings.quality = effectiveQuality(); view.setQuality(renderSettings.quality); }
}
let settingsReturn = 'menu';
function openSettings(from) { settingsReturn = from; show('settings'); }
function closeSettings() { show(settingsReturn); }

// ---------------------------------------------------------------- DOM events
document.querySelectorAll('[data-diff]').forEach(btn => btn.addEventListener('click', () => { settings.difficulty = btn.dataset.diff; saveSettings(); audio.play('ui'); renderMenuBest(); }));
$('btn-start').addEventListener('click', () => { audio.unlock(); audio.play('ui'); startRun(); });
$('btn-settings').addEventListener('click', () => { audio.unlock(); audio.play('ui'); openSettings('menu'); });
$('btn-howto').addEventListener('click', () => { audio.unlock(); audio.play('ui'); show('howto'); });
$('btn-howto-back').addEventListener('click', () => { audio.play('ui'); show('menu'); });
$('btn-settings-back').addEventListener('click', () => { audio.play('ui'); closeSettings(); });
$('btn-resume').addEventListener('click', () => { audio.play('ui'); resume(); });
$('btn-pause-settings').addEventListener('click', () => { audio.play('ui'); openSettings('pause'); });
$('btn-restart').addEventListener('click', () => { audio.play('ui'); audio.stopMusic(); startRun(); });
$('btn-quit').addEventListener('click', () => { audio.play('ui'); quitToMenu(); });
$('btn-again').addEventListener('click', () => { audio.play('ui'); startRun(); });
$('btn-menu').addEventListener('click', () => { audio.play('ui'); quitToMenu(); });
document.querySelectorAll('button').forEach(b => b.addEventListener('mouseenter', () => audio.play('uiHover')));
canvas.addEventListener('click', () => { if (state === 'play' && !input.locked) input.lock(); });
window.addEventListener('keydown', e => {
  if (state === 'upgrade' && ['Digit1', 'Digit2', 'Digit3'].includes(e.code)) chooseUpgrade(Number(e.code.slice(-1)) - 1);
  if (e.code === 'Escape' || e.code === 'KeyP') {
    // With pointer lock the browser consumes Esc (lock loss pauses via lockChange); without lock Esc pauses here.
    if (state === 'play' && (e.code === 'KeyP' || !input.locked)) pause();
    else if (state === 'pause' && document.body.dataset.screen === 'pause' && performance.now() - pausedAt > 350) resume();
    else if (document.body.dataset.screen === 'settings') closeSettings();
    else if (document.body.dataset.screen === 'howto') show('menu');
  }
  if (e.code === 'Enter' && state === 'menu' && document.body.dataset.screen === 'menu') startRun();
});
input.on('lockChange', locked => {
  // Losing pointer lock mid-game (Esc) pauses; the browser swallows the Esc keydown in that case.
  if (!locked && state === 'play') pause();
});
input.on('lookDelta', (dx, dy) => view.look(dx, dy));
input.on('fallback', on => { if (on && state === 'play') hud.toast('鼠标未锁定：点击画面锁定；也可直接移动鼠标或用方向键转向', 3.5, 'orange'); });
document.addEventListener('visibilitychange', () => { if (document.hidden && state === 'play') pause(); });

// ---------------------------------------------------------------- main loop
const STEP = 1 / 120;
const EDGE_OFF = { firePressed: false, jumpPressed: false, dashPressed: false, echoPressed: false, reload: false, weapon: null, cycle: 0 };
// Runs the simulation for `seconds` of game time with the current input (used by the frame loop's fixed
// step and by the automation hook below). Stops early when the run leaves normal play.
function simulate(seconds, inp) {
  let first = true, t = 0;
  while (t < seconds - 1e-9 && (game.mode === 'wave' || game.mode === 'intermission' || game.mode === 'cleared' || game.mode === 'test')) {
    game.step(STEP, first ? inp : { ...inp, ...EDGE_OFF });
    first = false;
    t += STEP;
    const events = game.drainEvents();
    view.handleEvents(events, game, audio, hud);
    for (const ev of events) { handleFlow(ev); tap(ev); }
  }
  return t;
}
// Rolling log of recent event names (read by automated tests through window.__phaseEcho.events).
const recentEvents = [];
function tap(ev) { recentEvents.push(ev.type); if (recentEvents.length > 400) recentEvents.splice(0, 100); }
function frame(nowMs) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (nowMs - last) / 1000);
  last = nowMs;
  frameTimes.push(dt);
  if (frameTimes.length > 120) frameTimes.shift();
  if (!game) { menuCamera(dt); return; }
  if (state === 'play' || state === 'dead') {
    const inp = input.sample(dt);
    input.setAdsBlend(game.arsenal.ads);
    if (state === 'dead') { inp.fire = false; inp.moveX = inp.moveZ = 0; }
    acc += dt;
    const steps = Math.floor(acc / STEP);
    if (steps > 0) { acc -= steps * STEP; simulate(steps * STEP, inp); }
  }
  // Events raised outside step() (upgrade choice, debug hooks, defeat by external damage) are handled here.
  const rest = game.drainEvents();
  if (rest.length) { view.handleEvents(rest, game, audio, hud); for (const ev of rest) { handleFlow(ev); tap(ev); } }
  const b = game.player.body;
  const roll = state === 'dead' ? Math.min(0.5, deathCam * 0.4) : 0;
  if (state === 'dead') deathCam += dt;
  const eyeY = b.y + PLAYER.eye - (state === 'dead' ? Math.min(1.3, deathCam * 1.6) : 0);
  const fxState = view.render(game, dt, { x: b.x, y: eyeY, z: b.z, yaw: game.player.yaw, pitch: game.player.pitch, roll });
  hud.update(game, dt, fxState);
  lockHint.classList.toggle('show', state === 'play' && !input.locked);
  const f = { x: -Math.sin(game.player.yaw), y: 0, z: -Math.cos(game.player.yaw) };
  audio.setListener(b.x, eyeY, b.z, f.x, f.y, f.z);
  const intensity = game.mode === 'wave' ? Math.min(1, 0.35 + game.enemies.filter(e => e.alive).length * 0.06) : 0.15;
  audio.setIntensity(intensity, !!game.boss);
  if (state === 'dead' && deathCam > 2.2) showResults(game.summary());
  if (game.mode === 'upgrade' && state === 'play') showUpgrades();
}

function handleFlow(ev) {
  switch (ev.type) {
    case 'waveStart': audio.play('waveStart'); hud.banner(ev.boss ? '最终波次' : `WAVE ${ev.wave}`, ev.boss ? '共振主脑正在降临' : `${ev.count} 个敌对单位接近`, 2); break;
    case 'waveClear': audio.play('waveClear'); hud.banner(ev.final ? 'ECHO-7 已肃清' : '波次完成', `+${ev.bonus.total.toLocaleString('en-US')}  (基础 ${ev.bonus.base} · 速度 ${ev.bonus.time}${ev.bonus.flawless ? ' · 无伤 ' + ev.bonus.flawless : ''})`, 2.2, 'clear'); break;
    case 'intermission': if (ev.boss) hud.toast('最终波次即将开始 — 补给已投放', 2.2, 'orange'); break;
    case 'victory': audio.play('victory'); setState('ending'); setTimeout(() => { if (state === 'ending') showResults(ev); }, 1800); break;
    case 'defeat': audio.play('defeat'); setState('dead'); input.enable(false); break;
    default: break;
  }
}

// Slow orbit around the arena behind the menu.
let menuT = 0;
function menuCamera(dt) {
  if (!menuGame) { menuGame = createGame({ seed: 3, firstDelay: 9999 }); view.setup(menuGame); view.hideViewmodel = true; }
  menuT += dt * 0.08;
  const r = 30;
  menuGame.player.body.x = Math.sin(menuT) * r;
  menuGame.player.body.z = Math.cos(menuT) * r;
  menuGame.player.body.y = 4;
  const fxState = view.render(menuGame, dt, { x: Math.sin(menuT) * r, y: 7, z: Math.cos(menuT) * r, yaw: menuT, pitch: -0.2, roll: 0 });
  void fxState;
}

// Test/automation hooks (used by the Playwright smoke test; harmless in normal play).
window.__phaseEcho = {
  game: null,
  get state() { return state; },
  get events() { return recentEvents.slice(); },
  start: startRun,
  input,
  pause, resume, chooseUpgrade,
  // Deterministic fast-forward for automated tests on slow (software WebGL) machines.
  advance(seconds) { if (!game || state !== 'play') return 0; const r = simulate(seconds, input.sample(0)); input.setAdsBlend(game.arsenal.ads); return r; },
  stats: () => ({ ...view.stats(), quality: renderSettings.quality, gpu: gpu.name, fps: frameTimes.length ? 1 / (frameTimes.reduce((a, b) => a + b, 0) / frameTimes.length) : 0 }),
  forceState: s => setState(s),
};

bindSettings();
renderMenuBest();
show('menu');
setState('menu');
requestAnimationFrame(frame);

// Procedural WebAudio sound design: every sound is synthesised (no audio files). Positional one-shots use
// a PannerNode relative to the listener; a light synth pad plays during waves and intensifies for the boss.
export function createAudio() {
  let ctx = null, master = null, sfxBus = null, musicBus = null, comp = null, noiseBuf = null, music = null;
  let volume = 0.8, musicVolume = 0.45, lastPlay = new Map();

  function ensure() {
    if (ctx) return ctx;
    const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.knee.value = 18; comp.ratio.value = 4; comp.attack.value = 0.004; comp.release.value = 0.2;
    master = ctx.createGain(); master.gain.value = volume;
    sfxBus = ctx.createGain(); sfxBus.gain.value = 1;
    musicBus = ctx.createGain(); musicBus.gain.value = musicVolume;
    sfxBus.connect(comp); musicBus.connect(comp); comp.connect(master); master.connect(ctx.destination);
    const len = ctx.sampleRate;
    noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return ctx;
  }
  const now = () => ctx.currentTime;
  function throttle(key, gap) {
    const t = performance.now(), last = lastPlay.get(key) || 0;
    if (t - last < gap) return false;
    lastPlay.set(key, t);
    return true;
  }
  function out(pos) {
    if (!pos) return sfxBus;
    const p = ctx.createPanner();
    p.panningModel = 'equalpower'; p.distanceModel = 'inverse'; p.refDistance = 3; p.maxDistance = 80; p.rolloffFactor = 1.1;
    p.positionX.value = pos.x; p.positionY.value = pos.y; p.positionZ.value = pos.z;
    p.connect(sfxBus);
    return p;
  }
  function env(g, t, a, peak, decay, sustain = 0.0001) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + a);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0001, sustain), t + a + decay);
  }
  function osc(type, f0, f1, dur, peak, dest, { attack = 0.003, detune = 0, delay = 0 } = {}) {
    const t = now() + delay, o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(f0, t); if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    o.detune.value = detune;
    env(g, t, attack, peak, dur);
    o.connect(g); g.connect(dest);
    o.start(t); o.stop(t + attack + dur + 0.05);
  }
  function noise(dur, peak, dest, { type = 'bandpass', f0 = 1200, f1 = f0, q = 1, attack = 0.002, delay = 0 } = {}) {
    const t = now() + delay, s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    s.buffer = noiseBuf; s.loop = true;
    f.type = type; f.frequency.setValueAtTime(f0, t); if (f1 !== f0) f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur); f.Q.value = q;
    env(g, t, attack, peak, dur);
    s.connect(f); f.connect(g); g.connect(dest);
    s.start(t, Math.random() * 0.5); s.stop(t + attack + dur + 0.05);
  }

  const SOUNDS = {
    carbine(d) { osc('square', 900, 180, 0.07, 0.18, d); noise(0.06, 0.35, d, { f0: 3000, f1: 800, q: 0.8 }); osc('sine', 120, 50, 0.08, 0.3, d); },
    scatter(d) { noise(0.28, 0.7, d, { type: 'lowpass', f0: 5000, f1: 300, q: 0.5 }); osc('sine', 90, 35, 0.25, 0.7, d); osc('sawtooth', 300, 60, 0.12, 0.2, d); },
    rail(d) { osc('sawtooth', 2400, 80, 0.45, 0.25, d); osc('sine', 1600, 1590, 0.5, 0.12, d, { attack: 0.001 }); noise(0.35, 0.4, d, { type: 'highpass', f0: 6000, f1: 1500 }); osc('sine', 70, 30, 0.4, 0.6, d); },
    echoShot(d) { osc('triangle', 1400, 300, 0.1, 0.1, d); noise(0.05, 0.12, d, { f0: 5000 }); },
    empty(d) { osc('square', 1800, 1700, 0.02, 0.08, d); },
    reload(d) { noise(0.05, 0.25, d, { f0: 2500, q: 3 }); noise(0.05, 0.22, d, { f0: 1800, q: 3, delay: 0.12 }); },
    reloadEnd(d) { noise(0.04, 0.3, d, { f0: 3500, q: 4 }); osc('square', 600, 900, 0.04, 0.08, d); },
    shell(d) { noise(0.05, 0.25, d, { f0: 2200, q: 5 }); osc('square', 300, 200, 0.03, 0.06, d); },
    switch(d) { noise(0.04, 0.2, d, { f0: 3000, q: 4 }); osc('sine', 500, 800, 0.05, 0.05, d, { delay: 0.05 }); },
    hit(d) { osc('square', 1800, 1500, 0.035, 0.09, d); },
    weak(d) { osc('sine', 2600, 2200, 0.06, 0.16, d); osc('square', 1300, 1250, 0.05, 0.06, d); },
    shielded(d) { osc('square', 400, 380, 0.05, 0.1, d); noise(0.04, 0.12, d, { f0: 5000, q: 2 }); },
    kill(d) { osc('sine', 880, 1760, 0.09, 0.14, d); osc('sine', 1320, 2640, 0.12, 0.08, d, { delay: 0.04 }); },
    explode(d) { noise(0.7, 0.9, d, { type: 'lowpass', f0: 2400, f1: 80, q: 0.7 }); osc('sine', 110, 28, 0.6, 0.9, d); },
    small(d) { noise(0.3, 0.5, d, { type: 'lowpass', f0: 3000, f1: 200 }); osc('sine', 160, 50, 0.25, 0.4, d); },
    enemyBolt(d) { osc('sawtooth', 600, 250, 0.12, 0.12, d); noise(0.08, 0.1, d, { f0: 1800, q: 2 }); },
    needle(d) { osc('sine', 2200, 900, 0.1, 0.1, d); },
    tell(d) { osc('sine', 500, 1400, 0.25, 0.08, d, { attack: 0.02 }); },
    lungeTell(d) { osc('sawtooth', 180, 420, 0.3, 0.12, d, { attack: 0.02 }); },
    heavyTell(d) { osc('sawtooth', 60, 140, 0.8, 0.3, d, { attack: 0.05 }); noise(0.8, 0.2, d, { type: 'lowpass', f0: 300, f1: 1200, attack: 0.1 }); },
    slam(d) { noise(0.6, 1, d, { type: 'lowpass', f0: 1200, f1: 60 }); osc('sine', 70, 22, 0.7, 1, d); },
    mortarLaunch(d) { osc('sine', 200, 80, 0.3, 0.5, d); noise(0.3, 0.5, d, { type: 'lowpass', f0: 1600, f1: 200 }); },
    hurt(d) { osc('sawtooth', 220, 90, 0.18, 0.35, d); noise(0.12, 0.3, d, { type: 'lowpass', f0: 900 }); },
    phase(d) { osc('sine', 1600, 400, 0.12, 0.12, d); },
    dash(d) { noise(0.22, 0.5, d, { type: 'bandpass', f0: 600, f1: 3000, q: 1.2 }); osc('sine', 300, 900, 0.18, 0.08, d); },
    jump(d) { osc('sine', 220, 360, 0.1, 0.1, d); },
    land(d) { noise(0.12, 0.3, d, { type: 'lowpass', f0: 600, f1: 100 }); },
    pad(d) { osc('sine', 200, 1200, 0.45, 0.3, d); noise(0.4, 0.3, d, { f0: 800, f1: 4000, q: 1 }); },
    pickup(d) { osc('sine', 660, 990, 0.08, 0.15, d); osc('sine', 990, 1480, 0.1, 0.12, d, { delay: 0.07 }); },
    ammo(d) { noise(0.06, 0.25, d, { f0: 2500, q: 3 }); osc('square', 500, 700, 0.06, 0.08, d, { delay: 0.05 }); },
    echoReady(d) { for (let i = 0; i < 3; i++) osc('sine', 440 * (i + 2), 440 * (i + 2), 0.18, 0.1, d, { delay: i * 0.07 }); },
    echoStart(d) { osc('sawtooth', 1800, 90, 0.6, 0.25, d); osc('sine', 120, 900, 0.5, 0.25, d); noise(0.6, 0.4, d, { type: 'bandpass', f0: 6000, f1: 300, q: 2 }); },
    echoCollapse(d) { osc('sine', 80, 900, 0.55, 0.35, d, { attack: 0.4 }); },
    echoBlast(d) { noise(0.8, 1, d, { type: 'lowpass', f0: 4000, f1: 60 }); osc('sine', 60, 20, 0.8, 1, d); osc('triangle', 900, 200, 0.4, 0.2, d); },
    denied(d) { osc('square', 200, 180, 0.1, 0.1, d); osc('square', 150, 140, 0.12, 0.1, d, { delay: 0.1 }); },
    gate(d) { osc('sine', 300, 600, 0.9, 0.12, d, { attack: 0.3 }); noise(0.9, 0.12, d, { f0: 400, f1: 2000, q: 3, attack: 0.3 }); },
    spawn(d) { noise(0.3, 0.3, d, { type: 'highpass', f0: 3000, f1: 600 }); osc('sine', 900, 200, 0.25, 0.15, d); },
    waveStart(d) { [0, 0.12, 0.24].forEach((dl, i) => osc('sawtooth', 220 * (1 + i * 0.5), 220 * (1 + i * 0.5), 0.25, 0.12, d, { delay: dl })); },
    waveClear(d) { [523, 659, 784, 1046].forEach((f, i) => osc('triangle', f, f, 0.35, 0.14, d, { delay: i * 0.09 })); },
    upgrade(d) { [784, 988, 1175, 1568].forEach((f, i) => osc('sine', f, f, 0.3, 0.12, d, { delay: i * 0.06 })); },
    bossCharge(d) { osc('sawtooth', 50, 200, 0.9, 0.25, d, { attack: 0.3 }); },
    beamTell(d) { osc('sine', 1200, 2400, 0.6, 0.12, d, { attack: 0.3 }); },
    beam(d) { noise(0.35, 0.8, d, { type: 'bandpass', f0: 3000, f1: 400, q: 0.7 }); osc('sawtooth', 300, 40, 0.35, 0.5, d); },
    bossRing(d) { osc('sine', 300, 150, 0.5, 0.4, d); noise(0.3, 0.3, d, { f0: 1200, f1: 300 }); },
    plate(d) { osc('square', 700, 650, 0.08, 0.12, d); osc('sine', 1400, 1390, 0.2, 0.08, d); },
    bossPhase(d) { noise(1.4, 0.8, d, { type: 'lowpass', f0: 5000, f1: 100 }); osc('sawtooth', 400, 40, 1.4, 0.4, d); osc('sine', 60, 30, 1.4, 0.8, d); },
    bossDie(d) { for (let i = 0; i < 6; i++) { noise(0.6, 0.6, d, { type: 'lowpass', f0: 3000, f1: 80, delay: i * 0.45 }); osc('sine', 100, 25, 0.6, 0.6, d, { delay: i * 0.45 }); } },
    victory(d) { [523, 659, 784, 1046, 1318].forEach((f, i) => { osc('triangle', f, f, 0.8, 0.12, d, { delay: i * 0.12 }); osc('sine', f / 2, f / 2, 0.9, 0.08, d, { delay: i * 0.12 }); }); },
    defeat(d) { [392, 330, 262, 196].forEach((f, i) => osc('sawtooth', f, f * 0.98, 0.5, 0.12, d, { delay: i * 0.22 })); },
    ui(d) { osc('sine', 1200, 1000, 0.05, 0.08, d); },
    uiHover(d) { osc('sine', 1800, 1800, 0.03, 0.03, d); },
    lowHp(d) { osc('sine', 60, 55, 0.12, 0.35, d); osc('sine', 60, 55, 0.12, 0.28, d, { delay: 0.18 }); },
  };

  // Voice cap: at most ~32 one-shots alive at once (each lasts < 1 s); cosmetic sounds are dropped first.
  const IMPORTANT = new Set(['hurt', 'echoStart', 'echoBlast', 'bossPhase', 'bossDie', 'victory', 'defeat', 'waveStart', 'waveClear', 'beamTell', 'heavyTell', 'lungeTell', 'upgrade', 'lowHp']);
  let voices = 0;
  function play(name, pos = null, gap = 0) {
    if (!ensure() || ctx.state !== 'running') return;
    if (gap && !throttle(name, gap)) return;
    if (voices > 32 && !IMPORTANT.has(name)) return;
    const fn = SOUNDS[name];
    if (!fn) return;
    voices++;
    setTimeout(() => { voices--; }, 900);
    fn(out(pos));
  }

  function setListener(x, y, z, fx, fy, fz) {
    if (!ctx) return;
    const l = ctx.listener, t = now();
    if (l.positionX) {
      l.positionX.setTargetAtTime(x, t, 0.02); l.positionY.setTargetAtTime(y, t, 0.02); l.positionZ.setTargetAtTime(z, t, 0.02);
      l.forwardX.setTargetAtTime(fx, t, 0.02); l.forwardY.setTargetAtTime(fy, t, 0.02); l.forwardZ.setTargetAtTime(fz, t, 0.02);
      l.upX.value = 0; l.upY.value = 1; l.upZ.value = 0;
    } else {
      l.setPosition(x, y, z); l.setOrientation(fx, fy, fz, 0, 1, 0);
    }
  }

  // Minimal generative music: a drone + arpeggio whose tempo and filter follow the "intensity" 0..1.
  function startMusic() {
    if (!ensure() || music) return;
    const t = now();
    const drone = ctx.createOscillator(), drone2 = ctx.createOscillator(), dg = ctx.createGain(), lp = ctx.createBiquadFilter();
    drone.type = 'sawtooth'; drone2.type = 'sawtooth';
    drone.frequency.value = 55; drone2.frequency.value = 55.4;
    lp.type = 'lowpass'; lp.frequency.value = 300; lp.Q.value = 6;
    dg.gain.value = 0.05;
    drone.connect(lp); drone2.connect(lp); lp.connect(dg); dg.connect(musicBus);
    drone.start(t); drone2.start(t);
    const scale = [0, 3, 7, 10, 12, 15, 19, 22];
    let step = 0, intensity = 0.2, boss = false, nextAt = t + 0.1, stopped = false;
    const timer = setInterval(() => {
      if (stopped || !ctx) return;
      const bpm = 96 + intensity * 50 + (boss ? 20 : 0), dt = 60 / bpm / 2;
      while (nextAt < ctx.currentTime + 0.2) {
        const root = boss ? 49 : 55;
        const note = scale[(step * 3 + (step >> 3)) % scale.length] + (step % 16 >= 8 ? 12 : 0);
        const f = root * 2 * Math.pow(2, note / 12);
        const o = ctx.createOscillator(), g = ctx.createGain(), f2 = ctx.createBiquadFilter();
        o.type = boss ? 'sawtooth' : 'square';
        o.frequency.value = f;
        f2.type = 'lowpass'; f2.frequency.value = 600 + intensity * 2600; f2.Q.value = 4;
        g.gain.setValueAtTime(0.0001, nextAt);
        g.gain.exponentialRampToValueAtTime(0.03 + intensity * 0.03, nextAt + 0.01);
        g.gain.exponentialRampToValueAtTime(0.0001, nextAt + dt * 0.9);
        o.connect(f2); f2.connect(g); g.connect(musicBus);
        o.start(nextAt); o.stop(nextAt + dt);
        if (step % 4 === 0 && intensity > 0.35) {
          const k = ctx.createOscillator(), kg = ctx.createGain();
          k.frequency.setValueAtTime(140, nextAt); k.frequency.exponentialRampToValueAtTime(40, nextAt + 0.12);
          kg.gain.setValueAtTime(0.25 * intensity, nextAt); kg.gain.exponentialRampToValueAtTime(0.0001, nextAt + 0.15);
          k.connect(kg); kg.connect(musicBus); k.start(nextAt); k.stop(nextAt + 0.16);
        }
        nextAt += dt;
        step++;
      }
      lp.frequency.setTargetAtTime(220 + intensity * 900, ctx.currentTime, 0.5);
      drone.frequency.setTargetAtTime(boss ? 49 : 55, ctx.currentTime, 0.5);
      drone2.frequency.setTargetAtTime(boss ? 49.3 : 55.4, ctx.currentTime, 0.5);
    }, 50);
    music = {
      set(i, b) { intensity = Math.max(0, Math.min(1, i)); boss = !!b; },
      stop() { stopped = true; clearInterval(timer); try { drone.stop(); drone2.stop(); } catch { /* already stopped */ } music = null; },
    };
  }

  return {
    unlock() { if (ensure() && ctx.state !== 'running') ctx.resume(); },
    play, setListener, startMusic,
    setIntensity(i, boss) { music?.set(i, boss); },
    stopMusic() { music?.stop(); },
    setVolume(v) { volume = v; if (master) master.gain.value = v; },
    setMusicVolume(v) { musicVolume = v; if (musicBus) musicBus.gain.value = v; },
    get running() { return !!ctx && ctx.state === 'running'; },
    suspend() { ctx?.suspend(); },
    resume() { ctx?.resume(); },
  };
}

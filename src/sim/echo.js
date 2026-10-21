// PHASE ECHO — the signature mechanic. The player's last three seconds (pose + every shot) are recorded.
// Rewinding snaps the player back to where they were three seconds ago and spawns an Echo that replays
// that recording in real time: it walks the same route and re-fires the same shots at 65% damage, draws
// enemy aggro as a decoy, and finally collapses into an implosion that drags enemies in and detonates.
// Pressing the echo key again mid-replay performs a PHASE SWAP: you trade places with the echo, which
// collapses on the spot you just left. A kill landed by both you and the echo within a second is a PARADOX.
export const ECHO = Object.freeze({
  window: 3, rate: 30, cost: 100, damage: 0.65, minLength: 0.6, invuln: 0.5, heal: 0.5,
  pullTime: 0.55, radius: 5.5, blast: 70, killEnergy: 0.5,
  swapMin: 0.35, swapInvuln: 0.35, paradoxWindow: 1.0, paradoxBonus: 1.5, paradoxEnergy: 10,
  siphonEnergy: 6, surgeTime: 2.5,
});

export function createRecorder(window = ECHO.window, rate = ECHO.rate) {
  const samples = [], shots = [];
  let nextAt = -Infinity;
  let keep = window + 0.5;
  function trim(now) {
    while (samples.length > 2 && samples[1].t < now - keep) samples.shift();
    while (shots.length && shots[0].t < now - keep) shots.shift();
  }
  return {
    samples, shots,
    sample(now, pose, force = false) {
      if (!force && now < nextAt) return;
      nextAt = now + 1 / rate;
      samples.push({ t: now, x: pose.x, y: pose.y, z: pose.z, yaw: pose.yaw, pitch: pose.pitch, hp: pose.hp, w: pose.w });
      trim(now);
    },
    shot(now, origin, dirs, weaponId) { shots.push({ t: now, origin: { ...origin }, dirs: dirs.map(d => ({ ...d })), weapon: weaponId }); },
    clear() { samples.length = 0; shots.length = 0; nextAt = -Infinity; },
    length(now) { return samples.length ? now - samples[0].t : 0; },
    setWindow(w) { keep = w + 0.5; },
  };
}

export function sampleAt(samples, t) {
  if (!samples.length) return null;
  if (t <= samples[0].t) return { ...samples[0] };
  const last = samples[samples.length - 1];
  if (t >= last.t) return { ...last };
  let lo = 0, hi = samples.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (samples[mid].t <= t) lo = mid; else hi = mid;
  }
  const a = samples[lo], b = samples[hi], k = (t - a.t) / Math.max(1e-9, b.t - a.t);
  let dyaw = b.yaw - a.yaw;
  while (dyaw > Math.PI) dyaw -= Math.PI * 2;
  while (dyaw < -Math.PI) dyaw += Math.PI * 2;
  return {
    t, x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, z: a.z + (b.z - a.z) * k,
    yaw: a.yaw + dyaw * k, pitch: a.pitch + (b.pitch - a.pitch) * k, hp: a.hp + (b.hp - a.hp) * k, w: k < 0.5 ? a.w : b.w,
  };
}

// Builds the echo from the recorder at time `now`. Returns null if there is not enough history.
export function beginEcho(recorder, now, window = ECHO.window) {
  if (!recorder.samples.length) return null;
  const t0 = Math.max(recorder.samples[0].t, now - window);
  if (now - t0 < ECHO.minLength - 1e-9) return null;
  const samples = recorder.samples.filter(s => s.t >= t0 - 1 / ECHO.rate);
  const start = sampleAt(samples, t0);
  const shots = recorder.shots.filter(s => s.t > t0 && s.t <= now);
  return {
    active: true, state: 'replay', clock: t0, start: t0, end: now, samples, shots, pose: start, prevPose: start,
    collapseT: 0, hitFlash: 0, origin: start, vx: 0, vz: 0, swapped: false,
  };
}

// Advances the replay clock. Returns {shots: [...due shots], finished: bool}.
export function advanceEcho(echo, dt) {
  const due = [];
  if (!echo || echo.state !== 'replay') return { shots: due, finished: false };
  const from = echo.clock;
  echo.clock = Math.min(echo.end, echo.clock + dt);
  while (echo.shots.length && echo.shots[0].t <= echo.clock + 1e-9) {
    const s = echo.shots.shift();
    if (s.t > from - 1e-9) due.push(s);
  }
  echo.prevPose = echo.pose;
  echo.pose = sampleAt(echo.samples, echo.clock);
  echo.vx = dt > 0 ? (echo.pose.x - echo.prevPose.x) / dt : 0;
  echo.vz = dt > 0 ? (echo.pose.z - echo.prevPose.z) / dt : 0;
  echo.hitFlash = Math.max(0, echo.hitFlash - dt);
  return { shots: due, finished: echo.clock >= echo.end - 1e-9 };
}

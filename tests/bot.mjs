// Headless autopilot used by the simulation tests: aims at the nearest visible threat (weak point first),
// picks weapons by range, strafes, uses the echo when charged and takes the first upgrade offered.
import { yawTowards, pitchTowards, segmentBlocked, wrapAngle } from '../src/sim/geometry.js';
import { weakCenter } from '../src/sim/enemies.js';
import { eyeOf } from '../src/sim/player.js';

export function createBot(game, { useEcho = true, aimNoise = 0.004 } = {}) {
  let strafe = 1, strafeT = 0, prevFire = false, jumpT = 2;
  return function input(dt) {
    const g = game, p = g.player, eye = eyeOf(p);
    const input = { moveX: 0, moveZ: 0, yaw: p.yaw, pitch: p.pitch, fire: false, firePressed: false, ads: false, reload: false, weapon: null, cycle: 0, jumpPressed: false, dashPressed: false, echoPressed: false, choose: null };
    if (g.mode === 'upgrade') { input.choose = 0; return input; }
    const threats = [];
    for (const e of g.enemies) {
      if (!e.alive || e.spawnT > 0) continue;
      const aim = e.type === 'bulwark' ? { x: e.x, y: e.y + 1.3, z: e.z } : weakCenter(e);
      threats.push({ aim, d: Math.hypot(aim.x - eye.x, aim.y - eye.y, aim.z - eye.z), e });
    }
    if (g.boss?.alive && g.boss.state === 'fight') threats.push({ aim: g.boss.eye, d: Math.hypot(g.boss.x - eye.x, g.boss.z - eye.z), boss: true });
    const visible = threats.filter(t => !segmentBlocked(eye, t.aim, g.layout.boxes)).sort((a, b) => a.d - b.d);
    const target = visible[0] || threats.sort((a, b) => a.d - b.d)[0];
    strafeT -= dt;
    if (strafeT <= 0) { strafe = -strafe; strafeT = 0.8 + Math.random() * 1.2; }
    jumpT -= dt;
    if (target) {
      const dx = target.aim.x - eye.x, dy = target.aim.y - eye.y, dz = target.aim.z - eye.z;
      const wantYaw = yawTowards(dx, dz) + (Math.random() - 0.5) * aimNoise, wantPitch = pitchTowards(dx, dy, dz) + (Math.random() - 0.5) * aimNoise;
      const turn = 12 * dt;
      input.yaw = p.yaw + Math.max(-turn, Math.min(turn, wrapAngle(wantYaw - p.yaw)));
      input.pitch = p.pitch + Math.max(-turn, Math.min(turn, wantPitch - p.pitch)) - g.arsenal.aimOffset.pitch * 0.9;
      const aligned = Math.abs(wrapAngle(wantYaw - input.yaw)) < 0.05 && Math.abs(wantPitch - input.pitch) < 0.08;
      const seen = visible.includes(target);
      const s = g.arsenal.slots;
      let want = 0;
      if (target.boss || target.e?.type === 'bulwark') want = s[2].mag + s[2].reserve > 0 ? 2 : 0;
      else if (target.d < 8 && s[1].mag + s[1].reserve > 0) want = 1;
      if (want !== g.arsenal.index) input.weapon = want;
      if (seen && aligned) { input.fire = true; input.firePressed = !prevFire || !g.arsenal.weapon.auto; }
      input.ads = g.arsenal.index === 2 && seen;
      input.moveX = strafe;
      input.moveZ = target.d > 16 ? 1 : target.d < 6 ? -1 : 0;
      if (!seen) input.moveZ = 1;
    } else {
      input.moveZ = Math.hypot(p.body.x, p.body.z) > 14 ? 1 : 0;
      input.yaw = yawTowards(-p.body.x, -p.body.z);
      input.pitch = 0;
    }
    if (g.arsenal.slot.mag === 0) input.reload = true;
    if (useEcho && p.energy >= 100 && (p.hp < 60 || g.enemies.filter(e => e.alive).length >= 4)) input.echoPressed = true;
    if (p.hp < 45 && p.dash.charges > 0 && Math.random() < 0.05) input.dashPressed = true;
    if (jumpT <= 0) { input.jumpPressed = true; jumpT = 1.5 + Math.random() * 2; }
    prevFire = input.fire;
    return input;
  };
}

export function runGame(game, bot, { maxSeconds = 1500, dt = 1 / 60, onEvent } = {}) {
  let t = 0;
  const counts = {};
  while (t < maxSeconds && game.mode !== 'victory' && game.mode !== 'defeat') {
    game.step(dt, bot(dt));
    for (const e of game.drainEvents()) { counts[e.type] = (counts[e.type] || 0) + 1; onEvent?.(e); }
    t += dt;
  }
  return { t, counts };
}

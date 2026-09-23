import assert from 'node:assert/strict';
import { ECHO, createRecorder, beginEcho, advanceEcho, sampleAt } from '../src/sim/echo.js';

const rec = createRecorder();
for (let i = 0; i <= 150; i++) {
  const t = i / 30;
  rec.sample(t, { x: t * 2, y: 0, z: 0, yaw: 0, pitch: 0, hp: 100 - t * 5, w: 0 }, true);
  if (i % 30 === 15) rec.shot(t, { x: t * 2, y: 1.6, z: 0 }, [{ x: 0, y: 0, z: -1 }], 'carbine');
}
const now = 5;
assert.ok(rec.samples[0].t >= now - ECHO.window - 0.6, 'recorder trims old samples');
const mid = sampleAt(rec.samples, 3.5);
assert.ok(Math.abs(mid.x - 7) < 1e-9, 'linear interpolation');
const echo = beginEcho(rec, now);
assert.ok(echo);
assert.ok(Math.abs(echo.start - 2) < 1e-9 && Math.abs(echo.pose.x - 4) < 1e-9, 'echo starts three seconds back');
assert.equal(echo.shots.length, 3, 'shots inside the window are queued');
let fired = 0, finished = false, steps = 0;
while (!finished && steps < 1000) { const r = advanceEcho(echo, 1 / 60); fired += r.shots.length; finished = r.finished; steps++; }
assert.equal(fired, 3, 'all recorded shots replay exactly once');
assert.ok(Math.abs(steps / 60 - 3) < 0.05, 'replay runs in real time');
assert.ok(Math.abs(echo.pose.x - 10) < 1e-6, 'echo ends where the player pressed');
const short = createRecorder();
short.sample(0, { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, hp: 100, w: 0 }, true);
short.sample(0.3, { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, hp: 100, w: 0 }, true);
assert.equal(beginEcho(short, 0.3), null, 'needs a minimum history');
console.log('PASS echo: rolling 3 s recording, interpolation, replay timing, each shot once, minimum history');

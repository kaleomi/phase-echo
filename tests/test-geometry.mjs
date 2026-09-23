import assert from 'node:assert/strict';
import { rayBox, raySphere, rayCapsule, segmentBlocked, segmentSphere, circleBoxPush, dirFromYawPitch, yawTowards, wrapAngle, turnTowards, boxAt, segSegDist2, segmentHitsCapsule, damp } from '../src/sim/geometry.js';

const near = (a, b, e = 1e-6) => assert.ok(Math.abs(a - b) <= e, `${a} !~ ${b}`);

// Camera convention: yaw 0 looks toward -Z, +pitch looks up, yawTowards inverts dirFromYawPitch.
let d = dirFromYawPitch(0, 0); near(d.x, 0); near(d.z, -1);
d = dirFromYawPitch(Math.PI / 2, 0); near(d.x, -1); near(d.z, 0);
d = dirFromYawPitch(0, Math.PI / 2); near(d.y, 1);
for (const yaw of [-2.5, -1, 0.3, 1.7, 3]) { const v = dirFromYawPitch(yaw, 0); near(wrapAngle(yawTowards(v.x, v.z) - yaw), 0); }
near(turnTowards(3.0, -3.0, 0.1), wrapAngle(3.1)); // shortest path across the ±π seam
near(damp(10, 0, 5, 0.1) , 10 * Math.exp(-0.5));

const b = boxAt(0, -10, 2, 2, 2);
let h = rayBox({ x: 0, y: 1, z: 0 }, { x: 0, y: 0, z: -1 }, b);
near(h.t, 9); assert.deepEqual(h.normal, { x: 0, y: 0, z: 1 });
assert.equal(rayBox({ x: 0, y: 1, z: 0 }, { x: 0, y: 0, z: 1 }, b), null);
assert.equal(rayBox({ x: 0, y: 5, z: 0 }, { x: 0, y: 0, z: -1 }, b), null);
assert.equal(rayBox({ x: 0, y: 1, z: 0 }, { x: 0, y: 0, z: -1 }, b, 8), null, 'maxT respected');

near(raySphere({ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, { x: 5, y: 0, z: 0 }, 1), 4);
assert.equal(raySphere({ x: 0, y: 0, z: 0 }, { x: -1, y: 0, z: 0 }, { x: 5, y: 0, z: 0 }, 1), null);
near(rayCapsule({ x: -5, y: 1, z: 0 }, { x: 1, y: 0, z: 0 }, 0, 0, 2, 0, 0.5), 4.5);
assert.equal(rayCapsule({ x: -5, y: 3, z: 0 }, { x: 1, y: 0, z: 0 }, 0, 0, 2, 0, 0.5), null, 'above the capsule');
near(rayCapsule({ x: 0, y: 10, z: 0 }, { x: 0, y: -1, z: 0 }, 0, 0, 2, 0, 0.5), 8, 1e-6);

assert.equal(segmentBlocked({ x: 0, y: 1, z: 0 }, { x: 0, y: 1, z: -20 }, [b]), true);
assert.equal(segmentBlocked({ x: 0, y: 1, z: 0 }, { x: 0, y: 1, z: -5 }, [b]), false);
near(segmentSphere({ x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 0 }, { x: 5, y: 0, z: 0 }, 1), 0.4);

const push = circleBoxPush(1.2, -10, 0.5, b); near(push.x, 0.3); near(push.z, 0);
assert.equal(circleBoxPush(3, -10, 0.5, b), null);
const inside = circleBoxPush(0.1, -10, 0.5, b); assert.ok(inside.x > 0 && inside.z === 0, 'resolves out of the nearest face');

near(segSegDist2({ x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 0 }, { x: 5, y: 2, z: -1 }, { x: 5, y: 2, z: 1 }).d2, 4);
assert.ok(segmentHitsCapsule({ x: -5, y: 1, z: 0.6 }, { x: 5, y: 1, z: 0.6 }, 0, 0, 1.8, 0, 0.4, 0.25) !== null);
assert.equal(segmentHitsCapsule({ x: -5, y: 1, z: 1 }, { x: 5, y: 1, z: 1 }, 0, 0, 1.8, 0, 0.4, 0.25), null);
console.log('PASS geometry: camera convention, ray/box/sphere/capsule, sweeps, push-out, segment distances');

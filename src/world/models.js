// Procedural low-poly models built from primitives. Each factory returns {root, parts, mats, ...} so the
// renderer can animate limbs and pulse emissive materials without any external assets.
import * as THREE from 'three';
import { NEON } from './arena.js';

// Geometries are cached by constructor + arguments and shared by every instance. Neither geometries nor
// materials are disposed when a model is removed: geometry is shared, and disposing the last material of a
// kind would destroy its shader program (recompiled on the next spawn). Materials hold no GPU buffers, so
// dropped ones are simply garbage-collected; the program cache stays bounded by the handful of variants.
const geoCache = new Map();
function G(kind, ...args) {
  const key = `${kind}:${args.join(',')}`;
  let g = geoCache.get(key);
  if (!g) { g = new THREE[kind](...args); geoCache.set(key, g); }
  return g;
}
export function disposeModel(root) {
  root.removeFromParent();
}
const std = (color, emissive = 0x000000, ei = 0, extra = {}) => new THREE.MeshStandardMaterial({ color, emissive, emissiveIntensity: ei, roughness: 0.45, metalness: 0.55, ...extra });
const glow = (color, intensity = 3) => new THREE.MeshStandardMaterial({ color: 0x000000, emissive: color, emissiveIntensity: intensity, roughness: 1, metalness: 0 });
function mesh(geo, mat, x = 0, y = 0, z = 0, parent = null) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  if (parent) parent.add(m);
  return m;
}

function stalker() {
  const root = new THREE.Group(), body = new THREE.Group();
  root.add(body);
  const shell = std(0x2a2230, 0x000000, 0), accent = glow(NEON.orange, 3.2), eye = glow(0xffe0a0, 5);
  const torso = mesh(G('CapsuleGeometry', 0.34, 0.75, 4, 10), shell, 0, 0.78, 0.05, body);
  torso.rotation.x = Math.PI / 2 - 0.25;
  const spine = [];
  for (let i = 0; i < 4; i++) {
    const s = mesh(G('ConeGeometry', 0.07, 0.35, 5), accent, 0, 1.08 - i * 0.03, 0.35 - i * 0.2, body);
    s.rotation.x = -0.5;
    spine.push(s);
  }
  const head = new THREE.Group();
  head.position.set(0, 1.12, -0.3);
  body.add(head);
  mesh(G('BoxGeometry', 0.42, 0.3, 0.46), shell, 0, 0, 0, head);
  const visor = mesh(G('BoxGeometry', 0.36, 0.08, 0.05), eye, 0, 0.03, -0.24, head);
  mesh(G('ConeGeometry', 0.06, 0.28, 4), accent, 0.13, -0.12, -0.26, head).rotation.x = Math.PI / 2 + 0.3;
  mesh(G('ConeGeometry', 0.06, 0.28, 4), accent, -0.13, -0.12, -0.26, head).rotation.x = Math.PI / 2 + 0.3;
  const legs = [];
  for (const [x, z] of [[0.3, -0.3], [-0.3, -0.3], [0.3, 0.38], [-0.3, 0.38]]) {
    const hip = new THREE.Group();
    hip.position.set(x, 0.72, z);
    body.add(hip);
    const upper = mesh(G('CylinderGeometry', 0.06, 0.05, 0.5, 6), shell, 0, -0.18, 0, hip);
    upper.rotation.z = Math.sign(x) * 0.5;
    const foot = mesh(G('ConeGeometry', 0.07, 0.42, 5), accent, Math.sign(x) * 0.2, -0.52, 0, hip);
    foot.rotation.x = Math.PI;
    legs.push(hip);
  }
  return { root, body, parts: { head, legs, spine, visor }, mats: [shell, accent, eye], accent, height: 1.4 };
}

function sentinel() {
  const root = new THREE.Group(), body = new THREE.Group();
  root.add(body);
  const shell = std(0x262a3a), dark = std(0x14161f), accent = glow(0xb35cff, 3), eye = glow(0xe8c8ff, 5);
  const legs = [];
  for (const x of [0.22, -0.22]) {
    const hip = new THREE.Group();
    hip.position.set(x, 1.05, 0);
    body.add(hip);
    mesh(G('BoxGeometry', 0.16, 0.55, 0.2), dark, 0, -0.27, 0, hip);
    const knee = new THREE.Group();
    knee.position.set(0, -0.55, 0);
    hip.add(knee);
    mesh(G('BoxGeometry', 0.14, 0.5, 0.18), shell, 0, -0.25, 0.04, knee);
    mesh(G('BoxGeometry', 0.2, 0.08, 0.34), dark, 0, -0.5, -0.04, knee);
    legs.push({ hip, knee });
  }
  const chest = new THREE.Group();
  chest.position.set(0, 1.45, 0);
  body.add(chest);
  mesh(G('BoxGeometry', 0.62, 0.62, 0.4), shell, 0, 0, 0, chest);
  mesh(G('BoxGeometry', 0.4, 0.12, 0.05), accent, 0, 0.05, -0.21, chest);
  mesh(G('BoxGeometry', 0.66, 0.08, 0.44), accent, 0, -0.33, 0, chest);
  const head = new THREE.Group();
  head.position.set(0, 0.52, 0);
  chest.add(head);
  mesh(G('BoxGeometry', 0.34, 0.3, 0.34), dark, 0, 0, 0, head);
  const visor = mesh(G('BoxGeometry', 0.3, 0.1, 0.05), eye, 0, 0.02, -0.18, head);
  const gunArm = new THREE.Group();
  gunArm.position.set(0.42, 0.12, 0);
  chest.add(gunArm);
  mesh(G('BoxGeometry', 0.18, 0.2, 0.3), shell, 0, 0, 0, gunArm);
  const barrel = mesh(G('CylinderGeometry', 0.06, 0.08, 0.7, 8), dark, 0, 0, -0.45, gunArm);
  barrel.rotation.x = Math.PI / 2;
  const muzzle = mesh(G('TorusGeometry', 0.07, 0.025, 6, 12), accent, 0, 0, -0.8, gunArm);
  const arm = new THREE.Group();
  arm.position.set(-0.42, 0.1, 0);
  chest.add(arm);
  mesh(G('BoxGeometry', 0.14, 0.5, 0.16), shell, 0, -0.2, 0, arm);
  mesh(G('BoxGeometry', 0.32, 0.1, 0.34), accent, 0.42, 0.34, 0, chest);
  return { root, body, parts: { legs, chest, head, gunArm, muzzle, visor }, mats: [shell, dark, accent, eye], accent, height: 2.2, muzzleLocal: new THREE.Vector3(0.42, 1.57, -0.8) };
}

function wisp() {
  const root = new THREE.Group(), body = new THREE.Group();
  root.add(body);
  const coreMat = glow(0x7ff6ff, 2.2), shellMat = new THREE.MeshStandardMaterial({ color: 0x0c2433, emissive: 0x114455, emissiveIntensity: 0.6, roughness: 0.2, metalness: 0.8, transparent: true, opacity: 0.85 });
  const eye = glow(0xffffff, 6);
  const core = mesh(G('IcosahedronGeometry', 0.3, 1), coreMat, 0, 0, 0, body);
  const shell = mesh(G('IcosahedronGeometry', 0.5, 0), shellMat, 0, 0, 0, body);
  shell.material.flatShading = true;
  const visor = mesh(G('SphereGeometry', 0.13, 12, 8), eye, 0, 0, -0.42, body);
  const rings = [];
  for (let i = 0; i < 2; i++) {
    const r = mesh(G('TorusGeometry', 0.72 + i * 0.12, 0.025, 6, 32), glow(0x22e6ff, 2.5), 0, 0, 0, body);
    r.rotation.x = Math.PI / 2 + i * 0.6;
    rings.push(r);
  }
  const fins = [];
  for (let i = 0; i < 3; i++) {
    const f = mesh(G('ConeGeometry', 0.08, 0.5, 4), shellMat, 0, 0, 0, body);
    const a = (i * Math.PI * 2) / 3;
    f.position.set(Math.cos(a) * 0.35, Math.sin(a) * 0.35, 0.45);
    f.rotation.x = -Math.PI / 2;
    fins.push(f);
  }
  return { root, body, parts: { core, shell, rings, fins, visor }, mats: [coreMat, shellMat, eye], accent: coreMat, height: 1 };
}

function bulwark() {
  const root = new THREE.Group(), body = new THREE.Group();
  root.add(body);
  const shell = std(0x3a3222, 0x000000, 0, { metalness: 0.7 }), dark = std(0x16140f), accent = glow(0xffc21f, 2.6), vent = glow(0xff3322, 4.5);
  const legs = [];
  for (const x of [0.55, -0.55]) {
    const hip = new THREE.Group();
    hip.position.set(x, 1.1, 0.1);
    body.add(hip);
    mesh(G('BoxGeometry', 0.42, 0.7, 0.5), dark, 0, -0.35, 0, hip);
    const knee = new THREE.Group();
    knee.position.set(0, -0.7, 0);
    hip.add(knee);
    mesh(G('BoxGeometry', 0.46, 0.45, 0.6), shell, 0, -0.18, -0.05, knee);
    legs.push({ hip, knee });
  }
  const torso = new THREE.Group();
  torso.position.set(0, 1.75, 0);
  body.add(torso);
  mesh(G('BoxGeometry', 1.5, 1.0, 1.1), shell, 0, 0, 0, torso);
  mesh(G('BoxGeometry', 1.0, 0.35, 0.6), dark, 0, 0.62, 0.1, torso);
  const eye = mesh(G('BoxGeometry', 0.5, 0.1, 0.05), glow(0xffe08a, 4), 0, 0.66, -0.21, torso);
  // Back vent: the weak point.
  const ventMesh = mesh(G('BoxGeometry', 0.62, 0.5, 0.12), vent, 0, 0, 0.58, torso);
  for (let i = 0; i < 3; i++) mesh(G('BoxGeometry', 0.66, 0.05, 0.14), dark, 0, -0.18 + i * 0.18, 0.6, torso);
  // Front shield on an arm.
  const shieldArm = new THREE.Group();
  shieldArm.position.set(0, -0.05, -0.8);
  torso.add(shieldArm);
  const shieldMat = new THREE.MeshStandardMaterial({ color: 0x2b2a22, emissive: 0xffb21f, emissiveIntensity: 0.25, roughness: 0.3, metalness: 0.8 });
  const shield = mesh(G('BoxGeometry', 2.0, 2.1, 0.14), shieldMat, 0, -0.35, 0, shieldArm);
  const edge = new THREE.Mesh(G('EdgesGeometry', G('BoxGeometry', 2.02, 2.12, 0.16)), new THREE.LineBasicMaterial({ color: 0xffd060 }));
  edge.position.copy(shield.position);
  shieldArm.add(edge);
  mesh(G('BoxGeometry', 1.6, 0.08, 0.16), accent, 0, 0.35, -0.02, shieldArm);
  mesh(G('BoxGeometry', 0.08, 1.4, 0.16), accent, 0, -0.35, -0.02, shieldArm);
  const mortar = new THREE.Group();
  mortar.position.set(0.55, 0.65, 0.2);
  torso.add(mortar);
  const tube = mesh(G('CylinderGeometry', 0.16, 0.2, 0.9, 10), dark, 0, 0.3, 0, mortar);
  tube.rotation.x = 0.35;
  mesh(G('TorusGeometry', 0.17, 0.03, 6, 14), accent, 0, 0.72, -0.15, mortar).rotation.x = Math.PI / 2 + 0.35;
  return { root, body, parts: { legs, torso, shieldArm, mortar, vent: ventMesh, visor: eye }, mats: [shell, dark, accent, vent, shieldMat], accent, height: 2.6 };
}

export function createEnemyModel(type) {
  const m = ({ stalker, sentinel, wisp, bulwark })[type]();
  m.type = type;
  m.root.name = `enemy-${type}`;
  m.baseEmissive = m.mats.map(mt => mt.emissiveIntensity);
  m.root.traverse(o => { if (o.isMesh) o.userData.enemyPart = true; });
  return m;
}

export function createBossModel() {
  const root = new THREE.Group();
  root.name = 'boss';
  const coreMat = new THREE.MeshStandardMaterial({ color: 0x1a0f24, emissive: 0x6a1070, emissiveIntensity: 0.8, roughness: 0.25, metalness: 0.9 });
  const core = mesh(G('IcosahedronGeometry', 1.7, 2), coreMat, 0, 0, 0, root);
  const cage = new THREE.Mesh(G('IcosahedronGeometry', 1.95, 1), new THREE.MeshBasicMaterial({ color: NEON.magenta, wireframe: true, transparent: true, opacity: 0.35, toneMapped: false }));
  root.add(cage);
  const eyeGroup = new THREE.Group();
  root.add(eyeGroup);
  const eyeMat = glow(0xff5ae8, 6);
  const eye = mesh(G('SphereGeometry', 0.55, 20, 14), eyeMat, 0, 0, 0, eyeGroup);
  const pupil = mesh(G('SphereGeometry', 0.2, 12, 8), glow(0xffffff, 9), 0, 0, -0.42, eyeGroup);
  const lid = mesh(G('TorusGeometry', 0.62, 0.08, 8, 24), std(0x2a1a33, 0xff2bd6, 1.2), 0, 0, -0.05, eyeGroup);
  const rings = [];
  for (let i = 0; i < 3; i++) {
    const r = mesh(G('TorusGeometry', 2.6 + i * 0.45, 0.05 + i * 0.01, 8, 64), glow(i === 1 ? NEON.cyan : NEON.magenta, 2.2), 0, 0, 0, root);
    r.rotation.set(Math.PI / 2 + i * 0.5, i * 0.8, 0);
    rings.push(r);
  }
  const plateMat = new THREE.MeshStandardMaterial({ color: 0x3a3450, emissive: 0x22e6ff, emissiveIntensity: 0.6, roughness: 0.25, metalness: 0.9 });
  const plates = [];
  for (let i = 0; i < 3; i++) {
    const p = new THREE.Group();
    const slab = mesh(G('OctahedronGeometry', 1.1, 0), plateMat, 0, 0, 0, p);
    slab.scale.set(1, 1.3, 0.45);
    const halo = new THREE.Mesh(G('TorusGeometry', 1.15, 0.03, 6, 32), new THREE.MeshBasicMaterial({ color: NEON.cyan, toneMapped: false, transparent: true, opacity: 0.7 }));
    p.add(halo);
    p.userData.halo = halo;
    root.add(p);
    plates.push(p);
  }
  return { root, core, cage, eyeGroup, eye, pupil, lid, rings, plates, coreMat, eyeMat, plateMat };
}

// Translucent cyan "echo" of the player: body, head, gun, with an additive fresnel-ish shell.
export function createEchoModel() {
  const root = new THREE.Group();
  root.name = 'echo';
  const mat = new THREE.MeshBasicMaterial({ color: 0x33f0ff, transparent: true, opacity: 0.38, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
  const edge = new THREE.MeshBasicMaterial({ color: 0xaaffff, transparent: true, opacity: 0.8, wireframe: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
  const add = (geo, x, y, z, m = mat) => { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); root.add(o); return o; };
  add(G('CapsuleGeometry', 0.3, 0.7, 4, 10), 0, 1.05, 0);
  add(G('CapsuleGeometry', 0.3, 0.7, 2, 6), 0, 1.05, 0, edge);
  const head = add(G('SphereGeometry', 0.22, 14, 10), 0, 1.66, 0);
  const visor = add(G('BoxGeometry', 0.28, 0.06, 0.05), 0, 1.68, -0.2, new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false, transparent: true, depthWrite: false }));
  add(G('CapsuleGeometry', 0.1, 0.62, 3, 6), 0.14, 0.4, 0);
  add(G('CapsuleGeometry', 0.1, 0.62, 3, 6), -0.14, 0.4, 0);
  const gun = new THREE.Group();
  gun.position.set(0.25, 1.35, -0.3);
  root.add(gun);
  const g1 = new THREE.Mesh(G('BoxGeometry', 0.1, 0.14, 0.7), mat);
  gun.add(g1);
  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, 0, -0.4);
  gun.add(muzzle);
  return { root, mat, edge, head, gun, muzzle, visor };
}

export function createPickupModel(kind) {
  const root = new THREE.Group();
  const spin = new THREE.Group();
  root.add(spin);
  if (kind === 'health') {
    const m = glow(0x3dff8a, 2.4);
    spin.add(new THREE.Mesh(G('BoxGeometry', 0.55, 0.17, 0.17), m), new THREE.Mesh(G('BoxGeometry', 0.17, 0.55, 0.17), m));
  } else {
    const box = new THREE.Mesh(G('BoxGeometry', 0.45, 0.3, 0.3), std(0x3a2a18, 0xff8a1f, 0.6));
    const band = new THREE.Mesh(G('BoxGeometry', 0.47, 0.06, 0.32), glow(0x22e6ff, 2.5));
    spin.add(box, band);
  }
  const ring = new THREE.Mesh(G('TorusGeometry', 0.42, 0.02, 6, 24), new THREE.MeshBasicMaterial({ color: kind === 'health' ? 0x3dff8a : 0xff8a1f, toneMapped: false, transparent: true, opacity: 0.7 }));
  ring.rotation.x = Math.PI / 2;
  root.add(ring);
  return { root, spin, ring };
}

export function createStationModel() {
  const root = new THREE.Group();
  const base = mesh(G('CylinderGeometry', 0.9, 1.1, 0.35, 8), std(0x1b2030), 0, 0.17, 0, root);
  base.receiveShadow = true;
  const ring = mesh(G('TorusGeometry', 0.95, 0.05, 6, 32), glow(0xff8a1f, 2.5), 0, 0.37, 0, root);
  ring.rotation.x = Math.PI / 2;
  const holo = new THREE.Group();
  holo.position.y = 1.2;
  root.add(holo);
  const crate = mesh(G('BoxGeometry', 0.5, 0.34, 0.34), new THREE.MeshBasicMaterial({ color: 0xff8a1f, transparent: true, opacity: 0.55, toneMapped: false, wireframe: true }), 0, 0, 0, holo);
  const beam = new THREE.Mesh(G('CylinderGeometry', 0.5, 0.8, 1.2, 16, 1, true), new THREE.MeshBasicMaterial({ color: 0xff8a1f, transparent: true, opacity: 0.08, side: THREE.DoubleSide, depthWrite: false, toneMapped: false }));
  beam.position.y = 0.95;
  root.add(beam);
  return { root, ring, holo, crate, beam };
}

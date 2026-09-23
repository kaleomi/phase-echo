// First-person weapon viewmodels in their own scene/camera (rendered after the world with a cleared depth
// buffer so guns never clip into walls). Hands sit on the grip and fore-grip and the forearms leave the
// frame through the bottom edge. Handles sway, bob, recoil kick, reload/swap motions and muzzle flash.
import * as THREE from 'three';

const std = (color, emissive = 0, ei = 0) => new THREE.MeshStandardMaterial({ color, emissive, emissiveIntensity: ei, roughness: 0.38, metalness: 0.6 });
const glow = (color, i = 3) => new THREE.MeshStandardMaterial({ color: 0x000000, emissive: color, emissiveIntensity: i, roughness: 1 });
function box(parent, w, h, d, mat, x, y, z) { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y, z); parent.add(m); return m; }
function cyl(parent, r1, r2, len, mat, x, y, z, seg = 12) { const m = new THREE.Mesh(new THREE.CylinderGeometry(r1, r2, len, seg), mat); m.rotation.x = Math.PI / 2; m.position.set(x, y, z); parent.add(m); return m; }
const Y = new THREE.Vector3(0, 1, 0);
function limb(parent, a, b, r, mat) {
  const dir = new THREE.Vector3().subVectors(b, a), len = dir.length();
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.82, r, len, 10), mat);
  m.position.copy(a).addScaledVector(dir, 0.5);
  m.quaternion.setFromUnitVectors(Y, dir.normalize());
  parent.add(m);
  return m;
}

const glove = std(0x1c1f29), sleeve = std(0x10131b), cuffGlow = glow(0x22e6ff, 1.2);
// A gloved hand wrapped around a grip at `at` (gun-local), forearm running to `elbow` (out of frame).
function hand(parent, at, elbow, { vertical = true } = {}) {
  const g = new THREE.Group();
  g.position.copy(at);
  parent.add(g);
  if (vertical) {
    box(g, 0.052, 0.07, 0.07, glove, 0, 0, 0.012);
    for (let i = 0; i < 3; i++) box(g, 0.056, 0.016, 0.022, glove, 0, 0.022 - i * 0.022, -0.03);
    box(g, 0.02, 0.018, 0.05, glove, -0.03, 0.03, -0.01);
  } else {
    box(g, 0.075, 0.03, 0.08, glove, 0, -0.025, 0);
    box(g, 0.02, 0.045, 0.07, glove, 0.04, 0, 0);
    box(g, 0.02, 0.045, 0.07, glove, -0.04, 0, 0);
  }
  const local = elbow.clone().sub(at);
  const wrist = local.clone().multiplyScalar(0.18);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.034, 0.005, 6, 16), cuffGlow);
  ring.position.copy(wrist);
  ring.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), local.clone().normalize());
  g.add(ring);
  limb(g, wrist, local, 0.036, sleeve);
  limb(g, new THREE.Vector3(0, 0, 0), wrist, 0.03, glove);
  return g;
}

function carbine() {
  const g = new THREE.Group(), body = std(0x2a3040), dark = std(0x12141b), accent = glow(0x22e6ff, 3.2);
  box(g, 0.062, 0.085, 0.44, body, 0, 0, -0.17);
  box(g, 0.064, 0.01, 0.3, accent, 0, 0.032, -0.2).scale.set(1.02, 1, 1);
  box(g, 0.058, 0.07, 0.25, dark, 0, -0.004, -0.5);
  for (let i = 0; i < 4; i++) box(g, 0.06, 0.008, 0.012, accent, 0, -0.03, -0.42 - i * 0.05);
  cyl(g, 0.013, 0.013, 0.16, dark, 0, 0.004, -0.7, 8);
  cyl(g, 0.02, 0.02, 0.04, body, 0, 0.004, -0.78, 10);
  box(g, 0.04, 0.12, 0.055, dark, 0, -0.09, -0.01).rotation.x = 0.28;
  const mag = box(g, 0.04, 0.13, 0.065, body, 0, -0.1, -0.2);
  mag.rotation.x = -0.12;
  box(g, 0.042, 0.012, 0.068, accent, 0, -0.165, -0.21);
  box(g, 0.055, 0.075, 0.18, body, 0, -0.01, 0.13);
  // Holo sight: frame + faint glass; centre height 0.085 above the gun origin.
  box(g, 0.03, 0.028, 0.08, dark, 0, 0.056, -0.1);
  const frame = new THREE.Mesh(new THREE.TorusGeometry(0.016, 0.0018, 6, 20), new THREE.MeshBasicMaterial({ color: 0x1b8fa3, toneMapped: false }));
  frame.position.set(0, 0.085, -0.12);
  g.add(frame);
  const dot = new THREE.Mesh(new THREE.CircleGeometry(0.0025, 10), new THREE.MeshBasicMaterial({ color: 0xff3355, toneMapped: false }));
  dot.position.set(0, 0.085, -0.121);
  dot.rotation.y = Math.PI;
  g.add(dot);
  hand(g, new THREE.Vector3(0, -0.07, -0.005), new THREE.Vector3(0.1, -0.34, 0.26));
  hand(g, new THREE.Vector3(-0.005, -0.045, -0.5), new THREE.Vector3(-0.2, -0.32, -0.2), { vertical: false });
  return { g, mag, muzzle: new THREE.Vector3(0, 0.004, -0.81), accent, hip: new THREE.Vector3(0.13, -0.15, -0.3), ads: new THREE.Vector3(0, -0.085, -0.2) };
}

function scatter() {
  const g = new THREE.Group(), body = std(0x322a22), dark = std(0x141210), accent = glow(0xff8a1f, 3.2);
  box(g, 0.08, 0.09, 0.4, body, 0, 0, -0.12);
  cyl(g, 0.025, 0.025, 0.46, dark, 0.02, 0.012, -0.52);
  cyl(g, 0.025, 0.025, 0.46, dark, -0.02, 0.012, -0.52);
  const pump = new THREE.Group();
  g.add(pump);
  box(pump, 0.085, 0.055, 0.17, body, 0, -0.035, -0.45);
  for (let i = 0; i < 3; i++) box(pump, 0.088, 0.006, 0.012, accent, 0, -0.035, -0.4 - i * 0.05);
  box(g, 0.082, 0.01, 0.34, accent, 0, 0.046, -0.12);
  for (let i = 0; i < 3; i++) box(g, 0.012, 0.03, 0.016, accent, 0.045, 0, -0.03 - i * 0.05);
  box(g, 0.045, 0.12, 0.06, dark, 0, -0.1, 0.04).rotation.x = 0.3;
  box(g, 0.06, 0.08, 0.2, body, 0, -0.015, 0.17);
  box(g, 0.012, 0.02, 0.012, accent, 0, 0.062, -0.72);
  box(g, 0.03, 0.02, 0.02, dark, 0, 0.062, -0.05);
  hand(g, new THREE.Vector3(0, -0.075, 0.035), new THREE.Vector3(0.1, -0.34, 0.28));
  hand(pump, new THREE.Vector3(-0.005, -0.05, -0.45), new THREE.Vector3(-0.2, -0.32, -0.16), { vertical: false });
  return { g, pump, muzzle: new THREE.Vector3(0, 0.012, -0.76), accent, hip: new THREE.Vector3(0.14, -0.16, -0.32), ads: new THREE.Vector3(0, -0.075, -0.22) };
}

function rail() {
  const g = new THREE.Group(), body = std(0x2a2433), dark = std(0x100e14), accent = glow(0xff2bd6, 3.2);
  box(g, 0.064, 0.09, 0.52, body, 0, 0, -0.15);
  box(g, 0.04, 0.03, 0.5, dark, 0, 0.025, -0.64);
  box(g, 0.04, 0.03, 0.5, dark, 0, -0.025, -0.64);
  const coils = [];
  for (let i = 0; i < 5; i++) {
    const c = new THREE.Mesh(new THREE.TorusGeometry(0.045, 0.009, 6, 18), accent.clone());
    c.position.set(0, 0, -0.46 - i * 0.085);
    g.add(c);
    coils.push(c);
  }
  // Scope tube with a lens; centre height 0.085.
  cyl(g, 0.022, 0.022, 0.2, dark, 0, 0.085, -0.13);
  cyl(g, 0.026, 0.026, 0.02, body, 0, 0.085, -0.03);
  cyl(g, 0.026, 0.026, 0.02, body, 0, 0.085, -0.23);
  box(g, 0.02, 0.03, 0.03, dark, 0, 0.055, -0.13);
  const lens = new THREE.Mesh(new THREE.CircleGeometry(0.02, 16), new THREE.MeshBasicMaterial({ color: 0xff2bd6, toneMapped: false, transparent: true, opacity: 0.55 }));
  lens.position.set(0, 0.085, -0.021);
  g.add(lens);
  const cell = box(g, 0.05, 0.1, 0.075, accent, 0, -0.09, -0.12);
  box(g, 0.04, 0.12, 0.055, dark, 0, -0.09, 0.03).rotation.x = 0.28;
  box(g, 0.056, 0.08, 0.2, body, 0, -0.01, 0.2);
  hand(g, new THREE.Vector3(0, -0.07, 0.02), new THREE.Vector3(0.1, -0.34, 0.28));
  hand(g, new THREE.Vector3(-0.005, -0.05, -0.36), new THREE.Vector3(-0.2, -0.32, -0.08), { vertical: false });
  return { g, coils, cell, muzzle: new THREE.Vector3(0, 0, -0.9), accent, hip: new THREE.Vector3(0.13, -0.15, -0.3), ads: new THREE.Vector3(0, -0.085, -0.12) };
}

export function createViewmodel() {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(54, 1, 0.01, 10);
  scene.add(new THREE.HemisphereLight(0xa9c8ff, 0x2a1433, 1.6));
  const key = new THREE.DirectionalLight(0xffffff, 2.4);
  key.position.set(1, 2, 1.5);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0xff2bd6, 1.4);
  rim.position.set(-2, 0.5, -1);
  scene.add(rim);
  const rig = new THREE.Group();
  camera.add(rig);
  scene.add(camera);
  const guns = [carbine(), scatter(), rail()];
  for (const gun of guns) { gun.g.visible = false; rig.add(gun.g); }
  const flashMat = new THREE.SpriteMaterial({ color: 0xffffff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
  const flash = new THREE.Sprite(flashMat);
  rig.add(flash);
  const flashLight = new THREE.PointLight(0xffc080, 0, 2, 2);
  camera.add(flashLight); // never hidden: toggling a light's visibility would rebuild every shader program
  const s = { index: 0, swap: 0, kick: 0, kickRot: 0, flash: 0, swayX: 0, swayY: 0, bob: 0, pump: 0, shell: 0, landDip: 0, t: 0 };
  guns[0].g.visible = true;
  const colors = [0x9ff6ff, 0xffc27a, 0xff9cf0];
  const tmp = new THREE.Vector3();

  return {
    scene, camera,
    setAspect(a) { camera.aspect = a; camera.updateProjectionMatrix(); },
    select(i) { s.index = i; s.swap = 1; guns.forEach((g, k) => { g.g.visible = k === i; }); },
    fire(i) {
      s.kick = i === 1 ? 1 : i === 2 ? 1.2 : 0.45;
      s.kickRot = s.kick;
      s.flash = 1;
      if (i === 1) s.pump = 1;
      flashMat.color.setHex(colors[i]);
      flashLight.color.setHex(colors[i]);
      flashMat.rotation = Math.random() * Math.PI;
    },
    shellIn() { s.shell = 1; },
    land(v) { s.landDip = Math.min(1, v / 14); },
    look(dx, dy) { s.swayX = Math.max(-1, Math.min(1, s.swayX + dx * 0.0025)); s.swayY = Math.max(-1, Math.min(1, s.swayY + dy * 0.0025)); },
    update(dt, st) {
      s.t += dt;
      const gun = guns[s.index];
      s.swap = Math.max(0, s.swap - dt / 0.3);
      s.kick = Math.max(0, s.kick - dt * 9);
      s.kickRot = Math.max(0, s.kickRot - dt * 7);
      s.flash = Math.max(0, s.flash - dt * 22);
      s.pump = Math.max(0, s.pump - dt * 2.4);
      s.shell = Math.max(0, s.shell - dt * 5);
      s.landDip = Math.max(0, s.landDip - dt * 4);
      s.swayX *= Math.exp(-dt * 10);
      s.swayY *= Math.exp(-dt * 10);
      const ads = st.ads;
      const base = tmp.copy(gun.hip).lerp(gun.ads, ads);
      const speed = Math.min(1, st.speed / 7.4);
      if (st.grounded) s.bob += dt * (6 + speed * 5) * (speed > 0.1 ? 1 : 0.25);
      const bobAmt = (speed * 0.014 + 0.0015) * (1 - ads * 0.85);
      const bx = Math.sin(s.bob) * bobAmt, by = -Math.abs(Math.cos(s.bob)) * bobAmt;
      const reloadK = st.reloading ? Math.sin(Math.min(1, Math.max(0, 1 - st.reloadLeft / Math.max(0.01, st.reloadTotal))) * Math.PI) : 0;
      const shellK = st.reloading && st.perShell ? 0.35 : 0;
      const dip = st.perShell ? shellK : reloadK;
      const swapK = s.swap;
      const sway = 1 - ads * 0.8;
      gun.g.position.set(
        base.x + bx - s.swayX * 0.02 * sway,
        base.y + by + s.swayY * 0.015 * sway - dip * 0.07 - swapK * 0.25 - s.landDip * 0.035,
        base.z + s.kick * 0.05,
      );
      // Swap: the new gun rises from below with its muzzle dipped; reload: a small tilt and roll.
      gun.g.rotation.set(s.kickRot * 0.1 + dip * 0.28 - swapK * 0.7, -s.swayX * 0.06 + (st.dash ? 0.08 : 0), dip * 0.3 - s.swayX * 0.04);
      if (gun.pump) gun.pump.position.z = Math.sin(Math.min(1, s.pump) * Math.PI) * 0.08 + s.shell * 0.035;
      if (gun.mag) gun.mag.position.y = -0.1 - reloadK * 0.2;
      if (gun.coils) {
        const charge = st.ready ? 1 : 0.25;
        gun.coils.forEach((c, i) => { c.material.emissiveIntensity = (1.5 + 2.5 * charge) * (0.7 + 0.3 * Math.sin(s.t * 8 - i)); });
      }
      gun.accent.emissiveIntensity = 2.6 + s.flash * 4;
      const m = gun.muzzle.clone();
      gun.g.localToWorld(m);
      rig.worldToLocal(m);
      flash.position.copy(m);
      flashLight.position.copy(m); // rig has an identity transform relative to the camera
      flashMat.opacity = s.flash;
      flash.scale.setScalar(0.12 + s.flash * (s.index === 1 ? 0.3 : 0.18));
      flashLight.intensity = s.flash * 4;
      gun.g.visible = !st.hidden;
      flash.visible = !st.hidden;
      if (st.hidden) flashLight.intensity = 0;
    },
    // World-space point that appears on screen where the drawn muzzle is (the viewmodel uses its own FOV).
    muzzleWorld(target, worldCamera, distance = 0.7) {
      const gun = guns[s.index], m = gun.muzzle.clone();
      gun.g.localToWorld(m);
      camera.updateMatrixWorld();
      m.project(camera);
      target.set(m.x, m.y, 0.5).unproject(worldCamera);
      const origin = worldCamera.getWorldPosition(new THREE.Vector3());
      return target.sub(origin).normalize().multiplyScalar(distance).add(origin);
    },
  };
}

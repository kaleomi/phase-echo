// Pooled visual effects: tracers/beams, sparks, explosions, shock rings, telegraph markers, projectiles.
import * as THREE from 'three';
import { glowTexture, ringTexture } from './textures.js';

const glowTex = glowTexture(), ringTex = ringTexture();
const UP = new THREE.Vector3(0, 1, 0);

export function createEffects(scene) {
  const group = new THREE.Group();
  group.name = 'effects';
  scene.add(group);
  const live = [];

  // ---------------------------------------------------------------- tracers (stretched cylinders)
  const tracerGeo = new THREE.CylinderGeometry(1, 1, 1, 6, 1, true);
  tracerGeo.translate(0, 0.5, 0);
  tracerGeo.rotateX(Math.PI / 2);
  // Every transient effect object (and its material) comes from a pool and is never disposed: disposing the
  // last material of a kind makes Three.js destroy the shader program, and the next effect of that kind would
  // then recompile it (a hitch on GPUs; JIT memory churn that eventually crashes software renderers).
  const pools = new Map();
  function take(kind, make) {
    const free = pools.get(kind);
    const o = free && free.length ? free.pop() : make();
    o.userData.pool = kind;
    o.visible = true;
    return o;
  }
  function give(o) {
    o.visible = false;
    const kind = o.userData.pool;
    if (!pools.has(kind)) pools.set(kind, []);
    pools.get(kind).push(o);
  }
  const additive = extra => ({ transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, ...extra });
  const makeTracer = () => { const m = new THREE.Mesh(tracerGeo, new THREE.MeshBasicMaterial(additive())); m.frustumCulled = false; group.add(m); return m; };
  function tracer(from, to, color, width, life, opacity = 0.9) {
    const m = take('tracer', makeTracer);
    m.material.color.set(color);
    m.material.opacity = opacity;
    m.position.copy(from);
    m.lookAt(to);
    m.scale.set(width, width, Math.max(0.01, from.distanceTo(to)));
    live.push({ obj: m, life, max: life, kind: 'tracer', w: width, fade: opacity });
  }

  // ---------------------------------------------------------------- sparks (points with velocities)
  const MAXP = 1400;
  const pPos = new Float32Array(MAXP * 3), pCol = new Float32Array(MAXP * 3), pVel = new Float32Array(MAXP * 3), pLife = new Float32Array(MAXP), pMax = new Float32Array(MAXP), pGrav = new Float32Array(MAXP);
  const pGeo = new THREE.BufferGeometry();
  pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3));
  pGeo.setAttribute('color', new THREE.BufferAttribute(pCol, 3));
  const pMat = new THREE.PointsMaterial({ size: 0.16, map: glowTex, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false });
  const points = new THREE.Points(pGeo, pMat);
  points.frustumCulled = false;
  group.add(points);
  let pNext = 0;
  const tmpC = new THREE.Color();
  function sparks(pos, color, count, speed = 6, life = 0.45, gravity = 9, normal = null) {
    tmpC.set(color);
    for (let i = 0; i < count; i++) {
      const k = pNext;
      pNext = (pNext + 1) % MAXP;
      let vx = Math.random() * 2 - 1, vy = Math.random() * 2 - 1, vz = Math.random() * 2 - 1;
      const l = Math.hypot(vx, vy, vz) || 1;
      vx /= l; vy /= l; vz /= l;
      if (normal) { const d = vx * normal.x + vy * normal.y + vz * normal.z; if (d < 0) { vx -= 2 * d * normal.x; vy -= 2 * d * normal.y; vz -= 2 * d * normal.z; } }
      const s = speed * (0.3 + Math.random() * 0.7);
      pPos[k * 3] = pos.x; pPos[k * 3 + 1] = pos.y; pPos[k * 3 + 2] = pos.z;
      pVel[k * 3] = vx * s; pVel[k * 3 + 1] = vy * s + speed * 0.2; pVel[k * 3 + 2] = vz * s;
      pCol[k * 3] = tmpC.r; pCol[k * 3 + 1] = tmpC.g; pCol[k * 3 + 2] = tmpC.b;
      pLife[k] = life * (0.5 + Math.random() * 0.5); pMax[k] = pLife[k]; pGrav[k] = gravity;
    }
  }

  // ---------------------------------------------------------------- flashes / explosions / rings
  const planeGeo = new THREE.PlaneGeometry(2, 2), discGeo = new THREE.CircleGeometry(1, 32);
  const makeFlash = () => { const sp = new THREE.Sprite(new THREE.SpriteMaterial(additive({ map: glowTex }))); group.add(sp); return sp; };
  function flash(pos, color, size, life) {
    const sp = take('flash', makeFlash);
    sp.material.color.set(color);
    sp.material.opacity = 1;
    sp.position.copy(pos);
    sp.scale.setScalar(size);
    live.push({ obj: sp, life, max: life, kind: 'flash', size });
  }
  const makeRing = () => { const m = new THREE.Mesh(planeGeo, new THREE.MeshBasicMaterial(additive({ map: ringTex, side: THREE.DoubleSide }))); group.add(m); return m; };
  function ring(pos, color, from, to, life, flat = true) {
    const m = take('ring', makeRing);
    m.material.color.set(color);
    m.material.opacity = 1;
    m.position.copy(pos);
    m.rotation.set(flat ? -Math.PI / 2 : 0, 0, 0);
    m.scale.setScalar(Math.max(0.01, from));
    live.push({ obj: m, life, max: life, kind: 'ring', from, to });
    return m;
  }
  function explosion(pos, color, radius) {
    flash(pos, color, radius * 2.2, 0.35);
    flash(pos, 0xffffff, radius * 1.1, 0.15);
    ring(pos.clone().setY(Math.max(0.05, pos.y - 0.3)), color, 0.2, radius * 1.1, 0.45);
    sparks(pos, color, 40, radius * 4, 0.7, 6);
  }
  // Fixed pool: the scene's light count never changes, so Three.js never has to recompile shader programs
  // when an explosion lights up (adding/removing lights at runtime causes a full program rebuild).
  const lightPool = Array.from({ length: 3 }, () => {
    const l = new THREE.PointLight(0xffffff, 0, 10, 2);
    group.add(l);
    return { l, life: 0, max: 1, intensity: 0 };
  });
  function light(pos, color, intensity, dist, life) {
    const slot = lightPool.reduce((a, b) => (b.life < a.life ? b : a));
    slot.l.color.set(color);
    slot.l.distance = dist;
    slot.l.position.copy(pos);
    slot.l.intensity = intensity;
    Object.assign(slot, { life, max: life, intensity });
  }
  // Ground shockwave: an expanding tall ring whose radius the renderer syncs to the simulation every frame.
  const shockGeo = new THREE.CylinderGeometry(1, 1, 0.9, 64, 1, true).translate(0, 0.45, 0);
  const makeShock = () => { const m = new THREE.Mesh(shockGeo, new THREE.MeshBasicMaterial(additive({ opacity: 0.55, side: THREE.DoubleSide }))); group.add(m); return m; };
  function shockwave(id, pos, color) {
    const m = take('shock', makeShock);
    m.material.color.set(color);
    m.position.copy(pos);
    m.scale.set(0.01, 1, 0.01);
    return m;
  }
  // Telegraph: pulsing ground circle for mortar landings.
  const makeFill = () => { const m = new THREE.Mesh(discGeo, new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.12, depthWrite: false, toneMapped: false })); m.rotation.x = -Math.PI / 2; group.add(m); return m; };
  function marker(pos, radius, color, life) {
    const m = ring(pos.clone().setY(pos.y + 0.03), color, radius, radius, life, true);
    live[live.length - 1].kind = 'marker';
    const fill = take('fill', makeFill);
    fill.material.color.set(color);
    fill.scale.setScalar(radius);
    fill.position.copy(pos).setY(pos.y + 0.025);
    live.push({ obj: fill, life, max: life, kind: 'markerFill' });
    return m;
  }
  // Creates a few of each pooled object up front so their shader programs can be compiled before play.
  function warm() {
    const objs = [makeTracer(), makeFlash(), makeRing(), makeShock(), makeFill()];
    for (const o of objs) { o.userData.pool = o.material.map === ringTex ? 'ring' : o.isSprite ? 'flash' : o.geometry === tracerGeo ? 'tracer' : o.geometry === shockGeo ? 'shock' : 'fill'; give(o); }
  }
  function update(dt) {
    for (let i = live.length - 1; i >= 0; i--) {
      const e = live[i];
      e.life -= dt;
      const k = Math.max(0, e.life / e.max);
      switch (e.kind) {
        case 'tracer': e.obj.material.opacity = k * e.fade; e.obj.scale.x = e.obj.scale.y = e.w * (0.4 + 0.6 * k); break;
        case 'flash': e.obj.material.opacity = k; e.obj.scale.setScalar(e.size * (1.2 - 0.4 * k)); break;
        case 'ring': { const r = e.to + (e.from - e.to) * k; e.obj.scale.set(r, r, r); e.obj.material.opacity = k; break; }
        case 'marker': e.obj.material.opacity = 0.5 + 0.5 * Math.sin((e.max - e.life) * 18); e.obj.scale.setScalar(e.from * (0.9 + 0.1 * Math.sin((e.max - e.life) * 18))); break;
        case 'markerFill': e.obj.material.opacity = 0.1 + 0.25 * (1 - k); break;
        default: break;
      }
      if (e.life <= 0) {
        give(e.obj);
        live.splice(i, 1);
      }
    }
    for (const slot of lightPool) {
      if (slot.life <= 0) continue;
      slot.life -= dt;
      slot.l.intensity = slot.life > 0 ? slot.intensity * (slot.life / slot.max) : 0;
    }
    for (let k = 0; k < MAXP; k++) {
      if (pLife[k] <= 0) continue;
      pLife[k] -= dt;
      if (pLife[k] <= 0) { pPos[k * 3 + 1] = -100; continue; }
      pVel[k * 3 + 1] -= pGrav[k] * dt;
      const drag = Math.exp(-2.5 * dt);
      pVel[k * 3] *= drag; pVel[k * 3 + 1] *= drag; pVel[k * 3 + 2] *= drag;
      pPos[k * 3] += pVel[k * 3] * dt; pPos[k * 3 + 1] += pVel[k * 3 + 1] * dt; pPos[k * 3 + 2] += pVel[k * 3 + 2] * dt;
      const f = pLife[k] / pMax[k];
      if (f < 0.3) { pCol[k * 3] *= 0.9; pCol[k * 3 + 1] *= 0.9; pCol[k * 3 + 2] *= 0.9; }
    }
    pGeo.attributes.position.needsUpdate = true;
    pGeo.attributes.color.needsUpdate = true;
  }

  function release(obj) { if (obj && obj.userData.pool) give(obj); }
  function clear() {
    for (const e of live) give(e.obj);
    live.length = 0;
    for (const slot of lightPool) { slot.life = 0; slot.l.intensity = 0; }
    pLife.fill(0);
    for (let k = 0; k < MAXP; k++) pPos[k * 3 + 1] = -100;
  }
  for (let k = 0; k < MAXP; k++) pPos[k * 3 + 1] = -100;

  return { group, tracer, sparks, flash, ring, explosion, light, shockwave, marker, update, clear, release, warm, UP, count: () => live.length };
}

// Projectile visuals keyed by sim projectile id (created lazily, removed when the sim drops them).
export function createProjectileViews(scene) {
  const group = new THREE.Group();
  group.name = 'projectiles';
  scene.add(group);
  const views = new Map();
  const styles = {
    bolt: { color: 0xc07bff, size: 0.55, trail: 1.2 },
    needle: { color: 0x7ff6ff, size: 0.4, trail: 1.6 },
    orb: { color: 0xff4fe0, size: 0.95, trail: 0 },
    shell: { color: 0xffb21f, size: 0.7, trail: 0.6 },
  };
  const trailGeo = new THREE.CylinderGeometry(0.5, 0, 1, 6, 1, true);
  trailGeo.translate(0, -0.5, 0);
  trailGeo.rotateX(-Math.PI / 2);
  function make(p) {
    const st = styles[p.kind] || styles.bolt;
    const root = new THREE.Group();
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: st.color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
    sprite.scale.setScalar(st.size);
    root.add(sprite);
    const core = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
    core.scale.setScalar(st.size * 0.4);
    root.add(core);
    let trail = null;
    if (st.trail > 0) {
      trail = new THREE.Mesh(trailGeo, new THREE.MeshBasicMaterial({ color: st.color, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
      trail.scale.set(0.12, 0.12, st.trail);
      root.add(trail);
    }
    group.add(root);
    return { root, trail, kind: p.kind };
  }
  const free = {};
  const tmp = new THREE.Vector3();
  return {
    sync(list, t) {
      const seen = new Set();
      for (const p of list) {
        seen.add(p.id);
        let v = views.get(p.id);
        if (!v) { v = free[p.kind]?.pop() || make(p); v.root.visible = true; views.set(p.id, v); }
        v.root.position.set(p.x, p.y, p.z);
        if (v.trail) { tmp.set(p.x + p.vx, p.y + p.vy, p.z + p.vz); v.root.lookAt(tmp); }
        if (p.kind === 'orb') v.root.scale.setScalar(1 + Math.sin(t * 20 + p.id) * 0.12);
      }
      for (const [id, v] of views) {
        if (!seen.has(id)) { v.root.visible = false; (free[v.kind] ||= []).push(v); views.delete(id); }
      }
    },
    clear() { for (const [, v] of views) { v.root.visible = false; (free[v.kind] ||= []).push(v); } views.clear(); },
    warm() { for (const kind of Object.keys(styles)) { const v = make({ kind }); v.root.visible = false; (free[kind] ||= []).push(v); } },
  };
}

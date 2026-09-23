// Builds the ECHO-7 arena meshes from the pure layout data (src/sim/layout.js).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { floorTexture, panelTexture, hazardTexture, skyTexture, glowTexture } from './textures.js';
import { HALF, WALL_HEIGHT } from '../sim/layout.js';

export const NEON = { cyan: 0x22e6ff, magenta: 0xff2bd6, orange: 0xff8a1f, dim: 0x3b5b8a, lime: 0x9dff3a, red: 0xff3355 };

export function buildArena(scene, layout, renderer) {
  const group = new THREE.Group();
  group.name = 'arena';
  const sky = skyTexture();
  scene.background = sky;
  scene.fog = new THREE.FogExp2(0x0a0718, 0.012);

  const floorTex = floorTexture(renderer);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(HALF * 2 + 2, HALF * 2 + 2), new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.55, metalness: 0.35, color: 0xffffff }));
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  floor.name = 'floor';
  group.add(floor);

  // Glowing grid lines inlaid into the floor, every 8 m.
  const lineMat = new THREE.MeshBasicMaterial({ color: NEON.cyan, transparent: true, opacity: 0.22, depthWrite: false });
  const lines = [];
  for (let i = -HALF + 8; i < HALF; i += 8) {
    lines.push(new THREE.PlaneGeometry(HALF * 2, 0.06).rotateX(-Math.PI / 2).translate(0, 0.012, i));
    lines.push(new THREE.PlaneGeometry(0.06, HALF * 2).rotateX(-Math.PI / 2).translate(i, 0.012, 0));
  }
  group.add(new THREE.Mesh(mergeGeometries(lines, false), lineMat));

  const wallTex = panelTexture(renderer, '#22e6ff');
  const warmTex = panelTexture(renderer, '#ff8a1f');
  const mats = {
    wall: new THREE.MeshStandardMaterial({ map: wallTex, roughness: 0.7, metalness: 0.45 }),
    dais: new THREE.MeshStandardMaterial({ color: 0x1a1830, roughness: 0.4, metalness: 0.6, emissive: 0x12051a, emissiveIntensity: 1 }),
    platform: new THREE.MeshStandardMaterial({ map: warmTex, roughness: 0.6, metalness: 0.4 }),
    step: new THREE.MeshStandardMaterial({ color: 0x1b2233, roughness: 0.65, metalness: 0.4 }),
    pillar: new THREE.MeshStandardMaterial({ map: wallTex, roughness: 0.55, metalness: 0.55 }),
    cover: new THREE.MeshStandardMaterial({ color: 0x232a3d, roughness: 0.5, metalness: 0.5 }),
    crate: new THREE.MeshStandardMaterial({ map: warmTex, roughness: 0.5, metalness: 0.5, color: 0xffc9a0 }),
  };
  const trimMats = {};
  const trimMat = color => (trimMats[color] ||= new THREE.MeshBasicMaterial({ color: NEON[color] ?? NEON.dim, toneMapped: false }));

  // Static boxes and trims are batched per material and merged into a handful of draw calls.
  const batches = new Map();
  const batch = (geo, mat, x, y, z, cast) => {
    geo.translate(x, y, z);
    if (!batches.has(mat)) batches.set(mat, { geos: [], cast: false });
    const entry = batches.get(mat);
    entry.geos.push(geo.index ? geo.toNonIndexed() : geo);
    entry.cast = entry.cast || cast;
  };
  for (const b of layout.boxes) {
    const w = b.maxX - b.minX, h = b.maxY - b.minY, d = b.maxZ - b.minZ;
    const geo = new THREE.BoxGeometry(w, h, d);
    if (b.kind === 'wall' || b.kind === 'pillar' || b.kind === 'platform' || b.kind === 'crate') {
      // scale UVs so panels keep a ~4 m module regardless of box size
      const uv = geo.attributes.uv, pos = geo.attributes.position, nrm = geo.attributes.normal;
      for (let i = 0; i < uv.count; i++) {
        const nx = Math.abs(nrm.getX(i)), ny = Math.abs(nrm.getY(i));
        const u = nx > 0.5 ? pos.getZ(i) : pos.getX(i), v = ny > 0.5 ? pos.getZ(i) : pos.getY(i);
        uv.setXY(i, u / 4 + 0.5, v / 4 + 0.5);
      }
    }
    const cx = (b.minX + b.maxX) / 2, cy = (b.minY + b.maxY) / 2, cz = (b.minZ + b.maxZ) / 2;
    batch(geo, mats[b.kind] || mats.cover, cx, cy, cz, b.kind !== 'wall');
    if (b.trim) {
      // Neon trim along the top edges.
      const t = 0.07, mat = trimMat(b.trim), y = b.maxY + 0.001;
      const edges = [[w + t, t, 0, -d / 2], [w + t, t, 0, d / 2], [t, d + t, -w / 2, 0], [t, d + t, w / 2, 0]];
      for (const [ew, ed, ox, oz] of edges) batch(new THREE.BoxGeometry(ew, t, ed), mat, cx + ox, y - t / 2, cz + oz, false);
      if (b.kind === 'pillar' || b.kind === 'wall') batch(new THREE.BoxGeometry(w + 0.02, 0.08, d + 0.02), mat, cx, b.minY + Math.min(h, WALL_HEIGHT) * 0.42, cz, false);
    }
  }
  for (const [mat, entry] of batches) {
    const merged = new THREE.Mesh(mergeGeometries(entry.geos, false), mat);
    merged.castShadow = entry.cast;
    merged.receiveShadow = !(mat instanceof THREE.MeshBasicMaterial);
    merged.name = `arena-batch-${mat.type}`;
    group.add(merged);
    entry.geos.forEach(g0 => g0.dispose());
  }

  // Dais: animated ring + hazard strip around the pads.
  const hz = hazardTexture();
  const padMat = new THREE.MeshBasicMaterial({ color: NEON.lime, transparent: true, opacity: 0.85, toneMapped: false, depthWrite: false });
  const padRingMat = new THREE.MeshBasicMaterial({ map: hz, transparent: true, opacity: 0.9, depthWrite: false });
  const pads = [];
  for (const p of layout.pads) {
    const disc = new THREE.Mesh(new THREE.CircleGeometry(p.r * 0.8, 40), padMat.clone());
    disc.rotation.x = -Math.PI / 2; disc.position.set(p.x, 0.02, p.z);
    const ring = new THREE.Mesh(new THREE.RingGeometry(p.r * 0.85, p.r * 1.12, 40, 1), padRingMat);
    ring.rotation.x = -Math.PI / 2; ring.position.set(p.x, 0.018, p.z);
    const arrow = new THREE.Mesh(new THREE.ConeGeometry(0.35, 0.7, 3), new THREE.MeshBasicMaterial({ color: NEON.lime, toneMapped: false, transparent: true, opacity: 0.8 }));
    arrow.position.set(p.x, 0.6, p.z);
    group.add(disc, ring, arrow);
    pads.push({ disc, arrow, pad: p });
  }
  const daisRing = new THREE.Mesh(new THREE.TorusGeometry(3.6, 0.05, 8, 80), new THREE.MeshBasicMaterial({ color: NEON.magenta, toneMapped: false }));
  daisRing.rotation.x = Math.PI / 2; daisRing.position.set(0, 3.03, 0);
  group.add(daisRing);

  // Spawn gates: glowing frames in the outer walls that flare before an enemy arrives.
  const gates = layout.gates.map(gt => {
    const frame = new THREE.Group();
    const mat = new THREE.MeshBasicMaterial({ color: NEON.magenta, toneMapped: false, transparent: true, opacity: 0.55 });
    const portal = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 3.4), new THREE.MeshBasicMaterial({ color: NEON.magenta, transparent: true, opacity: 0.08, side: THREE.DoubleSide, depthWrite: false, toneMapped: false }));
    portal.position.y = 1.7;
    const top = new THREE.Mesh(new THREE.BoxGeometry(3, 0.12, 0.12), mat); top.position.y = 3.45;
    const l = new THREE.Mesh(new THREE.BoxGeometry(0.12, 3.5, 0.12), mat); l.position.set(-1.45, 1.75, 0);
    const r = l.clone(); r.position.x = 1.45;
    frame.add(portal, top, l, r);
    frame.position.set(gt.x + gt.nx * 0.02, 0, gt.z + gt.nz * 0.02);
    frame.rotation.y = Math.atan2(gt.nx, gt.nz);
    group.add(frame);
    return { frame, portal, mat, warn: 0 };
  });

  // Lights: cool key + hemisphere + coloured accents.
  const hemi = new THREE.HemisphereLight(0x7fa7ff, 0x1a0b22, 0.9);
  const key = new THREE.DirectionalLight(0xcfe3ff, 1.5);
  key.position.set(18, 30, 12);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  Object.assign(key.shadow.camera, { left: -36, right: 36, top: 36, bottom: -36, near: 1, far: 90 });
  key.shadow.bias = -0.0006;
  key.shadow.normalBias = 0.04;
  const accents = [];
  for (const [x, z, c] of [[20, 20, NEON.orange], [-20, -20, NEON.orange], [20, -20, NEON.cyan], [-20, 20, NEON.cyan]]) {
    const l = new THREE.PointLight(c, 18, 22, 1.6); l.position.set(x, 4, z); accents.push(l);
  }
  const core = new THREE.PointLight(NEON.magenta, 30, 26, 1.5); core.position.set(0, 6, 0);
  const resetCore = () => { core.position.set(0, 6, 0); core.intensity = 30; core.distance = 26; };
  group.add(hemi, key, key.target, core, ...accents);

  // Floating dust motes.
  const n = 320, pos = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { pos[i * 3] = (Math.random() - 0.5) * 64; pos[i * 3 + 1] = Math.random() * 10; pos[i * 3 + 2] = (Math.random() - 0.5) * 64; }
  const dustGeo = new THREE.BufferGeometry();
  dustGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const dust = new THREE.Points(dustGeo, new THREE.PointsMaterial({ size: 0.045, map: glowTexture(), color: 0x9fd8ff, transparent: true, opacity: 0.3, depthWrite: false, blending: THREE.AdditiveBlending }));
  group.add(dust);

  scene.add(group);
  return {
    group, key, core, gates, pads, resetCore,
    setShadows(on) { key.castShadow = on; },
    // Low quality drops the four accent lights (one-off program rebuild when the setting changes).
    setAccents(on) { for (const l of accents) l.visible = on; },
    update(t, dt) {
      daisRing.rotation.z = t * 0.4;
      daisRing.material.color.setHSL(0.86 + Math.sin(t * 0.7) * 0.03, 1, 0.55);
      for (const p of pads) { p.arrow.position.y = 0.6 + Math.sin(t * 4 + p.pad.x) * 0.15; p.arrow.rotation.y = t * 2; p.disc.material.opacity = 0.55 + Math.sin(t * 6) * 0.25; }
      for (const g of gates) {
        g.warn = Math.max(0, g.warn - dt);
        const k = g.warn > 0 ? 0.5 + 0.5 * Math.sin(t * 30) : 0;
        g.portal.material.opacity = 0.08 + k * 0.5;
        g.mat.opacity = 0.55 + k * 0.45;
      }
      const arr = dust.geometry.attributes.position.array;
      for (let i = 1; i < arr.length; i += 3) { arr[i] += dt * 0.15; if (arr[i] > 10) arr[i] = 0; }
      dust.geometry.attributes.position.needsUpdate = true;
    },
  };
}

// Scene renderer: maps simulation state to Three.js objects every frame and turns sim events into
// effects, camera shake and sounds. Holds no gameplay state of its own.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { buildArena, NEON } from './arena.js';
import { createEnemyModel, createBossModel, createEchoModel, createPickupModel, createStationModel, disposeModel } from './models.js';
import { createEffects, createProjectileViews } from './effects.js';
import { createViewmodel } from './viewmodel.js';
import { PLAYER } from '../sim/player.js';
import { platePositions, BOSS } from '../sim/boss.js';
import { ECHO } from '../sim/echo.js';

const WEAPON_COLORS = { carbine: 0x22e6ff, scatter: 0xff9a3c, rail: 0xff2bd6 };
const ENEMY_COLORS = { stalker: 0xff8a1f, sentinel: 0xb35cff, wisp: 0x7ff6ff, bulwark: 0xffc21f, boss: 0xff2bd6 };

export function createRenderer(canvas, settings) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance', preserveDrawingBuffer: false });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.autoClear = false;
  renderer.info.autoReset = false; // count draw calls across the world + viewmodel passes of one frame
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(settings.fov, 1, 0.05, 300);
  camera.rotation.order = 'YXZ';
  scene.add(camera);
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.85, 0.55, 0.62);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
  const vm = createViewmodel();
  const fx = createEffects(scene);
  // Permanent light for the echo (intensity 0 when idle) - keeps the scene light count constant.
  const beamGeo = new THREE.CylinderGeometry(1, 1, 1, 8, 1, true).translate(0, 0.5, 0).rotateX(Math.PI / 2);
  const echoLight = new THREE.PointLight(0x33f0ff, 0, 7, 2);
  scene.add(echoLight);
  const projViews = createProjectileViews(scene);
  let arena = null, layoutRef = null;
  const enemyViews = new Map(), pickupViews = new Map(), shockViews = new Map(), beamViews = new Map(), freeBeams = [];
  let warmed = false;
  let bossView = null, echoView = null, stationViews = [];
  const shake = { t: 0, amp: 0 };
  const kick = { pitch: 0 };
  let fovKick = 0, echoFx = 0, hurtFx = 0, time = 0, quality = settings.quality;
  const tmpV = new THREE.Vector3(), tmpV2 = new THREE.Vector3(), muzzle = new THREE.Vector3();

  // Pixel ratio = quality cap x dynamic resolution scale. The composer keeps its own pixel ratio (captured
  // once at construction, i.e. 1), so it must be updated too - otherwise high/medium quality rendered the
  // scene at 1x and stretched it on HiDPI screens.
  let resScale = 1;
  function applyPixelRatio() {
    const cap = Math.min(window.devicePixelRatio || 1, quality === 'high' ? 2 : quality === 'medium' ? 1.5 : 1);
    const pr = Math.max(0.5, cap * resScale);
    renderer.setPixelRatio(pr);
    composer.setPixelRatio(pr);
    resize();
  }
  function setQuality(q) {
    quality = q;
    renderer.shadowMap.enabled = q !== 'low';
    if (arena) { arena.setShadows(q !== 'low'); arena.setAccents(q !== 'low'); }
    bloom.enabled = q !== 'low';
    applyPixelRatio();
  }
  function setResolutionScale(s) {
    const v = Math.max(0.5, Math.min(1, s));
    if (Math.abs(v - resScale) < 1e-3) return;
    resScale = v;
    applyPixelRatio();
  }
  function resize() {
    const w = canvas.clientWidth || window.innerWidth, h = canvas.clientHeight || window.innerHeight;
    renderer.setSize(w, h, false);
    composer.setSize(w, h);
    bloom.resolution.set(w / 2, h / 2);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    vm.setAspect(w / h);
  }

  function setup(game) {
    clearWorld();
    layoutRef = game.layout;
    if (!arena) arena = buildArena(scene, game.layout, renderer);
    stationViews = game.stations.map(st => {
      const v = createStationModel();
      v.root.position.set(st.x, 0, st.z);
      scene.add(v.root);
      return v;
    });
    setQuality(quality);
    if (!warmed) warmUp();
  }

  // Compile every shader variant the run can need (enemies, boss, echo, pickups, pooled effects) once, up
  // front, so the first spawn / explosion / boss appearance never stalls on shader compilation.
  function warmUp() {
    warmed = true;
    const tmp = new THREE.Group();
    for (const t of ['stalker', 'sentinel', 'wisp', 'bulwark']) tmp.add(createEnemyModel(t).root);
    tmp.add(createBossModel().root, createEchoModel().root, createPickupModel('health').root, createPickupModel('ammo').root);
    tmp.position.set(0, -50, 0);
    scene.add(tmp);
    fx.warm();
    projViews.warm();
    try {
      renderer.compile(scene, camera);
      renderer.compile(vm.scene, vm.camera);
    } catch (err) { console.warn('shader warm-up skipped', err); }
    scene.remove(tmp);
  }

  function clearWorld() {
    for (const [, v] of enemyViews) disposeModel(v.root);
    enemyViews.clear();
    for (const [, v] of pickupViews) disposeModel(v.root);
    pickupViews.clear();
    for (const [, v] of shockViews) fx.release(v);
    shockViews.clear();
    for (const [, v] of beamViews) { v.group.visible = false; freeBeams.push(v); }
    beamViews.clear();
    if (bossView) { disposeModel(bossView.root); bossView = null; }
    arena?.resetCore();
    if (echoView) { disposeModel(echoView.root); echoView = null; }
    echoLight.intensity = 0;
    for (const s of stationViews) disposeModel(s.root);
    stationViews = [];
    projViews.clear();
    fx.clear();
  }

  // ---------------------------------------------------------------- per-entity sync
  function syncEnemies(game, dt) {
    const seen = new Set();
    for (const e of game.enemies) {
      if (!e.alive) continue;
      seen.add(e.id);
      let v = enemyViews.get(e.id);
      if (!v) {
        v = createEnemyModel(e.type);
        v.walk = Math.random() * 10;
        scene.add(v.root);
        enemyViews.set(e.id, v);
      }
      v.root.position.set(e.x, e.y, e.z);
      v.root.rotation.y = e.yaw;
      const spd = Math.hypot(e.vx || 0, e.vz || 0);
      v.walk += dt * (2 + spd * 1.6);
      const spawnK = e.spawnT > 0 ? 1 - e.spawnT / 0.8 : 1;
      v.root.scale.setScalar(0.2 + 0.8 * spawnK);
      const tell = e.tell > 0 ? 0.5 + 0.5 * Math.sin(time * 40) : 0;
      const flash = e.flash > 0 ? 1 : 0;
      v.mats.forEach((m, i) => {
        if (!m.emissive) return;
        if (flash) { m.emissive.setHex(0xffffff); m.emissiveIntensity = 2.5; }
        else {
          if (m.userData.baseEmissive === undefined) m.userData.baseEmissive = m.emissive.getHex();
          m.emissive.setHex(m.userData.baseEmissive);
          m.emissiveIntensity = v.baseEmissive[i] * (1 + tell * 1.8);
        }
      });
      animateEnemy(v, e, spd);
    }
    for (const [id, v] of enemyViews) if (!seen.has(id)) { disposeModel(v.root); enemyViews.delete(id); }
  }

  function animateEnemy(v, e, spd) {
    const p = v.parts, w = v.walk;
    if (e.type === 'stalker') {
      const crouch = e.state === 'windup' ? 0.25 : 0;
      v.body.position.y = -crouch + Math.abs(Math.sin(w * 2)) * 0.05 * Math.min(1, spd / 3);
      v.body.rotation.x = e.state === 'lunge' ? -0.35 : e.state === 'windup' ? 0.2 : 0;
      p.legs.forEach((l, i) => { l.rotation.x = Math.sin(w * 2 + (i % 2 ? Math.PI : 0) + (i > 1 ? Math.PI / 2 : 0)) * 0.6 * Math.min(1, spd / 3); });
      p.head.rotation.x = e.state === 'windup' ? -0.3 : 0;
    } else if (e.type === 'sentinel') {
      const s = Math.min(1, spd / 2.5);
      p.legs.forEach((l, i) => { const ph = w * 1.6 + (i ? Math.PI : 0); l.hip.rotation.x = Math.sin(ph) * 0.5 * s; l.knee.rotation.x = Math.max(0, -Math.sin(ph)) * 0.8 * s; });
      p.chest.position.y = 1.45 + Math.abs(Math.sin(w * 1.6)) * 0.04 * s;
      p.gunArm.rotation.x = e.state === 'aim' || e.state === 'burst' ? -0.1 : 0.5;
      p.muzzle.scale.setScalar(e.state === 'aim' ? 1.5 + Math.sin(time * 30) * 0.5 : 1);
    } else if (e.type === 'wisp') {
      p.core.rotation.y += 0.05; p.shell.rotation.x += 0.02; p.shell.rotation.y -= 0.03;
      p.rings.forEach((r, i) => { r.rotation.z += 0.04 * (i ? -1 : 1); });
      const s = e.state === 'tell' ? 1.3 + Math.sin(time * 40) * 0.2 : 1;
      p.core.scale.setScalar(s);
      v.body.position.y = Math.sin(w) * 0.1;
    } else if (e.type === 'bulwark') {
      const s = Math.min(1, spd / 2);
      p.legs.forEach((l, i) => { const ph = w * 1.1 + (i ? Math.PI : 0); l.hip.rotation.x = Math.sin(ph) * 0.35 * s; l.knee.rotation.x = Math.max(0, -Math.sin(ph)) * 0.5 * s; });
      p.torso.position.y = 1.75 + Math.abs(Math.sin(w * 1.1)) * 0.06 * s;
      if (e.state === 'slam') { const k = 1 - Math.max(0, e.t) / 0.85; p.shieldArm.position.y = -0.05 + k * 0.9; p.shieldArm.rotation.x = -k * 0.5; }
      else { p.shieldArm.position.y += (-0.05 - p.shieldArm.position.y) * 0.2; p.shieldArm.rotation.x *= 0.8; }
      p.mortar.rotation.x = e.state === 'mortar' ? -0.4 : 0;
      p.vent.material.emissiveIntensity = 3 + Math.sin(time * 6) * 1.5;
    }
  }

  function syncBoss(game) {
    const b = game.boss;
    if (!b) {
      if (bossView) { disposeModel(bossView.root); bossView = null; arena.resetCore(); }
      return;
    }
    if (!bossView) { bossView = createBossModel(); scene.add(bossView.root); }
    const v = bossView;
    v.root.position.set(b.x, b.y, b.z);
    v.cage.rotation.y = time * 0.3; v.cage.rotation.x = time * 0.2;
    v.rings.forEach((r, i) => { r.rotation.z = time * (0.4 + i * 0.25) * (i % 2 ? -1 : 1); });
    tmpV.set(b.eye.x - b.x, b.eye.y - b.y, b.eye.z - b.z);
    v.eyeGroup.position.copy(tmpV);
    v.eyeGroup.lookAt(tmpV2.set(game.player.body.x, game.player.body.y + PLAYER.eye, game.player.body.z));
    v.eyeGroup.rotateY(Math.PI);
    const charge = b.charge > 0 ? 0.5 + 0.5 * Math.sin(time * 35) : 0;
    v.eyeMat.emissiveIntensity = 5 + charge * 6 + (b.flash > 0 ? 6 : 0);
    v.coreMat.emissiveIntensity = b.state === 'shift' ? 3 + Math.sin(time * 30) * 2 : b.flash > 0 ? 2.5 : 0.8 + b.phase * 0.35;
    arena.core.position.set(b.x, b.y, b.z);
    arena.core.distance = 34;
    arena.core.intensity = 34 + charge * 50 + (b.state === 'dying' ? Math.random() * 120 : 0);
    const pl = platePositions(b);
    v.plates.forEach((p, i) => {
      p.visible = i < pl.length;
      if (!p.visible) return;
      p.position.set(pl[i].x - b.x, pl[i].y - b.y, pl[i].z - b.z);
      p.rotation.y = -pl[i].a + Math.PI / 2;
      p.userData.halo.rotation.z = time * 2;
    });
    v.root.scale.setScalar(b.state === 'dying' ? 1 + Math.sin(time * 50) * 0.05 : 1);
    if (b.state === 'dying' && Math.random() < 0.3) fx.sparks(tmpV.set(b.x + (Math.random() - 0.5) * 3, b.y + (Math.random() - 0.5) * 3, b.z + (Math.random() - 0.5) * 3), 0xff2bd6, 12, 10, 0.6, 4);
  }

  function syncEcho(game) {
    const e = game.echo;
    if (!e) { if (echoView) { disposeModel(echoView.root); echoView = null; } echoLight.intensity = 0; return; }
    if (!echoView) { echoView = createEchoModel(); scene.add(echoView.root); }
    const v = echoView;
    // Fade the echo out when it overlaps the camera (it starts exactly where the player was rewound to).
    const pb = game.player.body, at = e.state === 'replay' ? e.pose : e.center;
    const gap = Math.hypot(at.x - pb.x, at.z - pb.z) + Math.abs(at.y - pb.y) * 0.5;
    const near = Math.max(0, Math.min(1, (gap - 0.7) / 1.3));
    v.root.visible = near > 0.02;
    if (e.state === 'replay') {
      v.root.position.set(e.pose.x, e.pose.y, e.pose.z);
      v.root.rotation.y = e.pose.yaw;
      v.gun.rotation.x = e.pose.pitch;
      v.head.rotation.x = e.pose.pitch;
      const left = (e.end - e.clock) / ECHO.window;
      v.mat.opacity = (0.3 + (e.hitFlash > 0 ? 0.35 : 0) + Math.sin(time * 25) * 0.04) * near;
      v.edge.opacity = (0.5 + 0.3 * Math.sin(time * 12)) * near;
      v.visor.material.opacity = near;
      v.root.scale.setScalar(1);
      echoLight.position.set(e.pose.x, e.pose.y + 1.2, e.pose.z);
      echoLight.intensity = 5 + (1 - left) * 4;
    } else {
      const k = 1 - Math.max(0, e.collapseT) / ECHO.pullTime;
      v.root.scale.set(1 - k * 0.8, 1 + k * 0.6, 1 - k * 0.8);
      v.mat.opacity = (0.5 + k * 0.5) * near;
      v.edge.opacity = 0.8 * near;
      v.visor.material.opacity = near;
      echoLight.intensity = 6 + k * 30;
      v.root.rotation.y += 0.3;
    }
  }

  function syncPickups(game) {
    const seen = new Set();
    for (const p of game.pickups) {
      seen.add(p.id);
      let v = pickupViews.get(p.id);
      if (!v) { v = createPickupModel(p.kind); scene.add(v.root); pickupViews.set(p.id, v); }
      v.root.position.set(p.x, p.y + Math.sin(time * 3 + p.id) * 0.1, p.z);
      v.spin.rotation.y = time * 2.2;
      v.ring.scale.setScalar(1 + Math.sin(time * 5) * 0.1);
      v.root.visible = p.life > 3 || Math.sin(time * 20) > 0;
    }
    for (const [id, v] of pickupViews) if (!seen.has(id)) { disposeModel(v.root); pickupViews.delete(id); }
    game.stations.forEach((st, i) => {
      const v = stationViews[i];
      if (!v) return;
      const ready = st.cd <= 0;
      v.holo.visible = ready;
      v.holo.rotation.y = time * 1.5;
      v.holo.position.y = 1.2 + Math.sin(time * 2 + i) * 0.1;
      v.beam.material.opacity = ready ? 0.1 + Math.sin(time * 3) * 0.04 : 0.02;
      v.ring.material.emissiveIntensity = ready ? 2.5 : 0.4;
    });
  }

  function syncShockwaves(game) {
    const seen = new Set();
    for (const s of game.shockwaves) {
      seen.add(s.id);
      let m = shockViews.get(s.id);
      if (!m) { m = fx.shockwave(s.id, new THREE.Vector3(s.x, s.y, s.z), s.boss ? NEON.magenta : 0xffc21f); shockViews.set(s.id, m); }
      m.scale.set(s.r, 1, s.r);
      m.material.opacity = 0.65 * (1 - s.r / s.maxR) + 0.1;
    }
    for (const [id, m] of shockViews) if (!seen.has(id)) { fx.release(m); shockViews.delete(id); }
  }

  function syncBeams(game) {
    const seen = new Set();
    for (const b of game.beams) {
      seen.add(b.id);
      let v = beamViews.get(b.id);
      if (!v && freeBeams.length) { v = freeBeams.pop(); v.group.visible = true; beamViews.set(b.id, v); }
      if (!v) {
        const group = new THREE.Group();
        const geo = beamGeo;
        const mat = new THREE.MeshBasicMaterial({ color: 0xff2bd6, transparent: true, opacity: 0.4, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
        const line = new THREE.Mesh(geo, mat);
        group.add(line);
        scene.add(group);
        v = { group, line, mat };
        beamViews.set(b.id, v);
      }
      const from = tmpV.set(b.from.x, b.from.y, b.from.z);
      const to = b.fired ? tmpV2.set(b.end.x, b.end.y, b.end.z) : tmpV2.set(b.aim.x, b.aim.y, b.aim.z).sub(from).normalize().multiplyScalar(80).add(from);
      v.line.position.copy(from);
      v.line.lookAt(to);
      const len = from.distanceTo(to);
      if (b.fired) {
        const k = Math.max(0, b.life / 0.3);
        v.line.scale.set(0.45 * k + 0.05, 0.45 * k + 0.05, len);
        v.mat.opacity = 0.9 * k;
        v.mat.color.setHex(0xffc0f5);
      } else {
        const k = 1 - b.t / b.tell;
        v.line.scale.set(0.02 + k * 0.03, 0.02 + k * 0.03, len);
        v.mat.opacity = 0.35 + 0.4 * (Math.sin(time * (20 + k * 40)) * 0.5 + 0.5);
      }
    }
    for (const [id, v] of beamViews) if (!seen.has(id)) { v.group.visible = false; freeBeams.push(v); beamViews.delete(id); }
  }

  // ---------------------------------------------------------------- events
  function vec(o, dy = 0) { return new THREE.Vector3(o.x, o.y + dy, o.z); }
  function handleEvents(events, game, audio, hud) {
    const pb = game.player.body;
    for (const ev of events) {
      switch (ev.type) {
        case 'shot': {
          const color = WEAPON_COLORS[ev.weapon];
          if (!ev.echo) {
            vm.fire(['carbine', 'scatter', 'rail'].indexOf(ev.weapon));
            vm.muzzleWorld(muzzle, camera);
            kick.pitch += ev.weapon === 'rail' ? 0.02 : ev.weapon === 'scatter' ? 0.018 : 0.004;
            addShake(ev.weapon === 'rail' ? 0.25 : ev.weapon === 'scatter' ? 0.22 : 0.05);
            fovKick = ev.weapon === 'rail' ? 3 : ev.weapon === 'scatter' ? 2 : 0.4;
            audio.play(ev.weapon);
          } else {
            muzzle.set(ev.origin.x, ev.origin.y - 0.25, ev.origin.z);
            audio.play('echoShot', ev.origin, 40);
          }
          for (const end of ev.ends) {
            const to = vec(end);
            if (ev.weapon === 'rail') {
              fx.tracer(muzzle, to, color, 0.07, 0.35, 1);
              fx.tracer(muzzle, to, 0xffffff, 0.02, 0.25, 1);
              if (quality !== 'low') {
                const dir = tmpV.copy(to).sub(muzzle), len = dir.length();
                for (let s = 1; s < len; s += 1.2) fx.sparks(tmpV2.copy(muzzle).addScaledVector(dir, s / len), color, 1, 0.6, 0.5, 0);
              }
            } else fx.tracer(muzzle, to, ev.echo ? 0x9ff6ff : color, ev.weapon === 'scatter' ? 0.012 : 0.016, ev.weapon === 'scatter' ? 0.08 : 0.06, ev.echo ? 0.5 : 0.9);
            if (end.kind === 'wall') { fx.sparks(to, color, ev.weapon === 'scatter' ? 2 : 6, 5, 0.35, 9, end.normal); if (ev.weapon !== 'scatter') fx.flash(to, color, 0.5, 0.08); }
          }
          break;
        }
        case 'hit': {
          const p = vec(ev);
          const color = ev.immune ? 0x8899aa : ev.shielded ? 0xffd060 : ev.weak ? 0xfff27a : ENEMY_COLORS[ev.enemy || 'boss'];
          fx.sparks(p, color, ev.weak ? 10 : 6, 5, 0.4, 8);
          if (!ev.echo) {
            hud.hitmarker(ev.weak, ev.kill, ev.shielded || ev.immune);
            audio.play(ev.shielded || ev.immune ? 'shielded' : ev.weak ? 'weak' : 'hit', null, 30);
          }
          if (ev.damage > 0 && settings.damageNumbers) hud.damageNumber(p, ev.damage, ev.weak, ev.echo);
          break;
        }
        case 'plateHit': fx.sparks(vec(ev), 0x22e6ff, 8, 6, 0.3, 6); hud.hitmarker(false, false, true); audio.play('plate', ev, 40); break;
        case 'kill': {
          if (ev.silent) { fx.explosion(vec(ev, 0.8), ENEMY_COLORS[ev.enemy], 1.2); break; }
          const big = ev.enemy === 'bulwark' || ev.enemy === 'boss';
          fx.explosion(vec(ev, ev.enemy === 'wisp' ? 0 : 0.9), ENEMY_COLORS[ev.enemy], big ? 3 : 1.4);
          fx.light(vec(ev, 1), ENEMY_COLORS[ev.enemy], big ? 60 : 20, big ? 16 : 8, 0.4);
          audio.play(big ? 'explode' : 'small', ev);
          audio.play('kill');
          if (ev.points) hud.killfeed(ev);
          addShake(big ? 0.6 : 0.12);
          break;
        }
        case 'explosion': fx.explosion(vec(ev), ev.kind === 'mortar' ? 0xffb21f : 0xff6a3a, ev.r); audio.play('explode', ev); addShake(0.35 / Math.max(1, Math.hypot(ev.x - pb.x, ev.z - pb.z) / 6)); break;
        case 'enemyTell': audio.play(ev.kind === 'slam' || ev.kind === 'mortar' ? 'heavyTell' : ev.kind === 'lunge' ? 'lungeTell' : 'tell', ev, 60); break;
        case 'enemyAttack': if (ev.kind === 'slam') { audio.play('slam', ev); addShake(0.4); fx.explosion(vec(ev, 0.2), 0xffc21f, 2); } else if (ev.kind === 'mortar') audio.play('mortarLaunch', ev); break;
        case 'enemyFire': audio.play(ev.kind === 'needle' ? 'needle' : 'enemyBolt', ev, 25); fx.flash(vec(ev), ev.kind === 'needle' ? 0x7ff6ff : 0xc07bff, 0.6, 0.08); break;
        case 'mortar': fx.marker(vec(ev), ev.r, 0xffb21f, ev.time); break;
        case 'projectileHit': fx.sparks(vec(ev), ev.kind === 'orb' ? 0xff4fe0 : ev.kind === 'needle' ? 0x7ff6ff : 0xc07bff, 6, 4, 0.3, 6, ev.normal); if (ev.target === 'phase') audio.play('phase', null, 60); break;
        case 'playerHurt': {
          const ang = Math.atan2(-(ev.fromX - pb.x), -(ev.fromZ - pb.z));
          hud.damageIndicator(ang - game.player.yaw, ev.amount);
          hurtFx = Math.min(1, hurtFx + ev.amount / 30);
          addShake(Math.min(0.5, 0.1 + ev.amount / 40));
          audio.play('hurt', null, 90);
          break;
        }
        case 'dash': audio.play('dash'); fovKick = 6; hud.dash(); break;
        case 'jump': audio.play('jump', null, 100); break;
        case 'land': audio.play('land', null, 150); vm.land(ev.speed); addShake(Math.min(0.2, ev.speed / 60)); break;
        case 'jumpPad': audio.play('pad'); fovKick = 8; fx.ring(vec(ev, 0.05), 0x9dff3a, 0.5, 2.5, 0.4); break;
        case 'pickup': audio.play(ev.kind === 'health' ? 'pickup' : 'ammo'); hud.pickup(ev); break;
        case 'ammoStation': audio.play('ammo'); audio.play('pickup'); hud.pickup({ kind: 'station', ...ev }); break;
        case 'reloadStart': audio.play('reload'); break;
        case 'reloadEnd': if (!ev.interrupted) audio.play('reloadEnd'); break;
        case 'shellIn': vm.shellIn(); audio.play('shell'); break;
        case 'switch': vm.select(ev.index); audio.play('switch'); break;
        case 'empty': audio.play('empty', null, 120); if (ev.reserve === 0) hud.flashAmmo(); break;
        case 'echoReady': audio.play('echoReady'); hud.echoReady(); break;
        case 'echoDenied': audio.play('denied', null, 250); hud.echoDenied(ev.reason); break;
        case 'echoStart': {
          audio.play('echoStart');
          echoFx = 1;
          fovKick = 12;
          // Rewind streak from where Q was pressed back towards the player; it stops short of the camera.
          const from = vec(ev.from, 1), to = vec(ev.to, 1), len = from.distanceTo(to);
          if (len > 2) {
            const end = from.clone().lerp(to, (len - 1.6) / len);
            fx.tracer(from, end, 0x33f0ff, 0.05, 0.45, 0.8);
            for (let k = 0; k < 14; k++) fx.sparks(from.clone().lerp(end, k / 14), 0x9ff6ff, 2, 1.5, 0.6, 0);
          }
          fx.flash(from, 0x33f0ff, 2.5, 0.35);
          fx.ring(vec(ev.to, 0.05), 0x33f0ff, 0.6, 3, 0.45);
          hud.echoStart(ev.healed);
          break;
        }
        case 'echoCollapse': audio.play('echoCollapse', ev); fx.ring(vec(ev, 0.1), 0x33f0ff, ev.r, 0.3, ECHO.pullTime); break;
        case 'echoBlast': audio.play('echoBlast', ev); fx.explosion(vec(ev), 0x33f0ff, ev.r * 0.7); fx.light(vec(ev), 0x33f0ff, 80, 20, 0.5); addShake(0.5); break;
        case 'echoHit': break;
        case 'gateWarn': { const g = arena.gates[ev.gate]; if (g) g.warn = 1.2; audio.play('gate', { x: ev.x, y: 1.5, z: ev.z }, 80); break; }
        case 'enemySpawn': fx.flash(vec(ev, 1), ENEMY_COLORS[ev.enemy], 3, 0.3); fx.sparks(vec(ev, 1), ENEMY_COLORS[ev.enemy], 20, 5, 0.5, 2); audio.play('spawn', ev, 40); break;
        case 'shockwave': break;
        case 'beamTell': audio.play('beamTell', null, 100); break;
        case 'beamFire': audio.play('beam'); if (ev.hit) addShake(0.5); fx.sparks(vec(ev.to), 0xff2bd6, 24, 8, 0.5, 6); fx.flash(vec(ev.to), 0xff2bd6, 2.5, 0.25); break;
        case 'bossCharge': audio.play('bossCharge'); break;
        case 'bossFire': if (ev.kind === 'ring' || ev.kind === 'spiral') audio.play('bossRing'); if (ev.kind === 'quake') addShake(0.6); break;
        case 'bossIntro': hud.bossIntro(); audio.play('bossPhase'); addShake(0.4); break;
        case 'bossReady': break;
        case 'bossPhase': hud.bossPhase(ev.phase); audio.play('bossPhase'); addShake(0.7); fx.explosion(vec(ev), 0xff2bd6, 5); fx.ring(vec(ev), 0xff2bd6, 1, 14, 0.8, false); break;
        case 'bossDying': audio.play('bossDie'); break;
        case 'bossDead': fx.explosion(vec(ev), 0xff2bd6, 8); fx.explosion(vec(ev), 0xffffff, 4); fx.light(vec(ev), 0xff2bd6, 200, 60, 1.2); addShake(1); break;
        default: break;
      }
    }
  }

  function addShake(a) { if (settings.shake) shake.amp = Math.min(1.2, shake.amp + a); }

  // ---------------------------------------------------------------- frame
  function render(game, dt, view) {
    time += dt;
    const p = game.player, b = p.body;
    kick.pitch *= Math.exp(-dt * 12);
    shake.amp *= Math.exp(-dt * 7);
    shake.t += dt;
    fovKick *= Math.exp(-dt * 6);
    echoFx = Math.max(0, echoFx - dt * 1.4);
    hurtFx = Math.max(0, hurtFx - dt * 1.8);
    const sx = (Math.sin(shake.t * 67) + Math.sin(shake.t * 31)) * 0.5 * shake.amp * 0.035;
    const sy = (Math.sin(shake.t * 53) + Math.sin(shake.t * 23)) * 0.5 * shake.amp * 0.035;
    camera.position.set(view.x, view.y, view.z);
    camera.rotation.set(view.pitch + game.arsenal.aimOffset.pitch + kick.pitch + sy, view.yaw + game.arsenal.aimOffset.yaw + sx, view.roll);
    const ads = game.arsenal.ads, zoom = game.arsenal.weapon.adsZoom;
    const baseFov = settings.fov;
    const targetFov = baseFov / (1 + (zoom - 1) * ads) + fovKick + Math.min(6, p.speed * 0.25) * (1 - ads);
    camera.fov += (targetFov - camera.fov) * (1 - Math.exp(-dt * 18));
    camera.updateProjectionMatrix();
    arena?.update(time, dt);
    syncEnemies(game, dt);
    syncBoss(game);
    syncEcho(game);
    syncPickups(game);
    syncShockwaves(game);
    syncBeams(game);
    projViews.sync(game.projectiles, time);
    fx.update(dt);
    bloom.strength = 0.8 + echoFx * 0.9 + (game.boss?.state === 'shift' ? 0.6 : 0);
    vm.update(dt, {
      ads, speed: p.speed, grounded: b.grounded, reloading: game.arsenal.reloading, reloadLeft: game.arsenal.reloadT,
      reloadTotal: game.arsenal.weapon.reload * game.stats.reloadMult, perShell: !!game.arsenal.weapon.perShell,
      dash: p.dash.t > 0, hidden: api.hideViewmodel || !p.alive || (game.arsenal.index === 2 && ads > 0.92), ready: game.arsenal.cooldown <= 0,
    });
    renderer.info.reset();
    renderer.clear();
    if (quality === 'low') renderer.render(scene, camera); else composer.render(dt);
    renderer.clearDepth();
    renderer.render(vm.scene, vm.camera);
    return { echoFx, hurtFx };
  }

  window.addEventListener('resize', resize);
  // Detect software rasterisers (no GPU acceleration) so the game can default to low quality there.
  function rendererInfo() {
    try {
      const gl = renderer.getContext(), ext = gl.getExtension('WEBGL_debug_renderer_info');
      const name = String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
      return { name, software: /swiftshader|llvmpipe|softpipe|software|basic render/i.test(name) };
    } catch { return { name: 'unknown', software: false }; }
  }
  const api = {
    renderer, scene, camera, rendererInfo, setup, render, handleEvents, resize, setQuality, setResolutionScale, clearWorld, vm, hideViewmodel: false,
    get resolutionScale() { return resScale; },
    look(dx, dy) { vm.look(dx, dy); },
    get fx() { return fx; },
    stats() { return { calls: renderer.info.render.calls, tris: renderer.info.render.triangles, geos: renderer.info.memory.geometries, tex: renderer.info.memory.textures, programs: renderer.info.programs?.length ?? 0, fx: fx.count(), pixelRatio: renderer.getPixelRatio(), resScale }; },
  };
  return api;
}

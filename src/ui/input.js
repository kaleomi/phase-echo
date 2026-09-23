// Keyboard + mouse input with pointer lock and a no-lock fallback (embedded frames, remote desktops): when
// the lock cannot be acquired, plain mouse movement still turns the camera and ← → ↑ ↓ turn/look.
// Produces the per-frame input object consumed by the sim. Edge actions are latched until sampled.
export const DEFAULT_BINDS = Object.freeze({
  forward: 'KeyW', back: 'KeyS', left: 'KeyA', right: 'KeyD', jump: 'Space', dash: 'ShiftLeft', echo: 'KeyQ', reload: 'KeyR',
  w1: 'Digit1', w2: 'Digit2', w3: 'Digit3',
});
const TURN_RATE = 2.6, LOOK_RATE = 1.6, MAX_DELTA = 300;

export function createInput(target, settings) {
  const down = new Set();
  const latched = { jump: false, dash: false, echo: false, reload: false, weapon: null, cycle: 0, firePressed: false };
  let fire = false, ads = false, yaw = 0, pitch = 0, locked = false, fallback = false, enabled = false, lastMove = 0, adsBlend = 0, lockTimer = 0;
  const listeners = { lookDelta: null, lockChange: null, fallback: null };
  const binds = { ...DEFAULT_BINDS };
  const active = () => enabled && (locked || fallback);
  const setFallback = v => { if (fallback !== v) { fallback = v; listeners.fallback?.(v); } };

  function onKeyDown(e) {
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(e.code) && enabled) e.preventDefault();
    if (!enabled || e.repeat) return;
    down.add(e.code);
    if (e.code === binds.jump) latched.jump = true;
    if (e.code === binds.dash || e.code === 'ShiftRight') latched.dash = true;
    if (e.code === binds.echo) latched.echo = true;
    if (e.code === binds.reload) latched.reload = true;
    if (e.code === binds.w1) latched.weapon = 0;
    if (e.code === binds.w2) latched.weapon = 1;
    if (e.code === binds.w3) latched.weapon = 2;
  }
  function onKeyUp(e) { down.delete(e.code); }
  function onMouseDown(e) {
    if (!active()) return;
    if (e.button === 0) { fire = true; latched.firePressed = true; }
    if (e.button === 2) ads = settings.toggleAds ? !ads : true;
  }
  function onMouseUp(e) {
    if (e.button === 0) fire = false;
    if (e.button === 2 && !settings.toggleAds) ads = false;
  }
  function onMouseMove(e) {
    if (!active()) return;
    const dx = e.movementX || 0, dy = e.movementY || 0;
    // Browsers occasionally report a huge jump right after lock/unlock or a long idle gap; drop those samples.
    if (Math.abs(dx) > MAX_DELTA || Math.abs(dy) > MAX_DELTA) return;
    const t = performance.now();
    if (t - lastMove > 250 && (Math.abs(dx) > 60 || Math.abs(dy) > 60)) { lastMove = t; return; }
    lastMove = t;
    const sens = settings.sensitivity * 0.0022 * (1 - 0.35 * adsBlend);
    yaw -= dx * sens;
    pitch = Math.max(-1.5, Math.min(1.5, pitch - dy * sens * (settings.invertY ? -1 : 1)));
    listeners.lookDelta?.(dx, dy);
  }
  function onWheel(e) { if (active()) latched.cycle = e.deltaY > 0 ? 1 : -1; }
  function onLockChange() {
    locked = document.pointerLockElement === target;
    if (locked) setFallback(false);
    else { fire = false; if (!settings.toggleAds) ads = false; down.clear(); }
    listeners.lockChange?.(locked);
  }
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('mousedown', onMouseDown);
  window.addEventListener('mouseup', onMouseUp);
  window.addEventListener('mousemove', onMouseMove);
  window.addEventListener('wheel', onWheel, { passive: true });
  window.addEventListener('contextmenu', e => { if (enabled) e.preventDefault(); });
  window.addEventListener('blur', () => { down.clear(); fire = false; });
  document.addEventListener('pointerlockchange', onLockChange);
  document.addEventListener('pointerlockerror', () => { if (enabled) setFallback(true); });

  return {
    binds,
    on(name, fn) { listeners[name] = fn; },
    lock() {
      clearTimeout(lockTimer);
      lockTimer = setTimeout(() => { if (enabled && !locked) setFallback(true); }, 600);
      try {
        const r = target.requestPointerLock?.({ unadjustedMovement: true });
        if (r && typeof r.catch === 'function') r.catch(() => { try { target.requestPointerLock?.(); } catch { setFallback(true); } });
      } catch { try { target.requestPointerLock?.(); } catch { setFallback(true); } }
      if (!target.requestPointerLock) setFallback(true);
    },
    unlock() { clearTimeout(lockTimer); if (document.pointerLockElement) document.exitPointerLock(); },
    get locked() { return locked; },
    get fallback() { return fallback && !locked; },
    enable(v) { enabled = v; if (!v) { down.clear(); fire = false; if (!settings.toggleAds) ads = false; } },
    setLook(y, p) { yaw = y; pitch = p; },
    setAdsBlend(v) { adsBlend = v; },
    // Automation hook: inject look/keys/actions without real devices (used by the browser smoke test).
    inject({ keys = [], fire: f, ads: a, yaw: y, pitch: p, jump, dash, echo, reload, weapon } = {}) {
      for (const k of keys) down.add(k);
      if (f !== undefined) { if (f && !fire) latched.firePressed = true; fire = f; }
      if (a !== undefined) ads = a;
      if (y !== undefined) yaw = y;
      if (p !== undefined) pitch = p;
      if (jump) latched.jump = true;
      if (dash) latched.dash = true;
      if (echo) latched.echo = true;
      if (reload) latched.reload = true;
      if (weapon !== undefined) latched.weapon = weapon;
    },
    release(keys = []) { for (const k of keys) down.delete(k); },
    sample(dt = 0) {
      const k = c => down.has(c);
      // Arrow keys turn/look (primarily for the no-pointer-lock fallback, but always available).
      yaw += ((k('ArrowLeft') ? 1 : 0) - (k('ArrowRight') ? 1 : 0)) * TURN_RATE * settings.sensitivity * dt;
      pitch = Math.max(-1.5, Math.min(1.5, pitch + ((k('ArrowUp') ? 1 : 0) - (k('ArrowDown') ? 1 : 0)) * LOOK_RATE * settings.sensitivity * dt));
      const out = {
        moveX: (k(binds.right) ? 1 : 0) - (k(binds.left) ? 1 : 0),
        moveZ: (k(binds.forward) ? 1 : 0) - (k(binds.back) ? 1 : 0),
        yaw, pitch, fire, ads, firePressed: latched.firePressed, jumpPressed: latched.jump, dashPressed: latched.dash,
        echoPressed: latched.echo, reload: latched.reload, weapon: latched.weapon, cycle: latched.cycle,
      };
      latched.jump = latched.dash = latched.echo = latched.reload = latched.firePressed = false;
      latched.weapon = null; latched.cycle = 0;
      return out;
    },
  };
}

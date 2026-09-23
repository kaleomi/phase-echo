// Procedural canvas textures (no image assets): tiled neon floor, panelled walls, hazard stripes, glow dots.
import * as THREE from 'three';

function canvas(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  return c;
}

export function floorTexture(renderer) {
  const c = canvas(512, 512, (x, w, h) => {
    x.fillStyle = '#0b0f1c';
    x.fillRect(0, 0, w, h);
    for (let i = 0; i < 1400; i++) {
      const v = 14 + Math.random() * 10;
      x.fillStyle = `rgba(${v},${v + 4},${v + 14},0.5)`;
      x.fillRect(Math.random() * w, Math.random() * h, 2, 2);
    }
    x.strokeStyle = 'rgba(40,70,110,0.55)';
    x.lineWidth = 2;
    for (let i = 0; i <= 4; i++) {
      x.beginPath(); x.moveTo(i * w / 4, 0); x.lineTo(i * w / 4, h); x.stroke();
      x.beginPath(); x.moveTo(0, i * h / 4); x.lineTo(w, i * h / 4); x.stroke();
    }
    x.strokeStyle = 'rgba(34,230,255,0.35)';
    x.lineWidth = 3;
    x.strokeRect(4, 4, w - 8, h - 8);
    x.fillStyle = 'rgba(34,230,255,0.55)';
    for (const [px, py] of [[0, 0], [w, 0], [0, h], [w, h]]) { x.beginPath(); x.arc(px, py, 10, 0, Math.PI * 2); x.fill(); }
  });
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(16, 16);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  return t;
}

export function panelTexture(renderer, accent = '#22e6ff') {
  const c = canvas(256, 256, (x, w, h) => {
    const grd = x.createLinearGradient(0, 0, 0, h);
    grd.addColorStop(0, '#1a2033'); grd.addColorStop(1, '#10141f');
    x.fillStyle = grd;
    x.fillRect(0, 0, w, h);
    x.strokeStyle = 'rgba(0,0,0,0.6)';
    x.lineWidth = 3;
    x.strokeRect(2, 2, w - 4, h - 4);
    x.strokeRect(2, h / 2, w - 4, 1);
    x.strokeStyle = 'rgba(120,150,200,0.18)';
    x.lineWidth = 1;
    x.strokeRect(10, 10, w - 20, h / 2 - 16);
    x.strokeRect(10, h / 2 + 8, w - 20, h / 2 - 18);
    x.fillStyle = accent;
    x.globalAlpha = 0.5;
    x.fillRect(20, h / 2 - 20, 40, 4);
    x.fillRect(w - 60, h - 26, 40, 4);
    x.globalAlpha = 1;
    for (let i = 0; i < 300; i++) { x.fillStyle = `rgba(255,255,255,${Math.random() * 0.03})`; x.fillRect(Math.random() * w, Math.random() * h, 1, 1); }
  });
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  return t;
}

export function hazardTexture() {
  const c = canvas(128, 32, (x, w, h) => {
    x.fillStyle = '#111';
    x.fillRect(0, 0, w, h);
    x.fillStyle = '#ffb21f';
    for (let i = -2; i < 10; i++) { x.beginPath(); x.moveTo(i * 16, h); x.lineTo(i * 16 + 8, h); x.lineTo(i * 16 + 8 + h, 0); x.lineTo(i * 16 + h, 0); x.fill(); }
  });
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function glowTexture() {
  const c = canvas(64, 64, (x, w, h) => {
    const g = x.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.25, 'rgba(255,255,255,0.7)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g;
    x.fillRect(0, 0, w, h);
  });
  return new THREE.CanvasTexture(c);
}

export function ringTexture() {
  const c = canvas(128, 128, (x, w, h) => {
    const g = x.createRadialGradient(w / 2, h / 2, w * 0.3, w / 2, h / 2, w / 2);
    g.addColorStop(0, 'rgba(255,255,255,0)');
    g.addColorStop(0.75, 'rgba(255,255,255,0.9)');
    g.addColorStop(0.85, 'rgba(255,255,255,1)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g;
    x.fillRect(0, 0, w, h);
  });
  return new THREE.CanvasTexture(c);
}

export function skyTexture() {
  const c = canvas(1024, 512, (x, w, h) => {
    const g = x.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#02030a');
    g.addColorStop(0.45, '#0b0a24');
    g.addColorStop(0.62, '#2a0d3a');
    g.addColorStop(0.7, '#12081f');
    g.addColorStop(1, '#040409');
    x.fillStyle = g;
    x.fillRect(0, 0, w, h);
    for (let i = 0; i < 700; i++) {
      const y = Math.random() * h * 0.55, a = Math.random() * 0.8;
      x.fillStyle = `rgba(200,220,255,${a})`;
      x.fillRect(Math.random() * w, y, Math.random() < 0.1 ? 2 : 1, 1);
    }
    // distant city silhouette with neon windows
    for (let i = 0; i < 90; i++) {
      const bw = 8 + Math.random() * 26, bh = 20 + Math.random() * 90, bx = Math.random() * w, by = h * 0.68 - bh;
      x.fillStyle = '#07060f';
      x.fillRect(bx, by, bw, bh + h);
      for (let k = 0; k < bh / 6; k++) {
        if (Math.random() < 0.35) {
          x.fillStyle = Math.random() < 0.5 ? 'rgba(34,230,255,0.5)' : 'rgba(255,43,214,0.45)';
          x.fillRect(bx + 2 + Math.random() * (bw - 4), by + k * 6 + 2, 2, 1.5);
        }
      }
    }
    const moon = x.createRadialGradient(w * 0.72, h * 0.2, 0, w * 0.72, h * 0.2, 60);
    moon.addColorStop(0, 'rgba(255,120,220,0.9)');
    moon.addColorStop(0.35, 'rgba(255,60,200,0.35)');
    moon.addColorStop(1, 'rgba(255,60,200,0)');
    x.fillStyle = moon;
    x.fillRect(0, 0, w, h);
  });
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.mapping = THREE.EquirectangularReflectionMapping;
  return t;
}

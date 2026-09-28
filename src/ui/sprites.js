import * as THREE from 'three';

/*
  Small screen-facing labels drawn on canvases: name tags, the suspicion meter over a
  coworker's head, speech bubbles and the X-ray beacons. They keep a constant size on screen
  (sizeAttenuation off) so they read from across a room.
*/

const FONT_SANS = '"IBM Plex Sans", Arial, sans-serif';
const FONT_MONO = '"IBM Plex Mono", monospace';
const ESPRESSO = '#d6a27c';

function spriteFrom(canvas, sx, sy, { depthTest = true, order = 5 } = {}) {
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  // toneMapped off: labels keep their exact colors instead of being washed out by the scene's tone mapping.
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, opacity: 0, depthWrite: false, depthTest, sizeAttenuation: false, toneMapped: false }));
  s.scale.set(sx, sy, 1);
  s.renderOrder = order;
  s.userData.canvas = canvas;
  return s;
}

export function nameTag(name, role, accent = ESPRESSO) {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 160;
  const ctx = c.getContext('2d');
  ctx.fillStyle = 'rgba(20,26,35,0.82)';
  ctx.beginPath(); ctx.roundRect(8, 16, 496, 128, 40); ctx.fill();
  ctx.textAlign = 'center';
  ctx.fillStyle = '#eef1f5';
  ctx.font = `600 56px ${FONT_SANS}`;
  ctx.fillText(name, 256, 80);
  ctx.fillStyle = accent;
  ctx.font = `500 34px ${FONT_MONO}`;
  ctx.fillText(role.toUpperCase(), 256, 124);
  return spriteFrom(c, 0.19, 0.06);
}

// Ring that fills as a coworker gets suspicious: "?" while they're wondering, "!" once they
// have you. Redrawn only when the value changes by a visible step.
export function meter() {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 128;
  const s = spriteFrom(c, 0.05, 0.05, { depthTest: false, order: 7 });
  s.userData.sig = '';
  return s;
}

export function drawMeter(s, value, state) {
  const v = Math.round(value * 16) / 16;
  const sig = `${v}|${state}`;
  if (sig === s.userData.sig) return;
  s.userData.sig = sig;
  const c = s.userData.canvas, ctx = c.getContext('2d');
  ctx.clearRect(0, 0, 128, 128);
  const alarm = state === 'chase' || state === 'talk';
  const col = alarm ? '#ff6b6b' : v > 0.6 ? '#f0a35e' : '#f3d27a';
  ctx.fillStyle = 'rgba(20,26,35,0.85)';
  ctx.beginPath(); ctx.arc(64, 64, 56, 0, Math.PI * 2); ctx.fill();
  ctx.lineWidth = 12;
  ctx.strokeStyle = 'rgba(255,255,255,0.18)';
  ctx.beginPath(); ctx.arc(64, 64, 44, 0, Math.PI * 2); ctx.stroke();
  ctx.strokeStyle = col;
  ctx.beginPath(); ctx.arc(64, 64, 44, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (alarm ? 1 : v)); ctx.stroke();
  ctx.fillStyle = col;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.font = `700 60px ${FONT_SANS}`;
  ctx.fillText(alarm ? '!' : '?', 64, 68);
  s.material.map.needsUpdate = true;
}

// Speech bubble over a coworker's head. Text wraps to two lines.
export function bubble() {
  const c = document.createElement('canvas');
  c.width = 640; c.height = 200;
  const s = spriteFrom(c, 0.4, 0.125, { depthTest: false, order: 8 });
  s.userData.text = null;
  return s;
}

export function drawBubble(s, text) {
  if (s.userData.text === text) return;
  s.userData.text = text;
  const c = s.userData.canvas, ctx = c.getContext('2d');
  ctx.clearRect(0, 0, c.width, c.height);
  if (!text) { s.material.map.needsUpdate = true; return; }
  ctx.font = `500 40px ${FONT_SANS}`;
  const words = text.split(' ');
  const lines = [''];
  for (const w of words) {
    const tryLine = lines[lines.length - 1] ? `${lines[lines.length - 1]} ${w}` : w;
    if (ctx.measureText(tryLine).width > 560 && lines[lines.length - 1]) lines.push(w); else lines[lines.length - 1] = tryLine;
  }
  const shown = lines.slice(0, 2);
  const w = Math.min(600, Math.max(...shown.map((l) => ctx.measureText(l).width)) + 48);
  const h = shown.length * 50 + 30;
  const x = (640 - w) / 2, y = 160 - h;
  ctx.fillStyle = '#fafbfc';
  ctx.beginPath(); ctx.roundRect(x, y, w, h, 26); ctx.fill();
  ctx.beginPath(); ctx.moveTo(300, 159); ctx.lineTo(320, 192); ctx.lineTo(340, 159); ctx.fill();
  ctx.fillStyle = '#18202b';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  shown.forEach((l, i) => ctx.fillText(l, 320, y + 40 + i * 50));
  s.material.map.needsUpdate = true;
}

// X-ray beacon: an icon in a circle with a label under it, visible through walls.
const ICONS = {
  coffee(ctx) {
    ctx.beginPath(); ctx.moveTo(-18, -14); ctx.lineTo(14, -14); ctx.lineTo(10, 20); ctx.lineTo(-14, 20); ctx.closePath(); ctx.fill();
    ctx.lineWidth = 6; ctx.beginPath(); ctx.arc(16, 2, 9, -Math.PI / 2, Math.PI / 2); ctx.stroke();
    ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(-8, -22); ctx.quadraticCurveTo(-2, -28, -6, -34); ctx.moveTo(4, -22); ctx.quadraticCurveTo(10, -28, 6, -34); ctx.stroke();
  },
  badge(ctx) {
    ctx.beginPath(); ctx.roundRect(-16, -20, 32, 42, 5); ctx.fill();
    ctx.globalCompositeOperation = 'destination-out';
    ctx.beginPath(); ctx.arc(0, -4, 7, 0, Math.PI * 2); ctx.fill();
    ctx.fillRect(-9, 8, 18, 5);
    ctx.fillRect(-5, -17, 10, 4);
    ctx.globalCompositeOperation = 'source-over';
  },
  lift(ctx) {
    ctx.beginPath(); ctx.moveTo(-14, -4); ctx.lineTo(0, -22); ctx.lineTo(14, -4); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(-14, 4); ctx.lineTo(0, 22); ctx.lineTo(14, 4); ctx.closePath(); ctx.fill();
  },
  stairs(ctx) {
    ctx.beginPath(); ctx.moveTo(-22, 20); ctx.lineTo(-22, 8); ctx.lineTo(-8, 8); ctx.lineTo(-8, -4); ctx.lineTo(6, -4); ctx.lineTo(6, -16); ctx.lineTo(22, -16); ctx.lineTo(22, 20); ctx.closePath(); ctx.fill();
  },
  door(ctx) {
    ctx.beginPath(); ctx.roundRect(-14, -22, 28, 44, 3); ctx.fill();
    ctx.globalCompositeOperation = 'destination-out';
    ctx.beginPath(); ctx.arc(7, 2, 3.5, 0, Math.PI * 2); ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
  },
  hide(ctx) {
    ctx.lineWidth = 6;
    ctx.beginPath(); ctx.moveTo(-22, 0); ctx.quadraticCurveTo(0, -22, 22, 0); ctx.quadraticCurveTo(0, 22, -22, 0); ctx.stroke();
    ctx.beginPath(); ctx.arc(0, 0, 7, 0, Math.PI * 2); ctx.fill();
    ctx.lineWidth = 6; ctx.beginPath(); ctx.moveTo(-18, 18); ctx.lineTo(18, -18); ctx.stroke();
  },
  goal(ctx) {
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const r = i % 2 ? 10 : 23, a = -Math.PI / 2 + (i * Math.PI) / 5;
      ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    ctx.closePath(); ctx.fill();
  },
};

export function beacon(icon, title, sub, color = ESPRESSO) {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 256;
  const ctx = c.getContext('2d');
  ctx.fillStyle = 'rgba(20,26,35,0.86)';
  ctx.beginPath(); ctx.arc(256, 62, 54, 0, Math.PI * 2); ctx.fill();
  ctx.lineWidth = 5; ctx.strokeStyle = color;
  ctx.beginPath(); ctx.arc(256, 62, 54, 0, Math.PI * 2); ctx.stroke();
  ctx.save(); ctx.translate(256, 62); ctx.scale(1.2, 1.2);
  ctx.fillStyle = color; ctx.strokeStyle = color; ctx.lineCap = 'round';
  ICONS[icon](ctx);
  ctx.restore();
  ctx.font = `600 44px ${FONT_SANS}`;
  const tw = Math.max(ctx.measureText(title).width, sub ? (ctx.font = `500 30px ${FONT_MONO}`, ctx.measureText(sub.toUpperCase()).width) : 0);
  const bw = Math.min(500, tw + 44), bh = sub ? 104 : 64;
  ctx.fillStyle = 'rgba(20,26,35,0.86)';
  ctx.beginPath(); ctx.roundRect(256 - bw / 2, 128, bw, bh, 18); ctx.fill();
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillStyle = '#eef1f5';
  ctx.font = `600 44px ${FONT_SANS}`;
  ctx.fillText(title, 256, 161);
  if (sub) {
    ctx.fillStyle = color;
    ctx.font = `500 30px ${FONT_MONO}`;
    ctx.fillText(sub.toUpperCase(), 256, 207);
  }
  return spriteFrom(c, 0.24, 0.12, { depthTest: false, order: 9 });
}

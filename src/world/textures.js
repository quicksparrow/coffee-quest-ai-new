import * as THREE from 'three';

/*
  Procedural textures, painted on canvases at load time. Nothing is downloaded, so the game
  works on any host (including the preview link, which blocks most file types), and the whole
  office costs a few hundred kilobytes of GPU memory. Each surface texture tiles seamlessly and
  is mapped in world space (see Builder), so a carpet tile is the same size everywhere.
*/

// Small seeded random so the office looks the same every run.
function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

function canvas(w, h = w) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return [c, c.getContext('2d')];
}

// Speckle noise over the whole canvas (wraps, so it tiles).
function speckle(ctx, w, h, rand, count, size, colors) {
  for (let i = 0; i < count; i++) {
    ctx.fillStyle = colors[Math.floor(rand() * colors.length)];
    const s = size * (0.5 + rand());
    ctx.fillRect(rand() * w, rand() * h, s, s);
  }
}

// Soft blotches that wrap around the edges (for concrete, stone, plaster).
function blotches(ctx, w, h, rand, count, radius, color) {
  for (let i = 0; i < count; i++) {
    const x = rand() * w, y = rand() * h, r = radius * (0.4 + rand());
    for (const ox of [-w, 0, w]) {
      for (const oy of [-h, 0, h]) {
        const g = ctx.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, r);
        g.addColorStop(0, color);
        g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g;
        ctx.fillRect(x + ox - r, y + oy - r, r * 2, r * 2);
      }
    }
  }
}

const cache = new Map();
function make(key, draw, { repeat = true, srgb = true } = {}) {
  if (cache.has(key)) return cache.get(key);
  const c = draw();
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; }
  t.anisotropy = 8;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  cache.set(key, t);
  return t;
}

export function allTextures() { return [...cache.values()]; }

// ---------- Surfaces (each covers `tile` metres, see SURFACES) ----------

// Office carpet: 50 cm tiles laid in alternating directions, fine fleck.
export const carpet = () => make('carpet', () => {
  const [c, ctx] = canvas(512);
  const r = rng(7);
  ctx.fillStyle = '#6a7686';
  ctx.fillRect(0, 0, 512, 512);
  for (let ty = 0; ty < 2; ty++) {
    for (let tx = 0; tx < 2; tx++) {
      const x0 = tx * 256, y0 = ty * 256, vertical = (tx + ty) % 2 === 0;
      ctx.fillStyle = `rgba(${vertical ? '255,255,255,0.012' : '0,0,0,0.015'})`;
      ctx.fillRect(x0, y0, 256, 256);
      ctx.strokeStyle = 'rgba(0,0,0,0.045)';
      ctx.lineWidth = 2;
      for (let k = 4; k < 256; k += 7) {
        ctx.beginPath();
        if (vertical) { ctx.moveTo(x0 + k, y0); ctx.lineTo(x0 + k, y0 + 256); } else { ctx.moveTo(x0, y0 + k); ctx.lineTo(x0 + 256, y0 + k); }
        ctx.stroke();
      }
    }
  }
  speckle(ctx, 512, 512, r, 9000, 1.6, ['rgba(255,255,255,0.10)', 'rgba(20,30,45,0.16)', 'rgba(150,170,200,0.12)']);
  ctx.strokeStyle = 'rgba(0,0,0,0.1)';
  ctx.lineWidth = 2;
  [0, 256, 512].forEach((k) => { ctx.beginPath(); ctx.moveTo(k, 0); ctx.lineTo(k, 512); ctx.stroke(); ctx.beginPath(); ctx.moveTo(0, k); ctx.lineTo(512, k); ctx.stroke(); });
  return c;
});

// Lobby: large polished stone tiles with faint veins.
export const stone = () => make('stone', () => {
  const [c, ctx] = canvas(1024);
  const r = rng(11);
  for (let ty = 0; ty < 2; ty++) {
    for (let tx = 0; tx < 2; tx++) {
      const v = 226 + Math.floor(r() * 10);
      ctx.fillStyle = `rgb(${v},${v - 3},${v - 9})`;
      ctx.fillRect(tx * 512, ty * 512, 512, 512);
    }
  }
  blotches(ctx, 1024, 1024, r, 40, 140, 'rgba(120,110,100,0.05)');
  ctx.lineCap = 'round';
  for (let i = 0; i < 14; i++) {
    let x = r() * 1024, y = r() * 1024;
    ctx.strokeStyle = `rgba(150,140,130,${0.08 + r() * 0.1})`;
    ctx.lineWidth = 0.6 + r() * 1.6;
    ctx.beginPath(); ctx.moveTo(x, y);
    for (let k = 0; k < 8; k++) { x += (r() - 0.3) * 90; y += (r() - 0.5) * 90; ctx.lineTo(x, y); }
    ctx.stroke();
  }
  speckle(ctx, 1024, 1024, r, 6000, 1.2, ['rgba(0,0,0,0.05)', 'rgba(255,255,255,0.08)']);
  ctx.fillStyle = 'rgba(90,85,80,0.55)';
  [0, 512].forEach((k) => { ctx.fillRect(k, 0, 3, 1024); ctx.fillRect(0, k, 1024, 3); });
  return c;
});

// Wood planks (floors): 18 cm boards with staggered joints and grain.
export const planks = () => make('planks', () => {
  const [c, ctx] = canvas(1024);
  const r = rng(23);
  const rows = 6, h = 1024 / rows;
  for (let i = 0; i < rows; i++) {
    let x = -r() * 700;
    while (x < 1024) {
      const len = 500 + r() * 500;
      const tone = 150 + Math.floor(r() * 40);
      ctx.fillStyle = `rgb(${tone + 40},${tone + 5},${tone - 45})`;
      for (const ox of [0, 1024]) ctx.fillRect(x - ox, i * h, len, h);
      for (let g = 0; g < 26; g++) {
        const gy = i * h + r() * h;
        ctx.strokeStyle = `rgba(80,45,20,${0.05 + r() * 0.1})`;
        ctx.lineWidth = 0.6 + r() * 1.4;
        ctx.beginPath(); ctx.moveTo(x, gy);
        ctx.bezierCurveTo(x + len * 0.3, gy + (r() - 0.5) * 8, x + len * 0.6, gy + (r() - 0.5) * 8, x + len, gy + (r() - 0.5) * 4);
        ctx.stroke();
      }
      ctx.fillStyle = 'rgba(40,20,5,0.45)';
      ctx.fillRect(x, i * h, 2, h);
      x += len;
    }
    ctx.fillStyle = 'rgba(40,20,5,0.4)';
    ctx.fillRect(0, i * h, 1024, 2);
  }
  return c;
});

// Fine wood grain for furniture (light; the material colour tints it to oak or walnut).
export const woodGrain = () => make('woodGrain', () => {
  const [c, ctx] = canvas(512);
  const r = rng(31);
  ctx.fillStyle = '#e6d2b5';
  ctx.fillRect(0, 0, 512, 512);
  for (let g = 0; g < 220; g++) {
    const y = r() * 512;
    ctx.strokeStyle = `rgba(110,70,35,${0.05 + r() * 0.12})`;
    ctx.lineWidth = 0.5 + r() * 2;
    ctx.beginPath(); ctx.moveTo(0, y);
    ctx.bezierCurveTo(170, y + (r() - 0.5) * 14, 340, y + (r() - 0.5) * 14, 512, y);
    ctx.stroke();
  }
  return c;
});

export const concrete = () => make('concrete', () => {
  const [c, ctx] = canvas(512);
  const r = rng(41);
  ctx.fillStyle = '#b9b8b3';
  ctx.fillRect(0, 0, 512, 512);
  blotches(ctx, 512, 512, r, 60, 70, 'rgba(90,90,85,0.07)');
  blotches(ctx, 512, 512, r, 40, 50, 'rgba(255,255,255,0.06)');
  speckle(ctx, 512, 512, r, 7000, 1.3, ['rgba(0,0,0,0.12)', 'rgba(255,255,255,0.1)']);
  return c;
});

// Painted walls: almost flat, a little roller texture so they don't look like plastic.
export const plaster = () => make('plaster', () => {
  const [c, ctx] = canvas(512);
  const r = rng(53);
  ctx.fillStyle = '#f4f2ee';
  ctx.fillRect(0, 0, 512, 512);
  blotches(ctx, 512, 512, r, 50, 80, 'rgba(0,0,0,0.025)');
  speckle(ctx, 512, 512, r, 5000, 1.1, ['rgba(0,0,0,0.035)', 'rgba(255,255,255,0.06)']);
  return c;
});

// Cubicle partition fabric.
export const fabric = () => make('fabric', () => {
  const [c, ctx] = canvas(256);
  const r = rng(61);
  ctx.fillStyle = '#d9dde2';
  ctx.fillRect(0, 0, 256, 256);
  for (let k = 0; k < 256; k += 3) {
    ctx.fillStyle = `rgba(0,0,0,${0.03 + r() * 0.04})`;
    ctx.fillRect(k, 0, 1, 256);
    ctx.fillStyle = `rgba(255,255,255,${0.03 + r() * 0.04})`;
    ctx.fillRect(0, k, 256, 1);
  }
  speckle(ctx, 256, 256, r, 1500, 1, ['rgba(0,0,0,0.06)']);
  return c;
});

// Suspended ceiling: 60 cm tiles.
export const ceiling = () => make('ceiling', () => {
  const [c, ctx] = canvas(256);
  const r = rng(71);
  ctx.fillStyle = '#f1f1ee';
  ctx.fillRect(0, 0, 256, 256);
  speckle(ctx, 256, 256, r, 2500, 1.2, ['rgba(0,0,0,0.06)']);
  ctx.fillStyle = '#c9ccd0';
  [0, 128].forEach((k) => { ctx.fillRect(k, 0, 3, 256); ctx.fillRect(0, k, 256, 3); });
  return c;
});

export const brushed = () => make('brushed', () => {
  const [c, ctx] = canvas(256);
  const r = rng(83);
  ctx.fillStyle = '#c8ccd2';
  ctx.fillRect(0, 0, 256, 256);
  for (let k = 0; k < 400; k++) {
    ctx.fillStyle = `rgba(${r() < 0.5 ? '0,0,0' : '255,255,255'},${0.04 + r() * 0.06})`;
    ctx.fillRect(0, r() * 256, 256, 0.5 + r());
  }
  return c;
});

// Leafy texture for plants (alpha-tested cards).
export const leaves = () => make('leaves', () => {
  const [c, ctx] = canvas(256);
  const r = rng(97);
  for (let i = 0; i < 70; i++) {
    const x = 20 + r() * 216, y = 20 + r() * 216, a = r() * Math.PI * 2, l = 30 + r() * 40;
    const g = 90 + Math.floor(r() * 70);
    ctx.fillStyle = `rgb(${40 + Math.floor(r() * 30)},${g},${50 + Math.floor(r() * 30)})`;
    ctx.save(); ctx.translate(x, y); ctx.rotate(a);
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.quadraticCurveTo(l * 0.5, -l * 0.28, l, 0); ctx.quadraticCurveTo(l * 0.5, l * 0.28, 0, 0); ctx.fill();
    ctx.restore();
  }
  return c;
}, { repeat: false });

// ---------- Pictures (screens, signs, art); mapped 0..1 on a single face ----------

export function screen(kind) {
  return make(`screen-${kind}`, () => {
    const [c, ctx] = canvas(256, 160);
    const r = rng(kind.length * 101);
    const bg = { code: '#1e2430', sheet: '#f4f6f8', chart: '#f7f7f5', mail: '#fbfbfb', slide: '#20324a' }[kind];
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, 256, 160);
    if (kind === 'code') {
      for (let y = 12; y < 150; y += 9) {
        let x = 10 + Math.floor(r() * 4) * 10;
        while (x < 200 && r() > 0.2) {
          const w = 10 + r() * 40;
          ctx.fillStyle = ['#7fb4ff', '#f0a35e', '#9ad38c', '#d7dae0', '#c792ea'][Math.floor(r() * 5)];
          ctx.fillRect(x, y, w, 4);
          x += w + 6;
        }
      }
    } else if (kind === 'sheet') {
      ctx.fillStyle = '#2f7d4f'; ctx.fillRect(0, 0, 256, 12);
      ctx.strokeStyle = '#d5dae0';
      for (let y = 22; y < 160; y += 10) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(256, y); ctx.stroke(); }
      for (let x = 30; x < 256; x += 38) { ctx.beginPath(); ctx.moveTo(x, 12); ctx.lineTo(x, 160); ctx.stroke(); }
      ctx.fillStyle = '#56606d';
      for (let y = 25; y < 158; y += 10) for (let x = 34; x < 250; x += 38) if (r() > 0.3) ctx.fillRect(x, y, 10 + r() * 20, 3);
    } else if (kind === 'chart') {
      ctx.fillStyle = '#39495c'; ctx.fillRect(0, 0, 256, 14);
      const bars = 9;
      for (let i = 0; i < bars; i++) {
        const h = 20 + r() * 90;
        ctx.fillStyle = i % 3 === 2 ? '#e0914f' : '#4f7fc4';
        ctx.fillRect(18 + i * 25, 150 - h, 16, h);
      }
    } else if (kind === 'mail') {
      ctx.fillStyle = '#e8eef6'; ctx.fillRect(0, 0, 70, 160);
      for (let y = 8; y < 150; y += 20) {
        ctx.fillStyle = '#56606d'; ctx.fillRect(78, y, 90 + r() * 60, 4);
        ctx.fillStyle = '#a5adb8'; ctx.fillRect(78, y + 8, 120 + r() * 50, 3);
      }
    } else if (kind === 'slide') {
      ctx.fillStyle = '#f2c14e'; ctx.fillRect(18, 22, 40, 6);
      ctx.fillStyle = '#ffffff'; ctx.font = '700 30px Arial, sans-serif'; ctx.fillText('Q3 REVIEW', 18, 64);
      ctx.font = '400 13px Arial, sans-serif'; ctx.fillStyle = '#b9c7d8'; ctx.fillText('Revenue, roadmap and a new coffee policy', 18, 86);
      for (let i = 0; i < 6; i++) { ctx.fillStyle = '#4f7fc4'; ctx.fillRect(150 + i * 15, 140 - (i + 2) * 7, 10, (i + 2) * 7); }
    }
    return c;
  }, { repeat: false });
}

// Café menu board.
export const menuBoard = () => make('menu', () => {
  const [c, ctx] = canvas(512, 256);
  ctx.fillStyle = '#23272b'; ctx.fillRect(0, 0, 512, 256);
  ctx.fillStyle = '#f3e3c3'; ctx.font = '700 40px Georgia, serif'; ctx.fillText('COFFEE', 26, 56);
  ctx.font = '400 22px Georgia, serif';
  [['Latte', '4.50'], ['Flat white', '4.20'], ['Americano', '3.60'], ['Espresso', '2.90']].forEach(([n, p], i) => {
    ctx.fillText(n, 30, 100 + i * 38); ctx.fillText(p, 400, 100 + i * 38);
  });
  return c;
}, { repeat: false });

// Company sign behind reception (a made-up company).
export const logo = () => make('logo', () => {
  const [c, ctx] = canvas(512, 160);
  ctx.clearRect(0, 0, 512, 160);
  ctx.fillStyle = '#d6a27c';
  ctx.beginPath(); ctx.arc(70, 80, 42, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#2b3440';
  ctx.beginPath(); ctx.arc(70, 80, 22, 0, Math.PI * 2); ctx.fill();
  ctx.font = '700 64px "Barlow Condensed", "Arial Narrow", Arial, sans-serif';
  ctx.fillText('HALCYON', 130, 102);
  return c;
}, { repeat: false });

// Framed abstract art for the walls.
export function art(seed) {
  return make(`art-${seed}`, () => {
    const [c, ctx] = canvas(256, 192);
    const r = rng(seed * 977);
    const palettes = [['#e9e2d4', '#d6a27c', '#2f4858', '#86a8c4'], ['#f1ede4', '#c95d4b', '#e6b85c', '#355c55'], ['#ebe7de', '#5a7fa8', '#a3c0a0', '#23313f']];
    const p = palettes[seed % palettes.length];
    ctx.fillStyle = p[0]; ctx.fillRect(0, 0, 256, 192);
    for (let i = 0; i < 6; i++) {
      ctx.fillStyle = p[1 + (i % 3)];
      ctx.globalAlpha = 0.85;
      if (r() < 0.5) { ctx.beginPath(); ctx.arc(r() * 256, r() * 192, 20 + r() * 60, 0, Math.PI * 2); ctx.fill(); } else ctx.fillRect(r() * 200, r() * 150, 30 + r() * 90, 20 + r() * 70);
    }
    ctx.globalAlpha = 1;
    return c;
  }, { repeat: false });
}

// City skyline seen through the windows: sky, towers with window grids, street trees.
export const skyline = () => make('skyline', () => {
  const [c, ctx] = canvas(2048, 512);
  const r = rng(113);
  const sky = ctx.createLinearGradient(0, 0, 0, 512);
  sky.addColorStop(0, '#9fc3e6'); sky.addColorStop(0.6, '#d7e6f2'); sky.addColorStop(1, '#eef2f4');
  ctx.fillStyle = sky; ctx.fillRect(0, 0, 2048, 512);
  const layer = (count, minH, maxH, tone, alpha) => {
    for (let i = 0; i < count; i++) {
      const w = 60 + r() * 140, h = minH + r() * (maxH - minH), x = r() * 2048;
      for (const ox of [0, -2048, 2048]) {
        ctx.fillStyle = `rgba(${tone[0]},${tone[1]},${tone[2]},${alpha})`;
        ctx.fillRect(x + ox, 470 - h, w, h + 40);
        ctx.fillStyle = 'rgba(255,255,255,0.18)';
        for (let wy = 470 - h + 10; wy < 460; wy += 14) for (let wx = x + ox + 8; wx < x + ox + w - 8; wx += 12) if (r() > 0.3) ctx.fillRect(wx, wy, 6, 8);
      }
    }
  };
  layer(18, 120, 330, [150, 170, 190], 1);
  layer(22, 60, 200, [120, 138, 156], 1);
  for (let i = 0; i < 90; i++) {
    const x = r() * 2048, y = 470 + r() * 20, rad = 14 + r() * 18;
    ctx.fillStyle = `rgb(${70 + r() * 30},${110 + r() * 30},${70 + r() * 20})`;
    ctx.beginPath(); ctx.arc(x, y, rad, 0, Math.PI * 2); ctx.fill();
  }
  ctx.fillStyle = '#8d9398'; ctx.fillRect(0, 490, 2048, 22);
  return c;
});

// Wayfinding sign: stairs pictogram, label, arrow ('up', 'left', 'right' or null).
export function stairsSign(arrow) {
  return make(`sign-stairs-${arrow}`, () => {
    const [c, ctx] = canvas(512, 192);
    ctx.fillStyle = '#26303b';
    ctx.beginPath(); ctx.roundRect(0, 0, 512, 192, 22); ctx.fill();
    ctx.fillStyle = '#ffffff';
    // pictogram: a person-free staircase in a rounded square
    ctx.beginPath(); ctx.roundRect(24, 24, 144, 144, 18); ctx.fill();
    ctx.fillStyle = '#26303b';
    ctx.beginPath(); ctx.moveTo(44, 148); ctx.lineTo(44, 124); ctx.lineTo(74, 124); ctx.lineTo(74, 96); ctx.lineTo(104, 96); ctx.lineTo(104, 68); ctx.lineTo(134, 68); ctx.lineTo(134, 44); ctx.lineTo(150, 44); ctx.lineTo(150, 148); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.font = '700 64px "Barlow Condensed", "Arial Narrow", Arial, sans-serif';
    ctx.fillText('STAIRS', 196, 118);
    if (arrow) {
      ctx.save(); ctx.translate(446, 96);
      ctx.rotate({ up: -Math.PI / 2, left: Math.PI, right: 0 }[arrow]);
      ctx.beginPath(); ctx.moveTo(-26, -10); ctx.lineTo(4, -10); ctx.lineTo(4, -26); ctx.lineTo(32, 0); ctx.lineTo(4, 26); ctx.lineTo(4, 10); ctx.lineTo(-26, 10); ctx.closePath(); ctx.fill();
      ctx.restore();
    }
    return c;
  }, { repeat: false });
}

// Office tower facade across the street: glass curtain wall with mullions.
export const facade = () => make('facade', () => {
  const [c, ctx] = canvas(256);
  const r = rng(131);
  ctx.fillStyle = '#7f98ad'; ctx.fillRect(0, 0, 256, 256);
  for (let y = 0; y < 256; y += 32) {
    for (let x = 0; x < 256; x += 32) {
      const v = 120 + Math.floor(r() * 50);
      ctx.fillStyle = `rgb(${v - 20},${v},${v + 25})`;
      ctx.fillRect(x + 3, y + 5, 26, 24);
      ctx.fillStyle = 'rgba(255,255,255,0.18)';
      ctx.fillRect(x + 3, y + 5, 26, 6);
    }
  }
  ctx.fillStyle = '#d6dbe0';
  for (let k = 0; k < 256; k += 32) { ctx.fillRect(k, 0, 3, 256); ctx.fillRect(0, k, 256, 5); }
  return c;
});

// Water: soft ripples (surfaces) and falling streaks (jets and curtains). Offsets animate.
export const ripples = () => make('ripples', () => {
  const [c, ctx] = canvas(256);
  const r = rng(151);
  ctx.fillStyle = '#6fa7c9'; ctx.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 60; i++) {
    const x = r() * 256, y = r() * 256, rad = 8 + r() * 30;
    for (const ox of [-256, 0, 256]) for (const oy of [-256, 0, 256]) {
      ctx.strokeStyle = `rgba(255,255,255,${0.15 + r() * 0.2})`; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.ellipse(x + ox, y + oy, rad, rad * 0.6, 0, 0, Math.PI * 2); ctx.stroke();
    }
  }
  return c;
});

export const streaks = () => make('streaks', () => {
  const [c, ctx] = canvas(128, 256);
  const r = rng(167);
  ctx.fillStyle = 'rgba(210,235,250,0.55)'; ctx.fillRect(0, 0, 128, 256);
  for (let i = 0; i < 70; i++) {
    const x = r() * 128, y = r() * 256, h = 20 + r() * 60;
    for (const oy of [-256, 0, 256]) { ctx.fillStyle = `rgba(255,255,255,${0.3 + r() * 0.5})`; ctx.fillRect(x, y + oy, 1.5 + r() * 2, h); }
  }
  return c;
});

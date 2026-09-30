import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import * as TX from './textures.js';

/*
  Set dressing: everything that makes the graybox read as an office. None of it collides or
  changes the gameplay (the level's colliders are untouched); it's all static and merged into
  a few meshes per material by the Builder, so it costs little to draw.
*/

const F2 = 4;
const up = new THREE.Vector3(0, 1, 0);

export function decorate(b) {
  const M = materials(b);
  const put = (geo, mat, x, y, z, rotY = 0, opts) => {
    geo.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromAxisAngle(up, rotY), new THREE.Vector3(1, 1, 1)));
    b.addGeo(geo, mat, opts);
  };
  const box = (sx, sy, sz, mat, x, y, z, rotY = 0, opts) => put(new THREE.BoxGeometry(sx, sy, sz), mat, x, y + sy / 2, z, rotY, opts);
  const rbox = (sx, sy, sz, r, mat, x, y, z, rotY = 0, opts) => put(new RoundedBoxGeometry(sx, sy, sz, 2, r), mat, x, y + sy / 2, z, rotY, opts);
  const cyl = (rt, rb, h, mat, x, y, z, seg = 16, opts) => put(new THREE.CylinderGeometry(rt, rb, h, seg), mat, x, y + h / 2, z, 0, opts);
  // A picture on a wall/panel: a plane facing `rotY` (0 = facing +z).
  const picture = (w, h, mat, x, y, z, rotY) => put(new THREE.PlaneGeometry(w, h), mat, x, y, z, rotY, { cast: false });
  const K = { box, rbox, cyl, put, picture, M, b };

  lights(K);
  furnish(b, M);
  const fountain = plaza(b, M);
  // Things that move every frame (the fountain's water).
  return { update: (dt) => fountain.update(dt) };
}

function materials(b) {
  const basic = (map, opts = {}) => new THREE.MeshBasicMaterial({ map, toneMapped: false, ...opts });
  return {
    panel: b.surface('paint', 0xffffff, { emissive: 0xfff8ee }),
    metal: b.surface('metal', 0xb9c0c8),
    darkMetal: b.surface('metal', 0x3d434b),
    black: b.surface('paint', 0x23262b, { roughness: 0.45 }),
    white: b.surface('paint', 0xf2f2f0, { roughness: 0.5 }),
    oak: b.surface('wood', 0xc99a6b),
    walnut: b.surface('wood', 0x7a5236),
    laminate: b.surface('wood', 0xf3efe8),
    fabricBlue: b.surface('fabric', 0x6f8aa6),
    fabricGrey: b.surface('fabric', 0x9aa6b4),
    fabricRust: b.surface('fabric', 0xb4704e),
    seat: b.surface('fabric', 0x2f3440),
    pot: b.surface('paint', 0xe7e1d6, { roughness: 0.8 }),
    soil: b.surface('paint', 0x3b2e24, { roughness: 1 }),
    screens: ['code', 'sheet', 'chart', 'mail'].map((k) => basic(TX.screen(k))),
    slide: basic(TX.screen('slide')),
    menu: basic(TX.menuBoard()),
    logo: new THREE.MeshStandardMaterial({ map: TX.logo(), transparent: true, roughness: 0.4 }),
    art: [0, 1, 2].map((i) => new THREE.MeshStandardMaterial({ map: TX.art(i + 1), roughness: 0.7 })),
    // Alpha-to-coverage (with the canvas's antialiasing) gives soft leaf edges that don't
    // shimmer as you move, unlike a plain alpha cut-out.
    leaves: new THREE.MeshStandardMaterial({ map: TX.leaves(), alphaTest: 0.4, alphaToCoverage: true, side: THREE.DoubleSide, roughness: 0.8 }),
    box: b.surface('paint', 0xb8966c, { roughness: 0.9 }),
    paper: b.surface('paint', 0xf7f7f2, { roughness: 0.9 }),
    pastry: b.surface('paint', 0xc98a4b, { roughness: 0.7 }),
    glassCase: b.surface('glass', 0xdfeaf2, { opacity: 0.35 }),
    sign: (arrow) => new THREE.MeshStandardMaterial({ map: TX.stairsSign(arrow), roughness: 0.5 }),
    paver: b.surface('stone', 0xd9cfc0),
    stoneTrim: b.surface('concrete', 0xe3ddd2),
    bark: b.surface('paint', 0x5b4636, { roughness: 1 }),
    foliage: new THREE.MeshStandardMaterial({ color: 0x5f8f4e, roughness: 0.9, flatShading: true }),
    foliage2: new THREE.MeshStandardMaterial({ color: 0x77a35a, roughness: 0.9, flatShading: true }),
    lamp: b.surface('paint', 0xffffff, { emissive: 0xfff1d6 }),
    flag: [0xd6a27c, 0x2f4858, 0x86a8c4].map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.8, side: THREE.DoubleSide })),
    rug: Object.assign(new THREE.MeshStandardMaterial({ map: TX.fabric(), color: 0x7e8e76, roughness: 1 }), { userData: { tile: 0.5 } }),
  };
}

// Recessed light panels in both ceilings.
// A panel never cuts into a wall (where one crossed a wall its edge shared the wall's face and
// flickered): it moves along the ceiling to a clear spot nearby, or is left out.
function lights({ box, M, b }) {
  const holes = [[20, 0, 26, 9], [10, 0, 14, 4]];   // stairwell, shaft (ground ceiling)
  const inHole = (x, z, list) => list.some(([x1, z1, x2, z2]) => x > x1 - 0.8 && x < x2 + 0.8 && z > z1 - 0.5 && z < z2 + 0.5);
  const R = b.R, shape = new R.Cuboid(0.66, 0.1, 0.36), rot = { x: 0, y: 0, z: 0, w: 1 };
  const clear = (x, y, z) => !b.world.intersectionWithShape({ x, y: y - 0.2, z }, rot, shape);
  const place = (x, y, z) => {
    for (const [dx, dz] of [[0, 0], [0.8, 0], [-0.8, 0], [0, 0.8], [0, -0.8], [1.2, 0], [-1.2, 0]]) {
      if (clear(x + dx, y, z + dz)) { box(1.2, 0.03, 0.6, M.panel, x + dx, y, z + dz, 0, { cast: false }); return; }
    }
  };
  b.world.step();                                  // (the walls need to be in the broad phase)
  for (let x = 2.5; x < 32; x += 4) {
    for (let z = 2.5; z < 24; z += 4) {
      if (!inHole(x, z, holes)) place(x, 3.67, z);
      if (!inHole(x, z, [[10, 0, 14, 4]])) place(x, 6.97, z);
    }
  }
}

// The city outside the windows: a skyline on a big cylinder and the street below.
export function backdrop(scene) {
  const tex = TX.skyline();
  tex.wrapS = THREE.RepeatWrapping;
  tex.repeat.set(3, 1);
  const cyl = new THREE.Mesh(
    new THREE.CylinderGeometry(55, 55, 34, 48, 1, true),
    new THREE.MeshBasicMaterial({ map: tex, side: THREE.BackSide, toneMapped: false, fog: false }),
  );
  cyl.position.set(16, 12, 12);
  const street = new THREE.Mesh(
    new THREE.PlaneGeometry(160, 160),
    new THREE.MeshStandardMaterial({ color: 0x9a9c9e, roughness: 0.95, map: TX.concrete() }),
  );
  street.material.map = street.material.map.clone();
  street.material.map.repeat.set(40, 40);
  street.material.map.needsUpdate = true;
  street.rotation.x = -Math.PI / 2;
  street.position.set(16, -0.32, 12);
  street.receiveShadow = true;
  for (const o of [cyl, street]) {
    scene.add(o);
    o.updateMatrixWorld(true);
    o.matrixAutoUpdate = false;
  }
}

// ---------- Furniture kit ----------
// A piece at (x, y, z) turned by rot (0 = its front faces +z). Parts are given in local metres.
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const ONE = new THREE.Vector3(1, 1, 1);
const Q = (r) => new THREE.Quaternion().setFromAxisAngle(up, r);

export function piece(b, x, y, z, rot = 0) {
  const base = new THREE.Matrix4().compose(V(x, y, z), Q(rot), ONE);
  const add = (geo, mat, lx, ly, lz, lrot = 0, opts) => {
    geo.applyMatrix4(new THREE.Matrix4().compose(V(lx, ly, lz), Q(lrot), ONE)).applyMatrix4(base);
    b.addGeo(geo, mat, opts);
  };
  return {
    box: (sx, sy, sz, mat, lx, ly, lz, lrot = 0, opts) => add(new THREE.BoxGeometry(sx, sy, sz), mat, lx, ly + sy / 2, lz, lrot, opts),
    rbox: (sx, sy, sz, r, mat, lx, ly, lz, lrot = 0, opts) => add(new RoundedBoxGeometry(sx, sy, sz, 2, r), mat, lx, ly + sy / 2, lz, lrot, opts),
    cyl: (rt, rb, h, mat, lx, ly, lz, seg = 16, opts) => add(new THREE.CylinderGeometry(rt, rb, h, seg), mat, lx, ly + h / 2, lz, 0, opts),
    plane: (w, h, mat, lx, ly, lz, lrot = 0, opts) => add(new THREE.PlaneGeometry(w, h), mat, lx, ly, lz, lrot, { cast: false, ...opts }),
    // A bar (cylinder) between two local points.
    bar: (a, c, r, mat, opts) => {
      const d = c.clone().sub(a), len = d.length();
      const g = new THREE.CylinderGeometry(r, r, len, 8);
      g.applyMatrix4(new THREE.Matrix4().compose(a.clone().add(c).multiplyScalar(0.5), new THREE.Quaternion().setFromUnitVectors(up, d.normalize()), ONE)).applyMatrix4(base);
      b.addGeo(g, mat, opts);
    },
  };
}

export function officeChair(b, M, x, y, z, rot) {
  const p = piece(b, x, y, z, rot);
  // Five legs from a hub. Legs start away from the centre so none overlap (overlapping faces in
  // the same plane flicker).
  p.cyl(0.07, 0.07, 0.05, M.darkMetal, 0, 0.025, 0, 12);
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    p.box(0.24, 0.034, 0.045, M.darkMetal, Math.cos(a) * 0.19, 0.032 + i * 0.0015, Math.sin(a) * 0.19, -a);
    p.cyl(0.025, 0.025, 0.03, M.black, Math.cos(a) * 0.3, 0.004, Math.sin(a) * 0.3, 8);
  }
  p.cyl(0.028, 0.028, 0.33, M.metal, 0, 0.075, 0, 10);
  p.rbox(0.5, 0.08, 0.48, 0.03, M.seat, 0, 0.4, 0.02);
  p.box(0.05, 0.22, 0.04, M.darkMetal, 0, 0.44, -0.23);
  p.rbox(0.46, 0.5, 0.06, 0.03, M.seat, 0, 0.55, -0.25);
  for (const s of [-1, 1]) {
    p.box(0.03, 0.18, 0.03, M.darkMetal, s * 0.26, 0.46, 0.02);
    p.rbox(0.06, 0.03, 0.26, 0.012, M.black, s * 0.26, 0.64, 0.02);
  }
}

// Monitor (front faces +z) with keyboard and mouse in front of it.
export function workstation(b, M, x, y, z, rot, screen, { keyboard = true } = {}) {
  const p = piece(b, x, y, z, rot);
  p.box(0.22, 0.012, 0.16, M.black, 0, 0, -0.04);
  p.box(0.04, 0.3, 0.03, M.black, 0, 0.012, -0.07);
  p.rbox(0.58, 0.35, 0.03, 0.008, M.black, 0, 0.19, -0.05);
  p.plane(0.54, 0.31, screen, 0, 0.365, -0.028);
  if (keyboard) {
    p.rbox(0.42, 0.018, 0.13, 0.006, M.white, 0, 0, 0.2);
    p.rbox(0.06, 0.02, 0.1, 0.01, M.white, 0.3, 0, 0.21);
  }
}

// Laptop, open, screen facing +z's opposite (toward whoever sits at +z).
export function laptop(b, M, x, y, z, rot, screen) {
  const p = piece(b, x, y, z, rot);
  p.rbox(0.34, 0.018, 0.24, 0.008, M.metal, 0, 0, 0);
  p.box(0.3, 0.004, 0.13, M.black, 0, 0.018, -0.02);                 // keyboard (proud of the deck)
  // The lid hinges at the back edge and leans back about 15 degrees.
  const back = new THREE.Vector3(0, 0.018, -0.12).applyAxisAngle(up, rot).add(V(x, y, z));
  const g = new RoundedBoxGeometry(0.34, 0.23, 0.012, 2, 0.006);
  const sc = new THREE.PlaneGeometry(0.31, 0.19);
  const tilt = new THREE.Matrix4().makeRotationX(-0.26);
  for (const [geo, mat, dz] of [[g, M.metal, 0], [sc, screen, 0.0095]]) {
    geo.applyMatrix4(new THREE.Matrix4().makeTranslation(0, 0.115, dz)).applyMatrix4(tilt)
      .applyMatrix4(new THREE.Matrix4().makeRotationY(rot)).applyMatrix4(new THREE.Matrix4().makeTranslation(back.x, back.y, back.z));
    b.addGeo(geo, mat, { cast: mat !== screen });
  }
}

export function plant(b, M, x, y, z, h = 1.2, potR = 0.22, collide = false) {
  const p = piece(b, x, y, z, 0);
  if (collide) b.box(x - potR, y, z - potR, x + potR, y + 0.9, z + potR, { visible: false });
  p.cyl(potR, potR * 0.8, 0.42, M.pot, 0, 0, 0, 18);
  // Soil sits a little proud of the pot's top (their tops used to share a plane and flickered).
  p.cyl(potR * 0.9, potR * 0.9, 0.025, M.soil, 0, 0.415, 0, 18);
  const n = 5;
  for (let i = 0; i < n; i++) {
    p.plane(h * 0.75, h * 0.85, M.leaves, 0, 0.4 + h * 0.42, 0, ((i + 0.5) / n) * Math.PI, { cast: false });
  }
}

export function sofa(b, M, x, y, z, rot, w, d, mat) {
  const p = piece(b, x, y, z, rot);
  for (const s of [-1, 1]) for (const t of [-1, 1]) p.cyl(0.03, 0.025, 0.1, M.darkMetal, s * (w / 2 - 0.15), 0, t * (d / 2 - 0.15), 8);
  p.rbox(w, 0.3, d - 0.05, 0.05, mat, 0, 0.1, 0.02);
  const seats = Math.max(1, Math.round((w - 0.4) / 0.8));
  const sw = (w - 0.4) / seats;
  for (let i = 0; i < seats; i++) p.rbox(sw - 0.03, 0.16, d - 0.35, 0.06, mat, -w / 2 + 0.2 + sw * (i + 0.5), 0.4, 0.12);
  p.rbox(w - 0.1, 0.45, 0.24, 0.08, mat, 0, 0.4, -d / 2 + 0.14);
  for (const s of [-1, 1]) p.rbox(0.2, 0.3, d - 0.05, 0.06, mat, s * (w / 2 - 0.1), 0.38, 0.02);
}

// A cubicle cluster filling the pod footprint (x0..x0+4.3, z0..z0+2.2): a spine partition, end
// panels, four desks with monitors, chairs pulled up, and a bit of desk clutter.
export function pod(b, M, x0, z0, seed) {
  const W = 4.3, D = 2.2, y = F2, cx = x0 + W / 2, cz = z0 + D / 2;
  const p = piece(b, cx, y, cz, 0);
  p.box(W - 0.14, 1.25, 0.06, M.fabricGrey, 0, 0, 0);
  p.box(W - 0.12, 0.025, 0.08, M.darkMetal, 0, 1.25, 0);
  for (const s of [-1, 1]) {
    p.box(0.06, 1.1, D - 0.1, M.fabricGrey, s * (W / 2 - 0.03), 0, 0);
    p.box(0.08, 0.025, D - 0.1, M.darkMetal, s * (W / 2 - 0.03), 1.1, 0);
  }
  let k = seed;
  for (const side of [-1, 1]) {
    for (const i of [0, 1]) {
      const dx = (i - 0.5) * ((W - 0.12) / 2);
      const dz = side * 0.4;
      const rot = side > 0 ? 0 : Math.PI;              // desk front (where you sit) faces away from the spine
      const d = piece(b, cx + dx, y, cz + dz, rot);
      d.box(2.0, 0.03, 0.72, M.laminate, 0, 0.71, 0);
      d.box(0.03, 0.71, 0.66, M.darkMetal, -0.98, 0, 0);
      d.box(0.03, 0.71, 0.66, M.darkMetal, 0.98, 0, 0);
      d.box(1.9, 0.3, 0.02, M.darkMetal, 0, 0.4, -0.3);
      const wx = cx + dx + (side > 0 ? 1 : -1) * 0, wz = cz + dz;
      workstation(b, M, wx, y + 0.74, wz + side * -0.04, rot, M.screens[k++ % M.screens.length]);
      if ((k + i) % 3 === 0) d.cyl(0.04, 0.035, 0.1, M.white, 0.6, 0.74, 0.1, 12);            // mug
      if ((k + side) % 2 === 0) d.box(0.3, 0.02, 0.22, M.paper, -0.6, 0.74, 0.05, 0.2);        // papers
      if (k % 4 === 1) { d.cyl(0.07, 0.06, 0.1, M.pot, -0.8, 0.74, -0.2, 12); d.plane(0.25, 0.25, M.leaves, -0.8, 0.97, -0.2, 0.7); }
      officeChair(b, M, cx + dx + 0.1 * side, y, cz + side * 0.86, rot + Math.PI);
    }
  }
}

// ---------- Where everything goes ----------
// Coordinates follow level1.js. Where a piece replaces a graybox block, that block is now an
// invisible collider in level1.js, so walking and sight lines are exactly as before.
function furnish(b, M) {
  const P = (x, y, z, r) => piece(b, x, y, z, r);
  const G = 0;

  // --- Lobby: reception desk with the company sign, Dana's monitor.
  {
    const p = P(3.5, G, 14.8, 0);
    p.box(5, 1.04, 0.8, M.oak, 0, 0, 0);
    p.box(5.12, 0.05, 0.9, M.white, 0, 1.04, 0.02);
    p.box(4.9, 0.08, 0.02, M.darkMetal, 0, 0.1, 0.41);
    p.plane(1.6, 0.5, M.logo, 0, 0.62, 0.405);
    workstation(b, M, 2.6, G + 1.09, 14.55, Math.PI, M.screens[3], { keyboard: false });
    P(4.6, G + 1.09, 14.6, 0).cyl(0.05, 0.05, 0.14, M.darkMetal, 0, 0, 0, 12);   // pen cup
  }
  // Waiting sofa by the entrance, facing the lobby; plants.
  sofa(b, M, 4.2, G, 22.0, Math.PI, 3.2, 0.8, M.fabricBlue);
  P(4.2, G, 20.8, 0).rbox(1.1, 0.04, 0.55, 0.02, M.walnut, 0, 0.4, 0);
  for (const [x, z] of [[4, 20.8]]) { const t = P(x, G, z, 0); [-0.45, 0.45].forEach((dx) => t.box(0.04, 0.4, 0.45, M.darkMetal, dx, 0, 0)); }
  plant(b, M, 8.0, G, 20.8, 1.3, 0.34);
  plant(b, M, 9.2, G, 22.2, 1.1, 0.32);
  plant(b, M, 3.6, G, 3.6, 1.2, 0.33);
  plant(b, M, 19.3, G, 23.3, 1.2, 0.3, true);
  plant(b, M, 1.0, G, 23.0, 1.4, 0.3, true);
  // Stairs signs: above the stairwell door, and on the mailroom wall pointing the way.
  P(24.5, G, 9.12, 0).plane(0.95, 0.36, M.sign(null), 0, 2.72, 0);
  P(25.88, G, 12.4, -Math.PI / 2).plane(0.8, 0.3, M.sign('left'), 0, 1.75, 0);
  // Art on the mailroom wall (lobby side) and in the secure area.
  P(25.88, G, 15.5, -Math.PI / 2).plane(1.6, 1.2, M.art[0], 0, 1.7, 0);
  P(19.88, G, 6, -Math.PI / 2).plane(1.4, 1.05, M.art[1], 0, 1.7, 0);

  // --- Café: counter with a pastry case, espresso machine, cups, menu board.
  {
    const p = P(21, G, 20, 0);
    p.box(6, 1.04, 0.8, M.walnut, 0, 0, 0);
    p.box(6.1, 0.05, 0.9, M.white, 0, 1.04, 0);
    for (let i = 0; i < 12; i++) p.box(0.03, 0.9, 0.02, M.oak, -2.75 + i * 0.5, 0.07, -0.41);
    p.box(1.6, 0.4, 0.6, M.glassCase, -1.6, 1.09, 0);
    p.box(1.5, 0.02, 0.5, M.white, -1.6, 1.25, 0);
    for (let i = 0; i < 5; i++) p.cyl(0.07, 0.07, 0.06, M.pastry, -2.2 + i * 0.3, 1.1, 0.05, 12);
    const m = P(22.95, G + 1.09, 20, 0);
    m.rbox(1.0, 0.5, 0.5, 0.04, M.metal, 0, 0, 0);
    m.box(0.9, 0.06, 0.4, M.black, 0, 0.5, 0);
    for (const dx of [-0.25, 0.25]) { m.cyl(0.05, 0.05, 0.1, M.black, dx, 0.25, 0.28, 12); m.cyl(0.035, 0.03, 0.07, M.white, dx, 0.02, 0.3, 10); }
    for (let i = 0; i < 4; i++) P(20.3 + i * 0.12, G + 1.09, 20.2, 0).cyl(0.045, 0.035, 0.12 + i * 0.1, M.white, 0, 0, 0, 10);
    const menu = P(21, G, 21.2, Math.PI);
    menu.box(2.2, 0.85, 0.05, M.black, 0, 2.62, 0);                  // above the camera's height
    menu.plane(2.1, 0.8, M.menu, 0, 3.045, 0.035);
    for (const dx of [-0.95, 0.95]) menu.box(0.01, 0.2, 0.01, M.darkMetal, dx, 3.47, 0);
  }

  // --- Turnstiles: steel cabinets are already there; the elevator gets a frame and buttons.
  for (const y of [G, F2]) {
    const p = P(12, y, 4.24, 0);
    for (const s of [-1, 1]) p.box(0.12, 2.6, 0.12, M.metal, s * 1.06, 0, 0);
    p.box(2.24, 0.15, 0.12, M.metal, 0, 2.5, 0);
    p.rbox(0.14, 0.3, 0.04, 0.01, M.metal, 1.4, 1.0, 0);
    p.cyl(0.025, 0.025, 0.02, M.panel, 1.4, 1.1, 0.03, 10);
  }

  // --- Mailroom: pigeonholes with parcels; the cart that props the door; storage.
  {
    const p = P(31.4, G, 19.1, -Math.PI / 2);
    p.box(8.2, 2.2, 0.8, M.oak, 0, 0, 0);
    for (let i = 0; i <= 10; i++) p.box(0.03, 2.1, 0.02, M.walnut, -4 + i * 0.8, 0.05, 0.4);
    for (let j = 1; j < 5; j++) p.box(8.1, 0.03, 0.02, M.walnut, 0, j * 0.44, 0.4);
    let r = 3;
    for (let i = 0; i < 10; i++) for (let j = 0; j < 5; j++) { r = (r * 7 + 3) % 11; if (r < 5) p.box(0.5, 0.18 + r * 0.03, 0.4, r % 2 ? M.box : M.paper, -3.6 + i * 0.8, j * 0.44 + 0.05, 0.15); }
    const c = P(26.7, G, 22.8, 0);
    c.box(0.8, 0.05, 1.0, M.darkMetal, 0, 0.25, 0);
    c.box(0.04, 0.6, 0.04, M.darkMetal, -0.38, 0.3, -0.48);
    c.box(0.04, 0.6, 0.04, M.darkMetal, 0.38, 0.3, -0.48);
    c.box(0.8, 0.04, 0.04, M.darkMetal, 0, 0.88, -0.48);
    for (const [dx, dz] of [[-0.35, -0.45], [0.35, -0.45], [-0.35, 0.45], [0.35, 0.45]]) c.cyl(0.05, 0.05, 0.04, M.black, dx, 0.02, dz, 10);
    c.box(0.6, 0.3, 0.5, M.box, 0, 0.3, 0.1); c.box(0.45, 0.25, 0.35, M.box, 0.05, 0.6, 0.05, 0.3);
  }
  shelving(b, M, 31.1, G, 3.5, -Math.PI / 2, 5, 1.6, 1.4, 7);
  { const t = P(27.7, G, 12.2, 0); t.box(1.3, 0.5, 1.1, M.box, 0, 0, 0); t.box(1.0, 0.4, 0.9, M.box, 0.05, 0.5, 0, 0.2); }

  // --- Stairs: a handrail up each flight of the U (flight A on the east wall, B on the west).
  const LAND = 1.9;
  const yA = (z) => ((7 - z) / 4.8) * LAND, yB = (z) => LAND + ((z - 2.2) / 5.8) * (4 - LAND);
  P(0, 0, 0, 0).bar(V(25.88, 0.95, 7.0), V(25.88, LAND + 0.95, 2.2), 0.025, M.metal);
  for (let z = 6.6; z > 2.2; z -= 1.4) P(0, 0, 0, 0).bar(V(25.88, yA(z) + 0.3, z), V(25.88, yA(z) + 0.95, z), 0.015, M.metal);
  P(0, 0, 0, 0).bar(V(20.12, LAND + 0.95, 2.2), V(20.12, 4.95, 8.0), 0.025, M.metal);
  for (let z = 2.6; z < 8; z += 1.4) P(0, 0, 0, 0).bar(V(20.12, yB(z) + 0.3, z), V(20.12, yB(z) + 0.95, z), 0.015, M.metal);

  // --- Floor 2: cubicle pods.
  [[1.5, 11], [7, 11], [12.5, 11], [18, 11], [12.5, 15], [18, 15], [12.5, 19.5], [18, 19.5]].forEach(([x, z], i) => pod(b, M, x, z, i * 3));
  plant(b, M, 0.55, F2, 9.45, 1.3, 0.3, true);
  plant(b, M, 25.4, F2, 9.6, 1.2, 0.28, true);
  plant(b, M, 9.6, F2, 16.9, 1.2, 0.28, true);
  P(5, F2, 9.11, 0).plane(1.6, 1.1, M.art[2], 0, 1.65, 0);
  P(17, F2, 9.11, 0).plane(1.3, 1.0, M.art[0], 0, 1.65, 0);

  // --- Kitchen: cabinets and counter, upper cupboards, espresso machine, fridge, island, stools.
  {
    const p = P(31.6, F2, 12.9, -Math.PI / 2);
    p.box(6.6, 0.88, 0.78, M.white, 0, 0.04, 0);
    p.box(6.6, 0.04, 0.8, M.darkMetal, 0, 0, 0.0);
    p.box(6.7, 0.04, 0.84, M.walnut, 0, 0.92, 0.02);
    for (let i = 0; i < 11; i++) p.box(0.2, 0.02, 0.02, M.darkMetal, -3 + i * 0.6, 0.78, 0.4);
    p.box(6.6, 0.7, 0.36, M.white, 0, 1.55, -0.2);
    for (let i = 0; i < 11; i++) p.box(0.02, 0.2, 0.02, M.darkMetal, -3 + i * 0.6, 1.6, -0.01);
    p.box(0.6, 0.02, 0.4, M.metal, 2.0, 0.965, 0.05);                                  // sink
    const m = P(31.55, F2 + 0.96, 12.7, -Math.PI / 2);
    m.rbox(0.9, 0.55, 0.55, 0.05, M.metal, 0, 0, 0);
    m.box(0.8, 0.07, 0.45, M.black, 0, 0.55, 0);
    for (const dx of [-0.2, 0.2]) { m.cyl(0.05, 0.05, 0.1, M.black, dx, 0.28, 0.3, 12); m.cyl(0.035, 0.03, 0.07, M.white, dx, 0.02, 0.32, 10); }
    P(31.55, F2 + 0.96, 14.2, 0).cyl(0.16, 0.12, 0.1, M.white, 0, 0, 0, 16);          // fruit bowl
    const f = P(26.8, F2, 15.5, Math.PI / 2);
    f.rbox(1.35, 2.0, 0.95, 0.04, M.metal, 0, 0, 0);
    f.box(1.3, 0.01, 0.01, M.darkMetal, 0, 1.25, 0.48);
    f.box(0.03, 0.6, 0.04, M.darkMetal, -0.55, 1.35, 0.5);
    const isl = P(28.5, F2, 11.6, 0);
    isl.box(1.4, 0.9, 2.4, M.white, 0, 0, 0);
    isl.box(1.7, 0.05, 2.6, M.walnut, 0.15, 0.9, 0);
    for (const z of [10.8, 11.6, 12.4]) {
      const st = P(29.65, F2, z, 0);
      st.cyl(0.02, 0.02, 0.62, M.darkMetal, 0, 0, 0, 8);
      st.cyl(0.18, 0.2, 0.02, M.darkMetal, 0, 0, 0, 16);
      st.cyl(0.18, 0.18, 0.06, M.seat, 0, 0.62, 0, 16);
    }
  }

  // --- Meeting 2B: table, chairs, the screen with Linda's slides, art, a plant.
  {
    const t = P(4.25, F2, 20.1, 0);
    t.rbox(4.5, 0.05, 3.0, 0.02, M.walnut, 0, 0.7, 0);
    for (const s of [-1, 1]) { t.box(0.12, 0.7, 1.6, M.darkMetal, s * 1.4, 0, 0); t.box(0.5, 0.03, 2.0, M.darkMetal, s * 1.4, 0, 0); }
    [[3.0, 17.95, 0], [4.6, 17.95, 0], [3.0, 22.25, Math.PI], [4.6, 22.25, Math.PI]].forEach(([x, z, r]) => officeChair(b, M, x, F2, z, r));
    const tv = P(0.12, F2, 20.25, Math.PI / 2);
    tv.box(2.2, 1.28, 0.06, M.black, 0, 1.0, 0);
    tv.plane(2.1, 1.2, M.slide, 0, 1.64, 0.035);
    P(4.5, F2, 16.61, 0).plane(1.6, 1.1, M.art[1], 0, 1.7, 0);
    plant(b, M, 0.7, F2, 23.3, 1.3, 0.3, true);
    laptop(b, M, 4.4, F2 + 0.75, 21.2, 0, M.screens[2]);                                    // Sam's laptop
  }

  // --- Lounge: sofa, coffee table on a rug, plants.
  sofa(b, M, 30.05, F2, 22.5, Math.PI, 3.1, 1.4, M.fabricRust);
  {
    const t = P(30.1, F2, 20.9, 0);
    t.rbox(1.4, 0.05, 0.7, 0.02, M.oak, 0, 0.38, 0);
    for (const [dx, dz] of [[-0.6, -0.28], [0.6, -0.28], [-0.6, 0.28], [0.6, 0.28]]) t.box(0.04, 0.38, 0.04, M.darkMetal, dx, 0, dz);
    t.box(3.0, 0.006, 2.2, M.rug, 0, 0.014, 0.3);                 // clear of the floor colour
    t.cyl(0.05, 0.04, 0.1, M.white, 0.3, 0.43, 0.1, 12);
  }
  plant(b, M, 31.4, F2, 17.2, 1.4, 0.3, true);
  plant(b, M, 26.5, F2, 16.95, 1.1, 0.26, true);

  // --- Phone pods: a roof, a frame, a little desk and stool inside each.
  for (const z of [18.6, 21.7]) {
    const p = P(24.4, F2, z, 0);
    p.box(2.04, 0.08, 2.24, M.darkMetal, 0, 2.3, 0);
    for (const [dx, dz] of [[-1, -1.1], [1, -1.1], [-1, 1.1], [1, 1.1]]) p.box(0.05, 2.3, 0.05, M.darkMetal, dx, 0, dz);
    p.box(1.9, 0.04, 0.45, M.oak, 0.1, 0.95, 0, Math.PI / 2);
    p.cyl(0.18, 0.18, 0.45, M.fabricBlue, -0.2, 0, 0, 16);
    p.box(0.5, 0.02, 0.5, M.panel, 0, 2.27, 0);
    // Glass door on the aisle side: frame, hinge side, a long bar handle.
    const dz = 0.45;
    for (const e of [-dz, dz]) p.box(0.06, 2.1, 0.05, M.darkMetal, -1.03, 0, e);
    p.box(0.06, 0.05, dz * 2 + 0.05, M.darkMetal, -1.03, 2.1, 0);
    p.box(0.02, 0.9, 0.025, M.metal, -1.08, 0.6, dz - 0.12);
    for (const y of [0.6, 1.47]) p.box(0.05, 0.02, 0.02, M.metal, -1.05, y, dz - 0.12);
  }

  // --- Printer and a paper stack.
  {
    const p = P(10.8, F2, 23.4, Math.PI);
    p.box(1.3, 0.62, 0.72, M.white, 0, 0, 0);
    p.rbox(1.2, 0.42, 0.68, 0.03, M.paper, 0, 0.62, 0);
    p.box(0.4, 0.06, 0.25, M.black, 0.35, 1.04, 0.2, 0.3);
    p.box(0.7, 0.04, 0.35, M.paper, -0.1, 0.9, 0.3);
    p.box(0.5, 0.12, 0.35, M.paper, 0.9, 0, 0.1);
  }

  // --- Supply closet shelving.
  shelving(b, M, 29, F2, 0.8, 0, 5.2, 2.0, 0.8, 11);
}

// Metal shelving with a random-looking (but fixed) mix of boxes.
function shelving(b, M, x, y, z, rot, w, h, d, seed) {
  const p = piece(b, x, y, z, rot);
  for (const s of [-1, 1]) for (const t of [-1, 1]) p.box(0.04, h, 0.04, M.darkMetal, s * (w / 2 - 0.02), 0, t * (d / 2 - 0.02));
  const levels = 4;
  let r = seed;
  for (let j = 0; j < levels; j++) {
    const yy = 0.08 + j * (h - 0.1) / (levels - 0.5);
    p.box(w - 0.012, 0.03, d - 0.012, M.metal, 0, yy, 0);   // inside the uprights, not flush
    for (let x0 = -w / 2 + 0.1; x0 < w / 2 - 0.4; ) {
      r = (r * 13 + 7) % 17;
      const bw = 0.3 + (r % 5) * 0.08;
      if (r % 4 !== 0) p.box(bw, 0.2 + (r % 3) * 0.08, d * 0.8, r % 2 ? M.box : M.paper, x0 + bw / 2, yy + 0.03, 0);
      x0 += bw + 0.06;
    }
  }
}

// ---------- Outside the front door: a plaza with a fountain, trees, benches, lamps and flags,
// and an office tower across the street. Seen through the glass entrance and lobby windows.
function plaza(b, M) {
  const P = (x, y, z, r) => piece(b, x, y, z, r);
  const facade = new THREE.MeshStandardMaterial({ map: TX.facade(), roughness: 0.3, metalness: 0.2, envMapIntensity: 1.2 });
  facade.userData.tile = 8;
  // Paving at entrance level, with a step down to the street at the far edge.
  P(15, -0.32, 34.5, 0).box(40, 0.32, 20, M.paver, 0, 0, 0);          // starts where the building slab ends (no overlap)
  P(15, -0.32, 44.7, 0).box(40, 0.16, 0.4, M.stoneTrim, 0, 0, 0);
  // Canopy over the entrance.
  const c = P(15, 0, 24, 0);
  c.box(6, 0.16, 2.6, M.darkMetal, 0, 3.05, 1.35);
  c.box(5.8, 0.02, 2.4, M.lamp, 0, 3.04, 1.35, 0, { cast: false });
  for (const s of [-2.8, 2.8]) c.box(0.1, 3.05, 0.1, M.darkMetal, s, 0, 2.5);
  // Fountain: basin, water, a column with an upper bowl, a curtain of water, arcing jets.
  const fx = 15, fz = 33;
  const f = P(fx, 0, fz, 0);
  f.cyl(3.1, 3.2, 0.5, M.stoneTrim, 0, 0, 0, 48);
  f.cyl(0.4, 0.5, 1.3, M.stoneTrim, 0, 0.45, 0, 20);
  f.cyl(1.0, 0.35, 0.28, M.stoneTrim, 0, 1.6, 0, 32);
  const water = [];
  const scene = b.scene;
  const add = (geo, mat, x, y, z) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.renderOrder = 2; scene.add(m); return m; };
  const rip = TX.ripples().clone(); rip.needsUpdate = true; rip.repeat.set(3, 3);
  const surf = new THREE.MeshStandardMaterial({ map: rip, color: 0x9fd0ea, roughness: 0.08, metalness: 0.1, transparent: true, opacity: 0.85, envMapIntensity: 1.4 });
  const pool = new THREE.CircleGeometry(2.95, 48); pool.rotateX(-Math.PI / 2);
  add(pool, surf, fx, 0.44, fz);
  const bowl = new THREE.CircleGeometry(0.92, 32); bowl.rotateX(-Math.PI / 2);
  add(bowl, surf, fx, 1.86, fz);
  const st = TX.streaks().clone(); st.needsUpdate = true; st.wrapS = st.wrapT = THREE.RepeatWrapping; st.repeat.set(6, 1);
  const fall = new THREE.MeshStandardMaterial({ map: st, transparent: true, depthWrite: false, side: THREE.DoubleSide, roughness: 0.1, color: 0xe6f4fc, opacity: 0.8 });
  add(new THREE.CylinderGeometry(0.98, 1.15, 1.4, 32, 1, true), fall, fx, 1.15, fz);
  const jetTex = TX.streaks().clone(); jetTex.needsUpdate = true; jetTex.wrapS = jetTex.wrapT = THREE.RepeatWrapping; jetTex.repeat.set(1, 3);
  const jet = new THREE.MeshStandardMaterial({ map: jetTex, transparent: true, depthWrite: false, roughness: 0.1, color: 0xeaf6fd, opacity: 0.85 });
  add(new THREE.CylinderGeometry(0.03, 0.09, 1.1, 10, 1, true), jet, fx, 2.4, fz);
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    const from = new THREE.Vector3(Math.cos(a) * 2.8, 0.5, Math.sin(a) * 2.8);
    const to = new THREE.Vector3(Math.cos(a) * 1.35, 0.45, Math.sin(a) * 1.35);
    const top = from.clone().lerp(to, 0.45).setY(1.5);
    const curve = new THREE.QuadraticBezierCurve3(from, top, to);
    add(new THREE.TubeGeometry(curve, 16, 0.035, 6, false), jet, fx, 0, fz);
  }
  water.push(rip, st, jetTex);
  // Planters with trees, benches facing the fountain, lamp posts, flags, bollards.
  const tree = (x, z) => {
    const t = P(x, 0, z, 0);
    t.box(1.6, 0.55, 1.6, M.stoneTrim, 0, 0, 0);
    t.box(1.45, 0.02, 1.45, M.soil, 0, 0.55, 0);
    t.cyl(0.1, 0.14, 2.4, M.bark, 0, 0.55, 0, 10);
    const leaf = (r, dx, dy, dz, m) => { const g = new THREE.IcosahedronGeometry(r, 1); g.translate(x + dx, dy, z + dz); b.addGeo(g, m); };
    leaf(1.1, 0, 3.3, 0, M.foliage); leaf(0.8, 0.6, 3.0, 0.3, M.foliage2); leaf(0.75, -0.5, 3.1, -0.4, M.foliage2); leaf(0.7, 0.1, 3.9, -0.2, M.foliage);
  };
  [[5, 28.5], [25, 28.5], [4, 39], [26, 39]].forEach(([x, z]) => tree(x, z));
  const bench = (x, z, rot) => {
    const t = P(x, 0, z, rot);
    t.box(2, 0.08, 0.5, M.oak, 0, 0.42, 0);
    t.box(2, 0.4, 0.06, M.oak, 0, 0.55, -0.24);
    for (const s of [-0.8, 0.8]) t.box(0.06, 0.42, 0.45, M.darkMetal, s, 0, 0);
  };
  bench(fx - 5, fz, Math.PI / 2); bench(fx + 5, fz, -Math.PI / 2); bench(fx, fz + 5, Math.PI);
  const lampPost = (x, z) => { const t = P(x, 0, z, 0); t.cyl(0.06, 0.08, 3.6, M.darkMetal, 0, 0, 0, 10); t.cyl(0.25, 0.18, 0.3, M.darkMetal, 0, 3.6, 0, 12); t.cyl(0.2, 0.2, 0.05, M.lamp, 0, 3.58, 0, 12); };
  [[9, 27], [21, 27], [9, 40], [21, 40]].forEach(([x, z]) => lampPost(x, z));
  [[22.5, 26.5], [24, 26.5], [25.5, 26.5]].forEach(([x, z], i) => {
    const t = P(x, 0, z, 0);
    t.cyl(0.04, 0.05, 6, M.metal, 0, 0, 0, 8);
    t.plane(1.2, 0.75, M.flag[i], 0.62, 5.4, 0, 0);
  });
  for (let x = -3; x <= 33; x += 3) P(x, 0, 43.6, 0).cyl(0.1, 0.12, 0.8, M.darkMetal, 0, 0, 0, 10);
  // Across the street: an office tower and a lower block.
  P(8, -0.32, 60, 0).box(18, 36, 10, facade, 0, 0, 0);
  P(28, -0.32, 58, 0).box(14, 20, 8, facade, 0, 0, 0);
  P(-12, -0.32, 30, 0).box(10, 26, 16, facade, 0, 0, 0);
  P(44, -0.32, 28, 0).box(10, 30, 14, facade, 0, 0, 0);
  return {
    update(dt) {
      rip.offset.x += dt * 0.02; rip.offset.y += dt * 0.013;
      st.offset.y += dt * 0.9;
      jetTex.offset.y -= dt * 1.6;
    },
  };
}

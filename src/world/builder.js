import * as THREE from 'three';

export const WALL_T = 0.2;      // wall thickness (m)
export const DOOR_H = 2.5;      // doorway height (m)

// Graybox palette: soft office neutrals with color-coded zones.
export const PALETTE = {
  wall: 0xdfe3e8,
  wallF2: 0xe6e2dc,
  glass: 0x9cc6e4,
  counter: 0xb08d6e,
  desk: 0xc9ced6,
  partition: 0x8e9bab,
  stairs: 0xbfc5cc,
  rail: 0x6f7c8c,
  lobby: 0xcfd6dd,
  secure: 0xc3ccd6,
  cafe: 0xc9a98a,
  mail: 0xb7b2a9,
  service: 0xaaa69f,
  stair: 0xb9bec4,
  office: 0x9fb0c4,
  kitchen: 0xd9d2c4,
  meeting: 0xc7b299,
  closet: 0xa8a39a,
  pods: 0xa9c3d6,
  elevator: 0x8d97a3,
};

export class Builder {
  constructor(scene, world, RAPIER) {
    this.scene = scene;
    this.world = world;
    this.R = RAPIER;
    this.geo = new THREE.BoxGeometry(1, 1, 1);
    this.mats = new Map();
    this.xrayMats = new Set(); // materials that fade in x-ray view
  }

  mat(color, { xray = false, opacity = 1 } = {}) {
    const key = `${color}-${xray}-${opacity}`;
    if (!this.mats.has(key)) {
      const m = new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0.02 });
      if (opacity < 1) { m.transparent = true; m.opacity = opacity; m.depthWrite = false; }
      m.userData.baseOpacity = opacity;
      this.mats.set(key, m);
      if (xray) this.xrayMats.add(m);
    }
    return this.mats.get(key);
  }

  // Axis-aligned box from min/max corners. Returns { mesh, collider }.
  box(x1, y1, z1, x2, y2, z2, { color = PALETTE.wall, collide = true, visible = true, cast = true, receive = true, xray = false, opacity = 1, parent = this.scene } = {}) {
    const sx = x2 - x1, sy = y2 - y1, sz = z2 - z1;
    const cx = (x1 + x2) / 2, cy = (y1 + y2) / 2, cz = (z1 + z2) / 2;
    let mesh = null;
    if (visible) {
      mesh = new THREE.Mesh(this.geo, this.mat(color, { xray, opacity }));
      mesh.scale.set(sx, sy, sz);
      mesh.position.set(cx, cy, cz);
      mesh.castShadow = cast;
      mesh.receiveShadow = receive;
      parent.add(mesh);
    }
    let collider = null;
    if (collide) {
      collider = this.world.createCollider(
        this.R.ColliderDesc.cuboid(sx / 2, sy / 2, sz / 2).setTranslation(cx, cy, cz),
      );
    }
    return { mesh, collider };
  }

  // Wall running along x at a fixed z. gaps: [[xa, xb], ...] become doorways with a lintel above.
  hwall(z, x1, x2, y0, h, gaps = [], opts = {}) {
    const t = WALL_T / 2;
    this._segments(x1, x2, gaps).forEach(([a, b]) => this.box(a, y0, z - t, b, y0 + h, z + t, { xray: true, ...opts }));
    gaps.forEach(([a, b]) => {
      if (h > DOOR_H) this.box(a, y0 + DOOR_H, z - t, b, y0 + h, z + t, { xray: true, ...opts });
    });
  }

  // Wall running along z at a fixed x.
  vwall(x, z1, z2, y0, h, gaps = [], opts = {}) {
    const t = WALL_T / 2;
    this._segments(z1, z2, gaps).forEach(([a, b]) => this.box(x - t, y0, a, x + t, y0 + h, b, { xray: true, ...opts }));
    gaps.forEach(([a, b]) => {
      if (h > DOOR_H) this.box(x - t, y0 + DOOR_H, a, x + t, y0 + h, b, { xray: true, ...opts });
    });
  }

  _segments(a, b, gaps) {
    const segs = [];
    let cur = a;
    [...gaps].sort((p, q) => p[0] - q[0]).forEach(([ga, gb]) => {
      if (ga > cur) segs.push([cur, ga]);
      cur = Math.max(cur, gb);
    });
    if (cur < b) segs.push([cur, b]);
    return segs;
  }

  // Colored floor zone decal (no collider), slightly above the floor.
  zone(x1, z1, x2, z2, y, color) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(x2 - x1, z2 - z1), this.mat(color));
    m.rotation.x = -Math.PI / 2;
    m.position.set((x1 + x2) / 2, y + 0.006, (z1 + z2) / 2);
    m.receiveShadow = true;
    this.scene.add(m);
    return m;
  }

  // Room name painted on the floor, readable from the follow camera.
  label(text, x, y, z, { size = 1, rot = 0, color = '#2d3744', sub = null } = {}) {
    const c = document.createElement('canvas');
    c.width = 1024; c.height = sub ? 320 : 220;
    const ctx = c.getContext('2d');
    ctx.fillStyle = color;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '700 150px "Barlow Condensed", "Arial Narrow", Arial, sans-serif';
    ctx.globalAlpha = 0.72;
    ctx.fillText(text.toUpperCase(), 512, sub ? 120 : 110);
    if (sub) {
      ctx.font = '500 70px "IBM Plex Sans", Arial, sans-serif';
      ctx.globalAlpha = 0.6;
      ctx.fillText(sub, 512, 250);
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    const w = 4.6 * size, hgt = w * (c.height / c.width);
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(w, hgt),
      new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }),
    );
    m.rotation.x = -Math.PI / 2;
    m.rotation.z = rot;
    m.position.set(x, y + 0.012, z);
    m.renderOrder = 1;
    this.scene.add(m);
    return m;
  }

  // Simple standing figure used as a placeholder for static NPCs (receptionist, barista).
  figure(x, y, z, color, faceYaw = 0) {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.32, 0.9, 6, 12), this.mat(color));
    body.position.y = 0.8;
    body.castShadow = true;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.2, 16, 12), this.mat(0xe4c3a5));
    head.position.y = 1.62;
    head.castShadow = true;
    g.add(body, head);
    g.position.set(x, y, z);
    g.rotation.y = faceYaw;
    this.scene.add(g);
    return g;
  }
}

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import * as TX from './textures.js';

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

// What each palette colour is made of. `tile` is how many metres one copy of the texture
// covers (textures are mapped in world space, so tiles and planks keep their real size).
export const SURFACES = {
  plaster: { map: TX.plaster, tile: 2.5, roughness: 0.92 },
  stone: { map: TX.stone, tile: 2.4, roughness: 0.28, env: 1.0 },
  carpet: { map: TX.carpet, tile: 1.0, roughness: 1.0, env: 0.3 },
  planks: { map: TX.planks, tile: 2.0, roughness: 0.55 },
  wood: { map: TX.woodGrain, tile: 1.2, roughness: 0.5 },
  concrete: { map: TX.concrete, tile: 2.0, roughness: 0.9 },
  fabric: { map: TX.fabric, tile: 0.6, roughness: 1.0, env: 0.3 },
  ceiling: { map: TX.ceiling, tile: 1.2, roughness: 0.95 },
  metal: { map: TX.brushed, tile: 1.0, roughness: 0.35, metalness: 0.75 },
  glass: { roughness: 0.04, metalness: 0.1, env: 1.6 },
  paint: { roughness: 0.6 },
};
const SURFACE_OF = {
  [PALETTE.wall]: ['plaster', 0xeceae6], [PALETTE.wallF2]: ['plaster', 0xeee8df],
  [PALETTE.counter]: ['wood', 0xb07c52], [PALETTE.desk]: ['wood', 0xe9e4dc],
  [PALETTE.partition]: ['fabric', 0x9aa6b4], [PALETTE.stairs]: ['concrete', 0xd8d6d0],
  [PALETTE.rail]: ['metal', 0xb9c0c8], [PALETTE.glass]: ['glass', 0xbfd8ea],
  [PALETTE.lobby]: ['stone', 0xffffff], 0xe9ecef: ['ceiling', 0xffffff],
  // floor zones
  [PALETTE.secure]: ['stone', 0xf2f2f2], [PALETTE.cafe]: ['planks', 0xd9b48f], [PALETTE.mail]: ['concrete', 0xd0cdc6],
  [PALETTE.service]: ['concrete', 0xc4c1ba], [PALETTE.stair]: ['concrete', 0xd6d3cc], [PALETTE.office]: ['carpet', 0xffffff],
  [PALETTE.kitchen]: ['planks', 0xf0d9bf], [PALETTE.meeting]: ['carpet', 0xc9b29a], [PALETTE.closet]: ['concrete', 0xc8c5be],
  [PALETTE.pods]: ['carpet', 0xffffff], [PALETTE.elevator]: ['stone', 0xe0e0e0],
};

/**
 * Builds the graybox. Static boxes and floor zones are not added to the scene one by one:
 * they are collected per material and merged into a handful of meshes in `finalize()`,
 * which takes the level from ~250 draw calls to ~25.
 */
export class Builder {
  constructor(scene, world, RAPIER) {
    this.scene = scene;
    this.world = world;
    this.R = RAPIER;
    this.geo = new THREE.BoxGeometry(1, 1, 1);
    this.mats = new Map();
    this.xrayMats = new Set();   // materials that fade in x-ray view
    this.batches = new Map();    // key → { material, cast, receive, geometries: [] }
    this.textures = [];          // label textures, uploaded to the GPU up front
    this.seeThrough = new Set(); // glass colliders: they stop you, but not a look or the camera
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._v = new THREE.Vector3();
    this._s = new THREE.Vector3();
  }

  // A material from a surface name ('carpet', 'wood', ...) or a palette colour.
  surface(name, color = 0xffffff, { xray = false, opacity = 1, roughness, emissive } = {}) {
    const key = `S-${name}-${color}-${xray}-${opacity}-${roughness}-${emissive}`;
    if (!this.mats.has(key)) {
      const S = SURFACES[name];
      const m = new THREE.MeshStandardMaterial({
        color, roughness: roughness ?? S.roughness, metalness: S.metalness || 0, map: S.map ? S.map() : null,
      });
      if (S.env != null) m.envMapIntensity = S.env;
      if (emissive) { m.emissive = new THREE.Color(emissive); m.emissiveIntensity = 1; }
      m.userData.tile = S.map ? S.tile : 0;
      if (opacity < 1 || xray) { m.transparent = true; m.opacity = opacity; m.depthWrite = opacity >= 1; }
      m.userData.baseOpacity = opacity;
      this.mats.set(key, m);
      if (xray) this.xrayMats.add(m);
    }
    return this.mats.get(key);
  }

  mat(color, { xray = false, opacity = 1 } = {}) {
    const known = SURFACE_OF[color];
    if (known) return this.surface(known[0], known[1], { xray, opacity });
    const key = `${color}-${xray}-${opacity}`;
    if (!this.mats.has(key)) {
      const m = new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0.02 });
      // X-ray materials are always in the transparent pass so fading them never forces a
      // shader recompile (which would cause a visible hitch the first time X is pressed).
      if (opacity < 1 || xray) { m.transparent = true; m.opacity = opacity; m.depthWrite = opacity >= 1; }
      m.userData.baseOpacity = opacity;
      this.mats.set(key, m);
      if (xray) this.xrayMats.add(m);
    }
    return this.mats.get(key);
  }

  _batch(material, geometry, cast, receive) {
    // Same attribute layout for everything merged together, and texture coordinates in world
    // space (metres / tile size) so textures keep their real-world size on every box.
    if (geometry.index) geometry = geometry.toNonIndexed();
    for (const name of Object.keys(geometry.attributes)) if (!['position', 'normal', 'uv'].includes(name)) geometry.deleteAttribute(name);
    if (material.userData.tile) worldUV(geometry, material.userData.tile);
    const key = `${material.uuid}|${cast}|${receive}`;
    if (!this.batches.has(key)) this.batches.set(key, { material, cast, receive, geometries: [] });
    this.batches.get(key).geometries.push(geometry);
  }

  // Any static geometry, already placed in world space (furniture and props). Batched like boxes.
  addGeo(geometry, material, { cast = true, receive = true } = {}) {
    this._batch(material, geometry, cast, receive);
  }

  // Axis-aligned box from min/max corners. Returns { collider }.
  box(x1, y1, z1, x2, y2, z2, { color = PALETTE.wall, collide = true, visible = true, cast = true, receive = true, xray = false, opacity = 1, see = opacity < 1, material = null } = {}) {
    const sx = x2 - x1, sy = y2 - y1, sz = z2 - z1;
    const cx = (x1 + x2) / 2, cy = (y1 + y2) / 2, cz = (z1 + z2) / 2;
    if (visible) {
      const g = this.geo.clone();
      this._m.compose(this._v.set(cx, cy, cz), this._q.identity(), this._s.set(sx, sy, sz));
      g.applyMatrix4(this._m);
      this._batch(material || this.mat(color, { xray, opacity }), g, cast && opacity >= 1, receive);
    }
    let collider = null;
    if (collide) {
      collider = this.world.createCollider(
        this.R.ColliderDesc.cuboid(sx / 2, sy / 2, sz / 2).setTranslation(cx, cy, cz),
      );
      if (see) this.seeThrough.add(collider.handle);
    }
    return { collider };
  }

  // Wall running along x at a fixed z. gaps: [[xa, xb], ...] become doorways with a lintel above.
  hwall(z, x1, x2, y0, h, gaps = [], opts = {}) {
    const t = WALL_T / 2;
    this._segments(x1, x2, gaps).forEach(([a, b]) => {
      this.box(a, y0, z - t, b, y0 + h, z + t, { xray: true, ...opts });
      // Skirting wraps round the wall's ends too (its end faces used to sit in the same plane as
      // the wall's and flickered at the foot of every doorway).
      this.box(a - 0.015, y0, z - t - 0.015, b + 0.015, y0 + 0.1, z + t + 0.015, { color: 0x4a4f57, collide: false, xray: true, cast: false });   // skirting
    });
    gaps.forEach(([a, b]) => {
      if (h > DOOR_H) this.box(a, y0 + DOOR_H, z - t, b, y0 + h, z + t, { xray: true, ...opts });
    });
  }

  // Wall running along z at a fixed x.
  vwall(x, z1, z2, y0, h, gaps = [], opts = {}) {
    const t = WALL_T / 2;
    this._segments(z1, z2, gaps).forEach(([a, b]) => {
      this.box(x - t, y0, a, x + t, y0 + h, b, { xray: true, ...opts });
      this.box(x - t - 0.015, y0, a - 0.015, x + t + 0.015, y0 + 0.1, b + 0.015, { color: 0x4a4f57, collide: false, xray: true, cast: false });   // skirting
    });
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
    const g = new THREE.PlaneGeometry(x2 - x1, z2 - z1);
    g.rotateX(-Math.PI / 2);
    g.translate((x1 + x2) / 2, y + 0.01, (z1 + z2) / 2);
    this._batch(this.zoneMat(color), g, false, true);
  }

  // Floor decals get a depth offset so they always win against the floor they sit on.
  zoneMat(color) {
    const key = `zone-${color}`;
    if (!this.mats.has(key)) {
      const [name, tint] = SURFACE_OF[color] || ['paint', color];
      const S = SURFACES[name];
      const m = new THREE.MeshStandardMaterial({ color: tint, roughness: S.roughness, metalness: 0, map: S.map ? S.map() : null, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
      if (S.env != null) m.envMapIntensity = S.env;
      m.userData.tile = S.map ? S.tile : 0;
      this.mats.set(key, m);
    }
    return this.mats.get(key);
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
    ctx.globalAlpha = 0.42;
    ctx.fillText(text.toUpperCase(), 512, sub ? 120 : 110);
    if (sub) {
      ctx.font = '500 70px "IBM Plex Sans", Arial, sans-serif';
      ctx.globalAlpha = 0.36;
      ctx.fillText(sub, 512, 250);
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    this.textures.push(tex);
    const w = 4.6 * size, hgt = w * (c.height / c.width);
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(w, hgt),
      // Pulled toward the camera so it always wins over the floor colour it's printed on.
      new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }),
    );
    m.rotation.x = -Math.PI / 2;
    m.rotation.z = rot;
    m.position.set(x, y + 0.012, z);
    m.renderOrder = 1;
    this._static(m);
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
    this._static(g);
    return g;
  }

  // Add an object that never moves: compute its matrices once and skip them every frame.
  _static(obj) {
    this.scene.add(obj);
    obj.updateMatrixWorld(true);
    obj.traverse((o) => { o.matrixAutoUpdate = false; o.matrixWorldAutoUpdate = false; });
  }

  // Merge everything collected so far into one mesh per material.
  finalize() {
    let meshes = 0;
    for (const { material, cast, receive, geometries } of this.batches.values()) {
      const merged = mergeGeometries(geometries, false);
      geometries.forEach((g) => g.dispose());
      merged.computeBoundingSphere();
      const mesh = new THREE.Mesh(merged, material);
      mesh.castShadow = cast;
      mesh.receiveShadow = receive;
      // Transparent batches (glass) draw after the solid ones.
      if (material.transparent && material.opacity < 1) mesh.renderOrder = 2;
      this._static(mesh);
      meshes += 1;
    }
    this.batches.clear();
    return meshes;
  }
}

// Texture coordinates from world position: the axis a face points along picks the plane.
function worldUV(g, tile) {
  const pos = g.attributes.position, nor = g.attributes.normal;
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const ax = Math.abs(nor.getX(i)), ay = Math.abs(nor.getY(i)), az = Math.abs(nor.getZ(i));
    let u, v;
    if (ay >= ax && ay >= az) { u = x; v = z; } else if (ax >= az) { u = z; v = y; } else { u = x; v = y; }
    uv[i * 2] = u / tile; uv[i * 2 + 1] = v / tile;
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
}

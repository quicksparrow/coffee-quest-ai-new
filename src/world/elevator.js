import * as THREE from 'three';
import { Reflector } from 'three/addons/objects/Reflector.js';

const TRAVEL_TIME = 3.4;   // seconds between floors
const DOOR_TIME = 0.9;     // doors closing before the car moves
const AUTO_RIDE = 2.5;     // step in and wait: the car leaves on its own after this long
const HOLD_OPEN = 8;       // doors stay open this long when nobody is around

const ease = (k) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);

/**
 * A real elevator car that travels up and down its shaft. Nothing teleports and the screen never
 * goes dark: the player stands on the car's floor and rides it between floors.
 *
 * Shaft: x 10.2–13.8, z 0.2–3.85. Floor tops at y = floors[i].
 */
export class Elevator {
  constructor(builder, R, { floors, x = 12, z = 2, halfX = 1.8, halfZ = 1.82 }) {
    this.floors = floors;
    this.x = x; this.z = z; this.halfX = halfX; this.halfZ = halfZ;
    this.floor = 0;              // floor the car is at (or last left)
    this.target = 0;
    this.phase = 'idle';         // idle | closing | moving
    this.t = 0;
    this.doorsOpen = false;
    this.holdT = 0;
    this.armed = false;          // player stepped in: count down to an automatic ride
    this.autoT = 0;
    this.y = floors[0];
    this.prevY = this.y;
    this.dy = 0;

    const world = builder.world;
    // The car's colliders are free-standing and moved directly each step. (Colliders attached to a
    // kinematic body made the character controller snag on the car floor.)
    // Floor: flush with the building floor at each stop (no lip to trip on) and reaching right up
    // to the landing so there's no gap at the threshold. Then the ceiling and the front gate.
    this.parts = [];
    const part = (desc, ox, oy, oz) => { const c = world.createCollider(desc); this.parts.push({ c, ox, oy, oz }); return c; };
    this.floorCollider = part(R.ColliderDesc.cuboid(halfX, 0.1, 1.9), 0, -0.1, 0.08);
    part(R.ColliderDesc.cuboid(halfX, 0.05, halfZ), 0, 2.7, 0);
    this.gate = part(R.ColliderDesc.cuboid(halfX, 1.3, 0.04), 0, 1.3, halfZ + 0.02);
    this.placeColliders();

    // Car visuals
    const g = new THREE.Group();
    const m = (c, opts = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.6, metalness: 0.2, ...opts });
    const box = (sx, sy, sz, px, py, pz, mat) => {
      const mesh = new THREE.Mesh(builder.geo, mat);
      mesh.scale.set(sx, sy, sz);
      mesh.position.set(px, py, pz);
      mesh.castShadow = false;
      mesh.receiveShadow = true;
      g.add(mesh);
      return mesh;
    };
    box(halfX * 2, 0.16, 3.8, 0, -0.07, 0.08, m(0x4a5260));                           // floor (top 1 cm above the stop)
    box(halfX * 2, 0.08, halfZ * 2, 0, 2.74, 0, m(0xd9dde2));                         // ceiling
    box(1.6, 0.03, 1.2, 0, 2.69, 0, new THREE.MeshBasicMaterial({ color: 0xfff6e0 })); // light panel
    box(halfX * 2 - 0.1, 2.6, 0.05, 0, 1.33, -halfZ + 0.03, m(0x9a7b5e));              // back wall
    box(0.05, 2.6, halfZ * 2 - 0.1, -halfX + 0.03, 1.33, 0, m(0xb9bfc7));              // side walls
    box(0.05, 2.6, halfZ * 2 - 0.1, halfX - 0.03, 1.33, 0, m(0xb9bfc7));
    box(halfX * 2 - 0.3, 0.05, 0.06, 0, 0.95, -halfZ + 0.1, m(0x707a86, { metalness: 0.7 })); // handrail
    // A mirror on the back wall, in a brushed steel frame. It only renders when you're near the
    // car (see main.js), since a mirror draws the scene a second time.
    this.mirror = new Reflector(new THREE.PlaneGeometry(1.5, 1.55), { textureWidth: 512, textureHeight: 512, color: 0xc4c8cc, clipBias: 0.003 });
    this.mirror.position.set(0, 1.62, -halfZ + 0.075);
    g.add(this.mirror);
    const frameMat = m(0x9aa3ad, { metalness: 0.8, roughness: 0.3 });
    box(1.6, 0.05, 0.03, 0, 0.845, -halfZ + 0.065, frameMat);
    box(1.6, 0.05, 0.03, 0, 2.395, -halfZ + 0.065, frameMat);
    box(0.05, 1.6, 0.03, -0.775, 1.62, -halfZ + 0.065, frameMat);
    box(0.05, 1.6, 0.03, 0.775, 1.62, -halfZ + 0.065, frameMat);
    this.group = g;
    g.position.set(x, this.y, z);
    builder.scene.add(g);
    this.lamp = new THREE.PointLight(0xfff1dc, 3, 4.5, 1.6);
    this.lamp.position.set(0, 2.3, 0.2);
    g.add(this.lamp);
  }

  reset() {
    this.floor = 0; this.target = 0; this.phase = 'idle'; this.t = 0;
    this.doorsOpen = false; this.holdT = 0; this.armed = false; this.autoT = 0; this.wasInside = false;
    this.y = this.floors[0]; this.prevY = this.y; this.dy = 0;
    this.placeColliders();
    this.gate.setEnabled(false);
    this.floorCollider.setEnabled(false);
    this.group.position.y = this.y;
  }

  placeColliders() {
    for (const { c, ox, oy, oz } of this.parts) c.setTranslation({ x: this.x + ox, y: this.y + oy, z: this.z + oz });
  }

  // Is the point inside the car (any height near the car floor)?
  contains(p) {
    return Math.abs(p.x - this.x) < this.halfX - 0.05 && Math.abs(p.z - this.z) < this.halfZ + 0.05 && Math.abs(p.y - this.y) < 1.2;
  }

  get moving() { return this.phase === 'moving'; }
  get busy() { return this.phase !== 'idle'; }
  floorOf(y) { return y > 2 ? 1 : 0; }

  // Call button on a floor.
  call(f) {
    if (this.phase !== 'idle') return;
    if (this.floor === f) this.open();
    else this.go(f);
  }

  go(f) {
    if (this.phase !== 'idle' || f === this.floor) return;
    this.target = f;
    this.doorsOpen = false;
    this.phase = 'closing';
    this.t = DOOR_TIME;
    this.armed = false;
  }

  open() { this.doorsOpen = true; this.holdT = HOLD_OPEN; }

  // One fixed step. `landingDoors[f]` are the Door objects on each floor. Returns events.
  update(dt, playerPos, landingDoors) {
    const inside = this.contains(playerPos);
    let arrived = false;
    this.prevY = this.y;
    this.dy = 0;

    if (this.phase === 'closing') {
      this.t -= dt;
      const door = landingDoors[this.floor];
      if (this.t <= 0 && door.open < 0.03) { this.phase = 'moving'; this.t = 0; this.from = this.y; }
    } else if (this.phase === 'moving') {
      this.t += dt / TRAVEL_TIME;
      const k = Math.min(1, this.t);
      const to = this.floors[this.target];
      const ny = this.from + (to - this.from) * ease(k);
      this.dy = ny - this.y;
      this.y = ny;
      if (k >= 1) {
        this.floor = this.target;
        this.phase = 'idle';
        this.open();
        arrived = true;
      }
    } else if (this.doorsOpen) {
      // Stepping in arms an automatic ride; the car won't bounce straight back after arriving.
      if (inside && !this.wasInside) { this.armed = true; this.autoT = 0; }
      if (!inside) this.armed = false;
      if (this.armed) {
        this.autoT += dt;
        if (this.autoT >= AUTO_RIDE) this.go(this.floor === 0 ? 1 : 0);
      }
      const door = landingDoors[this.floor];
      if (!inside && !door.inDoorway(playerPos)) this.holdT -= dt;
      if (this.holdT <= 0) this.doorsOpen = false;
    }
    this.wasInside = inside;

    this.gate.setEnabled(this.phase !== 'idle');
    // At the lobby the building floor is the floor: two coplanar floors make the character
    // controller snag, so the car's own floor only exists once it has left the ground.
    this.floorCollider.setEnabled(this.y > this.floors[0] + 0.05);
    return { arrived, inside };
  }

  // Seconds until an automatic departure (while armed), else null.
  get departIn() { return this.armed && this.phase === 'idle' ? Math.max(0, AUTO_RIDE - this.autoT) : null; }
  get progress() { return this.phase === 'moving' ? Math.min(1, this.t) : null; }

  interpolate(alpha) {
    this.group.position.y = this.prevY + (this.y - this.prevY) * alpha;
  }
}

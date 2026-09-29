import * as THREE from 'three';

/**
 * Keyboard-only follow camera: sits over the shoulder and swings in behind the player on its own.
 * Runs once per rendered frame on the interpolated player pose, with no per-frame allocations.
 */
// Fallback camera offsets (back, up) from the head when a wall is right behind the player.
const CRANE = [[2.1, 1.75], [0.9, 2.1]];
const CRANE_FROM = 1.6, CRANE_FULL = 0.9;   // start blending in below this distance; fully craned here

export class FollowCamera {
  constructor(camera, world, R, { seeThrough = new Set(), groups } = {}) {
    this.camera = camera;
    this.world = world;
    // Look through glass and past coworkers; only walls, floors and ceilings pull the camera in.
    this.groups = groups;
    this.skipGlass = (c) => !seeThrough.has(c.handle);
    this.yaw = 0;
    this.pos = new THREE.Vector3();
    this.look = new THREE.Vector3();
    this.first = true;
    this.distance = 4.6;
    this.lastD = this.distance;
    this.height = 2.35;
    this.ray = new R.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 });
    this._head = new THREE.Vector3();
    this._desired = new THREE.Vector3();
    this._dir = new THREE.Vector3();
    this._alt = new THREE.Vector3();
    this._craneAt = new THREE.Vector3();
    this.crane = -1;                  // which CRANE spot is in use (-1: none)
    this.w = 0;                       // how far the camera has blended toward it
    this._target = new THREE.Vector3();
    this._lookTarget = new THREE.Vector3();
  }

  snap() { this.first = true; this.w = 0; this.crane = -1; }

  update(dt, player) {
    const p = player.renderPos;
    const yaw = player.renderYaw;
    // Swing toward the player's facing, taking the short way around.
    let diff = yaw - this.yaw;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    this.yaw += diff * (this.first ? 1 : 1 - Math.exp(-dt * (player.moving ? 3.4 : 2.4)));

    // Ease the height change when crouching instead of snapping.
    const wantHeight = player.crouching ? 1.9 : 2.35;
    this.height += (wantHeight - this.height) * (this.first ? 1 : 1 - Math.exp(-dt * 8));

    const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
    const head = this._head.set(p.x, p.y + this.height - 0.9, p.z);
    const desired = this._desired.set(head.x + sy * this.distance, p.y + this.height, head.z + cy * this.distance);

    // Pull the camera in if a wall or ceiling is between it and the player's head.
    const dir = this._dir.subVectors(desired, head);
    const dist = dir.length();
    dir.multiplyScalar(1 / dist);
    const r = this.ray;
    r.origin.x = head.x; r.origin.y = head.y; r.origin.z = head.z;
    r.dir.x = dir.x; r.dir.y = dir.y; r.dir.z = dir.z;
    const hit = this.world.castRay(r, dist, true, undefined, this.groups, player.collider, undefined, this.skipGlass);
    let d = hit ? Math.max(0.35, hit.timeOfImpact - 0.25) : dist;
    const target = this._target.copy(head).addScaledVector(dir, d);
    // Backed against a wall (a stair landing, a corner): crane up and look down over the
    // shoulder instead of ending up inside the player's head, if there's room overhead.
    // It blends in gradually as the wall gets closer (and eases over time), and sticks with
    // one crane spot while it stays clear, so it never flips back and forth.
    let want = 0;
    if (d < CRANE_FROM) {
      const castAlt = (i) => {
        const [back, up] = CRANE[i];
        const alt = this._alt.set(sy * back, up, cy * back);
        const altLen = alt.length();
        alt.multiplyScalar(1 / altLen);
        r.dir.x = alt.x; r.dir.y = alt.y; r.dir.z = alt.z;
        const h2 = this.world.castRay(r, altLen, true, undefined, this.groups, player.collider, undefined, this.skipGlass);
        return { d2: h2 ? Math.max(0.35, h2.timeOfImpact - 0.25) : altLen, len: altLen };
      };
      let pick = -1, best = null;
      if (this.crane >= 0) { const c = castAlt(this.crane); if (c.d2 > c.len * 0.85) { pick = this.crane; best = c; } }
      if (pick < 0) {
        for (let i = 0; i < CRANE.length; i++) {
          const c = castAlt(i);
          if (c.d2 > d + 0.5 && (!best || c.d2 > best.d2)) { pick = i; best = c; }
        }
      }
      if (pick >= 0) {
        this.crane = pick;
        const [back, up] = CRANE[pick];
        this._craneAt.set(sy * back, up, cy * back).setLength(best.d2).add(head);
        const x = THREE.MathUtils.clamp((CRANE_FROM - d) / (CRANE_FROM - CRANE_FULL), 0, 1);
        want = x * x * (3 - 2 * x);
      }
    }
    if (want === 0 && this.w < 0.02) this.crane = -1;
    this.w += (want - this.w) * (this.first ? 1 : 1 - Math.exp(-dt * 4));
    if (this.w > 0.001 && this.crane >= 0) {
      target.lerp(this._craneAt, this.w);
      // Make sure the blended spot still sees the head; pull it in if not.
      const to = this._alt.subVectors(target, head);
      const len = to.length();
      to.multiplyScalar(1 / len);
      r.dir.x = to.x; r.dir.y = to.y; r.dir.z = to.z;
      const h4 = this.world.castRay(r, len, true, undefined, this.groups, player.collider, undefined, this.skipGlass);
      if (h4) target.copy(head).addScaledVector(to, Math.max(0.35, h4.timeOfImpact - 0.25));
    }

    const f = player.forward;
    const lookTarget = this._lookTarget.set(p.x + f.x * 1.6, p.y + 1.2, p.z + f.z * 1.6);

    if (this.first) {
      this.pos.copy(target);
      this.look.copy(lookTarget);
      this.first = false;
    } else {
      // Ease toward the new spot, unless a wall has come between the head and where the camera
      // is now: then jump at once, so walls never block the view.
      const to = this._alt.subVectors(this.pos, head);
      const len = to.length();
      let blocked = false;
      if (len > 0.05) {
        to.multiplyScalar(1 / len);
        r.dir.x = to.x; r.dir.y = to.y; r.dir.z = to.z;
        const h3 = this.world.castRay(r, len + 0.12, true, undefined, this.groups, player.collider, undefined, this.skipGlass);
        blocked = !!h3;
      }
      const k = blocked ? 1 : 1 - Math.exp(-dt * 6);
      this.pos.lerp(target, k);
      this.look.lerp(lookTarget, 1 - Math.exp(-dt * 10));
    }
    this.lastD = d;
    this.camera.position.copy(this.pos);
    this.camera.lookAt(this.look);
    player.setFade(this.pos.distanceTo(head) < 1.3 ? 0.35 : 1);
  }
}

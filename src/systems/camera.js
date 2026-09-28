import * as THREE from 'three';

// Keyboard-only follow camera: sits over the shoulder and swings in behind the player on its own.
export class FollowCamera {
  constructor(camera, world, R) {
    this.camera = camera;
    this.world = world;
    this.R = R;
    this.yaw = 0;
    this.pos = new THREE.Vector3();
    this.look = new THREE.Vector3();
    this.first = true;
    this.distance = 4.6;
  }

  snap() { this.first = true; }

  update(dt, player) {
    const p = player.position;
    // Swing toward the player's facing, taking the short way around.
    let diff = player.yaw - this.yaw;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    const swing = this.first ? 1 : Math.min(1, dt * (player.moving ? 3.2 : 2.2));
    this.yaw += diff * swing;

    const height = player.crouching ? 1.9 : 2.35;
    const back = new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    const head = new THREE.Vector3(p.x, p.y + (player.crouching ? 1.1 : 1.45), p.z);
    const desired = head.clone().addScaledVector(back, this.distance);
    desired.y = p.y + height;

    // Pull the camera in if a wall or ceiling is between it and the player's head.
    const dir = desired.clone().sub(head);
    const dist = dir.length();
    dir.normalize();
    const ray = new this.R.Ray(head, dir);
    const hit = this.world.castRay(ray, dist, true, undefined, undefined, player.collider);
    let d = dist;
    if (hit) d = Math.max(0.35, hit.timeOfImpact - 0.25);
    const target = head.clone().addScaledVector(dir, d);

    const lookTarget = new THREE.Vector3(p.x, p.y + 1.2, p.z).addScaledVector(player.forward, 1.6);

    if (this.first) {
      this.pos.copy(target);
      this.look.copy(lookTarget);
      this.first = false;
    } else {
      // Snap inward immediately (so walls never block the view), ease outward.
      const k = d < this.lastD ? 1 : Math.min(1, dt * 6);
      this.pos.lerp(target, k);
      this.look.lerp(lookTarget, Math.min(1, dt * 8));
    }
    this.lastD = d;
    this.camera.position.copy(this.pos);
    this.camera.lookAt(this.look);
    player.setFade(d < 1.3 ? 0.35 : 1);
  }
}

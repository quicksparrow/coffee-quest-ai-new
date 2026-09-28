import * as THREE from 'three';

const HALF = 0.5;      // capsule half-height (cylinder part)
const RADIUS = 0.35;
const CENTER = HALF + RADIUS + 0.01; // capsule center above the feet

export const SPEED = { walk: 3.4, hurry: 6.0, crouch: 1.8 };
const TURN_RATE = 2.8;   // rad/s
const ABOUT_FACE = 0.28; // seconds for a 180° turn

export class Player {
  constructor(scene, world, R, spawn, yaw) {
    this.world = world;
    this.yaw = yaw;
    this.speed = 0;
    this.vy = 0;
    this.crouching = false;
    this.hurrying = false;
    this.moving = false;
    this.turnAnim = null;
    this.bob = 0;

    this.body = world.createRigidBody(
      R.RigidBodyDesc.kinematicPositionBased().setTranslation(spawn.x, spawn.y + CENTER, spawn.z),
    );
    this.collider = world.createCollider(R.ColliderDesc.capsule(HALF, RADIUS), this.body);
    this.controller = world.createCharacterController(0.02);
    this.controller.enableAutostep(0.35, 0.2, false);
    this.controller.enableSnapToGround(0.4);
    this.controller.setMaxSlopeClimbAngle((50 * Math.PI) / 180);
    this.controller.setMinSlopeSlideAngle((60 * Math.PI) / 180);
    this.controller.setSlideEnabled(true);

    // Placeholder body: capsule + head + a "nose" so facing is always readable.
    this.group = new THREE.Group();
    this.inner = new THREE.Group();
    this.mats = [
      new THREE.MeshStandardMaterial({ color: 0x2f6fb0, roughness: 0.6 }),
      new THREE.MeshStandardMaterial({ color: 0xe0b894, roughness: 0.7 }),
      new THREE.MeshStandardMaterial({ color: 0x1d2530, roughness: 0.6 }),
    ];
    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(RADIUS, HALF * 2 - 0.2, 6, 14), this.mats[0]);
    torso.position.y = 0.75;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.22, 18, 14), this.mats[1]);
    head.position.y = 1.55;
    const nose = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.08, 0.14), this.mats[2]);
    nose.position.set(0, 1.58, -0.24);
    const bag = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.36, 0.1), new THREE.MeshStandardMaterial({ color: 0x3a4452, roughness: 0.8 }));
    bag.position.set(0, 0.95, 0.36);
    [torso, head, nose, bag].forEach((m) => { m.castShadow = true; this.inner.add(m); });

    // Coffee cup held in the right hand.
    this.cup = new THREE.Group();
    const cupBody = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.055, 0.17, 16), new THREE.MeshStandardMaterial({ color: 0xf2efe9 }));
    const sleeve = new THREE.Mesh(new THREE.CylinderGeometry(0.073, 0.064, 0.07, 16), new THREE.MeshStandardMaterial({ color: 0x8a5a3c }));
    const lid = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.025, 16), new THREE.MeshStandardMaterial({ color: 0x2b2b2b }));
    lid.position.y = 0.095;
    this.cup.add(cupBody, sleeve, lid);
    this.cup.position.set(0.38, 0.95, -0.22);
    this.cup.visible = false;
    this.inner.add(this.cup);

    this.group.add(this.inner);
    scene.add(this.group);
    this.syncVisual();
  }

  get position() {
    const t = this.body.translation();
    return new THREE.Vector3(t.x, t.y - CENTER, t.z);
  }

  get forward() { return new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw)); }

  get floor() { return this.body.translation().y > 2.5 ? 1 : 0; }

  teleport(p, yaw = this.yaw) {
    this.body.setTranslation({ x: p.x, y: p.y + CENTER, z: p.z }, true);
    this.body.setNextKinematicTranslation({ x: p.x, y: p.y + CENTER, z: p.z });
    this.yaw = yaw;
    this.speed = 0;
    this.vy = 0;
    this.syncVisual();
  }

  update(dt, input, { canMove = true, speedMul = 1 } = {}) {
    // Turning
    if (canMove && input.aboutFace && !this.turnAnim) {
      this.turnAnim = { from: this.yaw, to: this.yaw + Math.PI, t: 0 };
    }
    if (this.turnAnim) {
      this.turnAnim.t += dt / ABOUT_FACE;
      const k = Math.min(1, this.turnAnim.t);
      const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
      this.yaw = this.turnAnim.from + (this.turnAnim.to - this.turnAnim.from) * e;
      if (k >= 1) this.turnAnim = null;
    } else if (canMove) {
      if (input.left) this.yaw += TURN_RATE * dt;
      if (input.right) this.yaw -= TURN_RATE * dt;
    }

    if (canMove && input.crouch) this.crouching = !this.crouching;
    this.hurrying = canMove && input.hurry && input.forward && !this.crouching;
    if (this.hurrying) this.crouching = false;

    const base = this.crouching ? SPEED.crouch : this.hurrying ? SPEED.hurry : SPEED.walk;
    const target = canMove && input.forward ? base * speedMul : 0;
    const accel = target > this.speed ? 14 : 20;
    this.speed += Math.sign(target - this.speed) * Math.min(Math.abs(target - this.speed), accel * dt);
    this.moving = this.speed > 0.2;

    // Gravity + move through the character controller.
    this.vy = Math.max(this.vy - 22 * dt, -20);
    const f = this.forward;
    const desired = { x: f.x * this.speed * dt, y: this.vy * dt, z: f.z * this.speed * dt };
    this.controller.computeColliderMovement(this.collider, desired);
    const mv = this.controller.computedMovement();
    if (this.controller.computedGrounded()) this.vy = -0.5;
    const t = this.body.translation();
    this.body.setNextKinematicTranslation({ x: t.x + mv.x, y: t.y + mv.y, z: t.z + mv.z });

    // Walk bob
    this.bob += dt * (this.hurrying ? 13 : 8) * (this.moving ? 1 : 0);
    this.syncVisual(dt);
  }

  syncVisual(dt = 0) {
    const t = this.body.translation();
    this.group.position.set(t.x, t.y - CENTER, t.z);
    this.group.rotation.y = this.yaw;
    const targetScale = this.crouching ? 0.66 : 1;
    this.inner.scale.y += (targetScale - this.inner.scale.y) * Math.min(1, dt * 12 || 1);
    this.inner.position.y = this.moving ? Math.abs(Math.sin(this.bob)) * 0.05 : 0;
    this.inner.rotation.x = this.hurrying ? -0.12 : 0;
  }

  setColor(hex) { this.mats[0].color.setHex(hex); }

  setFade(alpha) {
    this.mats.forEach((m) => {
      m.transparent = alpha < 1;
      m.opacity = alpha;
      m.depthWrite = alpha >= 1;
    });
  }
}

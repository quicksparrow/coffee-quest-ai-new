import * as THREE from 'three';
import { CLIP_SPEED } from './character.js';

const HALF = 0.5;      // capsule half-height (cylinder part)
const RADIUS = 0.35;
const CENTER = HALF + RADIUS + 0.01; // capsule center above the feet

// Brisk: you're late. Normal movement is a light jog, Shift breaks into a sprint.
export const SPEED = { walk: 3.6, hurry: 6.4, crouch: 1.6 };
const TURN_MIN = 1.5;    // rad/s on a quick tap (precise aiming)
const TURN_MAX = 3.0;    // rad/s once the key is held
const TURN_RAMP = 0.3;   // seconds to reach full turn speed
const ABOUT_FACE = 0.28; // seconds for a 180° turn

/**
 * The player. Physics runs at a fixed rate; the visible model is interpolated between the
 * last two physics states every rendered frame, so movement stays smooth on any refresh rate.
 */
export class Player {
  constructor(scene, world, R, spawn, yaw) {
    this.world = world;
    this.yaw = yaw;
    this.prevYaw = yaw;
    this.speed = 0;
    this.vy = 0;
    this.crouching = false;
    this.hurrying = false;
    this.moving = false;
    this.turnAnim = null;
    this.turnHeld = 0;
    this.bob = 0;

    this.curr = new THREE.Vector3();   // feet position after the latest physics step
    this.prev = new THREE.Vector3();   // feet position one step earlier
    this.renderPos = new THREE.Vector3();
    this.renderYaw = yaw;
    this._fwd = new THREE.Vector3();
    this._desired = { x: 0, y: 0, z: 0 };
    this._next = { x: 0, y: 0, z: 0 };

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
    const mat = (color, roughness) => new THREE.MeshStandardMaterial({ color, roughness, transparent: true });
    // Always in the transparent pass so fading near walls never recompiles a shader.
    this.mats = [mat(0x2f6fb0, 0.6), mat(0xe0b894, 0.7), mat(0x1d2530, 0.6), mat(0x3a4452, 0.8)];
    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(RADIUS, HALF * 2 - 0.2, 6, 14), this.mats[0]);
    torso.position.y = 0.75;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.22, 18, 14), this.mats[1]);
    head.position.y = 1.55;
    const nose = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.08, 0.14), this.mats[2]);
    nose.position.set(0, 1.58, -0.24);
    const bag = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.36, 0.1), this.mats[3]);
    bag.position.set(0, 0.95, 0.36);
    // Drawn after the walls so the see-through fade (camera pressed against a wall) blends correctly.
    [torso, head, nose, bag].forEach((m) => { m.castShadow = true; m.renderOrder = 3; this.inner.add(m); });

    // Takeaway coffee cup (held in the left hand once the player has one).
    this.cup = new THREE.Group();
    const cupBody = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.034, 0.13, 16), new THREE.MeshStandardMaterial({ color: 0xf2efe9 }));
    const sleeve = new THREE.Mesh(new THREE.CylinderGeometry(0.047, 0.04, 0.055, 16), new THREE.MeshStandardMaterial({ color: 0x8a5a3c }));
    const lid = new THREE.Mesh(new THREE.CylinderGeometry(0.048, 0.048, 0.02, 16), new THREE.MeshStandardMaterial({ color: 0x2b2b2b }));
    lid.position.y = 0.072;
    [cupBody, sleeve, lid].forEach((m) => { m.castShadow = true; });
    this.cup.add(cupBody, sleeve, lid);
    this.cup.position.set(0.38, 0.95, -0.22);
    this.cup.visible = false;
    this.inner.add(this.cup);

    this.group.add(this.inner);
    scene.add(this.group);
    this.capture(true);
    this.interpolate(1);
    this.sipT = 0;
    this.oneShot = null;
    this.idleStyle = null;
  }

  // Swap the capsule placeholder for a real animated character.
  setCharacter(char) {
    if (this.char) this.group.remove(this.char.root);
    this.char = char;
    this.inner.visible = false;
    this.group.add(char.root);
    char.attachToLeftHand(this.cup);
    this.oneShot = null;
    char.play('idle', 0);
  }

  // Play a one-off animation (reaching for a counter, pressing a button). Walking away cancels it.
  playOnce(key) {
    if (!this.char) return;
    this.oneShot = key;
    this.char.play(key, 0.15);
  }

  sip() { this.sipT = 0.001; }

  // Tuck into a hiding spot (a phone pod, the closet, behind the plants). The capsule is switched
  // off while hidden so it can sit inside the pod; movement is locked until you step out.
  hide(spot) {
    this.hidden = spot;
    this.crouching = false;
    this.hurrying = false;
    this.collider.setEnabled(false);
    this.teleport(spot.at, spot.yaw);
    this.idleStyle = spot.pose;
    this.oneShot = null;
  }

  // Step back out, next to the spot if someone is standing right on it. False if boxed in.
  unhide() {
    const spot = this.hidden;
    if (!spot) return true;
    const base = spot.exit || spot.at;
    const shape = this.collider.shape;
    const rot = { x: 0, y: 0, z: 0, w: 1 };
    const tries = [[0, 0], [0.8, 0], [-0.8, 0], [0, 0.8], [0, -0.8]];
    const self = this.collider;
    for (const [dx, dz] of tries) {
      const at = { x: base.x + dx, y: base.y + CENTER + 0.02, z: base.z + dz };
      if (this.world.intersectionWithShape(at, rot, shape, undefined, undefined, self)) continue;
      this.hidden = null;
      this.collider.setEnabled(true);
      this.teleport(new THREE.Vector3(base.x + dx, base.y, base.z + dz), spot.exitYaw ?? this.yaw);
      this.idleStyle = null;
      return true;
    }
    return false;
  }

  // Per rendered frame: pick the animation for what the player is doing and advance it.
  animate(dt) {
    const c = this.char;
    if (!c) return;
    if (this.oneShot) {
      const a = c.actions[this.oneShot];
      if (this.moving || !a.isRunning()) this.oneShot = null;
    }
    if (!this.oneShot) {
      let key = this.idleStyle || 'idle';
      if (this.crouching) key = this.moving ? 'crouchWalk' : 'crouch';
      else if (this.moving) key = this.hurrying || this.speed > SPEED.walk * 1.15 ? 'hurry' : this.speed > 2.2 ? 'jog' : 'walk';
      c.play(key, 0.25);
      const clipSpeed = CLIP_SPEED[key];
      c.current.timeScale = clipSpeed ? THREE.MathUtils.clamp(this.speed / clipSpeed, 0.5, 2.2) : 1;
    }
    c.update(dt);
    if (this.sipT > 0) {
      this.sipT += dt;
      if (!c.applySip(this.sipT, this.cup)) this.sipT = 0;
    }
  }

  // Latest physics position (feet). Shared vector: read it, don't modify it.
  get position() { return this.curr; }

  get forward() { return this._fwd.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw)); }

  get floor() { return this.curr.y > 2.5 ? 1 : 0; }

  // Record the body's position after a physics step. `reset` skips interpolation (teleports).
  capture(reset = false) {
    const t = this.body.translation();
    if (reset) {
      this.curr.set(t.x, t.y - CENTER, t.z);
      this.prev.copy(this.curr);
      this.prevYaw = this.yaw;
    } else {
      this.prev.copy(this.curr);
      this.curr.set(t.x, t.y - CENTER, t.z);
    }
  }

  teleport(p, yaw = this.yaw) {
    this.body.setTranslation({ x: p.x, y: p.y + CENTER, z: p.z }, true);
    this.body.setNextKinematicTranslation({ x: p.x, y: p.y + CENTER, z: p.z });
    this.yaw = yaw;
    this.turnAnim = null;
    this.speed = 0;
    this.vy = 0;
    this.capture(true);
    this.interpolate(1);
  }

  // One fixed physics step.
  update(dt, input, { canMove = true, speedMul = 1, rideY = null } = {}) {
    this.prevYaw = this.yaw;

    // Turning: a quick tap turns a little, holding speeds up.
    if (canMove && input.aboutFace && !this.turnAnim) {
      this.turnAnim = { from: this.yaw, to: this.yaw + Math.PI, t: 0 };
    }
    if (this.turnAnim) {
      this.turnAnim.t += dt / ABOUT_FACE;
      const k = Math.min(1, this.turnAnim.t);
      const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
      this.yaw = this.turnAnim.from + (this.turnAnim.to - this.turnAnim.from) * e;
      if (k >= 1) this.turnAnim = null;
    } else if (canMove && (input.left || input.right) && !(input.left && input.right)) {
      this.turnHeld += dt;
      const rate = TURN_MIN + (TURN_MAX - TURN_MIN) * Math.min(1, this.turnHeld / TURN_RAMP);
      this.yaw += (input.left ? 1 : -1) * rate * dt;
    } else {
      this.turnHeld = 0;
    }

    if (canMove && input.crouch) this.crouching = !this.crouching;
    this.hurrying = canMove && input.hurry && input.forward && !this.crouching;

    const base = this.crouching ? SPEED.crouch : this.hurrying ? SPEED.hurry : SPEED.walk;
    const target = canMove && input.forward ? base * speedMul : 0;
    const accel = target > this.speed ? 14 : 20;
    this.speed += Math.sign(target - this.speed) * Math.min(Math.abs(target - this.speed), accel * dt);
    this.moving = this.speed > 0.2;

    // Gravity + move through the character controller. When riding a moving elevator the
    // controller only handles walking around inside the car; height is locked to the car floor.
    const riding = rideY != null;
    this.vy = riding ? 0 : Math.max(this.vy - 22 * dt, -20);
    const f = this.forward;
    const d = this._desired;
    d.x = f.x * this.speed * dt; d.y = riding ? 0 : this.vy * dt; d.z = f.z * this.speed * dt;
    this.controller.computeColliderMovement(this.collider, d);
    const mv = this.controller.computedMovement();
    if (!riding && this.controller.computedGrounded()) this.vy = -0.5;
    const t = this.body.translation();
    const n = this._next;
    n.x = t.x + mv.x; n.y = riding ? rideY + CENTER : t.y + mv.y; n.z = t.z + mv.z;
    this.body.setNextKinematicTranslation(n);

    // Placeholder pose (only used if the character models fail to load).
    if (!this.char) {
      this.bob += dt * (this.hurrying ? 13 : 8) * (this.moving ? 1 : 0);
      const targetScale = this.crouching ? 0.66 : 1;
      this.inner.scale.y += (targetScale - this.inner.scale.y) * Math.min(1, dt * 12);
      this.inner.position.y = this.moving ? Math.abs(Math.sin(this.bob)) * 0.05 : 0;
    }
  }

  // Place the visible model between the last two physics states (alpha 0..1).
  interpolate(alpha) {
    this.renderPos.lerpVectors(this.prev, this.curr, alpha);
    this.renderYaw = this.prevYaw + (this.yaw - this.prevYaw) * alpha;
    this.group.position.copy(this.renderPos);
    this.group.rotation.y = this.renderYaw;
  }

  setColor(hex) { this.mats[0].color.setHex(hex); }

  setFade(alpha) {
    if (this.fade === alpha) return;
    this.fade = alpha;
    this.mats.forEach((m) => { m.opacity = alpha; m.depthWrite = alpha >= 1; });
    this.char?.setFade(alpha);
  }
}

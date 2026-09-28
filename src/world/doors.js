import * as THREE from 'three';

const RED = new THREE.Color(0xe05050);
const GREEN = new THREE.Color(0x4cc38a);

/**
 * A sliding door or turnstile flap. `axis` is the direction the doorway spans:
 *  'x' → doorway from x=a to x=b at z=fixed;  'z' → from z=a to z=b at x=fixed.
 * `shouldOpen(player)` decides every frame whether it wants to be open.
 */
export class Door {
  constructor(builder, { axis, a, b, fixed, y0, h = 2.4, thick = 0.12, color = 0x7e8a99, opacity = 1, light = true, lightY = null, shouldOpen, speed = 3 }) {
    this.axis = axis; this.a = a; this.b = b; this.fixed = fixed; this.y0 = y0; this.h = h;
    this.shouldOpen = shouldOpen;
    this.speed = speed;
    this.open = 0;
    this.width = b - a;
    const R = builder.R;
    const mid = (a + b) / 2;
    const sx = axis === 'x' ? this.width : thick;
    const sz = axis === 'x' ? thick : this.width;
    const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.5, metalness: 0.1, transparent: opacity < 1, opacity });
    this.panel = new THREE.Mesh(builder.geo, mat);
    this.panel.scale.set(sx, h, sz);
    this.base = axis === 'x' ? new THREE.Vector3(mid, y0 + h / 2, fixed) : new THREE.Vector3(fixed, y0 + h / 2, mid);
    this.panel.position.copy(this.base);
    this.panel.castShadow = true;
    builder.scene.add(this.panel);

    this.collider = builder.world.createCollider(
      R.ColliderDesc.cuboid(sx / 2, h / 2, sz / 2).setTranslation(this.base.x, this.base.y, this.base.z),
    );

    if (light) {
      this.lightMat = new THREE.MeshBasicMaterial({ color: RED });
      const l = new THREE.Mesh(builder.geo, this.lightMat);
      l.scale.set(axis === 'x' ? 0.3 : 0.24, 0.1, axis === 'x' ? 0.24 : 0.3);
      l.position.set(this.base.x, lightY ?? y0 + Math.max(h, 2.5) + 0.12, this.base.z);
      builder.scene.add(l);
    }
  }

  // Is the player standing inside the doorway (so we never close on them)?
  inDoorway(p) {
    const along = this.axis === 'x' ? p.x : p.z;
    const across = this.axis === 'x' ? p.z : p.x;
    return along > this.a - 0.4 && along < this.b + 0.4 && Math.abs(across - this.fixed) < 0.55 && Math.abs(p.y - (this.y0 + 0.85)) < 1.5;
  }

  update(dt, playerPos) {
    // Only the "don't close on the player" rule may hold a door open; it can never unlock one.
    const want = this.shouldOpen(playerPos) || (this.open > 0.05 && this.inDoorway(playerPos));
    const target = want ? 1 : 0;
    this.open += Math.sign(target - this.open) * Math.min(Math.abs(target - this.open), dt * this.speed);
    const slide = this.open * this.width * 0.92;
    this.panel.position.copy(this.base);
    if (this.axis === 'x') this.panel.position.x += slide; else this.panel.position.z += slide;
    // Collider off as soon as the door starts opening; back on only once fully shut.
    this.collider.setEnabled(this.open < 0.05 && !want);
    if (this.lightMat) this.lightMat.color.copy(this.open > 0.5 ? GREEN : RED);
    this.justOpened = want && !this.wasWanted;
    this.wasWanted = want;
  }
}

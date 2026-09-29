import * as THREE from 'three';
import { beacon } from '../ui/sprites.js';

/*
  X-ray beacons: while X is held, every place where you can do something on your floor shows an
  icon and a label through the walls: coffee, the visitor pass, the ways upstairs, hiding spots
  and the meeting room.
*/
const BLUE = '#76a2e6';
const GREEN = '#58be8c';

export class Beacons {
  constructor(scene, level, state) {
    const P = level.points;
    const F2 = P.meeting.y;
    const v = (x, y, z) => new THREE.Vector3(x, y, z);
    const defs = [
      { icon: 'coffee', title: 'Coffee', sub: 'Lobby café · latte', p: P.cafe },
      { icon: 'coffee', title: 'Coffee', sub: 'Kitchen · espresso', p: P.espresso },
      { icon: 'badge', title: 'Visitor pass', sub: 'Reception', p: P.reception, color: BLUE, show: () => !state.hasBadge },
      { icon: 'badge', title: 'Turnstiles', sub: 'Pass needed, or tailgate', p: P.turnstiles, color: BLUE, show: () => !state.hasBadge },
      { icon: 'door', title: 'Propped door', sub: 'Mailroom · to the stairs', p: v(26, 0, 21.35), color: BLUE },
      { icon: 'stairs', title: 'Stairs', sub: 'No badge needed', p: P.stairsFront, color: BLUE },
      { icon: 'lift', title: 'Elevator', sub: 'Behind the turnstiles', p: P.callG, color: BLUE },
      { icon: 'lift', title: 'Elevator', sub: 'Down to the lobby', p: P.callF2, color: BLUE },
      { icon: 'door', title: 'Stair door', sub: 'Down to the lobby', p: v(21.5, F2, 10), color: BLUE },
      { icon: 'goal', title: 'Meeting 2B', sub: '09:00 call', p: P.meeting, color: GREEN },
      { icon: 'door', title: 'Back door', sub: 'Meeting 2B · quiet way in', p: P.backDoor, color: GREEN },
      ...level.hideSpots.map((h) => ({ icon: 'hide', title: 'Hide', sub: h.name, p: h.at, color: '#c9b3ff' })),
    ];
    this.items = defs.map((d) => {
      const s = beacon(d.icon, d.title, d.sub, d.color);
      s.position.set(d.p.x, d.p.y + 2.3, d.p.z);
      s.visible = false;
      scene.add(s);
      return { ...d, s, floor: d.p.y > 2 ? 1 : 0 };
    });
    this.on = false;
  }

  setXray(on) { this.on = on; }

  // Per rendered frame: fade in the ones on your floor while X is held.
  update(dt, floor) {
    for (const it of this.items) {
      const want = this.on && it.floor === floor && (!it.show || it.show()) ? 1 : 0;
      const m = it.s.material;
      m.opacity += (want - m.opacity) * Math.min(1, dt * 10);
      it.s.visible = m.opacity > 0.02;
    }
  }

  warmup(on) { for (const it of this.items) it.s.visible = on; }
}

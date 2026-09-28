import * as THREE from 'three';
import { PALETTE as C } from './builder.js';
import { Door } from './doors.js';

/*
  Level 1 — "Badge? What Badge?"  Footprint 32 m (x) × 24 m (z). North is -z.
  Ground floor top at y=0, Floor 2 top at y=4 (slab 3.7–4.0).

  GROUND                                    FLOOR 2
  z0 ┌────────┬──────┬──────┬──────┐        ┌────────┬──────┬──────┬──────┬──────┐
     │ secure │ elev │      │stairs│service │directors│ elev │ WC   │stairs│closet│
  z9 │  zone  │ lobby│      ├─door─┤corridor├────────┴lobby─┴──────┴─door─┼─door─┤
  z11├═══════turnstiles═════════════┤       │        open office          │kitchen│
     │ reception          lobby     ├─────  │  pods  pods  pods            │  back │
     │                   café       │mail   │                        ├─badge┴─door─┤
  z24└───────────entrance───────────┴room   │ phone pods  printer    │ Meeting 2B  │
*/

export const F2 = 4;

export function buildLevel(b, state) {
  const R = b.R;
  const doors = [];

  // ---------- Slabs ----------
  b.box(-0.5, -0.3, -0.5, 32.5, 0, 24.5, { color: C.lobby, cast: false });
  // Floor 2 slab, leaving the stair opening (x20–23, z1–8) open.
  const slab = { color: 0xe9ecef, cast: false };
  b.box(0, 3.7, 0, 20, 4, 24, slab);
  b.box(20, 3.7, 0, 23, 4, 1, slab);
  b.box(20, 3.7, 8, 23, 4, 24, slab);
  b.box(23, 3.7, 0, 32, 4, 24, slab);

  // ---------- Floor zones + labels (ground) ----------
  b.zone(0, 0, 20, 11, 0, C.secure);
  b.zone(20, 9, 26, 11, 0, C.secure);
  b.zone(20, 0, 26, 9, 0, C.stair);
  b.zone(10, 0, 14, 4, 0, C.elevator);
  b.zone(17, 17.2, 25, 24, 0, C.cafe);
  b.zone(26, 14, 32, 24, 0, C.mail);
  b.zone(26, 0, 32, 14, 0, C.service);
  b.label('Lobby', 12, 0, 18.4, { size: 1.1 });
  b.label('Reception', 3.5, 0, 17.4, { size: 0.62, sub: 'visitor passes' });
  b.label('Lobby café', 21, 0, 17.9, { size: 0.62 });
  b.label('Turnstiles', 12, 0, 12.6, { size: 0.6, sub: 'badge only' });
  b.label('Elevators', 12, 0, 6.6, { size: 0.62 });
  b.label('Stairs', 24.6, 0, 6.2, { size: 0.45, rot: Math.PI / 2 });
  b.label('Mailroom', 29, 0, 18.6, { size: 0.6, sub: 'staff only' });
  b.label('Service corridor', 29, 0, 7.5, { size: 0.62, rot: Math.PI / 2 });
  b.label('Entrance', 15, 0, 23.1, { size: 0.45 });

  // ---------- Floor zones + labels (floor 2) ----------
  b.zone(0, 9, 26, 24, F2, C.office);
  b.zone(26, 9, 32, 16.5, F2, C.kitchen);
  b.zone(24, 16.5, 32, 24, F2, C.meeting);
  b.zone(26, 0, 32, 9, F2, C.closet);
  b.zone(20, 0, 26, 9, F2, C.stair);
  b.zone(10, 0, 14, 9, F2, C.elevator);
  b.zone(0, 20, 6, 24, F2, C.pods);
  b.label('Open office', 10.5, F2, 14.55, { size: 0.9 });
  b.label('Kitchen', 29, F2, 15.3, { size: 0.55 });
  b.label('Meeting 2B', 28.3, F2, 23, { size: 0.65, sub: '09:00 call' });
  b.label('Supply closet', 29, F2, 5, { size: 0.55 });
  b.label('Stairs', 24.6, F2, 5, { size: 0.45, rot: Math.PI / 2 });
  b.label('Elevators', 12, F2, 6.6, { size: 0.62 });
  b.label('Phone pods', 3, F2, 19.4, { size: 0.5 });
  b.label('Printer', 9.7, F2, 21.9, { size: 0.42 });

  // ---------- Exterior walls (both floors, one piece) ----------
  b.hwall(0, 0, 32, 0, 7);
  b.hwall(24, 0, 32, 0, 7, [[13, 17]]);
  b.vwall(0, 0, 24, 0, 7);
  b.vwall(32, 0, 24, 0, 7);

  // ---------- Stairwell (full height) ----------
  b.vwall(20, 0, 9, 0, 7);
  b.vwall(26, 0, 9, 0, 7, [[3, 4.6]]);          // ground: east door to service corridor
  b.hwall(9, 20, 26, 0, 3.7, [[20.4, 23]]);      // ground: front door, no badge needed
  // Ramp collider: bottom (z=8, y=0) up to top (z=1, y=4).
  const run = 7, rise = 4, len = Math.hypot(run, rise), th = Math.atan2(rise, run);
  const normal = new THREE.Vector3(0, Math.cos(th), Math.sin(th));
  const mid = new THREE.Vector3(21.5, rise / 2, 4.5).addScaledVector(normal, -0.1);
  b.world.createCollider(
    R.ColliderDesc.cuboid(1.5, 0.1, len / 2)
      .setTranslation(mid.x, mid.y, mid.z)
      .setRotation({ x: Math.sin(th / 2), y: 0, z: 0, w: Math.cos(th / 2) }),
  );
  const steps = 14;
  for (let i = 0; i < steps; i++) {
    const zs = 8 - i * (run / steps), zb = zs - run / steps;
    b.box(20.05, 0, zb, 22.95, (i + 0.6) * (rise / steps), zs, { color: C.stairs, collide: false });
  }
  // Railings on floor 2 around the opening.
  b.box(22.9, F2, 1, 23.1, F2 + 1.05, 8, { color: C.rail });
  b.box(20, F2, 7.9, 23, F2 + 1.05, 8.1, { color: C.rail });

  // ---------- Ground floor interior ----------
  const G = 3.7;
  b.vwall(26, 9, 24, 0, G, [[20.5, 22.2]]);     // lobby | service + mailroom (propped door)
  b.hwall(14, 26, 32, 0, G, [[28, 30]]);         // mailroom → service corridor
  // Elevator shaft
  b.vwall(10, 0, 4, 0, G);
  b.vwall(14, 0, 4, 0, G);
  b.hwall(4, 10, 14, 0, G, [[11, 13]]);
  // Turnstile line: glass barriers + pillars + 4 gates
  const glass = { color: C.glass, opacity: 0.45, xray: false, cast: false };
  b.box(0, 0, 10.95, 8, 1.2, 11.05, glass);
  b.box(16, 0, 10.95, 26, 1.2, 11.05, glass);
  [8, 10, 12, 14, 16].forEach((x) => b.box(x - 0.15, 0, 10.8, x + 0.15, 1.15, 11.2, { color: C.rail }));
  [8, 10, 12, 14].forEach((x) => {
    const cx = x + 1;
    doors.push(new Door(b, {
      axis: 'x', a: x + 0.15, b: x + 1.85, fixed: 11, y0: 0, h: 1.0, thick: 0.06,
      color: C.glass, opacity: 0.6, lightY: 1.2, speed: 5,
      shouldOpen: (p) => p.y < 2 && Math.hypot(p.x - cx, p.z - 11) < 1.5 && (p.z < 11 || state.hasBadge),
    }));
  });
  // Reception
  b.box(1, 0, 14.4, 6, 1.1, 15.2, { color: C.counter });
  b.figure(3.5, 0, 13.7, 0x5b7fa6, Math.PI);
  // Café
  b.box(18, 0, 19.6, 24, 1.1, 20.4, { color: C.counter });
  b.box(22.4, 1.1, 19.75, 23.5, 1.65, 20.25, { color: 0x3b3f45 });
  b.figure(21, 0, 21.4, 0x6e4b3a, 0);
  // Lobby furniture
  b.box(7.6, 0, 20.4, 8.4, 1.5, 21.2, { color: 0x6f9e6a });
  b.box(8.8, 0, 21.8, 9.6, 1.3, 22.6, { color: 0x6f9e6a });
  b.box(2.6, 0, 21.6, 5.8, 0.5, 22.4, { color: C.desk });
  b.box(3.2, 0, 3.2, 4, 1.4, 4, { color: 0x6f9e6a });
  // Mailroom + service corridor
  b.box(31, 0, 15, 31.8, 2.2, 23.2, { color: C.desk });
  b.box(26.3, 0, 22.3, 27.1, 0.9, 23.3, { color: C.rail });                 // cart propping the door
  b.box(26.1, 0, 22.2, 27.7, 2.3, 22.3, { color: 0x8a95a3, collide: false }); // the propped door
  b.box(30.4, 0, 1, 31.8, 1.6, 6, { color: C.desk });
  b.box(27, 0, 11.6, 28.4, 1, 12.8, { color: C.rail });

  // ---------- Floor 2 interior ----------
  const H = 3;
  b.vwall(10, 0, 4, F2, H);
  b.vwall(14, 0, 4, F2, H);
  b.hwall(4, 10, 14, F2, H, [[11, 13]]);
  b.hwall(9, 0, 10, F2, H);                       // directors' offices (closed)
  b.vwall(10, 4, 9, F2, H);
  b.vwall(14, 4, 9, F2, H);                       // restrooms (closed)
  b.hwall(9, 14, 20, F2, H);
  b.hwall(9, 20, 26, F2, H, [[23.6, 25.4]]);      // stair exit (badge)
  b.hwall(9, 26, 32, F2, H, [[28.5, 30]]);        // supply closet
  b.vwall(26, 9, 16.5, F2, H, [[11.5, 13.5]]);    // kitchen entrance
  b.hwall(16.5, 24, 32, F2, H, [[28, 29.6]]);     // kitchen back door into 2B
  b.vwall(24, 16.5, 24, F2, H, [[20, 22]]);       // Meeting 2B badge door
  // Cubicle pods
  [1.5, 7.5, 13.5].forEach((x) => [11, 15.5].forEach((z) => {
    b.box(x, F2, z, x + 4.3, F2 + 1.25, z + 2.6, { color: C.partition });
    b.box(x + 0.2, F2 + 1.25, z + 0.2, x + 4.1, F2 + 1.28, z + 2.4, { color: C.desk, collide: false });
  }));
  // Kitchen
  b.box(31.2, F2, 9.6, 32, F2 + 0.95, 16.2, { color: C.counter });
  b.box(31.25, F2 + 0.95, 12.2, 31.9, F2 + 1.55, 13.2, { color: 0x3b3f45 });   // espresso machine
  b.box(27.8, F2, 10.4, 29.2, F2 + 0.95, 12.8, { color: C.counter });          // island
  b.box(26.3, F2, 14.8, 27.3, F2 + 2, 16.2, { color: 0xe9edf1 });              // fridge
  // Meeting 2B
  b.box(26, F2, 19, 30.5, F2 + 0.75, 21.6, { color: C.counter });
  b.box(31.8, F2 + 1, 18.5, 31.95, F2 + 2.2, 22, { color: 0x2b2f35, collide: false });
  // Phone pods, printer, closet shelves
  b.box(0.3, F2, 21, 2.4, F2 + 2.3, 23.6, { color: C.glass, opacity: 0.5, xray: false });
  b.box(2.8, F2, 21, 4.9, F2 + 2.3, 23.6, { color: C.glass, opacity: 0.5, xray: false });
  b.box(9, F2, 22.8, 10.4, F2 + 1.1, 23.8, { color: 0xd8dce2 });
  b.box(26.4, F2, 0.4, 31.6, F2 + 2, 1.2, { color: C.desk });

  // ---------- Doors ----------
  const onF2 = (p) => p.y > 2;
  const elevatorDoors = [0, F2].map((y0, floor) => {
    const d = new Door(b, {
      axis: 'x', a: 11, b: 13, fixed: 4, y0, h: 2.4, color: 0x9aa4b0, speed: 2,
      shouldOpen: () => state.elevator.cabFloor === floor && state.elevator.doorsOpen,
    });
    doors.push(d);
    return d;
  });
  const stairDoor = new Door(b, {
    axis: 'x', a: 23.6, b: 25.4, fixed: 9, y0: F2, h: 2.4, color: 0x8a6f6f,
    shouldOpen: (p) => onF2(p) && ((p.z > 9 && Math.hypot(p.x - 24.5, p.z - 9) < 1.7) || state.smokerOpen),
  });
  doors.push(stairDoor);
  const meetingDoor = new Door(b, {
    axis: 'z', a: 20, b: 22, fixed: 24, y0: F2, h: 2.4, color: 0x8a6f6f,
    shouldOpen: (p) => onF2(p) && p.x > 24 && Math.hypot(p.x - 24, p.z - 21) < 1.7,
  });
  doors.push(meetingDoor);

  return {
    doors,
    stairDoor,
    spawn: new THREE.Vector3(15, 0, 22.2),
    spawnYaw: 0,
    points: {
      reception: new THREE.Vector3(3.5, 0, 16.1),
      cafe: new THREE.Vector3(21, 0, 18.9),
      espresso: new THREE.Vector3(30.4, F2, 12.7),
      callG: new THREE.Vector3(12, 0, 5.2),
      callF2: new THREE.Vector3(12, F2, 5.2),
      turnstiles: new THREE.Vector3(12, 0, 11),
      elevatorLobby: new THREE.Vector3(12, 0, 5.5),
      eastDoor: new THREE.Vector3(26.6, 0, 3.8),
      rampTop: new THREE.Vector3(21.5, F2, 0.5),
      stairExit: new THREE.Vector3(24.5, F2, 9.6),
      kitchenDoor: new THREE.Vector3(26, F2, 12.5),
      meeting: new THREE.Vector3(28, F2, 20.3),
    },
    zones: {
      inCab: (p) => p.x > 10.2 && p.x < 13.8 && p.z > 0.2 && p.z < 3.9,
      secure: (p) => !onF2(p) && p.z < 11 && p.x < 20,
      stairwell: (p) => p.x > 20 && p.x < 26 && p.z < 9,
      service: (p) => !onF2(p) && p.x > 26,
      kitchen: (p) => onF2(p) && p.x > 26 && p.z > 9 && p.z < 16.5,
      meeting: (p) => onF2(p) && p.x > 24.3 && p.z > 16.8,
      turnstileFront: (p) => !onF2(p) && p.z > 11 && p.z < 13.4 && p.x > 7 && p.x < 17,
      stairDoorInside: (p) => onF2(p) && p.x > 23.1 && p.x < 26 && p.z > 6.8 && p.z < 9,
      meetingDoorOutside: (p) => onF2(p) && p.x < 24 && p.x > 21.8 && p.z > 19 && p.z < 23,
    },
  };
}

import * as THREE from 'three';
import { PALETTE as C } from './builder.js';
import { Door } from './doors.js';
import { Elevator } from './elevator.js';

/*
  Level 1 — "Badge? What Badge?"  Footprint 32 m (x) × 24 m (z). North is -z.
  Ground floor top at y=0, Floor 2 top at y=4 (slab 3.7–4.0).

  GROUND                                      FLOOR 2
  z0 ┌──────┬────┬─────┬──────┬───────┐      ┌───────┬────┬─────┬──────┬───────┐
     │      │car │     │stairs│service│      │direct.│car │ WC  │stairs│closet │
  z9 │secure├lby─┤     ├─door─┤corridor      ├───────┴lby─┴─────┴door──┼─door──┤
  z11├══════turnstiles══════════┤       │      │   pods  pods  pods  pods │kitchen│
     │ reception       lobby    ├────── │      ├────────┐   pods  pods   ├───────┤
     │                 café     │mail   │      │Meeting │   pods  pods   lounge  │
  z24└──────────entrance────────┴room   │      │  2B  door  printer  phone pods   │
*/

export const F2 = 4;

export function buildLevel(b, state) {
  const R = b.R;
  const doors = [];
  const onF2 = (p) => p.y > 2;

  // ---------- Slabs ----------
  b.box(-0.5, -0.3, -0.5, 32.5, 0, 24.5, { color: C.lobby, cast: false });
  // Floor 2 slab, leaving the elevator shaft (x10–14, z0–4) and the stair opening (x20–23, z0–8) open.
  const slab = { color: 0xe9ecef, cast: false };
  b.box(0, 3.7, 0, 10, 4, 24, slab);
  b.box(10, 3.7, 4, 14, 4, 24, slab);
  b.box(14, 3.7, 0, 20, 4, 24, slab);
  b.box(20, 3.7, 8, 23, 4, 24, slab);
  b.box(23, 3.7, 0, 32, 4, 24, slab);

  // ---------- Floor zones + labels (ground). Zones never overlap, so nothing flickers. ----------
  b.zone(0, 0, 10, 11, 0, C.secure);
  b.zone(10, 4, 14, 11, 0, C.secure);
  b.zone(14, 0, 20, 11, 0, C.secure);
  b.zone(20, 9, 26, 11, 0, C.secure);
  b.zone(20, 0, 26, 9, 0, C.stair);
  b.zone(17, 17.2, 25, 24, 0, C.cafe);
  b.zone(26, 14, 32, 24, 0, C.mail);
  b.zone(26, 0, 32, 14, 0, C.service);
  b.label('Lobby', 12, 0, 18.4, { size: 1.1 });
  b.label('Reception', 3.5, 0, 17.4, { size: 0.62, sub: 'visitor passes' });
  b.label('Lobby café', 21, 0, 17.9, { size: 0.62 });
  b.label('Turnstiles', 12, 0, 12.6, { size: 0.6, sub: 'badge only' });
  b.label('Elevator', 12, 0, 6.6, { size: 0.62 });
  b.label('Stairs', 24.6, 0, 5, { size: 0.45, rot: Math.PI / 2 });
  b.label('Mailroom', 29, 0, 18.6, { size: 0.6, sub: 'staff only' });
  b.label('Service corridor', 29, 0, 7.5, { size: 0.62, rot: Math.PI / 2 });
  b.label('Entrance', 15, 0, 23.1, { size: 0.45 });

  // ---------- Floor zones + labels (floor 2) ----------
  b.zone(0, 9, 26, 16.5, F2, C.office);
  b.zone(9, 16.5, 26, 24, F2, C.office);
  b.zone(26, 16.5, 32, 24, F2, C.kitchen);
  b.zone(0, 16.5, 9, 24, F2, C.meeting);
  b.zone(26, 9, 32, 16.5, F2, C.kitchen);
  b.zone(26, 0, 32, 9, F2, C.closet);
  b.zone(20, 8, 26, 9, F2, C.stair);
  b.zone(23, 0, 26, 8, F2, C.stair);
  b.zone(10, 4, 14, 9, F2, C.elevator);
  b.label('Open office', 5.5, F2, 14.8, { size: 0.85 });
  b.label('Kitchen', 29, F2, 15.3, { size: 0.55 });
  b.label('Lounge', 29, F2, 20.5, { size: 0.55 });
  b.label('Meeting 2B', 4.5, F2, 23.1, { size: 0.65, sub: '09:00 call' });
  b.label('Supply closet', 29, F2, 5, { size: 0.55 });
  b.label('Elevator', 12, F2, 6.6, { size: 0.62 });
  b.label('Printer', 10.8, F2, 22.3, { size: 0.42 });

  // ---------- Exterior walls (both floors, one piece) ----------
  b.hwall(0, 0, 32, 0, 7);
  b.hwall(24, 0, 32, 0, 7, [[13, 17]]);
  b.vwall(0, 0, 24, 0, 7);
  b.vwall(32, 0, 24, 0, 7);

  // ---------- Elevator shaft (full height) + car ----------
  b.vwall(10, 0, 4, 0, 7);
  b.vwall(14, 0, 4, 0, 7);
  b.hwall(4, 10, 14, 0, 3.7, [[11, 13]]);
  b.hwall(4, 10, 14, F2, 3, [[11, 13]]);
  const elevator = new Elevator(b, R, { floors: [0, F2] });
  const landingDoors = [0, F2].map((y0, floor) => {
    const d = new Door(b, {
      axis: 'x', a: 11, b: 13, fixed: 4.12, y0, h: 2.45, color: 0x9aa4b0, speed: 1.8,
      shouldOpen: () => elevator.floor === floor && elevator.doorsOpen && elevator.phase === 'idle',
    });
    doors.push(d);
    return d;
  });

  // ---------- Stairwell (full height) ----------
  // One straight flight: bottom at the north end (z=2.2, ground) rising south to the Floor 2
  // landing (z=8–9), which ends right at the stair exit door. The open area at the foot of the
  // stairs is the full 6 m width of the stairwell and 2.2 m deep.
  b.vwall(20, 0, 9, 0, 7);
  b.vwall(26, 0, 9, 0, 7, [[3, 4.6]]);          // ground: east door from the service corridor
  b.hwall(9, 20, 26, 0, 3.7, [[23.4, 25.6]]);    // ground: front door from the lobby (no badge)
  b.vwall(23, 2.8, 9, 0, 3.7);                   // ground: side wall between walkway and stairs
  const z0 = 2.2, run = 8 - z0, rise = 4, len = Math.hypot(run, rise), th = Math.atan2(rise, run);
  const normal = new THREE.Vector3(0, Math.cos(th), -Math.sin(th));
  const mid = new THREE.Vector3(21.5, rise / 2, z0 + run / 2).addScaledVector(normal, -0.1);
  b.world.createCollider(
    R.ColliderDesc.cuboid(1.5, 0.1, len / 2 + 0.05)
      .setTranslation(mid.x, mid.y, mid.z)
      .setRotation({ x: Math.sin(-th / 2), y: 0, z: 0, w: Math.cos(-th / 2) }),
  );
  const steps = 13;
  for (let i = 0; i < steps; i++) {
    const zs = z0 + i * (run / steps);
    b.box(20.05, 0, zs, 22.95, (i + 0.7) * (rise / steps), zs + run / steps, { color: C.stairs, collide: false });
  }
  b.box(22.9, F2, 0, 23.1, F2 + 1.05, 8, { color: C.rail });   // railing along the stair opening

  // ---------- Ground floor interior ----------
  const G = 3.7;
  b.vwall(26, 9, 24, 0, G, [[20.5, 22.2]]);     // lobby | service + mailroom (propped door)
  b.hwall(14, 26, 32, 0, G, [[28, 30]]);         // mailroom → service corridor
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
  // Café
  b.box(18, 0, 19.6, 24, 1.1, 20.4, { color: C.counter });
  b.box(22.4, 1.1, 19.75, 23.5, 1.65, 20.25, { color: 0x3b3f45 });
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
  b.hwall(9, 0, 10, F2, H);                       // directors' offices (closed)
  b.vwall(10, 4, 9, F2, H);
  b.vwall(14, 4, 9, F2, H);                       // restrooms (closed)
  b.hwall(9, 14, 20, F2, H);
  b.hwall(9, 20, 26, F2, H, [[20.6, 22.4]]);      // stair exit (badge), straight ahead off the stairs
  b.hwall(9, 26, 32, F2, H, [[28.5, 30]]);        // supply closet
  b.vwall(26, 9, 16.5, F2, H, [[11.5, 13.5]]);    // kitchen entrance
  b.hwall(16.5, 26, 32, F2, H);                   // kitchen | lounge
  // Meeting 2B: far corner of the floor, so you have to cross the whole open office.
  b.hwall(16.5, 0, 9, F2, H);
  b.vwall(9, 16.5, 24, F2, H, [[20, 22]]);
  // Cubicle pods: rows between the arrivals (north) and Meeting 2B (south-west).
  const pods = [[1.5, 11], [7, 11], [12.5, 11], [18, 11], [12.5, 15], [18, 15], [12.5, 19.5], [18, 19.5]];
  pods.forEach(([x, z]) => {
    b.box(x, F2, z, x + 4.3, F2 + 1.25, z + 2.2, { color: C.partition });
    b.box(x + 0.2, F2 + 1.25, z + 0.2, x + 4.1, F2 + 1.28, z + 2.0, { color: C.desk, collide: false });
  });
  // Kitchen
  b.box(31.2, F2, 9.6, 32, F2 + 0.95, 16.2, { color: C.counter });
  b.box(31.25, F2 + 0.95, 12.2, 31.9, F2 + 1.55, 13.2, { color: 0x3b3f45 });   // espresso machine
  b.box(27.8, F2, 10.4, 29.2, F2 + 0.95, 12.8, { color: C.counter });          // island
  b.box(26.3, F2, 14.8, 27.3, F2 + 2, 16.2, { color: 0xe9edf1 });              // fridge
  // Meeting 2B furniture
  b.box(2, F2, 18.6, 6.5, F2 + 0.75, 21.6, { color: C.counter });
  b.box(0.1, F2 + 1, 18.5, 0.25, F2 + 2.2, 22, { color: 0x2b2f35, collide: false });
  // Chairs round the table (Sam sits on the south side, facing the door and the screen).
  const chair = (x, z, back) => {
    b.box(x - 0.25, F2, z - 0.25, x + 0.25, F2 + 0.46, z + 0.25, { color: 0x3d4450 });
    const [bx1, bz1, bx2, bz2] = back === 'n' ? [x - 0.25, z - 0.3, x + 0.25, z - 0.22] : [x - 0.25, z + 0.22, x + 0.25, z + 0.3];
    b.box(bx1, F2 + 0.46, bz1, bx2, F2 + 1.0, bz2, { color: 0x3d4450, collide: false });
  };
  chair(4.6, 17.95, 'n');
  chair(3.0, 17.95, 'n');
  chair(3.0, 22.25, 's');
  chair(4.6, 22.25, 's');
  // Lounge, phone pods, printer, closet shelves
  b.box(28.5, F2, 21.8, 31.6, F2 + 0.7, 23.2, { color: 0x6f7f95 });
  b.box(23.4, F2, 17.5, 25.4, F2 + 2.3, 19.7, { color: C.glass, opacity: 0.5, xray: false });
  b.box(23.4, F2, 20.6, 25.4, F2 + 2.3, 22.8, { color: C.glass, opacity: 0.5, xray: false });
  b.box(10.1, F2, 23, 11.5, F2 + 1.1, 23.8, { color: 0xd8dce2 });
  b.box(26.4, F2, 0.4, 31.6, F2 + 2, 1.2, { color: C.desk });

  // ---------- Doors ----------
  // Stair exit: badge only from the stairwell side. Someone steps out every 25 s.
  const stairDoor = new Door(b, {
    axis: 'x', a: 20.6, b: 22.4, fixed: 9, y0: F2, h: 2.4, color: 0x8a6f6f,
    shouldOpen: (p) => onF2(p) && ((p.z > 9 && Math.hypot(p.x - 21.5, p.z - 9) < 1.7) || state.smokerOpen),
  });
  doors.push(stairDoor);
  // Meeting 2B: opens as you walk up.
  const meetingDoor = new Door(b, {
    axis: 'z', a: 20, b: 22, fixed: 9, y0: F2, h: 2.4, color: 0x6b8fb3,
    shouldOpen: (p) => (onF2(p) && Math.hypot(p.x - 9, p.z - 21) < 2) || state.npcDoor,
  });
  doors.push(meetingDoor);

  return {
    doors,
    elevator,
    landingDoors,
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
      stairsFront: new THREE.Vector3(24.5, 0, 9.6),
      rampBottom: new THREE.Vector3(21.5, 0, 1.3),
      rampTop: new THREE.Vector3(21.5, F2, 8.5),
      stairExit: new THREE.Vector3(21.5, F2, 9.8),
      meetingDoor: new THREE.Vector3(10.4, F2, 21),
      meeting: new THREE.Vector3(4.5, F2, 20),
    },
    // Places to hide. `at` is where you tuck in, `use` where you press Space, `exit` where you
    // step back out. Phone pods: pretend to be on a call. Closet and plants: crouch out of sight.
    hideSpots: [
      { name: 'Behind the plants', floor: 0, use: new THREE.Vector3(8.15, 0, 21.95), radius: 1.2, at: new THREE.Vector3(8.15, 0, 21.95), yaw: Math.PI * 0.75, pose: 'crouch', label: 'Duck behind the plants' },
      { name: 'Phone pod', floor: 1, use: new THREE.Vector3(22.85, F2, 18.6), radius: 1.1, at: new THREE.Vector3(24.4, F2, 18.6), yaw: Math.PI / 2, pose: 'phone', exit: new THREE.Vector3(22.85, F2, 18.6), exitYaw: Math.PI / 2, label: 'Hide in the phone pod' },
      { name: 'Phone pod', floor: 1, use: new THREE.Vector3(22.85, F2, 21.7), radius: 1.1, at: new THREE.Vector3(24.4, F2, 21.7), yaw: Math.PI / 2, pose: 'phone', exit: new THREE.Vector3(22.85, F2, 21.7), exitYaw: Math.PI / 2, label: 'Hide in the phone pod' },
      { name: 'Supply closet', floor: 1, use: new THREE.Vector3(29.2, F2, 5), radius: 3.4, at: new THREE.Vector3(27.4, F2, 2.3), yaw: Math.PI, pose: 'crouch', label: 'Hide among the shelves' },
    ],
    zones: {
      inCab: (p) => elevator.contains(p),
      secure: (p) => !onF2(p) && p.z < 11 && p.x < 20,
      stairwell: (p) => p.x > 20 && p.x < 26 && p.z < 9,
      stairWalkway: (p) => !onF2(p) && p.x > 23 && p.x < 26 && p.z < 9,
      service: (p) => !onF2(p) && p.x > 26,
      kitchen: (p) => onF2(p) && p.x > 26 && p.z > 9 && p.z < 16.5,
      meeting: (p) => onF2(p) && p.x < 8.8 && p.z > 16.7,
      turnstileFront: (p) => !onF2(p) && p.z > 11 && p.z < 13.4 && p.x > 7 && p.x < 17,
      stairDoorInside: (p) => onF2(p) && p.x > 20 && p.x < 23.4 && p.z > 7.4 && p.z < 9,
    },
  };
}

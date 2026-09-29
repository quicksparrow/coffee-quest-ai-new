import * as THREE from 'three';
import { Character, CLIP_SPEED, look } from '../actors/character.js';
import { NavGrid } from './nav.js';
import { nameTag, meter, drawMeter, bubble, drawBubble } from '../ui/sprites.js';

/*
  Coworkers and stealth.

  Each coworker walks a patrol and looks where they're going. While you're inside their cone
  of sight, in plain view (walls, closed doors and cubicle partitions block it when you crouch),
  a meter over their head fills: faster up close or when you hurry, slower when you crouch or
  blend in at a counter. When it fills they call out and come over. Get out of sight or hide
  and they give up; let them reach you and you're stuck in a conversation, which costs time
  and points. Tap Space to excuse yourself sooner.
*/

const F2 = 4;
const EYE = 1.62;
// Collision groups: coworker capsules are in their own group so the camera and sight rays
// look past them (the player's character controller still bumps into them).
export const COWORKER_GROUPS = (0x0002 << 16) | 0xffff;
export const RAY_GROUPS = (0xffff << 16) | 0xfffd;

const START_GRACE = 5;      // nobody notices you in the first seconds of a run
const AFTER_TALK_GRACE = 5; // or right after a conversation
const TALK_COOLDOWN = 35;   // the same person won't grab you again for this long
const CATCH_DIST = 1.35;
const SUS_DECAY = 0.4;

// Who's in the office. Paths are [x, z, wait seconds, pose while waiting]. Routes between
// waypoints are found on the walkable grid, so paths only need to name the stops.
const CAST = [
  {
    id: 'pat', name: 'Pat', role: 'Accounting', kind: 'man', y: 0, look: look('Mustard', 'Brown', 'Black'),
    speed: 1.25, cone: 36, range: 8, sense: 1, talk: 10, chase: 3.9,
    path: [[6.8, 12.6, 0], [15, 12.6, 2.5, 'phone'], [22.5, 16.3, 3, 'arms'], [7.2, 16.8, 0]],
    hey: 'Oh hey! Got a second?',
    lines: ['Did you submit your expense report?', 'Receipts need to be itemized now.', 'Even the coffee ones. Especially those.', 'Anyway, I will email you the new policy.'],
  },
  {
    id: 'tom', name: 'Tom', role: 'Sales', kind: 'man', y: 0, look: look('Navy', 'Fair', 'Blonde'),
    speed: 1.3, cone: 40, range: 8, sense: 1, talk: 12, chase: 3.9,
    path: [[25, 22.6, 6, 'phone'], [24.6, 17.2, 0], [17.4, 17.2, 2.5, 'arms'], [19, 21.6, 0]],
    hey: 'My favorite person! Walk with me.',
    lines: ['Big quarter. BIG quarter.', 'Have you tried the new CRM?', 'We should grab lunch sometime.', 'Okay, go, go, you look busy.'],
  },
  {
    id: 'priya', name: 'Priya', role: 'IT', kind: 'woman', y: F2, look: look('Teal', 'Brown', 'Black'),
    speed: 1.35, cone: 45, range: 9, sense: 1, talk: 12, chase: 3.9,
    path: [[1.5, 10.1, 2, 'phone'], [19.2, 10.1, 0], [12, 7, 3, 'arms'], [12, 10.1, 0]],
    hey: 'Oh! Did you install the update yet?',
    lines: ['It is a mandatory update.', 'It only takes forty minutes.', 'Please do not click the pop-up.', 'Okay. Restart tonight, promise?'],
  },
  {
    id: 'dave', name: 'Dave', role: 'Storyteller', kind: 'man', y: F2, look: look('Forest', 'Fair', 'Auburn'),
    speed: 1.0, cone: 55, range: 7.5, sense: 0.85, talk: 15, chase: 3.5,
    path: [[11, 14.1, 1.5, 'phone'], [22.85, 14.1, 0], [22.85, 18.4, 2, 'arms'], [11, 18.4, 0]],
    hey: 'Hey hey! You will not believe my weekend.',
    lines: ['So Saturday, right, we rent a canoe.', 'And THEN the dog jumps in.', 'No wait, it gets better.', 'Anyway, you had to be there.'],
  },
  {
    id: 'monica', name: 'Monica', role: 'Manager', kind: 'woman', y: F2, look: look('Burgundy', 'Medium', 'Brown'),
    meetingSpot: [7.3, 19.2], meetingYaw: Math.PI / 2,
    speed: 1.55, cone: 22, range: 11, sense: 1.1, talk: 20, chase: 4.1,
    path: [[10.6, 17.8, 2, 'phone'], [10.6, 22.3, 0], [17.2, 22.3, 2, 'arms'], [10.6, 22.3, 0]],
    hey: 'Oh good, you are here. Quick question!',
    lines: ['Could you own the Q3 deck?', 'Just a few slides. Maybe forty.', 'Loop in legal. And finance.', 'Great, let us circle back after the call.'],
  },
  {
    // HR. Walking fast in the office is against the handbook, so she notices hurrying from
    // twice as far off. Joins the call at nine, clipboard ready.
    id: 'karen', name: 'Karen', role: 'HR', kind: 'woman', y: F2, look: look('Plum', 'Fair', 'Brown'),
    speed: 1.2, cone: 50, range: 8, sense: 1, hurrySense: 3, talk: 14, chase: 3.8,
    path: [[27.5, 18.4, 3, 'phone'], [27.5, 23, 0], [23.9, 23.3, 2.5, 'arms'], [24.9, 16.5, 0]],
    meetingSpot: [7.8, 23.3], meetingYaw: Math.PI / 4,
    hey: 'Walking, please. It is in the handbook.',
    lines: ['Your compliance training is overdue.', 'It is only nine modules.', 'Also, we do not microwave fish.', 'I will send a calendar invite. Mandatory.'],
  },
  {
    id: 'josh', name: 'Josh', role: 'Intern', kind: 'man', y: F2, look: look('Lilac', 'Medium', 'Brown'),
    speed: 1.35, cone: 40, range: 7, sense: 1.2, talk: 8, chase: 3.8, persistent: true,
    path: [[12.3, 22.4, 4, 'arms'], [22.85, 22.4, 0], [22.85, 14.1, 0], [25.3, 13.1, 0], [27, 13.1, 0], [29.6, 13.9, 0], [30.4, 12.8, 3, 'phone'], [29.6, 13.9, 0], [27, 13.1, 0], [25.3, 13.1, 0], [22.85, 14.1, 0], [22.85, 22.4, 0]],
    hey: 'Hi! Um, do you know how the printer works?',
    lines: ['It says PC LOAD LETTER.', 'What does that even mean?', 'I tried turning it off and on.', 'Never mind, I will ask IT.'],
  },
];

// The person who steps out through the Floor 2 stair door for a smoke. Friendly: holds the door.
const SMOKER = { id: 'rita', name: 'Rita', role: 'Smoke break', kind: 'woman', look: look('Olive', 'Medium', 'Auburn') };

// Ben from Finance badges through the turnstiles every few seconds, from the entrance to the
// elevators. Walk right behind him and the gate is still open for you (tailgating).
const COMMUTER = { id: 'ben', name: 'Ben', role: 'Finance', kind: 'man', look: look('Charcoal', 'Fair', 'Blonde') };
const COMMUTER_ROUTE = [[16.2, 23.4], [13, 12.5], [13, 9.6], [12.3, 5.8]];
const COMMUTER_GATE = 13;          // centre x of the turnstile gate he uses
const COMMUTER_WAIT = 5;           // seconds between trips

// Sometimes someone is already in the elevator when it arrives. Step in and you're stuck.
const RIDER = {
  id: 'gary', name: 'Gary', role: 'Facilities', kind: 'man', look: look('Navy', 'Brown', 'Brown'), talk: 9,
  lines: ['Going up? Me too.', 'Did you hear about the reorg?', 'They are moving us to the basement.', 'Anyway. Is this my floor?'],
};
const RIDER_CHANCE = 0.4;         // per round: he only turns up once

// Already in Meeting 2B: Linda presents at the screen, Sam (who texts you tips) sits at the table.
// They react when you walk in: nice things if you're on time, passive-aggressive ones if not.
const ATTENDEES = [
  { id: 'linda', name: 'Linda', role: 'VP', kind: 'woman', look: look('Slate', 'Fair', 'Brown'), at: [1.4, 20.1], yaw: -Math.PI / 2, pose: 'talk' },
  { id: 'sam', name: 'Sam', role: 'Work buddy', kind: 'man', look: look('Charcoal', 'Brown', 'Black'), at: [4.6, 22.25], yaw: 0, pose: 'sit' },
];
// Where Monica goes at 9:00: to the door of 2B, then inside.
const MEETING_DOOR = new THREE.Vector3(10.4, F2, 21);
const MEETING_INSIDE = new THREE.Vector3(8.1, F2, 21);

const tmpV = new THREE.Vector3();

function yawTo(dx, dz) { return Math.atan2(-dx, -dz); }
function angleDiff(a, b) { return Math.atan2(Math.sin(a - b), Math.cos(a - b)); }

// Stand-in body for when the character models can't load.
class StandIn {
  constructor(color) {
    this.root = new THREE.Group();
    const m = new THREE.MeshStandardMaterial({ color, roughness: 0.7 });
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.3, 0.9, 6, 12), m);
    body.position.y = 0.8;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.2, 14, 10), new THREE.MeshStandardMaterial({ color: 0xe0b894 }));
    head.position.y = 1.6;
    [body, head].forEach((o) => { o.castShadow = true; this.root.add(o); });
    this.glowMats = [m];
    this.current = { timeScale: 1 };
  }
  play() {}
  update() {}
}

class Coworker {
  constructor(def, sys) {
    this.def = def;
    this.sys = sys;
    this.group = new THREE.Group();
    if (sys.assets) {
      this.char = new Character(sys.assets, def.kind);
      if (def.look) this.char.setLook(def.look);
      this.char.glowMats = [this.char.body.material, ...(this.char.hairMats || [])];
    } else {
      this.char = new StandIn(0x9a6b5a);
    }
    this.group.add(this.char.root);
    sys.scene.add(this.group);
    this.tag = nameTag(def.name, def.role, def.friendly ? '#76a2e6' : '#ff8a6b');
    this.meter = meter();
    this.bubble = bubble();
    sys.scene.add(this.tag, this.meter, this.bubble);
    this.pos = new THREE.Vector3();
    this.prev = new THREE.Vector3();
    this.yaw = 0;
    this.prevYaw = 0;
  }
}

export class Stealth {
  constructor({ scene, world, R, assets, player, level }) {
    Object.assign(this, { scene, world, R, assets, player, level });
    this.xray = false;
    this.ray = new R.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 });
    this.seeThrough = level.seeThrough || new Set();
    // Physics queries need one step so the static level is in the broad phase.
    world.step();
    const skip = (c) => c === player.collider || level.elevator.parts.some((part) => part.c === c);
    this.nav = [new NavGrid(world, R, { y: 0, skip }), new NavGrid(world, R, { y: F2, skip })];
    this.list = CAST.map((def) => this.makeCoworker(def));
    this.smoker = this.makeSmoker();
    this.commuter = new Coworker({ ...COMMUTER, friendly: true }, this);
    this.commuter.scripted = true;
    this.rider = new Coworker(RIDER, this);
    this.rider.isRider = true;
    this.attendees = ATTENDEES.map((def) => {
      const cw = new Coworker({ ...def, friendly: true }, this);
      cw.pos.set(def.at[0], F2, def.at[1]);
      cw.prev.copy(cw.pos);
      cw.yaw = cw.prevYaw = def.yaw;
      cw.attendee = true;
      return cw;
    });
    this.smoker.scripted = true;
    this.everyone = [...this.list, this.smoker, this.commuter, this.rider, ...this.attendees];
    this.monica = this.list.find((c) => c.def.id === 'monica');
    this.karen = this.list.find((c) => c.def.id === 'karen');
    this.joiners = this.list.filter((c) => c.def.meetingSpot);   // they head into 2B at nine
    this.sightPredicate = (c) => !this.seeThrough.has(c.handle);
    this.reset();
  }

  makeCoworker(def) {
    const cw = new Coworker(def, this);
    const nav = this.nav[def.y > 2 ? 1 : 0];
    // Patrol legs between consecutive stops, found once.
    cw.stops = def.path.map(([x, z, wait = 0, pose = 'idle']) => ({ p: new THREE.Vector3(x, def.y, z), wait, pose }));
    cw.legs = cw.stops.map((s, i) => nav.find(s.p, cw.stops[(i + 1) % cw.stops.length].p) || [cw.stops[(i + 1) % cw.stops.length].p.clone()]);
    cw.nav = nav;
    // Capsule so you bump into people instead of walking through them.
    cw.body = this.world.createRigidBody(this.R.RigidBodyDesc.kinematicPositionBased().setTranslation(0, -50, 0));
    cw.collider = this.world.createCollider(this.R.ColliderDesc.capsule(0.55, 0.26).setCollisionGroups(COWORKER_GROUPS), cw.body);
    // X-ray: sight cone on the floor and the patrol route.
    const N = 24;
    cw.coneN = N;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array((N + 2) * 3), 3));
    const idx = [];
    for (let i = 0; i < N; i++) idx.push(0, i + 1, i + 2);
    g.setIndex(idx);
    cw.coneMat = new THREE.MeshBasicMaterial({ color: 0xffd36b, transparent: true, opacity: 0.34, depthTest: false, depthWrite: false, side: THREE.DoubleSide });
    cw.cone = new THREE.Mesh(g, cw.coneMat);
    cw.cone.frustumCulled = false;
    cw.cone.renderOrder = 6;
    cw.cone.visible = false;
    const pts = [];
    cw.stops.forEach((s, i) => { pts.push(s.p.clone()); cw.legs[i].forEach((q) => pts.push(q.clone())); });
    pts.forEach((q) => { q.y += 0.06; });
    const lg = new THREE.BufferGeometry().setFromPoints(pts);
    cw.pathLine = new THREE.Line(lg, new THREE.LineDashedMaterial({ color: 0xffffff, dashSize: 0.35, gapSize: 0.25, transparent: true, opacity: 0.55, depthTest: false }));
    cw.pathLine.computeLineDistances();
    cw.pathLine.renderOrder = 6;
    cw.pathLine.visible = false;
    this.scene.add(cw.cone, cw.pathLine);
    return cw;
  }

  makeSmoker() {
    const cw = new Coworker({ ...SMOKER, friendly: true }, this);
    cw.group.visible = false;
    return cw;
  }

  reset() {
    this.grace = START_GRACE;
    this.conversation = null;
    this.noticedBy = null;
    for (const cw of this.list) {
      cw.stop = 0;
      cw.route = [];
      cw.pos.copy(cw.stops[0].p);
      cw.prev.copy(cw.pos);
      const n = cw.stops[1].p;
      cw.yaw = cw.prevYaw = yawTo(n.x - cw.pos.x, n.z - cw.pos.z);
      this.beginLeg(cw);
      // Start by waiting at the first stop if it has a wait (staggers who is where early on).
      cw.state = cw.stops[0].wait > 0 ? 'wait' : 'patrol';
      cw.waitT = cw.stops[0].wait;
      cw.sus = 0;
      cw.cooldown = 0;
      cw.lostT = 0;
      cw.chaseT = 0;
      cw.replan = 0;
      cw.say = null; cw.sayT = 0;
      cw.moving = false;
      cw.slipped = false;
      cw.reactAnim = null;
      this.placeBody(cw);
    }
    const s = this.smoker;
    s.active = false;
    s.group.visible = false;
    s.say = null; s.sayT = 0;
    const c = this.commuter;
    c.active = false; c.group.visible = false; c.say = null; c.sayT = 0;
    c.waitT = 3;                      // first trip a few seconds into the run
    this.level.state.gateOpen = null;
    this.gateT = 0;
    const r = this.rider;
    r.active = false; r.group.visible = false; r.say = null; r.sayT = 0; r.state = 'gone'; r.used = false;
    for (const a of this.attendees) { a.state = 'attending'; a.say = null; a.sayT = 0; a.reactAnim = null; a.yaw = a.prevYaw = a.def.yaw; }
    this.reaction = null;
    this.meetingCalled = false;
    this.level.state.npcDoor = false;
  }

  // ---------- 9:00: Monica and Karen head into the call ----------
  callToMeeting() { this.meetingCalled = true; }

  sendToMeeting(m) {
    m.state = 'toMeeting';
    m.sus = 0;
    const spot = new THREE.Vector3(m.def.meetingSpot[0], F2, m.def.meetingSpot[1]);
    m.route = [...(m.nav.find(m.pos, MEETING_DOOR) || [MEETING_DOOR.clone()]), MEETING_INSIDE.clone(), spot];
    m.say = m === this.karen ? 'Nine o\'clock. Time to take notes.' : 'Oh! Nine o\'clock. Gotta run.'; m.sayT = 2.4;
  }

  // ---------- Walking into 2B ----------
  // Who says what when you arrive (about six seconds of it). Returns the quote for the end screen.
  react({ late, lateBy = 0, cups, lastTalker, chats = 0 }) {
    const [linda, sam] = this.attendees;
    const inRoom = (c) => (c.state === 'inMeeting' ? c : null);
    const monica = inRoom(this.monica), karen = inRoom(this.karen);
    const seq = [];
    const say = (who, text, anim = null) => seq.push([seq.length ? 2.0 : 0.4, who, text, anim]);
    // Two lines: Linda, then one more from whoever has the best comeback.
    if (!late) {
      say(linda, cups >= 5 ? 'Right on time, and nobody even saw you come in.' : 'Right on time. Love that.', 'cheer');
      say(sam, lastTalker ? `You got away from ${lastTalker}? Legend.` : cups >= 4 ? 'Coffee AND on time? Who are you?' : 'See? Told them you would make it.');
    } else {
      say(linda, lateBy > 20 ? 'Oh! We thought you quit.' : 'Oh good. You could join us.', 'arms');
      if (monica) say(monica, 'Per my calendar invite, this started at nine.', 'arms');
      else if (karen) say(karen, "I'll just make a note of that. For your file.", 'phone');
      else say(sam, lastTalker ? `Let me guess. ${lastTalker}?` : chats ? 'Let me guess. Somebody had a quick question?' : 'We started without you...');
    }
    this.reaction = { t: 0, seq, end: 5.2 };
    return { quote: `"${seq[0][2]}" ${seq[0][1].def.name}, ${seq[0][1].def.role}` };
  }

  // Everyone in 2B during the finale (for framing the shot).
  get roomPeople() { return [...this.attendees, ...this.joiners.filter((m) => m.state === 'inMeeting')]; }

  tickReaction(dt) {
    const r = this.reaction;
    if (!r) return;
    r.t += dt;
    for (const item of r.seq) {
      if (item.done || r.t < item[0]) continue;
      item.done = true;
      const [, cw, text, anim] = item;
      cw.say = text; cw.sayT = 6;
      cw.reactAnim = anim;
      const P = this.player.renderPos;
      if (cw.def.pose !== 'sit') { cw.yaw = cw.prevYaw = yawTo(P.x - cw.pos.x, P.z - cw.pos.z); cw.group.rotation.y = cw.yaw; }
    }
    for (const cw of this.attendees.concat(this.joiners)) cw.sayT = Math.max(0, cw.sayT - (cw.say && cw.sayT < 90 ? dt : 0));
  }

  beginLeg(cw) { cw.route = cw.legs[cw.stop].map((p) => p.clone()); }

  placeBody(cw) { cw.body.setNextKinematicTranslation({ x: cw.pos.x, y: cw.pos.y + 0.85, z: cw.pos.z }); cw.body.setTranslation({ x: cw.pos.x, y: cw.pos.y + 0.85, z: cw.pos.z }, true); }

  // ---------- The stair door smoker ----------
  startSmoker(playerX) {
    const s = this.smoker;
    if (s.active) return;          // still on the way down: someone else holds the door this time
    const x = playerX < 21.5 ? 22.3 : 20.7;
    s.script = [
      new THREE.Vector3(x, F2, 8.0),
      new THREE.Vector3(x, 0, 2.2),
      new THREE.Vector3(x, 0, 1.1),
      new THREE.Vector3(24.6, 0, 1.1),
      new THREE.Vector3(24.6, 0, 3.8),
      new THREE.Vector3(27.3, 0, 3.8),
    ];
    s.pos.set(x, F2, 10.3);
    s.prev.copy(s.pos);
    s.yaw = s.prevYaw = 0;         // facing north, toward the door
    s.active = true;
    s.moving = true;
    s.group.visible = true;
    s.say = 'Morning! Go ahead, I got the door.'; s.sayT = 3;
  }

  updateSmoker(dt) {
    const s = this.smoker;
    if (!s.active) return;
    s.prev.copy(s.pos); s.prevYaw = s.yaw;
    const t = s.script[0];
    if (!t) { s.active = false; s.group.visible = false; return; }
    const d = tmpV.subVectors(t, s.pos);
    const flat = Math.hypot(d.x, d.z);
    const step = 1.35 * dt;
    if (flat <= step) { s.pos.copy(t); s.script.shift(); } else s.pos.addScaledVector(d, step / flat);
    if (flat > 0.01) s.yaw += angleDiff(yawTo(d.x, d.z), s.yaw) * Math.min(1, dt * 8);
    s.sayT = Math.max(0, s.sayT - dt);
  }

  // ---------- Ben, badging through the turnstiles ----------
  updateCommuter(dt) {
    const c = this.commuter;
    c.prev.copy(c.pos); c.prevYaw = c.yaw;
    c.sayT = Math.max(0, c.sayT - dt);
    if (!c.active) {
      c.waitT -= dt;
      if (c.waitT <= 0) {
        c.active = true;
        c.script = COMMUTER_ROUTE.slice(1).map(([x, z]) => new THREE.Vector3(x, 0, z));
        c.pos.set(COMMUTER_ROUTE[0][0], 0, COMMUTER_ROUTE[0][1]);
        c.prev.copy(c.pos);
        c.yaw = c.prevYaw = 0;
        c.fade = 0;
        c.moving = true;
      }
    } else {
      c.fade = Math.min(1, c.fade + dt * 2);
      const t = c.script[0];
      if (!t) {
        c.moving = false;
        c.fade = Math.max(0, c.fade - dt * 4);            // steps into the elevator lobby and is gone
        c.outT = (c.outT || 0) + dt;
        if (c.outT > 0.5) { c.active = false; c.outT = 0; c.waitT = COMMUTER_WAIT; }
      } else {
        const d = tmpV.subVectors(t, c.pos);
        const flat = Math.hypot(d.x, d.z);
        const step = 1.55 * dt;
        if (flat <= step) { c.pos.copy(t); c.script.shift(); } else c.pos.addScaledVector(d, step / flat);
        if (flat > 0.01) c.yaw += angleDiff(yawTo(d.x, d.z), c.yaw) * Math.min(1, dt * 8);
      }
    }
    // His badge opens the gate as he reaches it; it stays open a moment after he's through.
    const near = c.active && Math.hypot(c.pos.x - COMMUTER_GATE, c.pos.z - 11) < 1.6;
    if (near) { this.gateT = 1.4; if (c.pos.z > 11.6 && !c.beeped) { c.beeped = true; this.onBadge?.(); } }
    else this.gateT = Math.max(0, this.gateT - dt);
    if (!c.active) c.beeped = false;
    this.level.state.gateOpen = this.gateT > 0 ? COMMUTER_GATE : null;
  }

  // ---------- Gary, already in the elevator ----------
  // Called when the elevator doors open for you (you're outside the car). Rolled once per round.
  elevatorArrived() {
    const r = this.rider;
    if (r.active || r.used || this.conversation) return false;
    r.used = true;
    if (Math.random() > RIDER_CHANCE) return false;
    r.active = true;
    r.state = 'rider';
    r.say = null; r.sayT = 0;
    r.cooldown = 0;
    return true;
  }

  updateRider(dt, P, events) {
    const r = this.rider, el = this.level.elevator;
    r.prev.copy(r.pos); r.prevYaw = r.yaw;
    r.sayT = Math.max(0, r.sayT - dt);
    if (!r.active) return;
    r.pos.set(el.x + 0.7, el.y, el.z - 0.5);
    if (r.state !== 'talk') r.yaw = r.prevYaw = Math.PI;        // facing the doors
    const inside = el.contains(P.pos);
    if (r.state === 'rider' && inside && !this.conversation && !P.hidden) { this.startConversation(r, P, events); return; }
    // Doors close (or the car leaves) without you: Gary goes about his day.
    if ((r.state === 'rider' && !inside && (!el.doorsOpen || el.moving)) || (r.state === 'leaving' && !inside && (!el.doorsOpen || el.moving))) {
      r.active = false;
      r.state = 'gone';
    }
    if (r.state === 'rider' && el.doorsOpen && Math.hypot(P.pos.x - el.x, P.pos.z - el.z) < 7 && Math.abs(P.pos.y - el.y) < 1.5) events.riderSeen ||= r;
  }

  // ---------- Sight ----------
  // Can this coworker see the player right now? Returns the distance or -1.
  sees(cw, P) {
    if (P.hidden || Math.abs(P.pos.y - cw.pos.y) > 1.5) return -1;
    const dx = P.pos.x - cw.pos.x, dz = P.pos.z - cw.pos.z;
    const d = Math.hypot(dx, dz);
    if (d > cw.def.range) return -1;
    const off = Math.abs(angleDiff(yawTo(dx, dz), cw.yaw));
    const inCone = off < (cw.def.cone * Math.PI) / 180;
    if (!inCone && d > 1.8) return -1;              // right next to them counts, whichever way they face
    const head = P.crouching ? 0.95 : 1.55;
    const ox = cw.pos.x, oy = cw.pos.y + EYE, oz = cw.pos.z;
    const tx = P.pos.x, ty = P.pos.y + head, tz = P.pos.z;
    const len = Math.hypot(tx - ox, ty - oy, tz - oz);
    const r = this.ray;
    r.origin.x = ox; r.origin.y = oy; r.origin.z = oz;
    r.dir.x = (tx - ox) / len; r.dir.y = (ty - oy) / len; r.dir.z = (tz - oz) / len;
    const hit = this.world.castRay(r, len, true, undefined, RAY_GROUPS, this.player.collider, undefined, this.sightPredicate);
    if (hit && hit.timeOfImpact < len - 0.25) return -1;
    return inCone ? d : d + 100;                     // +100 flags "noticed at the edge of vision"
  }

  // ---------- Per physics step ----------
  // P: { pos, crouching, hurrying, hidden, blending, riding, active }
  update(dt, P, events) {
    this.grace = Math.max(0, this.grace - dt);
    this.updateSmoker(dt);
    this.updateCommuter(dt);
    this.updateRider(dt, P, events);
    if (this.conversation) this.updateConversation(dt, events);
    for (const m of this.joiners) {
      if (this.meetingCalled && !['talk', 'toMeeting', 'inMeeting'].includes(m.state)) this.sendToMeeting(m);
    }
    this.level.state.npcDoor = this.joiners.some((m) => m.state === 'toMeeting' && Math.hypot(m.pos.x - 9, m.pos.z - 21) < 2.6);
    for (const cw of this.list) {
      cw.prev.copy(cw.pos);
      cw.prevYaw = cw.yaw;
      cw.cooldown = Math.max(0, cw.cooldown - dt);
      cw.sayT = Math.max(0, cw.sayT - dt);
      if (cw.state === 'talk') { this.placeBody(cw); continue; }
      if (cw.state === 'toMeeting') {
        if (this.walk(cw, dt, cw.def.speed * 1.3, null)) cw.state = 'inMeeting';
        this.placeBody(cw);
        continue;
      }
      if (cw.state === 'inMeeting') {
        cw.moving = false;
        cw.yaw += angleDiff(cw.def.meetingYaw, cw.yaw) * Math.min(1, dt * 4);   // facing the screen
        this.placeBody(cw);
        continue;
      }

      // Suspicion
      let seenD = -1;
      if (P.active && this.grace === 0 && cw.cooldown === 0 && !this.conversation) seenD = this.sees(cw, P);
      const watching = cw.state === 'patrol' || cw.state === 'wait' || cw.state === 'notice' || cw.state === 'return' || cw.state === 'search';
      if (watching) {
        if (seenD >= 0) {
          const edge = seenD >= 100;
          const d = edge ? seenD - 100 : seenD;
          let rate = 1.25 * cw.def.sense * (1 - 0.6 * (d / cw.def.range));
          if (P.crouching) rate *= 0.35;
          if (P.hurrying) rate *= cw.def.hurrySense || 1.6;
          if (P.blending) rate *= 0.15;          // waiting in a line: just another customer
          if (edge) rate *= 0.6;
          cw.sus = Math.min(1, cw.sus + rate * dt);
        } else {
          cw.sus = Math.max(0, cw.sus - SUS_DECAY * dt);
        }
        if (cw.sus > 0.3 && cw.state !== 'notice') { cw.resume = cw.state; cw.state = 'notice'; events.noticed ||= cw; }
        else if (cw.state === 'notice' && cw.sus < 0.12) { cw.state = cw.resume === 'wait' ? 'wait' : 'return'; cw.route = null; }
        if (cw.sus >= 1) {
          cw.state = 'chase';
          cw.chaseT = 0; cw.lostT = 0; cw.replan = 0; cw.route = [];
          cw.say = cw.def.hey; cw.sayT = 2.6;
          cw.slipped = false;
          events.spotted ||= cw;
        }
      }

      switch (cw.state) {
        case 'patrol': {
          if (this.walk(cw, dt, cw.def.speed, P)) {
            const s = cw.stops[(cw.stop + 1) % cw.stops.length];
            cw.stop = (cw.stop + 1) % cw.stops.length;
            if (s.wait > 0) { cw.state = 'wait'; cw.waitT = s.wait; } else this.beginLeg(cw);
          }
          break;
        }
        case 'wait': {
          cw.moving = false;
          cw.waitT -= dt;
          // Face the direction of the next leg while waiting.
          const n = cw.legs[cw.stop][0];
          if (n) cw.yaw += angleDiff(yawTo(n.x - cw.pos.x, n.z - cw.pos.z), cw.yaw) * Math.min(1, dt * 2);
          if (cw.waitT <= 0) { cw.state = 'patrol'; this.beginLeg(cw); }
          break;
        }
        case 'notice': {
          cw.moving = false;
          const dx = P.pos.x - cw.pos.x, dz = P.pos.z - cw.pos.z;
          if (!P.hidden) cw.yaw += angleDiff(yawTo(dx, dz), cw.yaw) * Math.min(1, dt * 3);
          break;
        }
        case 'chase': {
          cw.chaseT += dt;
          const sameFloor = Math.abs(P.pos.y - cw.pos.y) < 1.5;
          cw.lostT = this.sees(cw, P) >= 0 ? 0 : cw.lostT + dt;
          // Josh the intern doesn't fall for hiding: he waits outside your hiding spot.
          const lurking = P.hidden && cw.def.persistent;
          const giveUp = (P.hidden && !lurking) || !sameFloor || P.riding || cw.chaseT > 25 || (!cw.def.persistent && cw.lostT > 1.8);
          if (giveUp) {
            if (P.hidden && !cw.slipped) { cw.slipped = true; events.slipped ||= cw; }
            cw.state = 'search'; cw.searchT = 1.8; cw.sus = 0; cw.route = null;
            cw.say = cw.def.persistent ? 'Okay. I will ask someone else.' : 'Huh. Where did they go?'; cw.sayT = 2;
            break;
          }
          if (this.conversation) {                      // someone else got to you first
            cw.state = 'search'; cw.searchT = 1.2; cw.sus = 0; cw.cooldown = 8; cw.route = null;
            break;
          }
          const target = lurking ? P.lurk : P.pos;
          const d = Math.hypot(target.x - cw.pos.x, target.z - cw.pos.z);
          if (lurking) {
            if (d < 1.1) { cw.moving = false; cw.route = []; if (!cw.sayT) { cw.say = 'I can wait. I am an intern.'; cw.sayT = 2.5; } break; }
          } else if (d < CATCH_DIST && cw.lostT === 0) { this.startConversation(cw, P, events); break; }
          cw.replan -= dt;
          if (cw.replan <= 0 || !cw.route || !cw.route.length) {
            cw.route = cw.nav.find(cw.pos, target) || [];
            cw.replan = 0.35;
          }
          this.walk(cw, dt, cw.def.chase, null);
          break;
        }
        case 'search': {
          cw.moving = false;
          cw.searchT -= dt;
          cw.yaw += Math.sin(cw.searchT * 3) * dt * 1.5;
          if (cw.searchT <= 0) { cw.state = 'return'; cw.route = null; }
          break;
        }
        case 'return': {
          // Walk back to the next stop of the patrol, then carry on.
          if (!cw.route) {
            const next = cw.stops[(cw.stop + 1) % cw.stops.length].p;
            cw.route = cw.nav.find(cw.pos, next) || [next.clone()];
          }
          if (this.walk(cw, dt, cw.def.speed, P)) {
            cw.stop = (cw.stop + 1) % cw.stops.length;
            cw.state = 'patrol';
            this.beginLeg(cw);
          }
          break;
        }
        default: break;
      }
      this.placeBody(cw);
    }
  }

  // Follow cw.route. Returns true when the route is done. Holds still if the player is in the way.
  walk(cw, dt, speed, P) {
    const t = cw.route?.[0];
    if (!t) { cw.moving = false; return true; }
    const dx = t.x - cw.pos.x, dz = t.z - cw.pos.z;
    const dist = Math.hypot(dx, dz);
    const want = yawTo(dx, dz);
    const diff = angleDiff(want, cw.yaw);
    cw.yaw += diff * Math.min(1, dt * 7);
    // Don't walk into the player: wait politely.
    if (P && !P.hidden && Math.abs(P.pos.y - cw.pos.y) < 1.5) {
      const px = P.pos.x - cw.pos.x, pz = P.pos.z - cw.pos.z;
      const pd = Math.hypot(px, pz);
      if (pd < 1.05 && (px * dx + pz * dz) / (pd * dist + 1e-6) > 0.2) {
        cw.moving = false;
        // Blocked for a moment: step around the player instead of waiting forever.
        cw.blockT = (cw.blockT || 0) + dt;
        if (cw.blockT > 0.8) {
          cw.blockT = 0;
          let moved = false;
          for (const side of [1, -1]) {
            const sx = cw.pos.x + (-dz / dist) * 1.2 * side + (dx / dist) * 0.6;
            const sz = cw.pos.z + (dx / dist) * 1.2 * side + (dz / dist) * 0.6;
            if (cw.nav.walkable(sx, sz) && cw.nav.clearLine(cw.pos.x, cw.pos.z, sx, sz) && cw.nav.clearLine(sx, sz, t.x, t.z) && Math.hypot(sx - P.pos.x, sz - P.pos.z) > 1.1) {
              cw.route.unshift(new THREE.Vector3(sx, cw.pos.y, sz));
              moved = true;
              break;
            }
          }
          // No room to pass (a gap between desks): back off and let the player through first.
          if (!moved) {
            let best = null, bestD = pd + 0.5;
            for (let k = 0; k < 16; k++) {
              const a = (k / 16) * Math.PI * 2, len = k % 2 ? 1.0 : 1.7;
              const bx = cw.pos.x + Math.cos(a) * len, bz = cw.pos.z + Math.sin(a) * len;
              const away = Math.hypot(bx - P.pos.x, bz - P.pos.z);
              if (away > bestD && cw.nav.walkable(bx, bz) && cw.nav.clearLine(cw.pos.x, cw.pos.z, bx, bz)) { best = [bx, bz]; bestD = away; }
            }
            if (best) cw.route.unshift(new THREE.Vector3(best[0], cw.pos.y, best[1]));
          }
        }
        return false;
      }
      cw.blockT = 0;
    }
    const turnSlow = Math.max(0.15, Math.cos(Math.min(Math.abs(diff), Math.PI / 2)));
    const step = speed * turnSlow * dt;
    cw.moving = true;
    cw.speed = speed * turnSlow;
    if (dist <= step) { cw.pos.x = t.x; cw.pos.z = t.z; cw.route.shift(); return cw.route.length === 0; }
    cw.pos.x += (dx / dist) * step;
    cw.pos.z += (dz / dist) * step;
    return false;
  }

  // ---------- Conversations ----------
  startConversation(cw, P, events) {
    cw.state = 'talk';
    cw.moving = false;
    cw.sus = 1;
    this.conversation = { cw, t: 0, excuse: 0, line: 0, lineT: 0 };
    cw.say = cw.def.lines[0]; cw.sayT = 99;
    events.caught = cw;
  }

  excuse() {
    const c = this.conversation;
    if (!c) return;
    c.excuse = Math.min(c.cw.def.talk * 0.7, c.excuse + 1);
  }

  get remaining() {
    const c = this.conversation;
    return c ? Math.max(0, c.cw.def.talk - c.t - c.excuse) : 0;
  }

  updateConversation(dt, events) {
    const c = this.conversation;
    const cw = c.cw;
    c.t += dt;
    c.lineT += dt;
    const lines = cw.def.lines;
    if (c.lineT > Math.max(2.2, cw.def.talk / lines.length) && c.line < lines.length - 1) {
      c.line += 1; c.lineT = 0;
      cw.say = lines[c.line]; cw.sayT = 99;
    }
    // Face the player.
    const P = this.player.position;
    cw.yaw += angleDiff(yawTo(P.x - cw.pos.x, P.z - cw.pos.z), cw.yaw) * Math.min(1, dt * 6);
    // Pulled apart (the elevator left with you in it): the chat just ends.
    if (Math.hypot(P.x - cw.pos.x, P.z - cw.pos.z) > 3 || Math.abs(P.y - cw.pos.y) > 1.5) c.excuse = cw.def.talk;
    if (this.remaining <= 0 && cw.isRider) {
      this.conversation = null;
      cw.state = 'leaving';
      cw.say = 'Oh, this is me. Bye!'; cw.sayT = 1.8;
      this.grace = AFTER_TALK_GRACE;
      events.released = cw;
      return;
    }
    if (this.remaining <= 0) {
      this.conversation = null;
      cw.state = 'return';
      cw.route = null;
      cw.sus = 0;
      cw.cooldown = TALK_COOLDOWN;
      cw.say = 'Anyway! Talk later.'; cw.sayT = 1.8;
      this.grace = AFTER_TALK_GRACE;
      for (const o of this.list) { if (o.state === 'notice') { o.sus = 0; o.state = 'return'; o.route = null; } }
      events.released = cw;
    }
  }

  // Anyone currently suspicious or coming after the player (for the "hid from" bonus).
  get pursuers() { return this.list.filter((cw) => cw.state === 'chase' || (cw.state === 'notice' && cw.sus > 0.3)); }

  // ---------- Per rendered frame ----------
  interpolate(alpha) {
    const all = this.everyone;
    for (const cw of all) {
      cw.group.position.lerpVectors(cw.prev, cw.pos, alpha);
      cw.group.rotation.y = cw.prevYaw + angleDiff(cw.yaw, cw.prevYaw) * alpha;
    }
  }

  animate(dt, { playerPos, playerFloor, playing: live }) {
    this.tickReaction(dt);
    for (const cw of this.everyone) {
      // Once you're in 2B, only the people in the room keep their labels.
      const playing = live && (!this.reaction || cw.attendee || cw.state === 'inMeeting');
      if (cw.attendee) { cw.group.position.copy(cw.pos); cw.group.rotation.y = cw.yaw; }
      if ((cw.scripted || cw.isRider) && !cw.active) { cw.tag.visible = cw.bubble.visible = cw.meter.visible = false; cw.group.visible = false; continue; }
      if (cw === this.commuter) cw.char.setFade?.(cw.fade);
      const floor = cw.group.position.y > 2 ? 1 : 0;
      const same = floor === playerFloor;
      const d = Math.hypot(playerPos.x - cw.group.position.x, playerPos.z - cw.group.position.z);
      // Animation
      let key = 'idle';
      if (cw.reactAnim) key = cw.reactAnim;
      else if (cw.attendee) key = cw.def.pose;
      else if (cw.state === 'inMeeting') key = 'arms';
      else if (cw.state === 'talk') key = 'talk';
      else if (cw.scripted) key = cw.moving ? 'walk' : 'idle';
      else if (cw.moving) key = cw.state === 'chase' ? 'jog' : 'walk';
      else if (cw.state === 'wait') key = cw.stops[cw.stop].pose || 'idle';
      else if (cw.state === 'notice') key = 'idle';
      cw.char.play(key, 0.25);
      const clip = CLIP_SPEED[key];
      const spd = cw === this.smoker ? 1.35 : cw === this.commuter ? 1.55 : cw.speed || cw.def.speed;
      if (cw.char.current) cw.char.current.timeScale = clip ? THREE.MathUtils.clamp(spd / clip, 0.6, 1.6) : 1;
      // People on the other floor are behind a concrete slab: skip drawing and animating them.
      cw.group.visible = same && (!(cw.scripted || cw.isRider) || cw.active);
      if (same) cw.char.update(dt);
      // Labels stack above the head in screen space (they keep a constant size on screen, so
      // the stacking uses each sprite's anchor rather than world-space offsets).
      const gx = cw.group.position.x, gz = cw.group.position.z, top = cw.group.position.y + 2.05;
      const showTag = playing && same && (d < 10 || this.xray);
      cw.tag.position.set(gx, top, gz);
      cw.tag.center.set(0.5, 0);
      cw.tag.visible = true;
      cw.tag.material.opacity += ((showTag ? 1 : 0) - cw.tag.material.opacity) * Math.min(1, dt * 6);
      const tagH = cw.tag.material.opacity > 0.3 ? cw.tag.scale.y : 0;
      const showMeter = playing && same && cw.sus > 0.02 && !cw.scripted;
      cw.meter.visible = showMeter;
      if (showMeter) {
        drawMeter(cw.meter, cw.sus, cw.state);
        cw.meter.position.set(gx, top, gz);
        cw.meter.center.set(0.5, -(tagH + 0.006) / cw.meter.scale.y);
        cw.meter.material.opacity = 1;
      }
      const talking = cw.say && cw.sayT > 0 && playing && same && d < 14;
      cw.bubble.visible = !!talking;
      if (talking) {
        drawBubble(cw.bubble, cw.say);
        const below = tagH + (showMeter ? cw.meter.scale.y + 0.006 : 0);
        cw.bubble.position.set(gx, top, gz);
        cw.bubble.center.set(0.5, -below / cw.bubble.scale.y);
        cw.bubble.material.opacity = 1;
      }
      if (cw.cone) this.drawCone(cw, same && this.xray && playing);
    }
  }

  // X-ray: the part of the floor each coworker can see, clipped by walls.
  drawCone(cw, show) {
    cw.cone.visible = show;
    cw.pathLine.visible = show;
    if (!show) return;
    const pos = cw.cone.geometry.attributes.position;
    const a = pos.array;
    const g = cw.group.position;
    const y = g.y + 0.05;
    a[0] = g.x; a[1] = y; a[2] = g.z;
    const half = (cw.def.cone * Math.PI) / 180;
    const yaw = cw.group.rotation.y;
    const r = this.ray;
    r.origin.x = g.x; r.origin.y = g.y + EYE; r.origin.z = g.z;
    for (let i = 0; i <= cw.coneN; i++) {
      const ang = yaw - half + (2 * half * i) / cw.coneN;
      const dx = -Math.sin(ang), dz = -Math.cos(ang);
      r.dir.x = dx; r.dir.y = 0; r.dir.z = dz;
      const hit = this.world.castRay(r, cw.def.range, true, undefined, RAY_GROUPS, this.player.collider, undefined, this.sightPredicate);
      const len = hit ? hit.timeOfImpact : cw.def.range;
      a[(i + 1) * 3] = g.x + dx * len; a[(i + 1) * 3 + 1] = y; a[(i + 1) * 3 + 2] = g.z + dz * len;
    }
    pos.needsUpdate = true;
    const alarm = cw.state === 'chase' || cw.state === 'talk';
    cw.coneMat.color.setHex(alarm ? 0xff4a3a : cw.sus > 0.3 ? 0xff9a3a : 0xffc93d);
  }

  setXray(on) {
    this.xray = on;
    for (const cw of this.everyone) {
      for (const m of cw.char.glowMats || []) {
        m.emissive.setHex(on ? (cw.def.friendly ? 0x2a5aa0 : 0xc2412a) : 0x000000);
        m.emissiveIntensity = on ? 0.9 : 1;
      }
    }
  }

  // Everything that has to be compiled before play (x-ray pieces are normally hidden).
  warmup(on) {
    for (const cw of this.list) { cw.cone.visible = on; cw.pathLine.visible = on; cw.meter.visible = on; cw.bubble.visible = on; cw.group.visible = true; }
    this.smoker.group.visible = on;
    this.commuter.group.visible = on;
    this.rider.group.visible = on;
  }
}

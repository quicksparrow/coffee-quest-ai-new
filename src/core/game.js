import * as THREE from 'three';

export const ROUND_SECONDS = 100;          // 08:55 → 09:00 in real seconds: the clock runs 3× fast
const GAME_SECONDS_PER_REAL = 300 / ROUND_SECONDS;
const START_MIN = 8 * 60 + 55;
const WARN_AT = ROUND_SECONDS - 120 / GAME_SECONDS_PER_REAL;   // 08:58

const RATINGS = ['Decaf', 'Drip', 'Americano', 'Flat White', 'Silent Commuter'];
const SMOKE_WAIT = 3;       // wait at the stair exit this long before someone opens it (seconds)…
const SMOKE_OPEN = 5;       // …and it stays open this long
const ACTION_BUFFER = 0.15; // a Space press is remembered briefly, so pressing a hair early still counts

const HINTS = {
  start: "Call's at 9:00 in Meeting 2B, Floor 2. Don't show up without coffee!",
  turnstile: "No badge again? Ask reception for a visitor pass, sneak round through the mailroom (that door is always propped open), or stick close behind Ben from Finance when he badges through.",
  tailgate: 'Tailgated! Ben never even noticed.',
  rider: "Gary from Facilities is in the elevator. Step in and you're stuck chatting all the way up. Let the doors close and call it again, or take the stairs.",
  visitor: 'Visitor pass works on the turnstiles and the elevators. Not on the doors upstairs, though.',
  coffee: 'Nice. Press Space to sip, every sip is points and a little speed boost. Finished it? Grab another, as many as you like.',
  spill: 'Careful! Hurrying spills your coffee.',
  stairdoor: "That door needs a badge. Someone's about to step out for a smoke. Wait right by it and walk in after them.",
  elevator: 'Just step in and wait, it goes on its own. Or press Space to leave right away.',
  floor2: "You're up! 2B is in the far corner, right across the open office. There's a back door on its north side, too.",
  nocoffee: "You can't walk in empty-handed. Coffee first!",
  xray: 'Pro tip: hold X to see through walls: who is around, where they are looking, coffee and hiding spots.',
  hidden: "You're hidden. Wait for them to walk past, then press Space to step out.",
  stuck: 'Stuck chatting. Tap Space to politely excuse yourself.',
  slipped: 'Nice, they lost you. Hiding works on everyone except Josh the intern, he never gives up.',
  warn: 'Two minutes! Where are you?',
  late: 'The call started. Just get here, late is better than never.',
};

const TUTORIAL = [
  { key: '↑ ← →', text: 'Walk and turn (or W A D)', done: (g) => g.stats.moved && g.stats.turned },
  { key: '↓', text: 'Turn around', done: (g) => g.stats.aboutFaced },
  { key: 'Shift', text: 'Hold to hurry', done: (g) => g.stats.hurried },
  { key: 'C', text: 'Crouch to stay low', done: (g) => g.stats.crouched },
  { key: 'Space', text: 'Does whatever is in front of you', done: () => false, maxTime: 5 },
];

export class Game {
  constructor({ level, player, camCtl, input, hud, sfx, builder, marker, stealth, beacons, onFloorChange, onEnd }) {
    Object.assign(this, { level, player, camCtl, input, hud, sfx, builder, marker, stealth, beacons, onFloorChange, onEnd });
    this.hintsOn = true;
    this._doorProbe = new THREE.Vector3();
    this.near = null;
    this.state = level.state;
    this.interactables = this.buildInteractables();
    this.reset();
  }

  reset() {
    const s = this.state;
    s.hasBadge = false;
    s.smokerOpen = false;
    s.coffee = { obtained: false, latte: false, espresso: false, sips: 0, count: 0 };
    this.elapsed = 0;
    this.smokeIn = SMOKE_WAIT;
    this.smokeOpenT = 0;
    this.busy = null;
    this.actionBuffer = 0;
    this.sipCooldown = 0;
    this.boost = 0;
    this.spillT = 0;
    this.seenHints = new Set();
    this.events = [];
    this.conversations = 0;
    this.inMeeting = false;
    this.lastTalker = null;
    this.called = false;
    this.inMeetingNoCoffee = false;
    this.routes = new Set();          // route bonuses already scored this round
    this.lastPos = null;
    this.elDoorsWere = this.level.elevator.doorsOpen;
    this.tut = { i: 0, t: 0 };
    this.stats = { moved: false, turned: false, aboutFaced: false, hurried: false, crouched: false, xray: false };
    this.over = false;
    this.lastFloor = 0;
    this.player.crouching = false;
    this.player.cup.visible = false;
    this.player.idleStyle = null;
    this.player.sipT = 0;
    if (this.player.hidden) { this.player.hidden = null; this.player.collider.setEnabled(true); }
    this.stealth?.reset();
    this.level.elevator.reset();
    this.player.teleport(this.level.spawn, this.level.spawnYaw);
    this.camCtl.snap();
    this.hud.clearTexts();
    this.onFloorChange(0);
  }

  // ---------- Things you can use with Space ----------
  buildInteractables() {
    const P = this.level.points;
    const s = this.state;
    const el = this.level.elevator;
    const here = (floor) => el.phase === 'idle' && el.floor === floor && el.doorsOpen;
    const call = (floor, pt) => ({
      pos: pt, radius: 1.9, floor, always: true,     // always shows its status, even when it can't be used
      enabled: () => el.phase === 'idle' && !here(floor),
      label: () => {
        if (here(floor)) return { text: 'Elevator is here · step in', key: null };
        if (el.busy) return { text: el.target === floor ? 'Elevator on its way…' : 'Elevator is busy…', key: null };
        return { text: 'Call elevator' };
      },
      use: () => { el.call(floor); this.sfx.beep(); this.player.playOnce('interact'); },
    });
    return [
      {
        pos: P.reception, radius: 1.8, floor: 0,
        enabled: () => !s.hasBadge,
        label: () => ({ text: 'Ask for a visitor pass' }),
        use: () => this.startBusy('Waiting at reception…', 5, 'talk', () => {
          s.hasBadge = true;
          this.score('Visitor pass', 150);
          this.sfx.beep();
          this.hint('visitor');
        }),
      },
      {
        pos: P.cafe, radius: 2, floor: 0,
        enabled: () => s.coffee.sips === 0,        // as many coffees as you like, one cup at a time
        label: () => ({ text: s.coffee.latte ? 'Get another latte' : 'Get in line for a latte' }),
        use: () => this.startBusy('Waiting in line…', 4, 'phone', () => this.gotCoffee('latte')),
      },
      {
        pos: P.espresso, radius: 1.7, floor: 1,
        enabled: () => s.coffee.sips === 0,
        label: () => ({ text: s.coffee.espresso ? 'Pull another shot' : 'Pull an espresso shot' }),
        use: () => this.startBusy('Pulling a shot…', 2.5, null, () => this.gotCoffee('espresso')),
      },
      call(0, P.callG),
      call(1, P.callF2),
      ...this.level.hideSpots.map((spot) => ({
        pos: spot.use, radius: spot.radius, floor: spot.floor,
        enabled: () => !this.player.hidden,
        label: () => ({ text: spot.label }),
        use: () => this.hide(spot),
      })),
      {
        zone: (p) => el.contains(p) && el.phase === 'idle' && el.doorsOpen,
        enabled: () => true,
        label: () => {
          const dest = el.floor === 0 ? 'Floor 2' : 'the Lobby';
          const t = el.departIn;
          return { text: t != null ? `Go to ${dest} now · leaving in ${Math.ceil(t)} s` : `Go to ${dest}` };
        },
        use: () => el.go(el.floor === 0 ? 1 : 0),
      },
    ];
  }

  nearestInteractable() {
    const p = this.player.position;
    const f = this.player.floor;
    let best = null, bestD = Infinity;
    for (const it of this.interactables) {
      if (it.zone) {
        if (it.zone(p) && it.enabled()) return it;
        continue;
      }
      if (it.floor !== f) continue;
      const d = Math.hypot(p.x - it.pos.x, p.z - it.pos.z);
      if (d < it.radius && d < bestD) {
        if (it.enabled() || it.always) { best = it; bestD = d; }
      }
    }
    return best;
  }

  // A short wait (in line, at the counter). `pose` is the idle animation while waiting.
  startBusy(label, duration, pose, onDone) {
    this.busy = { label, duration, t: 0, onDone };
    this.player.playOnce('interact');
    this.player.idleStyle = pose;
  }

  gotCoffee(kind) {
    const c = this.state.coffee;
    this.player.cup.visible = true;
    const firstOfKind = !c[kind];
    c[kind] = true;
    c.count += 1;
    c.sips = kind === 'latte' ? 3 : Math.min(3, c.sips + 2);
    if (!c.obtained) {
      c.obtained = true;
      this.score('First coffee', 500);
      this.hint('coffee');
    } else if (firstOfKind) {
      this.score('Second kind of coffee', 750);   // latte + espresso, once
    } else {
      this.score('Refills', 100, true);
    }
    this.sfx.coin();
  }

  hide(spot) {
    this.player.hide(spot);
    this.camCtl.snap();
    this.sfx.tone(420, 0.12, 'triangle', 0.06);
    this.hint('hidden');
  }

  unhide() {
    if (!this.player.unhide()) { this.hud.pop("Someone's right outside", 'bad'); return; }
    this.camCtl.snap();
  }

  sip() {
    const c = this.state.coffee;
    if (c.sips <= 0 || this.sipCooldown > 0) return;
    c.sips -= 1;
    this.sipCooldown = 1.45;             // one sip at a time: the cup goes up, then back down
    this.boost = 8;
    this.score('Sips', 150, true);
    this.sfx.sip();
    this.player.sip();
  }

  score(label, pts, merge = false) {
    const existing = merge && this.events.find((e) => e.label === label);
    if (existing) { existing.pts += pts; existing.n += 1; } else this.events.push({ label, pts, n: 1 });
    const short = { Sips: 'sip', Refills: 'refill', 'Second kind of coffee': 'second coffee', 'Pulled into a conversation': 'chat', 'Slipped away': 'slipped away' }[label] || label.toLowerCase();
    this.hud.pop(`${pts > 0 ? '+' : ''}${pts} ${short}`, pts < 0 ? 'bad' : '');
  }

  hint(id, text = HINTS[id]) {
    if (!this.hintsOn || this.seenHints.has(id)) return;
    this.seenHints.add(id);
    this.hud.text('Sam', text);
    this.sfx.buzz();
  }

  // ---------- Goal tracker ----------
  goal() {
    const P = this.level.points;
    const Z = this.level.zones;
    const p = this.player.position;
    const f = this.player.floor;
    const s = this.state;
    if (!s.coffee.obtained) {
      return f === 0
        ? { title: 'Get a coffee', sub: 'Lobby café', pt: P.cafe }
        : { title: 'Get a coffee', sub: 'Kitchen espresso', pt: P.espresso };
    }
    const title = 'Go to Meeting 2B';
    const el = this.level.elevator;
    if (Z.inCab(p)) {
      if (el.moving) return { title, sub: el.target === 1 ? 'Going up…' : 'Going down…', pt: P.meeting };
      if (f === 0) return { title, sub: 'Wait, or press Space to go up', pt: P.meeting };
    }
    if (f === 0) {
      if (Z.stairWalkway(p)) return { title, sub: 'The stairs start at the far end', pt: P.rampBottom };
      if (Z.stairwell(p)) return { title, sub: 'Up the stairs', pt: P.rampTop };
      if (Z.service(p)) return { title, sub: 'Service corridor to the stairs', pt: P.eastDoor };
      if (Z.secure(p) || (p.z < 11 && p.x < 26)) return { title, sub: 'Elevator to Floor 2', pt: P.elevatorLobby };
      return s.hasBadge
        ? { title, sub: 'Through the turnstiles', pt: P.turnstiles }
        : { title, sub: 'You need a way past the turnstiles', pt: P.reception };
    }
    if (Z.stairwell(p)) return { title, sub: 'Stair exit, straight ahead', pt: P.stairExit };
    if (Z.meeting(p) || p.x < 9) return { title, sub: 'Floor 2', pt: P.meeting };
    return { title, sub: 'Far corner, across the office', pt: P.meetingDoor };
  }

  // ---------- Clock ----------
  clockText() {
    const gs = this.elapsed * GAME_SECONDS_PER_REAL;
    const total = START_MIN * 60 + gs;
    const h = Math.floor(total / 3600), m = Math.floor((total % 3600) / 60);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }

  // ---------- Main update ----------
  update(dt) {
    if (this.over) return;
    const input = this.input;
    const s = this.state;
    this.elapsed += dt;
    this.dt = dt;
    const p = this.player.position;

    // Stats for the tutorial
    if (input.forward) this.stats.moved = true;
    if (input.left || input.right) this.stats.turned = true;
    if (input.aboutFace) this.stats.aboutFaced = true;
    if (this.player.hurrying) this.stats.hurried = true;
    if (input.crouch) this.stats.crouched = true;

    // Busy actions (waiting in line, etc.) lock movement; moving away cancels them.
    // Elevator car moves first; a rider is carried with it (no teleports, no black screen).
    const el = this.level.elevator;
    const ev = el.update(dt, p, this.level.landingDoors);
    if (ev.arrived) { this.sfx.ding(); if (ev.inside && el.floor === 1) this.hint('floor2'); }
    if (ev.inside && el.phase === 'idle' && el.doorsOpen && el.floor === 0) this.hint('elevator');
    // The doors opening for you (not with you inside): sometimes Gary is already in there.
    if (el.doorsOpen && !this.elDoorsWere && !ev.inside) this.stealth?.elevatorArrived();
    this.elDoorsWere = el.doorsOpen;
    const rideY = ev.inside && el.moving ? el.y : null;
    let canMove = true;
    if (this.busy) {
      if (input.forward || input.aboutFace) {
        this.busy = null;
        this.player.idleStyle = null;
        this.hud.pop('Cancelled', 'bad');
      } else {
        canMove = false;
        this.busy.t += dt;
        if (this.busy.t >= this.busy.duration) { const done = this.busy.onDone; this.busy = null; this.player.idleStyle = null; this.player.playOnce('interact'); done(); }
      }
    }

    // Stuck in a conversation: Space politely excuses you a little sooner.
    const st = this.stealth;
    let actionUsed = false;
    if (st?.conversation) {
      canMove = false;
      if (input.action) { st.excuse(); this.hud.pop('"Sorry, I have a call…"'); actionUsed = true; }
    }
    // Hidden: stay put until Space (or walking) steps you out.
    if (this.player.hidden) {
      canMove = false;
      if (input.action || input.forwardPressed || input.aboutFace) { this.unhide(); actionUsed = true; }
    }

    this.boost = Math.max(0, this.boost - dt);
    this.sipCooldown = Math.max(0, this.sipCooldown - dt);
    if (!this.player.hidden) this.player.update(dt, input, { canMove, speedMul: this.boost > 0 ? 1.15 : 1, rideY });

    // Coworkers: patrols, sight and suspicion, coming over, conversations.
    if (st) {
      const ev = {};
      st.update(dt, {
        pos: this.player.position, crouching: this.player.crouching || this.player.hidden?.pose === 'crouch',
        hurrying: this.player.hurrying, hidden: !!this.player.hidden, lurk: this.player.hidden?.use, blending: !!this.busy,
        riding: this.level.zones.inCab(p) && el.busy, active: !this.over,
      }, ev);
      if (ev.noticed) this.hint('noticed', `Uh oh, ${ev.noticed.def.name} spotted you. Get out of sight, or press C to crouch.`);
      if (ev.spotted) { this.hud.pop(`${ev.spotted.def.name} wants a word!`, 'bad'); this.sfx.deny(); }
      if (ev.slipped) { this.score('Slipped away', 100, true); this.hint('slipped'); }
      if (ev.riderSeen) this.hint('rider');
      if (ev.caught) {
        const cw = ev.caught;
        this.conversations += 1;
        this.lastTalker = cw.def.name;
        this.score('Pulled into a conversation', -300, true);
        if (this.busy) { this.busy = null; }
        this.player.crouching = false;
        this.player.sipT = 0;
        // Turn to face them (the short way round, cancelling any about-face in progress).
        const face = Math.atan2(-(cw.pos.x - p.x), -(cw.pos.z - p.z));
        const pl = this.player;
        pl.turnAnim = null;
        pl.yaw += Math.atan2(Math.sin(face - pl.yaw), Math.cos(face - pl.yaw));
        pl.prevYaw = pl.yaw;
        pl.idleStyle = 'talk';
        this.hint('stuck');
      }
      // Caught this very step: nothing else happens with this step's keys.
      if (ev.caught || st.conversation) { canMove = false; this.actionBuffer = 0; actionUsed = true; }
      if (ev.released) {
        this.player.idleStyle = null;
        this.hud.pop('Free!', 'good');
        this.hint('xray');
      }
    }
    // Move the car's colliders only after the rider has moved, so the two never overlap mid-step.
    if (el.dy !== 0) el.placeColliders();

    // Spilling coffee while hurrying
    if (this.player.hurrying && s.coffee.sips > 0) {
      this.spillT += dt;
      if (this.spillT > 2.5) {
        this.spillT = 0;
        s.coffee.sips -= 1;
        this.hud.pop('Spilled a sip', 'bad');
        this.sfx.spill();
        this.hint('spill');
      }
    } else {
      this.spillT = Math.max(0, this.spillT - dt);
    }

    // Space: use the thing in front of you, otherwise sip.
    const near = !this.busy && canMove ? this.nearestInteractable() : null;
    this.actionBuffer = input.action && !actionUsed ? ACTION_BUFFER : Math.max(0, this.actionBuffer - dt);
    if (this.actionBuffer > 0 && !this.busy && canMove) {
      if (near && near.enabled()) { near.use(); this.actionBuffer = 0; }
      else if (s.coffee.sips > 0 && input.action && !actionUsed) { this.sip(); this.actionBuffer = 0; }
    }

    // Stair exit: wait by it for a few seconds and someone steps out, holding it open.
    if (s.smokerOpen) {
      this.smokeOpenT -= dt;
      if (this.smokeOpenT <= 0) { s.smokerOpen = false; this.smokeIn = SMOKE_WAIT; }
    } else if (this.level.zones.stairDoorInside(p)) {
      if (!this.player.moving) this.player.idleStyle = 'arms';
      this.smokeIn -= dt;
      if (this.smokeIn <= 0) {
        s.smokerOpen = true;
        this.stealth?.startSmoker(p.x);
        this.smokeOpenT = SMOKE_OPEN;
        this.hud.pop("Door's open, go!", 'good');
      }
    } else {
      this.smokeIn = SMOKE_WAIT;
    }
    if (this.player.idleStyle === 'arms' && (s.smokerOpen || !this.level.zones.stairDoorInside(p))) this.player.idleStyle = null;
    const pp = this.player.position;
    this._doorProbe.set(pp.x, pp.y + 0.85, pp.z);
    for (const d of this.level.doors) {
      d.update(dt, this._doorProbe);
      if (d.justOpened && Math.abs(d.base.y - pp.y - 1.2) < 2) this.sfx.door(1 - Math.hypot(d.base.x - pp.x, d.base.z - pp.z) / 12);
    }

    // (Positions only change in the physics step after this update, so compare with the last one.)
    if (this.lastPos) this.checkRoutes(this.lastPos, pp);
    (this.lastPos ||= new THREE.Vector3()).copy(pp);

    // Situational hints
    const Z = this.level.zones;
    if (this.elapsed > 1.2) this.hint('start');
    if (Z.turnstileFront(pp) && !s.hasBadge) this.hint('turnstile');
    if (Z.stairDoorInside(pp) && !s.smokerOpen) this.hint('stairdoor');
    if (this.elapsed > 50 && !this.stats.xray) this.hint('xray');
    if (this.elapsed > WARN_AT) this.hint('warn');
    if (this.elapsed > ROUND_SECONDS) this.hint('late');
    // Just before nine, Monica heads into the call.
    if (this.elapsed > ROUND_SECONDS - 2 && !this.called) { this.called = true; this.stealth?.callToMeeting(); }

    // Floor change → move the shadow light
    if (this.player.floor !== this.lastFloor) { this.lastFloor = this.player.floor; this.onFloorChange(this.lastFloor); }

    // Arrival
    if (Z.meeting(pp)) {
      if (s.coffee.obtained) { this.finish(); return; }
      if (!this.inMeetingNoCoffee) { this.hint('nocoffee'); this.hud.pop('Coffee first!', 'bad'); }
      this.inMeetingNoCoffee = true;
    } else this.inMeetingNoCoffee = false;

    // X-ray view
    const xr = input.xray;
    if (xr) this.stats.xray = true;
    this.setXray(xr);

    this.near = near;
  }

  // Route bonuses: sneaky ways past the badge doors, scored once each as you cross the line.
  route(id, label, pts) {
    if (this.routes.has(id)) return;
    this.routes.add(id);
    this.score(label, pts);
    this.sfx.coin();
  }

  checkRoutes(a, b) {
    const s = this.state;
    const ground = b.y < 2, f2 = b.y > 2;
    // Through the turnstiles on Ben's badge (no pass of your own).
    if (ground && a.z >= 11 && b.z < 11 && b.x > 12.1 && b.x < 13.9 && s.gateOpen === 13 && !s.hasBadge) {
      this.route('tailgate', 'Tailgated the turnstiles', 250);
      this.hint('tailgate');
    }
    // Through the propped mailroom door into the service corridor.
    if (ground && a.x <= 26 && b.x > 26 && b.z > 20.3 && b.z < 22.4) this.route('mailroom', 'Mailroom shortcut', 150);
    // Up the stairs and in behind Rita.
    if (f2 && a.z <= 9 && b.z > 9 && b.x > 20.5 && b.x < 22.5 && s.smokerOpen) this.route('rita', 'Slipped in behind Rita', 250);
  }

  setXray(on) {
    if (this.xrayOn === on) return;
    this.xrayOn = on;
    // Opacity and depth writes only: no shader recompiles, so no hitch.
    this.builder.xrayMats.forEach((m) => {
      m.opacity = on ? 0.14 : 1;
      m.depthWrite = !on;
    });
    this.marker.material.depthTest = !on;
    this.hud.setXray(on);
    this.stealth?.setXray(on);
    this.beacons?.setXray(on);
  }

  // Called once per rendered frame (not per physics step).
  updateHud(dt) {
    const near = this.over ? null : this.near;
    const s = this.state;
    const g = this.goal();
    const p = this.player.renderPos;
    // Arrow relative to the camera's heading so "up" always means "ahead on screen".
    const cy = this.camCtl.yaw;
    const fx = -Math.sin(cy), fz = -Math.cos(cy);
    const rx = Math.cos(cy), rz = -Math.sin(cy);
    const dx = g.pt.x - p.x, dz = g.pt.z - p.z;
    const angle = Math.atan2(dx * rx + dz * rz, dx * fx + dz * fz);
    const sameFloor = (g.pt.y > 2 ? 1 : 0) === this.player.floor;
    this.hud.setGoal(g.title, g.sub, angle, sameFloor ? Math.hypot(dx, dz) : null);
    this.marker.visible = sameFloor && Math.hypot(dx, dz) > 5;   // hide it once you're there
    this.marker.position.set(g.pt.x, g.pt.y + 2.4 + Math.sin(this.elapsed * 2.5) * 0.15, g.pt.z);
    this.marker.rotation.y += dt * 1.8;

    // Clock
    const late = this.elapsed > ROUND_SECONDS;
    const warn = this.elapsed > WARN_AT;
    let sub = 'Call at 09:00';
    if (late) {
      const ls = Math.floor((this.elapsed - ROUND_SECONDS) * GAME_SECONDS_PER_REAL);
      sub = `Late by ${Math.floor(ls / 60)}m ${String(ls % 60).padStart(2, '0')}s`;
    }
    this.hud.setClock(this.clockText(), sub, late ? 'late' : warn ? 'warn' : '');
    this.hud.setItems({ floor: this.player.floor === 0 ? 'Lobby' : 'Floor 2', badge: s.hasBadge, coffee: s.coffee.obtained, sips: s.coffee.sips });

    // Prompt: busy > interaction > sip > tutorial
    const el = this.level.elevator;
    const Z = this.level.zones;
    const talk = this.stealth?.conversation;
    if (talk) {
      const total = talk.cw.def.talk;
      this.hud.setPrompt(`${talk.cw.def.name} is talking · tap Space to excuse yourself`, { key: 'Space', progress: 1 - this.stealth.remaining / total });
    } else if (this.player.hidden) {
      this.hud.setPrompt(`Hidden · ${this.player.hidden.name}. Space to step out`, { key: 'Space' });
    } else if (this.busy) {
      this.hud.setPrompt(this.busy.label, { key: null, progress: this.busy.t / this.busy.duration });
    } else if (el.busy && Z.inCab(p)) {
      const text = el.moving ? (el.target === 1 ? 'Going up to Floor 2…' : 'Going down to the Lobby…') : 'Doors closing…';
      this.hud.setPrompt(text, { key: null, progress: el.progress ?? 0 });
    } else if (Z.stairDoorInside(p) && this.level.stairDoor.open < 0.5) {
      const n = Math.max(1, Math.ceil(this.smokeIn));
      this.hud.setPrompt(`Badge door · someone comes through in ${n} s`, { key: null, progress: 1 - this.smokeIn / SMOKE_WAIT });
    } else if (near) {
      const l = near.label();
      this.hud.setPrompt(l.text, { key: l.key === null ? null : 'Space' });
    } else if (this.inMeetingNoCoffee) {
      this.hud.setPrompt('Go get a coffee first', { key: null });
    } else if (this.hintsOn && this.tut.i < TUTORIAL.length) {
      const step = TUTORIAL[this.tut.i];
      this.tut.t += dt;
      if (step.done(this) || this.tut.t > (step.maxTime || 9)) { this.tut.i += 1; this.tut.t = 0; }
      this.hud.setPrompt(step.text, { key: step.key, tutorial: true });
    } else if (s.coffee.sips > 0 && this.elapsed < 120 && this.events.every((ev) => ev.label !== 'Sips')) {
      this.hud.setPrompt('Sip your coffee', { key: 'Space' });
    } else {
      this.hud.setPrompt(null);
    }
  }

  finish() {
    this.over = true;
    this.inMeeting = true;
    this.player.moving = false;
    const s = this.state;
    const late = Math.max(0, this.elapsed - ROUND_SECONDS);
    this.player.idleStyle = late > 0 ? 'idle' : 'cheer';
    this.hud.setPrompt(null);
    // Walked in through the back door (the front door is on the east wall, at x 9).
    const pe = this.player.position;
    if (pe.z < 18 && pe.x < 8) this.score('Back door into 2B', 300);
    const left = Math.max(0, ROUND_SECONDS - this.elapsed);
    const rows = [...this.events];
    const mmss = (real) => { const g = Math.floor(real * GAME_SECONDS_PER_REAL); return `${Math.floor(g / 60)}m ${String(g % 60).padStart(2, '0')}s`; };
    if (left > 0) rows.push({ label: `Time to spare (${mmss(left)})`, pts: Math.round(left * 20), n: 1 });
    if (late > 0) rows.push({ label: `Late by ${mmss(late)}`, pts: -Math.round(late * 40), n: 1 });
    if (this.conversations === 0) rows.push({ label: 'Never pulled into a conversation', pts: 2000, n: 1 });
    const total = Math.max(0, rows.reduce((a, r) => a + r.pts, 0));
    let cups;
    if (this.conversations === 0 && s.coffee.latte && s.coffee.espresso && late === 0) cups = 5;
    else cups = total >= 4000 ? 4 : total >= 2800 ? 3 : total >= 1500 ? 2 : 1;
    if (late > 0) cups = Math.min(cups, 2);
    if (late > 0) this.sfx.deny(); else this.sfx.win();
    // The people in 2B react (see Stealth.react); the score card follows a few seconds later.
    const scene = this.stealth?.react({ late: late > 0, lateBy: late, cups, lastTalker: this.lastTalker, chats: this.conversations });
    this.onEnd({
      arrived: this.clockText(), late: late > 0, rows, total, cups, rating: RATINGS[cups - 1], quote: scene?.quote,
    });
  }
}

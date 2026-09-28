import * as THREE from 'three';
import { F2 } from '../world/level1.js';

export const ROUND_SECONDS = 360;          // 08:52 → 09:00 in real seconds (6 minutes)
const GAME_SECONDS_PER_REAL = 480 / ROUND_SECONDS;
const START_MIN = 8 * 60 + 52;

const RATINGS = ['Decaf', 'Drip', 'Americano', 'Flat White', 'Silent Commuter'];
const RIDING = new Set(['closing', 'moving', 'arriving']);
const ACTION_BUFFER = 0.15; // a Space press is remembered briefly, so pressing a hair early still counts

const HINTS = {
  start: "Call's at 9:00 in Meeting 2B, Floor 2. Don't show up without coffee!",
  turnstile: "No badge again? Ask reception for a visitor pass. Or sneak round through the mailroom, that door is always propped open.",
  visitor: 'Visitor pass works on the turnstiles and the elevators. Not on the doors upstairs, though.',
  coffee: 'Nice. Press Space to sip, every sip is points and a little speed boost.',
  spill: 'Careful! Hurrying spills your coffee.',
  stairdoor: 'That door needs a badge. People step out for a smoke every so often. Wait by the door and slip in after them.',
  meetingdoor: "2B's door is badge only. The kitchen has a back door straight into 2B.",
  nocoffee: "You can't walk in empty-handed. Coffee first!",
  xray: 'Pro tip: hold X to see through the walls.',
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
  constructor({ level, player, camCtl, input, hud, sfx, builder, marker, onFloorChange, onEnd }) {
    Object.assign(this, { level, player, camCtl, input, hud, sfx, builder, marker, onFloorChange, onEnd });
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
    s.elevator = { cabFloor: 0, doorsOpen: false, phase: 'idle', timer: 0, target: 0, idle: 0 };
    s.coffee = { obtained: false, latte: false, espresso: false, sips: 0, count: 0 };
    this.elapsed = 0;
    this.smokerT = 12;
    this.busy = null;
    this.actionBuffer = 0;
    this.sipCooldown = 0;
    this.boost = 0;
    this.spillT = 0;
    this.seenHints = new Set();
    this.events = [];
    this.conversations = 0;
    this.cameFromKitchen = false;
    this.inMeetingNoCoffee = false;
    this.tut = { i: 0, t: 0 };
    this.stats = { moved: false, turned: false, aboutFaced: false, hurried: false, crouched: false, xray: false };
    this.over = false;
    this.lastFloor = 0;
    this.player.crouching = false;
    this.player.teleport(this.level.spawn, this.level.spawnYaw);
    this.camCtl.snap();
    this.hud.clearTexts();
    this.hud.fade(false);
    this.onFloorChange(0);
  }

  // ---------- Things you can use with Space ----------
  buildInteractables() {
    const P = this.level.points;
    const s = this.state;
    const call = (floor, pt) => ({
      pos: pt, radius: 1.9, floor,
      enabled: () => !(s.elevator.cabFloor === floor && s.elevator.doorsOpen) && !RIDING.has(s.elevator.phase),
      label: () => (s.elevator.phase === 'coming' && s.elevator.target === floor
        ? { text: `Elevator on its way… ${Math.ceil(s.elevator.timer)} s`, key: null }
        : { text: 'Call elevator' }),
      use: () => this.callElevator(floor),
    });
    return [
      {
        pos: P.reception, radius: 1.8, floor: 0,
        enabled: () => !s.hasBadge,
        label: () => ({ text: 'Ask for a visitor pass' }),
        use: () => this.startBusy('Waiting at reception…', 5, () => {
          s.hasBadge = true;
          this.score('Visitor pass', 150);
          this.sfx.beep();
          this.hint('visitor');
        }),
      },
      {
        pos: P.cafe, radius: 2, floor: 0,
        enabled: () => !s.coffee.latte,
        label: () => ({ text: 'Get in line for a latte' }),
        use: () => this.startBusy('Waiting in line…', 6, () => this.gotCoffee('latte')),
      },
      {
        pos: P.espresso, radius: 1.7, floor: 1,
        enabled: () => !s.coffee.espresso,
        label: () => ({ text: 'Pull an espresso shot' }),
        use: () => this.startBusy('Pulling a shot…', 2.5, () => this.gotCoffee('espresso')),
      },
      call(0, P.callG),
      call(1, P.callF2),
      {
        zone: (p) => this.level.zones.inCab(p) && this.player.floor === s.elevator.cabFloor,
        enabled: () => s.elevator.phase === 'idle',
        label: () => ({ text: s.elevator.cabFloor === 0 ? 'Ride up to Floor 2' : 'Ride down to the Lobby' }),
        use: () => this.ride(),
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
        // Show the "on its way" status even while the call is disabled-for-use.
        if (it.enabled() || this.state.elevator.phase === 'coming') { best = it; bestD = d; }
      }
    }
    return best;
  }

  startBusy(label, duration, onDone) { this.busy = { label, duration, t: 0, onDone }; }

  gotCoffee(kind) {
    const c = this.state.coffee;
    c[kind] = true;
    c.count += 1;
    c.sips = kind === 'latte' ? 3 : Math.min(3, c.sips + 1);
    if (!c.obtained) {
      c.obtained = true;
      this.score('First coffee', 500);
      this.hint('coffee');
    } else {
      this.score('Second coffee', 750);
    }
    this.sfx.coin();
  }

  sip() {
    const c = this.state.coffee;
    if (c.sips <= 0 || this.sipCooldown > 0) return;
    c.sips -= 1;
    this.sipCooldown = 0.8;
    this.boost = 8;
    this.score('Sips', 150, true);
    this.sfx.sip();
  }

  score(label, pts, merge = false) {
    const existing = merge && this.events.find((e) => e.label === label);
    if (existing) { existing.pts += pts; existing.n += 1; } else this.events.push({ label, pts, n: 1 });
    this.hud.pop(`+${pts} ${label === 'Sips' ? 'sip' : label.toLowerCase()}`);
  }

  hint(id) {
    if (!this.hintsOn || this.seenHints.has(id)) return;
    this.seenHints.add(id);
    this.hud.text('Sam', HINTS[id]);
    this.sfx.buzz();
  }

  // ---------- Elevator ----------
  callElevator(floor) {
    const e = this.state.elevator;
    if (e.cabFloor === floor) {
      e.phase = 'opening'; e.timer = 0.6; e.target = floor;
    } else {
      e.phase = 'coming'; e.timer = 5 + Math.random() * 7; e.target = floor;
    }
    this.sfx.beep();
  }

  ride() {
    const e = this.state.elevator;
    e.doorsOpen = false;
    e.phase = 'closing';
    e.timer = 1.1;
  }

  updateElevator(dt) {
    const e = this.state.elevator;
    const p = this.player.position;
    e.timer -= dt;
    switch (e.phase) {
      case 'coming':
      case 'opening':
        if (e.timer <= 0) {
          e.cabFloor = e.target; e.doorsOpen = true; e.phase = 'idle'; e.idle = 8; this.sfx.ding();
        }
        break;
      case 'closing':
        if (e.timer <= 0) { e.phase = 'moving'; e.timer = 1.5; this.hud.fade(true); }
        break;
      case 'moving':
        if (e.timer <= 0.4 && !e.moved) {
          const up = e.cabFloor === 0;
          const dest = new THREE.Vector3(p.x, up ? F2 : 0, p.z);
          this.player.teleport(dest, this.player.yaw);
          e.cabFloor = up ? 1 : 0;
          e.moved = true;
          this.camCtl.snap();
        }
        if (e.timer <= 0) { e.phase = 'arriving'; e.timer = 0.5; e.moved = false; this.hud.fade(false); }
        break;
      case 'arriving':
        if (e.timer <= 0) { e.doorsOpen = true; e.phase = 'idle'; e.idle = 8; this.sfx.ding(); }
        break;
      default:
        if (e.doorsOpen) {
          const nearDoor = Math.abs(p.x - 12) < 1.6 && Math.abs(p.z - 4) < 1.2;
          const inside = this.level.zones.inCab(p) && this.player.floor === e.cabFloor;
          if (!inside && !nearDoor) e.idle -= dt;
          if (e.idle <= 0) e.doorsOpen = false;
        }
    }
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
    if (f === 0) {
      if (Z.stairwell(p)) return { title, sub: 'Up the stairs', pt: P.rampTop };
      if (Z.service(p)) return { title, sub: 'Service corridor to the stairs', pt: P.eastDoor };
      if (Z.inCab(p) && s.elevator.phase === 'idle') return { title, sub: 'Press Space to ride up', pt: P.meeting };
      if (Z.secure(p) || (p.z < 11 && p.x < 26)) return { title, sub: 'Elevators to Floor 2', pt: P.elevatorLobby };
      return s.hasBadge
        ? { title, sub: 'Through the turnstiles', pt: P.turnstiles }
        : { title, sub: 'You need a way past the turnstiles', pt: P.reception };
    }
    if (Z.stairwell(p)) return { title, sub: 'Stair exit', pt: P.stairExit };
    if (Z.kitchen(p) || Z.meeting(p)) return { title, sub: 'Floor 2', pt: P.meeting };
    return { title, sub: 'Via the kitchen', pt: P.kitchenDoor };
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
    const e = s.elevator;
    const riding = RIDING.has(e.phase) && this.level.zones.inCab(p);
    let canMove = !riding;
    if (this.busy) {
      if (input.forward || input.aboutFace) {
        this.busy = null;
        this.hud.pop('Cancelled', 'bad');
      } else {
        canMove = false;
        this.busy.t += dt;
        if (this.busy.t >= this.busy.duration) { const done = this.busy.onDone; this.busy = null; done(); }
      }
    }

    this.boost = Math.max(0, this.boost - dt);
    this.sipCooldown = Math.max(0, this.sipCooldown - dt);
    this.player.update(dt, input, { canMove, speedMul: this.boost > 0 ? 1.15 : 1 });

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
    this.actionBuffer = input.action ? ACTION_BUFFER : Math.max(0, this.actionBuffer - dt);
    if (this.actionBuffer > 0 && !this.busy && canMove) {
      if (near && near.enabled()) { near.use(); this.actionBuffer = 0; }
      else if (s.coffee.sips > 0 && input.action) { this.sip(); this.actionBuffer = 0; }
    }

    // Doors, elevator, smoker cycle
    this.updateElevator(dt);
    this.smokerT += dt;
    const cyc = this.smokerT % 40;
    const wasOpen = s.smokerOpen;
    s.smokerOpen = cyc > 35.5;
    if (s.smokerOpen && !wasOpen && this.level.zones.stairDoorInside(p)) this.hud.pop("Door's open, go!", 'good');
    const pp = this.player.position;
    this._doorProbe.set(pp.x, pp.y + 0.85, pp.z);
    for (const d of this.level.doors) d.update(dt, this._doorProbe);

    // Situational hints
    const Z = this.level.zones;
    if (this.elapsed > 1.2) this.hint('start');
    if (Z.turnstileFront(pp) && !s.hasBadge) this.hint('turnstile');
    if (Z.stairDoorInside(pp) && !s.smokerOpen) this.hint('stairdoor');
    if (Z.meetingDoorOutside(pp)) this.hint('meetingdoor');
    if (this.elapsed > 50 && !this.stats.xray) this.hint('xray');
    const warnAt = ROUND_SECONDS - 2 * 45;
    if (this.elapsed > warnAt) this.hint('warn');
    if (this.elapsed > ROUND_SECONDS) this.hint('late');

    // Floor change → move the shadow light
    if (this.player.floor !== this.lastFloor) { this.lastFloor = this.player.floor; this.onFloorChange(this.lastFloor); }

    // Route tracking for the back-door bonus
    if (Z.kitchen(pp)) this.cameFromKitchen = true;
    else if (this.player.floor === 0 || pp.x < 24 || pp.z < 9) this.cameFromKitchen = false;

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
    this.marker.visible = sameFloor;
    this.marker.position.set(g.pt.x, g.pt.y + 2.4 + Math.sin(this.elapsed * 2.5) * 0.15, g.pt.z);
    this.marker.rotation.y += dt * 1.8;

    // Clock
    const late = this.elapsed > ROUND_SECONDS;
    const warn = this.elapsed > ROUND_SECONDS - 2 * 45;
    let sub = 'Call at 09:00';
    if (late) {
      const ls = Math.floor((this.elapsed - ROUND_SECONDS) * GAME_SECONDS_PER_REAL);
      sub = `Late by ${Math.floor(ls / 60)}m ${String(ls % 60).padStart(2, '0')}s`;
    }
    this.hud.setClock(this.clockText(), sub, late ? 'late' : warn ? 'warn' : '');
    this.hud.setItems({ floor: this.player.floor === 0 ? 'Lobby' : 'Floor 2', badge: s.hasBadge, coffee: s.coffee.obtained, sips: s.coffee.sips });

    // Prompt: busy > interaction > sip > tutorial
    if (this.busy) {
      this.hud.setPrompt(this.busy.label, { key: null, progress: this.busy.t / this.busy.duration });
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
    const s = this.state;
    const late = Math.max(0, this.elapsed - ROUND_SECONDS);
    const left = Math.max(0, ROUND_SECONDS - this.elapsed);
    const rows = [...this.events];
    if (this.cameFromKitchen) rows.push({ label: 'Route: kitchen back door', pts: 300, n: 1 });
    const mmss = (real) => { const g = Math.floor(real * GAME_SECONDS_PER_REAL); return `${Math.floor(g / 60)}m ${String(g % 60).padStart(2, '0')}s`; };
    if (left > 0) rows.push({ label: `Time to spare (${mmss(left)})`, pts: Math.round(left * 10), n: 1 });
    if (late > 0) rows.push({ label: `Late by ${mmss(late)}`, pts: -Math.round(late * 20), n: 1 });
    if (this.conversations === 0) rows.push({ label: 'Never pulled into a conversation', pts: 2000, n: 1 });
    const total = Math.max(0, rows.reduce((a, r) => a + r.pts, 0));
    let cups;
    if (this.conversations === 0 && s.coffee.latte && s.coffee.espresso && late === 0) cups = 5;
    else cups = total >= 4000 ? 4 : total >= 2800 ? 3 : total >= 1500 ? 2 : 1;
    if (late > 0) cups = Math.min(cups, 2);
    this.sfx.win();
    this.onEnd({
      arrived: this.clockText(), late: late > 0, rows, total, cups, rating: RATINGS[cups - 1],
    });
  }
}

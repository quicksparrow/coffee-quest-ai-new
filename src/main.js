import * as THREE from 'three';
import { Input } from './core/input.js';
import { Sfx } from './core/audio.js';
import { Game } from './core/game.js';
import { Builder } from './world/builder.js';
import { buildLevel, F2 } from './world/level1.js';
import { Player } from './actors/player.js';
import { loadCharacterAssets, Character, KINDS, NAMES, PLAYER_LOOKS, look as lookOf } from './actors/character.js';
import { FollowCamera } from './systems/camera.js';
import { Hud } from './ui/hud.js';
import { nameTag } from './ui/sprites.js';
import { Stealth, RAY_GROUPS } from './systems/stealth.js';
import { Beacons } from './systems/beacons.js';

// Start downloading the physics engine right away, in parallel with everything else.
// It is the largest file, lives in its own chunk, and stays cached between game updates.
const rapierReady = import('@dimforge/rapier3d');
let charError = null;
const charactersReady = loadCharacterAssets('./models/').catch((err) => { console.error(err); charError = err; return null; });

const $ = (id) => document.getElementById(id);
const STEP = 1 / 60;       // fixed simulation step
const MAX_STEPS = 5;       // never try to catch up more than this per frame
const DEBUG = import.meta.env.DEV || new URLSearchParams(location.search).has('debug');

// ---------- Keyboard notice: phones, tablets and tiny windows ----------
function needsKeyboardNotice() {
  const touchOnly = matchMedia('(pointer: coarse)').matches && !matchMedia('(any-pointer: fine)').matches;
  const tiny = window.innerWidth < 700 || window.innerHeight < 420;
  return touchOnly || tiny;
}
function refreshNotice() {
  const notice = needsKeyboardNotice();
  $('start-notice').hidden = !notice;
  $('start-ready').hidden = notice;
}
refreshNotice();
window.addEventListener('resize', refreshNotice);
// Embedded pages (iframes) only receive keys once they have focus.
const refreshFocusTip = () => { $('focus-tip').hidden = document.hasFocus(); };
refreshFocusTip();
window.addEventListener('focus', refreshFocusTip);
window.addEventListener('blur', refreshFocusTip);

// Floating name tag for the lobby staff (a sprite that always faces the camera).
async function boot() {
  // ---------- Renderer, scene, lights ----------
  const canvas = $('game');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;

  // Adaptive resolution: start sharp, drop the render scale if the frame rate sags,
  // and never climb back to a scale that already proved too slow on this machine.
  const quality = {
    ratio: Math.min(window.devicePixelRatio || 1, 1.5),
    max: Math.min(window.devicePixelRatio || 1, 2),
    min: 0.6, acc: 0, frames: 0, calm: 0,
  };
  renderer.setPixelRatio(quality.ratio);
  renderer.setSize(window.innerWidth, window.innerHeight);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xc9d6e3);
  // A 0.1 m near plane keeps depth precision high enough that floors and decals never flicker.
  const camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.1, 90);

  scene.add(new THREE.HemisphereLight(0xf4f7fb, 0x9aa0a8, 1.7));
  // "Sun through the windows": one shadow light that follows the player and sits just under
  // the ceiling of their floor, so the floor above never shades the one below.
  const sun = new THREE.DirectionalLight(0xfff4e6, 1.9);
  sun.castShadow = true;
  const SHADOW_HALF = 13;
  sun.shadow.mapSize.set(1024, 1024);
  Object.assign(sun.shadow.camera, { left: -SHADOW_HALF, right: SHADOW_HALF, top: SHADOW_HALF, bottom: -SHADOW_HALF, near: 0.05 });
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 0.02;
  scene.add(sun, sun.target);
  const sunDir = new THREE.Vector3(0.35, -1, 0.25).normalize();
  const texel = (SHADOW_HALF * 2) / 1024;
  let sunFloor = -1;
  const placeSun = (floor, x, z) => {
    const y = floor === 1 ? F2 : 0;
    const up = floor === 1 ? 6 : 3.5;                 // start the shadow frustum under the ceiling
    // Snap to the shadow-map grid so shadow edges don't shimmer as the player walks.
    sun.target.position.set(Math.round(x / texel) * texel, y, Math.round(z / texel) * texel);
    sun.position.copy(sun.target.position).addScaledVector(sunDir, up / sunDir.y);
    if (floor !== sunFloor) {
      sun.shadow.camera.far = up / -sunDir.y + 1;
      sun.shadow.camera.updateProjectionMatrix();
      sunFloor = floor;
    }
  };

  // ---------- Physics + level ----------
  const tBoot = performance.now();
  const RAPIER = await rapierReady;
  const tRapier = performance.now();
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world.timestep = STEP;
  const builder = new Builder(scene, world, RAPIER);
  const state = {};
  const level = buildLevel(builder, state);
  level.state = state;
  builder.finalize();

  const player = new Player(scene, world, RAPIER, level.spawn, level.spawnYaw);
  level.seeThrough = builder.seeThrough;
  const camCtl = new FollowCamera(camera, world, RAPIER, { seeThrough: builder.seeThrough, groups: RAY_GROUPS });

  // ---------- Characters: Claire or Steven, plus the receptionist and barista ----------
  let charAssets = await charactersReady;
  const LOOK_KEY = 'coffee-quest-commuter';
  const look = { kind: 0 };                          // Claire (blonde) or Steven (black hair), always the same look
  try { const saved = Number(localStorage.getItem(LOOK_KEY)); if (saved === 0 || saved === 1) look.kind = saved; } catch { /* private mode */ }
  const choices = {};
  const npcs = [];
  if (charAssets) {
    try {
      KINDS.forEach((k) => { choices[k] = new Character(charAssets, k); });
    } catch (err) {
      console.error(err); charError = err; charAssets = null;
    }
  }
  if (charAssets) {
    // Lobby staff: a name tag, and they turn to greet you.
    const npc = (kind, x, z, yaw, name, role, l) => {
      const c = new Character(charAssets, kind);
      c.setLook(l);
      const g = new THREE.Group();
      g.position.set(x, 0, z);
      g.rotation.y = yaw;
      g.add(c.root);
      scene.add(g);
      const tag = nameTag(name, role);
      tag.position.set(x, 2.25, z);
      scene.add(tag);
      const n = { c, g, tag, homeYaw: yaw, greeted: false };
      npcs.push(n);
      return n;
    };
    level.receptionist = npc('woman', 3.5, 13.7, Math.PI, 'Dana', 'Reception', lookOf('White', 'Deep', 'Black'));
    level.barista = npc('man', 21, 21.4, 0, 'Leo', 'Barista', lookOf('Charcoal', 'Brown', 'Brown'));
  }
  const applyLook = () => {
    try { localStorage.setItem(LOOK_KEY, String(look.kind)); } catch { /* ignore */ }
    const c = choices[KINDS[look.kind]];
    if (!c) return;
    c.setLook(PLAYER_LOOKS[KINDS[look.kind]]);
    if (player.char !== c) player.setCharacter(c);
  };
  applyLook();

  // Coworkers with patrols, sight and conversations (see systems/stealth.js).
  let stealth = null;
  try {
    stealth = new Stealth({ scene, world, R: RAPIER, assets: charAssets, player, level });
  } catch (err) {
    console.error('Coworkers failed to start', err);
  }
  const beacons = new Beacons(scene, level, state);

  const marker = new THREE.Mesh(new THREE.OctahedronGeometry(0.28), new THREE.MeshBasicMaterial({ color: 0xd6a27c }));
  marker.renderOrder = 10;
  scene.add(marker);

  const input = new Input();
  const hud = new Hud();
  const sfx = new Sfx();

  // ---------- Screens ----------
  let mode = 'start'; // start | playing | paused | end
  let ready = false;  // keys are ignored until shaders are warm
  let acc = 0;        // simulation time not yet stepped
  let skipDelta = false;
  let dirty = true;   // outside of play we only redraw when something changed
  const showScreen = (id) => ['start', 'pause', 'end'].forEach((s) => { $(s).hidden = s !== id; });
  const pause = () => { if (mode === 'playing') { mode = 'paused'; showScreen('pause'); dirty = true; } };

  const game = new Game({
    level, player, camCtl, input, hud, sfx, builder, marker, stealth, beacons,
    onFloorChange: (floor) => placeSun(floor, player.renderPos.x, player.renderPos.z),
    onEnd: (r) => {
      mode = 'end';
      dirty = true;
      endBlend = 0;
      hud.setPrompt(null);
      hud.show(false);                 // the room reacts first, full screen
      $('end-eyebrow').textContent = `Arrived ${r.arrived}`;
      $('end-title').textContent = r.late ? 'Late, but you made it' : 'Right on time';
      $('end-line').textContent = r.quote || (r.late ? 'Everyone saw you walk in.' : 'Nobody suspects the coffee run.');
      $('end-rating').textContent = `${r.cups} cup${r.cups > 1 ? 's' : ''} · ${r.rating}`;
      const cup = (full) => `<svg class="cup${full ? ' full' : ''}" viewBox="0 0 40 40"><path class="body" d="M8 12 H28 L26 34 H10 Z"/><path class="handle" d="M28 16 C36 16 36 26 27 26"/></svg>`;
      $('end-cups').innerHTML = [1, 2, 3, 4, 5].map((i) => cup(i <= r.cups)).join('');
      $('end-breakdown').innerHTML = '';
      r.rows.forEach((row) => {
        const tr = document.createElement('tr');
        const label = ['Sips', 'Refills', 'Pulled into a conversation', 'Slipped away'].includes(row.label) ? `${row.label} (${row.n})` : row.label;
        tr.innerHTML = `<td></td><td class="${row.pts < 0 ? 'neg' : ''}">${row.pts > 0 ? '+' : ''}${row.pts.toLocaleString('en-US')}</td>`;
        tr.firstChild.textContent = label;
        $('end-breakdown').appendChild(tr);
      });
      $('end-score').textContent = r.total.toLocaleString('en-US');
      // Let the room react first (a few seconds of speech bubbles), then the score card.
      // (endCam shows the card once the reactions have played; this is only a fallback.)
      setTimeout(() => { if (mode === 'end') showEndCard(); }, 15000);
    },
  });

  // ---------- Character picker (start screen), keyboard only ----------
  const renderPicker = () => {
    $('opt-kind').innerHTML = KINDS.map((k, i) => `<span class="chipopt${i === look.kind ? ' on' : ''}">${NAMES[k]}</span>`).join('');
  };
  renderPicker();
  if (!charAssets) {
    // Keep the choice working and say what went wrong instead of silently hiding it.
    const note = $('char-error');
    note.textContent = `The 3D characters didn't load (${charError?.message || 'unknown error'}), so you'll play as a stand-in. Reloading the page usually fixes it.`;
    note.hidden = false;
  }
  const pickerKey = (code) => {
    if (['ArrowLeft', 'KeyA', 'ArrowRight', 'KeyD'].includes(code)) {
      look.kind = (look.kind + 1) % KINDS.length;
      applyLook();
    } else return;
    renderPicker();
  };
  // Start screen: the chosen commuter stands in the lobby facing the camera, framed to the
  // right of the picker; the lobby is the backdrop.
  const STAGE = new THREE.Vector3(level.spawn.x, 0, level.spawn.z - 3);
  player.teleport(STAGE, Math.PI);
  const selectCam = () => {
    const p = STAGE;
    camera.position.set(p.x - 0.35, 1.45, p.z + 3.1);
    camera.lookAt(p.x - 0.1, 1.0, p.z);
    const w = window.innerWidth, h = window.innerHeight;
    if (w > 720) camera.setViewOffset(w, h, -w * 0.2, 0, w, h); else camera.clearViewOffset();
  };

  const startGame = () => {
    sfx.unlock();
    camera.clearViewOffset();
    if (camera.fov !== 62) { camera.fov = 62; camera.updateProjectionMatrix(); }
    if (mode === 'start') player.teleport(level.spawn, level.spawnYaw);
    camCtl.snap();
    if (mode === 'end' || mode === 'paused') { game.reset(); resetNpcs(); }
    input.endFrame();                 // drop any keys pressed while a menu was open
    mode = 'playing';
    acc = 0;
    showScreen(null);
    hud.show(true);
  };
  const resume = () => {
    if (mode !== 'paused') return;
    input.endFrame();
    acc = 0;
    skipDelta = true;                 // don't count the paused time as one giant frame
    mode = 'playing';
    showScreen(null);
    canvas.focus?.();
  };

  window.addEventListener('keydown', (e) => {
    if (e.repeat || !ready) return;
    const enter = e.code === 'Enter' || e.code === 'NumpadEnter';
    if (mode === 'start' && enter && !needsKeyboardNotice()) startGame();
    else if (mode === 'start') pickerKey(e.code);
    else if (mode === 'end' && enter && !$('end').hidden) startGame();   // after the room has reacted
    else if (mode === 'playing' && (e.code === 'Escape' || e.code === 'KeyP')) pause();
    else if (mode === 'paused') {
      if (e.code === 'Escape' || e.code === 'KeyP' || e.code === 'Space' || enter) resume();
      else if (e.code === 'KeyR') startGame();
      if (e.code === 'KeyH') { game.hintsOn = !game.hintsOn; $('hints-state').textContent = game.hintsOn ? 'On' : 'Off'; }
      if (e.code === 'KeyM') { sfx.enabled = !sfx.enabled; $('sound-state').textContent = sfx.enabled ? 'On' : 'Off'; }
    }
  });
  window.addEventListener('blur', pause);
  // Clicking the pause screen also resumes (a click is often how focus comes back to the game).
  $('pause').addEventListener('click', resume);
  document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });
  window.addEventListener('resize', () => {
    renderer.setSize(window.innerWidth, window.innerHeight);
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    dirty = true;
  });
  canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); pause(); });
  canvas.addEventListener('webglcontextrestored', () => { dirty = true; });

  // ---------- Warm-up: compile every shader and upload every texture before play ----------
  placeSun(0, level.spawn.x, level.spawn.z);
  camCtl.update(0, player);
  // Put the other commuter on stage for a moment so every character shader is compiled now.
  const spare = KINDS.map((k) => choices[k]).find((c) => c && c !== player.char);
  if (spare) { spare.root.position.set(level.spawn.x + 1.5, 0, level.spawn.z - 2); scene.add(spare.root); }
  // Coworker labels, sight cones and X-ray beacons are normally hidden: show them for the compile.
  stealth?.warmup(true);
  beacons.warmup(true);
  builder.textures.forEach((t) => renderer.initTexture(t));
  const tBuilt = performance.now();
  await renderer.compileAsync(scene, camera);
  const tCompiled = performance.now();
  renderer.render(scene, camera);             // also builds the shadow-map shaders
  if (spare) { scene.remove(spare.root); spare.root.position.set(0, 0, 0); }
  stealth?.warmup(false);
  beacons.warmup(false);
  if (DEBUG) console.log(`[boot] rapier ${Math.round(tRapier - tBoot)} ms, build ${Math.round(tBuilt - tRapier)} ms, compile ${Math.round(tCompiled - tBuilt)} ms, first frame ${Math.round(performance.now() - tCompiled)} ms, since page start ${Math.round(performance.now())} ms`);
  ready = true;
  $('loading').hidden = true;
  $('press-start').hidden = false;

  // ---------- Loop: fixed-step simulation, interpolated rendering ----------
  const timer = new THREE.Timer();
  function frame(t) {
    requestAnimationFrame(frame);
    timer.update(t);
    let raw = timer.getDelta();
    if (skipDelta) { raw = 0; skipDelta = false; }
    const dt = Math.min(raw, 0.1);
    const noticeOnly = mode === 'start' && needsKeyboardNotice();

    if (mode === 'playing') {
      acc += dt;
      let steps = 0;
      while (acc >= STEP && steps < MAX_STEPS && mode === 'playing') {
        game.update(STEP);
        world.step();
        player.capture();
        input.endFrame();                    // each key press is consumed by exactly one step
        acc -= STEP;
        steps += 1;
      }
      if (steps === MAX_STEPS) acc = 0;      // fell far behind (tab hiccup): don't spiral
      player.interpolate(acc / STEP);
      stealth?.interpolate(acc / STEP);
      level.elevator.interpolate(acc / STEP);
      animateCharacters(dt);
      camCtl.update(dt, player);
      placeSun(player.floor, player.renderPos.x, player.renderPos.z);
      if (mode === 'playing') game.updateHud(dt);
      renderer.render(scene, camera);
      adaptQuality(raw);
    } else if ((mode === 'start' && !noticeOnly) || mode === 'end') {
      // Menus with a living character behind them keep animating.
      animateCharacters(dt);
      if (mode === 'start') selectCam(); else endCam(dt);
      renderer.render(scene, camera);
    } else if (dirty && !noticeOnly) {
      camCtl.update(dt, player);
      renderer.render(scene, camera);
      dirty = false;
    }
  }

  // Walking into 2B: the camera moves into the room's far corner so you see everyone react.
  const END_POS = new THREE.Vector3(0.35, F2 + 2.6, 16.75);   // north-west corner of 2B, up high
  let endBlend = 0;
  const endLook = new THREE.Vector3();
  const tmpV = new THREE.Vector3();
  const showEndCard = () => showScreen('end');
  function endCam(dt) {
    if (!game.inMeeting) { camCtl.update(dt, player); return; }
    // A beat on the follow camera as you step in, then a cut to the room (a camera move
    // would pass through the wall).
    endBlend += dt;
    // Score card after the last line has had time to be read.
    if ($('end').hidden && (stealth?.reaction ? stealth.reaction.t > stealth.reaction.end : endBlend > 6.4)) showEndCard();
    if (endBlend < 0.35) { camCtl.update(dt, player); return; }
    // Frame everyone in the room plus you, whatever the window's shape: aim at the middle of
    // the group and widen the lens until every head (and the space above it) fits.
    const people = [...(stealth?.roomPeople || []).map((c) => c.pos), player.renderPos];
    endLook.set(0, 0, 0);
    people.forEach((p) => endLook.add(p));
    endLook.multiplyScalar(1 / people.length).setY(F2 + 1.1);
    camera.position.copy(END_POS);
    camera.lookAt(endLook);
    camera.updateMatrixWorld();
    let needH = 0, needV = 0;
    for (const p of people) {
      for (const y of [0.1, 2.35]) {
        const v = tmpV.set(p.x, F2 + y, p.z).applyMatrix4(camera.matrixWorldInverse);
        if (v.z > -0.3) continue;
        needH = Math.max(needH, (Math.abs(v.x) + 0.45) / -v.z);
        needV = Math.max(needV, (Math.abs(v.y) + 0.1) / -v.z);
      }
    }
    const fov = THREE.MathUtils.clamp(THREE.MathUtils.radToDeg(2 * Math.max(Math.atan(needH / camera.aspect), Math.atan(needV))), 50, 110);
    if (Math.abs(camera.fov - fov) > 0.1) { camera.fov = fov; camera.updateProjectionMatrix(); }
    player.setFade(1);
  }

  function animateCharacters(dt) {
    player.animate(dt);
    stealth?.animate(dt, { playerPos: player.renderPos, playerFloor: player.floor, playing: mode === 'playing' || mode === 'end' });
    beacons.update(dt, player.floor);
    const label = game.busy?.label || '';
    const p = player.renderPos;
    for (const n of npcs) {
      const dx = p.x - n.g.position.x, dz = p.z - n.g.position.z, d = Math.hypot(dx, dz);
      const near = mode === 'playing' && player.floor === 0 && d < 6;
      // Turn toward the player when they come close (within reason), then back.
      let want = n.homeYaw;
      if (near) {
        const face = Math.atan2(dx, dz);
        const off = Math.atan2(Math.sin(face - n.homeYaw), Math.cos(face - n.homeYaw));
        want = n.homeYaw + THREE.MathUtils.clamp(off, -1.1, 1.1);
      }
      const diff = Math.atan2(Math.sin(want - n.g.rotation.y), Math.cos(want - n.g.rotation.y));
      n.g.rotation.y += diff * (1 - Math.exp(-dt * 4));
      const serving = (n === level.receptionist && label.includes('reception')) || (n === level.barista && label.includes('line'));
      if (near && d < 4.5 && !n.greeted) { n.greeted = true; n.c.play('cheer', 0.2); n.greetT = 2.2; }
      n.greetT = Math.max(0, (n.greetT || 0) - dt);
      if (n.greetT === 0) n.c.play(serving ? 'talk' : 'idle');
      n.tag.material.opacity += ((player.floor === 0 && d < 12 ? 1 : 0) - n.tag.material.opacity) * (1 - Math.exp(-dt * 6));
      n.g.visible = player.floor === 0;          // lobby staff aren't drawn from upstairs
      if (n.g.visible) n.c.update(dt);
    }
  }

  function resetNpcs() { for (const n of npcs) { n.greeted = false; n.greetT = 0; } }

  function adaptQuality(raw) {
    quality.acc += raw;
    quality.frames += 1;
    quality.calm = Math.max(0, quality.calm - raw);
    if (quality.acc < 1) return;
    const avg = quality.acc / quality.frames;
    quality.acc = 0; quality.frames = 0;
    let next = quality.ratio;
    if (avg > 1 / 45 && quality.ratio > quality.min) {
      quality.max = Math.max(quality.min, quality.ratio - 0.05);   // this scale was too heavy
      next = Math.max(quality.min, quality.ratio - 0.2);
      quality.calm = 4;
    } else if (avg < 1 / 57 && quality.ratio < quality.max && quality.calm === 0) {
      next = Math.min(quality.max, quality.ratio + 0.1);
      quality.calm = 2;
    }
    if (next !== quality.ratio) {
      quality.ratio = next;
      renderer.setPixelRatio(next);
      renderer.setSize(window.innerWidth, window.innerHeight);
    }
  }

  requestAnimationFrame(frame);

  if (DEBUG) {
    // Handle for automated playtests and performance checks (?debug in the URL).
    window.__coffeeQuest = {
      game, player, state, level, renderer, scene, quality, stealth, camera, input, world,
      // Run the simulation n fixed steps at once (automated playtests).
      step(n) {
        for (let i = 0; i < n && mode === 'playing'; i++) { game.update(STEP); world.step(); player.capture(); input.endFrame(); }
        player.interpolate(1); stealth?.interpolate(1); level.elevator.interpolate(1);
      },
    };
  }
}

boot().catch((err) => {
  console.error(err);
  $('loading').textContent = 'The office failed to load. Try refreshing the page.';
});

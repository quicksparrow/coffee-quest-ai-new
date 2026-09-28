import * as THREE from 'three';
import { Input } from './core/input.js';
import { Sfx } from './core/audio.js';
import { Game } from './core/game.js';
import { Builder } from './world/builder.js';
import { buildLevel, F2 } from './world/level1.js';
import { Player } from './actors/player.js';
import { FollowCamera } from './systems/camera.js';
import { Hud } from './ui/hud.js';

// Start downloading the physics engine right away, in parallel with everything else.
// It is the largest file, lives in its own chunk, and stays cached between game updates.
const rapierReady = import('@dimforge/rapier3d');

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
  const camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.05, 120);

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
  const camCtl = new FollowCamera(camera, world, RAPIER);

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
  let dirty = true;   // outside of play we only redraw when something changed
  const showScreen = (id) => ['start', 'pause', 'end'].forEach((s) => { $(s).hidden = s !== id; });
  const pause = () => { if (mode === 'playing') { mode = 'paused'; showScreen('pause'); dirty = true; } };

  const game = new Game({
    level, player, camCtl, input, hud, sfx, builder, marker,
    onFloorChange: (floor) => placeSun(floor, player.renderPos.x, player.renderPos.z),
    onEnd: (r) => {
      mode = 'end';
      dirty = true;
      hud.setPrompt(null);
      $('end-eyebrow').textContent = `Arrived ${r.arrived}`;
      $('end-title').textContent = r.late ? 'Late, but you made it' : 'Right on time';
      $('end-line').textContent = r.late
        ? '"Glad you could join us." Everyone saw you walk in.'
        : 'Your manager nods. Nobody suspects the coffee run.';
      $('end-rating').textContent = `${r.cups} cup${r.cups > 1 ? 's' : ''} · ${r.rating}`;
      const cup = (full) => `<svg class="cup${full ? ' full' : ''}" viewBox="0 0 40 40"><path class="body" d="M8 12 H28 L26 34 H10 Z"/><path class="handle" d="M28 16 C36 16 36 26 27 26"/></svg>`;
      $('end-cups').innerHTML = [1, 2, 3, 4, 5].map((i) => cup(i <= r.cups)).join('');
      $('end-breakdown').innerHTML = '';
      r.rows.forEach((row) => {
        const tr = document.createElement('tr');
        const label = row.label === 'Sips' ? `Sips (${row.n})` : row.label;
        tr.innerHTML = `<td></td><td class="${row.pts < 0 ? 'neg' : ''}">${row.pts > 0 ? '+' : ''}${row.pts.toLocaleString('en-US')}</td>`;
        tr.firstChild.textContent = label;
        $('end-breakdown').appendChild(tr);
      });
      $('end-score').textContent = r.total.toLocaleString('en-US');
      setTimeout(() => showScreen('end'), 600);
    },
  });

  const startGame = () => {
    sfx.unlock();
    if (mode === 'end' || mode === 'paused') game.reset();
    input.endFrame();                 // drop any keys pressed while a menu was open
    mode = 'playing';
    acc = 0;
    showScreen(null);
    hud.show(true);
  };
  const resume = () => { input.endFrame(); acc = 0; mode = 'playing'; showScreen(null); };

  window.addEventListener('keydown', (e) => {
    if (e.repeat || !ready) return;
    const enter = e.code === 'Enter' || e.code === 'NumpadEnter';
    if (mode === 'start' && enter && !needsKeyboardNotice()) startGame();
    else if (mode === 'end' && enter) startGame();
    else if (mode === 'playing' && e.code === 'Escape') pause();
    else if (mode === 'paused') {
      if (e.code === 'Escape' || enter) resume();
      if (e.code === 'KeyR') startGame();
      if (e.code === 'KeyH') { game.hintsOn = !game.hintsOn; $('hints-state').textContent = game.hintsOn ? 'On' : 'Off'; }
      if (e.code === 'KeyM') { sfx.enabled = !sfx.enabled; $('sound-state').textContent = sfx.enabled ? 'On' : 'Off'; }
    }
  });
  window.addEventListener('blur', pause);
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
  builder.textures.forEach((t) => renderer.initTexture(t));
  const tBuilt = performance.now();
  await renderer.compileAsync(scene, camera);
  const tCompiled = performance.now();
  renderer.render(scene, camera);             // also builds the shadow-map shaders
  if (DEBUG) console.log(`[boot] rapier ${Math.round(tRapier - tBoot)} ms, build ${Math.round(tBuilt - tRapier)} ms, compile ${Math.round(tCompiled - tBuilt)} ms, first frame ${Math.round(performance.now() - tCompiled)} ms, since page start ${Math.round(performance.now())} ms`);
  ready = true;
  $('loading').hidden = true;
  $('press-start').hidden = false;

  // ---------- Loop: fixed-step simulation, interpolated rendering ----------
  const timer = new THREE.Timer();
  function frame(t) {
    requestAnimationFrame(frame);
    timer.update(t);
    const raw = timer.getDelta();
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
      camCtl.update(dt, player);
      placeSun(player.floor, player.renderPos.x, player.renderPos.z);
      if (mode === 'playing') game.updateHud(dt);
      renderer.render(scene, camera);
      adaptQuality(raw);
    } else if (dirty && !noticeOnly) {
      camCtl.update(dt, player);
      renderer.render(scene, camera);
      dirty = false;
    }
  }

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
    window.__coffeeQuest = { game, player, state, level, renderer, scene, quality };
  }
}

boot().catch((err) => {
  console.error(err);
  $('loading').textContent = 'The office failed to load. Try refreshing the page.';
});

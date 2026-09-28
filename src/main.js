import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { Input } from './core/input.js';
import { Sfx } from './core/audio.js';
import { Game } from './core/game.js';
import { Builder } from './world/builder.js';
import { buildLevel, F2 } from './world/level1.js';
import { Player } from './actors/player.js';
import { FollowCamera } from './systems/camera.js';
import { Hud } from './ui/hud.js';

const $ = (id) => document.getElementById(id);

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
  await RAPIER.init();

  // ---------- Renderer, scene, lights ----------
  const canvas = $('game');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xc9d6e3);

  const camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.05, 200);
  window.addEventListener('resize', () => {
    renderer.setSize(window.innerWidth, window.innerHeight);
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
  });

  scene.add(new THREE.HemisphereLight(0xf4f7fb, 0x9aa0a8, 1.7));
  // "Sun through the windows": one shadow light that sits just under the ceiling of
  // whichever floor the player is on, so the floor above never shades the one below.
  const sun = new THREE.DirectionalLight(0xfff4e6, 1.9);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -20, right: 20, top: 16, bottom: -16, near: 0.05, far: 12 });
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 0.02;
  scene.add(sun, sun.target);
  const sunDir = new THREE.Vector3(0.35, -1, 0.25).normalize();
  const placeSun = (floor) => {
    const y = floor === 1 ? F2 : 0;
    const target = new THREE.Vector3(16, y, 12);
    sun.target.position.copy(target);
    const up = (floor === 1 ? 6 : 3.5);                     // start the shadow frustum under the ceiling
    sun.position.copy(target).addScaledVector(sunDir, -up / -sunDir.y);
    sun.shadow.camera.far = up / -sunDir.y + 1;
    sun.shadow.camera.updateProjectionMatrix();
  };

  // ---------- Physics + level ----------
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  const builder = new Builder(scene, world, RAPIER);
  const state = {};
  const level = buildLevel(builder, state);
  level.state = state;

  const player = new Player(scene, world, RAPIER, level.spawn, level.spawnYaw);
  const camCtl = new FollowCamera(camera, world, RAPIER);

  const marker = new THREE.Mesh(
    new THREE.OctahedronGeometry(0.28),
    new THREE.MeshBasicMaterial({ color: 0xd6a27c }),
  );
  marker.renderOrder = 10;
  scene.add(marker);

  const input = new Input();
  const hud = new Hud();
  const sfx = new Sfx();

  // ---------- Screens ----------
  let mode = 'start'; // start | playing | paused | end
  const showScreen = (id) => ['start', 'pause', 'end'].forEach((s) => { $(s).hidden = s !== id; });

  const game = new Game({
    level, player, camCtl, input, hud, sfx, builder, marker,
    onFloorChange: placeSun,
    onEnd: (r) => {
      mode = 'end';
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
    mode = 'playing';
    showScreen(null);
    hud.show(true);
  };

  window.addEventListener('keydown', (e) => {
    if (e.repeat) return;
    if (mode === 'start' && (e.code === 'Enter' || e.code === 'NumpadEnter') && !needsKeyboardNotice()) startGame();
    else if (mode === 'end' && (e.code === 'Enter' || e.code === 'NumpadEnter')) startGame();
    else if (mode === 'playing' && e.code === 'Escape') { mode = 'paused'; showScreen('pause'); }
    else if (mode === 'paused') {
      if (e.code === 'Escape' || e.code === 'Enter') { mode = 'playing'; showScreen(null); }
      if (e.code === 'KeyR') startGame();
      if (e.code === 'KeyH') { game.hintsOn = !game.hintsOn; $('hints-state').textContent = game.hintsOn ? 'On' : 'Off'; }
      if (e.code === 'KeyM') { sfx.enabled = !sfx.enabled; $('sound-state').textContent = sfx.enabled ? 'On' : 'Off'; }
    }
  });
  window.addEventListener('blur', () => { if (mode === 'playing') { mode = 'paused'; showScreen('pause'); } });

  $('loading').hidden = true;

  // ---------- Loop ----------
  const clock = new THREE.Timer();
  function frame(t) {
    clock.update(t);
    const dt = Math.min(clock.getDelta(), 1 / 20);
    if (mode === 'playing') {
      world.timestep = dt;
      game.update(dt);
      world.step();
      player.syncVisual(dt);
    }
    // On phones and tablets the notice covers the screen, so skip the 3D work entirely.
    if (!(mode === 'start' && needsKeyboardNotice())) {
      camCtl.update(dt, player);
      renderer.render(scene, camera);
    }
    input.endFrame();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  // Handle for automated playtests.
  window.__coffeeQuest = { game, player, state, level };
}

boot().catch((err) => {
  console.error(err);
  $('loading').textContent = 'The office failed to load. Try refreshing the page.';
});

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';

/*
  Player characters: Quaternius "Universal Base Characters" (CC0) on the Universal Animation
  Library rig (CC0). The base bodies come undressed, so office clothes are painted on in the
  shader using each vertex's bind-pose position: shoes, trousers, belt, shirt or blouse with
  sleeves, a collar line, and a tie for him.
*/

export const OUTFITS = [
  { name: 'Sky', color: 0x8fb8e0 },
  { name: 'White', color: 0xeef1f4 },
  { name: 'Teal', color: 0x4e9c98 },
  { name: 'Mustard', color: 0xd9b04e },
  { name: 'Lilac', color: 0xa98fd0 },
];
// Skin tones are a tint over the base skin texture (the pack's two textures are nearly identical).
export const SKINS = [
  { name: 'Fair', tint: [1.16, 1.12, 1.1] },
  { name: 'Medium', tint: [1.0, 1.0, 1.0] },
  { name: 'Brown', tint: [0.74, 0.66, 0.6] },
  { name: 'Deep', tint: [0.48, 0.41, 0.37] },
];
export const HAIRS = [
  { name: 'Black', color: 0x2a221e },
  { name: 'Brown', color: 0x5a3a24 },
  { name: 'Auburn', color: 0x8a3f22 },
  { name: 'Blonde', color: 0xd6b27a },
];
export const KINDS = ['woman', 'man'];
export const NAMES = { woman: 'Claire', man: 'Steven' };

// A random outfit, skin tone and hair color (picked fresh every run).
export function randomLook() {
  const pick = (n) => Math.floor(Math.random() * n);
  return { outfit: pick(OUTFITS.length), skin: pick(SKINS.length), hair: pick(HAIRS.length) };
}

// Bind-pose measurements (metres, model space: Y up, facing +Z, T-pose).
const CUT = {
  man: { shoeTop: 0.11, hem: 0.11, waist: 1.0, neck: 1.5, neckFront: 1.42, neckSlope: 1.4, armX: 0.21, sleeveX: 0.665, tie: 1, bottom: 0x2f3440 },
  woman: { shoeTop: 0.085, hem: 0.16, waist: 0.99, neck: 1.46, neckFront: 1.37, neckSlope: -6.5, armX: 0.17, sleeveX: 0.5, tie: 0, bottom: 0x2c3550 },
};

// Model files. Regular builds download the four .glb files. The playable preview link can't
// serve .glb files and blocks data:/blob: addresses, so its build (VITE_MODELS=embed) bakes the
// same bytes into JavaScript chunks and decodes them here, with no web request at all.
const MODEL_NAMES = ['woman', 'man', 'anims-1', 'anims-2'];
const EMBED = import.meta.env.VITE_MODELS === 'embed';

function base64ToBuffer(dataUrl) {
  const b64 = dataUrl.slice(dataUrl.indexOf(',') + 1); // accepts a bare base64 string too
  if (Uint8Array.fromBase64) return Uint8Array.fromBase64(b64).buffer;
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}

async function modelBytes(base, name) {
  if (EMBED) {
    const { EMBEDDED } = await import('./embedded-models.js');
    return base64ToBuffer(await EMBEDDED[name]());
  }
  const res = await fetch(`${base}${name}.glb`);
  if (!res.ok) throw new Error(`${name}.glb: HTTP ${res.status}`);
  return res.arrayBuffer();
}

// The characters' textures are WebP images stored inside the model. three.js normally decodes
// them through a blob: address (and tests WebP support with a data: image), which strict hosts
// block. Decode them straight from the bytes instead. Registered under the same name, this
// replaces the built-in EXT_texture_webp handler.
const FILTERS = { 9728: THREE.NearestFilter, 9729: THREE.LinearFilter, 9984: THREE.NearestMipmapNearestFilter, 9985: THREE.LinearMipmapNearestFilter, 9986: THREE.NearestMipmapLinearFilter, 9987: THREE.LinearMipmapLinearFilter };
const WRAPS = { 33071: THREE.ClampToEdgeWrapping, 33648: THREE.MirroredRepeatWrapping, 10497: THREE.RepeatWrapping };
const directTextures = (parser) => ({
  name: 'EXT_texture_webp',
  async loadTexture(index) {
    const json = parser.json;
    const def = json.textures[index];
    const img = json.images[def.extensions?.EXT_texture_webp?.source ?? def.source];
    if (img?.bufferView === undefined) return null; // not embedded: let three.js handle it
    const bytes = await parser.getDependency('bufferView', img.bufferView);
    const bitmap = await createImageBitmap(new Blob([bytes], { type: img.mimeType || 'image/webp' }),
      { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
    const tex = new THREE.Texture(bitmap);
    tex.name = def.name || img.name || '';
    tex.flipY = false;
    const s = json.samplers?.[def.sampler] || {};
    tex.magFilter = FILTERS[s.magFilter] ?? THREE.LinearFilter;
    tex.minFilter = FILTERS[s.minFilter] ?? THREE.LinearMipmapLinearFilter;
    tex.wrapS = WRAPS[s.wrapS] ?? THREE.RepeatWrapping;
    tex.wrapT = WRAPS[s.wrapT] ?? THREE.RepeatWrapping;
    tex.needsUpdate = true;
    parser.associations.set(tex, { textures: index });
    return tex;
  },
});

export async function loadCharacterAssets(base = './models/') {
  const loader = new GLTFLoader().register(directTextures);
  const [woman, man, a1, a2] = await Promise.all(MODEL_NAMES.map(async (name) => {
    const bytes = await modelBytes(base, name);
    return loader.parseAsync(bytes, base);
  }));
  const clips = {};
  [...a1.animations, ...a2.animations].forEach((c) => { clips[c.name] = c; });
  return { models: { woman: woman.scene, man: man.scene }, clips };
}

function clothingMaterial(src, cut) {
  const m = new THREE.MeshStandardMaterial({ map: src.map, roughness: 0.62, metalness: 0 });
  m.userData.uniforms = {
    uTop: { value: new THREE.Color(OUTFITS[0].color) },
    uBottom: { value: new THREE.Color(cut.bottom) },
    uShoe: { value: new THREE.Color(0x2a211c) },
    uTie: { value: new THREE.Color(0x7a2233) },
    uCut1: { value: new THREE.Vector4(cut.shoeTop, cut.hem, cut.waist, cut.neck) },
    uCut2: { value: new THREE.Vector4(cut.neckFront, cut.neckSlope, cut.armX, cut.sleeveX) },
    uHasTie: { value: cut.tie },
    uSkin: { value: new THREE.Vector3(1, 1, 1) },
  };
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, m.userData.uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vBind;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvBind = position;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec3 vBind;
uniform vec3 uTop, uBottom, uShoe, uTie;
uniform vec4 uCut1, uCut2;
uniform float uHasTie;
uniform vec3 uSkin;`)
      .replace('#include <map_fragment>', `#include <map_fragment>
float cloth = 0.0;
{
  vec3 b = vBind;
  float ax = abs(b.x);
  float shoeTop = uCut1.x, hem = uCut1.y, waist = uCut1.z, neckBack = uCut1.w;
  float neckFront = uCut2.x, neckSlope = uCut2.y, armX = uCut2.z, sleeveX = uCut2.w;
  bool arm = ax > armX && b.y > waist + 0.2;
  // Front neckline: a V (slope > 0) or a scoop (slope < 0).
  float dip = neckSlope > 0.0 ? ax * neckSlope : ax * ax * -neckSlope;
  float neck = b.z > 0.0 ? min(neckBack, neckFront + dip) : neckBack;
  neck += smoothstep(0.075, 0.16, ax) * 0.35;      // collar rises to the shoulder seam
  vec3 col = diffuseColor.rgb;
  diffuseColor.rgb *= uSkin;
  float edge = 1.0;
  if (b.y < shoeTop) { col = uShoe; cloth = 1.0; }
  else if (b.y < hem) { cloth = 0.0; }
  else if (b.y < waist && !arm) {
    col = uBottom; cloth = 1.0;
    edge = smoothstep(0.0, 0.015, b.y - hem);
  }
  else if (arm) {
    if (ax < sleeveX) { col = uTop; cloth = 1.0; edge = smoothstep(0.0, 0.012, sleeveX - ax); }
  }
  else if (b.y < neck) {
    col = uTop; cloth = 1.0;
    edge = smoothstep(0.0, 0.012, neck - b.y);
    if (uHasTie > 0.5 && b.z > 0.03 && b.y > waist + 0.03) {
      float w = mix(0.036, 0.02, smoothstep(waist + 0.1, neck, b.y));
      if (ax < w) col = uTie;
    }
  }
  if (!arm && abs(b.y - waist) < 0.014) { col = vec3(0.09, 0.07, 0.06); cloth = 1.0; }
  diffuseColor.rgb = mix(diffuseColor.rgb, col * (0.8 + 0.2 * edge), cloth);
}`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.88, cloth);');
  };
  m.customProgramCacheKey = () => 'office-clothes';
  return m;
}

const LOOP = { idle: 'Idle_Loop', walk: 'Walk_Loop', jog: 'Jog_Fwd_Loop', hurry: 'Sprint_Loop', crouch: 'Crouch_Idle_Loop', crouchWalk: 'Crouch_Fwd_Loop', phone: 'Idle_TalkingPhone_Loop', talk: 'Idle_Talking_Loop', arms: 'Idle_FoldArms_Loop', cheer: 'Yes' };
// Natural ground speed of each locomotion clip at timeScale 1 (m/s), measured from the clips'
// foot travel, so playback speed can match movement speed and feet don't slide.
export const CLIP_SPEED = { walk: 1.25, jog: 4.2, hurry: 6.5, crouchWalk: 0.8 };
const SIP_BONES = /^(clavicle|upperarm|lowerarm|hand|index|middle|ring|pinky|thumb)_.*l$|^(neck_01|Head)$/;

export class Character {
  constructor(assets, kind) {
    this.kind = kind;
    this.assets = assets;
    this.root = cloneSkinned(assets.models[kind]);
    this.root.rotation.y = Math.PI;                // models face +Z; the game's forward is -Z
    this.bones = {};
    this.mats = [];
    this.root.traverse((o) => {
      if (o.isBone) this.bones[o.name] = o;
      if (o.isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
        o.frustumCulled = false;                   // skinned bounds don't follow animation
        if (o.material?.name === 'Body') { o.material = clothingMaterial(o.material, CUT[kind]); this.body = o; }
      }
      if (o.isMesh && (o.material?.name === 'Hair' || /Hair/.test(o.material?.name || ''))) {
        o.material = o.material.clone();
        (this.hairMats ||= []).push(o.material);
      }
      if (o.isBone && o.name === 'hand_r') this.handR = o;
      if (o.isBone && o.name === 'Head') this.head = o;
    });
    this.mixer = new THREE.AnimationMixer(this.root);
    this.actions = {};
    for (const [key, name] of Object.entries(LOOP)) {
      const clip = assets.clips[name];
      if (clip) this.actions[key] = this.mixer.clipAction(clip);
    }
    const once = (name) => { const a = this.mixer.clipAction(assets.clips[name]); a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = true; return a; };
    this.actions.interact = once('Interact');
    this.actions.cheer.setLoop(THREE.LoopOnce, 1);
    this.actions.cheer.clampWhenFinished = true;
    // Every material stays in the transparent pass so the camera fade never recompiles a shader.
    this.root.traverse((o) => {
      if (!o.isMesh) return;
      o.renderOrder = 3;
      o.material.transparent = true;
      this.mats.push(o.material);
    });
    this.setupSip(assets.clips.Consume);
    this.current = null;
    this.play('idle', 0);
    this.setSkin(1);
    this.setHair(1);
  }

  setOutfit(i) { this.body.material.userData.uniforms.uTop.value.setHex(OUTFITS[i].color); }

  setSkin(i) { this.body.material.userData.uniforms.uSkin.value.set(...SKINS[i].tint); }

  setHair(i) {
    (this.hairMats || []).forEach((m) => m.color.setHex(HAIRS[i].color).multiplyScalar(1.6));
  }

  play(key, fade = 0.25) {
    const next = this.actions[key];
    if (!next || next === this.current) return;
    next.reset().setEffectiveWeight(1).play();
    if (this.current) this.current.crossFadeTo(next, fade, false);
    this.current = next;
    this.currentKey = key;
  }

  // The drink animation raises the left hand to the mouth. We keep its left-arm, neck and head
  // tracks and blend them over whatever the legs are doing, so you can sip while walking.
  setupSip(clip) {
    this.sipTracks = [];
    this.sipDuration = clip.duration;
    for (const track of clip.tracks) {
      const [name, prop] = track.name.split('.');
      if (prop !== 'quaternion' || !SIP_BONES.test(name) || !this.bones[name]) continue;
      this.sipTracks.push({ bone: this.bones[name], interp: track.createInterpolant(), q: new THREE.Quaternion() });
    }
  }

  // t: seconds into the sip; weight 0..1.
  applySip(t, weight) {
    if (weight <= 0) return;
    for (const s of this.sipTracks) {
      const v = s.interp.evaluate(Math.min(t, this.sipDuration - 1e-3));
      s.q.set(v[0], v[1], v[2], v[3]);
      s.bone.quaternion.slerp(s.q, weight);
    }
  }

  // Put a held object (the coffee cup) in the left hand, upright when the arm hangs at rest.
  attachToLeftHand(obj) {
    const hand = this.bones.hand_l, mid = this.bones.middle_01_l, thumb = this.bones.thumb_01_l;
    this.mixer.stopAllAction();
    this.applySip(0, 1);
    this.root.updateMatrixWorld(true);
    const h = hand.getWorldPosition(new THREE.Vector3());
    const m = mid.getWorldPosition(new THREE.Vector3());
    const t = thumb.getWorldPosition(new THREE.Vector3());
    const world = new THREE.Matrix4().compose(
      h.clone().lerp(m, 0.9).lerp(t, 0.35),
      this.root.getWorldQuaternion(new THREE.Quaternion()),
      new THREE.Vector3(1, 1, 1),
    );
    obj.matrixAutoUpdate = true;
    new THREE.Matrix4().copy(hand.matrixWorld).invert().multiply(world).decompose(obj.position, obj.quaternion, obj.scale);
    hand.add(obj);
    this.current = null;
    this.play('idle', 0);
  }

  setFade(alpha) {
    for (const m of this.mats) { m.opacity = alpha; m.depthWrite = alpha >= 1; }
  }

  update(dt) { this.mixer.update(dt); }
}

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
  { name: 'Navy', color: 0x3a4f7a },
  { name: 'Forest', color: 0x3f6b4f },
  { name: 'Burgundy', color: 0x7a2e3b },
  { name: 'Charcoal', color: 0x55595f },
  { name: 'Olive', color: 0x7d7a3a },
  { name: 'Slate', color: 0x6f8296 },
  { name: 'Plum', color: 0x6b3f6e },
];
const O = Object.fromEntries(OUTFITS.map((o, i) => [o.name, i]));
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

// Everyone has one fixed look, so you learn who's who. look(outfit, skin, hair) by name.
export function look(outfit, skin, hair) {
  return { outfit: O[outfit], skin: SKINS.findIndex((x) => x.name === skin), hair: HAIRS.findIndex((x) => x.name === hair) };
}
export const PLAYER_LOOKS = { woman: look('Sky', 'Medium', 'Blonde'), man: look('White', 'Deep', 'Black') };

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
    const blob = new Blob([bytes], { type: img.mimeType || 'image/webp' });
    // Older Safari/Firefox reject these options: fall back to the plain decode.
    const bitmap = await createImageBitmap(blob, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' })
      .catch(() => createImageBitmap(blob));
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

// onEach(): called as each of the four files finishes (for the loading bar).
export async function loadCharacterAssets(base = './models/', onEach = () => {}) {
  const loader = new GLTFLoader().register(directTextures);
  const [woman, man, a1, a2] = await Promise.all(MODEL_NAMES.map(async (name) => {
    const bytes = await modelBytes(base, name);
    const gltf = await loader.parseAsync(bytes, base);
    onEach();
    return gltf;
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

const LOOP = { sit: 'Sitting_Idle_Loop', idle: 'Idle_Loop', walk: 'Walk_Loop', jog: 'Jog_Fwd_Loop', hurry: 'Sprint_Loop', crouch: 'Crouch_Idle_Loop', crouchWalk: 'Crouch_Fwd_Loop', phone: 'Idle_TalkingPhone_Loop', talk: 'Idle_Talking_Loop', arms: 'Idle_FoldArms_Loop', cheer: 'Yes' };
// Natural ground speed of each locomotion clip at timeScale 1 (m/s), measured from the clips'
// foot travel, so playback speed can match movement speed and feet don't slide.
export const CLIP_SPEED = { walk: 1.25, jog: 4.2, hurry: 6.5, crouchWalk: 0.8 };
// Sip timing (seconds) and where the lips are relative to the Head bone (metres, per body).
const SIP = { up: 0.38, hold: 0.62, down: 0.42, woman: { mouthUp: 0.06, mouthFwd: 0.1 }, man: { mouthUp: 0.06, mouthFwd: 0.11 } };
export const SIP_SECONDS = SIP.up + SIP.hold + SIP.down;
// (Not the neck or head: the clip turns the head to the left, toward a cup held at the side.)
const SIP_BONES = /^(clavicle|upperarm|lowerarm|hand|index|middle|ring|pinky|thumb)_.*l$/;

// Scratch space for the arm IK (see holdCup / solveArm).
const V3 = () => new THREE.Vector3();
const IKV = { x: V3(), y: V3(), scale: V3(), pole: V3(), pole2: V3(), defPole: V3(), a: V3(), b: V3(), c: V3(), toT: V3(), elbow: V3(), wristAt: V3(), cur: V3(), want: V3() };
const IKQ = { rq: new THREE.Quaternion(), delta: new THREE.Quaternion(), world: new THREE.Quaternion(), parent: new THREE.Quaternion() };

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
    // Each character gets its own copy of every material (the fade is per character; sharing
    // the eyes' material made everyone's eyes fade with whoever was near a wall).
    this.root.traverse((o) => {
      if (!o.isMesh) return;
      if (o !== this.body && !(this.hairMats || []).includes(o.material)) o.material = o.material.clone();
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

  setLook(l) { this.setOutfit(l.outfit); this.setSkin(l.skin); this.setHair(l.hair); }

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

  // Sipping. The pack's drink clip lifts the hand to the side of the face, not the mouth, so we
  // only borrow its finger grip and head tilt, and place the arm with two-bone IK: the cup rises
  // on a small forward arc, the lid meets the lips, and the cup tips back while you drink.
  // Works over any leg animation, so you can sip while walking.
  setupSip(clip) {
    this.sipTracks = [];
    this.sipClip = clip.duration;
    for (const track of clip.tracks) {
      const [name, prop] = track.name.split('.');
      if (prop !== 'quaternion' || !SIP_BONES.test(name) || !this.bones[name]) continue;
      this.sipTracks.push({ bone: this.bones[name], arm: /^(upperarm|lowerarm|hand)_l$/.test(name), finger: /^(index|middle|ring|pinky|thumb)_/.test(name), interp: track.createInterpolant(), q: new THREE.Quaternion() });
    }
    const b = this.bones;
    this.ik = { upper: b.upperarm_l, lower: b.lowerarm_l, hand: b.hand_l, v: Array.from({ length: 10 }, () => new THREE.Vector3()), q: Array.from({ length: 4 }, () => new THREE.Quaternion()), m: [new THREE.Matrix4(), new THREE.Matrix4()] };
  }

  // Consume-clip pose for the borrowed bones (fingers, neck, head; arm too when `withArm`).
  applySipPose(t, weight, withArm = false) {
    for (const s of this.sipTracks) {
      if (s.arm && !withArm) continue;
      // Fingers keep the grip the cup was fitted to (the clip's first frame).
      const v = s.interp.evaluate(s.finger ? 0 : Math.min(t, this.sipClip - 1e-3));
      s.q.set(v[0], v[1], v[2], v[3]);
      s.bone.quaternion.slerp(s.q, weight);
    }
  }

  // Holding the coffee: the left arm is placed with IK every frame, like a real person carrying
  // a cup (elbow bent, cup upright in front of the hip) instead of swinging it. Sipping lifts it
  // to the lips on a small forward arc, the cup tips back, then it comes back down.
  // sipT: seconds into a sip (0 = not sipping). Returns false once a sip is over.
  holdCup(cup, sipT = 0) {
    const D = SIP.up + SIP.hold + SIP.down;
    const sipping = sipT > 0 && sipT < D;
    const t = sipping ? sipT : 0;
    const ease = (x) => x * x * (3 - 2 * x);
    const lift = !sipping ? 0 : t < SIP.up ? ease(t / SIP.up) : t < SIP.up + SIP.hold ? 1 : ease(1 - (t - SIP.up - SIP.hold) / SIP.down);
    const drink = !sipping || t < SIP.up ? 0 : Math.min(1, (t - SIP.up) / SIP.hold);
    // Grip (fingers) always.
    this.applySipPose(0.3 + 0.2 * lift, lift);
    const { v, q, m } = this.ik;
    this.root.updateMatrixWorld(true);
    const [fwd, up, left, mouth, carry, to, cupPos, cupUp, tmp, wrist] = v;
    this.root.getWorldQuaternion(q[0]);
    fwd.set(0, 0, 1).applyQuaternion(q[0]);
    up.set(0, 1, 0).applyQuaternion(q[0]);
    left.set(1, 0, 0).applyQuaternion(q[0]);
    // The head stays facing forward and tips back a little as you drink (chin up).
    if (drink > 0) {
      const h = this.head;
      h.getWorldQuaternion(q[1]);
      q[2].setFromAxisAngle(left, -0.1 * drink * lift);
      h.parent.getWorldQuaternion(q[3]);
      h.quaternion.copy(q[3].invert()).multiply(q[2]).multiply(q[1]);
      h.updateMatrixWorld(true);
    }
    // Carry: in front of the left hip, cup upright, hand on the outside of the cup.
    this.bones.pelvis.getWorldPosition(carry).addScaledVector(up, 0.14).addScaledVector(fwd, 0.3).addScaledVector(left, 0.17);
    // Sip: lid at the lips, tipped back as you drink.
    const k = SIP[this.kind];
    this.head.getWorldPosition(mouth).addScaledVector(up, k.mouthUp).addScaledVector(fwd, k.mouthFwd);
    const tilt = THREE.MathUtils.degToRad(40 * drink);
    cupUp.copy(up).multiplyScalar(Math.cos(tilt)).addScaledVector(fwd, -Math.sin(tilt));
    to.copy(mouth).addScaledVector(cupUp, -0.075).addScaledVector(fwd, 0.03).addScaledVector(left, 0.01);
    cupPos.lerpVectors(carry, to, lift).addScaledVector(fwd, 0.1 * Math.sin(Math.PI * lift) * (1 - drink));
    // Cup orientation from its axis (up) and the direction of the hand holding it (outside,
    // slightly toward the body while carrying).
    const handSide = tmp.copy(left).multiplyScalar(0.9).addScaledVector(fwd, -0.25 * (1 - lift)).normalize();
    const Y = IKV.y.copy(cupUp).lerp(up, 1 - lift).normalize();
    const Z = handSide.addScaledVector(Y, -handSide.dot(Y)).normalize();
    const X = IKV.x.crossVectors(Y, Z);
    q[3].setFromRotationMatrix(m[0].makeBasis(X, Y, Z));
    // Hand transform that puts the cup there (cup = hand * cupLocal), then reach for it.
    const cupScale = cup.getWorldScale(IKV.scale);
    m[0].compose(cupPos, q[3], cupScale).multiply(m[1].copy(cup.matrix).invert());
    wrist.setFromMatrixPosition(m[0]);
    const handQ = q[2].setFromRotationMatrix(m[1].extractRotation(m[0]));
    const pole = IKV.pole.set(0.35, -1, -0.8).lerp(IKV.pole2.set(0.45, -1, 0.35), lift);
    this.solveArm(wrist, handQ, pole);
    return sipping;
  }

  // Two-bone IK for the left arm: shoulder -> elbow -> wrist, elbow pointing down and out.
  // (Runs every frame for the player: scratch vectors instead of new ones, so no GC hiccups.)
  solveArm(target, handQ, poleModel = IKV.defPole.set(0.9, -1, -0.35)) {
    const { upper, lower, hand } = this.ik;
    const { a, b, c, toT, pole, elbow, wristAt, cur, want } = IKV;
    const { rq, delta, world, parent } = IKQ;
    upper.getWorldPosition(a); lower.getWorldPosition(b); hand.getWorldPosition(c);
    const l1 = a.distanceTo(b), l2 = b.distanceTo(c);
    toT.copy(target).sub(a);
    const d = THREE.MathUtils.clamp(toT.length(), Math.abs(l1 - l2) + 1e-3, l1 + l2 - 1e-3);
    const dir = toT.normalize();
    this.root.getWorldQuaternion(rq);
    pole.copy(poleModel).applyQuaternion(rq);   // where the elbow points (model space)
    pole.addScaledVector(dir, -pole.dot(dir)).normalize();
    const cosA = THREE.MathUtils.clamp((l1 * l1 + d * d - l2 * l2) / (2 * l1 * d), -1, 1);
    elbow.copy(a).addScaledVector(dir, l1 * cosA).addScaledVector(pole, l1 * Math.sqrt(1 - cosA * cosA));
    wristAt.copy(a).addScaledVector(dir, d);
    const aim = (bone, from, childNow, childWant) => {
      cur.copy(childNow).sub(from).normalize();
      want.copy(childWant).sub(from).normalize();
      delta.setFromUnitVectors(cur, want);
      bone.getWorldQuaternion(world).premultiply(delta);
      bone.parent.getWorldQuaternion(parent);
      bone.quaternion.copy(parent.invert().multiply(world));
      bone.updateMatrixWorld(true);
    };
    aim(upper, a, b, elbow);
    lower.getWorldPosition(b); hand.getWorldPosition(c);
    aim(lower, b, c, wristAt);
    lower.getWorldQuaternion(parent);
    hand.quaternion.copy(parent.invert().multiply(handQ));
    hand.updateMatrixWorld(true);
  }

  // Put the coffee cup in the left hand, held the way people hold a cup: fingers round it,
  // index finger and thumb on top, so the cup's axis runs across the hand (pinky to index).
  attachToLeftHand(obj) {
    const b = this.bones;
    this.mixer.stopAllAction();
    this.applySipPose(0, 1, true);
    this.root.updateMatrixWorld(true);
    const P = (bone) => bone.getWorldPosition(new THREE.Vector3());
    const H = P(b.hand_l), M = P(b.middle_01_l), I = P(b.index_01_l), K = P(b.pinky_01_l), tip = P(b.middle_03_l);
    const along = M.clone().sub(H).normalize();
    const across = I.clone().sub(K).normalize();                // pinky -> index: the cup's up
    const palm = new THREE.Vector3().crossVectors(along, across).normalize();
    if (tip.clone().sub(M).dot(palm) < 0) palm.negate();          // palm side = where the fingers curl
    const Y = across;
    const Z = palm.clone().negate();                               // from the cup toward the palm
    Z.addScaledVector(Y, -Z.dot(Y)).normalize();
    const X = new THREE.Vector3().crossVectors(Y, Z);
    const center = H.clone().lerp(M, 0.75).addScaledVector(palm, 0.058).addScaledVector(Y, -0.01);
    const world = new THREE.Matrix4().makeBasis(X, Y, Z).setPosition(center);
    obj.matrixAutoUpdate = true;
    new THREE.Matrix4().copy(b.hand_l.matrixWorld).invert().multiply(world).decompose(obj.position, obj.quaternion, obj.scale);
    b.hand_l.add(obj);
    this.current = null;
    this.play('idle', 0);
  }

  setFade(alpha) {
    for (const m of this.mats) { m.opacity = alpha; m.depthWrite = alpha >= 1; }
  }

  update(dt) { this.mixer.update(dt); }
}

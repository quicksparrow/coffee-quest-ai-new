import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

/*
  Cinematic look, applied after the 3D scene is drawn:
  - ambient occlusion: soft contact shadows where things meet (feet on floors, desks, corners)
  - bloom: a soft glow round the ceiling lights, screens and bright windows
  - a film grade: warm highlights, cool shadows, a touch more contrast and saturation, a
    vignette, fine grain and a hint of lens fringing at the edges

  Name tags, speech bubbles and X-ray labels live on the OVERLAY layer and are drawn after the
  grade, so they stay crisp and true to colour. Sight cones and route lines live on the FLOOR_FX
  layer: drawn with the scene but left out of the ambient occlusion.

  Levels: 2 = everything, 1 = no ambient occlusion (the expensive part), 0 = grade only.
  The game steps down on its own if the frame rate sags.
*/
export const OVERLAY = 1;
export const FLOOR_FX = 2;

const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uRes: { value: new THREE.Vector2(1, 1) },
    uVignette: { value: 0.32 },
    uGrain: { value: 0.035 },
    uFringe: { value: 0.0008 },
    uWarmth: { value: 1 },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform float uTime, uVignette, uGrain, uFringe, uWarmth;
    uniform vec2 uRes;
    varying vec2 vUv;
    float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main() {
      vec2 c = vUv - 0.5;
      float r2 = dot(c, c);
      // Lens fringing: a little red/blue split, only toward the edges.
      vec2 off = c * r2 * uFringe * 12.0;
      vec3 col;
      col.r = texture2D(tDiffuse, vUv + off).r;
      col.g = texture2D(tDiffuse, vUv).g;
      col.b = texture2D(tDiffuse, vUv - off).b;
      // Split toning: cool shadows, warm highlights.
      float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
      vec3 shadows = vec3(0.94, 0.99, 1.06), highs = vec3(1.05, 1.0, 0.93);
      col *= mix(vec3(1.0), mix(shadows, highs, smoothstep(0.15, 0.75, l)), uWarmth);
      // Gentle S-curve and a little more colour.
      col = mix(col, col * col * (3.0 - 2.0 * col), 0.22);
      col = mix(vec3(l), col, 1.08);
      // Vignette.
      col *= 1.0 - uVignette * smoothstep(0.08, 0.62, r2 * 1.6);
      // Film grain (finer on big screens), stronger in the mid tones.
      float n = hash(vUv * uRes + fract(uTime) * 91.7) - 0.5;
      col += n * uGrain * (0.4 + 0.6 * (1.0 - abs(l - 0.5) * 2.0));
      gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
    }`,
};

export class Post {
  constructor(renderer, scene, camera) {
    Object.assign(this, { renderer, scene, camera });
    const size = renderer.getSize(new THREE.Vector2());
    const pr = renderer.getPixelRatio();
    // Multisampled so edges stay as smooth as the plain canvas.
    const rt = new THREE.WebGLRenderTarget(size.x * pr, size.y * pr, { type: THREE.HalfFloatType, samples: 4 });
    this.composer = new EffectComposer(renderer, rt);
    this.composer.setPixelRatio(pr);
    this.composer.setSize(size.x, size.y);
    camera.layers.enable(FLOOR_FX);
    this.render = new RenderPass(scene, camera);
    // The ambient occlusion sees only the solid scene (no cones, labels or name tags).
    this.aoCamera = camera.clone();
    this.gtao = new GTAOPass(scene, this.aoCamera, size.x, size.y);
    this.gtao.blendIntensity = 0.85;
    this.gtao.updateGtaoMaterial({ radius: 0.45, distanceExponent: 1.4, thickness: 1.2, scale: 1.1, samples: 12 });
    this.gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 8 });
    // Only really bright things glow (light panels, lamps): the sunlit white office stays crisp.
    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.28, 0.4, 2.6);
    this.output = new OutputPass();
    this.grade = new ShaderPass(GradeShader);
    for (const p of [this.render, this.gtao, this.bloom, this.output, this.grade]) this.composer.addPass(p);
    this.grade.uniforms.uRes.value.set(size.x * pr, size.y * pr);
    this.level = 2;
    this.t = 0;
  }

  setLevel(level) {
    this.level = Math.max(0, Math.min(2, level));
    this.gtao.enabled = this.level >= 2;
    this.bloom.enabled = this.level >= 1;
  }

  setSize(w, h, pr) {
    this.composer.setPixelRatio(pr);
    this.composer.setSize(w, h);
    this.grade.uniforms.uRes.value.set(w * pr, h * pr);
  }

  // X-ray turns the walls see-through; ambient occlusion from invisible walls would look wrong.
  set xray(on) { this.gtao.enabled = !on && this.level >= 2; }

  draw(dt = 0) {
    const cam = this.camera, ao = this.aoCamera;
    if (this.gtao.enabled) {
      ao.position.copy(cam.position); ao.quaternion.copy(cam.quaternion);
      ao.fov = cam.fov; ao.aspect = cam.aspect; ao.near = cam.near; ao.far = cam.far;
      ao.view = cam.view ? { ...cam.view } : null;
      ao.projectionMatrix.copy(cam.projectionMatrix); ao.projectionMatrixInverse.copy(cam.projectionMatrixInverse);
      ao.updateMatrixWorld(true);
      ao.layers.set(0);
    }
    this.t += dt;
    this.grade.uniforms.uTime.value = this.t;
    this.composer.render(dt);
    // Name tags, bubbles and labels on top, untouched by the grade.
    const r = this.renderer;
    const auto = r.autoClear, shadows = r.shadowMap.autoUpdate;
    r.autoClear = false; r.shadowMap.autoUpdate = false;
    const mask = cam.layers.mask, bg = this.scene.background;
    cam.layers.set(OVERLAY);
    this.scene.background = null;             // (a colour background would paint over the frame)
    r.setRenderTarget(null);
    r.render(this.scene, cam);
    this.scene.background = bg;
    cam.layers.mask = mask;
    r.autoClear = auto; r.shadowMap.autoUpdate = shadows;
  }
}

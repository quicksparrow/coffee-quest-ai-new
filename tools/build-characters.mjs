// Builds web-ready character + animation files from Quaternius CC0 packs.
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { prune, dedup, resample, textureCompress } from '@gltf-transform/functions';
import sharp from 'sharp';
import fs from 'node:fs';

// Source packs (download from quaternius.com, CC0): see README → Characters.
const SRC = process.env.SRC || './assets-src';
const OUT = './public/models';
fs.mkdirSync(OUT, { recursive: true });
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);

async function character({ name, body, lightTex, darkTex, hair }) {
  const doc = await io.read(`${SRC}/base/${body}`);
  const root = doc.getRoot();
  // Drop normal + roughness maps (clothes are painted in a shader; smooth skin reads better at this scale).
  for (const m of root.listMaterials()) {
    m.setNormalTexture(null);
    m.setMetallicRoughnessTexture(null);
    m.setMetallicFactor(0);
    m.setRoughnessFactor(0.65);
    const t = m.getBaseColorTexture();
    if (t && /Superhero/.test(t.getURI())) {
      m.setName('Body');
      t.setImage(fs.readFileSync(`${SRC}/base/${lightTex}`)).setURI('skin.png').setMimeType('image/png');
    }
  }
  // Hair: rigged to the Head bone only, so bake it into Head-local space and parent it to Head.
  const hdoc = await io.read(`${SRC}/hair/${hair}`);
  const hnode = hdoc.getRoot().listNodes().find((n) => n.getMesh());
  const hprim = hnode.getMesh().listPrimitives()[0];
  const hskin = hnode.getSkin();
  const hi = hskin.listJoints().findIndex((j) => j.getName() === 'Head');
  const ibm = hskin.getInverseBindMatrices().getElement(hi, new Array(16));
  const tp = (v) => [
    ibm[0] * v[0] + ibm[4] * v[1] + ibm[8] * v[2] + ibm[12],
    ibm[1] * v[0] + ibm[5] * v[1] + ibm[9] * v[2] + ibm[13],
    ibm[2] * v[0] + ibm[6] * v[1] + ibm[10] * v[2] + ibm[14],
  ];
  const tn = (v) => {
    const r = [ibm[0] * v[0] + ibm[4] * v[1] + ibm[8] * v[2], ibm[1] * v[0] + ibm[5] * v[1] + ibm[9] * v[2], ibm[2] * v[0] + ibm[6] * v[1] + ibm[10] * v[2]];
    const l = Math.hypot(...r) || 1; return r.map((x) => x / l);
  };
  const copyAttr = (acc, fn) => {
    const n = acc.getCount(), size = acc.getElementSize(), arr = new Float32Array(n * size), v = [];
    for (let i = 0; i < n; i++) { acc.getElement(i, v); const o = fn ? fn(v) : v; for (let k = 0; k < size; k++) arr[i * size + k] = o[k]; }
    return doc.createAccessor().setType(acc.getType()).setArray(arr);
  };
  const buffer = root.listBuffers()[0];
  const prim = doc.createPrimitive()
    .setAttribute('POSITION', copyAttr(hprim.getAttribute('POSITION'), tp).setBuffer(buffer))
    .setAttribute('NORMAL', copyAttr(hprim.getAttribute('NORMAL'), tn).setBuffer(buffer))
    .setAttribute('TEXCOORD_0', copyAttr(hprim.getAttribute('TEXCOORD_0')).setBuffer(buffer))
    .setIndices(doc.createAccessor().setType('SCALAR').setArray(new Uint32Array(hprim.getIndices().getArray())).setBuffer(buffer));
  const hmatSrc = hprim.getMaterial();
  const htex = doc.createTexture('hair').setImage(fs.readFileSync(`${SRC}/hair/${hmatSrc.getBaseColorTexture().getURI()}`)).setMimeType('image/png');
  const hmat = doc.createMaterial('Hair').setBaseColorTexture(htex).setRoughnessFactor(0.8).setMetallicFactor(0).setDoubleSided(true);
  if (hmatSrc.getAlphaMode() !== 'OPAQUE') hmat.setAlphaMode(hmatSrc.getAlphaMode()).setAlphaCutoff(hmatSrc.getAlphaCutoff());
  prim.setMaterial(hmat);
  const hmesh = doc.createMesh('Hair').addPrimitive(prim);
  const head = root.listNodes().find((n) => n.getName() === 'Head');
  head.addChild(doc.createNode('Hair').setMesh(hmesh));

  await doc.transform(
    prune(),
    dedup(),
    textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [1024, 1024], quality: 82 }),
  );
  await io.write(`${OUT}/${name}.glb`, doc);
}

async function anims(file, keep, out) {
  const doc = await io.read(`${SRC}/anim/${file}`);
  const root = doc.getRoot();
  for (const a of root.listAnimations()) {
    if (!keep.includes(a.getName())) {
      a.listChannels().forEach((c) => c.dispose());
      a.listSamplers().forEach((sm) => sm.dispose());
      a.dispose();
      continue;
    }
    for (const ch of a.listChannels()) {
      const path = ch.getTargetPath();
      const node = ch.getTargetNode()?.getName();
      // Keep rotations (and the pelvis position for bob/crouch height); drop the rest so
      // clips fit any body proportions on this rig.
      if (path === 'scale' || (path === 'translation' && node !== 'pelvis')) { const sm = ch.getSampler(); ch.dispose(); sm.dispose(); }
    }
  }
  for (const n of root.listNodes()) { if (n.getMesh()) n.setMesh(null); n.setSkin(null); }
  root.listMeshes().forEach((m) => m.dispose());
  root.listSkins().forEach((s) => s.dispose());
  root.listMaterials().forEach((m) => m.dispose());
  await doc.transform(resample({ tolerance: 0.0005 }), prune({ keepLeaves: true }), dedup());
  await io.write(`${OUT}/${out}`, doc);
  console.log(out, root.listAnimations().map((a) => a.getName()).join(', '));
}

await character({ name: 'woman', body: 'Superhero_Female_FullBody.gltf', lightTex: 'T_Superhero_Female_Light_BaseColor.png', darkTex: 'T_Superhero_Female_Dark_BaseColor.png', hair: 'Hair_Long.gltf' });
await character({ name: 'man', body: 'Superhero_Male_FullBody.gltf', lightTex: 'T_Superhero_Male_Ligh.png', darkTex: 'T_Superhero_Male_Dark.png', hair: 'Hair_SimpleParted.gltf' });
await anims('UAL1_Standard.glb', ['Idle_Loop', 'Walk_Loop', 'Walk_Formal_Loop', 'Jog_Fwd_Loop', 'Crouch_Idle_Loop', 'Crouch_Fwd_Loop', 'Interact', 'Idle_Talking_Loop', 'Sitting_Idle_Loop'], 'anims-1.glb');
await anims('UAL2_Standard.glb', ['Consume', 'Idle_TalkingPhone_Loop', 'Idle_FoldArms_Loop', 'Yes'], 'anims-2.glb');

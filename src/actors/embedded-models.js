// Only used by the preview-link build (VITE_MODELS=embed): each model is inlined as a
// base64 string in its own lazily loaded JavaScript chunk, so no .glb download is needed.
export const EMBEDDED = {
  woman: () => import('virtual:model/woman').then((m) => m.default),
  man: () => import('virtual:model/man').then((m) => m.default),
  'anims-1': () => import('virtual:model/anims-1').then((m) => m.default),
  'anims-2': () => import('virtual:model/anims-2').then((m) => m.default),
};

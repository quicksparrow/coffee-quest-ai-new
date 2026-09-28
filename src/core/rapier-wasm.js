// Loads Rapier's WebAssembly as a real .wasm file instead of the base64 copy inlined in the
// "compat" build: ~30% smaller to download and compiled while it streams in.
// vite.config.js points Rapier's internal "./rapier_wasm3d" import at this file.
import * as bg from '@dimforge/rapier3d/rapier_wasm3d_bg.js';
import wasmUrl from '@dimforge/rapier3d/rapier_wasm3d_bg.wasm?url';

const imports = { './rapier_wasm3d_bg.js': bg };
let result;
try {
  result = await WebAssembly.instantiateStreaming(fetch(wasmUrl), imports);
} catch {
  // Some hosts serve .wasm with the wrong content type; fall back to a plain download.
  const bytes = await (await fetch(wasmUrl)).arrayBuffer();
  result = await WebAssembly.instantiate(bytes, imports);
}
bg.__wbg_set_wasm(result.instance.exports);

export * from '@dimforge/rapier3d/rapier_wasm3d_bg.js';

# Coffee Quest

A third-person stealth game about the most dangerous eight minutes of the workday. It's 8:52, your call starts at 9:00 in Meeting 2B, you forgot your badge, and you are not joining without coffee.

Built with Three.js (3D) and Rapier (collisions), bundled with Vite. Runs in any desktop browser. Keyboard only.

## Play locally

You need [Node.js](https://nodejs.org) 20 or newer.

```bash
npm install
npm run dev
```

Then open the address it prints (usually http://localhost:5173).

## Choose your commuter

The start screen lets you play as **Claire** or **Steven** (← → to switch, Enter to start; your pick is remembered). Their outfit color, skin tone and hair color are random every run; press Space on the start screen for a new one.

## Controls

| Key | Action |
| --- | --- |
| ↑ or W | Move forward (a brisk jog: you're late) |
| ← → or A D | Turn |
| ↓ or S | Turn around |
| Shift (hold) | Sprint (spills coffee) |
| C | Crouch on / off |
| X (hold) | X-ray view |
| Space | Do the thing in front of you, or sip coffee |
| P or Esc | Pause (resume with P, Esc, Enter, Space or a click): restart, hints on / off, sound |

## Level 1: "Badge? What Badge?"

Get a coffee, then walk into Meeting 2B on Floor 2. Arriving after 09:00 is allowed but costs points.

- Lobby café latte or the kitchen espresso upstairs, as many as you like: finish your cup and grab another. Dana at reception and Leo at the café have name tags and turn to greet you.
- Past the badge turnstiles: a visitor pass from reception, or the propped mailroom door to the service stairs.
- The elevator is a real car that rides between floors: call it, step in and wait (it leaves on its own after a moment) or press Space to go right away.
- The stairs are one straight flight ending at the Floor 2 stair exit. That door is badge-only, but wait by it for 3 seconds and someone steps out and holds it open.
- Meeting 2B is in the far corner of Floor 2, so you have to cross the whole open office to reach it.

## Deploy (Vercel or Netlify)

Push this folder to a GitHub repository, then import it in Vercel or Netlify. Both detect Vite automatically:

- Build command: `npm run build`
- Output directory: `dist`

## Project layout

```
index.html              HUD, start / pause / end screens
src/main.js             boot, renderer, lights, screens, game loop
src/core/game.js        game rules: clock, score, hints, elevator, goal tracker
src/core/rapier-wasm.js loads the physics engine's WebAssembly as a streamed .wasm file
src/core/               keyboard input, sound
src/world/              level layout, doors and turnstiles, graybox building helpers
src/actors/             the player and the animated characters
src/systems/            follow camera
src/ui/                 HUD updates
```

## Performance notes

- Physics runs at a fixed 60 steps per second and the player is drawn between steps, so movement is equally smooth on 60, 120 and 144 Hz screens.
- Static geometry is merged into one mesh per material, which cut the lobby from about 240 draw calls per frame to about 75 (shadows included).
- Shaders are compiled and textures uploaded before "Press Enter" appears, so there is no hitch when play starts or when X-ray is first used.
- Render resolution adapts: if the frame rate drops below about 45 fps the game lowers its render scale, and it never climbs back to a scale that was too slow.
- The HUD only touches the page when a value changes. Menus redraw the 3D scene only when needed, and the game pauses when the tab or window loses focus.
- Downloads are split so game updates only re-download the small game file: three.js, the physics code and the physics WebAssembly are separate, cacheable files.
- Add `?debug` to the URL to log boot timings and expose `window.__coffeeQuest` for testing.

## Characters

Claire, Steven and the lobby staff use Quaternius's **Universal Base Characters** and **Universal Animation Library** (both CC0, free for commercial use, https://quaternius.com). The base bodies ship undressed, so the office clothes (shoes, trousers, belt, shirt or blouse, collar, tie) are painted on in a shader from each vertex's rest-pose height (`src/actors/character.js`). Walking, hurrying and crouching play at a speed matched to movement so feet don't slide, and sipping coffee blends the drink animation onto the arm while you keep walking.

`public/models/` holds the web-ready files. `tools/build-characters.mjs` rebuilds them from the source packs (needs `npm i -D @gltf-transform/core @gltf-transform/extensions @gltf-transform/functions sharp`).

## Status

Stage 2 of the plan: character select and animated characters, on the graybox level. Next: coworkers with patrols, sight cones, conversations and hiding spots.

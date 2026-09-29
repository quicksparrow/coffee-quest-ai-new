# Coffee Quest

A third-person stealth game about the most dangerous eight minutes of the workday. It's 8:55, your call starts at 9:00 in Meeting 2B, you forgot your badge, and you are not joining without coffee.

Built with Three.js (3D) and Rapier (collisions), bundled with Vite. Runs in any desktop browser. Keyboard only.

## Play locally

You need [Node.js](https://nodejs.org) 20 or newer.

```bash
npm install
npm run dev
```

Then open the address it prints (usually http://localhost:5173).

## Choose your commuter

The start screen lets you play as **Claire** (blonde, blue blouse) or **Steven** (Black, with black hair, white shirt and tie). ← → to switch, Enter to start; your pick is remembered. Everyone in the office has one fixed look too, so you learn who's who.

## Controls

| Key | Action |
| --- | --- |
| ↑ or W | Move forward (a brisk jog: you're late) |
| ← → or A D | Turn |
| ↓ or S | Turn around |
| Shift (hold) | Sprint (spills coffee) |
| C | Crouch on / off |
| X (hold) | X-ray view: coworkers, where they're looking, their routes, coffee, hiding spots and the way up |
| Space | Do the thing in front of you (get coffee, call the elevator, hide, step out, excuse yourself from a chat), or sip coffee |
| P or Esc | Pause (resume with P, Esc, Enter, Space or a click): restart, hints on / off, sound |

## Level 1: "Badge? What Badge?"

Get a coffee, then walk into Meeting 2B on Floor 2. The clock starts at 08:55 and runs three times as fast as real time, so you have 100 seconds. Arriving after 09:00 is allowed but costs points, and the room lets you know it.

Linda (the VP) is presenting in 2B and Sam, your work buddy who texts you tips, is at the table. At 9:00 Monica and Karen stop patrolling and head into the call too. When you walk in, the camera cuts to the room and you get two lines in speech bubbles over people's heads (about five seconds) before the score card. On time: "Right on time. Love that." from Linda, then a quip from Sam. Late: "Oh good. You could join us." (or "Oh! We thought you quit." if you're very late), then Monica ("Per my calendar invite, this started at nine."), Karen ("I'll just make a note of that. For your file.") or Sam. The camera widens its lens to fit everyone in the room, so it works in narrow windows too.

- Lobby café latte or the kitchen espresso upstairs, as many as you like: finish your cup and grab another. Dana at reception and Leo at the café have name tags and turn to greet you.
- Past the badge turnstiles: a visitor pass from reception, or the propped mailroom door to the service stairs.
- The elevator is a real car that rides between floors: call it, step in and wait (it leaves on its own after a moment) or press Space to go right away.
- The stairs are one straight flight ending at the Floor 2 stair exit. That door is badge-only, but wait by it for 3 seconds and someone steps out and holds it open.
- Meeting 2B is in the far corner of Floor 2, so you have to cross the whole open office to reach it.

## Coworkers

Seven chatty coworkers walk their routes: Pat (Accounting) and Tom (Sales) in the lobby, and Priya (IT), Dave (the Storyteller), Monica (the "quick question" manager), Karen (HR) and Josh (the intern) upstairs. Karen patrols the lounge and phone pods and notices hurrying from much farther away: walking fast is against the handbook. Each looks where they're walking. While you're inside someone's cone of sight and in plain view, a meter over their head fills: faster up close or when you sprint, slower when you crouch or wait in a line. When it fills they call out and come over; walk into them, or let them catch up, and you're stuck chatting (it costs time and 300 points; tap Space to excuse yourself sooner).

- Walls, closed doors and, when you crouch, the cubicle partitions block their view.
- Break line of sight and most people give up. Hiding always works (+100): the two phone pods, the supply closet and the lobby plants. Josh the intern won't give up until you hide.
- Rita steps out through the Floor 2 stair door for a smoke and holds it open for you.
- Hold X to see everyone through the walls, with their sight cones and routes, plus every place you can do something on your floor.

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
src/systems/            follow camera, coworkers and stealth, walkable grid and paths, X-ray beacons
src/ui/                 HUD updates, name tags, speech bubbles and meters
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

Claire, Steven, the lobby staff and the coworkers use Quaternius's **Universal Base Characters** and **Universal Animation Library** (both CC0, free for commercial use, https://quaternius.com). The base bodies ship undressed, so the office clothes (shoes, trousers, belt, shirt or blouse, collar, tie) are painted on in a shader from each vertex's rest-pose height (`src/actors/character.js`). Walking, hurrying and crouching play at a speed matched to movement so feet don't slide, and the coffee is carried and sipped with two-bone arm IK: the cup rides upright in front of the hip with the fingers round it, and sipping lifts it to the lips and tips it back (the pack's drink clip only reaches the side of the face), so you can sip while walking.

`public/models/` holds the web-ready files. The game downloads them with a plain request and decodes their textures directly from the file, so it doesn't depend on `blob:` or `data:` addresses that strict hosts block; if they ever fail to load, the start screen says why and you play as a stand-in. For hosts that can't serve `.glb` files at all, `VITE_MODELS=embed npm run build` bakes the models into the JavaScript instead. `tools/build-characters.mjs` rebuilds them from the source packs (needs `npm i -D @gltf-transform/core @gltf-transform/extensions @gltf-transform/functions sharp`).

## Status

Stage 3 of the plan: coworkers with patrols, sight cones, conversations and hiding spots, on the graybox level. Next: objectives and scoring (tailgating through badge doors, the kitchen back door into 2B, the manager's walk to the call).

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

## Controls

| Key | Action |
| --- | --- |
| ↑ or W | Walk forward |
| ← → or A D | Turn |
| ↓ or S | Turn around |
| Shift (hold) | Hurry (spills coffee) |
| C | Crouch on / off |
| X (hold) | X-ray view |
| Space | Do the thing in front of you, or sip coffee |
| Esc | Pause: restart, hints on / off, sound |

## Level 1: "Badge? What Badge?"

Get a coffee, then walk into Meeting 2B on Floor 2. Arriving after 09:00 is allowed but costs points.

- Lobby café latte (slow line) or the kitchen espresso upstairs.
- Past the badge turnstiles: a visitor pass from reception, or the propped mailroom door to the service stairs.
- Upstairs, the stair exit is badge-locked (someone steps out every 40 seconds) and Meeting 2B's door is badge-only. The kitchen back door leads straight in.

## Deploy (Vercel or Netlify)

Push this folder to a GitHub repository, then import it in Vercel or Netlify. Both detect Vite automatically:

- Build command: `npm run build`
- Output directory: `dist`

## Project layout

```
index.html            HUD, start / pause / end screens
src/main.js           boot, renderer, lights, screens, game loop
src/core/             game rules (clock, score, hints, elevator), keyboard input, sound
src/world/            level layout, doors and turnstiles, graybox building helpers
src/actors/           the player
src/systems/          follow camera
src/ui/               HUD updates
```

## Status

Graybox build (stage 1 of the plan): plain blocks instead of art, every route playable end to end. Next: character select with two player models, then coworkers with patrols, sight cones and hiding spots.

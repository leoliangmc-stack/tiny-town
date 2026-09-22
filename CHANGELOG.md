# Changelog

## Phase 1 — Time-lapse vertical slice

- Small handcrafted layout in `world/Town.ts`: five houses and a cafe around one road
  loop, with pavement, trees and twelve street lamps. Procedural geometry only.
- Day and night: a gradient sky dome, hemisphere and directional light, and a sun that
  travels across the town, all interpolated between eight palette stops in
  `render/palettes.ts`. Street lamps come on at dusk and go off at dawn.
- Every window is an emissive pane with its own glow, lit per building: a house is lit
  while somebody is home and awake, the cafe while it is open.
- Five residents in `world/Population.ts` walking a hand written day — sleep, walk to
  the cafe, stay on its terrace, walk home, sleep — with a seeded jitter of a few
  minutes so the town never moves in lockstep. Capsule citizens with a walking bob.
- Default camera framing computed from the screen shape: landscape sits across the
  line the sun travels so dawn and dusk rake across the town; portrait takes a wider
  lens and turns the camera along the long axis of the town.
- The simulation pauses while the page is hidden and stays paused on return, rather
  than catching up on the elapsed time (SPEC.md 2.13).
- Temporary keyboard controls until Phase 6: 1, 2, 3, 4 for the four speeds, space to
  pause.
- Tests: the headless 30 day run now carries the five citizens, and checks that nobody
  is stuck outside for more than 30 game minutes, that everybody stays on their route,
  that everyone reaches the cafe every day, and that the houses go dark after bedtime.

## Phase 0 — Skeleton and test scaffold

- Vite + TypeScript + Three.js project with ESLint and Prettier.
- Simulation layer: `World` with a fixed-step `tick()`, `TimeSystem` (game minutes and days,
  starting at Day 1 05:30), `TickScheduler` that turns frame time into whole ticks, and a seeded
  `Rng`. No Three.js imports, enforced by ESLint and by `tests/architecture.test.ts`.
- Render layer: `render/App.ts` with a scene, a god view camera, orbit controls for mouse and
  touch, resize handling, an empty ground plane, and a frame loop that runs N ticks per frame
  according to speed.
- Vitest suite including a headless 30 game day run and clock checks at 1x, 5x, 20x and 100x.
- GitHub Actions running lint, format check, test and build on every push.

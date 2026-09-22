# Changelog

## Phase 2.5 — Visual style pass and the bigger town

- `DESIGN.md` adopted: cozy living miniature, not low-poly. SPEC 2.3, 2.9, 2.11 and 4.2
  amended first (decisions 21–24), then the code.
- The town grows to 30 houses plus three small apartment blocks on a closed grid of six
  cross streets: about 184 by 114 metres, with the end blocks filled rather than the same
  buildings spread thinner.
- Every house is its own home: gable, hip or flat roof; roof and wall colours from a warm
  low-saturation palette; porch, balcony, fence and flower bed by house number; one sign
  of life per yard (mailbox, bicycle, bin or flower pots). `tests/navigation.test.ts`
  checks no two houses share a look.
- Buildings are rounded boxes with window frames and matte materials. Pavements are raised
  kerbs, junctions carry zebra crossings, the car park has painted bays, the park has a
  path and benches, the cafe terrace has tables and stools, the schoolyard a climbing
  frame. Shrubs and flower beds along the high street.
- Trees are rounder and a little oversized; smooth shading throughout.
- Light: shadows softened (wider filter, capped strength, stronger fill), palettes moved to
  the DESIGN.md colours, the sun arc lengthened to cover the bigger map.
- Camera: about 38° in landscape and 50° in portrait (SPEC 2.9), framed from the real
  layout bounds with the haze starting beyond the far side of the town.
- Citizens are miniature people built from parts — head, hair cap, torso, arms, legs —
  with a procedural walk that swings the legs and arms. Idle gestures wait for Phase 3.
- Second pass, after review: a warm rim light from behind the town at dawn and dusk
  (`rimIntensity` in the palettes); fascia boards under the eaves, ridge caps on gables,
  chimneys on every other house, window sills and door steps; a hair of hue variation per
  wall; and a faint two-green breath in the grass so the ground is not one flat fill.

## Phase 2 — Full map and navigation graph

- The whole town, as data in `world/Town.ts`: a high street with two residential lanes
  and four cross streets, 20 houses, school, cafe, supermarket, bakery, office, park,
  car park, pavements, trees, street lamps and signs. About 160 by 112 metres.
- Outdoor activity zones for every public building, each a rectangle with spawn points:
  cafe terrace, schoolyard with a climbing frame, supermarket forecourt, bakery front,
  office forecourt, and the park lawn with a path and benches. Phase 3 sends citizens
  to them.
- `simulation/Navigation.ts`: a pavement graph (303 nodes) and a road graph (105 nodes),
  both generated from the street data so the map and the graphs cannot drift apart.
  Pavements run down both sides of every street and the four corners of each junction
  are joined, which is both the way round the corner and the two crossings. Every
  building has a door node on the pavement; the car park has a node per space on the
  road graph. Routes are A* and are cached per citizen, recomputed only when the
  destination changes.
- Camera framing is now computed from the real layout bounds and the screen shape, in
  two passes so aiming above the town never crops it. Portrait takes a wider lens and
  looks along the long axis of the town.
- `?debug` draws both graphs and the citizens' current routes over the town.
- Placeholder lighting in `simulation/HouseholdLights.ts` for the houses that have no
  resident yet, so the town does not read as abandoned at night. Phase 3 deletes it.
- Tests: every pair of building entrances is reachable on the pavement graph, every
  parking space is reachable on the road graph, no two buildings overlap, nothing sits
  on a road, every public building has a zone in front of it, and over 30 game days
  every citizen stays on a route that lies on the graph.

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

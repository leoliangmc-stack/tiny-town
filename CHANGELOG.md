# Changelog

## Phase 4 — Vehicles

- `world/Fleet.ts`: eight vehicles. Six private cars to the six longest commutes among the
  adults who would rather not walk them (Rex, Mateo, Maya, Nina, Lucia, Walter), one per
  household; two supermarket delivery vans that Paul and Sven take on their rounds. Everyone
  else walks, which keeps the streets quiet.
- Road graph: kerb parking spaces outside every building (two per home, a few per public
  building, two by the park) as spur nodes, beside the supermarket car park.
- `VehicleSystem`: a vehicle is parked at a node until a citizen takes it; then it follows an
  A* route on the road centrelines, keeps to the right, stops at a red light and behind
  the car in front, and parks at the first free space at the far end, or the nearest free
  space down the street. Two traffic lights on the high street. Cars do 15–18 metres a
  minute against a walker's four. A car waiting on another car does not itself count as
  something to wait for, which is what stops two cars at a corner waiting for each other
  for ever.
- Citizens' `Drive` state is real: on foot to the car, aboard while it drives, on foot from
  the space to the door. A works van does the rounds and nothing else. A car is used only
  when it is parked where the citizen is and there is somewhere to park at the far end, so
  a car is never stranded across town.
- `World.followTarget(citizenId)`: one continuous track for Phase 6's Follow — the
  citizen on foot, the car while aboard, the door while indoors — with a test that the
  hand-off never jumps more than a car length.
- `VehicleView`: rounded bodies, cabins, four wheels that turn, headlights and taillights
  that come on with the street lamps, with a glow and a patch of light on the road ahead
  while moving. Seven instanced parts for the whole fleet; draw calls 204 → 214.
- Tests: over 30 days no two vehicles overlap for more than 5 game minutes and none is held
  for more than 30; every car is home by night; traffic in both rushes; determinism holds
  with vehicles in the state hash.

## Phase 3.5 — Draw call refactor

- `render/InstanceBatch.ts`: collects placements of one geometry and material and builds a
  single `InstancedMesh` for all of them, colour per instance.
- `TownView` rebuilt on it. Every repeated shape in the town is now one draw: window
  frames, sills, panes and glows; lamp poles, heads, bulbs, haloes and pools; tree trunks,
  crowns and pine layers; shrubs; flower beds and blooms; roof fascias, ridges, chimneys,
  doors and steps; kerbs, road slabs, junction patches, markings and zone patches; yard
  props, terrace furniture, park benches, street signs. Walls and roofs of the forty
  buildings and the supermarket sign stay individual meshes.
- Windows keep per-window lighting: the pane's instance colour carries its light amount in
  the red channel and a small shader patch scales the emissive term by it, leaving the
  glass colour alone. Glow quads and lamp haloes are instanced quads turned to the camera
  whenever it moves, in place of sprites.
- Draw calls 4,695 → 204 (renderer counter, main and shadow pass together). Triangles
  498k → 543k, from the shared unit rounded box standing in for a few plain ones. Desktop
  p95 frame time unchanged at about 18 ms on an M4 at 2x, which was never draw call bound;
  the gain is for phones, where submission cost is.
- Before/after screenshots at four moments and two framings differ in under 0.2% of
  pixels at a loose threshold and under 0.02% at a strict one.

## Phase 3 — 60 citizens and the schedule system

- `world/Population.ts`: sixty-three fixed citizens in thirty-three households, one per
  house and apartment, each with name, age, gender, job, four personality traits, home,
  workplace, family links both ways and a few friends (colleagues plus hand picked pairs).
  Jobs map to buildings per SPEC 2.4; doctors practise from the office block. The first
  forty were written first and the other twenty-three added to fill the empty houses
  (decision 25), not regenerated.
- `ScheduleSystem`: a written day per job, copied each morning with ±10 minutes of seeded
  jitter and a few choices tilted by personality: lunch outside, the cafe after work, the
  park for the retired. Leave times are worked out from the real route length. Delivery
  drivers walk two rounds a day to houses until Phase 4 gives them a van, each in their own
  slot of the hour so the vans do not all leave together.
- `CitizenSystem`: appointments started when due, walking there on the pavement graph
  first; an open-ended activity yields to the next appointment, a timed one is seen
  through; a finished errand leads home; a social need that climbs while alone sends
  people out to the cafe terrace on a whim. Everyone stands on their own spawn point in a
  zone. All nine activities from SPEC 2.4; `Drive` is present but unused until Phase 4.
- Windows are lit by who is really at home and awake. `HouseholdLights.ts` is gone, and no
  house is empty, so every window in town takes part in the evening.
- `EventLog`: causes and milestones as full sentences, at most fifteen a day, with colour
  lines (a walk to the park) giving way to milestones (running into a friend, arriving
  late) and the last light going out always written.
- `World.stateHash()` and `tests/determinism.test.ts`: the same seed at 1x and 100x gives the
  same hash at 23:59 on day 2.
- Citizens are drawn as instanced parts, one draw call per body part for the whole town, with
  colour, height and hair length per instance; limbs swing with the stride and standing
  people get small gestures by activity (talking, eating, working, a shopping bag).
- Tests: the 30 day run checks nobody stands still in the open over 30 minutes, late arrivals
  under 10%, every zone visited, somebody outside every daytime hour, and the diary shape.

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

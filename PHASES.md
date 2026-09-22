# Tiny Town — Development Phases

Companion to `SPEC.md` (the single source of truth for requirements) and `DESIGN.md` (the visual direction). Each phase below is written so it can be pasted into a fresh Claude Code session as the task brief. Read `SPEC.md` first in every session, and `DESIGN.md` before touching anything under `src/render/`.

## Working rules for every phase

- One phase per session where possible. Do not start the next phase in the same session.
- Only build what the phase lists. New ideas go into `IDEAS.md`, not into code.
- `src/simulation/` must never import Three.js. If you need to draw something, it belongs in `src/render/`.
- Every phase ends with: `npm test` green, `npm run build` green, a short entry in `CHANGELOG.md`, and a git tag `phase-N`.
- Prefer boring, readable code over clever code. Name things after what they are in the SPEC.
- All identifiers, comments, commit messages, and docs in English.

## Phase 0 — Skeleton and test scaffold

**Goal.** A project that runs an empty simulation for 30 game days with no renderer attached, and a page that shows an empty Three.js scene.

**Scope.**

- Vite + TypeScript + Three.js project. ESLint + Prettier.
- Directories: `src/simulation`, `src/entities`, `src/world`, `src/render`, `src/ui`.
- `simulation/World.ts` with `tick()` and a fixed-step `TimeSystem` (game minutes, days, speed multiplier via ticks-per-frame, never via scaled deltaTime).
- Seeded RNG utility used by all simulation randomness.
- Vitest configured. `tests/headless.test.ts` runs a World for 30 game days with no renderer and asserts it completes.
- GitHub Actions workflow running lint, test, build on every push.
- `render/App.ts` creating a scene, camera, orbit-style controls (mouse + touch), resize handling, and a render loop that calls `world.tick()` N times per frame according to speed.
- `CLAUDE.md` pointing at `SPEC.md` and this file.

**Out of scope.** Any buildings, citizens, UI.

**Acceptance.**

- `npm test` passes the 30-day headless run.
- Speed can be set to 1, 5, 20, 100 in code and the game clock advances accordingly.
- Page loads on desktop and phone showing an empty ground plane.

## Phase 1 — Time-lapse vertical slice (the most important phase)

**Goal.** Prove the hero moment. A small town where day turns into night and lights respond to citizens' schedules. If this does not look good at 20×, stop and iterate here before moving on.

**Scope.**

- Handcrafted fixed layout, small version: 5 houses, 1 public building (the cafe), one road loop, a few trees, street lamps. Layout defined as data in `world/Town.ts`.
- Procedural low-poly geometry only (boxes, cylinders, cones). No external models.
- Every window is an emissive material controlled per house.
- Day/night: sky color, ambient and directional light, sun direction interpolated across four palettes (dawn, day, dusk, night). Palettes live in one file so Claude Design output can be dropped in.
- Street lamps switch on at dusk, off at dawn.
- 5 capsule citizens (body + head, color variation) with a hardcoded simple schedule: sleep → walk to cafe → stay → walk home → sleep. Windows of a house are lit only when someone is home and awake.
- Simple bobbing walk animation. Citizens walk along the road for now (nav graph comes in Phase 2).
- Speed control exposed via a temporary keyboard shortcut (1/2/3/4 keys) and pause on space.
- Default start Day 1, 05:30, default speed 5×.

**Out of scope.** Real navigation, the full population, cars, weather, UI panels.

**Acceptance.**

- Record 20× for one full day. The author judges the clip good enough to post. Otherwise iterate on palettes, lamp glow, window timing, camera angle.
- Headless test still passes with the 5 citizens.
- Runs at 60 fps on desktop and does not fall below 30 fps on a mid-range phone.

## Phase 2 — Full map and navigation graph

**Goal.** The complete fixed town with a walkable and drivable network that guarantees no citizen ever leaves the paths or enters a wall.

**Scope.**

- Full layout per SPEC 2.3: 20 houses, school, cafe, supermarket, bakery, office, park, parking lot, roads, sidewalks, trees, lamps, signs.
- Each public building has a defined outdoor activity zone (polygon with spawn points).
- `simulation/Navigation.ts`: two graphs, sidewalk (pedestrian) and road (vehicle), defined as data alongside the layout. A* over the graph. Path cache per agent, recomputed only when the destination changes.
- Buildings expose an entrance node on the sidewalk graph and, where relevant, a parking node on the road graph.
- Camera default framing computed from screen aspect ratio: portrait pulls back or rotates so most of the town fits on screen.
- `?debug` URL flag renders the nav graphs and current paths as line overlays.

**Out of scope.** Citizen behaviour beyond what Phase 1 had, cars, weather.

**Acceptance.**

- Headless test: every pair of entrance nodes is reachable on the sidewalk graph; every parking node is reachable on the road graph.
- Headless test: for 30 days, all citizen positions are within tolerance of a graph edge or inside a building footprint.
- Visual check on desktop and portrait phone: most of the town is visible at default zoom.

## Phase 2.5 — Visual style pass and the bigger town

**Goal.** Replace the low-poly placeholder look with the direction in `DESIGN.md`, and grow the town to the size in SPEC 2.3. Only what already exists is restyled here; people animation beyond walking, cars, weather and UI keep their own phases and follow this style when they arrive.

**Scope.**

- Town grows to about 30 houses plus 2–3 small apartment blocks. Streets extended and closed into a full grid so the outer blocks read as part of the town. Density does not drop.
- Every house is visibly different: roof form and colour, wall colour, porch / balcony / fence / garden, and one or two signs of life (mailbox, flower pots, bin, bicycle). Variation is deterministic from the house number.
- Buildings: rounded edges, smooth shading, matte materials, window frames, restrained trim. Public buildings each get one distinguishing feature.
- Palette per `DESIGN.md` §10: warm, low saturation. Roads warm grey, pavements warm beige-grey, grass warm sage.
- Light: soft shadows (lower shadow intensity, softer edges, stronger fill), warm rim at dusk, the night kept beautiful.
- Plants: rounder, slightly oversized trees; shrubs and flower beds along streets and in gardens.
- Camera default tilt: about 40° landscape, about 50° portrait (SPEC 2.9).
- Citizens: the miniature body (head, hair, torso, arms, legs) with a procedural walk that moves the legs, replacing the capsule. Idle gestures wait for Phase 3.

**Out of scope.** New behaviours, cars, weather, UI, and the decorative items listed in `IDEAS.md`.

**Acceptance.**

- All existing tests pass with the bigger layout; the navigation tests cover every entrance and parking space.
- Dawn, day, dusk and night screenshots on desktop and portrait judged by the author against `DESIGN.md`.
- No drop below the Phase 2 frame rate on desktop.

## Phase 3 — 60 citizens and the schedule system

**Goal.** A fixed population living autonomous, slightly desynchronised days, driven by a rule-based state machine.

**Scope.**

- `world/Population.ts`: about 60 fixed citizens with name, age, gender, personality (social, energy, outdoorPreference, workPreference: 0–100), home, workplace, family links (spouse, parents, children, siblings), friends. Families share a house, and every house and apartment in the town has somebody living in it (SPEC 2.4, decision 25).
- Jobs per SPEC 2.4 mapped to buildings. Students → school. Retired → home/park.
- `ScheduleSystem`: per-citizen daily template with ±10 min seeded jitter applied at day start.
- `CitizenSystem` state machine: Sleep, Eat, Work, Walk, Drive (stub until Phase 4), Shop, Socialize, Relax, GoHome. Transitions based on time, schedule, personality thresholds (e.g. socialNeed > 70 → find social activity in a nearby zone).
- Miniature people per `DESIGN.md` §5–6: hairstyle, clothing colour, body shape and age variation; idle gestures (look around, turn, phone), and the simplest possible versions of talking, shopping (a bag), eating and working motions where a behaviour needs them. Procedural part animation only.
- Outdoor zones populated: a portion of workers/students spend part of the day in their building's outdoor zone.
- Window lights now driven by real occupancy.
- `EventLog`: records causal and milestone events only, as full sentences. Cap ~15 per day.
- Rendering: instanced citizen parts with per-instance colour.

**Out of scope.** Cars actually driving (citizens who would drive walk for now), weather, UI.

**Acceptance.**

- Headless 30-day run: no citizen stuck in one place > 30 game minutes outside Sleep/Work; late-to-work rate < 10%.
- Determinism test: run the same seeded day at 1× and at 100× and compare a hash of the full world state at 23:59. Must match.
- Visual: town is never empty during daytime; night shows staggered lights-out.

## Phase 3.5 — Draw call refactor

**Goal.** The same picture from a fraction of the draw calls. With sixty citizens the desktop frame sat at a p95 of 18 ms on an M4 because the town was 4,695 draw calls: every window, lamp and tree its own mesh. A mid-range phone will not survive that, and Phase 4 adds cars on top. Bring it under 200 before anything else is built.

**Scope.**

- Repeated objects become `InstancedMesh`, grouped by geometry and material: window frames, panes, sills and glows; lamp poles, heads, bulbs, haloes and light pools; tree trunks, crowns and cones; shrubs; flower beds and blooms; roof trim, chimneys, doors and steps; kerbs, road slabs, junction patches, zone furniture; whatever else the profile shows.
- Lit windows keep per-window control: brightness goes through `instanceColor` (or a per-instance attribute) into the emissive term, so one window can be on while its neighbour is off.
- Buildings themselves (walls, roofs) stay individual meshes; there are only about forty.
- A small batching helper so `TownView` stays readable: collect placements, build the instanced meshes once.

**Out of scope.** Any new feature or visual element, cars, weather, UI. Nothing about the simulation changes.

**Acceptance.**

- Screenshots at the same four moments and both framings before and after are indistinguishable to the eye. Any place where instancing would cost an effect is raised, not decided.
- Per-window lighting, lamps at dusk, and per-house deterministic variation all still work.
- All tests pass; the determinism test is untouched.
- Desktop draw calls under 200; before/after table of draw calls, triangles and p95 frame time.

## Phase 4 — Vehicles

**Goal.** Roads look alive. Some citizens commute by car.

**Scope.**

- 8 vehicles as simple box geometry, owned by citizens or workplaces (delivery driver).
- `VehicleSystem`: depart from home parking, follow road graph, park at destination parking node, return.
- Citizen Drive state: walk to car → ride → walk from parking to entrance. Camera-follow must handle the hand-off smoothly later.
- Simple traffic lights at 1–2 intersections; vehicles stop on red and keep a minimum gap to the vehicle ahead.
- Vehicles noticeably faster than pedestrians.

**Out of scope.** Lane changes, congestion, collisions between vehicles and pedestrians beyond basic avoidance.

**Acceptance.**

- Headless 30-day run: no two vehicles overlapping for > 5 game minutes; no vehicle stuck > 30 game minutes.
- Determinism test still passes.
- Visual at 20×: cars visibly commute morning and evening.

## Phase 4.6 — Environment and sky

**Goal.** Put the town in a place (SPEC 2.14, DESIGN.md §20): sea and beach on the north side, a real sky by day and by night, hills and forest around, and a little traffic after dark.

**Scope.**

- Sea and sand: a curved shoreline north of the town, a sand strip, a water shader with a slow swell and a reflection band under the sun or moon, coloured from the palettes.
- Sky: the dome shader gains a sun disc with a halo, drifting clouds tinted by the hour, stars, a faint Milky Way and a moon with a halo; all driven by the time palettes and the sun position already in `Environment.ts`.
- Distance: rings of hills and mountains as a few large meshes, a forest of instanced trees between the town and the hills, all under the existing fog so distance reads as haze.
- Night traffic: one or two car owners go out to the cafe in the evening, so headlights cross the dark streets.
- Palettes gain sea, cloud and star values per stop.

**Out of scope.** Weather, buildings, UI. Anything animated here (clouds, swell) is render-side only and never touches the simulation or the state hash.

**Acceptance.**

- Draw calls and p95 frame time reported before and after; the environment costs single-digit draw calls.
- Screenshots at the four moments and both framings, plus one of the sea and beach, one of clouds by day, and one of the night sky, judged by the author against DESIGN.md.
- All tests pass; determinism untouched.

## Phase 5 — Weather and behavioural effects

**Goal.** Weather that changes what citizens do, not just how the town looks.

**Scope.**

- `WeatherSystem`: Sunny, Cloudy, Rain. Settable instantly; smooth visual transition over a few seconds of real time.
- Visual: sky/light palette shift, rain particles (instanced, reduced count on mobile), wet ground reflectivity, umbrella mesh on citizens who are outside in rain.
- Behaviour rules per SPEC 2.8: outdoorPreference gates park visits in rain; more citizens choose Drive; some outdoor plans are cancelled and redirected to the cafe; this must be able to produce a cafe encounter between two citizens and log it as one causal sentence.
- Above-head icon: umbrella only (☂) as part of the rain effect. Hidden at 20× and 100×.
- Temporary weather keys (S/C/R) until UI exists.

**Out of scope.** Sound, other icons, seasons.

**Acceptance.**

- Headless test: switch to Rain at 10:00 on a sunny day; outdoor count drops by a meaningful margin within 30 game minutes compared to the control run.
- At least one "because of the rain..." event appears in the log on a rainy day in the 30-day run.
- Determinism test still passes with weather changes scripted into the seeded run.

## Phase 6 — Interaction and UI (desktop and mobile)

**Goal.** Restrained UI that works identically on desktop and portrait phone, plus citizen selection and Follow.

**Scope.**

- Shared components, two layouts:
  - Desktop/landscape: weather (top-left), town overview (top-right), citizen panel (right), time bar (bottom).
  - Portrait: top-left capsule `Day 12 · 08:42 · ☀` (tap weather icon to cycle), bottom time bar, three-state bottom sheet (collapsed: one-line latest event; half: overview + log; full: complete log). Selecting a citizen switches the sheet to their panel with a Follow button; tapping empty space restores.
- Town overview: Day, time, population, outside count, cars, weather, live.
- Citizen selection by raycast on click/tap (with generous hit radius on touch).
- Citizen panel: name, age, job, home, family, current activity, friends. No technical data.
- Follow mode: smooth camera tracking, stable through building entry/exit and car hand-offs; Stop Following returns smoothly to the god view.
- Remove temporary keyboard shortcuts or keep them as hidden power-user keys.

**Out of scope.** Log-to-camera fly-to, social icons, sound, settings menu.

**Acceptance.**

- SPEC Test 4 and Test 5 pass on desktop and on a real phone in portrait.
- In portrait at default zoom, UI covers less than ~25% of the screen and most of the town remains visible.
- Lighthouse or equivalent shows no layout shift on load.

## Phase 7 — Performance, polish, and release

**Goal.** Ship v1.

**Scope.**

- Mobile degradation tiers: shadows off, reduced rain particles, capped devicePixelRatio, post-processing off. Choose tier by GPU/timing heuristic on first frames.
- Bundle size audit; target < 2 MB first load.
- Camera polish: easing, zoom limits, no clipping through ground.
- Animation polish: walk bob, umbrella open/close, lamp warm-up.
- README: 20× time-lapse GIF at the top, one-line description, demo link, architecture section (simulation/render separation, headless tests, determinism), asset attribution section (CC0 sources), MIT license.
- Deploy to static hosting; CI deploys on tag.
- Final run of all five SPEC acceptance tests on desktop and phone, recorded.

**Out of scope (v1.1 backlog).** Local save/reset, ambient audio, log fly-to, social icons, interiors.

**Acceptance.**

- 60 fps desktop, ≥ 30 fps mid-range phone across a full 20× day.
- All SPEC 5.2 tests pass; SPEC 5.3 metrics green in CI.
- The author's own 20× recording is good enough to post. If not, v1 is not done.

## v1.1 backlog (do not start before v1 ships)

- Local persistence: save day/time/weather/speed; rebuild citizen positions from schedules on load; time frozen while away; Reset Town in a settings menu.
- Ambient audio: 3–4 CC0 loops crossfaded by time and weather, default muted, 🔇 toggle.
- Event log entries clickable → camera flies to the event location (handle "actor has left" gracefully).
- Additional above-head icons (💬 social, ☕ cafe), max 3–5 on screen, 2–3 s fade, hidden at high speed.
- Consider Blender-generated building set as a drop-in replacement for the procedural one; simulation layer unchanged.

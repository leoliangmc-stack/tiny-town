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

## Phase 4.7 — The Greek island remake

**Goal.** Give the town a vernacular (SPEC 2.3, 2.11, decision 29; DESIGN.md §1, §4, §7, §9): a white Cycladic village on a slope above the sea. The author's answer to "every building looks the same". Too much for one session done well, so it runs in two rounds with a tag each.

**Round A — ground, buildings, landmarks (tag `phase-4.7a`).**

- Terrain: a heightfield in `world/Terrain.ts` (pure function, no Three.js) that tilts the town towards the sea, low at the shore and two to three storeys higher inland, flat under the beach and the sea. The renderer reads it for the ground mesh, streets, pavements, zones, props, citizens and vehicles; the simulation stays two dimensional and the state hash never sees a height.
- Buildings rebuilt in `TownView`: stacked white cubes with flat roofs and parapets, plinths that take up the slope, external stairs, a few blue domes; coloured doors and shutters per house; one theme colour per shop through awning, door frame and sign; wide ground-floor glazing on shops; roof props (washing lines, pots, tanks on homes; air conditioning, vents, tanks on shops). 80% of houses white, 20% washed in pale ochre, rose or yellow.
- Landmarks: the blue-domed church at the top of the slope with a warm lamp on the dome at night; the lighthouse on the headland with a beam that sweeps every few seconds, render-side only.
- Existing trees, streets and navigation untouched in this round.

**Round B — ground cover, lanes, the high street (tag `phase-4.7`).**

- Vegetation: olives, cypresses, agaves and cacti replace the temperate trees on the streets and the slope; dry earth and limestone ground; the park keeps its lawn and big trees; bougainvillea on a handful of houses as instanced quads.
- Lanes and steps: a second, pedestrian-only network of narrow lanes and stairs paved in pale stone with white joints, joining every house to the streets; the sidewalk graph is rebuilt on it; the road graph and the cars are untouched.
- The shops move shoulder to shoulder along the high street.
- Tests: every door reachable on the new graph; nobody stuck or off the graph across 30 days.

**Out of scope.** Camera and night tilt (Phase 4.6 stands), weather, UI, the simulation.

**Acceptance (both rounds).**

- All tests green; determinism untouched; after Round B the reachability test covers every entrance.
- Draw calls and p95 frame time reported; everything repeated is instanced.
- Lit windows remain the brightest thing in the night.
- Screenshots in `docs/phase-4.7-screenshots/`: the four moments in both framings, plus a close-up of white walls and coloured shutters, the high street, the church, the lighthouse beam at night, and one that shows the slope.

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

## Phase 7.1 — Post-release fixes

**Goal.** Three fixes from the author's look at the live demo, and boats on the sea (SPEC
decisions 32 to 34).

**Scope.**

- The lighthouse works only in the dark: its lamp room, halo and beam follow their own
  beacon factor (on from 20 minutes before sunset to 20 minutes after sunrise) rather than
  the street lamps, and follow it quickly enough that 100x does not drag it into the morning.
- Boats: two sailboats, a fishing boat and a distant ferry, render side, on real time,
  bobbing, with a wake, and a small lamp at night.
- Kerb parking out of the traffic lane: spaces half up on the kerb with a painted bay, parked
  cars parallel to the street and facing the traffic; the driving lane moves in to make room.
- The two vans go out about once an hour through the working day.

**Acceptance.**

- At noon at any speed, no part of the lighthouse glows.
- Boats are visible on the sea in the default view by day and by night.
- No parked car stands in a driving lane or across the street; vehicle tests stay green.
- Cars are driving in every daytime hour from 08:00 to 16:00 except around the lunch break.

## Phase 7.2 — v1 gaps, rainbows and Mid-Autumn night

**Goal.** Close the v1 gaps found against the SPEC after release, and two additions the
author asked for (SPEC decisions 35 to 37).

**Scope.**

- Traffic lights drawn: a post on each corner of the two signalled junctions, each head
  showing red, amber or green from the phase the cars obey.
- Sign lamps: a shop's sign glows at night while the building is lit.
- Chimney smoke: the bakery while open; a white chimney on every third house, smoking
  while somebody at home eats.
- Street lamps warm up over the same few game minutes at any speed above 5x.
- Doctors work at a clinic on the office's ground floor, marked by a green cross; the SPEC
  is changed rather than a clinic built.
- Rainbow after rain by day: about 85%, a third of them double; render side.
- Mid-Autumn night: a 🏮 switch; dark at once, a full moon, every window lit, lanterns,
  fireworks on the beach; render side, the simulation untouched.
- Portrait: the weather and the lantern as a row of glyph buttons under the capsule.

**Acceptance.**

- Cars waiting at a junction wait at a visible red.
- At 100x the street lamps are out by the middle of the morning.
- Turning the rain off by day brings a rainbow most times.
- Mid-Autumn night shows the full moon and fireworks in the default view, landscape and
  portrait.
- Tests, build and lint green; determinism untouched.

## Phase 7.3 — Rainbow button and a bigger Mid-Autumn night

**Goal.** The author changed their mind on the rainbow and asked for a fuller Mid-Autumn
night (SPEC decisions 38 and 39).

**Scope.**

- Rain is only rain: no rainbow when it stops. A 🌈 button cycles a rainbow, a double
  rainbow and none; it stays up until turned off, fainter in cloud, rain and at night.
- Mid-Autumn night is always clear: turning it on sets Sunny; Cloudy, Rain or the rainbow
  turn it off first.
- Beach fireworks: more of them, salvos, and five burst kinds (peony, chrysanthemum,
  willow, ring, crackle).
- Town fireworks: small, low shells from rooftops, the square and the park.
- The Moon Palace (Guanghan Palace) on a cloud in front of the full moon, kept in line with
  the moon from any camera; a tap on it flies the camera in to Chang'e holding the Jade
  Rabbit, and "Back to town" flies out.
- Three dragons, gold, red and jade, circling over the town, each chasing a glowing pearl.
- All render side, on real time, at every speed.

**Acceptance.**

- Turning the rain on and off never brings a rainbow; the 🌈 button always does.
- Mid-Autumn night in the default view shows the palace in the moon, the dragons, and
  fireworks both on the beach and over the town, landscape and portrait.
- A tap on the palace shows Chang'e and the rabbit close up.
- Tests, build and lint green; determinism untouched.

## Phase 7.4 — Umbrella icon rules

**Goal.** Bring the ☂ icon in line with SPEC 2.10. It showed over every citizen outside
for as long as it rained; the SPEC allows three to five icons on screen, each fading out
over two to three seconds.

**Scope.**

- The icon marks the moment an umbrella goes up (rain starts, or somebody steps out into
  it), for citizens the camera can see.
- At most four icons at once; an icon offered while all four are showing is dropped, not
  queued. Each lives 2.5 s, fading in and out. The same person waits 20 s for another.
- Hidden at 20x and 100x, as before.

**Acceptance.**

- Unit tests for the cap, the lifetime, the fade and the cooldown.
- Tests, build and lint green; determinism untouched (render side only).

## Phase 8 — v1.1: persistence, ambient sound, a clickable diary, more icons

**Goal.** The v1.1 list from SPEC 4.2: the town remembers where it was, it can be heard,
the diary takes the camera to what happened, and the icons say a little more.

**Scope.**

- Persistence (SPEC 2.13, decision 41): save day, minute, weather and the chosen speed to
  local storage every few seconds and when the page is hidden or closed. On load, rebuild
  by starting the World at 03:00 of the saved day (the day before if the save is earlier)
  with the saved weather and fast-forwarding headless to the saved minute. No save means
  Day 1 05:30 as before. ⚙ settings with "Reset town".
- Ambient sound (SPEC 2.12, decision 40): four beds synthesised with Web Audio (dawn
  birds, the street and the sea by day, rain, night insects), crossfaded by the shown hour
  and the weather, muted by default, a 🔇 button in the corner, silent while hidden.
- Clickable diary (SPEC 2.10): entries carry who and where; a click flies the camera to
  the place and selects the citizen if they are still there, or says they have moved on.
  A diary card bottom left on the desktop (decision 42).
- Icons (SPEC 2.10): 💬 when somebody joins a conversation outdoors, ☕ when somebody sits
  down on the cafe terrace, under the same rules as ☂.

**Acceptance.**

- Reloading the page brings back the same day, time, weather and speed; the citizens are
  where their schedules put them; Reset town starts again at Day 1 05:30.
- Restoring the same save twice gives the same state hash; every citizen is on the map.
- The sound button starts the ambience, which follows the time of day and the rain.
- Clicking a meeting in the diary flies to the cafe terrace and selects one of the two.
- Tests, build and lint green; the 1x/100x determinism test untouched.

## v1.1 backlog

- Consider Blender-generated building set as a drop-in replacement for the procedural one; simulation layer unchanged. Not scheduled: it needs an external asset pipeline, which SPEC 4.2 still rules out.

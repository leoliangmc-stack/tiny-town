# Changelog

## Phase 7.4 — Umbrella icon rules

SPEC 2.10 allows three to five icons on screen, each fading out in two to three seconds.
The ☂ icon stood over everybody outside for as long as it rained, so a rainy street showed
twenty of them at once.

- `render/OverheadIcons.ts`: a scheduler with four slots and a pool of four billboards,
  each with its own material so each fades on its own. An icon lives 2.5 s (0.3 s in,
  1 s out); one offered while the slots are full is dropped, not queued; the same person
  waits 20 s for another. Four draw calls at most, none when nothing is showing, in place
  of an instanced plane per citizen.
- The umbrella icon now marks the moment an umbrella goes up, when rain starts or somebody
  steps out into it, and only for citizens inside the camera's view. Still hidden at 20x
  and 100x; switching to those speeds takes down the ones showing.
- Tests: the cap, the lifetime and fade, the freed slot, the cooldown, the clear at speed.

## Phase 7.3 — Rainbow button and a bigger Mid-Autumn night

SPEC decisions 38 and 39. The author changed their mind on the rainbow and asked for a
fuller Mid-Autumn night.

- Rain is only rain: turning it off no longer brings a rainbow (decision 36 is replaced).
  A 🌈 button (key `B`) cycles a rainbow, a double rainbow and none; the rainbow stays up
  until it is turned off, fainter in cloud, in rain and at night. The weather row shows it
  active, with a small 2 when it is double; the status and the capsule show 🌈.
- Mid-Autumn night is always clear: turning it on sets Sunny, and Cloudy, Rain or the
  rainbow turn it off first. The weather buttons, the capsule and the keys all go through
  `App.setWeather` for this.
- Fireworks (`src/render/Fireworks.ts`, split out of `Festival.ts`): the beach launches
  about three times as often, with salvos of three to five shells, and five kinds of
  burst: peony, chrysanthemum with tails, gold willow, tilted ring and strobing crackle.
  Small low shells go up from the bigger roofs, every third house, the square and the
  park. One point cloud of up to 12,000 sparks with a free list; about 5,500 in the air on
  average, 0.14 ms of script a frame.
- The Moon Palace (`src/render/MoonPalace.ts`): white jade terraces, red pillars, green
  glazed double roofs, two pavilions with galleries, lanterns and an osmanthus tree, on a
  cloud 820 m out along the moon's direction. The sky dome is centred on the town, so the
  moon's disc is drawn where the line from the camera through the palace meets the dome,
  which keeps the palace in the moon from any camera; the light and the glint on the sea
  keep the fixed moon, so shadows do not swing. A tap on the palace flies the camera out in
  3.2 seconds to Chang'e on the cloud before the stairs, holding the Jade Rabbit, her
  ribbon streaming; "Back to town" flies home.
- Dragons (`src/render/Dragons.ts`): gold, red and jade, 44 m long, circling the town at
  36 to 56 m on breathing loops, a wave running down each body, legs paddling, each
  chasing a glowing pearl. The body is a tube rebuilt each frame from the head's path a
  moment earlier; six draw calls a dragon.
- `src/render/shapes.ts`: painted, merged primitives, a Chinese hip roof, and a material
  that glows by its own vertex colour so the figures read at night without a lamp.
- `tests/midautumn.test.ts`: the rainbow cycle, fireworks over both the beach and the
  town within the pool, the moon lined up behind the palace from three cameras, and the
  dragons staying above the rooftops.

## Phase 7.2 — v1 gaps, rainbows and Mid-Autumn night

SPEC decisions 35 to 37.

- Traffic lights (`src/render/TrafficLights.ts`): four posts at each of the two signalled
  junctions, each head facing the traffic that keeps right on the way in, showing red,
  amber for the last quarter minute of a green, or green, from `VehicleSystem.isGreen`.
  The lit lamp carries a glow that grows at night.
- Sign lamps: every shop and public building has a small hood over its sign and a warm
  glow that follows the building's windows.
- Chimney smoke (`src/render/Smoke.ts`): a white Cycladic chimney on every third house
  and the bakery's flue, 11 in all. Puffs rise, drift and thin out while somebody at home
  is eating, or while the bakery is open. One instanced draw call with per-puff opacity.
- Street lamps warm up over 2.2 real seconds up to 5x and proportionally faster above, so
  at 100x they no longer burn on into the morning.
- The clinic: the SPEC now says doctors work on the office's ground floor, and a green
  cross hangs by the office door. No new building.
- Rainbow (`src/render/Rainbow.ts`): turning the rain off by day brings one 85% of the
  time, 30% of those double, the secondary fainter with its colours reversed. It stands
  over the sea with its top near the top of the picture, fades in as the rain clears,
  holds 40 game minutes or 12 real seconds, whichever is longer, and fades out. Its own
  seeded dice; the simulation never knows.
- Mid-Autumn night (`src/render/Festival.ts`, 🏮 button, key `M`): the picture jumps to a
  fixed 21:30 whatever the clock says; a full moon, larger and warmer than the crescent,
  hangs half way up the sky the night framing shows; every window lights; 188 red
  lanterns hang from the street lamps and in strings between them; fireworks go up from
  the sand and burst in gold, red, pink, green and blue-white. The simulation runs on
  underneath, so the clock in the corner keeps its own time; the status and the capsule
  show 🏮.
- Portrait: the weather buttons and the lantern now show as a row of glyphs under the
  capsule; before, the weather could only be cycled by tapping the capsule.
- A stylesheet fix: `.tt-ui button` reset the background of buttons that are cards (the
  capsule, the return pill) and of active buttons, so the capsule had no card behind it
  and the active weather and speed were never highlighted. Both show now.

## Phase 7.1 — Post-release fixes

Three fixes from the author's look at the live demo, and boats (SPEC decisions 32 to 34).

- The lighthouse only works in the dark. Its lamp room, halo and beam used to share the
  street lamps' factor, which comes on in the dusk an hour and a half before sunset and
  eases on 2.2 real seconds, so at 100x the beam swept on into mid-morning. It now has
  its own beacon factor, on from 20 minutes before sunset to 20 minutes after sunrise,
  followed on a 0.25 s ease. At 100x it is out by 06:32 and lit by 19:59.
- Boats (`src/render/Boats.ts`): two sailboats circling inshore, a fishing boat running
  along the coast and a ferry crossing far out, its ends in the haze. Hull, cabin, mast,
  sails, a pale wake and a small lamp at night; bob, roll and a sailboat's heel. Real
  time, render side, visible at every speed, six draw calls.
- Parked cars no longer stand in the traffic. Kerb spaces move out to half up on the
  pavement (3.3 m from the centreline, was 2.4) with a painted bay, the driving lane moves
  in (1.2 m, was 1.7), and a car that parks at the kerb straightens up along the street
  with the kerb on its right. Before, a parked car sat in the lane at whatever angle it
  drove in, and at the start of the day every car faced north across its street.
- The two vans go out about once an hour between 08:10 and 15:20, around the lunch
  break, the second 25 minutes behind the first; the drivers on foot keep their two
  rounds. Over three days the vans made 63 trips, was 17, and cars are on the road in
  every hour from 07:00 to 21:00.

## Phase 7 — Performance, polish and release

The last v1 phase (PHASES.md Phase 7), with three small fixes from the Phase 6 review.

- Follow indoors: when the followed citizen goes inside, the camera eases back to about
  twice its distance over a second, so the building and its street are in the picture
  and it is plain where they went; it comes back in when they come out. No interiors in
  v1; the idea is in IDEAS.md with a cost estimate.
- Words: students walk "to school" and are "in class at school"; delivery drivers are
  "delivering to Ash House" or "driving a delivery to Yew House" rather than "working,
  out at Green Grocer".
- Day 1 lateness: the town opens at 05:30 in the middle of the bakers' first shift, so
  lateness is not counted on Day 1 and the diary no longer opens on a row of "got to the
  bakery forty minutes late". SPEC 2.2's 05:30 opening is untouched.
- Quality tiers (`App.setQuality`, key `Q`): high (pixel ratio ≤ 2, 2048 shadow map,
  full rain), medium (≤ 1.5, 1024, half the rain), low (1, no shadows, a quarter of the
  rain). A touch device in portrait starts on medium; then the first 90 measured frames
  after warm-up drop a tier if more than half are slower than 24 ms, at most twice. There
  is no post-processing pass to turn off.
- Camera: never below the ground plus 2.5 m, however it is dragged; the target stays
  above the ground too.
- Animation: umbrellas unfurl and fold over 0.45 s as the arm comes up; street lamps warm
  up over 2.2 s with a small flicker on the way; the walk bob stays as it was.
- README with the 20x time-lapse, a one-line description, the architecture (simulation
  and render apart, fixed ticks, determinism, headless tests, instancing), deployment,
  assets (none: everything is generated) and the MIT licence. `docs/media/timelapse.gif`
  is a day at 6 game minutes a frame, 640×360, 5.6 MB; an MP4 of the same is in the
  Phase 7 screenshots.
- Deploy: the author chose Vercel. `vercel.json` sets the Vite build, the output
  directory, a year of caching on hashed assets and the Sydney region (which only
  functions would use; the site is static and served from the CDN). The project is
  linked to the author's account as `tiny-town`. `.github/workflows/deploy.yml` tests,
  builds and publishes to production on every `v*` or `phase-*` tag with the Vercel
  CLI in prebuilt mode, so a tag is the release; it needs the `VERCEL_TOKEN` secret.
- Bundle: 745 kB of JS (199 kB gzip) plus 4.5 kB of CSS; about 200 kB on the wire.
- Acceptance: SPEC 5.2 tests 1 to 5 run on the desktop and recorded in
  `docs/phase-7-acceptance.md` with the frame times per tier. The phone column is the
  author's to fill in on a real device.

## Phase 6 — Interaction and UI

The observation tools over the town (SPEC 2.9, DESIGN.md §15), in `src/ui/`.

- One set of components, two layouts by stylesheet. Wide screens: weather top left,
  town status top right, the selected citizen on the right, play and the four speeds
  along the bottom. Portrait: a capsule top left with the day, the time and the weather
  (tap to cycle it), a fixed time bar at the bottom, and above it a sheet that opens in
  three steps: collapsed shows the latest diary line, half shows the town status and the
  diary, full the diary at length. Translucent ivory cards, deep grey text, sage for the
  active state, warm orange for the one action. In portrait at default zoom the UI covers
  11% of the screen; there is no layout shift on load (CLS 0).
- Town status: day, time, people, outside, cars on the road, weather, live.
- Selection: a tap on the canvas picks the citizen drawn nearest to it within 18 px by
  mouse or 36 px by touch, counting only people who can be seen (on foot or in a car). A
  press that moves or lingers is a camera gesture, not a tap. The panel says who they
  are and what they are doing in plain words from `ui/phrases.ts`: name, age, job, what
  they are doing now ("Walking to work", "Chatting on the cafe terrace"), home by its
  name, family by relation and name, friends by name. No ids, no state. In portrait the
  sheet opens to the panel; tapping empty ground closes it and restores the sheet.
- Follow: the camera flies to the citizen over 1.4 s and stays with them, keeping the
  viewer's bearing and letting them orbit and zoom. The followed point is eased over
  0.22 s, so the hand-offs at doors and car doors that `World.followTarget` already
  smooths never jump. Stop following flies back to the default framing and hands the
  camera to the night tilt. Measured with Playwright following Rex from home to the
  car to the office at 5x over 26 s: four hand-offs (foot, car, foot, indoors), largest
  camera move between frames 1.6 m, on both layouts.
- Back to town: once the viewer has dragged, wheeled or pinched, a small pill appears
  (bottom right on desktop, top right in portrait) that flies the camera home and gives it
  back to the automatic framing; it goes away on arrival.
- Keys 1 to 4, space, S, C and R stay as hidden power-user keys; nothing in the UI names
  them.
- `App` gained `pickCitizen`, `follow`, `stopFollowing`, `returnToTown`, `cameraTaken`
  and a per-frame listener the UI reads from; no town logic lives in the UI. Draw calls
  84, p95 17.5 ms with the UI mounted. Tests: the panel's words for every citizen at
  five times of day carry no ids and match the state.

## Fix — pavements that stop at the junction

The author circled stubs of pavement standing in the road at every junction.

- Cause: each pavement was one box the length of its street plus a pavement's width at
  either end, laid straight through every junction. A cross street's pavements therefore
  overshot its own tarmac by 2.6 m into the lane it met, over the zebra crossing, and
  the lanes' and the high street's pavements ran unbroken across every cross street. The
  flat junction slab was meant to hide this, but the kerbs are raised and stood proud of
  it. The tan pavements of earlier phases made it hard to see; the pale stone made it
  plain.
- Fix: a pavement is now drawn as segments that stop at the tarmac of every crossing
  street that continues on its side, carry on past the ones that end there, and wrap the
  corner at the street's own ends. The corner squares of a junction where both streets
  carry on are filled in on their own. Nothing is drawn twice, so nothing z-fights, and
  the kerb line follows each segment.

## Fix — paving that reads as paving

The author asked why there were dirt tracks along the roads. There were none: the
pavements were the colour of the earth.

- Cause: the pavement kerb boxes are drawn through the stone material, whose colour is
  already the pale stone, and each instance was tinted with the same colour again. The
  tint is multiplied, so the pavements came out the square of the stone colour, a tan a
  shade from the dry ground, and from above the pavement, the lane and the earth between
  them fused into one earth-coloured band. The pedestrian lanes, drawn with a white
  instance tint, were a little paler but still warm.
- Fix: the kerb boxes take a white tint and let the material carry the stone; the stone
  goes cooler and paler (near white, with the flagstones a light grey and the joints
  pure white); the earth goes a touch more ochre; and a painted kerb line runs along the
  earth side of every pavement and both sides of every lane, so paving ends in a line.
  The tarmac stays its warm grey and now sits between two clear edges.

## Fix — props off the paving

The author found lamps, plants and patches of light in the middle of the road.

- Cause: three lists in `world/Town.ts` were placed by coordinate with no check against
  the streets. Street lamps were spaced from one end of a street to the other, and a
  street's ends lie inside a junction, so sixteen lamps stood on the crossing street's
  tarmac; at dusk each threw its nine metre pool of light into the middle of the
  junction, which is the "yellow road" the author saw. The high street's shrubs and two
  agaves were listed at the cross streets' own x, so they stood on the tarmac too; a few
  olives and shrubs stood in the supermarket car park; the agaves along the promenade
  and the upper lane sat on the lane itself.
- Rule: `pavedAreas()` lists every patch of paving (streets to the tarmac or to the
  pavement edge, lanes and steps, the car park and its apron, the square), `pavingUnder()`
  tests a disc against them, and `offPaving()` nudges a point out by the shortest way,
  giving up when there is nowhere to go. Every tree, shrub and succulent list now passes
  through it before export, and a junction lamp slides along its own street to the
  pavement past the crossing rather than being placed in the road. The two flower beds
  by the square move inside the cross streets' pavements. Lamps 48 → 43, trees 54 → 52,
  shrubs 20 → 18; nothing else changed.
- Regression tests: every lamp is off the tarmac, lanes, car park and square; every
  tree trunk, shrub, succulent and flower bed corner is off all paving, pavements
  included; and the rule has not emptied the town.

## Phase 5 — Weather and behavioural effects

Weather that changes what the citizens do, not just how the town looks (SPEC 2.8).

- `simulation/WeatherSystem.ts`: Sunny, Cloudy, Rain, set at once from outside and
  written into the diary as one line ("Rain set in over the town at 09:30."). The weather
  is in the state hash, and the determinism test now scripts five changes into its run
  at fixed ticks, so the same seed still gives the same world at 1x and 100x.
- The rain rules in `CitizenSystem`. Anyone with an outdoor preference under 80 gives
  up the park and the break outside when it rains: the sociable (social 45 and over) go
  to the cafe terrace instead, the rest go home, and workers on a break go straight back
  in. It applies to people already there, to people on their way (they turn round), and
  to appointments that fall due later in the rain. Car owners take the car even for a
  short hop. A whim to go out needs more restlessness. The hardy stay on, under an
  umbrella, and the diary says so.
- The diary. Rain decisions taken in the same tick are written as one sentence
  ("Because of the rain, Clara, June and Sam gave up on the park and went to the cafe
  instead."); after the first two rain lines of a day the rest are colour, so a wet
  morning does not crowd out the afternoon. Two people the rain sent to the cafe who
  meet there get the line the author asked for: "June and Sam, both driven in by the
  rain, got talking on the cafe terrace." A rainy day's diary is in
  `docs/phase-5-eventlog-rainy-day6.txt`.
- The look. Overcast greys and darkens the sky, the haze, the ambient and the sun, thins
  the shadows, thickens the cloud layer and hides the stars and the moon; rain brings
  the haze in a little. Rain streaks fall in a box around the camera target as one
  instanced mesh (1,600 on desktop, 550 in portrait). The ground, roads and paving go
  darker and glossier as they get wet, and the lamps pool wider; the town dries out over
  six seconds after the rain stops. Everyone outside opens an umbrella held in the
  right hand, in one of six colours, with an umbrella icon over the head that hides at
  20x and 100x. The picture eases between weathers over about two seconds.
- Keys until the UI arrives: S, C and R for Sunny, Cloudy and Rain.
- Tests: rain at 10:00 leaves 4 people in the open where the control run has 12 thirty
  minutes later; a month with rain every third day writes the causal lines and the cafe
  meeting, keeps everyone moving and on the map; determinism holds with the weather
  scripted in. Draw calls 86 in the rain (85 dry) at 1x and 5x; p95 18.7 ms.

## Phase 4.8 — Country and wildlife

The author saw the dry ground outside the town read as desert (SPEC 2.14, decision 30;
DESIGN.md §9, §21).

- The ground is zoned. The dry earth stays on the town's coastal shelf; past its edge
  the ground fades over a forty-five metre band into grass, with no line, and the
  meadows beyond roll gently. Each vertex of the ground heightfield carries the blend as
  a colour, and `world/Terrain.ts` exposes it as `countryside(x, z)` so the woods, the
  animals and anything else can ask how far out they are. The rolling dies away
  towards the shore so the sea stays a plane.
- The distant forest is now broadleaf and conifer woodland in stands with open grass
  between them, and the hills are green. The mountains stay grey.
- Wildlife in `render/Wildlife.ts`: six rabbits and two deer in the meadows, eight
  small birds and five gulls. Rabbits nibble with the head down, then hop in a burst of
  a few bounds and stop again. Deer graze, then raise the head and stand listening,
  then walk to a new spot with the legs swinging. Birds sit on parapets, lamp tops and
  cypress tops, then fly to another perch on a curve with wingbeats up and a glide down.
  Gulls wheel over the water and the sand in slow banked circles with an occasional
  flap, come down to the sea wall, the lighthouse gallery or the beach, and go up again.
  At night the birds stay put and the gulls come in.
- All of it is render side, on real time, from its own seeded generator: the
  simulation, the state hash and the navigation graphs never see an animal. Hidden at
  20x and 100x, as the icons over the citizens are. Three instanced parts (a blob, a
  box, a wing) draw the whole menagerie, each in the main and the shadow pass: draw
  calls 79 → 85 by day and 86 by night at 1x and 5x, and 79 and 80 again at 20x and
  100x where the animals are hidden; p95 frame time 18.5 ms by day, 18.2 ms at night.

## Phase 4.7 — The Greek island remake, round two: ground cover, lanes, the high street

Completes the remake begun in Phase 4.7a (SPEC 2.3, 2.11, decision 29; DESIGN.md §4, §7,
§9).

- Planting. Olives with leaning trunks and loose silver-green crowns line the high street
  and stand in the empty house slots with cypresses between them; cypresses mark the
  corners of the town and the church. The ground is dry earth-yellow; the park's whole
  block is lawn with its big round green trees, the one green place in town. Agaves and
  cacti stand along the lanes, by the square and by the church. The distant forest and
  the hills changed with them: olive crowns and cypress spires on dry ground, so the
  slope and the hills are one country.
- Bougainvillea on five houses: a cloud of small magenta and green quads climbing the
  front wall beside the door and over a pergola across it. One instanced batch; the only
  saturated colour in the style, rationed.
- Lanes and steps. A seafront promenade behind the northern houses with a low white sea
  wall, an upper lane behind the southern ones below the church, and at every cross
  street a flight of solid stone steps with white noses joining lane to pavement; a path
  of steps up to the church door. The outer house rows turned round to face the lanes, so
  their doors, stairs, flower beds and props are on the pedestrian network and the cars
  stay behind them. Pavements, lanes and the square are paved in pale stone with white
  joints, textured in world space so every slab tiles alike.
- The sidewalk graph gained the lanes: a line of nodes down each, shared where lanes
  cross, and each flight of steps joined to the pavement corner it leads to. Two new
  tests: every outer-row door joins a lane, and every flight of steps reaches a pavement;
  the existing test that every entrance can walk to every other still holds, and the 30
  day run keeps nobody stuck or off the graph.
- The high street. The bakery moved across to stand wall to wall with the cafe, so the
  north side is one parade of shops: school, cafe and bakery, supermarket, each filling
  its block from pavement to pavement. Where the bakery stood there is now a small paved
  square with a fountain and two benches. The cafe and bakery terraces sit side by side in
  front of them.
- Draw calls 73 → 79 by day and 80 by night (stone paving, steps, bougainvillea, agaves,
  cypresses); p95 frame time 18.3 ms by day and by night. Lit windows remain the brightest
  thing in the night.

## Phase 4.7a — The Greek island remake, round one: ground, buildings, landmarks

The author's answer to "every building looks the same" (SPEC 2.3, 2.11, decision 29;
DESIGN.md §1, §4, §7). Round two brings the dry planting, the lanes and steps and the
terraced high street.

- `world/Terrain.ts`: the ground leans towards the sea. Flat under the sand, it rises
  nine metres across the town, linearly in z so every slab of road, pavement and paint
  laid at the height of its centre and tilted to the grade meets the ground exactly, and
  climbs on gently to the hills. The ground is a heightfield; streets, zones, props,
  trees, lamps, citizens, vehicles, the forest, the beach and the hill rings all read
  the same function. The simulation stays two dimensional; the state hash never sees a
  height.
- Buildings rebuilt in the island vernacular. Every one stands on a plinth of pale
  stone that takes up the slope. Houses are two stacked white cubes: a full ground
  storey and a smaller upper storey set back to one side, leaving a roof terrace with a
  parapet, and on most a solid stair up the front to it; four carry a small blue dome.
  Doors, shutters and window frames take one colour per house from the island set (sea
  blue, deep blue, green, teal, wood). Six of the thirty houses are washed pale ochre,
  rose or yellow; the rest are white. Terraces carry a washing line, pots, a water tank
  or a chair. Shops and public buildings are single white cubes with one theme colour
  each through door, awning and sign (cafe ochre-red, bakery mustard, supermarket sea
  blue, school terracotta, office slate, apartments olive), wide glazing on the ground
  floor front, and air conditioning, a vent and a tank on the roof.
- Two landmarks. The church at the top of the slope: a white nave under a deep blue
  dome, a bell tower with open arches, a cross, deep blue door and windows, and a warm
  lamp on the dome at night. The lighthouse on the headland: a white tower with a red
  band on a rock, a lamp room, and a beam that sweeps round every six real seconds,
  the one light in the night that moves; at 20x it reads as a slow pulse.
- Walls are now instances of one rounded unit box, so the whole town's walls are one
  draw call where forty meshes were. Draw calls 221 → 73 by day and 74 by night (the
  beam); p95 frame time 17.7 ms by day, 18.3 ms at night.
- Camera framing includes the church; the target and the framed height follow the
  slope.

## Phase 4.6 — Environment and sky

Revised again for the camera (decision 28): the default view could not see the sky.

- Default pitch lowered from 38° to 28° in landscape and from 50° to 38° in portrait, with
  the aim point raised a little, so a band of sky sits at the top of the frame all day and
  the whole town still fits. Below 28° the town flattened into a strip; this is the point
  between seeing the sky and seeing the town.
- After dark the default camera tilts down further, to 18° in landscape and 28° in
  portrait, bringing the stars in over the lit town, and comes back up before dawn. The
  move is driven by game time over about an hour, centred twenty minutes after sunset and
  twenty before sunrise; at 20x it reads as one slow pan.
- The free view wins: a drag, wheel or pinch that moves the camera ends the automatic
  framing for good, and nothing pulls it back. A press that does not move it (a future
  click on a citizen) leaves the framing in charge. Rotating the phone reframes as before.
- The Milky Way is a step brighter and warmer; the windows still lead.

Revised after the author saw the first night: the night sky is now a hero (decision 27).

- The sky shader draws a Tekapo night. Three tiers of stars: a few dozen leading stars
  placed once with the seeded generator and handed in as uniforms, each with a bloom and a
  four-point spike; hundreds of middling stars and a dust of thousands of faint ones from
  hash grids laid on the faces of a cube, so every patch of sky is even and no cell shows
  its edge. Every star has a magnitude drawn from a steep distribution and a colour from a
  table of real star temperatures: blue-white, white, yellow-white, yellow-orange,
  orange-red. The Milky Way is a broad bright band with a dense warm core over the sea,
  ragged edges, clumps and rifts from warped noise, and a dark dust lane that splits it.
  The moon is a crescent with a soft terminator, maria, limb darkening and faint
  earthshine, under a halo kept well below the stars; nights are clear of cloud.
- Night palette stops go darker at the top of the sky so the stars have a floor; window
  lights, street lamps and car lights are untouched and stay the brightest things in the
  frame.
- All of it stays in the one sky draw call: draw calls 221, p95 frame time 18.1 ms in the
  night god view and 18.9 ms with the sky filling the frame.

- `render/Scenery.ts`: the place around the town. A sea to the north behind a curved
  beach (`coastZ`), drawn as one shader plane: a deep colour that shallows towards the
  sand, a faint slow swell, a foam line along the shore, and a band of glint stretched
  towards the sun or the moon. A forest on the three landward sides as three instanced
  meshes (trunks, round crowns, pines, about 900 trees), a ring of hills and a ring of
  mountains behind, each one mesh whose ridge wanders in height and distance, with the
  ridge dropping away over the water so the sea reaches the horizon between headlands.
  Seven draw calls, none casting shadows; all of it under the fog so distance reads as haze.
- `render/Environment.ts`: the sky dome now draws the whole sky in one shader: the
  gradient, a sun disc with a halo, drifting clouds lit from the sun's side, and at night
  stars that twinkle, a faint Milky Way arching over the sea, and a moon with a shaded
  edge and a halo. Every colour comes from the palette stops, which gained sea, cloud,
  sun, star and moon fields, so dawn gold, noon blue, dusk orange and the night's moon
  path fall out of the same eight stops. The moon crosses the northern sky, over the
  water, so its glint lies in the default view.
- The camera's far plane moved from 900 to 2,500 m so the dome is never clipped when the
  camera sits off centre.
- The sea shader blends the fog after tone mapping, as Three.js's own materials do,
  so haze on the water matches haze on the hills.
- `world/Fleet.ts` and `ScheduleSystem`: Lucia and Mateo drive out to the cafe most
  evenings, so headlights cross the dark streets after the last commute.
- Cloud drift, swell and twinkle are render side animation driven by real time; nothing
  here is read by the simulation or the state hash.
- Draw calls 214 → 221 (sky already counted, plus sea, beach, hills, mountains and three
  forest meshes); p95 frame time unchanged at about 18.8 ms on an M4 at 2x.

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

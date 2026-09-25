# Tiny Town — Visual Design

This is the visual direction for the whole project: the "Claude Design" deliverable that
`SPEC.md` 2.7 and 2.11 refer to. Where a choice here touches requirements, `SPEC.md` has
been amended to match and remains the source of truth for _what_ is built; this document
says _how it should look_. Anything here that is not in the SPEC for v1 lives in
`IDEAS.md` until it is scheduled.

## 1. Direction

**Cozy living miniature 3D town, in the manner of a Greek island.**

A carefully made model town on a tabletop, except the people and cars inside it live their
own lives. Miniature model, animated film, city sandbox and desk toy, all at once.

Since Phase 4.7 the town has a place and a vernacular (SPEC 2.3, 2.11, decision 29): a
white Cycladic village on a slope above the sea, Santorini rather than a temperate suburb.
White cubic houses with flat roofs, a few blue domes, coloured shutters and doors, dry
ground with olives and cypresses, a park as the one green oasis, a blue-domed church on the
hilltop and a lighthouse on the headland. The miniature feel, the soft edges, the warm
light and the living world stay exactly as they were; only the vernacular changed.

Keywords: cozy, miniature, handcrafted, stylized 3D, warm, clean, charming, cinematic,
living world, whimsical, premium casual, Aegean.

The viewer should feel: _"this is a town that lives inside my computer, and I can open it
any time to see what everybody is up to."_ Not: _"this is a 3D game map."_

## 2. Not this

- Realistic cities or people
- Cyberpunk, anime, gacha, chibi big-head proportions, anything over-childish
- Complex realistic materials or PBR texture work
- Plain low-poly game look (flat shading, hard facets as the style)
- Traditional city-builder look
- Game HUD: coins, health bars, experience bars

Overall: refined, warm, simple, and easy to keep looking at.

## 3. Modelling

Stylized 3D, miniature-model feel. Nothing needs to be realistic, but there must be enough
detail to read as a place where people live.

Buildings: simple geometry, **soft rounded edges**, a handmade feel, slightly exaggerated
proportions, clear silhouettes, a few well-chosen decorations. They must never read as
plain boxes. In the Aegean vernacular the volumes _are_ cubes, so the work goes into the
stacking (a smaller upper storey set back to leave a roof terrace), the plinth that meets
the slope, the parapets, the external stairs, the domes and what stands on the roofs.

Everything stays procedurally generated in code (SPEC 2.11). Rounded boxes, smooth
shading, matte materials and restrained detail are what separate this from "low poly",
not external models.

## 4. Buildings

The town has: detached houses, a few small apartment blocks, a school, a cafe, a
supermarket, a bakery, an office, a park, a car park, roads, pavements, street lamps,
mailboxes, trees, flower beds and fences; and, since Phase 4.7, a church and a lighthouse.

**The vernacular (Phase 4.7).** White cubic volumes, flat roofs, a low parapet round every
roof. Most houses are two stacked cubes: a full ground storey and a smaller upper storey
set back to one side, leaving a roof terrace with a parapet and an external stair up to it.
A few houses carry a small blue dome on a white drum. Every building stands on a plinth
the colour of pale stone that takes up the slope, so the walls stay level and the ground
does not. Walls are matte white; edges stay soft.

**White, eight parts in ten.** About 80% of houses are pure white; the rest are washed in
pale ochre, pale rose or pale yellow, scattered over the slope to break up the white. No
more than that: the light already colours the walls through the day (rose at dawn, white
at noon, orange at dusk, blue at night), and more wall colour would fight the palettes.

**Homes and shops are told apart by coloured parts.**

- A house has door and shutters in one colour drawn per house from the island set: sea
  blue, deep blue, green, teal, natural wood. Its ground floor is solid wall with small
  windows. Its roof carries signs of life: a washing line with a few coloured cloths, pots,
  a white water tank, a chair.
- A shop or public building has one theme colour that runs through its awning, door
  frame and sign (cafe ochre-red, bakery mustard, supermarket sea blue, school terracotta,
  office slate blue, apartments olive). Its ground floor is glazed wide, with an awning,
  seating outside and a sign; its roof carries equipment: air conditioning units, vents, a
  water tank. Shops sit shoulder to shoulder along the high street; houses stand apart on
  the slope.

**Every house must still be visibly its own home**: the stacking, the dome or no dome, the
shutter colour, the wash, the stair side and the roof props combine differently on every
one. A few signs of life per house, never a pile of them.

**Two landmarks.** A **blue-domed church** at the top of the slope: a white nave with a
deep blue dome, a white bell tower with open arches, a cross, and one warm lamp on the
dome at night. A **lighthouse** on the headland at the shore: a white tower with a red
band, a lamp room, and a beam that sweeps round once every few seconds. Every other light
in the night is still; the beam is the one that moves, and at 20x it turns into a slow
pulse. The dome is the one clear cool colour among the whites; it answers the sea.

## 5. People

**Stylized miniature people**, like figures from a fine model set, not mobile-game
characters.

- Body slightly small, head slightly large but not exaggerated
- Minimal features; clear human silhouette; simple hairstyle
- No facial expressions, no anime eyes, no chibi proportions

People are told apart by hairstyle, clothing colour, body shape, age and accessories. Even
from the god view it should be roughly clear who is who.

Built from a few parts (head, hair, torso, arms, legs) so limbs can move; no skeletal
animation system, no imported models (SPEC 2.11, 4.2).

## 6. People animation

Nothing may slide like a board-game piece. At minimum:

- **Walking**: a natural bob with the legs actually moving
- **Standing**: occasionally look at a phone, look around, turn, wave
- **Talking**: two people facing each other with small gestures
- **Shopping**: carrying a bag
- **Eating**: a simple eating motion at the cafe or at home
- **Working**: a simple motion at the workplace

None of it needs to be complex. It needs to make the person look alive. The walk and a
couple of idle gestures come first; the rest arrive with the behaviours that use them
(PHASES.md Phase 3).

## 7. Roads, lanes and steps

Cozy small-town roads: narrow, simple pavements, small lamps, a few signs, zebra crossings,
parking bays. No big-city roads.

Road: neutral warm grey. Pavement: warm beige-grey. Nothing garish.

**Two layers since Phase 4.7.** The road grid stays as the main streets and the ring the
cars use. Between the houses and the streets runs a second network for people only:
narrow lanes and flights of steps paved in pale stone with white-painted joints, the
Cycladic ground. People walk the lanes; cars keep to the streets; the two are visibly
apart, and the morning rush reads clean.

**The slope.** The whole town tilts towards the sea: low at the shore, two or three
storeys higher inland. Streets run with the slope; buildings follow the ground under them.
From the god view the roofs no longer share one plane, and the light stacks them.

## 8. Cars

Stylized miniature cars: slightly exaggerated, rounded, simple. Family car, small SUV,
delivery van, taxi. Simple but clear lights, windows, wheels and body colours. Headlights
on at night; wet reflections in rain.

## 9. Plants

Soft, slightly exaggerated shapes. Trees may be a little larger than life so the town
reads as a miniature. Not realistic foliage.

**Dry in town, with one oasis (Phase 4.7).** Streets and slope: olive trees (silver-grey
green, loose crowns), cypresses (dark green, tall and thin: the vertical lines of the
skyline), agaves and a few cacti; the ground between is dry earth-yellow and pale
limestone. The park keeps its green lawn and big trees as the one green place in town.
**Bougainvillea**, magenta, climbs the white walls and pergolas of a handful of houses:
the one saturated colour in the whole style, and rationed like it.

**Green outside (Phase 4.8, decision 30).** The dry ground belongs to the town's coastal
shelf. Past the edge of the town it fades, over a band of a few dozen metres with no hard
line, into grass; beyond that are meadows on rolling ground and stands of woodland, and
the hills and the far forest are green, never bare. The two belong together the way a
Mediterranean coast does: dry rock at the shore, wooded hills inland.

## 10. Colour

Warm, natural, low saturation throughout.

| Role      | Name        | Hex       |
| --------- | ----------- | --------- |
| Primary   | Warm Ivory  | `#F5F0E6` |
| Secondary | Sage Green  | `#8FAF8F` |
| Accent    | Warm Orange | `#E6A15C` |
| Road      | Warm Gray   | `#77736B` |
| UI text   | Deep Gray   | `#3F403C` |

Buildings since Phase 4.7: white first (`#F7F4EE`), with pale ochre, rose and yellow
washes on a fifth of the houses; shutters and doors in sea blue `#3F7FB8`, deep blue
`#2B4C8C`, green `#4E8A6A`, teal `#3F8F8A` and wood `#9A7452`; domes in deep blue
`#2F4E9A`; shop themes ochre-red `#C9705F`, mustard `#D9A83E`, sea blue `#3F7FB8`,
terracotta `#C27A5A`, slate `#5B7691`, olive `#7E8A5A`; bougainvillea magenta
`#C93A7A`, used sparingly. Never fluorescent colours or neon. The old ivory, sage and warm
orange remain the UI colours.

## 11. Light

Soft, global-illumination feel. **No harsh hard shadows.**

- Day: soft sunlight, shadows that are clear but not harsh, warm highlights
- Dusk: orange-yellow sun, longer shadows, warm rim light on buildings
- Night: deep blue ambient, warm yellow light inside houses, street lamps, car lights

**The town at night must be beautiful.** When people go home they must not simply vanish:
windows light up, lamps come on, car lights pass, a few people are still out. It should
feel like everybody has gone home to live, not disappeared.

## 12. Time of day

- Morning: pale yellow sun, long shadows, people leaving home, cars increasing
- Noon: bright, short shadows, the busiest hour
- Afternoon: sun warming, people heading home
- Sunset: orange light, people home, streets going quiet
- Night: deep blue sky, house lights, lamps, car lights, a few people about

## 13. Weather

Sunny, Cloudy, Rain. Weather changes both the picture and what people do (SPEC 2.8).
Rain: raindrops, wet roads, small puddles, umbrellas, drips from eaves, car lights
reflected. It is a variable of the world, not a filter.

## 14. Camera

God view, isometric-like 3D. Pan, rotate, zoom, all smooth. Default is a **moderate
downward tilt** (about 28° landscape, about 38° portrait, tilting further after dark; SPEC
2.9) so buildings, roads, people, cars and the park are all visible at once and a band of
sky stays at the top of the frame.

Selecting a person: the camera glides to them. Follow: the camera glides after them. No
teleporting, no shaking, no wild rotation. It should feel like moving a small camera over a
model on a table.

## 15. UI

Minimal, modern, quiet. No game HUD. The 3D town is the subject; the UI is a set of
observation tools.

- Top left: weather (`☀ Sunny · ☁ Cloudy · ☂ Rain`)
- Top right: town status (name, day, time, population, outside, cars, weather)
- Bottom: play/pause and `1× 5× 20× 100×`
- Right: the selected person (name, age, job, home, current activity, family, friends,
  `Follow`)

Translucent, lightweight, never covering the town. Warm Ivory, Sage Green, Warm Orange,
Deep Gray; no pure black. Buttons with slight rounding and a soft shadow.

## 16. Materials

Matte, soft, slightly handcrafted. No mirror reflections, no strong metal, no realistic
PBR, no complex textures. A very light touch of surface roughness, hand-painted feel or
edge variation is welcome so nothing looks machine-generated.

## 17. Signs of life

Small details that help the viewer understand what is happening, not decoration for its own
sake.

- Houses: bicycle, flower pots, mailbox, bin; on the roof a washing line, pots, a tank
- Cafe: outdoor tables and chairs, a chalkboard, parasols
- School: playground, basketball hoop
- Park: benches, lamps, flower beds, a small fountain
- Roads: parking bays, signs

## 18. Read from afar, detail up close

Every event should carry information at several distances. Rain: from far away the whole
town darkens; at middle distance people carry umbrellas; up close there are drops, puddles
and wet road.

## 19. The moments that matter

1. **Morning** — dozens of people leaving their houses, cars appearing, the town waking up
2. **Noon** — streets, cafe, school and park all busy
3. **Dusk** — people going home, warm light, windows coming on
4. **Night** — quiet streets, lit houses, car lights crossing the town
5. **Rain** — umbrellas out, wet streets, more cars, the park emptying

## 20. Environment and sky

The town sits in a place, not on a green table (SPEC 2.14).

- **Sea and beach** to the north. A curved shoreline that follows the town rather than a
  straight edge; a strip of pale sand; water with a slow swell and a reflection that takes
  the colour of the hour: gold at dawn, blue at noon, orange at dusk, a moon path at
  night. Never a mirror.
- **Sky.** By day a real sun with a soft halo and slow, soft-edged clouds that drift; at
  dawn and dusk the clouds take the light. Every colour in the sky comes from the time
  palettes in `render/palettes.ts`; the sky never argues with the ground.
- **The night sky is a hero.** Think of Lake Tekapo, the dark sky reserve: a sky so full
  of stars that it has depth. A few bright stars lead, thousands of faint ones carry the
  ground behind them, and the eye can tell their colours apart: blue-white, white, yellow,
  orange-red, in the proportions real stars come in. The bright ones have a soft bloom and
  a hint of a spike. The Milky Way is a broad, bright, structured band, with a dense core,
  a dark dust lane splitting it and soft ragged edges, seen at a glance rather than found.
  The moon is a crescent or a half: a clear face with maria, a soft halo, and no skyglow
  that could wash the stars out. Stars and moon together, "the stars gathered round the
  moon".
- **Distance.** Green hills and woodland around the town, grey mountains beyond, all
  fading into the sky colour with distance. Enough to fill the horizon, never enough to
  compete with the town.
- **A world beyond the town** (SPEC 2.14, decision 44). The town is one place among
  others. Neighbouring villages, a road out, boats that leave and come back: each hints at
  somewhere past the frame. Neighbours are read, not studied: by day a scatter of white
  cubes in the haze, by night a handful of warm pinpricks, fewer as the night goes on.
  They are always fainter and smaller than anything in the town; a neighbour that pulls
  the eye away from the town is too big or too bright. The country road is plain tarmac
  with no kerbs or lines, narrower than a town street, draped over the rolling ground.
- **The floor under the spectacle.** By day the town and its windows are the subject and
  clouds and sea are kept quiet. By night the sky may be spectacular, but the windows,
  street lamps and car lights must still be the brightest, warmest things in the picture.
  If a starfield ever makes a lit window look dim, the starfield is wrong.
- **Cost.** Sky, clouds, stars, Milky Way, moon and sea are shaders on a few large
  meshes, never particles; distant trees are instanced. Their motion is render-side only.

## 21. Wildlife

Small life outside the town and in the air (SPEC 2.14, decision 30), the way a real place
has it: glimpsed, not counted.

- **Rabbits** in the meadows and at the edge of the woods, a few at a time: they hop in
  short bursts, stop, and nibble with the head down. **Deer**, rarer and further off: a
  head-down graze, then the head up and still, listening, then a slow walk to a new spot.
- **Birds** anywhere: a few small birds that fly from perch to perch across the town, with
  wingbeats and glides, and sit a while on a roof parapet, a lamp, a tree top before the
  next flight.
- **Gulls** on the sea side: they wheel in slow circles over the water and the sand,
  mostly gliding, and come down on the sea wall, the lighthouse gallery or the beach.
- **Rationed.** A handful of each, never a herd or a flock: the viewer should notice one
  now and then, not watch a zoo. At 20x and 100x they are hidden, as the icons over the
  citizens' heads are, so the fast picture stays clean; by night the birds are at rest.
- **Alive or absent.** A still animal reads as a toy. Every one has a motion of its own:
  the hop, the nibble, the raised head, the wingbeat, the wheel. Nothing slides.
- **Render side only.** Like the clouds and the swell, the animals run on real time in the
  renderer, from their own seeded generator; the simulation, the state hash and the
  navigation graphs never know they exist. Every kind is one instanced part or two.

## 22. Priorities

1. Overall town composition
2. Consistent building style
3. Recognisable people
4. People movement
5. Day and night light
6. Weather
7. Car animation
8. Environmental details
9. UI
10. Decorative details

Never trade frame rate, clarity or legibility of the town for model detail. The 3D town is
always the subject; the UI is always secondary.

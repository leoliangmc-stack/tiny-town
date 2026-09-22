# Tiny Town — Visual Design

This is the visual direction for the whole project: the "Claude Design" deliverable that
`SPEC.md` 2.7 and 2.11 refer to. Where a choice here touches requirements, `SPEC.md` has
been amended to match and remains the source of truth for _what_ is built; this document
says _how it should look_. Anything here that is not in the SPEC for v1 lives in
`IDEAS.md` until it is scheduled.

## 1. Direction

**Cozy living miniature 3D town.**

A carefully made model town on a tabletop, except the people and cars inside it live their
own lives. Miniature model, animated film, city sandbox and desk toy, all at once.

Keywords: cozy, miniature, handcrafted, stylized 3D, warm, clean, charming, cinematic,
living world, whimsical, premium casual.

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
plain boxes.

Everything stays procedurally generated in code (SPEC 2.11). Rounded boxes, smooth
shading, matte materials and restrained detail are what separate this from "low poly",
not external models.

## 4. Buildings

The town has: detached houses, a few small apartment blocks, a school, a cafe, a
supermarket, a bakery, an office, a park, a car park, roads, pavements, street lamps,
mailboxes, trees, flower beds and fences.

**Every house must be visibly its own home.** For example:

- House 01: red roof, white walls, small garden
- House 02: dark grey roof, cream walls, wooden fence
- House 03: blue-grey roof, pale green walls, small balcony
- House 04: small modern house, large windows

A few signs of life per house, never a pile of them: flower pots, a mailbox, a bicycle, a
bin, washing on a line, a garden, a small table and chairs, a porch.

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

## 7. Roads

Cozy small-town roads: narrow, simple pavements, small lamps, a few signs, zebra crossings,
parking bays. No big-city roads.

Road: neutral warm grey. Pavement: warm beige-grey. Nothing garish.

## 8. Cars

Stylized miniature cars: slightly exaggerated, rounded, simple. Family car, small SUV,
delivery van, taxi. Simple but clear lights, windows, wheels and body colours. Headlights
on at night; wet reflections in rain.

## 9. Plants

Large trees, small trees, shrubs, grass, flower beds, roadside flowers, a small vegetable
patch. Soft, slightly exaggerated shapes. Trees may be a little larger than life so the
town reads as a miniature. Not realistic foliage.

## 10. Colour

Warm, natural, low saturation throughout.

| Role      | Name        | Hex       |
| --------- | ----------- | --------- |
| Primary   | Warm Ivory  | `#F5F0E6` |
| Secondary | Sage Green  | `#8FAF8F` |
| Accent    | Warm Orange | `#E6A15C` |
| Road      | Warm Gray   | `#77736B` |
| UI text   | Deep Gray   | `#3F403C` |

Buildings: off-white, cream, light grey, soft blue, soft green, warm brown, a little
orange. Never fluorescent colours, saturated primaries or neon.

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
downward tilt** (about 40° landscape, about 50° portrait) so buildings, roads, people, cars
and the park are all visible at once and a strip of sky remains for dawn and dusk.

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

- Houses: bicycle, flower pots, mailbox, bin
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
- **Distance.** Hills and a forest around the town, mountains beyond, all fading into the
  sky colour with distance. Enough to fill the horizon, never enough to compete with the
  town.
- **The floor under the spectacle.** By day the town and its windows are the subject and
  clouds and sea are kept quiet. By night the sky may be spectacular, but the windows,
  street lamps and car lights must still be the brightest, warmest things in the picture.
  If a starfield ever makes a lit window look dim, the starfield is wrong.
- **Cost.** Sky, clouds, stars, Milky Way, moon and sea are shaders on a few large
  meshes, never particles; distant trees are instanced. Their motion is render-side only.

## 21. Priorities

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

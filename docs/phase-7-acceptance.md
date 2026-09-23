# Phase 7 acceptance record

SPEC.md 5.2 tests, run on the desktop with Playwright (Chrome, Apple M4, 1440×810 at 2×
and 390×844 at 3× with touch). The phone column is for the author to fill in on a real
device; nothing here was run on one.

| Test                   | Desktop                                                                                                                                                                                                  | Phone (author) |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| 1 · Five minutes at 5x | Day 1 05:32 → Day 2 06:32. Outside 0 → 12 (08:02) → 21 (13:02) → 8 (18:02) → 0 (23:02) → 4 (06:32); cars on the road in the evening. Recorded in `phase-7-screenshots/acceptance-desktop-tests-1-3.txt`. | pending        |
| 2 · Sunny → Rain       | Rain at Day 2 10:00: in the open 11 → 6 by 10:30, park 2 → 0; two causal diary lines, the first naming seven people who went to the cafe. Umbrellas and wet paving in `test2-rain.png`.                  | pending        |
| 3 · A day at 100x      | Day 2 10:30 → Day 3 11:38 in 15 s of real time; zero page errors; zero citizens off the map at any sample. Headless: determinism test holds 1x against 100x.                                             | pending        |
| 4 · Select a citizen   | Click (18 px) and tap (36 px, 14 px off centre) both select the intended citizen; the panel's name, age, job, home, activity, family and friends match the state.                                        | pending        |
| 5 · Follow             | Rex from home to the car to the office at 5x: four hand-offs, largest camera move 1.6 m a frame; indoors the camera eases back to 2.1× reach; stop returns to the default framing exactly.               | pending        |

## 5.3 in CI

`npm test` runs the 30 day headless month (nobody stuck over 30 minutes, nobody off the
map, late shifts under 10%), the paving and reachability checks, the rain month, and the
determinism run with scripted weather. 92 tests. CI runs them on every push and every tag.

## 5.4 performance

Frame times at 20x through the morning rush, 6 s samples, p95 frame time:

| Device                    | Tier          | Draw calls | fps  | p95     |
| ------------------------- | ------------- | ---------- | ---- | ------- |
| Desktop 1440×810 @2       | high          | 85         | 60.2 | 18.6 ms |
| Desktop, rain             | high          | 87         | 60.2 | 18.6 ms |
| Desktop                   | medium        | 85         | 60.2 | 17.5 ms |
| Desktop                   | low           | 55         | 52.5 | 18.4 ms |
| Phone viewport 390×844 @3 | medium (auto) | 85         | 60.2 | 18.2 ms |
| Phone viewport            | low           | 55         | 60.0 | 17.6 ms |
| Phone viewport, rain      | low           | 57         | 59.7 | 18.8 ms |

The phone rows are the phone's viewport on the desktop GPU: they show the tiers work,
not what a mid-range phone does. A real phone is the author's test.

First load: `index.html` 0.5 kB, CSS 4.5 kB, JS 745 kB (199 kB gzip). Source map 3.5 MB,
not loaded by the page. Total on the wire about 200 kB, under the 2 MB target.

## Deployment

`.github/workflows/deploy.yml` publishes `dist/` to GitHub Pages on every `v*` or
`phase-*` tag. It needs the repository to have Pages enabled (Settings → Pages → Source:
GitHub Actions) and a remote to push to; neither exists yet.

# Changelog

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

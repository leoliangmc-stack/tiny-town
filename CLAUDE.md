# Tiny Town

A 3D tiny town that lives by itself, built with Vite, TypeScript and Three.js.

## Read these first

- `SPEC.md` — the single source of truth for requirements. Written in Chinese; it stays that
  way. If a feature and the SPEC disagree, the SPEC wins. If the SPEC needs to change, change
  the document before the code.
- `PHASES.md` — the phase by phase development plan. One phase per session.
- `IDEAS.md` — parking lot for anything that is not in the current phase.

## Hard rules

- `src/simulation/` must never import Three.js or anything from `src/render/`. The World has to
  run in Node with no renderer attached. `tests/architecture.test.ts` and an ESLint rule enforce
  this.
- The simulation advances in fixed ticks (10 ticks per game minute). Speed is applied by running
  more ticks per frame, never by scaling delta time. `World.tick()` takes no arguments on purpose.
- Determinism: the same seed must give the same run at 1x and at 100x. All randomness goes
  through `simulation/Rng.ts`.
- Build only what the current phase lists. New ideas go to `IDEAS.md`.
- All identifiers, comments, commit messages, documentation and UI copy in English. `SPEC.md` is
  the one exception and stays in Chinese.
- Prefer boring, readable code. Name things after what the SPEC calls them.

## Layout

```
src/
├── simulation/   pure logic, no Three.js
├── entities/     data models (Citizen, Vehicle, Building, Road)
├── world/        the fixed town layout and population data
├── render/       Three.js scene, materials, lighting, camera
├── ui/           shared components for desktop and mobile
└── main.ts
tests/            Vitest, including the headless multi-day run
```

## Temporary controls

Until the real UI arrives in Phase 6: `1`, `2`, `3`, `4` set the speed to 1x, 5x, 20x and
100x, and space pauses. The running app is exposed as `window.tinyTown` in dev builds.

## Commands

```bash
npm run dev       # dev server
npm test          # Vitest
npm run lint      # ESLint
npm run build     # typecheck and production build
```

Every phase ends with `npm test` green, `npm run build` green, an entry in `CHANGELOG.md`, and a
git tag `phase-N`.

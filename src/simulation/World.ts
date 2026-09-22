import { Rng } from './Rng.js';
import { TimeSystem } from './TimeSystem.js';

export interface WorldOptions {
  /** Seed for every random choice in the simulation. */
  seed?: number | string;
}

export const DEFAULT_SEED = 'tiny-town';

/**
 * The whole simulation. It owns the game clock and, from Phase 1 on, the town,
 * its citizens and its vehicles.
 *
 * This file and everything else under src/simulation must never import
 * Three.js: the world has to run in Node with no renderer attached
 * (SPEC.md 3.2). tests/architecture.test.ts enforces that.
 */
export class World {
  readonly seed: number | string;
  readonly rng: Rng;
  readonly time = new TimeSystem();

  constructor(options: WorldOptions = {}) {
    this.seed = options.seed ?? DEFAULT_SEED;
    this.rng = new Rng(this.seed);
  }

  /**
   * Advances the simulation by exactly one fixed tick.
   *
   * It takes no delta time on purpose. Speed is a number of ticks, never a
   * bigger step.
   */
  tick(): void {
    this.time.tick();
  }

  /** Runs a number of ticks in a row. */
  tickMany(count: number): void {
    for (let i = 0; i < count; i += 1) {
      this.tick();
    }
  }
}

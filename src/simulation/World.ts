import type { Citizen } from '../entities/Citizen.js';
import { CAFE_CLOSES_AT, CAFE_ID, CAFE_OPENS_AT } from '../world/Town.js';

import { CitizenSystem } from './CitizenSystem.js';
import { Rng } from './Rng.js';
import { TimeSystem } from './TimeSystem.js';

export interface WorldOptions {
  /** Seed for every random choice in the simulation. */
  seed?: number | string;
}

export const DEFAULT_SEED = 'tiny-town';

/**
 * The whole simulation: the game clock and the people living in the town.
 *
 * This file and everything else under src/simulation must never import
 * Three.js: the world has to run in Node with no renderer attached
 * (SPEC.md 3.2). tests/architecture.test.ts enforces that.
 */
export class World {
  readonly seed: number | string;
  readonly rng: Rng;
  readonly time = new TimeSystem();
  readonly citizenSystem: CitizenSystem;

  constructor(options: WorldOptions = {}) {
    this.seed = options.seed ?? DEFAULT_SEED;
    this.rng = new Rng(this.seed);
    this.citizenSystem = new CitizenSystem(this.seed);
  }

  get citizens(): readonly Citizen[] {
    return this.citizenSystem.citizens;
  }

  /**
   * Whether the building's windows should be lit right now.
   *
   * A house is lit when somebody is home and awake. The cafe is lit while it
   * is open, so it is the last warm window in the street at night.
   */
  isLit(buildingId: string): boolean {
    if (buildingId === CAFE_ID) {
      const minute = this.time.minuteOfDay;
      return minute >= CAFE_OPENS_AT && minute < CAFE_CLOSES_AT;
    }
    return this.citizenSystem.isLit(buildingId);
  }

  /**
   * Advances the simulation by exactly one fixed tick.
   *
   * It takes no delta time on purpose. Speed is a number of ticks, never a
   * bigger step.
   */
  tick(): void {
    this.time.tick();
    this.citizenSystem.tick(this.time.day, this.time.minuteOfDay);
  }

  /** Runs a number of ticks in a row. */
  tickMany(count: number): void {
    for (let i = 0; i < count; i += 1) {
      this.tick();
    }
  }
}

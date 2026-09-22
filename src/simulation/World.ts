import type { Citizen } from '../entities/Citizen.js';
import { CAFE_CLOSES_AT, CAFE_ID, CAFE_OPENS_AT } from '../world/Town.js';

import { CitizenSystem } from './CitizenSystem.js';
import { HouseholdLights } from './HouseholdLights.js';
import { buildRoadGraph, NavGraph } from './Navigation.js';
import { Rng } from './Rng.js';
import { TimeSystem } from './TimeSystem.js';

export interface WorldOptions {
  /** Seed for every random choice in the simulation. */
  seed?: number | string;
}

export const DEFAULT_SEED = 'tiny-town';

/** When the public buildings have their lights on, in minutes since midnight. */
const PUBLIC_OPENING_HOURS: Record<string, [number, number]> = {
  school: [7 * 60 + 30, 17 * 60],
  supermarket: [7 * 60, 21 * 60 + 30],
  bakery: [5 * 60 + 30, 18 * 60],
  office: [8 * 60, 19 * 60 + 30],
};

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
  readonly roads: NavGraph;
  private readonly householdLights: HouseholdLights;

  constructor(options: WorldOptions = {}) {
    this.seed = options.seed ?? DEFAULT_SEED;
    this.rng = new Rng(this.seed);
    this.citizenSystem = new CitizenSystem(this.seed);
    this.roads = buildRoadGraph();
    this.householdLights = new HouseholdLights(
      this.seed,
      this.citizenSystem.citizens.map((citizen) => citizen.homeId),
    );
  }

  /** The pavement graph the citizens walk on. */
  get sidewalks(): NavGraph {
    return this.citizenSystem.sidewalks;
  }

  get citizens(): readonly Citizen[] {
    return this.citizenSystem.citizens;
  }

  /**
   * Whether the building's windows should be lit right now.
   *
   * A house with a resident is lit when somebody is home and awake. A house
   * without one falls back to the placeholder schedules in HouseholdLights
   * until Phase 3 gives every house a family. Public buildings are lit while
   * they are open, so the cafe is the last warm window in the street at night.
   */
  isLit(buildingId: string): boolean {
    const minute = this.time.minuteOfDay;

    if (buildingId === CAFE_ID) {
      return minute >= CAFE_OPENS_AT && minute < CAFE_CLOSES_AT;
    }
    if (this.householdLights.has(buildingId)) {
      return this.householdLights.isLit(buildingId, minute);
    }
    if (PUBLIC_OPENING_HOURS[buildingId]) {
      const [opens, closes] = PUBLIC_OPENING_HOURS[buildingId];
      return minute >= opens && minute < closes;
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

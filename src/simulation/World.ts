import type { Citizen } from '../entities/Citizen.js';
import { isHomeAndAwake } from '../entities/Citizen.js';
import { CAFE_CLOSES_AT, CAFE_ID, CAFE_OPENS_AT, HOUSES } from '../world/Town.js';

import { CitizenSystem } from './CitizenSystem.js';
import type { EventLog } from './EventLog.js';
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
  [CAFE_ID]: [CAFE_OPENS_AT, CAFE_CLOSES_AT],
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

  constructor(options: WorldOptions = {}) {
    this.seed = options.seed ?? DEFAULT_SEED;
    this.rng = new Rng(this.seed);
    this.citizenSystem = new CitizenSystem(this.seed);
    this.roads = buildRoadGraph();
  }

  get citizens(): readonly Citizen[] {
    return this.citizenSystem.citizens;
  }

  /** The pavement graph the citizens walk on. */
  get sidewalks(): NavGraph {
    return this.citizenSystem.sidewalks;
  }

  get log(): EventLog {
    return this.citizenSystem.log;
  }

  /**
   * Whether the building's windows should be lit right now.
   *
   * A home is lit when somebody who lives there is in and awake. Public
   * buildings are lit while they are open, so the cafe is the last warm
   * window in the street at night. A house nobody lives in stays dark.
   */
  isLit(buildingId: string): boolean {
    const hours = PUBLIC_OPENING_HOURS[buildingId];
    if (hours) {
      const minute = this.time.minuteOfDay;
      return minute >= hours[0] && minute < hours[1];
    }
    return this.citizens.some(
      (citizen) => citizen.homeId === buildingId && isHomeAndAwake(citizen),
    );
  }

  /** Houses nobody lives in, which therefore never light up. */
  get emptyHouseIds(): string[] {
    const homes = new Set(this.citizens.map((citizen) => citizen.homeId));
    return HOUSES.filter((house) => !homes.has(house.id)).map((house) => house.id);
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

  /**
   * A hash of everything that can change: the clock, every citizen, the log.
   * Two runs of the same seed must produce the same hash at the same tick,
   * whatever speed they were played at (SPEC.md 3.2, 5.3).
   */
  stateHash(): string {
    const snapshot = JSON.stringify({
      tick: this.time.totalTicks,
      citizens: this.citizens.map((citizen) => ({
        ...citizen,
        // Round so the hash is about state, not about the last bit of a float.
        position: { x: round(citizen.position.x), z: round(citizen.position.z) },
        heading: round(citizen.heading),
        distanceWalked: round(citizen.distanceWalked),
        socialNeed: round(citizen.socialNeed),
        activityUntil: Number.isFinite(citizen.activityUntil)
          ? round(citizen.activityUntil)
          : 'open',
        plan: citizen.plan.map((item) => ({
          ...item,
          at: round(item.at),
          duration: round(item.duration),
        })),
      })),
      log: this.log.entries,
    });

    let hash = 2166136261;
    for (let i = 0; i < snapshot.length; i += 1) {
      hash = Math.imul(hash ^ snapshot.charCodeAt(i), 16777619);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
  }
}

function round(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

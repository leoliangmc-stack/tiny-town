import { Rng } from './Rng.js';
import { HOUSES } from '../world/Town.js';

/**
 * Placeholder lighting for the houses nobody lives in yet.
 *
 * Phase 2 fills the map with twenty houses but still has Phase 1's five
 * citizens, so most windows would stay dark all night and the town would read
 * as abandoned. Each unoccupied house gets its own seeded waking hours here,
 * which staggers the lights the same way real occupancy will.
 *
 * Phase 3 gives every house a family and deletes this file: from then on the
 * windows are lit by who is actually home (PHASES.md, Phase 3).
 */
export interface Household {
  buildingId: string;
  wakeAt: number;
  sleepAt: number;
  /** Minutes the house is empty in the middle of the day. */
  outFrom: number;
  outUntil: number;
}

export class HouseholdLights {
  private readonly households: Household[] = [];

  constructor(seed: number | string, occupiedHouseIds: readonly string[]) {
    for (const house of HOUSES) {
      if (occupiedHouseIds.includes(house.id)) {
        continue;
      }
      const rng = new Rng(`${seed}:household:${house.id}`);
      const wakeAt = 6 * 60 + rng.nextFloat(-40, 110);
      const outFrom = wakeAt + rng.nextFloat(40, 120);
      this.households.push({
        buildingId: house.id,
        wakeAt,
        sleepAt: 21 * 60 + rng.nextFloat(0, 170),
        outFrom,
        outUntil: outFrom + rng.nextFloat(90, 400),
      });
    }
  }

  /** Whether this house should show light right now. */
  isLit(buildingId: string, minuteOfDay: number): boolean {
    const household = this.households.find((entry) => entry.buildingId === buildingId);
    if (!household) {
      return false;
    }
    const awake = minuteOfDay >= household.wakeAt && minuteOfDay < household.sleepAt;
    const out = minuteOfDay >= household.outFrom && minuteOfDay < household.outUntil;
    return awake && !out;
  }

  has(buildingId: string): boolean {
    return this.households.some((entry) => entry.buildingId === buildingId);
  }
}

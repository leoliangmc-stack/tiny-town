import type { Appointment, Citizen, Job } from '../entities/Citizen.js';
import { CAFE_ID, HOUSES } from '../world/Town.js';

import { Rng } from './Rng.js';

/**
 * Builds each citizen's day (SPEC.md 2.4).
 *
 * Every job has a written template: wake, breakfast, leave, work, lunch,
 * evening, sleep. At the start of each day the template is copied with a
 * seeded jitter of up to ten minutes on every time, so the town never moves
 * in lockstep, and with a few choices tilted by personality: whether lunch is
 * taken outside, whether the evening goes to the cafe, whether the retired
 * walk to the park.
 *
 * The jitter is seeded from the run seed, the citizen and the day, so a day
 * is the same however fast it is played (SPEC.md 3.2).
 */

export const SCHEDULE_JITTER_MINUTES = 10;

/** Grace after the shift starts before an arrival counts as late. */
export const LATE_GRACE_MINUTES = 5;

/** Minutes a citizen spends on foot per metre of route, plus a little slack. */
export function travelMinutes(routeLength: number, walkSpeed: number): number {
  return Math.ceil(routeLength / walkSpeed) + 2;
}

const minute = (hours: number, minutes = 0): number => hours * 60 + minutes;

/** The written day for a job, before jitter. */
interface Template {
  wake: number;
  breakfastMinutes: number;
  workStart?: number;
  workEnd?: number;
  /** Outdoor break in the workplace's zone, as [start, length]. */
  outdoorBreak?: [number, number];
  dinner: number;
  sleep: number;
}

const TEMPLATES: Record<Job, Template> = {
  Baker: {
    wake: minute(4, 40),
    breakfastMinutes: 15,
    workStart: minute(5, 30),
    workEnd: minute(13, 30),
    outdoorBreak: [minute(10, 0), 20],
    dinner: minute(18, 30),
    sleep: minute(21, 30),
  },
  Teacher: {
    wake: minute(6, 30),
    breakfastMinutes: 25,
    workStart: minute(8, 0),
    workEnd: minute(16, 0),
    outdoorBreak: [minute(12, 15), 30],
    dinner: minute(19, 0),
    sleep: minute(22, 30),
  },
  Student: {
    wake: minute(7, 0),
    breakfastMinutes: 25,
    workStart: minute(8, 30),
    workEnd: minute(15, 0),
    outdoorBreak: [minute(12, 0), 35],
    dinner: minute(18, 30),
    sleep: minute(21, 0),
  },
  Shopkeeper: {
    wake: minute(6, 50),
    breakfastMinutes: 25,
    workStart: minute(8, 30),
    workEnd: minute(18, 30),
    outdoorBreak: [minute(13, 0), 25],
    dinner: minute(19, 30),
    sleep: minute(23, 0),
  },
  'Office Worker': {
    wake: minute(6, 45),
    breakfastMinutes: 25,
    workStart: minute(9, 0),
    workEnd: minute(17, 30),
    outdoorBreak: [minute(12, 30), 30],
    dinner: minute(19, 0),
    sleep: minute(22, 45),
  },
  Doctor: {
    wake: minute(6, 30),
    breakfastMinutes: 20,
    workStart: minute(8, 30),
    workEnd: minute(17, 0),
    outdoorBreak: [minute(12, 45), 25],
    dinner: minute(19, 0),
    sleep: minute(22, 30),
  },
  'Cafe Worker': {
    wake: minute(6, 0),
    breakfastMinutes: 20,
    workStart: minute(7, 0),
    workEnd: minute(15, 30),
    outdoorBreak: [minute(11, 0), 20],
    dinner: minute(19, 0),
    sleep: minute(22, 30),
  },
  'Delivery Driver': {
    wake: minute(6, 15),
    breakfastMinutes: 20,
    workStart: minute(7, 30),
    workEnd: minute(16, 0),
    outdoorBreak: [minute(12, 0), 30],
    dinner: minute(18, 45),
    sleep: minute(22, 15),
  },
  Retired: {
    wake: minute(7, 30),
    breakfastMinutes: 40,
    dinner: minute(18, 0),
    sleep: minute(22, 0),
  },
};

/** The outdoor zone in front of each workplace. */
const ZONE_OF_BUILDING: Record<string, string> = {
  school: 'school-playground',
  cafe: 'cafe-terrace',
  supermarket: 'supermarket-forecourt',
  bakery: 'bakery-front',
  office: 'office-front',
};

export const PARK_ZONE_ID = 'park-lawn';
export const CAFE_ZONE_ID = 'cafe-terrace';

export class ScheduleSystem {
  constructor(
    private readonly seed: number | string,
    /** Route length in metres between two buildings' doors, for leave times. */
    private readonly routeLength: (fromBuildingId: string, toBuildingId: string) => number,
  ) {}

  /** Today's appointments for one citizen, in order. */
  planDay(citizen: Citizen, day: number): Appointment[] {
    const rng = new Rng(`${this.seed}:${citizen.id}:day-${day}`);
    const jitter = (): number => rng.nextFloat(-SCHEDULE_JITTER_MINUTES, SCHEDULE_JITTER_MINUTES);
    const template = TEMPLATES[citizen.job];
    const home = { kind: 'building' as const, id: citizen.homeId };
    const plan: Appointment[] = [];

    const wake = template.wake + jitter();
    plan.push({ at: wake, activity: 'Eat', place: home, duration: template.breakfastMinutes });

    if (citizen.workplaceId && template.workStart !== undefined && template.workEnd !== undefined) {
      const workplace = { kind: 'building' as const, id: citizen.workplaceId };
      const workStart = template.workStart + jitter();
      const travel = travelMinutes(
        this.routeLength(citizen.homeId, citizen.workplaceId),
        citizen.walkSpeed,
      );
      // Leave with the walk in hand plus a small margin; the less work minded
      // cut the margin finer and are the ones who occasionally run late.
      const margin = citizen.personality.workPreference > 60 ? 6 : 2;
      plan.push({
        at: workStart - travel - margin,
        activity: 'Work',
        place: workplace,
        duration: 0,
        due: workStart,
      });

      if (template.outdoorBreak && citizen.personality.outdoorPreference >= 40) {
        const [start, length] = template.outdoorBreak;
        plan.push({
          at: start + jitter(),
          activity: citizen.personality.social > 60 ? 'Socialize' : 'Relax',
          place: { kind: 'zone', id: ZONE_OF_BUILDING[citizen.workplaceId] },
          duration: Math.min(length, 28),
        });
        plan.push({ at: start + length + 2, activity: 'Work', place: workplace, duration: 0 });
      }

      if (citizen.job === 'Delivery Driver') {
        this.planRounds(citizen, rng, workplace, plan);
      }

      const workEnd = template.workEnd + jitter();
      this.planAfterWork(citizen, rng, workEnd, plan);
    } else {
      this.planRetiredDay(citizen, rng, wake + template.breakfastMinutes, plan);
    }

    plan.push({
      at: template.dinner + jitter(),
      activity: 'Eat',
      place: home,
      duration: 35 + jitter() / 2,
    });

    const sleep = template.sleep + jitter();
    // Sociable people go out again after dinner, if there is time before bed.
    if (citizen.personality.social > 70 && citizen.age >= 16 && sleep - template.dinner > 150) {
      plan.push({
        at: template.dinner + 55 + jitter(),
        activity: 'Socialize',
        place: { kind: 'zone', id: CAFE_ZONE_ID },
        duration: 25,
      });
    }
    plan.push({ at: sleep, activity: 'Sleep', place: home, duration: 0 });

    return plan.sort((a, b) => a.at - b.at);
  }

  /**
   * A delivery driver's rounds: two trips a day to a house, on foot until
   * Phase 4 puts them in a van. They keep the streets busy mid-morning and
   * mid-afternoon, when everybody else is indoors.
   */
  private planRounds(
    citizen: Citizen,
    rng: Rng,
    workplace: { kind: 'building'; id: string },
    plan: Appointment[],
  ): void {
    for (const start of [minute(9, 0), minute(14, 0)]) {
      const house = rng.pick(HOUSES);
      const at = start + rng.nextFloat(-10, 10);
      plan.push({
        at,
        activity: 'Work',
        place: { kind: 'building', id: house.id },
        duration: 0,
        note: `${citizen.name} set off on a delivery round to ${house.name}.`,
      });
      plan.push({ at: at + 40, activity: 'Work', place: workplace, duration: 0 });
    }
  }

  /** What happens between the end of the shift and dinner. */
  private planAfterWork(citizen: Citizen, rng: Rng, workEnd: number, plan: Appointment[]): void {
    const home = { kind: 'building' as const, id: citizen.homeId };
    const traits = citizen.personality;

    if (citizen.job === 'Student') {
      if (traits.outdoorPreference > 60) {
        plan.push({
          at: workEnd,
          activity: 'Relax',
          place: { kind: 'zone', id: PARK_ZONE_ID },
          duration: 25,
        });
      }
      plan.push({ at: workEnd + 45, activity: 'Relax', place: home, duration: 0 });
      return;
    }

    // One errand, at most, chosen by temperament.
    const roll = rng.next();
    if (traits.social > 65 && roll < 0.6) {
      plan.push({
        at: workEnd,
        activity: 'Socialize',
        place: { kind: 'zone', id: CAFE_ZONE_ID },
        duration: 25,
      });
    } else if (citizen.workplaceId !== 'supermarket' && roll < 0.75) {
      plan.push({
        at: workEnd,
        activity: 'Shop',
        place: { kind: 'building', id: 'supermarket' },
        duration: 20,
      });
    } else if (traits.outdoorPreference > 60) {
      plan.push({
        at: workEnd,
        activity: 'Relax',
        place: { kind: 'zone', id: PARK_ZONE_ID },
        duration: 22,
      });
    }
    plan.push({ at: workEnd + 60, activity: 'Relax', place: home, duration: 0 });
  }

  /** A retired day: the park in the morning, perhaps the cafe in the afternoon. */
  private planRetiredDay(
    citizen: Citizen,
    rng: Rng,
    afterBreakfast: number,
    plan: Appointment[],
  ): void {
    const home = { kind: 'building' as const, id: citizen.homeId };
    const traits = citizen.personality;

    if (traits.outdoorPreference > 50) {
      plan.push({
        at: Math.max(afterBreakfast + 30, minute(9, 30)) + rng.nextFloat(0, 40),
        activity: 'Relax',
        place: { kind: 'zone', id: PARK_ZONE_ID },
        duration: 25,
      });
    }
    plan.push({ at: minute(11, 45), activity: 'Relax', place: home, duration: 0 });
    plan.push({
      at: minute(12, 30) + rng.nextFloat(-5, 5),
      activity: 'Eat',
      place: home,
      duration: 30,
    });

    if (traits.social > 50) {
      plan.push({
        at: minute(15, 0) + rng.nextFloat(-20, 30),
        activity: 'Socialize',
        place: { kind: 'zone', id: CAFE_ZONE_ID },
        duration: 25,
      });
    } else if (rng.next() < 0.5) {
      plan.push({
        at: minute(15, 30) + rng.nextFloat(-20, 20),
        activity: 'Shop',
        place: { kind: 'building', id: 'supermarket' },
        duration: 20,
      });
    }
    plan.push({ at: minute(16, 45), activity: 'Relax', place: home, duration: 0 });
  }
}

export { CAFE_ID };

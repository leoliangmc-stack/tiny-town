import type { Point } from './geometry.js';

/**
 * What a citizen is doing right now.
 *
 * Phase 1 only needs the sleep, walk, stay, walk back loop. The full behaviour
 * set from SPEC.md 2.4 (Eat, Work, Drive, Shop, Socialize, Relax, GoHome)
 * arrives with the schedule system in Phase 3.
 */
export type Activity = 'Sleep' | 'AtHome' | 'WalkToCafe' | 'AtCafe' | 'WalkHome';

/** Times of the day, in minutes since midnight, that drive one citizen's day. */
export interface DailySchedule {
  wakeAt: number;
  leaveForCafeAt: number;
  cafeStayMinutes: number;
  sleepAt: number;
}

export interface Citizen {
  id: string;
  name: string;
  homeId: string;
  /** Clothing colour, as a hex number. Used to tell citizens apart. */
  shirtColor: number;
  /** Metres walked per game minute. */
  walkSpeed: number;

  /** Schedule before the daily jitter, from world/Population.ts. */
  baseSchedule: DailySchedule;
  /** Today's schedule, the base one plus a seeded jitter of a few minutes. */
  schedule: DailySchedule;
  /** The day `schedule` was rolled for. */
  scheduleDay: number;

  activity: Activity;
  position: Point;
  /** Direction the citizen faces, as an angle around Y in radians. */
  heading: number;
  /** Distance walked in total, which drives the walking bob in the renderer. */
  distanceWalked: number;

  /** The route being walked, empty when standing still. */
  path: Point[];
  /** Index of the path point being walked towards. */
  pathIndex: number;

  /** Minute of the day the citizen means to leave the cafe. */
  leaveCafeAt: number;
  /** Whether today's cafe trip has already happened. */
  visitedCafeToday: boolean;
}

/** True while the citizen is inside their home and awake, which lights the windows. */
export function isHomeAndAwake(citizen: Citizen): boolean {
  return citizen.activity === 'AtHome';
}

/** True while the citizen is out of doors and should be drawn. */
export function isOutside(citizen: Citizen): boolean {
  return (
    citizen.activity === 'WalkToCafe' ||
    citizen.activity === 'WalkHome' ||
    citizen.activity === 'AtCafe'
  );
}

/** True while the citizen is walking, which drives the walking bob. */
export function isWalking(citizen: Citizen): boolean {
  return citizen.activity === 'WalkToCafe' || citizen.activity === 'WalkHome';
}

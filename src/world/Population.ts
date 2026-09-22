import type { Citizen, DailySchedule } from '../entities/Citizen.js';

/**
 * The fixed cast of the town.
 *
 * Phase 1 has five residents on a hand written schedule so the day has a clear
 * shape: a staggered wake up at dawn, a walk to the cafe, and a staggered
 * bedtime that turns the windows off one house at a time. The cafe visits are
 * spread and overlapped on purpose, so there is somebody out of doors through
 * the whole day rather than an empty street between trips. The full population
 * of 40 with families, jobs and personalities arrives in Phase 3.
 */

export interface ResidentTemplate {
  id: string;
  name: string;
  homeId: string;
  shirtColor: number;
  /** Metres per game minute. A trip across the town takes about ten minutes. */
  walkSpeed: number;
  schedule: DailySchedule;
}

export const RESIDENTS: readonly ResidentTemplate[] = [
  {
    id: 'tom',
    name: 'Tom',
    homeId: 'house-1',
    shirtColor: 0xd9604a,
    walkSpeed: 4.6,
    schedule: {
      wakeAt: 6 * 60 + 20,
      leaveForCafeAt: 7 * 60,
      cafeStayMinutes: 150,
      sleepAt: 22 * 60 + 40,
    },
  },
  {
    id: 'sarah',
    name: 'Sarah',
    homeId: 'house-2',
    shirtColor: 0x4a7fd9,
    walkSpeed: 4.2,
    schedule: {
      wakeAt: 6 * 60 + 50,
      leaveForCafeAt: 8 * 60 + 30,
      cafeStayMinutes: 170,
      sleepAt: 23 * 60 + 10,
    },
  },
  {
    id: 'ruth',
    name: 'Ruth',
    homeId: 'house-3',
    shirtColor: 0xe0a53c,
    walkSpeed: 3.9,
    schedule: {
      wakeAt: 7 * 60 + 30,
      leaveForCafeAt: 10 * 60 + 40,
      cafeStayMinutes: 160,
      sleepAt: 21 * 60 + 50,
    },
  },
  {
    id: 'oscar',
    name: 'Oscar',
    homeId: 'house-4',
    shirtColor: 0x5fae7a,
    walkSpeed: 4.8,
    schedule: {
      wakeAt: 5 * 60 + 50,
      leaveForCafeAt: 12 * 60 + 40,
      cafeStayMinutes: 180,
      sleepAt: 22 * 60 + 20,
    },
  },
  {
    id: 'lena',
    name: 'Lena',
    homeId: 'house-5',
    shirtColor: 0xa96fc4,
    walkSpeed: 4.4,
    schedule: {
      wakeAt: 8 * 60 + 10,
      leaveForCafeAt: 16 * 60 + 30,
      cafeStayMinutes: 180,
      sleepAt: 23 * 60 + 40,
    },
  },
];

/** Minutes the daily jitter may shift a scheduled time in either direction. */
export const SCHEDULE_JITTER_MINUTES = 10;

export function createCitizen(
  template: ResidentTemplate,
  position: { x: number; z: number },
): Citizen {
  return {
    id: template.id,
    name: template.name,
    homeId: template.homeId,
    shirtColor: template.shirtColor,
    walkSpeed: template.walkSpeed,
    baseSchedule: template.schedule,
    schedule: { ...template.schedule },
    scheduleDay: 0,
    activity: 'Sleep',
    position: { ...position },
    heading: 0,
    distanceWalked: 0,
    path: [],
    pathIndex: 0,
    leaveCafeAt: 0,
    visitedCafeToday: false,
  };
}

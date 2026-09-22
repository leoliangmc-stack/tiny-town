import type { Point } from './geometry.js';

/**
 * What a citizen is doing right now (SPEC.md 2.4).
 *
 * `Drive` is in the set but nobody enters it until Phase 4: citizens who would
 * drive walk for now.
 */
export type Activity =
  'Sleep' | 'Eat' | 'Work' | 'Walk' | 'Drive' | 'Shop' | 'Socialize' | 'Relax' | 'GoHome';

export type Gender = 'female' | 'male';

/** Jobs per SPEC.md 2.4, each tied to one building in world/Town.ts. */
export type Job =
  | 'Teacher'
  | 'Baker'
  | 'Shopkeeper'
  | 'Office Worker'
  | 'Doctor'
  | 'Cafe Worker'
  | 'Delivery Driver'
  | 'Student'
  | 'Retired';

/** Four traits, each 0 to 100, that tilt the day one way or another. */
export interface Personality {
  social: number;
  energy: number;
  outdoorPreference: number;
  workPreference: number;
}

export interface Family {
  spouse?: string;
  parents: string[];
  children: string[];
  siblings: string[];
}

/** Colours and cut that tell one citizen from another (DESIGN.md §5). */
export interface Look {
  skin: number;
  hair: number;
  shirt: number;
  trousers: number;
  /** How far down the head the hair reaches, 0.35 (short) to 0.75 (long). */
  hairCut: number;
  /** Overall height scale, so adults and children read differently. */
  height: number;
}

/**
 * Where a citizen is, in the coarse sense the rest of the town cares about:
 * inside a building, standing in an outdoor zone, or on the street between.
 */
export interface Place {
  kind: 'building' | 'zone' | 'street';
  id: string;
}

/**
 * One appointment in a day: when to leave for it, where it happens, and what
 * to do on arrival. The ScheduleSystem builds a day of these each morning.
 */
export interface Appointment {
  /** Minute of the day to set off, or to start if already there. */
  at: number;
  activity: Activity;
  place: Place;
  /** How long to stay, in game minutes, once the activity has started. */
  duration: number;
  /**
   * For Work: the minute the shift is meant to start. Arrival after it, past a
   * small grace, counts as late.
   */
  due?: number;
  /** A line for the diary when the citizen sets off, if the trip is worth one. */
  note?: string;
}

export interface Citizen {
  id: string;
  name: string;
  age: number;
  gender: Gender;
  job: Job;
  personality: Personality;
  homeId: string;
  /** Building the job happens in. Students have the school; the retired none. */
  workplaceId?: string;
  family: Family;
  friends: string[];
  look: Look;
  /** Metres walked per game minute. */
  walkSpeed: number;

  activity: Activity;
  place: Place;
  position: Point;
  /** Direction the citizen faces, as an angle around Y in radians. */
  heading: number;
  /** Distance walked in total, which drives the walking animation. */
  distanceWalked: number;

  /** The route being walked, empty when standing still. */
  path: Point[];
  pathIndex: number;

  /** Today's appointments and how far through them the citizen is. */
  plan: Appointment[];
  planIndex: number;
  planDay: number;
  /** What the citizen is walking towards, if walking. */
  pending?: Appointment;
  /** Minute of the day the current stationary activity ends. */
  activityUntil: number;

  /**
   * Rises through the day while alone, drops while socialising. Past a
   * threshold set by the social trait, free time goes to the cafe terrace.
   */
  socialNeed: number;

  /** Minutes late for work today, or zero. Read by the tests and the log. */
  lateToday: number;
}

/** True while the citizen is out of doors and should be drawn. */
export function isOutside(citizen: Citizen): boolean {
  return citizen.place.kind !== 'building';
}

/** True while the citizen is walking, which drives the walking animation. */
export function isWalking(citizen: Citizen): boolean {
  return citizen.activity === 'Walk' || citizen.activity === 'GoHome';
}

/** True while the citizen is at home and awake, which lights the windows. */
export function isHomeAndAwake(citizen: Citizen): boolean {
  return (
    citizen.place.kind === 'building' &&
    citizen.place.id === citizen.homeId &&
    citizen.activity !== 'Sleep'
  );
}

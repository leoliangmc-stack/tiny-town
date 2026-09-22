import { doorPosition } from '../entities/Building.js';
import type { Citizen } from '../entities/Citizen.js';
import { distance } from '../entities/geometry.js';
import type { Point } from '../entities/geometry.js';
import { createCitizen, RESIDENTS, SCHEDULE_JITTER_MINUTES } from '../world/Population.js';
import { CAFE_ID, getBuilding, getZone } from '../world/Town.js';

import { GAME_MINUTES_PER_TICK } from './constants.js';
import { buildSidewalkGraph, entranceNodeId, NavGraph } from './Navigation.js';
import { Rng } from './Rng.js';

/**
 * How close to the next path point counts as having reached it. It only guards
 * against floating point leftovers: a citizen lands exactly on each point,
 * which keeps them on the route through corners.
 */
const ARRIVAL_TOLERANCE = 1e-6;

/**
 * Moves the citizens through their day.
 *
 * Phase 1 runs one loop per citizen: sleep at home, walk to the cafe, stay a
 * while, walk home, sleep again. Transitions are driven by the clock only. The
 * rule based state machine with personalities arrives in Phase 3.
 */
export class CitizenSystem {
  readonly citizens: Citizen[] = [];

  readonly sidewalks: NavGraph;
  private readonly seed: number | string;

  /**
   * Paths are worked out once per destination and kept (SPEC.md 3.2, rule 4:
   * cache paths, recompute only when the destination changes). Phase 1's two
   * destinations per citizen are still the only two, so both are built up
   * front and then reused every day.
   */
  private readonly routeToCafe = new Map<string, Point[]>();
  private readonly routeToHome = new Map<string, Point[]>();

  constructor(seed: number | string) {
    this.seed = seed;
    this.sidewalks = buildSidewalkGraph();

    const terrace = getZone('cafe-terrace');

    RESIDENTS.forEach((template, index) => {
      const homeDoor = doorPosition(getBuilding(template.homeId));
      const citizen = createCitizen(template, homeDoor);
      this.citizens.push(citizen);

      // Each citizen has their own spot on the terrace, so nobody stands where
      // somebody else is already standing.
      const spot = terrace.spawnPoints[index % terrace.spawnPoints.length];
      const toCafe = [
        ...this.sidewalks.findPath(entranceNodeId(template.homeId), entranceNodeId(CAFE_ID)),
        { ...spot },
      ];
      this.routeToCafe.set(citizen.id, toCafe);
      this.routeToHome.set(citizen.id, [...toCafe].reverse());
    });
  }

  find(id: string): Citizen | undefined {
    return this.citizens.find((citizen) => citizen.id === id);
  }

  /** Citizens currently inside the given building. */
  occupantsOf(buildingId: string): Citizen[] {
    return this.citizens.filter((citizen) => {
      if (citizen.activity === 'AtCafe') {
        return buildingId === CAFE_ID;
      }
      if (citizen.activity === 'Sleep' || citizen.activity === 'AtHome') {
        return buildingId === citizen.homeId;
      }
      return false;
    });
  }

  /** Whether anyone is home and awake, which is what lights a house's windows. */
  isLit(buildingId: string): boolean {
    return this.citizens.some(
      (citizen) => citizen.homeId === buildingId && citizen.activity === 'AtHome',
    );
  }

  /** Where the citizen faces while standing at the cafe: back towards the street. */
  private terraceHeading(index: number): number {
    return Math.PI + (index - this.citizens.length / 2) * 0.28;
  }

  tick(day: number, minuteOfDay: number): void {
    for (const citizen of this.citizens) {
      if (citizen.scheduleDay !== day) {
        this.rollSchedule(citizen, day);
      }
      this.advanceActivity(citizen, minuteOfDay);
      this.walk(citizen);
    }
  }

  /**
   * Picks today's times for one citizen: the written schedule plus a jitter of
   * a few minutes, so the town never moves in lockstep. The jitter comes from
   * the seed and the day, so it is the same however fast the day is played.
   */
  private rollSchedule(citizen: Citizen, day: number): void {
    const rng = new Rng(`${this.seed}:${citizen.id}:day-${day}`);
    const jitter = (): number => rng.nextFloat(-SCHEDULE_JITTER_MINUTES, SCHEDULE_JITTER_MINUTES);

    citizen.schedule = {
      wakeAt: citizen.baseSchedule.wakeAt + jitter(),
      leaveForCafeAt: citizen.baseSchedule.leaveForCafeAt + jitter(),
      cafeStayMinutes: citizen.baseSchedule.cafeStayMinutes + jitter(),
      sleepAt: citizen.baseSchedule.sleepAt + jitter(),
    };
    citizen.scheduleDay = day;
    citizen.visitedCafeToday = false;
  }

  private isAwakeTime(citizen: Citizen, minuteOfDay: number): boolean {
    return minuteOfDay >= citizen.schedule.wakeAt && minuteOfDay < citizen.schedule.sleepAt;
  }

  private advanceActivity(citizen: Citizen, minuteOfDay: number): void {
    switch (citizen.activity) {
      case 'Sleep':
        if (this.isAwakeTime(citizen, minuteOfDay)) {
          citizen.activity = 'AtHome';
        }
        return;

      case 'AtHome':
        if (!this.isAwakeTime(citizen, minuteOfDay)) {
          citizen.activity = 'Sleep';
          return;
        }
        if (!citizen.visitedCafeToday && minuteOfDay >= citizen.schedule.leaveForCafeAt) {
          citizen.visitedCafeToday = true;
          citizen.activity = 'WalkToCafe';
          this.startPath(citizen, this.routeToCafe.get(citizen.id) ?? []);
        }
        return;

      case 'WalkToCafe':
        if (this.hasArrived(citizen)) {
          citizen.activity = 'AtCafe';
          citizen.leaveCafeAt = minuteOfDay + citizen.schedule.cafeStayMinutes;
          citizen.heading = this.terraceHeading(this.citizens.indexOf(citizen));
        }
        return;

      case 'AtCafe':
        if (minuteOfDay >= citizen.leaveCafeAt) {
          citizen.activity = 'WalkHome';
          this.startPath(citizen, this.routeToHome.get(citizen.id) ?? []);
        }
        return;

      case 'WalkHome':
        if (this.hasArrived(citizen)) {
          citizen.activity = this.isAwakeTime(citizen, minuteOfDay) ? 'AtHome' : 'Sleep';
          citizen.path = [];
        }
        return;
    }
  }

  private startPath(citizen: Citizen, path: readonly Point[]): void {
    citizen.path = path.map((point) => ({ ...point }));
    citizen.pathIndex = 1;
    if (citizen.path.length > 0) {
      citizen.position = { ...citizen.path[0] };
    }
  }

  private hasArrived(citizen: Citizen): boolean {
    return citizen.pathIndex >= citizen.path.length;
  }

  /** Moves a walking citizen one tick along their path. */
  private walk(citizen: Citizen): void {
    if (citizen.activity !== 'WalkToCafe' && citizen.activity !== 'WalkHome') {
      return;
    }

    let remaining = citizen.walkSpeed * GAME_MINUTES_PER_TICK;

    while (remaining > 0 && citizen.pathIndex < citizen.path.length) {
      const target = citizen.path[citizen.pathIndex];
      const toTarget = distance(citizen.position, target);

      if (toTarget <= ARRIVAL_TOLERANCE) {
        citizen.position = { ...target };
        citizen.pathIndex += 1;
        continue;
      }

      citizen.heading = Math.atan2(target.x - citizen.position.x, target.z - citizen.position.z);

      const step = Math.min(remaining, toTarget);
      citizen.position = {
        x: citizen.position.x + ((target.x - citizen.position.x) / toTarget) * step,
        z: citizen.position.z + ((target.z - citizen.position.z) / toTarget) * step,
      };
      citizen.distanceWalked += step;
      remaining -= step;
    }
  }
}

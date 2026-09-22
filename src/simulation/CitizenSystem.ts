import { doorPosition } from '../entities/Building.js';
import type { Appointment, Citizen, Place } from '../entities/Citizen.js';
import { distance, type Point } from '../entities/geometry.js';
import { createPopulation } from '../world/Population.js';
import { getBuilding, getZone, type OutdoorZone } from '../world/Town.js';

import { GAME_MINUTES_PER_TICK } from './constants.js';
import { clockWords, EventLog, minutesInWords } from './EventLog.js';
import { buildSidewalkGraph, entranceNodeId, NavGraph } from './Navigation.js';
import { LATE_GRACE_MINUTES, ScheduleSystem } from './ScheduleSystem.js';

/** How each outdoor zone reads in a sentence. */
const ZONE_PHRASES: Record<string, string> = {
  'cafe-terrace': 'on the cafe terrace',
  'school-playground': 'in the schoolyard',
  'supermarket-forecourt': 'outside the supermarket',
  'bakery-front': 'outside the bakery',
  'office-front': 'outside the office',
  'park-lawn': 'in the park',
};

/** Floating point guard when stepping onto a path point. */
const ARRIVAL_TOLERANCE = 1e-6;

/** Social need climbs this much per game minute for a fully social person. */
const SOCIAL_NEED_RISE = 0.12;
/** ...and falls this much per minute while socialising. */
const SOCIAL_NEED_FALL = 2.5;
const SOCIAL_NEED_THRESHOLD = 70;

/** Hours in which a restless citizen may go out on a whim. */
const WHIM_FROM = 10 * 60;
const WHIM_UNTIL = 20 * 60 + 30;

/**
 * Moves the citizens through their days (SPEC.md 2.4).
 *
 * Each morning the ScheduleSystem hands every citizen a list of appointments.
 * The system starts each one when its time comes, walking there first if
 * needed, and fills the gaps sensibly: a finished errand leads home, a spare
 * hour at home is Relax, and a high social need can send somebody out to the
 * cafe terrace on a whim. Pure rules, no lookahead.
 */
export class CitizenSystem {
  readonly citizens: Citizen[];
  readonly sidewalks: NavGraph;
  readonly log = new EventLog();

  private readonly schedule: ScheduleSystem;
  /** Graph routes by node pair; a route is never worked out twice. */
  private readonly routeCache = new Map<string, Point[]>();
  /** Who stands on which spawn point of each zone, so nobody shares a spot. */
  private readonly occupiedSpots = new Map<string, Map<number, string>>();

  private anyoneUpToday = false;
  private everyoneAsleepLogged = false;
  /** Who has already had a meeting written up today, to keep the diary fresh. */
  private metToday = new Set<string>();

  constructor(seed: number | string) {
    this.sidewalks = buildSidewalkGraph();
    this.citizens = createPopulation((id) => doorPosition(getBuilding(id)));
    this.schedule = new ScheduleSystem(seed, (from, to) => this.routeLength(from, to));
  }

  find(id: string): Citizen | undefined {
    return this.citizens.find((citizen) => citizen.id === id);
  }

  /** Whether anyone is home and awake, which is what lights a house's windows. */
  isLit(buildingId: string): boolean {
    return this.citizens.some(
      (citizen) =>
        citizen.homeId === buildingId &&
        citizen.place.kind === 'building' &&
        citizen.place.id === buildingId &&
        citizen.activity !== 'Sleep',
    );
  }

  /** Citizens out of doors right now. */
  get outsideCount(): number {
    return this.citizens.filter((citizen) => citizen.place.kind !== 'building').length;
  }

  tick(day: number, minuteOfDay: number): void {
    if (this.citizens[0].planDay !== day) {
      this.startDay(day);
    }

    for (const citizen of this.citizens) {
      this.updateSocialNeed(citizen);
      this.advance(citizen, day, minuteOfDay);
      this.walk(citizen, day, minuteOfDay);
    }

    this.noteLastLightOut(day, minuteOfDay);
  }

  private startDay(day: number): void {
    for (const citizen of this.citizens) {
      citizen.plan = this.schedule.planDay(citizen, day);
      citizen.planIndex = 0;
      citizen.planDay = day;
      citizen.lateToday = 0;
    }
    this.anyoneUpToday = false;
    this.everyoneAsleepLogged = false;
    this.metToday.clear();
  }

  private updateSocialNeed(citizen: Citizen): void {
    if (citizen.activity === 'Socialize') {
      citizen.socialNeed = Math.max(
        0,
        citizen.socialNeed - SOCIAL_NEED_FALL * GAME_MINUTES_PER_TICK,
      );
    } else if (citizen.activity !== 'Sleep') {
      citizen.socialNeed +=
        SOCIAL_NEED_RISE * (citizen.personality.social / 100) * GAME_MINUTES_PER_TICK;
    }
  }

  /** Starts whatever is due: the next appointment, a whim, or a fallback. */
  private advance(citizen: Citizen, day: number, minute: number): void {
    if (citizen.activity === 'Walk' || citizen.activity === 'GoHome') {
      return;
    }

    const next = citizen.plan[citizen.planIndex];
    const busyUntil = citizen.activityUntil;
    // An open-ended activity (Work, Relax, Sleep) yields to the next
    // appointment; a timed one (a meal, a break) is seen through first.
    const free = !Number.isFinite(busyUntil) || minute >= busyUntil;

    if (next && next.at <= minute && free) {
      citizen.planIndex += 1;
      this.begin(citizen, next, day, minute);
      return;
    }

    if (minute >= busyUntil && Number.isFinite(busyUntil)) {
      // A timed activity has run its course with nothing else due yet.
      this.settle(citizen, day, minute);
      return;
    }

    if (this.wantsToGoOut(citizen, minute)) {
      this.log.record(day, minute, restlessLine(citizen), 'colour');
      this.begin(
        citizen,
        {
          at: minute,
          activity: 'Socialize',
          place: { kind: 'zone', id: 'cafe-terrace' },
          duration: 25,
        },
        day,
        minute,
      );
    }
  }

  private wantsToGoOut(citizen: Citizen, minute: number): boolean {
    if (citizen.socialNeed < SOCIAL_NEED_THRESHOLD || citizen.age < 16) {
      return false;
    }
    if (citizen.activity !== 'Relax' || citizen.place.id !== citizen.homeId) {
      return false;
    }
    if (minute < WHIM_FROM || minute > WHIM_UNTIL) {
      return false;
    }
    const next = citizen.plan[citizen.planIndex];
    return !next || next.at - minute > 60;
  }

  /** Where the day goes once a timed activity ends and nothing is due. */
  private settle(citizen: Citizen, day: number, minute: number): void {
    if (citizen.activity === 'Socialize') {
      citizen.socialNeed = 0;
    }
    if (citizen.place.kind === 'building' && citizen.place.id === citizen.homeId) {
      citizen.activity = 'Relax';
      citizen.activityUntil = Infinity;
      return;
    }
    this.begin(
      citizen,
      {
        at: minute,
        activity: 'Relax',
        place: { kind: 'building', id: citizen.homeId },
        duration: 0,
      },
      day,
      minute,
    );
  }

  /** Starts an appointment: walk there if needed, otherwise take it up at once. */
  private begin(citizen: Citizen, appointment: Appointment, day: number, minute: number): void {
    const samePlace =
      citizen.place.kind === appointment.place.kind && citizen.place.id === appointment.place.id;

    if (samePlace) {
      this.arrive(citizen, appointment, day, minute);
      return;
    }

    const route = this.routeTo(citizen, appointment.place);
    this.leaveSpot(citizen);
    citizen.path = route;
    citizen.pathIndex = 1;
    citizen.position = { ...route[0] };
    citizen.place = { kind: 'street', id: appointment.place.id };
    citizen.pending = appointment;
    citizen.activityUntil = Infinity;
    citizen.activity = appointment.place.id === citizen.homeId ? 'GoHome' : 'Walk';

    if (appointment.note) {
      this.log.record(day, minute, appointment.note, 'colour');
    }

    if (!this.anyoneUpToday && citizen.place.kind === 'street') {
      this.anyoneUpToday = true;
      this.log.record(
        day,
        minute,
        `${citizen.name} was the first out of the door this morning, at ${clockWords(minute)}.`,
      );
    }
  }

  /** Takes up an appointment on the spot. */
  private arrive(citizen: Citizen, appointment: Appointment, day: number, minute: number): void {
    citizen.place = { ...appointment.place };
    citizen.activity = appointment.activity;
    citizen.activityUntil = appointment.duration > 0 ? minute + appointment.duration : Infinity;
    citizen.path = [];
    delete citizen.pending;

    if (appointment.place.kind === 'zone') {
      this.takeSpot(citizen, getZone(appointment.place.id));
      this.noteMeeting(citizen, appointment.place.id, day, minute);
    } else {
      citizen.position = { ...doorPosition(getBuilding(appointment.place.id)) };
    }

    if (appointment.activity === 'Work' && appointment.due !== undefined) {
      const late = minute - appointment.due - LATE_GRACE_MINUTES;
      if (late > 0) {
        citizen.lateToday = late;
        const where = getBuilding(appointment.place.id).name;
        this.log.record(
          day,
          minute,
          `${citizen.name} got to ${where} ${minutesInWords(late)} late.`,
        );
      }
    }

    if (appointment.activity === 'Relax' && appointment.place.id === 'park-lawn') {
      const verb = citizen.job === 'Retired' ? 'took a walk to the park' : 'stopped by the park';
      this.log.record(day, minute, `${citizen.name} ${verb}.`, 'colour');
    }
    if (
      appointment.place.kind === 'zone' &&
      appointment.place.id !== 'park-lawn' &&
      appointment.place.id !== 'cafe-terrace' &&
      appointment.activity !== 'Work'
    ) {
      const where = getBuilding(getZone(appointment.place.id).buildingId).name;
      this.log.record(day, minute, `${citizen.name} took a break outside ${where}.`, 'colour');
    }
  }

  /** Two people in the same zone at once is the town's small talk. */
  private noteMeeting(citizen: Citizen, zoneId: string, day: number, minute: number): void {
    if (citizen.activity !== 'Socialize') {
      return;
    }
    const other = this.citizens.find(
      (candidate) =>
        candidate.id !== citizen.id &&
        candidate.place.kind === 'zone' &&
        candidate.place.id === zoneId &&
        candidate.activity === 'Socialize' &&
        !isFamily(citizen, candidate),
    );
    if (!other || this.metToday.has(citizen.id) || this.metToday.has(other.id)) {
      return;
    }
    this.metToday.add(citizen.id);
    this.metToday.add(other.id);

    const where = ZONE_PHRASES[zoneId] ?? 'in town';
    if (citizen.friends.includes(other.id)) {
      this.log.record(
        day,
        minute,
        `${citizen.name} ran into ${other.name} ${where} and stayed to talk.`,
      );
    } else {
      this.log.record(
        day,
        minute,
        `${citizen.name} and ${other.name} got talking ${where}.`,
        'colour',
      );
    }
  }

  private noteLastLightOut(day: number, minute: number): void {
    if (this.everyoneAsleepLogged || minute < 20 * 60) {
      return;
    }
    const awake = this.citizens.some((citizen) => citizen.activity !== 'Sleep');
    if (!awake) {
      this.everyoneAsleepLogged = true;
      this.log.record(
        day,
        minute,
        `The last light in town went out at ${clockWords(minute)}.`,
        'always',
      );
    }
  }

  // --- Routes -------------------------------------------------------------

  /** Metres on foot between two buildings, for planning leave times. */
  private routeLength(fromId: string, toId: string): number {
    const path = this.graphRoute(entranceNodeId(fromId), entranceNodeId(toId));
    let length = 0;
    for (let i = 1; i < path.length; i += 1) {
      length += distance(path[i - 1], path[i]);
    }
    return length;
  }

  private graphRoute(fromNode: string, toNode: string): Point[] {
    const key = `${fromNode}|${toNode}`;
    let route = this.routeCache.get(key);
    if (!route) {
      route = this.sidewalks.findPath(fromNode, toNode);
      this.routeCache.set(key, route);
    }
    return route;
  }

  /** The full route from where the citizen stands to the given place. */
  private routeTo(citizen: Citizen, place: Place): Point[] {
    const fromNode =
      citizen.place.kind === 'building'
        ? this.sidewalks.node(entranceNodeId(citizen.place.id))
        : this.sidewalks.nearestNode(citizen.position);

    if (place.kind === 'building') {
      const toNode = entranceNodeId(place.id);
      const route = this.graphRoute(fromNode.id, toNode);
      return citizen.place.kind === 'building' ? [...route] : [{ ...citizen.position }, ...route];
    }

    const zone = getZone(place.id);
    const spot = zone.spawnPoints[this.chooseSpot(citizen, zone)];
    const toNode = this.sidewalks.nearestNode(spot);
    const route = this.graphRoute(fromNode.id, toNode.id);
    const start = citizen.place.kind === 'building' ? [] : [{ ...citizen.position }];
    return [...start, ...route, { ...spot }];
  }

  // --- Zone spots ---------------------------------------------------------

  /** A free spawn point in the zone, chosen from the citizen's own preferred one. */
  private chooseSpot(citizen: Citizen, zone: OutdoorZone): number {
    const taken = this.occupiedSpots.get(zone.id) ?? new Map<number, string>();
    const preferred = hashText(citizen.id) % zone.spawnPoints.length;
    for (let attempt = 0; attempt < zone.spawnPoints.length; attempt += 1) {
      const index = (preferred + attempt) % zone.spawnPoints.length;
      if (!taken.has(index)) {
        return index;
      }
    }
    return preferred;
  }

  private takeSpot(citizen: Citizen, zone: OutdoorZone): void {
    const index = this.chooseSpot(citizen, zone);
    const taken = this.occupiedSpots.get(zone.id) ?? new Map<number, string>();
    taken.set(index, citizen.id);
    this.occupiedSpots.set(zone.id, taken);

    const spot = zone.spawnPoints[index];
    citizen.position = { ...spot };
    // Face the building the zone belongs to, or the middle of the park.
    const focus =
      zone.buildingId === 'park'
        ? { x: (zone.minX + zone.maxX) / 2, z: (zone.minZ + zone.maxZ) / 2 }
        : doorPosition(getBuilding(zone.buildingId));
    citizen.heading = Math.atan2(focus.x - spot.x, focus.z - spot.z);
  }

  private leaveSpot(citizen: Citizen): void {
    if (citizen.place.kind !== 'zone') {
      return;
    }
    const taken = this.occupiedSpots.get(citizen.place.id);
    if (!taken) {
      return;
    }
    for (const [index, id] of taken) {
      if (id === citizen.id) {
        taken.delete(index);
      }
    }
  }

  // --- Movement -----------------------------------------------------------

  /** Moves a walking citizen one tick along their path, arriving if it ends. */
  private walk(citizen: Citizen, day: number, minute: number): void {
    if (citizen.activity !== 'Walk' && citizen.activity !== 'GoHome') {
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

    if (citizen.pathIndex >= citizen.path.length && citizen.pending) {
      this.arrive(citizen, citizen.pending, day, minute);
    }
  }
}

/** Three ways of saying somebody could not sit still, so the diary varies. */
function restlessLine(citizen: Citizen): string {
  const lines = [
    `${citizen.name} got restless at home and went out to the cafe terrace.`,
    `${citizen.name} wanted company and wandered down to the cafe.`,
    `With nothing on, ${citizen.name} headed out to the cafe terrace to see who was about.`,
  ];
  return lines[hashText(citizen.id) % lines.length];
}

function isFamily(a: Citizen, b: Citizen): boolean {
  return (
    a.family.spouse === b.id ||
    a.family.parents.includes(b.id) ||
    a.family.children.includes(b.id) ||
    a.family.siblings.includes(b.id)
  );
}

/** A small stable hash, for spreading citizens over a zone's spots. */
function hashText(text: string): number {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
  }
  return hash >>> 0;
}

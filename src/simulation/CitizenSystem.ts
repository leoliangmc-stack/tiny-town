import { doorPosition } from '../entities/Building.js';
import type { Appointment, Citizen, Place } from '../entities/Citizen.js';
import type { Vehicle } from '../entities/Vehicle.js';
import { distance, type Point } from '../entities/geometry.js';
import { createPopulation } from '../world/Population.js';
import { getBuilding, getZone, type OutdoorZone } from '../world/Town.js';

import { GAME_MINUTES_PER_TICK } from './constants.js';
import { clockWords, EventLog, minutesInWords } from './EventLog.js';
import { buildSidewalkGraph, entranceNodeId, NavGraph } from './Navigation.js';
import {
  CAFE_ZONE_ID,
  LATE_GRACE_MINUTES,
  PARK_ZONE_ID,
  ScheduleSystem,
} from './ScheduleSystem.js';
import { VehicleSystem } from './VehicleSystem.js';
import type { Weather } from './WeatherSystem.js';

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
 * The rain rules (SPEC.md 2.8). Somebody this fond of the outdoors keeps to
 * their plans in the rain, under an umbrella; everybody else gives up the
 * park and the break outside. Of those, the sociable go to the cafe terrace
 * instead, which is under an awning and where they meet each other; the
 * rest go home. A whim to go out needs a little more restlessness in the rain.
 */
const RAIN_HARDY_OUTDOOR = 80;
const RAIN_CAFE_SOCIAL = 45;
const RAIN_WHIM_EXTRA = 15;

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

  private weather: Weather = 'Sunny';
  /** Who has already decided what to do about today's rain, so nobody dithers. */
  private shelteredToday = new Set<string>();
  /** Who is at the cafe because the rain sent them there, for the diary. */
  private rainedInToday = new Set<string>();
  /** This tick's rain decisions, written up together so the diary reads as prose. */
  private rainNotes: Array<{ id: string; name: string; kind: RainNote }> = [];
  /** How many rain lines the diary has had today; after a couple they become colour. */
  private rainLinesToday = 0;

  /** Set by the World once the road graph exists; citizens walk until then. */
  vehicles: VehicleSystem | undefined;

  constructor(seed: number | string) {
    this.sidewalks = buildSidewalkGraph();
    this.citizens = createPopulation((id) => doorPosition(getBuilding(id)));
    this.schedule = new ScheduleSystem(seed, (from, to) => this.routeLength(from, to));
  }

  homeOf(citizenId: string): string {
    const citizen = this.find(citizenId);
    if (!citizen) {
      throw new Error(`Unknown citizen: ${citizenId}`);
    }
    return citizen.homeId;
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

  /**
   * Citizens in the open: outside, on foot, and not under the cafe's awning.
   * This is what the rain is measured against (SPEC.md 2.8).
   */
  get inTheOpenCount(): number {
    return this.citizens.filter(
      (citizen) =>
        citizen.place.kind !== 'building' &&
        citizen.activity !== 'Drive' &&
        !(citizen.place.kind === 'zone' && citizen.place.id === CAFE_ZONE_ID),
    ).length;
  }

  tick(day: number, minuteOfDay: number, weather: Weather = 'Sunny'): void {
    if (this.citizens[0].planDay !== day) {
      this.startDay(day);
    }
    if (weather !== this.weather) {
      this.weather = weather;
      // A change of weather is a fresh question for everyone outside.
      this.shelteredToday.clear();
    }

    for (const citizen of this.citizens) {
      this.updateSocialNeed(citizen);
      this.advance(citizen, day, minuteOfDay);
      this.walk(citizen, day, minuteOfDay);
      this.ride(citizen, day, minuteOfDay);
    }

    this.flushRainNotes(day, minuteOfDay);
    this.noteLastLightOut(day, minuteOfDay);
  }

  /**
   * One sentence per kind of decision, however many people made it at once:
   * "Because of the rain, Clara, June and Sam gave up on the park and went
   * to the cafe instead." rather than the same line six times.
   */
  private flushRainNotes(day: number, minute: number): void {
    if (this.rainNotes.length === 0) {
      return;
    }
    for (const kind of ['cafe', 'skip-cafe', 'home', 'skip-home', 'inside'] as const) {
      const notes = this.rainNotes.filter((note) => note.kind === kind);
      if (notes.length === 0) {
        continue;
      }
      const names = notes.map((note) => note.name);
      const ids = notes.map((note) => note.id);
      const who = listNames(names);
      const plural = names.length > 1;
      // The first couple of rain lines a day are milestones; the rest are
      // colour, so a wet morning does not crowd everything else out.
      const priority = this.rainLinesToday < 2 ? 'milestone' : 'colour';
      if (kind === 'cafe') {
        this.rainLinesToday += 1;
        this.log.record(
          day,
          minute,
          `Because of the rain, ${who} gave up on the park and went to the cafe instead.`,
          priority,
          { who: ids, where: CAFE_ZONE_ID },
        );
      } else if (kind === 'skip-cafe') {
        this.rainLinesToday += 1;
        this.log.record(
          day,
          minute,
          `Because of the rain, ${who} skipped the park and went to the cafe instead.`,
          priority,
          { who: ids, where: CAFE_ZONE_ID },
        );
      } else if (kind === 'home') {
        this.rainLinesToday += 1;
        this.log.record(
          day,
          minute,
          `Because of the rain, ${who} gave up on the park and went home.`,
          priority,
          { who: ids, where: PARK_ZONE_ID },
        );
      } else if (kind === 'skip-home') {
        this.log.record(
          day,
          minute,
          `${who} thought better of the park in the rain and stayed in.`,
          'colour',
          { who: ids },
        );
      } else {
        this.log.record(
          day,
          minute,
          `The rain sent ${who} back inside before the break was ${plural ? 'over' : 'up'}.`,
          'colour',
          { who: ids },
        );
      }
    }
    this.rainNotes = [];
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
    this.shelteredToday.clear();
    this.rainedInToday.clear();
    this.rainLinesToday = 0;
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
    // Rain is a question for people on their way somewhere too, so it is
    // asked before a walker is left to walk.
    if (this.weather === 'Rain' && this.shelterFromRain(citizen, day, minute)) {
      return;
    }
    if (
      citizen.activity === 'Walk' ||
      citizen.activity === 'GoHome' ||
      citizen.activity === 'Drive'
    ) {
      return;
    }

    const next = citizen.plan[citizen.planIndex];
    const busyUntil = citizen.activityUntil;
    // An open-ended activity (Work, Relax, Sleep) yields to the next
    // appointment; a timed one (a meal, a break) is seen through first.
    const free = !Number.isFinite(busyUntil) || minute >= busyUntil;

    if (next && next.at <= minute && free) {
      citizen.planIndex += 1;
      const changed = this.weather === 'Rain' ? this.rainInstead(citizen, next) : next;
      if (changed) {
        this.begin(citizen, changed, day, minute);
      }
      return;
    }

    if (minute >= busyUntil && Number.isFinite(busyUntil)) {
      // A timed activity has run its course with nothing else due yet.
      this.settle(citizen, day, minute);
      return;
    }

    if (this.wantsToGoOut(citizen, minute)) {
      this.log.record(day, minute, restlessLine(citizen), 'colour', {
        who: [citizen.id],
        where: 'cafe-terrace',
      });
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
    const threshold = SOCIAL_NEED_THRESHOLD + (this.weather === 'Rain' ? RAIN_WHIM_EXTRA : 0);
    if (citizen.socialNeed < threshold || citizen.age < 16) {
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

  /**
   * What somebody already out of doors does when it rains (SPEC.md 2.8).
   * Returns true when it changed their day. Asked once per citizen per
   * spell of rain, so nobody is chased around by the same shower twice.
   */
  private shelterFromRain(citizen: Citizen, day: number, minute: number): boolean {
    if (this.shelteredToday.has(citizen.id)) {
      return false;
    }
    if (citizen.activity === 'Walk' && citizen.pending && !citizen.tripStage) {
      return this.turnBackFromRain(citizen, citizen.pending, day, minute);
    }
    if (citizen.place.kind !== 'zone' || citizen.activity === 'Work') {
      return false;
    }
    this.shelteredToday.add(citizen.id);
    const zoneId = citizen.place.id;
    if (zoneId === CAFE_ZONE_ID) {
      return false;
    }
    if (citizen.personality.outdoorPreference >= RAIN_HARDY_OUTDOOR) {
      if (zoneId === PARK_ZONE_ID) {
        this.log.record(
          day,
          minute,
          `${citizen.name} stayed on in the park under an umbrella, rain or no rain.`,
          'colour',
          { who: [citizen.id], where: PARK_ZONE_ID },
        );
      }
      return false;
    }

    const onBreak = zoneId !== PARK_ZONE_ID;
    if (onBreak && citizen.workplaceId) {
      // Back inside early; the break is over.
      this.rainNotes.push({ id: citizen.id, name: citizen.name, kind: 'inside' });
      this.begin(
        citizen,
        {
          at: minute,
          activity: 'Work',
          place: { kind: 'building', id: citizen.workplaceId },
          duration: 0,
        },
        day,
        minute,
      );
      return true;
    }

    if (citizen.personality.social >= RAIN_CAFE_SOCIAL && citizen.age >= 16) {
      this.rainNotes.push({ id: citizen.id, name: citizen.name, kind: 'cafe' });
      this.rainedInToday.add(citizen.id);
      this.begin(
        citizen,
        {
          at: minute,
          activity: 'Socialize',
          place: { kind: 'zone', id: CAFE_ZONE_ID },
          duration: 25,
        },
        day,
        minute,
      );
      return true;
    }

    this.rainNotes.push({ id: citizen.id, name: citizen.name, kind: 'home' });
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
    return true;
  }

  /**
   * Somebody on foot towards the park or a break outside when the rain
   * starts turns round: the sociable for the cafe, the rest for home; a
   * worker on the way to a break goes straight back in.
   */
  private turnBackFromRain(
    citizen: Citizen,
    pending: Appointment,
    day: number,
    minute: number,
  ): boolean {
    if (
      pending.place.kind !== 'zone' ||
      pending.place.id === CAFE_ZONE_ID ||
      pending.activity === 'Work' ||
      citizen.personality.outdoorPreference >= RAIN_HARDY_OUTDOOR
    ) {
      return false;
    }
    this.shelteredToday.add(citizen.id);
    if (pending.place.id !== PARK_ZONE_ID && citizen.workplaceId) {
      this.rainNotes.push({ id: citizen.id, name: citizen.name, kind: 'inside' });
      this.begin(
        citizen,
        {
          at: minute,
          activity: 'Work',
          place: { kind: 'building', id: citizen.workplaceId },
          duration: 0,
        },
        day,
        minute,
      );
      return true;
    }
    if (citizen.personality.social >= RAIN_CAFE_SOCIAL && citizen.age >= 16) {
      this.rainNotes.push({ id: citizen.id, name: citizen.name, kind: 'cafe' });
      this.rainedInToday.add(citizen.id);
      this.begin(
        citizen,
        {
          at: minute,
          activity: 'Socialize',
          place: { kind: 'zone', id: CAFE_ZONE_ID },
          duration: 25,
        },
        day,
        minute,
      );
      return true;
    }
    this.rainNotes.push({ id: citizen.id, name: citizen.name, kind: 'home' });
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
    return true;
  }

  /**
   * What becomes of an appointment that falls due in the rain: the park and
   * the break outside are given up by all but the hardy, the sociable going
   * to the cafe instead. Returns the appointment to begin, or nothing.
   */
  private rainInstead(citizen: Citizen, next: Appointment): Appointment | undefined {
    if (next.place.kind !== 'zone' || next.place.id === CAFE_ZONE_ID || next.activity === 'Work') {
      return next;
    }
    if (citizen.personality.outdoorPreference >= RAIN_HARDY_OUTDOOR) {
      return next;
    }
    if (next.place.id !== PARK_ZONE_ID) {
      // A break outside the workplace: taken indoors instead.
      this.rainNotes.push({ id: citizen.id, name: citizen.name, kind: 'inside' });
      return undefined;
    }
    if (citizen.personality.social >= RAIN_CAFE_SOCIAL && citizen.age >= 16) {
      this.rainNotes.push({ id: citizen.id, name: citizen.name, kind: 'skip-cafe' });
      this.rainedInToday.add(citizen.id);
      return {
        ...next,
        activity: 'Socialize',
        place: { kind: 'zone', id: CAFE_ZONE_ID },
        duration: 25,
      };
    }
    this.rainNotes.push({ id: citizen.id, name: citizen.name, kind: 'skip-home' });
    return undefined;
  }

  /** Where the day goes once a timed activity ends and nothing is due. */
  private settle(citizen: Citizen, day: number, minute: number): void {
    if (citizen.activity === 'Socialize') {
      citizen.socialNeed = 0;
    }
    const next = citizen.plan[citizen.planIndex];
    const atHome = citizen.place.kind === 'building' && citizen.place.id === citizen.homeId;
    // Nothing due for a while: home. Something due soon: wait where you are
    // rather than set off home for four minutes, as long as the whole stay
    // at this spot remains a short one.
    const shortWait =
      next !== undefined && next.at - minute < 20 && next.at - citizen.arrivedAt < 28;
    if (atHome || shortWait) {
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

    const vehicle = this.vehicleFor(citizen, appointment.place);
    const route = vehicle
      ? [{ ...citizen.position }, { ...vehicle.position }]
      : this.routeTo(citizen, appointment.place);
    this.leaveSpot(citizen);
    citizen.path = route;
    citizen.pathIndex = 1;
    citizen.position = { ...route[0] };
    citizen.place = { kind: 'street', id: appointment.place.id };
    citizen.pending = appointment;
    citizen.activityUntil = Infinity;
    citizen.activity = appointment.place.id === citizen.homeId ? 'GoHome' : 'Walk';
    if (vehicle) {
      // First leg on foot, to where the car is parked.
      citizen.tripStage = 'toVehicle';
      citizen.vehicleId = vehicle.id;
    } else {
      delete citizen.tripStage;
      delete citizen.vehicleId;
    }

    if (appointment.note) {
      this.log.record(day, minute, appointment.note, 'colour', {
        who: [citizen.id],
        where: appointment.place.id,
      });
    }

    if (!this.anyoneUpToday && citizen.place.kind === 'street') {
      this.anyoneUpToday = true;
      this.log.record(
        day,
        minute,
        `${citizen.name} was the first out of the door this morning, at ${clockWords(minute)}.`,
        'milestone',
        { who: [citizen.id], where: citizen.homeId },
      );
    }
  }

  /**
   * The vehicle a citizen takes for this trip, if any: their own, parked where
   * they are, with somewhere to park at the far end (SPEC.md 2.5). Otherwise
   * they walk, and the car stays put.
   */
  private vehicleFor(citizen: Citizen, destination: Place): Vehicle | undefined {
    if (!this.vehicles || citizen.place.kind === 'street') {
      return undefined;
    }
    const vehicle = this.vehicles.vehicleOf(citizen.id);
    const parkedHere =
      vehicle &&
      (this.vehicles.isParkedAt(vehicle, citizen.place) ||
        this.vehicles.isParkedNear(vehicle, citizen.position));
    if (!vehicle || !parkedHere) {
      return undefined;
    }
    // A trip that ends where the car already stands (a building and its own
    // outdoor zone, or a place just down the street) is walked, unless it is
    // raining, when the car is taken even for a short hop (SPEC.md 2.8).
    if (
      this.weather !== 'Rain' &&
      this.vehicles.isParkedNear(vehicle, this.arrivalPoint(citizen, destination))
    ) {
      return undefined;
    }
    if (vehicle.workplaceId) {
      // A works van does the rounds and nothing else: out to a house and
      // back to the yard. It never goes home with the driver or to the cafe.
      const destinationKind =
        destination.kind === 'building' ? getBuilding(destination.id).kind : null;
      const onRounds =
        destination.id === vehicle.workplaceId ||
        ((destinationKind === 'house' || destinationKind === 'apartment') &&
          destination.id !== citizen.homeId);
      return onRounds ? vehicle : undefined;
    }
    return vehicle;
  }

  /**
   * The driven legs of a trip. On foot to the car, then aboard while the
   * VehicleSystem drives, then on foot from the car to the door. The citizen's
   * position follows the car while aboard, so anything following the citizen
   * sees one continuous track.
   */
  private ride(citizen: Citizen, day: number, minute: number): void {
    const vehicles = this.vehicles;
    if (!vehicles || !citizen.vehicleId || !citizen.pending) {
      return;
    }
    const vehicle = vehicles.find(citizen.vehicleId);
    if (!vehicle) {
      return;
    }

    if (citizen.tripStage === 'toVehicle' && citizen.pathIndex >= citizen.path.length) {
      if (vehicles.beginTrip(vehicle, citizen.id, citizen.pending.place)) {
        citizen.tripStage = 'driving';
        citizen.activity = 'Drive';
        citizen.path = [];
      } else {
        // Nowhere to park or no road: walk instead, from where the car is.
        delete citizen.tripStage;
        delete citizen.vehicleId;
        citizen.path = this.routeTo(citizen, citizen.pending.place);
        citizen.pathIndex = 1;
        citizen.activity = citizen.pending.place.id === citizen.homeId ? 'GoHome' : 'Walk';
      }
      return;
    }

    if (citizen.tripStage === 'driving') {
      citizen.position = { ...VehicleSystem.roadPosition(vehicle) };
      citizen.heading = vehicle.heading;
      if (vehicle.state === 'parked') {
        // Last leg on foot: from the space to the door, or the spot in the zone.
        citizen.tripStage = 'fromVehicle';
        citizen.activity = citizen.pending.place.id === citizen.homeId ? 'GoHome' : 'Walk';
        citizen.position = { ...vehicle.position };
        citizen.path = [{ ...vehicle.position }, this.arrivalPoint(citizen, citizen.pending.place)];
        citizen.pathIndex = 1;
      }
      return;
    }

    if (citizen.tripStage === 'fromVehicle' && citizen.pathIndex >= citizen.path.length) {
      delete citizen.tripStage;
      delete citizen.vehicleId;
      this.arrive(citizen, citizen.pending, day, minute);
    }
  }

  /** Where a trip to a place ends: its door, or the citizen's spot in the zone. */
  private arrivalPoint(citizen: Citizen, place: Place): Point {
    if (place.kind === 'zone') {
      const zone = getZone(place.id);
      return { ...zone.spawnPoints[this.chooseSpot(citizen, zone)] };
    }
    return { ...doorPosition(getBuilding(place.id)) };
  }

  /** Takes up an appointment on the spot. */
  private arrive(citizen: Citizen, appointment: Appointment, day: number, minute: number): void {
    citizen.place = { ...appointment.place };
    citizen.activity = appointment.activity;
    citizen.activityUntil = appointment.duration > 0 ? minute + appointment.duration : Infinity;
    citizen.arrivedAt = minute;
    citizen.path = [];
    delete citizen.pending;

    if (appointment.place.kind === 'zone') {
      this.takeSpot(citizen, getZone(appointment.place.id));
      this.noteMeeting(citizen, appointment.place.id, day, minute);
    } else {
      citizen.position = { ...doorPosition(getBuilding(appointment.place.id)) };
    }

    // The town opens on Day 1 at 05:30, in the middle of the bakers' first
    // shift, so nobody can be late that day: the diary would otherwise open
    // on a row of "got to the bakery forty minutes late".
    if (appointment.activity === 'Work' && appointment.due !== undefined && day > 1) {
      const late = minute - appointment.due - LATE_GRACE_MINUTES;
      if (late > 0) {
        citizen.lateToday = late;
        const where = getBuilding(appointment.place.id).name;
        this.log.record(
          day,
          minute,
          `${citizen.name} got to ${where} ${minutesInWords(late)} late.`,
          'milestone',
          { who: [citizen.id], where: appointment.place.id },
        );
      }
    }

    if (appointment.activity === 'Relax' && appointment.place.id === 'park-lawn') {
      const verb = citizen.job === 'Retired' ? 'took a walk to the park' : 'stopped by the park';
      this.log.record(day, minute, `${citizen.name} ${verb}.`, 'colour', {
        who: [citizen.id],
        where: PARK_ZONE_ID,
      });
    }
    if (
      appointment.place.kind === 'zone' &&
      appointment.place.id !== 'park-lawn' &&
      appointment.place.id !== 'cafe-terrace' &&
      appointment.activity !== 'Work'
    ) {
      const where = getBuilding(getZone(appointment.place.id).buildingId).name;
      this.log.record(day, minute, `${citizen.name} took a break outside ${where}.`, 'colour', {
        who: [citizen.id],
        where: appointment.place.id,
      });
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
    const about = { who: [citizen.id, other.id], where: zoneId };
    if (this.rainedInToday.has(citizen.id) && this.rainedInToday.has(other.id)) {
      this.log.record(
        day,
        minute,
        `${citizen.name} and ${other.name}, both driven in by the rain, got talking ${where}.`,
        'always',
        about,
      );
      return;
    }
    if (this.rainedInToday.has(citizen.id)) {
      this.log.record(
        day,
        minute,
        `${citizen.name}, in out of the rain, found ${other.name} ${where} and stayed to talk.`,
        'milestone',
        about,
      );
      return;
    }
    if (citizen.friends.includes(other.id)) {
      this.log.record(
        day,
        minute,
        `${citizen.name} ran into ${other.name} ${where} and stayed to talk.`,
        'milestone',
        about,
      );
    } else {
      this.log.record(
        day,
        minute,
        `${citizen.name} and ${other.name} got talking ${where}.`,
        'colour',
        about,
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

    if (citizen.pathIndex >= citizen.path.length && citizen.pending && !citizen.tripStage) {
      this.arrive(citizen, citizen.pending, day, minute);
    }
  }
}

type RainNote = 'cafe' | 'skip-cafe' | 'home' | 'skip-home' | 'inside';

/** "Ada", "Ada and Ben", "Ada, Ben and Clara". */
function listNames(names: string[]): string {
  if (names.length <= 1) {
    return names[0] ?? '';
  }
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
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

import type { Place } from '../entities/Citizen.js';
import { distance, type Point } from '../entities/geometry.js';
import type { Vehicle } from '../entities/Vehicle.js';
import { FLEET, VEHICLE_SPEED } from '../world/Fleet.js';
import { SIDEWALK_EDGE, TRAFFIC_LIGHTS, type TrafficLight } from '../world/Town.js';

import { GAME_MINUTES_PER_TICK } from './constants.js';
import { kerbSpaceHeading, NavGraph, parkingNodeId, parkingNodesForPlace } from './Navigation.js';

/** Floating point guard when stepping onto a path point. */
const ARRIVAL_TOLERANCE = 1e-6;

/**
 * How far to the right of the centreline a car drives, so two can pass and
 * both stay clear of the cars parked half up on the kerb (Navigation.ts).
 */
const LANE_OFFSET = 1.2;

/** A car holds this far behind the one ahead in its lane. */
const FOLLOWING_GAP = 7;
/** ...and counts as "in its lane" within this sideways tolerance. */
const LANE_TOLERANCE = 2.4;

/** How far down the street a car may park, and still count as at the place. */
const OVERFLOW_RADIUS = 36;

/** Where a car waits at a red light: just short of the junction's pavement corner. */
const STOP_LINE = SIDEWALK_EDGE + 2;

/**
 * Drives the town's eight vehicles (SPEC.md 2.5, PHASES.md Phase 4).
 *
 * A vehicle is parked at a node of the road graph until a citizen takes it on
 * a trip; then it follows an A* route along the centrelines, keeping to the
 * right, stopping at a red light and behind the car in front, and parks at
 * the first free space at the far end. Nothing here looks ahead further than
 * the next car; there are no lanes to change and no congestion to model.
 */
export class VehicleSystem {
  readonly vehicles: Vehicle[] = [];

  private readonly routeCache = new Map<string, Point[]>();

  constructor(
    private readonly roads: NavGraph,
    /** The house a citizen lives in, for where their car spends the night. */
    homeOf: (citizenId: string) => string,
  ) {
    let vanIndex = 0;
    for (const template of FLEET) {
      const homeNodeId = template.workplaceId
        ? parkingNodeId(vanIndex++)
        : parkingNodesForPlace({ kind: 'building', id: homeOf(template.ownerId ?? '') })[0];
      const home = roads.node(homeNodeId).position;
      const vehicle: Vehicle = {
        id: template.id,
        kind: template.kind,
        color: template.color,
        homeNodeId,
        speed: VEHICLE_SPEED[template.kind],
        state: 'parked',
        parkedAtNodeId: homeNodeId,
        position: { ...home },
        heading: parkedHeading(homeNodeId, 0),
        distanceDriven: 0,
        path: [],
        pathIndex: 0,
        waiting: null,
        heldForMinutes: 0,
      };
      if (template.ownerId) {
        vehicle.ownerId = template.ownerId;
      }
      if (template.workplaceId) {
        vehicle.workplaceId = template.workplaceId;
      }
      this.vehicles.push(vehicle);
    }
  }

  find(id: string): Vehicle | undefined {
    return this.vehicles.find((vehicle) => vehicle.id === id);
  }

  /** The vehicle a citizen may take: their own car, or the van they drive. */
  vehicleOf(citizenId: string): Vehicle | undefined {
    const own = this.vehicles.find((vehicle) => vehicle.ownerId === citizenId);
    if (own) {
      return own;
    }
    const template = FLEET.find((entry) => entry.driverId === citizenId);
    return template ? this.find(template.id) : undefined;
  }

  /** Whether the vehicle is parked at one of the given place's spaces. */
  isParkedAt(vehicle: Vehicle, place: Place): boolean {
    if (vehicle.state !== 'parked' || place.kind === 'street') {
      return false;
    }
    return parkingNodesForPlace(place).includes(vehicle.parkedAtNodeId);
  }

  /**
   * Whether the vehicle is parked within a short walk of a point. A car that
   * had to park down the street still counts as "here" to its owner.
   */
  isParkedNear(vehicle: Vehicle, point: Point): boolean {
    return vehicle.state === 'parked' && distance(vehicle.position, point) <= OVERFLOW_RADIUS;
  }

  /** Vehicles driving right now. */
  get movingCount(): number {
    return this.vehicles.filter((vehicle) => vehicle.state === 'driving').length;
  }

  /**
   * Sends a parked vehicle towards a place. Returns false when the place has
   * no space to park at or no road leads there.
   */
  beginTrip(vehicle: Vehicle, driverId: string, destination: Place): boolean {
    if (vehicle.state !== 'parked') {
      return false;
    }
    const spaces = parkingNodesForPlace(destination);
    // The place's own spaces first; failing those, the nearest free space
    // down the street; failing that, double park rather than not go.
    const target =
      spaces.find((nodeId) => this.spaceIsFree(nodeId)) ??
      this.nearestFreeSpace(this.roads.node(spaces[0]).position) ??
      spaces[0];
    if (!target) {
      return false;
    }
    const route = this.route(vehicle.parkedAtNodeId, target);
    if (route.length < 2) {
      return false;
    }

    vehicle.state = 'driving';
    vehicle.driverId = driverId;
    vehicle.destinationNodeId = target;
    vehicle.path = route;
    vehicle.pathIndex = 1;
    vehicle.position = { ...route[0] };
    vehicle.waiting = null;
    vehicle.heldForMinutes = 0;
    return true;
  }

  /** The closest free parking node within a short walk of a point, if any. */
  private nearestFreeSpace(point: Point): string | undefined {
    let best: { id: string; away: number } | undefined;
    for (const node of this.roads.allNodes) {
      if (!node.id.startsWith('kerb-') && !node.id.startsWith('parking-')) {
        continue;
      }
      if (node.id === 'parking-entrance' || !this.spaceIsFree(node.id)) {
        continue;
      }
      const away = distance(point, node.position);
      if (away <= OVERFLOW_RADIUS && (!best || away < best.away)) {
        best = { id: node.id, away };
      }
    }
    return best?.id;
  }

  private spaceIsFree(nodeId: string): boolean {
    return !this.vehicles.some(
      (vehicle) =>
        (vehicle.state === 'parked' && vehicle.parkedAtNodeId === nodeId) ||
        (vehicle.state === 'driving' && vehicle.destinationNodeId === nodeId),
    );
  }

  private route(fromNodeId: string, toNodeId: string): Point[] {
    const key = `${fromNodeId}|${toNodeId}`;
    let route = this.routeCache.get(key);
    if (!route) {
      route = this.roads.findPath(fromNodeId, toNodeId);
      this.routeCache.set(key, route);
    }
    return route;
  }

  tick(minuteOfDay: number): void {
    for (const vehicle of this.vehicles) {
      if (vehicle.state === 'driving') {
        this.drive(vehicle, minuteOfDay);
      }
    }
  }

  /** Whether a light shows green to traffic travelling along the given axis. */
  isGreen(light: TrafficLight, axis: 'x' | 'z', minuteOfDay: number): boolean {
    const cycle = light.greenMinutes * 2;
    const phase = minuteOfDay % cycle;
    return axis === 'x' ? phase < light.greenMinutes : phase >= light.greenMinutes;
  }

  /** Moves one vehicle a tick along its path, or holds it. */
  private drive(vehicle: Vehicle, minuteOfDay: number): void {
    const target = vehicle.path[vehicle.pathIndex];
    if (!target) {
      this.park(vehicle);
      return;
    }

    const dx = target.x - vehicle.position.x;
    const dz = target.z - vehicle.position.z;
    const toTarget = Math.hypot(dx, dz);
    const direction = toTarget > ARRIVAL_TOLERANCE ? { x: dx / toTarget, z: dz / toTarget } : null;

    if (direction) {
      const held: Vehicle['waiting'] = this.heldByLight(vehicle, direction, minuteOfDay)
        ? 'light'
        : this.heldByCarAhead(vehicle, direction)
          ? 'car'
          : null;
      if (held) {
        vehicle.waiting = held;
        vehicle.heldForMinutes += GAME_MINUTES_PER_TICK;
        return;
      }
    }
    vehicle.waiting = null;
    vehicle.heldForMinutes = 0;

    let remaining = vehicle.speed * GAME_MINUTES_PER_TICK;
    while (remaining > 0 && vehicle.pathIndex < vehicle.path.length) {
      const next = vehicle.path[vehicle.pathIndex];
      const gapX = next.x - vehicle.position.x;
      const gapZ = next.z - vehicle.position.z;
      const gap = Math.hypot(gapX, gapZ);

      if (gap <= ARRIVAL_TOLERANCE) {
        vehicle.position = { ...next };
        vehicle.pathIndex += 1;
        continue;
      }

      vehicle.heading = Math.atan2(gapX, gapZ);
      const step = Math.min(remaining, gap);
      vehicle.position = {
        x: vehicle.position.x + (gapX / gap) * step,
        z: vehicle.position.z + (gapZ / gap) * step,
      };
      vehicle.distanceDriven += step;
      remaining -= step;
    }

    if (vehicle.pathIndex >= vehicle.path.length) {
      this.park(vehicle);
    }
  }

  private park(vehicle: Vehicle): void {
    const nodeId = vehicle.destinationNodeId ?? vehicle.parkedAtNodeId;
    vehicle.state = 'parked';
    vehicle.parkedAtNodeId = nodeId;
    vehicle.position = { ...this.roads.node(nodeId).position };
    vehicle.heading = parkedHeading(nodeId, vehicle.heading);
    vehicle.path = [];
    vehicle.pathIndex = 0;
    vehicle.waiting = null;
    vehicle.heldForMinutes = 0;
    delete vehicle.destinationNodeId;
    delete vehicle.driverId;
  }

  /** Red for this vehicle's direction, and close enough to the junction to stop. */
  private heldByLight(vehicle: Vehicle, direction: Point, minuteOfDay: number): boolean {
    const axis: 'x' | 'z' = Math.abs(direction.x) > Math.abs(direction.z) ? 'x' : 'z';
    for (const light of TRAFFIC_LIGHTS) {
      const toLight = { x: light.x - vehicle.position.x, z: light.z - vehicle.position.z };
      const ahead = toLight.x * direction.x + toLight.z * direction.z;
      const aside = Math.abs(toLight.x * direction.z - toLight.z * direction.x);
      const approaching = ahead > 0 && ahead <= STOP_LINE && aside < LANE_TOLERANCE;
      if (approaching && !this.isGreen(light, axis, minuteOfDay)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Another car close ahead in the same lane, going the same way. A car that
   * is itself waiting on a car does not count, or two cars meeting at a
   * corner would each wait for the other for ever.
   */
  private heldByCarAhead(vehicle: Vehicle, direction: Point): boolean {
    for (const other of this.vehicles) {
      if (other === vehicle || other.state !== 'driving' || other.waiting === 'car') {
        continue;
      }
      const rel = {
        x: other.position.x - vehicle.position.x,
        z: other.position.z - vehicle.position.z,
      };
      const ahead = rel.x * direction.x + rel.z * direction.z;
      const aside = Math.abs(rel.x * direction.z - rel.z * direction.x);
      const sameWay = Math.cos(other.heading - vehicle.heading) > 0.5;
      if (sameWay && ahead > 0 && ahead < FOLLOWING_GAP && aside < LANE_TOLERANCE) {
        return true;
      }
    }
    return false;
  }

  /**
   * Where a vehicle is drawn and where its driver sits: the centreline path
   * shifted to the right-hand side of the road while driving.
   */
  static roadPosition(vehicle: Vehicle): Point {
    if (vehicle.state !== 'driving') {
      return vehicle.position;
    }
    const sin = Math.sin(vehicle.heading);
    const cos = Math.cos(vehicle.heading);
    // Heading is measured from +Z towards +X; the right hand side of a car
    // facing +Z is -X.
    return {
      x: vehicle.position.x - cos * LANE_OFFSET,
      z: vehicle.position.z + sin * LANE_OFFSET,
    };
  }
}

/**
 * The way a car faces once parked. At the kerb it straightens up along the
 * street; the last leg into a space runs across the road, and a car left at
 * that angle reads as stuck in the traffic. Anywhere else it keeps its heading.
 */
function parkedHeading(nodeId: string, heading: number): number {
  return kerbSpaceHeading(nodeId) ?? heading;
}

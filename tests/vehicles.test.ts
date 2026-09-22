import { describe, expect, it } from 'vitest';

import { distance, type Point } from '../src/entities/geometry.js';
import { GAME_MINUTES_PER_TICK, TICKS_PER_GAME_DAY } from '../src/simulation/constants.js';
import { buildRoadGraph, parkingNodesForPlace } from '../src/simulation/Navigation.js';
import { VehicleSystem } from '../src/simulation/VehicleSystem.js';
import { World } from '../src/simulation/World.js';
import { FLEET } from '../src/world/Fleet.js';
import { BUILDINGS } from '../src/world/Town.js';

const DAYS_TO_RUN = 30;

/** Two cars closer than this are drawn on top of each other. */
const OVERLAP_DISTANCE = 3;

describe('the fleet', () => {
  const world = new World({ seed: 'fleet' });

  it('has eight vehicles, each with an owner or a workplace', () => {
    expect(world.vehicles).toHaveLength(8);
    for (const vehicle of world.vehicles) {
      expect(Boolean(vehicle.ownerId) !== Boolean(vehicle.workplaceId), vehicle.id).toBe(true);
    }
  });

  it('parks every vehicle at a node of the road graph overnight', () => {
    const roads = buildRoadGraph();
    for (const vehicle of world.vehicles) {
      expect(() => roads.node(vehicle.homeNodeId)).not.toThrow();
    }
  });

  it('gives private cars to one household each', () => {
    const homes = FLEET.filter((entry) => entry.ownerId).map((entry) =>
      world.citizenSystem.homeOf(entry.ownerId as string),
    );
    expect(new Set(homes).size).toBe(homes.length);
  });

  it('can park at every building and reach it by road', () => {
    const roads = buildRoadGraph();
    const start = roads.nearestNode({ x: 0, z: 0 });
    for (const building of BUILDINGS) {
      const spaces = parkingNodesForPlace({ kind: 'building', id: building.id });
      expect(spaces.length, building.id).toBeGreaterThan(0);
      for (const nodeId of spaces) {
        expect(roads.canReach(start.id, nodeId), `${building.id} ${nodeId}`).toBe(true);
      }
    }
  });
});

describe('vehicles over 30 game days', () => {
  const world = new World({ seed: 'phase-4-vehicles' });

  let maxOverlapMinutes = 0;
  let maxHeldMinutes = 0;
  let trips = 0;
  let drivenDistance = 0;
  let maxSpeedPerMinute = 0;
  const movingByHour = new Map<number, number>();
  const overlapping = new Map<string, number>();
  const lastState = new Map<string, string>();
  const lastPosition = new Map<string, Point>();

  for (const vehicle of world.vehicles) {
    lastState.set(vehicle.id, vehicle.state);
    lastPosition.set(vehicle.id, { ...vehicle.position });
  }

  for (let tick = 0; tick < TICKS_PER_GAME_DAY * DAYS_TO_RUN; tick += 1) {
    world.tick();
    const vehicles = world.vehicles;

    for (const vehicle of vehicles) {
      if (lastState.get(vehicle.id) === 'parked' && vehicle.state === 'driving') {
        trips += 1;
      }
      lastState.set(vehicle.id, vehicle.state);
      maxHeldMinutes = Math.max(maxHeldMinutes, vehicle.heldForMinutes);

      const previous = lastPosition.get(vehicle.id) as Point;
      const moved = distance(previous, VehicleSystem.roadPosition(vehicle));
      if (vehicle.state === 'driving') {
        drivenDistance += moved;
        maxSpeedPerMinute = Math.max(maxSpeedPerMinute, moved / GAME_MINUTES_PER_TICK);
      }
      lastPosition.set(vehicle.id, { ...VehicleSystem.roadPosition(vehicle) });
    }

    // Overlap: two vehicles within a car length, counted while it lasts.
    for (let i = 0; i < vehicles.length; i += 1) {
      for (let j = i + 1; j < vehicles.length; j += 1) {
        const key = `${vehicles[i].id}|${vehicles[j].id}`;
        const apart = distance(
          VehicleSystem.roadPosition(vehicles[i]),
          VehicleSystem.roadPosition(vehicles[j]),
        );
        if (apart < OVERLAP_DISTANCE) {
          const minutes = (overlapping.get(key) ?? 0) + GAME_MINUTES_PER_TICK;
          overlapping.set(key, minutes);
          maxOverlapMinutes = Math.max(maxOverlapMinutes, minutes);
        } else {
          overlapping.set(key, 0);
        }
      }
    }

    if (tick % (TICKS_PER_GAME_DAY / 24) === 0 && world.time.day >= 2) {
      const hour = world.time.hour;
      movingByHour.set(hour, (movingByHour.get(hour) ?? 0) + world.vehicleSystem.movingCount);
    }
  }

  it('never leaves two vehicles on top of each other for more than 5 game minutes', () => {
    expect(maxOverlapMinutes).toBeLessThan(5);
  });

  it('never holds a vehicle for more than 30 game minutes', () => {
    expect(maxHeldMinutes).toBeLessThan(30);
  });

  it('makes trips every day and moves faster than a walker', () => {
    expect(trips).toBeGreaterThan(DAYS_TO_RUN * 8);
    expect(drivenDistance).toBeGreaterThan(1000);
    // Walkers do 3.6 to 4.6 metres a minute.
    expect(maxSpeedPerMinute).toBeGreaterThan(10);
  });

  it('shows traffic in the morning and evening rush', () => {
    const morning = (movingByHour.get(8) ?? 0) + (movingByHour.get(9) ?? 0);
    const evening = (movingByHour.get(17) ?? 0) + (movingByHour.get(18) ?? 0);
    expect(morning).toBeGreaterThan(0);
    expect(evening).toBeGreaterThan(0);
  });

  it('brings every car home to sleep', () => {
    // The run ends at 05:30; everybody drove home the evening before. A van
    // may take any space in the yard, a car any space outside its house.
    for (const vehicle of world.vehicles) {
      expect(vehicle.state, vehicle.id).toBe('parked');
      const home = vehicle.workplaceId
        ? { kind: 'building' as const, id: vehicle.workplaceId }
        : { kind: 'building' as const, id: world.citizenSystem.homeOf(vehicle.ownerId ?? '') };
      expect(parkingNodesForPlace(home), vehicle.id).toContain(vehicle.parkedAtNodeId);
    }
  });

  it('keeps drivers with their cars: nobody is aboard a parked car', () => {
    for (const citizen of world.citizens) {
      if (citizen.activity === 'Drive') {
        const vehicle = world.vehicleSystem.find(citizen.vehicleId ?? '');
        expect(vehicle?.state, citizen.id).toBe('driving');
      }
    }
  });
});

describe('following a driver', () => {
  it('hands the follow target from foot to car and back without a gap', () => {
    const world = new World({ seed: 'follow' });
    // Rex drives to the office in the morning.
    let sawFoot = false;
    let sawCar = false;
    let sawIndoors = false;
    let lastPosition: Point | undefined;
    let biggestJump = 0;

    while (!(world.time.day === 2 && world.time.minuteOfDay >= 10 * 60)) {
      world.tick();
      if (world.time.day !== 2 || world.time.minuteOfDay < 7 * 60) {
        continue;
      }
      const target = world.followTarget('rex');
      expect(target).toBeDefined();
      if (!target) {
        break;
      }
      if (target.mode === 'onFoot') sawFoot = true;
      if (target.mode === 'inVehicle') sawCar = true;
      if (target.mode === 'indoors') sawIndoors = true;
      if (lastPosition && target.mode !== 'indoors') {
        biggestJump = Math.max(biggestJump, distance(lastPosition, target.position));
      }
      lastPosition = target.position;
    }

    expect(sawFoot && sawCar && sawIndoors).toBe(true);
    // A tick moves a car under two metres; getting in or out of the car adds
    // the lane offset on top, so the worst hand-off is about four metres.
    expect(biggestJump).toBeLessThan(5);
  });
});

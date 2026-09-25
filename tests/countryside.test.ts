import { InstancedMesh, Matrix4, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';

import { closestPointOnSegment, distance } from '../src/entities/geometry.js';
import { footprintBounds } from '../src/entities/Building.js';
import { Neighbours, neighbourHouses } from '../src/render/Neighbours.js';
import { ROAD_CLEARING, Scenery } from '../src/render/Scenery.js';
import {
  BREAKWATERS,
  carPose,
  COASTER_VOYAGE,
  COUNTRY_CARS,
  COUNTRY_LANE_OFFSET,
  COUNTRY_ROAD_WIDTH,
  COUNTRY_ROADS,
  distanceToCountryRoads,
  islandHeight,
  LAUNCH_VOYAGE,
  NEIGHBOURS,
  poseAlong,
  smoothPath,
  TOWN_EXIT,
  TRAFFIC_ROUTE,
  type Voyage,
  voyagePose,
} from '../src/world/Countryside.js';
import { BEACH_DEPTH, coastZ } from '../src/world/Terrain.js';
import { BUILDINGS, TREES } from '../src/world/Town.js';

/**
 * SPEC.md 2.14, decision 44: the world beyond the town. All of it is render
 * side, so these tests check where things stand and move, not what the
 * simulation does; the determinism test proves the simulation never noticed.
 */

describe('paths', () => {
  it('pass through every control point, so the fork lies on both roads', () => {
    const control = [
      { x: 0, z: 0 },
      { x: 10, z: 5 },
      { x: 20, z: -3 },
    ];
    const path = smoothPath(control);
    for (const point of control) {
      expect(path.points.some((sample) => distance(sample, point) < 1e-9)).toBe(true);
    }
    const [coast, hill] = COUNTRY_ROADS;
    expect(distance(hill.points[0], coast.points[coast.points.length - 1])).toBeGreaterThan(50);
    expect(Math.min(...coast.points.map((point) => distance(point, hill.points[0])))).toBeLessThan(
      1e-9,
    );
  });

  it('are measured end to end', () => {
    const path = smoothPath([
      { x: 0, z: 0 },
      { x: 30, z: 0 },
    ]);
    expect(path.length).toBeCloseTo(30, 6);
    const middle = poseAlong(path, 15);
    expect(middle.x).toBeCloseTo(15, 6);
    // Heading east: from +Z towards +X.
    expect(middle.heading).toBeCloseTo(Math.PI / 2, 6);
  });
});

describe('the country road', () => {
  it('leaves the town at the east end of the north lane', () => {
    const start = COUNTRY_ROADS[0].points[0];
    expect(start.z).toBeCloseTo(TOWN_EXIT.z, 6);
    expect(start.x).toBeGreaterThan(TOWN_EXIT.x);
    expect(start.x - TOWN_EXIT.x).toBeLessThan(8);
  });

  it('stays on land, above the beach', () => {
    for (const road of COUNTRY_ROADS) {
      for (const point of road.points) {
        expect(point.z).toBeGreaterThan(coastZ(point.x) + BEACH_DEPTH - 2);
      }
    }
  });

  it('keeps clear of every building and tree in the town', () => {
    const half = COUNTRY_ROAD_WIDTH / 2;
    for (const building of BUILDINGS) {
      const bounds = footprintBounds(building);
      for (const road of COUNTRY_ROADS) {
        for (const point of road.points) {
          const inside =
            point.x > bounds.minX - half &&
            point.x < bounds.maxX + half &&
            point.z > bounds.minZ - half &&
            point.z < bounds.maxZ + half;
          expect(inside, `${building.id} on the road at ${point.x}, ${point.z}`).toBe(false);
        }
      }
    }
    for (const tree of TREES) {
      expect(distanceToCountryRoads(tree.position)).toBeGreaterThan(half + 1);
    }
  });

  it('has no forest tree standing on it', () => {
    const scenery = new Scenery();
    const trunks = scenery.root.children.find(
      (child): child is InstancedMesh => child instanceof InstancedMesh && child.name === 'forest',
    );
    expect(trunks).toBeDefined();
    const matrix = new Matrix4();
    const position = new Vector3();
    for (let index = 0; index < trunks!.count; index += 1) {
      trunks!.getMatrixAt(index, matrix);
      position.setFromMatrixPosition(matrix);
      expect(distanceToCountryRoads({ x: position.x, z: position.z })).toBeGreaterThanOrEqual(
        ROAD_CLEARING,
      );
    }
  });
});

describe('the through traffic', () => {
  it('drives on the right of the road and never into the town', () => {
    for (const car of COUNTRY_CARS) {
      let seen = 0;
      for (let time = 0; time < 400; time += 0.5) {
        const pose = carPose(car, time);
        if (pose.scale <= 0) {
          continue;
        }
        seen += 1;
        expect(distanceToCountryRoads(pose)).toBeLessThan(COUNTRY_LANE_OFFSET + 0.5);
        // The fork is the closest the traffic comes to the town.
        expect(pose.x).toBeGreaterThan(130);
      }
      expect(seen).toBeGreaterThan(100);
    }
  });

  it('drives both ways between the two villages', () => {
    const car = COUNTRY_CARS[0];
    const start = poseAlong(TRAFFIC_ROUTE, 0);
    const end = poseAlong(TRAFFIC_ROUTE, TRAFFIC_ROUTE.length);
    const near = (pose: { x: number; z: number }, place: { x: number; z: number }): boolean =>
      distance(pose, place) < 20;
    let atStart = 0;
    let atEnd = 0;
    for (let time = 0; time < 400; time += 0.5) {
      const pose = carPose(car, time);
      if (pose.scale > 0 && near(pose, start)) {
        atStart += 1;
      }
      if (pose.scale > 0 && near(pose, end)) {
        atEnd += 1;
      }
    }
    expect(atStart).toBeGreaterThan(0);
    expect(atEnd).toBeGreaterThan(0);
  });
});

describe('the boats that come and go', () => {
  const clearOfBreakwaters = (point: { x: number; z: number }): number =>
    Math.min(
      ...BREAKWATERS.map((arm) => distance(point, closestPointOnSegment(point, arm.from, arm.to))),
    );

  const check = (voyage: Voyage): { shown: number; moored: number } => {
    const cycle = voyage.wait + voyage.away + (2 * voyage.path.length) / voyage.speed;
    let shown = 0;
    let moored = 0;
    for (let time = 0; time < cycle; time += 0.5) {
      const pose = voyagePose(voyage, time);
      if (pose.scale <= 0) {
        continue;
      }
      shown += 1;
      if (!pose.moving) {
        moored += 1;
      }
      // On the water: seaward of the shore, off the island, clear of the stone.
      expect(pose.z).toBeLessThan(coastZ(pose.x) - 3);
      expect(islandHeight(pose.x, pose.z)).toBeLessThan(0);
      expect(clearOfBreakwaters(pose)).toBeGreaterThan(3);
    }
    return { shown, moored };
  };

  it('keep to the water all the way', () => {
    expect(check(COASTER_VOYAGE).shown).toBeGreaterThan(0);
    expect(check(LAUNCH_VOYAGE).shown).toBeGreaterThan(0);
  });

  it('tie up at their quays, and the coaster vanishes over the horizon', () => {
    const coaster = check(COASTER_VOYAGE);
    const launch = check(LAUNCH_VOYAGE);
    expect(coaster.moored).toBeGreaterThan(0);
    // The launch waits at both ends; the coaster only at home.
    expect(launch.moored).toBeGreaterThan(coaster.moored);
    const out = COASTER_VOYAGE.wait + COASTER_VOYAGE.path.length / COASTER_VOYAGE.speed;
    const gone = voyagePose(COASTER_VOYAGE, out + COASTER_VOYAGE.away / 2 - COASTER_VOYAGE.offset);
    expect(gone.scale).toBe(0);
  });
});

describe('the neighbouring villages', () => {
  const houses = neighbourHouses();

  it('each have a bell tower and most of their houses', () => {
    for (const village of NEIGHBOURS) {
      const own = houses.filter((house) => house.village === village.id);
      expect(own.filter((house) => house.tower)).toHaveLength(1);
      expect(own.length).toBeGreaterThanOrEqual(village.houses * 0.8);
    }
  });

  it('stand on land, off the beach and off the road, within the village', () => {
    for (const house of houses) {
      const village = NEIGHBOURS.find((candidate) => candidate.id === house.village)!;
      expect(distance(house, village.centre)).toBeLessThanOrEqual(village.radius + 6);
      if (village.kind === 'island') {
        expect(islandHeight(house.x, house.z)).toBeGreaterThan(2);
      } else {
        expect(house.z).toBeGreaterThan(coastZ(house.x) + BEACH_DEPTH);
        expect(distanceToCountryRoads(house)).toBeGreaterThan(COUNTRY_ROAD_WIDTH / 2);
      }
    }
  });

  it('are the same on every visit', () => {
    expect(neighbourHouses()).toEqual(houses);
  });

  it('light up in the evening, mostly go dark late, and all light on Mid-Autumn night', () => {
    const neighbours = new Neighbours();
    const total = neighbours.windowCount;
    const evening = neighbours.litWindows(21 * 60, false);
    const small = neighbours.litWindows(3 * 60, false);
    expect(evening).toBeGreaterThan(total * 0.7);
    expect(small).toBeGreaterThan(0);
    expect(small).toBeLessThan(total * 0.3);
    expect(neighbours.litWindows(3 * 60, true)).toBe(total);
  });
});

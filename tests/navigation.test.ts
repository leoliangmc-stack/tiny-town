import { describe, expect, it } from 'vitest';

import { containsPoint, doorPosition, footprintBounds } from '../src/entities/Building.js';
import { distance } from '../src/entities/geometry.js';
import {
  buildRoadGraph,
  buildSidewalkGraph,
  entranceNodeId,
  parkingNodeId,
} from '../src/simulation/Navigation.js';
import {
  BUILDINGS,
  OUTDOOR_ZONES,
  PARKING_LOT,
  SIDEWALK_EDGE,
  STREETS,
  getBuilding,
  junctions,
  townBounds,
} from '../src/world/Town.js';

describe('the sidewalk graph', () => {
  const graph = buildSidewalkGraph();

  it('has a node for every building door', () => {
    for (const building of BUILDINGS) {
      expect(() => graph.node(entranceNodeId(building.id))).not.toThrow();
    }
  });

  it('can walk between any two entrances', () => {
    const entrances = BUILDINGS.map((building) => entranceNodeId(building.id));

    for (const from of entrances) {
      for (const to of entrances) {
        expect(graph.canReach(from, to), `${from} -> ${to}`).toBe(true);
      }
    }
  });

  it('joins each door to the pavement without crossing the building', () => {
    for (const building of BUILDINGS) {
      const door = graph.node(entranceNodeId(building.id));
      const [neighbour] = graph.neighbours(door.id);
      expect(neighbour, `${building.id} has no pavement link`).toBeDefined();

      const pavement = graph.node(neighbour);
      expect(distance(door.position, pavement.position)).toBeLessThan(14);
      expect(containsPoint(building, pavement.position)).toBe(false);
    }
  });

  it('crosses the road at every junction', () => {
    // Each junction contributes four corners joined in a square, which is both
    // the way round the corner and the two crossings.
    for (const junction of junctions()) {
      const corner = graph.nearestNode({ x: junction.x - 4.8, z: junction.z - 4.8 });
      const opposite = graph.nearestNode({ x: junction.x + 4.8, z: junction.z + 4.8 });
      const path = graph.findPath(corner.id, opposite.id);
      expect(path.length, `junction ${junction.x},${junction.z}`).toBeGreaterThan(0);
      expect(path.length).toBeLessThanOrEqual(4);
    }
  });
});

describe('the road graph', () => {
  const graph = buildRoadGraph();

  it('can drive to every parking space', () => {
    const start = graph.nearestNode({ x: 0, z: 0 });

    for (let index = 0; index < PARKING_LOT.spaces.length; index += 1) {
      expect(graph.canReach(start.id, parkingNodeId(index)), `space ${index}`).toBe(true);
    }
  });

  it('can drive between the far ends of the town', () => {
    const west = graph.nearestNode({ x: -78, z: 0 });
    const east = graph.nearestNode({ x: 78, z: 0 });
    const north = graph.nearestNode({ x: 0, z: -40 });
    const south = graph.nearestNode({ x: 0, z: 40 });

    expect(graph.canReach(west.id, east.id)).toBe(true);
    expect(graph.canReach(north.id, south.id)).toBe(true);
    expect(graph.canReach(west.id, south.id)).toBe(true);
  });
});

describe('the layout', () => {
  it('has the buildings the spec asks for', () => {
    const kinds = BUILDINGS.map((building) => building.kind);

    expect(kinds.filter((kind) => kind === 'house')).toHaveLength(30);
    expect(kinds.filter((kind) => kind === 'apartment').length).toBeGreaterThanOrEqual(2);
    for (const kind of ['school', 'cafe', 'supermarket', 'bakery', 'office']) {
      expect(
        kinds.filter((candidate) => candidate === kind),
        kind,
      ).toHaveLength(1);
    }
  });

  it('never lets two buildings overlap', () => {
    for (let i = 0; i < BUILDINGS.length; i += 1) {
      for (let j = i + 1; j < BUILDINGS.length; j += 1) {
        const a = footprintBounds(BUILDINGS[i]);
        const b = footprintBounds(BUILDINGS[j]);
        const apart = a.maxX <= b.minX || b.maxX <= a.minX || a.maxZ <= b.minZ || b.maxZ <= a.minZ;
        expect(apart, `${BUILDINGS[i].id} overlaps ${BUILDINGS[j].id}`).toBe(true);
      }
    }
  });

  it('keeps every building clear of the roads', () => {
    for (const building of BUILDINGS) {
      const bounds = footprintBounds(building);
      for (const street of STREETS) {
        const overlapsAlong =
          street.axis === 'x'
            ? bounds.maxX > street.from && bounds.minX < street.to
            : bounds.maxZ > street.from && bounds.minZ < street.to;
        if (!overlapsAlong) {
          continue;
        }
        const low = street.axis === 'x' ? bounds.minZ : bounds.minX;
        const high = street.axis === 'x' ? bounds.maxZ : bounds.maxX;
        const clear = high <= street.at - SIDEWALK_EDGE || low >= street.at + SIDEWALK_EDGE;
        expect(clear, `${building.id} sits on ${street.id}`).toBe(true);
      }
    }
  });

  it('gives every public building an outdoor zone with spawn points', () => {
    const publicBuildings = BUILDINGS.filter(
      (building) => building.kind !== 'house' && building.kind !== 'apartment',
    );

    for (const building of publicBuildings) {
      const zone = OUTDOOR_ZONES.find((candidate) => candidate.buildingId === building.id);
      expect(zone, `${building.id} has no outdoor zone`).toBeDefined();
      expect((zone?.spawnPoints.length ?? 0) > 0).toBe(true);
    }
    // The park is a zone in its own right.
    expect(OUTDOOR_ZONES.some((zone) => zone.buildingId === 'park')).toBe(true);
  });

  it('puts every zone in front of its building, not inside it', () => {
    for (const zone of OUTDOOR_ZONES) {
      if (zone.buildingId === 'park') {
        continue;
      }
      const building = getBuilding(zone.buildingId);
      for (const spawn of zone.spawnPoints) {
        expect(containsPoint(building, spawn), `${zone.id} spawn inside ${building.id}`).toBe(
          false,
        );
      }
      // The door should be a short walk from the zone.
      const door = doorPosition(building);
      const nearest = Math.min(...zone.spawnPoints.map((spawn) => distance(door, spawn)));
      expect(nearest).toBeLessThan(14);
    }
  });

  it('is big enough to read as a town', () => {
    const bounds = townBounds();
    const width = bounds.maxX - bounds.minX;
    const depth = bounds.maxZ - bounds.minZ;

    expect(width).toBeGreaterThan(170);
    expect(depth).toBeGreaterThan(100);
  });

  it('gives every house its own look', () => {
    const houses = BUILDINGS.filter((building) => building.kind === 'house');
    const looks = new Set(
      houses.map((house) => {
        const style = house.style;
        expect(style, `${house.id} has no style`).toBeDefined();
        return [
          style?.roofKind,
          style?.roofColor,
          style?.wallColor,
          style?.porch,
          style?.balcony,
          style?.fence,
          style?.prop,
        ].join('|');
      }),
    );

    expect(looks.size).toBe(houses.length);
  });
});

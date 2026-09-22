import type { Building } from '../entities/Building.js';
import type { Point } from '../entities/geometry.js';

/**
 * The fixed town layout, as plain data.
 *
 * Phase 1 is the small version of the town: five houses and a cafe around one
 * road loop. The full map from SPEC.md 2.3 arrives in Phase 2. Nothing in this
 * file may import Three.js: the renderer reads this data, not the other way
 * around.
 *
 * Units are metres. The town is centred on the origin, X runs east, Z runs
 * south.
 */

/** Centreline of the road loop: a rectangle with these half extents. */
export const ROAD_HALF_X = 17;
export const ROAD_HALF_Z = 10.5;
export const ROAD_WIDTH = 5.4;

/** The pavement sits just outside the road, and citizens walk along its centre. */
export const SIDEWALK_WIDTH = 2.4;
export const SIDEWALK_HALF_X = ROAD_HALF_X + ROAD_WIDTH / 2 + SIDEWALK_WIDTH / 2;
export const SIDEWALK_HALF_Z = ROAD_HALF_Z + ROAD_WIDTH / 2 + SIDEWALK_WIDTH / 2;

/** Side length of the ground plane. */
/** The ground runs well past the town and fades into the fog at its edge. */
export const GROUND_SIZE = 600;

/** Corners of the pedestrian loop, clockwise, as a closed polygon. */
export const SIDEWALK_CORNERS: readonly Point[] = [
  { x: -SIDEWALK_HALF_X, z: -SIDEWALK_HALF_Z },
  { x: SIDEWALK_HALF_X, z: -SIDEWALK_HALF_Z },
  { x: SIDEWALK_HALF_X, z: SIDEWALK_HALF_Z },
  { x: -SIDEWALK_HALF_X, z: SIDEWALK_HALF_Z },
];

export const CAFE_ID = 'cafe';

/** The cafe keeps its lights on while it is open, whoever is inside. */
export const CAFE_OPENS_AT = 6 * 60;
export const CAFE_CLOSES_AT = 23 * 60 + 30;

/**
 * Standing spots on the cafe terrace.
 *
 * Citizens stay outside while they are at the cafe, so the street is never
 * empty in daylight (SPEC.md 2.6). The full outdoor zones for every public
 * building arrive in Phase 2.
 */
export const CAFE_TERRACE_SPOTS: readonly Point[] = [
  { x: -4.8, z: 6.2 },
  { x: -2.4, z: 7.1 },
  { x: 0.9, z: 6.1 },
  { x: 3.2, z: 7.2 },
  { x: 5.4, z: 6 },
];

export const BUILDINGS: readonly Building[] = [
  {
    id: 'cafe',
    kind: 'cafe',
    name: 'The Corner Cafe',
    position: { x: 0, z: -1 },
    width: 13,
    depth: 9,
    wallHeight: 4.6,
    roofHeight: 0.6,
    rotationY: 0,
    floors: 1,
  },
  {
    id: 'house-1',
    kind: 'house',
    name: 'Maple House',
    position: { x: -14, z: -22.5 },
    width: 10,
    depth: 8,
    wallHeight: 5.4,
    roofHeight: 3.2,
    rotationY: 0,
    floors: 2,
  },
  {
    id: 'house-2',
    kind: 'house',
    name: 'Willow House',
    position: { x: 9, z: -22.5 },
    width: 9,
    depth: 7.5,
    wallHeight: 4.8,
    roofHeight: 2.8,
    rotationY: 0,
    floors: 2,
  },
  {
    id: 'house-3',
    kind: 'house',
    name: 'Ash House',
    position: { x: 28.5, z: -3 },
    width: 9.5,
    depth: 8,
    wallHeight: 5.8,
    roofHeight: 3.4,
    rotationY: -Math.PI / 2,
    floors: 2,
  },
  {
    id: 'house-4',
    kind: 'house',
    name: 'Birch House',
    position: { x: -28.5, z: 4 },
    width: 10,
    depth: 7.5,
    wallHeight: 5,
    roofHeight: 3,
    rotationY: Math.PI / 2,
    floors: 2,
  },
  {
    id: 'house-5',
    kind: 'house',
    name: 'Linden House',
    position: { x: 1, z: 22.5 },
    width: 11,
    depth: 8,
    wallHeight: 5.6,
    roofHeight: 3.2,
    rotationY: Math.PI,
    floors: 2,
  },
];

export function getBuilding(id: string): Building {
  const building = BUILDINGS.find((candidate) => candidate.id === id);
  if (!building) {
    throw new Error(`Unknown building: ${id}`);
  }
  return building;
}

export interface Tree {
  position: Point;
  /** 'round' for a leafy tree, 'pine' for a conifer. */
  shape: 'round' | 'pine';
  height: number;
}

export const TREES: readonly Tree[] = [
  // Inside the loop, around the cafe.
  { position: { x: -12.5, z: -6.5 }, shape: 'round', height: 6.5 },
  { position: { x: 12.5, z: -6.5 }, shape: 'pine', height: 7.5 },
  { position: { x: -13.5, z: 4.5 }, shape: 'round', height: 5.8 },
  { position: { x: 13.5, z: 4.5 }, shape: 'round', height: 6.2 },
  { position: { x: -8, z: 6.5 }, shape: 'pine', height: 5.4 },
  { position: { x: 8.5, z: 6.5 }, shape: 'round', height: 5 },
  // Front gardens and the edges of the town.
  { position: { x: -21, z: -22 }, shape: 'pine', height: 8 },
  { position: { x: -6, z: -21 }, shape: 'round', height: 6 },
  { position: { x: 16.5, z: -21.5 }, shape: 'round', height: 6.8 },
  { position: { x: 26, z: -14 }, shape: 'pine', height: 7.2 },
  { position: { x: 25.5, z: 9 }, shape: 'round', height: 6.4 },
  { position: { x: -25.5, z: -9 }, shape: 'round', height: 6 },
  { position: { x: -24.5, z: 13 }, shape: 'pine', height: 7.6 },
  { position: { x: -9, z: 21 }, shape: 'round', height: 6.6 },
  { position: { x: 12, z: 21.5 }, shape: 'pine', height: 7 },
];

/** Street lamps, spread evenly along the pedestrian loop. */
export const STREET_LAMP_COUNT = 12;
export const STREET_LAMP_HEIGHT = 5.2;

/**
 * Samples the pedestrian loop into a closed polyline.
 *
 * Routes are built from these points, so the sampling step also decides how
 * finely a citizen follows the corners.
 */
export function sampleSidewalkLoop(step = 1.5): Point[] {
  const points: Point[] = [];
  for (let corner = 0; corner < SIDEWALK_CORNERS.length; corner += 1) {
    const from = SIDEWALK_CORNERS[corner];
    const to = SIDEWALK_CORNERS[(corner + 1) % SIDEWALK_CORNERS.length];
    const edgeLength = Math.hypot(to.x - from.x, to.z - from.z);
    const steps = Math.max(1, Math.round(edgeLength / step));
    for (let i = 0; i < steps; i += 1) {
      const t = i / steps;
      points.push({ x: from.x + (to.x - from.x) * t, z: from.z + (to.z - from.z) * t });
    }
  }
  return points;
}

/** Positions of the street lamps along the pedestrian loop. */
export function streetLampPositions(): Point[] {
  const loop = sampleSidewalkLoop(0.5);
  const positions: Point[] = [];
  for (let i = 0; i < STREET_LAMP_COUNT; i += 1) {
    positions.push(loop[Math.round((i * loop.length) / STREET_LAMP_COUNT) % loop.length]);
  }
  return positions;
}

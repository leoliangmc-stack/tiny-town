import type { Building } from '../entities/Building.js';
import { footprintBounds } from '../entities/Building.js';
import type { Point } from '../entities/geometry.js';

/**
 * The fixed town layout, as plain data (SPEC.md 2.3).
 *
 * The town is a high street running east to west with two residential lanes
 * either side of it, tied together by four cross streets. Everything public
 * fronts the high street, so the middle of the town reads as a centre: school
 * and park at the west end, cafe and bakery facing each other in the middle,
 * supermarket and office at the east end.
 *
 * Nothing in this file may import Three.js: the renderer reads this data, not
 * the other way around.
 *
 * Units are metres. X runs east, Z runs south.
 */

export const ROAD_WIDTH = 7;
export const SIDEWALK_WIDTH = 2.6;

/** Distance from a street's centreline to the middle of its pavement. */
export const SIDEWALK_OFFSET = ROAD_WIDTH / 2 + SIDEWALK_WIDTH / 2;

/** Distance from a street's centreline to the outer edge of its pavement. */
export const SIDEWALK_EDGE = ROAD_WIDTH / 2 + SIDEWALK_WIDTH;

/** The ground runs well past the town and fades into the fog at its edge. */
export const GROUND_SIZE = 700;

/**
 * A street, always axis aligned.
 *
 * `axis: 'x'` runs east to west at a constant z; `axis: 'z'` runs north to
 * south at a constant x. Keeping every street on an axis is what makes the
 * navigation graphs, the pavements and the crossings simple to build.
 */
export interface Street {
  id: string;
  axis: 'x' | 'z';
  /** The constant coordinate: z for an 'x' street, x for a 'z' street. */
  at: number;
  /** The span along the street's own axis. */
  from: number;
  to: number;
}

export const STREETS: readonly Street[] = [
  { id: 'high-street', axis: 'x', at: 0, from: -78, to: 78 },
  { id: 'north-lane', axis: 'x', at: -40, from: -74, to: 74 },
  { id: 'south-lane', axis: 'x', at: 40, from: -74, to: 74 },
  { id: 'west-cross', axis: 'z', at: -54, from: -40, to: 40 },
  { id: 'mill-cross', axis: 'z', at: -18, from: -40, to: 40 },
  { id: 'market-cross', axis: 'z', at: 18, from: -40, to: 40 },
  { id: 'east-cross', axis: 'z', at: 54, from: -40, to: 40 },
];

export const CAFE_ID = 'cafe';

/** The cafe keeps its lights on while it is open, whoever is inside. */
export const CAFE_OPENS_AT = 6 * 60;
export const CAFE_CLOSES_AT = 23 * 60 + 30;

/**
 * Every building in the town.
 *
 * The public buildings sit on the high street with room in front of them for
 * an outdoor zone. The houses sit in rows along the lanes and the high street,
 * two to a block face.
 */
export const BUILDINGS: readonly Building[] = [
  // --- The high street, north side, west to east ---
  {
    id: 'school',
    kind: 'school',
    name: 'Tiny Town School',
    position: { x: -36, z: -17 },
    width: 20,
    depth: 11,
    wallHeight: 7.5,
    roofHeight: 1,
    rotationY: 0,
    floors: 2,
  },
  {
    id: 'cafe',
    kind: 'cafe',
    name: 'The Corner Cafe',
    position: { x: 0, z: -16 },
    width: 14,
    depth: 9,
    wallHeight: 4.8,
    roofHeight: 0.7,
    rotationY: 0,
    floors: 1,
  },
  {
    id: 'supermarket',
    kind: 'supermarket',
    name: 'Green Grocer',
    position: { x: 36, z: -17.5 },
    width: 20,
    depth: 12,
    wallHeight: 6,
    roofHeight: 0.8,
    rotationY: 0,
    floors: 1,
  },

  // --- The high street, south side ---
  {
    id: 'bakery',
    kind: 'bakery',
    name: 'Willow Bakery',
    position: { x: 0, z: 16 },
    width: 12,
    depth: 8,
    wallHeight: 5,
    roofHeight: 2.8,
    rotationY: Math.PI,
    floors: 1,
  },
  {
    id: 'office',
    kind: 'office',
    name: 'Tiny Town Works',
    position: { x: 36, z: 17 },
    width: 18,
    depth: 11,
    wallHeight: 10.5,
    roofHeight: 0.9,
    rotationY: Math.PI,
    floors: 3,
  },

  // --- Houses: north of the north lane, facing the lane ---
  house('house-01', 'Maple House', -41, -52, 0),
  house('house-02', 'Alder House', -30, -52, 0),
  house('house-03', 'Rowan House', -6, -52, 0),
  house('house-04', 'Hazel House', 6, -52, 0),
  house('house-05', 'Elder House', 30, -52, 0),
  house('house-06', 'Juniper House', 41, -52, 0),

  // --- Houses: south of the north lane, backing onto the high street ---
  house('house-07', 'Holly House', -41, -28, Math.PI),
  house('house-08', 'Bramble House', -6, -28, Math.PI),
  house('house-09', 'Clover House', 6, -28, Math.PI),
  house('house-10', 'Fern House', 41, -28, Math.PI),

  // --- Houses: north of the south lane ---
  house('house-11', 'Larch House', -6, 28, 0),
  house('house-12', 'Poplar House', 6, 28, 0),
  house('house-13', 'Cedar House', 30, 28, 0),
  house('house-14', 'Sorrel House', 41, 28, 0),

  // --- Houses: south of the south lane, facing the lane ---
  house('house-15', 'Birch House', -41, 52, Math.PI),
  house('house-16', 'Linden House', -30, 52, Math.PI),
  house('house-17', 'Aspen House', -6, 52, Math.PI),
  house('house-18', 'Willow House', 6, 52, Math.PI),
  house('house-19', 'Ash House', 30, 52, Math.PI),
  house('house-20', 'Beech House', 41, 52, Math.PI),
];

/**
 * A house. They vary a little in size so a row never looks stamped out, but
 * the variation is deterministic: it comes from the house number.
 */
function house(id: string, name: string, x: number, z: number, rotationY: number): Building {
  const number = Number(id.slice(-2));
  const wobble = (offset: number, amount: number): number =>
    ((number * 37 + offset) % 7) * (amount / 7);

  return {
    id,
    kind: 'house',
    name,
    position: { x, z },
    width: 8.5 + wobble(0, 1.6),
    depth: 7 + wobble(3, 1.2),
    wallHeight: 5 + wobble(5, 1.4),
    roofHeight: 2.6 + wobble(1, 1.2),
    rotationY,
    floors: 2,
  };
}

export function getBuilding(id: string): Building {
  const building = BUILDINGS.find((candidate) => candidate.id === id);
  if (!building) {
    throw new Error(`Unknown building: ${id}`);
  }
  return building;
}

export const HOUSES = BUILDINGS.filter((building) => building.kind === 'house');

/**
 * A patch of ground outside a public building where citizens spend time, so
 * the street is never empty in daylight (SPEC.md 2.3 and 2.6).
 *
 * Phase 2 lays the zones out and draws them. Phase 3 sends citizens to them.
 */
export interface OutdoorZone {
  id: string;
  buildingId: string;
  kind: 'terrace' | 'playground' | 'forecourt' | 'lawn';
  /** Axis aligned extent of the zone. */
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  /** Where a citizen may stand inside the zone. */
  spawnPoints: readonly Point[];
}

export const OUTDOOR_ZONES: readonly OutdoorZone[] = [
  zone('cafe-terrace', 'cafe', 'terrace', -7, 7, -11.5, -6.6, 5),
  zone('school-playground', 'school', 'playground', -46, -26, -11.5, -6.6, 6),
  zone('supermarket-forecourt', 'supermarket', 'forecourt', 26, 46, -11.5, -6.6, 5),
  zone('bakery-front', 'bakery', 'terrace', -6, 6, 6.6, 11.5, 3),
  zone('office-front', 'office', 'forecourt', 27, 45, 6.6, 11.5, 4),
  zone('park-lawn', 'park', 'lawn', -47.5, -24.5, 7, 30, 8),
];

/** Builds a zone with its spawn points spread evenly across it. */
function zone(
  id: string,
  buildingId: string,
  kind: OutdoorZone['kind'],
  minX: number,
  maxX: number,
  minZ: number,
  maxZ: number,
  spawnCount: number,
): OutdoorZone {
  const spawnPoints: Point[] = [];
  const columns = Math.ceil(Math.sqrt(spawnCount * ((maxX - minX) / (maxZ - minZ))));
  const rows = Math.ceil(spawnCount / columns);

  for (let index = 0; index < spawnCount; index += 1) {
    const column = index % columns;
    const row = Math.floor(index / columns);
    spawnPoints.push({
      x: minX + ((column + 0.5) / columns) * (maxX - minX),
      z: minZ + ((row + 0.5) / rows) * (maxZ - minZ),
    });
  }

  return { id, buildingId, kind, minX, maxX, minZ, maxZ, spawnPoints };
}

export function getZone(id: string): OutdoorZone {
  const found = OUTDOOR_ZONES.find((candidate) => candidate.id === id);
  if (!found) {
    throw new Error(`Unknown outdoor zone: ${id}`);
  }
  return found;
}

/** The park: a lawn with paths and trees, in the block west of the centre. */
export const PARK = getZone('park-lawn');

/** The car park at the east end, off the east cross street. */
export const PARKING_LOT = {
  id: 'parking-lot',
  minX: 60,
  maxX: 74,
  minZ: -26,
  maxZ: -8,
  /** Where cars stand. Phase 4 drives them here. */
  spaces: Array.from({ length: 8 }, (_, index) => ({
    x: index < 4 ? 64 : 70,
    z: -23 + (index % 4) * 4.6,
  })),
  /** Where the lot meets the road network. */
  entrance: { x: 60, z: -14 },
} as const;

export interface Tree {
  position: Point;
  shape: 'round' | 'pine';
  height: number;
}

/**
 * Trees. The park is planted densely, the streets get a row of them, and the
 * gaps between houses get one or two so no block face is bare.
 */
export const TREES: readonly Tree[] = [
  ...parkTrees(),
  ...streetTrees(),
  // Around the school playground.
  { position: { x: -49, z: -9 }, shape: 'round', height: 7.5 },
  { position: { x: -23, z: -9 }, shape: 'round', height: 7 },
  { position: { x: -49, z: -21 }, shape: 'pine', height: 9 },
  { position: { x: -23, z: -22 }, shape: 'pine', height: 8.5 },
  // Gaps in the house rows.
  { position: { x: -35.5, z: -28 }, shape: 'round', height: 6.5 },
  { position: { x: -24, z: -30 }, shape: 'pine', height: 8 },
  { position: { x: 0, z: -30 }, shape: 'round', height: 6 },
  { position: { x: 24, z: -30 }, shape: 'round', height: 6.8 },
  { position: { x: 35.5, z: -28 }, shape: 'pine', height: 8.5 },
  { position: { x: 0, z: -46 }, shape: 'round', height: 6.4 },
  { position: { x: -35.5, z: -46 }, shape: 'pine', height: 8 },
  { position: { x: 35.5, z: -46 }, shape: 'round', height: 7 },
  { position: { x: -24, z: -48 }, shape: 'round', height: 6.2 },
  { position: { x: 24, z: -48 }, shape: 'pine', height: 7.8 },
  { position: { x: 0, z: 30 }, shape: 'round', height: 6.6 },
  { position: { x: 24, z: 30 }, shape: 'pine', height: 8.2 },
  { position: { x: 35.5, z: 30 }, shape: 'round', height: 6.4 },
  { position: { x: -35.5, z: 48 }, shape: 'round', height: 7 },
  { position: { x: -24, z: 50 }, shape: 'pine', height: 8.4 },
  { position: { x: 0, z: 48 }, shape: 'round', height: 6.2 },
  { position: { x: 24, z: 50 }, shape: 'round', height: 7.2 },
  { position: { x: 35.5, z: 48 }, shape: 'pine', height: 8 },
  // The eastern end, around the car park.
  { position: { x: 66, z: -4 }, shape: 'round', height: 7 },
  { position: { x: 76, z: -20 }, shape: 'pine', height: 9 },
  { position: { x: 66, z: 12 }, shape: 'round', height: 7.4 },
  { position: { x: 68, z: 34 }, shape: 'pine', height: 8.6 },
  // The western end.
  { position: { x: -66, z: -12 }, shape: 'pine', height: 9.5 },
  { position: { x: -68, z: 10 }, shape: 'round', height: 7.6 },
  { position: { x: -64, z: 30 }, shape: 'round', height: 7 },
  { position: { x: -66, z: -32 }, shape: 'round', height: 6.8 },
];

/** A loose grid of trees inside the park, skipping the middle for the lawn. */
function parkTrees(): Tree[] {
  const trees: Tree[] = [];
  const positions: Array<[number, number, 'round' | 'pine']> = [
    [-45, 10, 'round'],
    [-38, 9, 'pine'],
    [-29, 11, 'round'],
    [-46, 18, 'pine'],
    [-27, 18, 'round'],
    [-45, 27, 'round'],
    [-37, 28, 'pine'],
    [-28, 26, 'round'],
    [-33, 19, 'round'],
  ];
  for (const [x, z, shape] of positions) {
    trees.push({
      position: { x, z },
      shape,
      height: shape === 'pine' ? 9.5 : 7.8,
    });
  }
  return trees;
}

/** A line of trees down the middle stretch of the high street verges. */
function streetTrees(): Tree[] {
  const trees: Tree[] = [];
  for (const x of [-48, -24, 24, 48]) {
    trees.push({ position: { x, z: -8.5 }, shape: 'round', height: 6.5 });
    trees.push({ position: { x, z: 8.5 }, shape: 'round', height: 6.5 });
  }
  return trees;
}

export const STREET_LAMP_HEIGHT = 5.4;

/** Street lamps, spaced along the pavement of every street. */
export function streetLampPositions(spacing = 26): Point[] {
  const positions: Point[] = [];

  for (const street of STREETS) {
    const length = street.to - street.from;
    const count = Math.max(2, Math.round(length / spacing));
    for (let index = 0; index <= count; index += 1) {
      const along = street.from + (index / count) * length;
      // Alternate sides so the lamps stagger down the street.
      const side = index % 2 === 0 ? -1 : 1;
      positions.push(
        street.axis === 'x'
          ? { x: along, z: street.at + side * SIDEWALK_OFFSET }
          : { x: street.at + side * SIDEWALK_OFFSET, z: along },
      );
    }
  }

  return positions;
}

/** Street name signs, on the corners of the busiest junctions. */
export interface StreetSign {
  position: Point;
  rotationY: number;
  label: string;
}

export const STREET_SIGNS: readonly StreetSign[] = [
  { position: { x: -18 - SIDEWALK_OFFSET, z: -SIDEWALK_OFFSET }, rotationY: 0, label: 'High St' },
  {
    position: { x: 18 + SIDEWALK_OFFSET, z: SIDEWALK_OFFSET },
    rotationY: Math.PI,
    label: 'High St',
  },
  {
    position: { x: -54 + SIDEWALK_OFFSET, z: -40 - SIDEWALK_OFFSET },
    rotationY: 0,
    label: 'North Ln',
  },
  {
    position: { x: 54 - SIDEWALK_OFFSET, z: 40 + SIDEWALK_OFFSET },
    rotationY: Math.PI,
    label: 'South Ln',
  },
];

/** Where two streets cross. The pavements meet, and so do the roads. */
export interface Junction {
  x: number;
  z: number;
}

export function junctions(): Junction[] {
  const crossings: Junction[] = [];
  for (const alongX of STREETS.filter((street) => street.axis === 'x')) {
    for (const alongZ of STREETS.filter((street) => street.axis === 'z')) {
      const meets =
        alongX.from <= alongZ.at &&
        alongZ.at <= alongX.to &&
        alongZ.from <= alongX.at &&
        alongX.at <= alongZ.to;
      if (meets) {
        crossings.push({ x: alongZ.at, z: alongX.at });
      }
    }
  }
  return crossings;
}

/** The extent of everything built, which is what the camera frames. */
export function townBounds(): { minX: number; maxX: number; minZ: number; maxZ: number } {
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;

  const include = (x: number, z: number): void => {
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minZ = Math.min(minZ, z);
    maxZ = Math.max(maxZ, z);
  };

  for (const building of BUILDINGS) {
    const bounds = footprintBounds(building);
    include(bounds.minX, bounds.minZ);
    include(bounds.maxX, bounds.maxZ);
  }
  for (const street of STREETS) {
    if (street.axis === 'x') {
      include(street.from, street.at - SIDEWALK_EDGE);
      include(street.to, street.at + SIDEWALK_EDGE);
    } else {
      include(street.at - SIDEWALK_EDGE, street.from);
      include(street.at + SIDEWALK_EDGE, street.to);
    }
  }
  for (const tree of TREES) {
    include(tree.position.x, tree.position.z);
  }
  include(PARKING_LOT.minX, PARKING_LOT.minZ);
  include(PARKING_LOT.maxX, PARKING_LOT.maxZ);

  return { minX, maxX, minZ, maxZ };
}

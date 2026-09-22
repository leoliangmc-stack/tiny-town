import type { Building, HouseStyle, RoofKind, YardProp } from '../entities/Building.js';
import { footprintBounds } from '../entities/Building.js';
import type { Point } from '../entities/geometry.js';

/**
 * The fixed town layout, as plain data (SPEC.md 2.3, DESIGN.md).
 *
 * A high street runs east to west with a residential lane either side of it,
 * tied together by six cross streets into a closed grid of ten blocks.
 * Everything public fronts the high street, so the middle reads as a centre:
 * school and park at the west end, cafe and bakery facing each other in the
 * middle, supermarket, car park and office at the east end. Houses sit two to
 * a block face along the lanes, with small apartment blocks on three corners.
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
export const GROUND_SIZE = 800;

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

/** Where the lanes sit either side of the high street. */
const LANE_Z = 40;
/** Where the cross streets sit. The outer pair closes the grid. */
const CROSS_X = [-86, -54, -18, 18, 54, 86] as const;

export const STREETS: readonly Street[] = [
  { id: 'high-street', axis: 'x', at: 0, from: -86, to: 86 },
  { id: 'north-lane', axis: 'x', at: -LANE_Z, from: -86, to: 86 },
  { id: 'south-lane', axis: 'x', at: LANE_Z, from: -86, to: 86 },
  { id: 'far-west-cross', axis: 'z', at: CROSS_X[0], from: -LANE_Z, to: LANE_Z },
  { id: 'west-cross', axis: 'z', at: CROSS_X[1], from: -LANE_Z, to: LANE_Z },
  { id: 'mill-cross', axis: 'z', at: CROSS_X[2], from: -LANE_Z, to: LANE_Z },
  { id: 'market-cross', axis: 'z', at: CROSS_X[3], from: -LANE_Z, to: LANE_Z },
  { id: 'east-cross', axis: 'z', at: CROSS_X[4], from: -LANE_Z, to: LANE_Z },
  { id: 'far-east-cross', axis: 'z', at: CROSS_X[5], from: -LANE_Z, to: LANE_Z },
];

export const CAFE_ID = 'cafe';

/** The cafe keeps its lights on while it is open, whoever is inside. */
export const CAFE_OPENS_AT = 6 * 60;
export const CAFE_CLOSES_AT = 23 * 60 + 30;

/**
 * The rows the houses stand in, as the z of a house centre and the way it
 * faces. Each lane has a row on either side of it.
 */
const ROW_NORTH_OUTER = { z: -52, rotationY: 0 };
const ROW_NORTH_INNER = { z: -28, rotationY: Math.PI };
const ROW_SOUTH_INNER = { z: 28, rotationY: 0 };
const ROW_SOUTH_OUTER = { z: 52, rotationY: Math.PI };

/** House centres along a row: two per block, either side of the block centre. */
const HOUSE_X = {
  farWest: [-74.6, -65.2],
  west: [-41.5, -30.5],
  middle: [-5.5, 5.5],
  east: [30.5, 41.5],
  farEast: [65.2, 74.6],
} as const;

/** The end blocks are a little tighter, so the houses in them are a little slimmer. */
function isEndBlock(x: number): boolean {
  return Math.abs(x) > 60;
}

const HOUSE_NAMES = [
  'Maple',
  'Alder',
  'Rowan',
  'Hazel',
  'Elder',
  'Juniper',
  'Holly',
  'Bramble',
  'Clover',
  'Fern',
  'Larch',
  'Poplar',
  'Cedar',
  'Sorrel',
  'Birch',
  'Linden',
  'Aspen',
  'Willow',
  'Ash',
  'Beech',
  'Chestnut',
  'Hawthorn',
  'Ivy',
  'Laurel',
  'Myrtle',
  'Olive',
  'Pine',
  'Quince',
  'Sycamore',
  'Yew',
];

/** A row of houses, numbered on from `firstNumber`. */
function row(
  firstNumber: number,
  placement: { z: number; rotationY: number },
  xs: readonly number[],
): Building[] {
  return xs.map((x, index) => house(firstNumber + index, x, placement.z, placement.rotationY));
}

/**
 * Wall and roof colours, all warm and low in saturation (DESIGN.md §10).
 * Houses draw from these by number, so the mix down a street is fixed.
 */
const WALL_COLORS = [0xf1ebdf, 0xeadfc6, 0xd8d5cf, 0xc5d3dc, 0xcfd8c2, 0xb9a58c, 0xecd9c4];
const ROOF_COLORS = [0xb8695a, 0x5f5e5c, 0x6e7f8c, 0x8a6a52, 0x7f9478, 0xa65f4f];
const YARD_PROPS: readonly YardProp[] = ['mailbox', 'flower-pots', 'bicycle', 'bin', 'mailbox'];

/**
 * Every building in the town.
 *
 * The public buildings sit on the high street with room in front of them for
 * an outdoor zone. The houses are listed row by row, west to east.
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

  // --- Apartment blocks on three corners of the town ---
  apartment('apartment-01', 'Elm Court', 70, ROW_NORTH_OUTER.z, ROW_NORTH_OUTER.rotationY),
  apartment('apartment-02', 'Orchard Court', -70, ROW_SOUTH_OUTER.z, ROW_SOUTH_OUTER.rotationY),
  apartment('apartment-03', 'Station Court', 70, 14, Math.PI),

  // --- Houses north of the north lane, facing the lane ---
  ...row(1, ROW_NORTH_OUTER, [
    ...HOUSE_X.farWest,
    ...HOUSE_X.west,
    ...HOUSE_X.middle,
    ...HOUSE_X.east,
  ]),
  // --- Houses south of the north lane, backing onto the high street ---
  ...row(9, ROW_NORTH_INNER, [
    ...HOUSE_X.farWest,
    HOUSE_X.west[0],
    ...HOUSE_X.middle,
    HOUSE_X.east[1],
    HOUSE_X.farEast[1],
  ]),
  // --- Houses north of the south lane (the park takes the west block) ---
  ...row(16, ROW_SOUTH_INNER, [
    ...HOUSE_X.farWest,
    ...HOUSE_X.middle,
    ...HOUSE_X.east,
    HOUSE_X.farEast[1],
  ]),
  // --- Houses south of the south lane, facing the lane ---
  ...row(23, ROW_SOUTH_OUTER, [
    ...HOUSE_X.west,
    ...HOUSE_X.middle,
    ...HOUSE_X.east,
    ...HOUSE_X.farEast,
  ]),
];

/**
 * How house number `n` looks. Every rule here is a simple function of the
 * number, so a house is the same every time and no two are alike.
 */
function houseStyle(n: number): HouseStyle {
  let roofKind: RoofKind = 'gable';
  if (n % 5 === 0) {
    roofKind = 'flat';
  } else if (n % 3 === 0) {
    roofKind = 'hip';
  }

  return {
    roofKind,
    roofColor: ROOF_COLORS[(n * 7) % ROOF_COLORS.length],
    wallColor: WALL_COLORS[(n * 3) % WALL_COLORS.length],
    trimColor: n % 2 === 0 ? 0xf5f0e6 : 0x6b5a48,
    porch: roofKind === 'gable' && n % 2 === 1,
    balcony: roofKind === 'hip' || (roofKind === 'flat' && n % 2 === 0),
    fence: n % 4 === 1 || n % 4 === 2,
    flowerBed: n % 3 !== 0,
    prop: YARD_PROPS[n % YARD_PROPS.length],
  };
}

/**
 * A house. Size varies a little by number so a row never looks stamped out;
 * the look comes from houseStyle.
 */
function house(number: number, x: number, z: number, rotationY: number): Building {
  const wobble = (offset: number, amount: number): number =>
    ((number * 37 + offset) % 7) * (amount / 7);
  const style = houseStyle(number);
  const modern = style.roofKind === 'flat';

  return {
    id: `house-${String(number).padStart(2, '0')}`,
    kind: 'house',
    name: `${HOUSE_NAMES[(number - 1) % HOUSE_NAMES.length]} House`,
    position: { x, z },
    width: isEndBlock(x) ? 8.2 + wobble(0, 0.6) : 8.4 + wobble(0, 1.2),
    depth: 6.8 + wobble(3, 1.2),
    wallHeight: (modern ? 5.6 : 4.9) + wobble(5, 1.2),
    roofHeight: modern ? 0.5 : 2.4 + wobble(1, 1.2),
    rotationY,
    floors: 2,
    style,
  };
}

/** A small three storey apartment block. */
function apartment(id: string, name: string, x: number, z: number, rotationY: number): Building {
  return {
    id,
    kind: 'apartment',
    name,
    position: { x, z },
    width: 14,
    depth: 9.5,
    wallHeight: 9.6,
    roofHeight: 0.7,
    rotationY,
    floors: 3,
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
  zone('cafe-terrace', 'cafe', 'terrace', -7, 7, -11.5, -6.6, 10),
  zone('school-playground', 'school', 'playground', -46, -26, -11.5, -6.6, 12),
  zone('supermarket-forecourt', 'supermarket', 'forecourt', 26, 46, -11.5, -6.6, 8),
  zone('bakery-front', 'bakery', 'terrace', -6, 6, 6.6, 11.5, 5),
  zone('office-front', 'office', 'forecourt', 27, 45, 6.6, 11.5, 10),
  zone('park-lawn', 'park', 'lawn', -47.5, -24.5, 7, 30, 16),
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
    const rowIndex = Math.floor(index / columns);
    spawnPoints.push({
      x: minX + ((column + 0.5) / columns) * (maxX - minX),
      z: minZ + ((rowIndex + 0.5) / rows) * (maxZ - minZ),
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
  minX: 58,
  maxX: 76,
  minZ: -22,
  maxZ: -8,
  /** Where cars stand, in two rows. Phase 4 drives them here. */
  spaces: Array.from({ length: 8 }, (_, index) => ({
    x: 61 + (index % 4) * 4.5,
    z: index < 4 ? -18.5 : -11.5,
  })),
  /** Where the lot meets the road network. */
  entrance: { x: 58, z: -15 },
} as const;

export interface Tree {
  position: Point;
  shape: 'round' | 'pine';
  height: number;
}

/**
 * Trees. The park is planted densely, the high street gets a row of them,
 * every empty house slot gets one, and the corners of the town get a few so
 * the grid does not end in bare grass.
 */
export const TREES: readonly Tree[] = [
  ...parkTrees(),
  ...streetTrees(),
  ...emptySlotTrees(),
  // Around the school playground.
  { position: { x: -49, z: -9 }, shape: 'round', height: 8 },
  { position: { x: -23, z: -9 }, shape: 'round', height: 7.5 },
  { position: { x: -49.5, z: -21 }, shape: 'pine', height: 9.5 },
  { position: { x: -23, z: -22 }, shape: 'pine', height: 9 },
  // The green at the west end of the high street.
  { position: { x: -66, z: -14 }, shape: 'round', height: 8.5 },
  { position: { x: -74, z: -11 }, shape: 'pine', height: 10 },
  { position: { x: -70, z: 13 }, shape: 'round', height: 8.5 },
  { position: { x: -78, z: 16 }, shape: 'round', height: 7.5 },
  { position: { x: -62, z: 16 }, shape: 'pine', height: 9.5 },
  // Beside the car park and the eastern apartments.
  { position: { x: 79, z: -13 }, shape: 'round', height: 7.5 },
  { position: { x: 60, z: 14 }, shape: 'round', height: 7 },
  { position: { x: 80, z: 12 }, shape: 'pine', height: 9 },
  { position: { x: 60, z: -50 }, shape: 'pine', height: 9.5 },
  { position: { x: 80, z: -48 }, shape: 'round', height: 8 },
  { position: { x: -80, z: 48 }, shape: 'round', height: 8 },
  { position: { x: -60, z: 50 }, shape: 'pine', height: 9.5 },
  // The corners of the town.
  { position: { x: -92, z: -50 }, shape: 'pine', height: 10 },
  { position: { x: -92, z: 52 }, shape: 'round', height: 8 },
  { position: { x: 92, z: -50 }, shape: 'round', height: 8.5 },
  { position: { x: 92, z: 52 }, shape: 'pine', height: 10 },
  { position: { x: -92, z: 0 }, shape: 'round', height: 7.5 },
  { position: { x: 92, z: 2 }, shape: 'round', height: 7.5 },
];

/** A loose ring of trees inside the park, leaving the middle for the lawn. */
function parkTrees(): Tree[] {
  const positions: Array<[number, number, 'round' | 'pine']> = [
    [-45, 10, 'round'],
    [-38, 9, 'pine'],
    [-29, 11, 'round'],
    [-46, 18, 'pine'],
    [-27, 18, 'round'],
    [-45, 27, 'round'],
    [-37, 28, 'pine'],
    [-28, 26, 'round'],
    [-33, 20, 'round'],
  ];
  return positions.map(([x, z, shape]) => ({
    position: { x, z },
    shape,
    height: shape === 'pine' ? 10 : 8.5,
  }));
}

/** A line of trees down the high street verges, clear of the outdoor zones. */
function streetTrees(): Tree[] {
  const trees: Tree[] = [];
  for (const x of [-74, -60, -48, -24, 24, 48, 60, 74]) {
    trees.push({ position: { x, z: -8.5 }, shape: 'round', height: 7 });
    trees.push({ position: { x, z: 8.5 }, shape: 'round', height: 7 });
  }
  return trees;
}

/** A tree in every house slot that has no house, so no block face is bare. */
function emptySlotTrees(): Tree[] {
  const trees: Tree[] = [];
  const slots = Object.values(HOUSE_X).flat();
  const rows = [ROW_NORTH_OUTER, ROW_NORTH_INNER, ROW_SOUTH_INNER, ROW_SOUTH_OUTER];

  rows.forEach((placement, rowIndex) => {
    for (const x of slots) {
      const taken = BUILDINGS.some(
        (building) =>
          Math.abs(building.position.x - x) < 8 && Math.abs(building.position.z - placement.z) < 4,
      );
      const inPark = placement === ROW_SOUTH_INNER && x >= PARK.minX - 4 && x <= PARK.maxX + 4;
      if (taken || inPark) {
        continue;
      }
      trees.push({
        position: { x, z: placement.z + (rowIndex % 2 === 0 ? 1 : -1) },
        shape: (x + rowIndex) % 2 === 0 ? 'round' : 'pine',
        height: 7.5 + ((Math.abs(x) + rowIndex) % 3),
      });
    }
  });

  return trees;
}

/** A low hedge or shrub, a soft blob on the ground. */
export interface Shrub {
  position: Point;
  radius: number;
}

/** Shrubs along the high street verges and at the ends of the park path. */
export const SHRUBS: readonly Shrub[] = [
  ...[-68, -54, -30, -18, 18, 30, 54, 68].flatMap((x) => [
    { position: { x, z: -7.5 }, radius: 1.1 },
    { position: { x, z: 7.5 }, radius: 1.1 },
  ]),
  { position: { x: -47, z: 18.5 }, radius: 1.4 },
  { position: { x: -25, z: 18.5 }, radius: 1.4 },
  { position: { x: 57, z: -10 }, radius: 1.2 },
  { position: { x: 77, z: -10 }, radius: 1.2 },
];

/** A bed of flowers: a low patch of colour. */
export interface FlowerBed {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export const FLOWER_BEDS: readonly FlowerBed[] = [
  // Either side of the cafe terrace and the bakery front.
  { minX: -13, maxX: -8.5, minZ: -11, maxZ: -7.5 },
  { minX: 8.5, maxX: 13, minZ: -11, maxZ: -7.5 },
  { minX: -12, maxX: -7.5, minZ: 7.5, maxZ: 11 },
  { minX: 7.5, maxX: 12, minZ: 7.5, maxZ: 11 },
  // In the park, beside the path.
  { minX: -44, maxX: -28, minZ: 21.5, maxZ: 23 },
  // The green at the west end.
  { minX: -76, maxX: -64, minZ: -9.5, maxZ: -7.5 },
];

export const STREET_LAMP_HEIGHT = 5.2;

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
    position: { x: -54 + SIDEWALK_OFFSET, z: -LANE_Z - SIDEWALK_OFFSET },
    rotationY: 0,
    label: 'North Ln',
  },
  {
    position: { x: 54 - SIDEWALK_OFFSET, z: LANE_Z + SIDEWALK_OFFSET },
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

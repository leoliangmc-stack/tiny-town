import type { Building, HouseStyle, RoofProp, YardProp } from '../entities/Building.js';
import { footprintBounds } from '../entities/Building.js';
import { distance, type Point } from '../entities/geometry.js';

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
 * faces. The inner rows face the lanes the cars use; the outer rows turn
 * their backs on them and face the pedestrian lanes (decision 29): the
 * seafront promenade to the north and the upper lane below the church to
 * the south.
 */
const ROW_NORTH_OUTER = { z: -52, rotationY: Math.PI };
const ROW_NORTH_INNER = { z: -28, rotationY: Math.PI };
const ROW_SOUTH_INNER = { z: 28, rotationY: 0 };
const ROW_SOUTH_OUTER = { z: 52, rotationY: 0 };

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
 * The island colours (DESIGN.md §10). Walls are white; a fifth of the houses
 * take a pale wash instead. Doors and shutters draw one colour from the
 * accent set. Houses draw by number, so the mix down a street is fixed.
 */
export const WALL_WHITE = 0xf7f4ee;
const WALL_WASHES = [0xf1dcbf, 0xf3d9d2, 0xf5ecc6];
export const ACCENT_COLORS = [0x3f7fb8, 0x2b4c8c, 0x4e8a6a, 0x3f8f8a, 0x9a7452];
const YARD_PROPS: readonly YardProp[] = ['mailbox', 'flower-pots', 'bicycle', 'bin', 'mailbox'];
const ROOF_PROPS: readonly RoofProp[] = ['washing', 'pots', 'tank', 'chair'];

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
    width: 23.4,
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
    position: { x: -5.6, z: -16 },
    width: 12.4,
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
    width: 23.4,
    depth: 12,
    wallHeight: 6,
    roofHeight: 0.8,
    rotationY: 0,
    floors: 1,
  },

  // The bakery shares the middle block with the cafe, wall to wall, so the
  // north side of the high street is one parade of shops (DESIGN.md §4).
  {
    id: 'bakery',
    kind: 'bakery',
    name: 'Willow Bakery',
    position: { x: 6.3, z: -15.5 },
    width: 11.2,
    depth: 8,
    wallHeight: 5,
    roofHeight: 0.5,
    rotationY: 0,
    floors: 1,
  },

  // --- The high street, south side ---
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
  const upper: HouseStyle['upper'] = n % 7 === 0 ? 'none' : n % 2 === 1 ? 'left' : 'right';
  // Six of the thirty houses take a wash: eight parts white, two parts colour.
  const washed = n % 5 === 2;
  return {
    upper,
    dome: n % 8 === 3,
    wallColor: washed ? WALL_WASHES[Math.floor(n / 5) % WALL_WASHES.length] : WALL_WHITE,
    trimColor: ACCENT_COLORS[(n * 3 + Math.floor(n / 5)) % ACCENT_COLORS.length],
    stair: upper !== 'none' && n % 3 !== 0,
    roofProp: ROOF_PROPS[n % ROOF_PROPS.length],
    flowerBed: n % 3 !== 0,
    prop: YARD_PROPS[n % YARD_PROPS.length],
    // Five of the thirty: the one saturated colour, rationed (DESIGN.md §9).
    bougainvillea: n % 6 === 1,
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

  return {
    id: `house-${String(number).padStart(2, '0')}`,
    kind: 'house',
    name: `${HOUSE_NAMES[(number - 1) % HOUSE_NAMES.length]} House`,
    position: { x, z },
    width: isEndBlock(x) ? 8.2 + wobble(0, 0.6) : 8.4 + wobble(0, 1.2),
    depth: 6.8 + wobble(3, 1.2),
    wallHeight: (style.upper === 'none' ? 5.2 : 5.6) + wobble(5, 0.8),
    roofHeight: 0.45,
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
  zone('cafe-terrace', 'cafe', 'terrace', -11.5, -0.5, -11.5, -6.6, 8),
  zone('school-playground', 'school', 'playground', -47, -25, -11.5, -6.6, 12),
  zone('supermarket-forecourt', 'supermarket', 'forecourt', 25, 47, -11.5, -6.6, 8),
  zone('bakery-front', 'bakery', 'terrace', 1.5, 11.5, -11.5, -6.6, 5),
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

/**
 * The pedestrian lanes (SPEC.md 2.3, decision 29): a second network for
 * people only, paved in pale stone with white joints. The seafront promenade
 * runs behind the northern houses, the upper lane behind the southern ones
 * below the church, and at every cross street a flight of steps joins each
 * of them to the pavement where the street ends. The outer house rows face
 * these lanes, so their doors are on the pedestrian network and the cars
 * stay behind the houses. Same shape as a Street, so the graph code and the
 * renderer can treat the two alike.
 */
export interface Lane extends Street {
  /** Steps rather than a paved ramp: the lane climbs the slope. */
  steps: boolean;
}

export const PROMENADE_Z = -60;
export const UPPER_LANE_Z = 60;
export const LANE_WIDTH = 2.4;

export const LANES: readonly Lane[] = [
  { id: 'promenade', axis: 'x', at: PROMENADE_Z, from: -90, to: 90, steps: false },
  { id: 'upper-lane', axis: 'x', at: UPPER_LANE_Z, from: -90, to: 90, steps: false },
  ...CROSS_X.flatMap((x, index): Lane[] => [
    {
      id: `steps-north-${index}`,
      axis: 'z',
      at: x,
      from: PROMENADE_Z,
      to: -LANE_Z - SIDEWALK_OFFSET,
      steps: true,
    },
    {
      id: `steps-south-${index}`,
      axis: 'z',
      at: x,
      from: LANE_Z + SIDEWALK_OFFSET,
      to: UPPER_LANE_Z,
      steps: true,
    },
  ]),
  // The path up from the upper lane to the church door.
  { id: 'church-path', axis: 'z', at: 0, from: UPPER_LANE_Z, to: 66.5, steps: true },
];

/** The little paved square across the high street from the cafe. */
export const SQUARE = { minX: -8, maxX: 8, minZ: 6.8, maxZ: 12.4 } as const;

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

/** The lot and its apron onto the cross street, as one patch of paving. */
const PARKING_LOT_BOUNDS = {
  minX: PARKING_LOT.minX - 4.5,
  maxX: PARKING_LOT.maxX,
  minZ: PARKING_LOT.minZ,
  maxZ: PARKING_LOT.maxZ,
};

/**
 * The trees of a dry island (DESIGN.md §9): olives with loose silver-green
 * crowns, cypresses as dark vertical lines, and the park's big round green
 * trees, the one oasis.
 */
export interface Tree {
  position: Point;
  shape: 'round' | 'olive' | 'cypress';
  height: number;
}

/**
 * An axis aligned patch of paving nothing may stand on: a street (its tarmac
 * alone, or with its pavements), a pedestrian lane or flight of steps, the
 * car park, the square. Every prop and plant in the town is checked against
 * these before it is placed (the rule that keeps lamps out of junctions).
 */
export interface Paved {
  name: string;
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

/**
 * Everything paved. With `pavements` the streets count out to the pavement
 * edge, which is what a plant must keep off; without, only the tarmac, which
 * is what a lamp on the pavement must keep off.
 */
export function pavedAreas(pavements: boolean): Paved[] {
  const areas: Paved[] = [];
  const half = pavements ? SIDEWALK_EDGE : ROAD_WIDTH / 2;
  for (const street of STREETS) {
    areas.push(
      street.axis === 'x'
        ? {
            name: street.id,
            minX: street.from,
            maxX: street.to,
            minZ: street.at - half,
            maxZ: street.at + half,
          }
        : {
            name: street.id,
            minX: street.at - half,
            maxX: street.at + half,
            minZ: street.from,
            maxZ: street.to,
          },
    );
  }
  for (const lane of LANES) {
    const w = LANE_WIDTH / 2;
    areas.push(
      lane.axis === 'x'
        ? { name: lane.id, minX: lane.from, maxX: lane.to, minZ: lane.at - w, maxZ: lane.at + w }
        : { name: lane.id, minX: lane.at - w, maxX: lane.at + w, minZ: lane.from, maxZ: lane.to },
    );
  }
  areas.push({ name: 'parking-lot', ...PARKING_LOT_BOUNDS });
  areas.push({ name: 'square', ...SQUARE });
  return areas;
}

/** The paved area a disc of `radius` at `point` overlaps, if any. */
export function pavingUnder(point: Point, radius: number, pavements: boolean): Paved | undefined {
  return pavedAreas(pavements).find(
    (area) =>
      point.x + radius > area.minX &&
      point.x - radius < area.maxX &&
      point.z + radius > area.minZ &&
      point.z - radius < area.maxZ,
  );
}

/**
 * Moves a point off any paving it overlaps, by the shortest way out, a few
 * times over; gives up (undefined) when there is nowhere clear to go, in
 * which case the caller drops the prop. Used on every list below, so a
 * hand-placed shrub that drifts onto a road with the next layout change is
 * nudged or dropped rather than drawn on the tarmac.
 */
export function offPaving(point: Point, radius: number, pavements = true): Point | undefined {
  const clearance = 0.25;
  let current = { ...point };
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const area = pavingUnder(current, radius, pavements);
    if (!area) {
      return current;
    }
    const outs = [
      { x: area.minX - radius - clearance - current.x, z: 0 },
      { x: area.maxX + radius + clearance - current.x, z: 0 },
      { x: 0, z: area.minZ - radius - clearance - current.z },
      { x: 0, z: area.maxZ + radius + clearance - current.z },
    ];
    const shortest = outs.reduce((best, out) =>
      Math.abs(out.x) + Math.abs(out.z) < Math.abs(best.x) + Math.abs(best.z) ? out : best,
    );
    current = { x: current.x + shortest.x, z: current.z + shortest.z };
  }
  return undefined;
}

/** Applies offPaving to a list of things with a position, dropping the ones with nowhere to go. */
function keepOffPaving<T extends { position: Point }>(
  items: readonly T[],
  radius: (item: T) => number,
): T[] {
  const kept: T[] = [];
  for (const item of items) {
    const moved = offPaving(item.position, radius(item));
    if (moved) {
      kept.push({ ...item, position: moved });
    }
  }
  return kept;
}

/**
 * Trees. The park is planted densely with round green trees, the high
 * street gets a row of olives, every empty house slot gets an olive or a
 * cypress, and the corners of the town get cypresses so the grid does not
 * end in bare ground.
 */
export const TREES: readonly Tree[] = keepOffPaving(
  [
    ...parkTrees(),
    ...streetTrees(),
    ...emptySlotTrees(),
    // Around the school playground.
    { position: { x: -50, z: -9 }, shape: 'olive', height: 6.5 },
    { position: { x: -22, z: -9 }, shape: 'olive', height: 6 },
    { position: { x: -50, z: -23 }, shape: 'cypress', height: 10 },
    { position: { x: -22, z: -23 }, shape: 'cypress', height: 9.5 },
    // The green at the west end of the high street.
    { position: { x: -66, z: -14 }, shape: 'olive', height: 7 },
    { position: { x: -74, z: -11 }, shape: 'cypress', height: 11 },
    { position: { x: -70, z: 13 }, shape: 'olive', height: 7 },
    { position: { x: -78, z: 16 }, shape: 'olive', height: 6 },
    { position: { x: -62, z: 16 }, shape: 'cypress', height: 10 },
    // Beside the car park and the eastern apartments.
    { position: { x: 79, z: -13 }, shape: 'olive', height: 6.5 },
    { position: { x: 60, z: 14 }, shape: 'olive', height: 6 },
    { position: { x: 80, z: 12 }, shape: 'cypress', height: 9.5 },
    { position: { x: 60, z: -50 }, shape: 'cypress', height: 10 },
    { position: { x: 80, z: -48 }, shape: 'olive', height: 6.5 },
    { position: { x: -80, z: 48 }, shape: 'olive', height: 6.5 },
    { position: { x: -60, z: 50 }, shape: 'cypress', height: 10 },
    // The corners of the town, and by the church.
    { position: { x: -92, z: -50 }, shape: 'cypress', height: 11 },
    { position: { x: -92, z: 52 }, shape: 'olive', height: 7 },
    { position: { x: 92, z: -50 }, shape: 'olive', height: 7 },
    { position: { x: 92, z: 52 }, shape: 'cypress', height: 11 },
    { position: { x: -92, z: 0 }, shape: 'olive', height: 6.5 },
    { position: { x: 92, z: 2 }, shape: 'olive', height: 6.5 },
    { position: { x: -9, z: 84 }, shape: 'cypress', height: 12 },
    { position: { x: 9, z: 85 }, shape: 'cypress', height: 11 },
    { position: { x: 12, z: 70 }, shape: 'cypress', height: 10 },
  ],
  // The trunk must be off the paving; a crown may lean over it.
  (tree) => (tree.shape === 'cypress' ? 0.6 : 0.9),
);

/** Agaves and cacti (DESIGN.md §9): along the lanes and by the church. */
export interface Succulent {
  position: Point;
  kind: 'agave' | 'cactus';
}

export const SUCCULENTS: readonly Succulent[] = keepOffPaving(
  [
    ...[-80, -58, -36, -12, 12, 36, 58, 80].map((x, index) => ({
      position: { x, z: -58.4 },
      kind: (index % 3 === 0 ? 'cactus' : 'agave') as Succulent['kind'],
    })),
    ...[-78, -50, -28, -6, 6, 28, 50, 78].map((x, index) => ({
      position: { x, z: 58.4 },
      kind: (index % 3 === 1 ? 'cactus' : 'agave') as Succulent['kind'],
    })),
    { position: { x: -8, z: 67 }, kind: 'agave' },
    { position: { x: 8, z: 67 }, kind: 'agave' },
    { position: { x: -15, z: 8.5 }, kind: 'agave' },
    { position: { x: 15, z: 8.5 }, kind: 'agave' },
  ],
  () => 0.8,
);

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
    // The park's trees are the big green ones: the oasis (DESIGN.md §9).
    shape: shape === 'pine' ? 'round' : 'round',
    height: shape === 'pine' ? 10 : 8.5,
  }));
}

/** A line of trees down the high street verges, clear of the outdoor zones. */
function streetTrees(): Tree[] {
  const trees: Tree[] = [];
  for (const x of [-74, -60, -48, -24, 24, 48, 60, 74]) {
    trees.push({ position: { x, z: -8.5 }, shape: 'olive', height: 6 });
    trees.push({ position: { x, z: 8.5 }, shape: 'olive', height: 6 });
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
      const cypress = (Math.round(x) + rowIndex) % 2 === 0;
      trees.push({
        position: { x, z: placement.z + (rowIndex % 2 === 0 ? 1 : -1) },
        shape: cypress ? 'cypress' : 'olive',
        height: cypress ? 9.5 + ((Math.abs(x) + rowIndex) % 3) : 6 + ((Math.abs(x) + rowIndex) % 2),
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
export const SHRUBS: readonly Shrub[] = keepOffPaving(
  [
    ...[-68, -54, -30, -18, 18, 30, 54, 68].flatMap((x) => [
      { position: { x, z: -7.5 }, radius: 1.1 },
      { position: { x, z: 7.5 }, radius: 1.1 },
    ]),
    { position: { x: -47, z: 18.5 }, radius: 1.4 },
    { position: { x: -25, z: 18.5 }, radius: 1.4 },
    { position: { x: 57, z: -10 }, radius: 1.2 },
    { position: { x: 77, z: -10 }, radius: 1.2 },
  ],
  (shrub) => shrub.radius,
);

/** A bed of flowers: a low patch of colour. */
export interface FlowerBed {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export const FLOWER_BEDS: readonly FlowerBed[] = [
  // Either side of the little square across from the cafe, inside the
  // pavements of the cross streets.
  { minX: -11.6, maxX: -8.4, minZ: 7.5, maxZ: 11 },
  { minX: 8.4, maxX: 11.6, minZ: 7.5, maxZ: 11 },
  // In the park, beside the path.
  { minX: -44, maxX: -28, minZ: 21.5, maxZ: 23 },
  // The green at the west end.
  { minX: -76, maxX: -64, minZ: -9.5, maxZ: -7.5 },
];

/**
 * Where cars stand when not in the car park: at the kerb outside a building,
 * one node per space on the road graph (SPEC.md 2.5). Homes get one space,
 * the busier public buildings a few, the park two for visitors. The space
 * sits on the road edge nearest the building's door; Navigation.ts places it.
 */
export const KERB_SPACES: Readonly<Record<string, number>> = {
  school: 2,
  cafe: 2,
  bakery: 1,
  office: 4,
  park: 2,
};

/**
 * Every home has two kerb spaces, so the owner's car and a delivery van can
 * both stand outside; public buildings use the table above.
 */
export function kerbSpaceCount(buildingId: string): number {
  return KERB_SPACES[buildingId] ?? 2;
}

/** The point the park's kerb spaces are placed from: its edge on the high street. */
export const PARK_FRONT: Point = { x: -36, z: 7 };

/**
 * Traffic lights at the two junctions either side of the town centre. A cycle
 * gives the high street the green first, then the cross street.
 */
export interface TrafficLight {
  x: number;
  z: number;
  /** Game minutes each direction holds green. */
  greenMinutes: number;
}

export const TRAFFIC_LIGHTS: readonly TrafficLight[] = [
  { x: -18, z: 0, greenMinutes: 1.5 },
  { x: 18, z: 0, greenMinutes: 1.5 },
];

/**
 * The two landmarks (SPEC.md 2.3, decision 29): the church at the top of the
 * slope behind the southern houses, and the lighthouse on the headland
 * where the shore runs furthest out to sea. Neither is on the navigation
 * graphs; they are places to look at, not to go to.
 */
export const CHURCH = {
  position: { x: 0, z: 76 },
  width: 12,
  depth: 17,
  /** The front, with its door and bell tower, faces the town. */
  rotationY: Math.PI,
} as const;

export const LIGHTHOUSE = {
  position: { x: 63, z: -79 },
  height: 16,
} as const;

export const STREET_LAMP_HEIGHT = 5.2;

/**
 * Street lamps, spaced along the pavement of every street. A lamp that
 * would stand on another street's tarmac (the ends of a street are in a
 * junction) or on a lane or the car park is left out: it stays on the
 * pavement or it is not placed.
 */
export function streetLampPositions(spacing = 26): Point[] {
  const positions: Point[] = [];

  for (const street of STREETS) {
    const length = street.to - street.from;
    const count = Math.max(2, Math.round(length / spacing));
    for (let index = 0; index <= count; index += 1) {
      const along = street.from + (index / count) * length;
      // Alternate sides so the lamps stagger down the street.
      const side = index % 2 === 0 ? -1 : 1;
      const at = (a: number): Point =>
        street.axis === 'x'
          ? { x: a, z: street.at + side * SIDEWALK_OFFSET }
          : { x: street.at + side * SIDEWALK_OFFSET, z: a };
      // In a junction, slide the lamp along its own street to the pavement
      // just past the crossing; if that is paved too, leave it out.
      const step = SIDEWALK_EDGE + 1;
      const candidates = [at(along), at(along + step), at(along - step)].filter(
        (candidate) =>
          (street.axis === 'x' ? candidate.x : candidate.z) >= street.from &&
          (street.axis === 'x' ? candidate.x : candidate.z) <= street.to,
      );
      const clear = candidates.find((candidate) => !pavingUnder(candidate, 0.2, false));
      if (clear && !positions.some((existing) => distance(existing, clear) < 4)) {
        positions.push(clear);
      }
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
  include(CHURCH.position.x - CHURCH.width / 2, CHURCH.position.z - CHURCH.depth / 2);
  include(CHURCH.position.x + CHURCH.width / 2, CHURCH.position.z + CHURCH.depth / 2);
  for (const lane of LANES) {
    if (lane.axis === 'x') {
      include(lane.from, lane.at - LANE_WIDTH);
      include(lane.to, lane.at + LANE_WIDTH);
    }
  }

  return { minX, maxX, minZ, maxZ };
}

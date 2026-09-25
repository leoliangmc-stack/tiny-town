import { closestPointOnSegment, distance, type Point } from '../entities/geometry.js';

/**
 * The world beyond the town (SPEC.md 2.14, decision 44): three neighbouring
 * villages, the country road out of the town, and the courses of the boats
 * that come and go between the harbours and the horizon.
 *
 * Like Terrain.ts this is plain data and pure functions with no Three.js in
 * it. Only the renderer reads it. None of it is part of the navigation graphs
 * or the state hash: no citizen and none of the eight town vehicles ever uses
 * the country road, so it cannot touch determinism.
 *
 * Units are metres. X runs east, Z runs south.
 */

/** A smooth polyline, sampled densely, with its running length. */
export interface Path {
  readonly points: readonly Point[];
  /** `lengths[i]` is the distance along the path from its start to `points[i]`. */
  readonly lengths: readonly number[];
  readonly length: number;
}

/** A position on a path and the way it faces, measured from +Z towards +X like the cars. */
export interface PathPose {
  x: number;
  z: number;
  heading: number;
}

/**
 * A Catmull-Rom curve through every control point, sampled about every
 * `spacing` metres. The control points themselves are among the samples, so a
 * fork placed on a control point lies exactly on both roads that meet there.
 */
export function smoothPath(control: readonly Point[], spacing = 2): Path {
  const points: Point[] = [{ ...control[0] }];
  for (let index = 0; index < control.length - 1; index += 1) {
    const p0 = control[Math.max(0, index - 1)];
    const p1 = control[index];
    const p2 = control[index + 1];
    const p3 = control[Math.min(control.length - 1, index + 2)];
    const steps = Math.max(1, Math.ceil(distance(p1, p2) / spacing));
    for (let step = 1; step <= steps; step += 1) {
      const t = step / steps;
      const t2 = t * t;
      const t3 = t2 * t;
      const blend = (a: number, b: number, c: number, d: number): number =>
        0.5 *
        (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      points.push({ x: blend(p0.x, p1.x, p2.x, p3.x), z: blend(p0.z, p1.z, p2.z, p3.z) });
    }
  }
  return measured(points);
}

function measured(points: readonly Point[]): Path {
  const lengths = [0];
  for (let index = 1; index < points.length; index += 1) {
    lengths.push(lengths[index - 1] + distance(points[index - 1], points[index]));
  }
  return { points, lengths, length: lengths[lengths.length - 1] };
}

/** The same path, travelled the other way. */
export function reversed(path: Path): Path {
  return measured([...path.points].reverse());
}

/** Two paths end to end; the second must start where the first ends. */
export function joined(first: Path, second: Path): Path {
  return measured([...first.points, ...second.points.slice(1)]);
}

/** Where on a path a traveller `along` metres from its start is, clamped to the ends. */
export function poseAlong(path: Path, along: number): PathPose {
  const { points, lengths } = path;
  const clamped = Math.min(path.length, Math.max(0, along));
  // A binary search for the segment that holds the distance.
  let low = 0;
  let high = lengths.length - 1;
  while (high - low > 1) {
    const middle = (low + high) >> 1;
    if (lengths[middle] <= clamped) {
      low = middle;
    } else {
      high = middle;
    }
  }
  const a = points[low];
  const b = points[high];
  const span = lengths[high] - lengths[low];
  const t = span > 0 ? (clamped - lengths[low]) / span : 0;
  return {
    x: a.x + (b.x - a.x) * t,
    z: a.z + (b.z - a.z) * t,
    heading: Math.atan2(b.x - a.x, b.z - a.z),
  };
}

/** The shortest distance from a point to a path. */
export function distanceToPath(path: Path, point: Point): number {
  let best = Infinity;
  for (let index = 1; index < path.points.length; index += 1) {
    const closest = closestPointOnSegment(point, path.points[index - 1], path.points[index]);
    best = Math.min(best, distance(point, closest));
  }
  return best;
}

// --- The country road --------------------------------------------------------

/** Plain tarmac, narrower than a town street, with no pavements (DESIGN.md §20). */
export const COUNTRY_ROAD_WIDTH = 5;

/**
 * Where the country road leaves the town's grid: the junction at the east end
 * of the north lane. The town's pavements are cut on this side of it.
 */
export const TOWN_EXIT = { x: 86, z: -40, dx: 1, dz: 0 } as const;

/** Where the road to the hill village branches off the coast road. */
const FORK: Point = { x: 140, z: -45 };

/** From the edge of the exit junction's tarmac to the fork. */
const SPUR_CONTROL: readonly Point[] = [
  { x: 92.1, z: -40 },
  { x: 106, z: -40 },
  { x: 124, z: -43 },
  FORK,
];

/** From the fork east along the coast, above the beach, into the fishing village. */
const COAST_CONTROL: readonly Point[] = [
  FORK,
  { x: 160, z: -44 },
  { x: 182, z: -47 },
  { x: 205, z: -50 },
  { x: 228, z: -48 },
  { x: 258, z: -46 },
];

/** From the fork uphill, south-east through the woods, into the hill village. */
const HILL_CONTROL: readonly Point[] = [
  FORK,
  { x: 150, z: -24 },
  { x: 158, z: 6 },
  { x: 172, z: 42 },
  { x: 190, z: 82 },
  { x: 204, z: 116 },
  { x: 213, z: 142 },
];

const SPUR = smoothPath(SPUR_CONTROL);
const COAST = smoothPath(COAST_CONTROL);
const HILL = smoothPath(HILL_CONTROL);

/** The road out of the town along the coast, and the branch up to the hill village. */
export const COUNTRY_ROADS: readonly Path[] = [joined(SPUR, COAST), HILL];

/**
 * The way the through traffic drives: from the fishing village back along
 * the coast to the fork and up to the hill village. It never enters the town.
 */
export const TRAFFIC_ROUTE: Path = joined(reversed(COAST), HILL);

/** A car of the through traffic: its pace and where in its round it is when the page opens. */
export interface CountryCar {
  /** Metres per second. */
  speed: number;
  /** Seconds out of sight in a village at each end, as if parked at home. */
  rest: number;
  offset: number;
  color: number;
}

export const COUNTRY_CARS: readonly CountryCar[] = [
  { speed: 10, rest: 18, offset: 0, color: 0xc9705f },
  { speed: 9, rest: 30, offset: 41, color: 0xe8e2d4 },
  { speed: 11, rest: 24, offset: 77, color: 0x3f7fb8 },
  { speed: 8.5, rest: 40, offset: 118, color: 0x6f8f5a },
];

/** Cars keep this far right of the middle of the road. */
export const COUNTRY_LANE_OFFSET = 1.2;

/** Over this many metres at each end of the route a car grows in or shrinks away. */
export const TRAFFIC_FADE_METRES = 12;

/**
 * Where a country car is at `time` seconds: driving from the fishing village
 * to the hill village, resting there out of sight, driving back, resting.
 */
export function carPose(car: CountryCar, time: number): VoyagePose {
  const route = TRAFFIC_ROUTE;
  const driving = route.length / car.speed;
  const cycle = 2 * (driving + car.rest);
  const t = (((time + car.offset) % cycle) + cycle) % cycle;
  const back = driving + car.rest;
  if (t >= driving && t < back) {
    return { ...poseAlong(route, route.length), scale: 0, moving: false };
  }
  if (t >= back + driving) {
    return { ...poseAlong(route, 0), scale: 0, moving: false };
  }
  const forward = t < driving;
  const along = forward ? t * car.speed : route.length - (t - back) * car.speed;
  const pose = poseAlong(route, along);
  const heading = forward ? pose.heading : pose.heading + Math.PI;
  const scale = Math.min(
    1,
    along / TRAFFIC_FADE_METRES,
    (route.length - along) / TRAFFIC_FADE_METRES,
  );
  // Keep right: with X east and Z south, the right of heading h is (-cos h, sin h).
  return {
    x: pose.x - Math.cos(heading) * COUNTRY_LANE_OFFSET,
    z: pose.z + Math.sin(heading) * COUNTRY_LANE_OFFSET,
    heading,
    scale: Math.max(0, scale),
    moving: true,
  };
}

/** The shortest distance from a point to the middle of any country road. */
export function distanceToCountryRoads(point: Point): number {
  return Math.min(...COUNTRY_ROADS.map((road) => distanceToPath(road, point)));
}

// --- The neighbours ------------------------------------------------------------

export type NeighbourKind = 'coast' | 'hill' | 'island';

/** A village drawn in the distance: no citizens, no paths, only houses and lights. */
export interface Neighbour {
  id: string;
  kind: NeighbourKind;
  centre: Point;
  /** Houses stand within this many metres of the centre. */
  radius: number;
  houses: number;
}

export const NEIGHBOURS: readonly Neighbour[] = [
  { id: 'fishing-village', kind: 'coast', centre: { x: 262, z: -50 }, radius: 26, houses: 20 },
  { id: 'hill-village', kind: 'hill', centre: { x: 216, z: 152 }, radius: 24, houses: 18 },
  { id: 'island-village', kind: 'island', centre: { x: -124, z: -396 }, radius: 20, houses: 14 },
];

/** The island across the bay: an oval mound rising out of the sea. */
export const ISLAND = {
  centre: { x: -130, z: -410 },
  radiusX: 50,
  radiusZ: 28,
  height: 14,
} as const;

/**
 * Height of the island above the sea at a point, or a negative number off
 * its shore. A dome that is steeper at the water and flatter on top, with a
 * lower shoulder to the west so the outline is not an egg.
 */
export function islandHeight(x: number, z: number): number {
  const dx = (x - ISLAND.centre.x) / ISLAND.radiusX;
  const dz = (z - ISLAND.centre.z) / ISLAND.radiusZ;
  const reach = Math.hypot(dx, dz);
  if (reach >= 1) {
    return -1;
  }
  const dome = Math.pow(1 - reach * reach, 0.8);
  const shoulder = 0.75 + 0.25 * Math.tanh((dx + 0.2) * 3);
  return ISLAND.height * dome * shoulder;
}

// --- Harbours and the boats that use them -------------------------------------------

/** A straight breakwater of piled stone, from `from` to `to`. */
export interface Breakwater {
  from: Point;
  to: Point;
}

export const BREAKWATERS: readonly Breakwater[] = [
  // The fishing village: an arm out from the shore that hooks east.
  { from: { x: 262, z: -80 }, to: { x: 262, z: -98 } },
  { from: { x: 262, z: -98 }, to: { x: 272, z: -98 } },
  // The island: a short mole west of the quay.
  { from: { x: -133, z: -382 }, to: { x: -133, z: -372 } },
];

/**
 * A boat's voyage: it waits at the first point, sails the path to the last,
 * waits or vanishes there, and sails back. `vanish` makes the far end lie
 * beyond the haze, where the boat shrinks away and stays gone for `away`
 * seconds before it comes back.
 */
export interface Voyage {
  path: Path;
  /** Metres per second. */
  speed: number;
  /** Seconds tied up at the start. */
  wait: number;
  /** Seconds at the far end: tied up there, or out of sight if `vanish`. */
  away: number;
  vanish: boolean;
  /** Seconds into the cycle at which the boat is found when the page opens. */
  offset: number;
}

/** Over this many metres before the far end, a vanishing boat shrinks away into the haze. */
export const VANISH_METRES = 80;

/** Where a boat on a voyage is, which way it faces, and how much of it to draw. */
export interface VoyagePose extends PathPose {
  scale: number;
  /** False while tied up or parked; a boat at rest leaves no wake. */
  moving: boolean;
}

/**
 * Where a boat on `voyage` is at `time` seconds. While tied up, the boat
 * turns slowly from the way it came in to the way it will leave.
 */
export function voyagePose(voyage: Voyage, time: number): VoyagePose {
  const { path, speed, wait, away } = voyage;
  const sailing = path.length / speed;
  const cycle = wait + sailing + away + sailing;
  let t = (((time + voyage.offset) % cycle) + cycle) % cycle;
  const fade = (fromFarEnd: number): number =>
    voyage.vanish ? Math.min(1, Math.max(0, fromFarEnd / VANISH_METRES)) : 1;

  const outbound = (along: number): PathPose => poseAlong(path, along);
  const inbound = (along: number): PathPose => {
    const pose = poseAlong(path, path.length - along);
    return { ...pose, heading: pose.heading + Math.PI };
  };

  if (t < wait) {
    const arrived = inbound(path.length);
    const leaving = outbound(0);
    return {
      ...leaving,
      heading: turn(arrived.heading, leaving.heading, t / wait),
      scale: 1,
      moving: false,
    };
  }
  t -= wait;
  if (t < sailing) {
    const along = t * speed;
    return { ...outbound(along), scale: fade(path.length - along), moving: true };
  }
  t -= sailing;
  if (t < away) {
    const arrived = outbound(path.length);
    const leaving = inbound(0);
    return {
      ...leaving,
      heading: turn(arrived.heading, leaving.heading, t / away),
      scale: voyage.vanish ? 0 : 1,
      moving: false,
    };
  }
  t -= away;
  const along = t * speed;
  return { ...inbound(along), scale: fade(along), moving: true };
}

/** A heading part of the way from `from` to `to`, the short way round, eased. */
function turn(from: number, to: number, t: number): number {
  const delta = Math.atan2(Math.sin(to - from), Math.cos(to - from));
  const eased = t * t * (3 - 2 * t);
  return from + delta * eased;
}

/** The coaster: out of the fishing village's harbour, round the hook, off to the horizon. */
export const COASTER_VOYAGE: Voyage = {
  path: smoothPath([
    { x: 270, z: -90 },
    { x: 280, z: -95 },
    { x: 285, z: -108 },
    { x: 272, z: -160 },
    { x: 222, z: -330 },
    { x: 160, z: -620 },
  ]),
  speed: 5,
  wait: 40,
  away: 70,
  vanish: true,
  offset: 20,
};

/** The small passenger boat between the fishing village and the island. */
export const LAUNCH_VOYAGE: Voyage = {
  path: smoothPath([
    { x: 253, z: -91 },
    { x: 246, z: -104 },
    { x: 150, z: -175 },
    { x: 0, z: -290 },
    { x: -100, z: -370 },
    { x: -112, z: -377 },
    { x: -122, z: -379 },
  ]),
  speed: 5.5,
  wait: 25,
  away: 25,
  vanish: false,
  offset: 60,
};

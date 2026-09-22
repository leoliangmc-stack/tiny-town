import { doorPosition } from '../entities/Building.js';
import { closestPointOnSegment, distance, type Point } from '../entities/geometry.js';
import type { Place } from '../entities/Citizen.js';
import {
  BUILDINGS,
  PARK_FRONT,
  PARKING_LOT,
  ROAD_WIDTH,
  SIDEWALK_OFFSET,
  STREETS,
  type Street,
  getZone,
  junctions,
  kerbSpaceCount,
} from '../world/Town.js';

/**
 * The navigation graphs (SPEC.md 3.2, rule 4).
 *
 * There are two: one over the pavements for people on foot, one over the road
 * centrelines for vehicles. Both are built from the street data in
 * world/Town.ts, so the map and the graphs can never drift apart. Paths are A*
 * over the graph and are cached by whoever asked for them; nothing recomputes
 * a path unless its destination changed.
 */

export interface NavNode {
  id: string;
  position: Point;
}

/** How far apart nodes are placed along a street. */
const SIDEWALK_NODE_SPACING = 7;
const ROAD_NODE_SPACING = 9;

/** Positions closer together than this are treated as the same node. */
const NODE_MERGE_TOLERANCE = 0.25;

export class NavGraph {
  private readonly nodes = new Map<string, NavNode>();
  private readonly edges = new Map<string, string[]>();
  /** Node id by rounded position, so the same corner is never added twice. */
  private readonly byPosition = new Map<string, string>();

  /** Adds a node, or returns the existing one at that position. */
  addNode(position: Point, idHint: string): NavNode {
    const key = positionKey(position);
    const existing = this.byPosition.get(key);
    if (existing) {
      return this.nodes.get(existing) as NavNode;
    }

    let id = idHint;
    let suffix = 1;
    while (this.nodes.has(id)) {
      id = `${idHint}#${suffix}`;
      suffix += 1;
    }

    const node: NavNode = { id, position: { ...position } };
    this.nodes.set(id, node);
    this.edges.set(id, []);
    this.byPosition.set(key, id);
    return node;
  }

  /** Joins two nodes in both directions. */
  connect(a: NavNode, b: NavNode): void {
    if (a.id === b.id) {
      return;
    }
    const outA = this.edges.get(a.id) as string[];
    const outB = this.edges.get(b.id) as string[];
    if (!outA.includes(b.id)) {
      outA.push(b.id);
    }
    if (!outB.includes(a.id)) {
      outB.push(a.id);
    }
  }

  get nodeCount(): number {
    return this.nodes.size;
  }

  get allNodes(): NavNode[] {
    return [...this.nodes.values()];
  }

  node(id: string): NavNode {
    const found = this.nodes.get(id);
    if (!found) {
      throw new Error(`Unknown navigation node: ${id}`);
    }
    return found;
  }

  neighbours(id: string): string[] {
    return this.edges.get(id) ?? [];
  }

  /** Every edge once, for the debug overlay. */
  edgeList(): Array<[Point, Point]> {
    const seen = new Set<string>();
    const list: Array<[Point, Point]> = [];
    for (const [from, tos] of this.edges) {
      for (const to of tos) {
        const key = from < to ? `${from}|${to}` : `${to}|${from}`;
        if (seen.has(key)) {
          continue;
        }
        seen.add(key);
        list.push([this.node(from).position, this.node(to).position]);
      }
    }
    return list;
  }

  /**
   * The node closest to a position, ignoring one id.
   *
   * The exclusion matters when joining a node that has just been added: the
   * node closest to a door is the door itself.
   */
  nearestNode(point: Point, excludedId?: string): NavNode {
    let best: NavNode | undefined;
    let bestDistance = Infinity;
    for (const node of this.nodes.values()) {
      if (node.id === excludedId) {
        continue;
      }
      const candidate = distance(point, node.position);
      if (candidate < bestDistance) {
        bestDistance = candidate;
        best = node;
      }
    }
    if (!best) {
      throw new Error('The navigation graph is empty');
    }
    return best;
  }

  /** How far the point is from the nearest edge of the graph. */
  distanceToGraph(point: Point): number {
    let best = Infinity;
    for (const [from, to] of this.edgeList()) {
      best = Math.min(best, distance(point, closestPointOnSegment(point, from, to)));
    }
    return best;
  }

  /**
   * A* from one node to another. Returns the positions to walk through,
   * starting at `fromId` and ending at `toId`, or an empty path if there is no
   * route at all.
   */
  findPath(fromId: string, toId: string): Point[] {
    if (fromId === toId) {
      return [this.node(fromId).position];
    }

    const goal = this.node(toId).position;
    const cameFrom = new Map<string, string>();
    const costSoFar = new Map<string, number>([[fromId, 0]]);
    const open: Array<{ id: string; estimate: number }> = [
      { id: fromId, estimate: distance(this.node(fromId).position, goal) },
    ];
    const closed = new Set<string>();

    while (open.length > 0) {
      // The graph is small enough that scanning for the best node beats the
      // bookkeeping of a heap.
      let bestIndex = 0;
      for (let i = 1; i < open.length; i += 1) {
        if (open[i].estimate < open[bestIndex].estimate) {
          bestIndex = i;
        }
      }
      const current = open.splice(bestIndex, 1)[0];

      if (current.id === toId) {
        return this.rebuildPath(cameFrom, toId);
      }
      if (closed.has(current.id)) {
        continue;
      }
      closed.add(current.id);

      const here = this.node(current.id);
      for (const neighbourId of this.neighbours(current.id)) {
        if (closed.has(neighbourId)) {
          continue;
        }
        const neighbour = this.node(neighbourId);
        const cost =
          (costSoFar.get(current.id) as number) + distance(here.position, neighbour.position);
        const known = costSoFar.get(neighbourId);
        if (known !== undefined && cost >= known) {
          continue;
        }
        costSoFar.set(neighbourId, cost);
        cameFrom.set(neighbourId, current.id);
        open.push({ id: neighbourId, estimate: cost + distance(neighbour.position, goal) });
      }
    }

    return [];
  }

  /** True when a route exists between the two nodes. */
  canReach(fromId: string, toId: string): boolean {
    return this.findPath(fromId, toId).length > 0;
  }

  private rebuildPath(cameFrom: Map<string, string>, toId: string): Point[] {
    const ids = [toId];
    let current = toId;
    while (cameFrom.has(current)) {
      current = cameFrom.get(current) as string;
      ids.push(current);
    }
    ids.reverse();
    return ids.map((id) => ({ ...this.node(id).position }));
  }
}

function positionKey(point: Point): string {
  const round = (value: number): number => Math.round(value / NODE_MERGE_TOLERANCE);
  return `${round(point.x)},${round(point.z)}`;
}

/** Points along a street's own axis: the ends, the junctions, and a regular spacing. */
function stopsAlong(street: Street, spacing: number, extra: readonly number[]): number[] {
  const stops = new Set<number>([street.from, street.to, ...extra]);
  const steps = Math.max(1, Math.round((street.to - street.from) / spacing));
  for (let index = 0; index <= steps; index += 1) {
    stops.add(street.from + (index / steps) * (street.to - street.from));
  }
  return [...stops]
    .filter((value) => value >= street.from && value <= street.to)
    .sort((a, b) => a - b);
}

/** The pavement graph, including a crossing at every junction. */
export function buildSidewalkGraph(): NavGraph {
  const graph = new NavGraph();
  const crossings = junctions();

  for (const street of STREETS) {
    for (const side of [-1, 1] as const) {
      const lateral = street.at + side * SIDEWALK_OFFSET;

      // Junctions on this street also put a node on the corner, offset along
      // the street, so the two pavements share the same corner node.
      const corners = crossings
        .filter((junction) => (street.axis === 'x' ? junction.z : junction.x) === street.at)
        .flatMap((junction) => {
          const alongJunction = street.axis === 'x' ? junction.x : junction.z;
          return [alongJunction - SIDEWALK_OFFSET, alongJunction + SIDEWALK_OFFSET];
        });

      const stops = stopsAlong(street, SIDEWALK_NODE_SPACING, corners);
      let previous: NavNode | undefined;
      for (const along of stops) {
        const position = street.axis === 'x' ? { x: along, z: lateral } : { x: lateral, z: along };
        const node = graph.addNode(position, `walk-${street.id}-${side}-${along.toFixed(1)}`);
        if (previous) {
          graph.connect(previous, node);
        }
        previous = node;
      }
    }
  }

  // The four corners of every junction form a square: walking round it goes
  // along the pavement, walking across it is a crossing.
  for (const junction of crossings) {
    const corners = [
      { x: junction.x - SIDEWALK_OFFSET, z: junction.z - SIDEWALK_OFFSET },
      { x: junction.x + SIDEWALK_OFFSET, z: junction.z - SIDEWALK_OFFSET },
      { x: junction.x + SIDEWALK_OFFSET, z: junction.z + SIDEWALK_OFFSET },
      { x: junction.x - SIDEWALK_OFFSET, z: junction.z + SIDEWALK_OFFSET },
    ].map((position, index) =>
      graph.addNode(position, `cross-${junction.x}-${junction.z}-${index}`),
    );

    for (let index = 0; index < corners.length; index += 1) {
      graph.connect(corners[index], corners[(index + 1) % corners.length]);
    }
  }

  // Every building gets a door node joined to the pavement it faces.
  for (const building of BUILDINGS) {
    const door = doorPosition(building);
    const node = graph.addNode(door, entranceNodeId(building.id));
    graph.connect(node, graph.nearestNode(door, node.id));
  }

  return graph;
}

export function entranceNodeId(buildingId: string): string {
  return `door-${buildingId}`;
}

export function parkingNodeId(index: number): string {
  return `parking-${index}`;
}

export function kerbNodeId(buildingId: string, index: number): string {
  return `kerb-${buildingId}-${index}`;
}

/** Spacing of kerb spaces along the road, a car length and a bit. */
const KERB_SPACE_SPACING = 5.6;

/** How far in from the centreline a kerb space sits: on the near side, by the pavement. */
const KERB_INSET = ROAD_WIDTH / 2 - 1.1;

/**
 * The parking nodes a trip to a place may end at, nearest first by index.
 * The supermarket has its car park; every other building a few kerb spaces;
 * a zone borrows its building's.
 */
export function parkingNodesForPlace(place: Place): string[] {
  const buildingId = place.kind === 'zone' ? getZone(place.id).buildingId : place.id;
  if (buildingId === 'supermarket') {
    return PARKING_LOT.spaces.map((_, index) => parkingNodeId(index));
  }
  return Array.from({ length: kerbSpaceCount(buildingId) }, (_, index) =>
    kerbNodeId(buildingId, index),
  );
}

/** The street a door is closest to, and the door's projection onto its centreline. */
function nearestStreet(point: Point): { street: Street; onCentreline: Point } {
  let best: { street: Street; onCentreline: Point; away: number } | undefined;
  for (const street of STREETS) {
    const from =
      street.axis === 'x' ? { x: street.from, z: street.at } : { x: street.at, z: street.from };
    const to =
      street.axis === 'x' ? { x: street.to, z: street.at } : { x: street.at, z: street.to };
    const onCentreline = closestPointOnSegment(point, from, to);
    const away = distance(point, onCentreline);
    if (!best || away < best.away) {
      best = { street, onCentreline, away };
    }
  }
  if (!best) {
    throw new Error('No streets to park on');
  }
  return { street: best.street, onCentreline: best.onCentreline };
}

/** Adds the kerb spaces outside one building (or the park) as spur nodes. */
function addKerbSpaces(graph: NavGraph, id: string, front: Point): void {
  const { street, onCentreline } = nearestStreet(front);
  // Toward the building, then along the street from a little before the door.
  const towardX = Math.sign(front.x - onCentreline.x);
  const towardZ = Math.sign(front.z - onCentreline.z);
  const count = kerbSpaceCount(id);
  for (let index = 0; index < count; index += 1) {
    const along = (index - (count - 1) / 2) * KERB_SPACE_SPACING;
    const position =
      street.axis === 'x'
        ? { x: onCentreline.x + along, z: onCentreline.z + towardZ * KERB_INSET }
        : { x: onCentreline.x + towardX * KERB_INSET, z: onCentreline.z + along };
    const node = graph.addNode(position, kerbNodeId(id, index));
    graph.connect(node, graph.nearestNode(position, node.id));
  }
}

/** The road graph, which vehicles will use from Phase 4. */
export function buildRoadGraph(): NavGraph {
  const graph = new NavGraph();
  const crossings = junctions();

  for (const street of STREETS) {
    const corners = crossings
      .filter((junction) => (street.axis === 'x' ? junction.z : junction.x) === street.at)
      .map((junction) => (street.axis === 'x' ? junction.x : junction.z));

    const stops = stopsAlong(street, ROAD_NODE_SPACING, corners);
    let previous: NavNode | undefined;
    for (const along of stops) {
      const position =
        street.axis === 'x' ? { x: along, z: street.at } : { x: street.at, z: along };
      const node = graph.addNode(position, `road-${street.id}-${along.toFixed(1)}`);
      if (previous) {
        graph.connect(previous, node);
      }
      previous = node;
    }
  }

  // The car park hangs off the road network by its entrance.
  const entrance = graph.addNode(PARKING_LOT.entrance, 'parking-entrance');
  graph.connect(entrance, graph.nearestNode(PARKING_LOT.entrance, entrance.id));

  PARKING_LOT.spaces.forEach((space, index) => {
    const node = graph.addNode(space, parkingNodeId(index));
    graph.connect(node, entrance);
  });

  // Kerb spaces outside every building but the supermarket, and by the park.
  for (const building of BUILDINGS) {
    if (building.id !== 'supermarket') {
      addKerbSpaces(graph, building.id, doorPosition(building));
    }
  }
  addKerbSpaces(graph, 'park', PARK_FRONT);

  return graph;
}

import {
  BufferGeometry,
  Group,
  LineBasicMaterial,
  LineSegments,
  Vector3,
  type ColorRepresentation,
} from 'three';

import type { Point } from '../entities/geometry.js';
import type { NavGraph } from '../simulation/Navigation.js';
import type { World } from '../simulation/World.js';
import { groundHeight } from '../world/Terrain.js';

/** Height the overlay floats at, so it reads clearly above the town. */
const OVERLAY_HEIGHT = 1.4;
const PATH_HEIGHT = 2.2;

/**
 * The `?debug` overlay (SPEC.md 3.5): the two navigation graphs and the route
 * each citizen is walking, drawn as lines over the town.
 *
 * It is only built when the flag is on, so the release build never pays for it.
 */
export class DebugView {
  readonly root = new Group();

  private readonly paths: LineSegments;
  private readonly pathMaterial: LineBasicMaterial;

  constructor(world: World) {
    this.root.name = 'debug';

    this.root.add(graphLines(world.sidewalks, 0x4ad0ff, OVERLAY_HEIGHT));
    this.root.add(graphLines(world.roads, 0xffb347, OVERLAY_HEIGHT + 0.05));

    this.pathMaterial = new LineBasicMaterial({
      color: 0xff2d55,
      depthTest: false,
      toneMapped: false,
    });
    this.paths = new LineSegments(new BufferGeometry(), this.pathMaterial);
    this.paths.renderOrder = 2;
    this.root.add(this.paths);
  }

  /** Redraws the citizens' current routes. */
  update(world: World): void {
    const points: Vector3[] = [];

    for (const citizen of world.citizens) {
      for (let index = 1; index < citizen.path.length; index += 1) {
        points.push(toVector(citizen.path[index - 1], PATH_HEIGHT));
        points.push(toVector(citizen.path[index], PATH_HEIGHT));
      }
    }

    this.paths.geometry.dispose();
    this.paths.geometry = new BufferGeometry().setFromPoints(points);
  }

  dispose(): void {
    this.paths.geometry.dispose();
    this.pathMaterial.dispose();
  }
}

function graphLines(graph: NavGraph, color: ColorRepresentation, height: number): LineSegments {
  const points: Vector3[] = [];
  for (const [from, to] of graph.edgeList()) {
    points.push(toVector(from, height));
    points.push(toVector(to, height));
  }

  // Drawn over everything: an overlay hidden behind a roof is no use.
  const lines = new LineSegments(
    new BufferGeometry().setFromPoints(points),
    new LineBasicMaterial({ color, depthTest: false, toneMapped: false }),
  );
  lines.renderOrder = 1;
  return lines;
}

function toVector(point: Point, height: number): Vector3 {
  return new Vector3(point.x, groundHeight(point.x, point.z) + height, point.z);
}

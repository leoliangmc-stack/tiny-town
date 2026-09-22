import { closestPointOnSegment, distance, type Point } from '../entities/geometry.js';
import { sampleSidewalkLoop } from '../world/Town.js';

/**
 * Walking routes along the pavement loop.
 *
 * Phase 1 has one loop and two destinations, so a route is simply: leave the
 * door, join the loop, follow it the short way round, leave it again at the
 * destination. The real navigation graph with A* arrives in Phase 2.
 */
export class SidewalkLoop {
  private readonly points: Point[];
  /** Distance along the loop at each point, with the total in the last slot. */
  private readonly cumulativeLength: number[];
  private readonly totalLength: number;

  constructor(points: Point[] = sampleSidewalkLoop()) {
    this.points = points;

    this.cumulativeLength = [0];
    for (let i = 1; i < points.length; i += 1) {
      this.cumulativeLength.push(this.cumulativeLength[i - 1] + distance(points[i - 1], points[i]));
    }
    const closingEdge = distance(points[points.length - 1], points[0]);
    this.totalLength = this.cumulativeLength[points.length - 1] + closingEdge;
  }

  get loopPoints(): readonly Point[] {
    return this.points;
  }

  /** Index of the loop point closest to the given position. */
  nearestIndex(point: Point): number {
    let best = 0;
    let bestDistance = Infinity;
    for (let i = 0; i < this.points.length; i += 1) {
      const candidate = distance(point, this.points[i]);
      if (candidate < bestDistance) {
        bestDistance = candidate;
        best = i;
      }
    }
    return best;
  }

  /** How far the given position is from the loop, measured to the nearest edge. */
  distanceToLoop(point: Point): number {
    let best = Infinity;
    for (let i = 0; i < this.points.length; i += 1) {
      const from = this.points[i];
      const to = this.points[(i + 1) % this.points.length];
      best = Math.min(best, distance(point, closestPointOnSegment(point, from, to)));
    }
    return best;
  }

  /** Loop points from `fromIndex` to `toIndex`, taking the shorter way round. */
  private walkAround(fromIndex: number, toIndex: number): Point[] {
    const forward =
      (this.cumulativeLength[toIndex] - this.cumulativeLength[fromIndex] + this.totalLength) %
      this.totalLength;
    const goForward = forward <= this.totalLength - forward;
    const step = goForward ? 1 : -1;

    const walked: Point[] = [];
    let index = fromIndex;
    while (index !== toIndex) {
      walked.push(this.points[index]);
      index = (index + step + this.points.length) % this.points.length;
    }
    walked.push(this.points[toIndex]);
    return walked;
  }

  /**
   * A door to door route: out to the loop, round it, and back off it again.
   */
  route(from: Point, to: Point): Point[] {
    const fromIndex = this.nearestIndex(from);
    const toIndex = this.nearestIndex(to);
    return [from, ...this.walkAround(fromIndex, toIndex), to];
  }
}

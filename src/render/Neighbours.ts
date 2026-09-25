import {
  AdditiveBlending,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  Group,
  InstancedMesh,
  type Material,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
  Points,
  PointsMaterial,
  SphereGeometry,
} from 'three';

import type { Point } from '../entities/geometry.js';
import { Rng } from '../simulation/Rng.js';
import {
  BREAKWATERS,
  COUNTRY_ROAD_WIDTH,
  distanceToCountryRoads,
  ISLAND,
  islandHeight,
  type Neighbour,
  NEIGHBOURS,
} from '../world/Countryside.js';
import { BEACH_DEPTH, coastZ, groundHeight } from '../world/Terrain.js';

import type { EnvironmentState } from './Environment.js';
import { glowTexture } from './glow.js';

/**
 * The neighbouring villages (SPEC.md 2.14, decision 44): a fishing village on
 * the coast to the east, a hill village inland, and a village on an island
 * across the bay. They say the town is one place among others.
 *
 * They are read, not studied (DESIGN.md §20): white cubes, a few blue domes
 * and a bell tower each, seen through the haze. After dark a scatter of warm
 * windows lights up with the street lamps; most go out late in the evening, a
 * few burn till dawn, and on Mid-Autumn night every one is lit. No citizen
 * lives there and nothing here reaches the simulation. Five draw calls: walls,
 * domes, the island, the breakwaters and the lights.
 */

const WHITE = 0xf5f2ea;
const WARM_WALLS = [0xead9b8, 0xefd3cb, 0xf1e4b0];
const DOME = 0x2f5f9e;
const STONE = 0xd8d2c4;
const SAND = 0xe6d6b4;
const SCRUB = 0xa9a070;
const ISLAND_GREEN = 0x7d9e5f;
const WINDOW = new Color(0xffd08a);

/** How bright a neighbour's window is next to one in the town: always fainter. */
const WINDOW_STRENGTH = 1;
/** The glow of one window, in metres; it shrinks with distance like everything else. */
const WINDOW_GLOW = 11;

/** One house of a neighbouring village. */
export interface NeighbourHouse {
  village: string;
  x: number;
  z: number;
  /** Ground height under the house. */
  ground: number;
  width: number;
  depth: number;
  height: number;
  rotationY: number;
  /** A smaller storey set back on top, as in the town (DESIGN.md §4). */
  upper: boolean;
  dome: boolean;
  tower: boolean;
  color: number;
}

/** One lit window, with the evening it keeps. All minutes are counted from the previous noon. */
interface VillageWindow {
  x: number;
  y: number;
  z: number;
  /** When it lights up after dusk, and when it goes out for the night. */
  on: number;
  off: number;
  /** An early riser's window, lit before dawn until the day is up; Infinity if none. */
  morning: number;
}

/** Minutes from the previous noon, so an evening and the night after it count upwards. */
function fromNoon(minuteOfDay: number): number {
  return minuteOfDay < 12 * 60 ? minuteOfDay + 24 * 60 : minuteOfDay;
}

/** The height of the land a neighbour stands on at a point. */
function landHeight(village: Neighbour, x: number, z: number): number {
  return village.kind === 'island' ? islandHeight(x, z) : groundHeight(x, z);
}

/** Whether a house of this size may stand at this point in this village. */
function buildable(village: Neighbour, x: number, z: number, size: number): boolean {
  if (village.kind === 'island') {
    return islandHeight(x, z) > 2.5;
  }
  const clearOfRoad = distanceToCountryRoads({ x, z }) > COUNTRY_ROAD_WIDTH / 2 + size / 2 + 1;
  const clearOfBeach = z > coastZ(x) + BEACH_DEPTH + 3 + size / 2;
  return clearOfRoad && clearOfBeach;
}

/**
 * Lays out every neighbour's houses. Pure and seeded, so the villages are the
 * same on every visit, and tests can check where they stand.
 */
export function neighbourHouses(): NeighbourHouse[] {
  const houses: NeighbourHouse[] = [];
  for (const village of NEIGHBOURS) {
    const rng = new Rng(`neighbour:${village.id}`);
    const placed: NeighbourHouse[] = [];
    // The houses turn to face the town, give or take, as the town's face the sea.
    const facing = Math.atan2(-village.centre.x, -village.centre.z);

    // The bell tower first, near the middle of the village.
    for (let attempt = 0; attempt < 200 && placed.length === 0; attempt += 1) {
      const x = village.centre.x + rng.nextFloat(-6, 6);
      const z = village.centre.z + rng.nextFloat(-6, 6);
      if (buildable(village, x, z, 4)) {
        placed.push({
          village: village.id,
          x,
          z,
          ground: landHeight(village, x, z),
          width: 3.4,
          depth: 3.4,
          height: 12,
          rotationY: facing,
          upper: false,
          dome: true,
          tower: true,
          color: WHITE,
        });
      }
    }

    for (let attempt = 0; attempt < 2000 && placed.length < village.houses; attempt += 1) {
      // Denser near the middle, thinning out towards the edge.
      const angle = rng.nextFloat(0, Math.PI * 2);
      const reach = village.radius * Math.sqrt(rng.next());
      const x = village.centre.x + Math.cos(angle) * reach;
      const z = village.centre.z + Math.sin(angle) * reach;
      const width = rng.nextFloat(5, 8);
      const depth = rng.nextFloat(5, 7.5);
      const size = Math.max(width, depth);
      const crowded = placed.some(
        (other) =>
          Math.hypot(other.x - x, other.z - z) <
          (size + Math.max(other.width, other.depth)) / 2 + 1.6,
      );
      if (crowded || !buildable(village, x, z, size)) {
        continue;
      }
      placed.push({
        village: village.id,
        x,
        z,
        ground: landHeight(village, x, z),
        width,
        depth,
        height: rng.nextFloat(3.6, 5.2),
        rotationY: facing + rng.nextFloat(-0.3, 0.3),
        upper: rng.next() < 0.4,
        dome: rng.next() < 0.14,
        tower: false,
        color: rng.next() < 0.8 ? WHITE : WARM_WALLS[rng.nextInt(0, WARM_WALLS.length - 1)],
      });
    }
    houses.push(...placed);
  }
  return houses;
}

export class Neighbours {
  readonly root = new Group();

  readonly houses: NeighbourHouse[] = neighbourHouses();
  private readonly windows: VillageWindow[] = [];
  private readonly lights: Points;
  private readonly lightColors: BufferAttribute;

  constructor() {
    this.root.name = 'neighbours';
    this.addHouses();
    this.addIsland();
    this.addBreakwaters();

    const rng = new Rng('neighbour:windows');
    const positions: number[] = [];
    for (const house of this.houses) {
      // One window on the face turned to the town, two on a house with an upper storey.
      const storeys = house.upper ? [1.8, house.height + 1.6] : [1.8];
      for (const [storey, height] of storeys.entries()) {
        const across = rng.nextFloat(-0.3, 0.3) * house.width;
        // The upper storey is set back: its face is 0.075 of the depth ahead of the middle.
        const out = (storey === 1 ? house.depth * 0.075 : house.depth / 2) + 0.2;
        const sin = Math.sin(house.rotationY);
        const cos = Math.cos(house.rotationY);
        const window: VillageWindow = {
          x: house.x + sin * out + cos * across,
          y: house.ground + (house.tower ? house.height * 0.7 : height),
          z: house.z + cos * out - sin * across,
          on: rng.nextFloat(17.5, 19.5) * 60,
          off:
            rng.next() < 0.12
              ? fromNoon(6.5 * 60)
              : fromNoon((rng.nextFloat(22, 25.5) * 60) % (24 * 60)),
          morning: rng.next() < 0.3 ? fromNoon(rng.nextFloat(5, 6.5) * 60) : Infinity,
        };
        this.windows.push(window);
        positions.push(window.x, window.y, window.z);
      }
    }

    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
    this.lightColors = new BufferAttribute(new Float32Array(positions.length), 3);
    geometry.setAttribute('color', this.lightColors);
    this.lights = new Points(
      geometry,
      new PointsMaterial({
        map: glowTexture(),
        size: WINDOW_GLOW,
        sizeAttenuation: true,
        vertexColors: true,
        blending: AdditiveBlending,
        transparent: true,
        depthWrite: false,
        // Lights across water carry further than the haze would let them.
        fog: false,
      }),
    );
    this.lights.name = 'neighbour-windows';
    this.lights.frustumCulled = false;
    this.lights.renderOrder = 2;
    this.root.add(this.lights);
  }

  /** How many windows are lit at a shown minute of the day, for tests. */
  litWindows(minuteOfDay: number, festival: boolean): number {
    return this.windows.filter((window) => isLit(window, minuteOfDay, festival)).length;
  }

  get windowCount(): number {
    return this.windows.length;
  }

  /**
   * Lights the windows for the hour the picture shows. They follow the street
   * lamps in and out of the dark, so none glows by day.
   */
  update(environment: EnvironmentState, minuteOfDay: number, festival: boolean): void {
    const strength = environment.lampFactor * WINDOW_STRENGTH;
    this.windows.forEach((window, index) => {
      const lit = strength > 0 && isLit(window, minuteOfDay, festival) ? strength : 0;
      this.lightColors.setXYZ(index, WINDOW.r * lit, WINDOW.g * lit, WINDOW.b * lit);
    });
    this.lightColors.needsUpdate = true;
  }

  private addHouses(): void {
    const walls = new InstancedMesh(
      new BoxGeometry(1, 1, 1).translate(0, 0.5, 0),
      new MeshStandardMaterial({ roughness: 0.95, metalness: 0 }),
      this.houses.length * 2,
    );
    const domes = new InstancedMesh(
      new SphereGeometry(1, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2),
      new MeshStandardMaterial({ color: DOME, roughness: 0.7, metalness: 0 }),
      this.houses.filter((house) => house.dome).length,
    );
    const placement = new Object3D();
    let wall = 0;
    let dome = 0;
    // Walls reach a little below the ground so a house on a slope has no gap under it.
    const sink = 1.5;
    for (const house of this.houses) {
      placement.rotation.set(0, house.rotationY, 0);
      placement.position.set(house.x, house.ground - sink, house.z);
      placement.scale.set(house.width, house.height + sink, house.depth);
      placement.updateMatrix();
      walls.setMatrixAt(wall, placement.matrix);
      walls.setColorAt(wall, new Color(house.color));
      wall += 1;
      let top = house.ground + house.height;
      let roofWidth = house.width;
      if (house.upper) {
        // Set back towards the rear, leaving a roof terrace at the front.
        const back = house.depth * 0.2;
        placement.position.set(
          house.x - Math.sin(house.rotationY) * back,
          top,
          house.z - Math.cos(house.rotationY) * back,
        );
        placement.scale.set(house.width * 0.6, house.height * 0.72, house.depth * 0.55);
        placement.updateMatrix();
        walls.setMatrixAt(wall, placement.matrix);
        walls.setColorAt(wall, new Color(house.color));
        wall += 1;
        top += house.height * 0.72;
        roofWidth = house.width * 0.6;
      }
      if (house.dome) {
        const radius = (house.tower ? house.width : roofWidth) * 0.42;
        placement.position.set(
          house.upper ? placement.position.x : house.x,
          top,
          house.upper ? placement.position.z : house.z,
        );
        placement.scale.set(radius, radius * 1.1, radius);
        placement.updateMatrix();
        domes.setMatrixAt(dome, placement.matrix);
        dome += 1;
      }
    }
    walls.count = wall;
    for (const mesh of [walls, domes]) {
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) {
        mesh.instanceColor.needsUpdate = true;
      }
      mesh.name = 'neighbour-houses';
      this.root.add(mesh);
    }
  }

  /** The island: a heightfield on its own patch of sea, sand at the water, scrub and green above. */
  private addIsland(): void {
    const width = ISLAND.radiusX * 2 + 8;
    const depth = ISLAND.radiusZ * 2 + 8;
    const geometry = new PlaneGeometry(width, depth, 64, 40);
    geometry.applyMatrix4(new Matrix4().makeRotationX(-Math.PI / 2));
    geometry.translate(ISLAND.centre.x, 0, ISLAND.centre.z);
    const positions = geometry.getAttribute('position');
    const colors = new Float32Array(positions.count * 3);
    const sand = new Color(SAND);
    const scrub = new Color(SCRUB);
    const green = new Color(ISLAND_GREEN);
    const blend = new Color();
    for (let index = 0; index < positions.count; index += 1) {
      const height = islandHeight(positions.getX(index), positions.getZ(index));
      positions.setY(index, Math.max(-1.5, height));
      if (height < 1.4) {
        blend.copy(sand);
      } else {
        const t = Math.min(1, (height - 1.4) / (ISLAND.height * 0.7));
        blend.copy(scrub).lerp(green, t);
      }
      colors[index * 3] = blend.r;
      colors[index * 3 + 1] = blend.g;
      colors[index * 3 + 2] = blend.b;
    }
    positions.needsUpdate = true;
    geometry.setAttribute('color', new BufferAttribute(colors, 3));
    geometry.computeVertexNormals();
    const mesh = new Mesh(
      geometry,
      new MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 }),
    );
    mesh.name = 'island';
    this.root.add(mesh);
  }

  /** Piled stone arms that make the harbours the boats come and go from. */
  private addBreakwaters(): void {
    const mesh = new InstancedMesh(
      new BoxGeometry(1, 1, 1),
      new MeshStandardMaterial({ color: STONE, roughness: 1, metalness: 0 }),
      BREAKWATERS.length,
    );
    const placement = new Object3D();
    BREAKWATERS.forEach((arm, index) => {
      const mid: Point = { x: (arm.from.x + arm.to.x) / 2, z: (arm.from.z + arm.to.z) / 2 };
      const length = Math.hypot(arm.to.x - arm.from.x, arm.to.z - arm.from.z) + 2.2;
      placement.position.set(mid.x, 0.2, mid.z);
      placement.rotation.set(0, Math.atan2(arm.to.x - arm.from.x, arm.to.z - arm.from.z), 0);
      placement.scale.set(2.2, 2.4, length);
      placement.updateMatrix();
      mesh.setMatrixAt(index, placement.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.name = 'breakwaters';
    this.root.add(mesh);
  }

  dispose(): void {
    for (const child of this.root.children) {
      if (child instanceof Mesh || child instanceof Points) {
        child.geometry.dispose();
        (child.material as Material).dispose();
      }
    }
  }
}

/** Whether a window is lit at a minute of the day, if it is dark enough for windows at all. */
function isLit(window: VillageWindow, minuteOfDay: number, festival: boolean): boolean {
  if (festival) {
    return true;
  }
  const now = fromNoon(minuteOfDay);
  const evening = now >= window.on && now < window.off;
  const morning = now >= window.morning && now < fromNoon(8 * 60);
  return evening || morning;
}

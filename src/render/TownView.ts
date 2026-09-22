import {
  AdditiveBlending,
  BoxGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  ExtrudeGeometry,
  Group,
  IcosahedronGeometry,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
  Shape,
  SphereGeometry,
  type Sprite,
} from 'three';

import type { Building } from '../entities/Building.js';
import { Rng } from '../simulation/Rng.js';
import type { World } from '../simulation/World.js';
import {
  BUILDINGS,
  GROUND_SIZE,
  OUTDOOR_ZONES,
  PARKING_LOT,
  ROAD_WIDTH,
  SIDEWALK_EDGE,
  STREETS,
  STREET_LAMP_HEIGHT,
  STREET_SIGNS,
  TREES,
  type OutdoorZone,
  type Street,
  junctions,
  streetLampPositions,
} from '../world/Town.js';

import type { EnvironmentState } from './Environment.js';
import { createGlowSprite, glowTexture } from './glow.js';

/** How fast a window or lamp fades between off and on, in real seconds. */
const LIGHT_FADE_SECONDS = 0.7;

const WINDOW_EMISSIVE = 0xffb455;
const LAMP_EMISSIVE = 0xffb964;

/** Heights everything flat is stacked at, so nothing z-fights with the ground. */
const LAYER_ROAD = 0.02;
const LAYER_ZONE = 0.05;
const LAYER_MARKING = 0.08;
const LAYER_SIDEWALK_TOP = 0.16;

const WALL_COLORS = [0xd9d2c4, 0xc9b9a6, 0xe0d5c0, 0xcfc3b4, 0xd6c8b2, 0xbfb3a4, 0xd2c6b6];
const ROOF_COLORS = [0x8c5b4a, 0x7a4f42, 0x96604c, 0x6f4a44, 0x8a5949, 0x7f5346];

const ZONE_COLORS: Record<OutdoorZone['kind'], number> = {
  terrace: 0xb09c82,
  playground: 0xa8705a,
  forecourt: 0x9e9a90,
  lawn: 0x6f9152,
};

/** One building's meshes, plus the materials whose glow is animated. */
interface BuildingView {
  building: Building;
  windowMaterial: MeshStandardMaterial;
  windowGlows: Sprite[];
  /** Current lit amount, eased towards the target so lights fade in. */
  lit: number;
}

/**
 * Everything standing still in the town: ground, roads, pavements, buildings,
 * outdoor zones, the park, the car park, trees, lamps and signs.
 *
 * The geometry is built once from the layout data in world/Town.ts. Each frame
 * only the lights change.
 */
export class TownView {
  readonly root = new Group();

  private readonly buildingViews: BuildingView[] = [];
  private readonly lampMaterial: MeshStandardMaterial;
  private readonly lampPoolMaterial: MeshBasicMaterial;
  private readonly lampGlowSprites: Sprite[] = [];
  private lampLit = 0;

  constructor() {
    this.root.name = 'town';

    this.lampMaterial = new MeshStandardMaterial({
      color: 0x2c2c33,
      emissive: new Color(LAMP_EMISSIVE),
      emissiveIntensity: 0,
      roughness: 0.6,
    });
    this.lampPoolMaterial = new MeshBasicMaterial({
      map: glowTexture(),
      color: new Color(LAMP_EMISSIVE),
      blending: AdditiveBlending,
      transparent: true,
      depthWrite: false,
      opacity: 0,
    });

    this.addGround();
    this.addStreets();
    this.addOutdoorZones();
    this.addParkingLot();

    for (const building of BUILDINGS) {
      this.addBuilding(building);
    }

    this.addTrees();
    this.addStreetLamps();
    this.addStreetSigns();
  }

  private addGround(): void {
    const ground = new Mesh(
      new PlaneGeometry(GROUND_SIZE, GROUND_SIZE),
      new MeshStandardMaterial({ color: 0x6d8c55, roughness: 1 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    ground.name = 'ground';
    this.root.add(ground);
  }

  /** Tarmac and kerbs for every street, plus a dashed line down the middle. */
  private addStreets(): void {
    const roadMaterial = new MeshStandardMaterial({ color: 0x3b3c44, roughness: 0.95 });
    const kerbMaterial = new MeshStandardMaterial({ color: 0x9d998d, roughness: 0.9 });
    const markingMaterial = new MeshStandardMaterial({ color: 0xc9c4b4, roughness: 0.9 });

    for (const street of STREETS) {
      const length = street.to - street.from;

      const road = new Mesh(slab(length, ROAD_WIDTH, street.axis), roadMaterial);
      road.position.set(...slabPosition(street, 0, LAYER_ROAD));
      road.receiveShadow = true;
      this.root.add(road);

      for (const side of [-1, 1] as const) {
        const kerb = new Mesh(
          slab(length, SIDEWALK_EDGE - ROAD_WIDTH / 2, street.axis),
          kerbMaterial,
        );
        const offset = side * (ROAD_WIDTH / 2 + (SIDEWALK_EDGE - ROAD_WIDTH / 2) / 2);
        kerb.position.set(...slabPosition(street, offset, LAYER_SIDEWALK_TOP));
        kerb.receiveShadow = true;
        this.root.add(kerb);
      }

      this.addCentreLine(street, markingMaterial);
    }

    // The junctions are plain tarmac, which also covers the kerb corners.
    for (const junction of junctions()) {
      const patch = new Mesh(slab(SIDEWALK_EDGE * 2, SIDEWALK_EDGE * 2, 'x'), roadMaterial);
      patch.position.set(junction.x, LAYER_ROAD + 0.01, junction.z);
      patch.receiveShadow = true;
      this.root.add(patch);
    }
  }

  private addCentreLine(street: Street, material: MeshStandardMaterial): void {
    const dashLength = 3;
    const gap = 4;
    const step = dashLength + gap;
    const count = Math.floor((street.to - street.from) / step);

    const dashes = new InstancedMesh(slab(dashLength, 0.3, street.axis), material, count);
    dashes.receiveShadow = true;
    const placement = new Object3D();

    for (let index = 0; index < count; index += 1) {
      const along = street.from + gap / 2 + index * step + dashLength / 2;
      placement.position.set(
        street.axis === 'x' ? along : street.at,
        LAYER_MARKING,
        street.axis === 'x' ? street.at : along,
      );
      placement.updateMatrix();
      dashes.setMatrixAt(index, placement.matrix);
    }
    dashes.instanceMatrix.needsUpdate = true;
    this.root.add(dashes);
  }

  /** The patches of ground outside the public buildings, and the park lawn. */
  private addOutdoorZones(): void {
    for (const zone of OUTDOOR_ZONES) {
      const patch = new Mesh(
        new PlaneGeometry(zone.maxX - zone.minX, zone.maxZ - zone.minZ),
        new MeshStandardMaterial({ color: ZONE_COLORS[zone.kind], roughness: 1 }),
      );
      patch.rotation.x = -Math.PI / 2;
      patch.position.set(
        (zone.minX + zone.maxX) / 2,
        zone.kind === 'lawn' ? LAYER_ZONE - 0.01 : LAYER_ZONE,
        (zone.minZ + zone.maxZ) / 2,
      );
      patch.receiveShadow = true;
      this.root.add(patch);

      if (zone.kind === 'terrace') {
        this.addTerraceTables(zone);
      }
      if (zone.kind === 'playground') {
        this.addPlaygroundFrame(zone);
      }
      if (zone.kind === 'lawn') {
        this.addParkPathAndBenches(zone);
      }
    }
  }

  private addTerraceTables(zone: OutdoorZone): void {
    const material = new MeshStandardMaterial({ color: 0x6f6152, roughness: 0.9 });
    for (const spawn of zone.spawnPoints) {
      const table = new Mesh(new CylinderGeometry(0.5, 0.45, 0.72, 8), material);
      table.position.set(spawn.x + 0.9, 0.36, spawn.z);
      table.castShadow = true;
      this.root.add(table);
    }
  }

  /** A climbing frame, so the schoolyard reads as a schoolyard from above. */
  private addPlaygroundFrame(zone: OutdoorZone): void {
    const material = new MeshStandardMaterial({ color: 0x4f7fa8, roughness: 0.7 });
    const centreX = (zone.minX + zone.maxX) / 2;
    const centreZ = (zone.minZ + zone.maxZ) / 2;

    for (const offset of [-2.2, 2.2]) {
      const post = new Mesh(new BoxGeometry(0.22, 2.4, 0.22), material);
      post.position.set(centreX + offset, 1.2, centreZ);
      post.castShadow = true;
      this.root.add(post);
    }
    const bar = new Mesh(new BoxGeometry(4.8, 0.22, 0.22), material);
    bar.position.set(centreX, 2.4, centreZ);
    bar.castShadow = true;
    this.root.add(bar);
  }

  /** A path across the park and a few benches. */
  private addParkPathAndBenches(zone: OutdoorZone): void {
    const pathMaterial = new MeshStandardMaterial({ color: 0xbaa88c, roughness: 1 });
    const centreZ = (zone.minZ + zone.maxZ) / 2;

    const path = new Mesh(new PlaneGeometry(zone.maxX - zone.minX, 2.6), pathMaterial);
    path.rotation.x = -Math.PI / 2;
    path.position.set((zone.minX + zone.maxX) / 2, LAYER_ZONE, centreZ);
    path.receiveShadow = true;
    this.root.add(path);

    const benchMaterial = new MeshStandardMaterial({ color: 0x6b5340, roughness: 0.9 });
    for (const offset of [-7, 0, 7]) {
      const bench = new Mesh(new BoxGeometry(2.2, 0.45, 0.7), benchMaterial);
      bench.position.set((zone.minX + zone.maxX) / 2 + offset, 0.35, centreZ - 2.4);
      bench.castShadow = true;
      this.root.add(bench);
    }
  }

  /** Tarmac and painted bays for the car park at the east end. */
  private addParkingLot(): void {
    const surface = new Mesh(
      new PlaneGeometry(PARKING_LOT.maxX - PARKING_LOT.minX, PARKING_LOT.maxZ - PARKING_LOT.minZ),
      new MeshStandardMaterial({ color: 0x3f4048, roughness: 0.95 }),
    );
    surface.rotation.x = -Math.PI / 2;
    surface.position.set(
      (PARKING_LOT.minX + PARKING_LOT.maxX) / 2,
      LAYER_ROAD,
      (PARKING_LOT.minZ + PARKING_LOT.maxZ) / 2,
    );
    surface.receiveShadow = true;
    this.root.add(surface);

    const lineMaterial = new MeshStandardMaterial({ color: 0xc9c4b4, roughness: 0.9 });
    for (const space of PARKING_LOT.spaces) {
      const line = new Mesh(new PlaneGeometry(4.6, 0.22), lineMaterial);
      line.rotation.x = -Math.PI / 2;
      line.position.set(space.x, LAYER_MARKING, space.z - 2.3);
      this.root.add(line);
    }

    // A short apron joining the lot to the road it hangs off.
    const apron = new Mesh(
      new PlaneGeometry(6, 5),
      new MeshStandardMaterial({ color: 0x3f4048, roughness: 0.95 }),
    );
    apron.rotation.x = -Math.PI / 2;
    apron.position.set(PARKING_LOT.entrance.x, LAYER_ROAD, PARKING_LOT.entrance.z + 3);
    apron.receiveShadow = true;
    this.root.add(apron);
  }

  private addBuilding(building: Building): void {
    const group = new Group();
    group.position.set(building.position.x, 0, building.position.z);
    group.rotation.y = building.rotationY;
    group.name = building.id;

    const index = BUILDINGS.indexOf(building);
    const walls = new Mesh(
      new BoxGeometry(building.width, building.wallHeight, building.depth),
      new MeshStandardMaterial({
        color: wallColor(building, index),
        roughness: 0.85,
      }),
    );
    walls.position.y = building.wallHeight / 2;
    walls.castShadow = true;
    walls.receiveShadow = true;
    group.add(walls);

    group.add(
      building.roofHeight > 1.6
        ? gableRoof(building, ROOF_COLORS[index % ROOF_COLORS.length])
        : flatRoof(building),
    );

    const windowMaterial = new MeshStandardMaterial({
      color: 0x4a5769,
      emissive: new Color(WINDOW_EMISSIVE),
      emissiveIntensity: 0,
      roughness: 0.25,
      metalness: 0.1,
      side: DoubleSide,
    });

    const windowGlows: Sprite[] = [];
    for (const placement of windowPlacements(building)) {
      const pane = new Mesh(new PlaneGeometry(placement.width, placement.height), windowMaterial);
      pane.position.set(placement.x, placement.y, placement.z);
      pane.rotation.y = placement.rotationY;
      group.add(pane);

      const glow = createGlowSprite(WINDOW_EMISSIVE, Math.max(placement.width, 1.1) * 2.4);
      glow.position.set(
        placement.x + placement.normalX * 0.35,
        placement.y,
        placement.z + placement.normalZ * 0.35,
      );
      group.add(glow);
      windowGlows.push(glow);
    }

    this.addDoorAndTrim(group, building);

    this.root.add(group);
    this.buildingViews.push({ building, windowMaterial, windowGlows, lit: 0 });
  }

  /** A door on the front wall, plus whatever marks the building out. */
  private addDoorAndTrim(group: Group, building: Building): void {
    const doorHeight = 2.3;
    const door = new Mesh(
      new BoxGeometry(building.kind === 'house' ? 1.3 : 2.4, doorHeight, 0.2),
      new MeshStandardMaterial({ color: 0x4a382c, roughness: 0.8 }),
    );
    door.position.set(0, doorHeight / 2, building.depth / 2 + 0.06);
    group.add(door);

    if (building.kind === 'cafe' || building.kind === 'bakery') {
      const awning = new Mesh(
        new BoxGeometry(building.width * 0.72, 0.24, 2.4),
        new MeshStandardMaterial({
          color: building.kind === 'cafe' ? 0x9c4b3e : 0x4f7a5c,
          roughness: 0.8,
        }),
      );
      awning.position.set(0, doorHeight + 0.9, building.depth / 2 + 1);
      awning.castShadow = true;
      group.add(awning);
    }

    if (building.kind === 'school') {
      // A little bell tower, so the school is recognisable from above.
      const tower = new Mesh(
        new BoxGeometry(3, 3.4, 3),
        new MeshStandardMaterial({ color: 0xd8d0c0, roughness: 0.85 }),
      );
      tower.position.set(0, building.wallHeight + 1.7, 0);
      tower.castShadow = true;
      group.add(tower);

      const cap = new Mesh(
        new ConeGeometry(2.4, 2, 4),
        new MeshStandardMaterial({ color: 0x6f4a44, roughness: 0.9 }),
      );
      cap.position.set(0, building.wallHeight + 4.4, 0);
      cap.rotation.y = Math.PI / 4;
      cap.castShadow = true;
      group.add(cap);
    }

    if (building.kind === 'supermarket') {
      const sign = new Mesh(
        new BoxGeometry(building.width * 0.6, 1.3, 0.3),
        new MeshStandardMaterial({
          color: 0x2f5d3f,
          emissive: new Color(0x63c489),
          emissiveIntensity: 0.4,
          roughness: 0.6,
        }),
      );
      sign.position.set(0, building.wallHeight - 1.4, building.depth / 2 + 0.15);
      group.add(sign);
    }
  }

  private addTrees(): void {
    const rng = new Rng('trees');

    for (const tree of TREES) {
      const group = new Group();
      group.position.set(tree.position.x, 0, tree.position.z);
      group.rotation.y = rng.nextFloat(0, Math.PI * 2);

      const trunkHeight = tree.height * 0.42;
      const trunk = new Mesh(
        new CylinderGeometry(0.2, 0.32, trunkHeight, 6),
        new MeshStandardMaterial({ color: 0x5c4630, roughness: 1 }),
      );
      trunk.position.y = trunkHeight / 2;
      trunk.castShadow = true;
      group.add(trunk);

      const foliageColor = new Color(0x4f7a3a).offsetHSL(
        rng.nextFloat(-0.03, 0.03),
        rng.nextFloat(-0.08, 0.08),
        rng.nextFloat(-0.06, 0.06),
      );
      const foliageMaterial = new MeshStandardMaterial({
        color: foliageColor,
        roughness: 1,
        flatShading: true,
      });

      if (tree.shape === 'pine') {
        for (let layer = 0; layer < 3; layer += 1) {
          const radius = 2 - layer * 0.48;
          const height = tree.height * 0.42;
          const cone = new Mesh(new ConeGeometry(radius, height, 7), foliageMaterial);
          cone.position.y = trunkHeight + layer * (tree.height * 0.2) + height / 2;
          cone.castShadow = true;
          group.add(cone);
        }
      } else {
        const crownHeight = tree.height - trunkHeight;
        const crown = new Mesh(new IcosahedronGeometry(crownHeight * 0.62, 0), foliageMaterial);
        crown.position.y = trunkHeight + crownHeight * 0.5;
        crown.scale.set(1, 0.92, 1);
        crown.castShadow = true;
        group.add(crown);
      }

      this.root.add(group);
    }
  }

  private addStreetLamps(): void {
    const poleMaterial = new MeshStandardMaterial({ color: 0x2c2c33, roughness: 0.7 });

    for (const position of streetLampPositions()) {
      const group = new Group();
      group.position.set(position.x, 0, position.z);

      const pole = new Mesh(new CylinderGeometry(0.09, 0.13, STREET_LAMP_HEIGHT, 6), poleMaterial);
      pole.position.y = STREET_LAMP_HEIGHT / 2;
      pole.castShadow = true;
      group.add(pole);

      const head = new Mesh(new BoxGeometry(0.8, 0.22, 0.8), this.lampMaterial);
      head.position.y = STREET_LAMP_HEIGHT;
      group.add(head);

      const bulb = new Mesh(new SphereGeometry(0.24, 10, 8), this.lampMaterial);
      bulb.position.y = STREET_LAMP_HEIGHT - 0.24;
      group.add(bulb);

      const halo = createGlowSprite(LAMP_EMISSIVE, 3.2);
      halo.position.y = STREET_LAMP_HEIGHT - 0.24;
      group.add(halo);
      this.lampGlowSprites.push(halo);

      const pool = new Mesh(new PlaneGeometry(9, 9), this.lampPoolMaterial);
      pool.rotation.x = -Math.PI / 2;
      pool.position.y = 0.2;
      group.add(pool);

      this.root.add(group);
    }
  }

  private addStreetSigns(): void {
    const postMaterial = new MeshStandardMaterial({ color: 0x4a4a52, roughness: 0.8 });
    const plateMaterial = new MeshStandardMaterial({ color: 0xe6e1d4, roughness: 0.7 });

    for (const sign of STREET_SIGNS) {
      const group = new Group();
      group.position.set(sign.position.x, 0, sign.position.z);
      group.rotation.y = sign.rotationY;

      const post = new Mesh(new CylinderGeometry(0.07, 0.07, 2.6, 6), postMaterial);
      post.position.y = 1.3;
      post.castShadow = true;
      group.add(post);

      const plate = new Mesh(new BoxGeometry(2.2, 0.42, 0.08), plateMaterial);
      plate.position.y = 2.5;
      plate.castShadow = true;
      group.add(plate);

      this.root.add(group);
    }
  }

  /**
   * Eases every light towards where the simulation says it should be.
   *
   * `deltaSeconds` is real time, so lights take the same moment to warm up
   * whatever speed the town is running at.
   */
  update(world: World, environment: EnvironmentState, deltaSeconds: number): void {
    const ease = 1 - Math.exp(-deltaSeconds / LIGHT_FADE_SECONDS);

    for (const view of this.buildingViews) {
      const target = world.isLit(view.building.id) ? 1 : 0;
      view.lit += (target - view.lit) * ease;

      const shown = view.lit * environment.windowFactor;
      view.windowMaterial.emissiveIntensity = shown * 1.15;
      for (const glow of view.windowGlows) {
        glow.material.opacity = shown * 0.42;
      }
    }

    this.lampLit += (environment.lampFactor - this.lampLit) * ease;
    this.lampMaterial.emissiveIntensity = this.lampLit * 1.5;
    this.lampPoolMaterial.opacity = this.lampLit * 0.34;
    for (const sprite of this.lampGlowSprites) {
      sprite.material.opacity = this.lampLit * 0.38;
    }
  }
}

interface WindowPlacement {
  x: number;
  y: number;
  z: number;
  width: number;
  height: number;
  rotationY: number;
  normalX: number;
  normalZ: number;
}

/** Lays out windows in a grid on all four walls, in the building's local space. */
function windowPlacements(building: Building): WindowPlacement[] {
  const placements: WindowPlacement[] = [];
  const floorHeight = building.wallHeight / building.floors;
  const offset = 0.07;
  const shopFront = building.kind === 'supermarket' || building.kind === 'cafe';
  const width = shopFront ? 1.8 : 1.1;
  const height = shopFront ? 1.9 : 1.35;

  const facades = [
    { rotationY: 0, normalX: 0, normalZ: 1, span: building.width, depth: building.depth / 2 },
    {
      rotationY: Math.PI,
      normalX: 0,
      normalZ: -1,
      span: building.width,
      depth: building.depth / 2,
    },
    {
      rotationY: Math.PI / 2,
      normalX: 1,
      normalZ: 0,
      span: building.depth,
      depth: building.width / 2,
    },
    {
      rotationY: -Math.PI / 2,
      normalX: -1,
      normalZ: 0,
      span: building.depth,
      depth: building.width / 2,
    },
  ];

  for (const facade of facades) {
    const columns = Math.max(1, Math.min(5, Math.floor(facade.span / (width + 2.2))));
    for (let floor = 0; floor < building.floors; floor += 1) {
      const y = floorHeight * (floor + 0.55);
      for (let column = 0; column < columns; column += 1) {
        const along = ((column + 0.5) / columns - 0.5) * facade.span * 0.84;
        // The ground floor front wall keeps its middle clear for the door.
        const isDoorway = facade.rotationY === 0 && floor === 0 && Math.abs(along) < 1.9;
        if (isDoorway) {
          continue;
        }
        placements.push({
          x: facade.normalX === 0 ? along : facade.normalX * (facade.depth + offset),
          y,
          z: facade.normalZ === 0 ? along : facade.normalZ * (facade.depth + offset),
          width,
          height,
          rotationY: facade.rotationY,
          normalX: facade.normalX,
          normalZ: facade.normalZ,
        });
      }
    }
  }

  return placements;
}

function wallColor(building: Building, index: number): number {
  if (building.kind === 'office') {
    return 0xb8bdc4;
  }
  if (building.kind === 'school') {
    return 0xe2d6bf;
  }
  if (building.kind === 'supermarket') {
    return 0xdfe3e0;
  }
  return WALL_COLORS[index % WALL_COLORS.length];
}

/** A pitched roof, built as a triangle extruded along the building's depth. */
function gableRoof(building: Building, color: number): Mesh {
  const overhang = 0.5;
  const halfWidth = building.width / 2 + overhang;

  const profile = new Shape();
  profile.moveTo(-halfWidth, 0);
  profile.lineTo(halfWidth, 0);
  profile.lineTo(0, building.roofHeight);
  profile.closePath();

  const depth = building.depth + overhang * 2;
  const geometry = new ExtrudeGeometry(profile, { depth, bevelEnabled: false });
  geometry.translate(0, 0, -depth / 2);

  const roof = new Mesh(geometry, new MeshStandardMaterial({ color, roughness: 0.9 }));
  roof.position.y = building.wallHeight;
  roof.castShadow = true;
  roof.receiveShadow = true;
  return roof;
}

/** A flat roof with a low parapet, used by the shops and the office. */
function flatRoof(building: Building): Mesh {
  const roof = new Mesh(
    new BoxGeometry(building.width + 0.7, building.roofHeight, building.depth + 0.7),
    new MeshStandardMaterial({ color: 0x6d6257, roughness: 0.9 }),
  );
  roof.position.y = building.wallHeight + building.roofHeight / 2;
  roof.castShadow = true;
  roof.receiveShadow = true;
  return roof;
}

/** A flat rectangle lying on the ground, oriented along a street's axis. */
function slab(along: number, across: number, axis: 'x' | 'z'): PlaneGeometry {
  const geometry =
    axis === 'x' ? new PlaneGeometry(along, across) : new PlaneGeometry(across, along);
  geometry.applyMatrix4(new Matrix4().makeRotationX(-Math.PI / 2));
  return geometry;
}

/** Where a slab sits for a street, offset sideways by `lateral`. */
function slabPosition(street: Street, lateral: number, y: number): [number, number, number] {
  const middle = (street.from + street.to) / 2;
  return street.axis === 'x' ? [middle, y, street.at + lateral] : [street.at + lateral, y, middle];
}

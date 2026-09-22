import {
  AdditiveBlending,
  BoxGeometry,
  type BufferGeometry,
  type Camera,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DataTexture,
  DoubleSide,
  ExtrudeGeometry,
  Group,
  IcosahedronGeometry,
  type InstancedMesh,
  type Material,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  Quaternion,
  RepeatWrapping,
  RGBAFormat,
  Shape,
  SphereGeometry,
  SRGBColorSpace,
  TorusGeometry,
  Vector3,
} from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

import type { Building, HouseStyle } from '../entities/Building.js';
import { Rng } from '../simulation/Rng.js';
import type { World } from '../simulation/World.js';
import {
  BUILDINGS,
  FLOWER_BEDS,
  GROUND_SIZE,
  OUTDOOR_ZONES,
  PARKING_LOT,
  ROAD_WIDTH,
  SHRUBS,
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
import { glowTexture } from './glow.js';
import { type BatchOptions, composeMatrix, InstanceBatch } from './InstanceBatch.js';

/** How fast a window or lamp fades between off and on, in real seconds. */
const LIGHT_FADE_SECONDS = 0.7;

const WINDOW_EMISSIVE = 0xffb455;
const LAMP_EMISSIVE = 0xffc078;

/**
 * The palette (DESIGN.md §10): warm, matte, low in saturation. Roads warm
 * grey, pavements warm beige-grey, grass a warm sage.
 */
const COLOR = {
  grass: 0x8ca57e,
  road: 0x77736b,
  pavement: 0xcfc5b3,
  marking: 0xf1ebdf,
  parking: 0x84807a,
  parkPath: 0xd6c7ab,
  soil: 0x6f5a48,
  trunk: 0x8b6b4e,
  foliage: 0x7fa06f,
  pine: 0x6d8f66,
  ironwork: 0x5b5750,
  wood: 0x8a6f52,
  glass: 0x9fb4c4,
  ivory: 0xf5f0e6,
  awningCafe: 0xc9705f,
  awningBakery: 0x6f9a7a,
} as const;

const ZONE_COLORS: Record<OutdoorZone['kind'], number> = {
  terrace: 0xd3c2a6,
  playground: 0xcf9a7a,
  forecourt: 0xc9c3b6,
  lawn: 0x95b185,
};

const FLOWER_COLORS = [0xe6a15c, 0xe09aa6, 0xf1e2a3, 0xd97b6c];

/** Heights everything flat is stacked at, so nothing z-fights with the ground. */
const LAYER_ROAD = 0.02;
const LAYER_ZONE = 0.05;
const LAYER_MARKING = 0.08;
const PAVEMENT_HEIGHT = 0.18;

/** Corner radius of a building's walls: enough to read as soft, not as a pillow. */
const ROUNDING = 0.3;

/** Sideways offset of a glow quad from its window, and its size against the pane. */
const GLOW_OFFSET = 0.4;
const GLOW_SCALE = 2.4;

/** One building's lights: which instances are its windows, and how lit it is. */
interface BuildingLights {
  building: Building;
  paneIndices: number[];
  glowIndices: number[];
  /** Current lit amount, eased towards the target so lights fade in. */
  lit: number;
  /** What was last written to the instances, to skip unchanged frames. */
  written: number;
}

/** A glow quad that must face the camera: where it sits and how big it is. */
interface Billboard {
  position: Vector3;
  scale: number;
}

type Placement = { x: number; y: number; z: number };
type Scale = { x?: number; y?: number; z?: number } | number;

/**
 * Everything standing still in the town: ground, roads, pavements, buildings
 * and their yards, outdoor zones, the park, the car park, trees, shrubs,
 * flower beds, lamps and signs.
 *
 * Every repeated shape is one InstancedMesh (PHASES.md Phase 3.5): a window
 * pane, a lamp post, a tree crown, a plain box of trim, each drawn once for
 * the whole town with a colour per instance. Only the walls and roofs of the
 * forty buildings are meshes of their own. The geometry is built once from the
 * layout data in world/Town.ts; each frame only the lights and the camera
 * facing glows change.
 */
export class TownView {
  readonly root = new Group();

  private readonly batches = new Map<string, InstanceBatch>();
  private readonly buildingLights: BuildingLights[] = [];

  private readonly matteWhite = matte(0xffffff);
  private readonly paneMaterial: MeshStandardMaterial;
  private readonly windowGlowMaterial: MeshBasicMaterial;
  private readonly lampMaterial: MeshStandardMaterial;
  private readonly lampHaloMaterial: MeshBasicMaterial;
  private readonly lampPoolMaterial: MeshBasicMaterial;

  private readonly windowGlowBillboards: Billboard[] = [];
  private readonly lampHaloBillboards: Billboard[] = [];
  private readonly lastCameraQuaternion = new Quaternion(0, 0, 0, 0);
  private lampLit = 0;

  constructor() {
    this.root.name = 'town';

    this.paneMaterial = makePaneMaterial();
    this.windowGlowMaterial = new MeshBasicMaterial({
      map: glowTexture(),
      blending: AdditiveBlending,
      transparent: true,
      depthWrite: false,
      opacity: 0.42,
    });
    this.lampMaterial = new MeshStandardMaterial({
      color: COLOR.ironwork,
      emissive: new Color(LAMP_EMISSIVE),
      emissiveIntensity: 0,
      roughness: 0.8,
    });
    this.lampHaloMaterial = new MeshBasicMaterial({
      map: glowTexture(),
      color: new Color(LAMP_EMISSIVE),
      blending: AdditiveBlending,
      transparent: true,
      depthWrite: false,
      opacity: 0,
    });
    this.lampPoolMaterial = new MeshBasicMaterial({
      map: glowTexture(),
      color: new Color(LAMP_EMISSIVE),
      blending: AdditiveBlending,
      transparent: true,
      depthWrite: false,
      opacity: 0,
    });

    this.defineBatches();

    this.addGround();
    this.addStreets();
    this.addOutdoorZones();
    this.addParkingLot();
    this.addFlowerBeds();
    this.addShrubs();

    for (const building of BUILDINGS) {
      this.addBuilding(building);
    }

    this.addTrees();
    this.addStreetLamps();
    this.addStreetSigns();

    for (const batch of this.batches.values()) {
      batch.build(this.root);
    }
  }

  /** The shared shapes, each a unit geometry scaled per instance. */
  private defineBatches(): void {
    const shadow: BatchOptions = { castShadow: true, receiveShadow: true };
    const define = (
      name: string,
      geometry: BufferGeometry,
      material: Material,
      options: BatchOptions = shadow,
    ): void => {
      this.batches.set(name, new InstanceBatch(name, geometry, material, options));
    };

    // Ground plane pieces: roads, patches, paths, markings.
    define('slab', flatUnitPlane(), this.matteWhite, { receiveShadow: true });

    // Plain shapes for trim and props, coloured per instance.
    define('box', new BoxGeometry(1, 1, 1), this.matteWhite);
    define('roundedBox', new RoundedBoxGeometry(1, 1, 1, 2, 0.08), this.matteWhite);
    define('cylinder', new CylinderGeometry(1, 1, 1, 10), this.matteWhite);
    define('sphere', new SphereGeometry(1, 8, 6), this.matteWhite);
    define('cone', new ConeGeometry(1, 1, 12), this.matteWhite);
    define('torus', new TorusGeometry(0.34, 0.05, 6, 16), this.matteWhite);

    // Windows: frame, sill, pane and the glow in front of the pane.
    define('windowFrame', new BoxGeometry(1, 1, 1), this.matteWhite);
    define('windowSill', new BoxGeometry(1, 1, 1), this.matteWhite);
    define('windowPane', new PlaneGeometry(1, 1), this.paneMaterial, {});
    define('windowGlow', new PlaneGeometry(1, 1), this.windowGlowMaterial, {});

    // Trees and shrubs.
    define('trunk', new CylinderGeometry(0.26, 0.4, 1, 8), this.matteWhite);
    define('crown', new IcosahedronGeometry(1, 1), this.matteWhite);
    define('pineLayer', new ConeGeometry(1, 1, 12), this.matteWhite);
    define('shrub', new IcosahedronGeometry(1, 1), this.matteWhite);

    // Street lamps.
    define('lampPole', new CylinderGeometry(0.08, 0.12, STREET_LAMP_HEIGHT, 8), this.matteWhite);
    define('lampHead', new RoundedBoxGeometry(0.7, 0.24, 0.7, 2, 0.08), this.lampMaterial, {});
    define('lampBulb', new SphereGeometry(0.22, 10, 8), this.lampMaterial, {});
    define('lampHalo', new PlaneGeometry(1, 1), this.lampHaloMaterial, {});
    define('lampPool', flatUnitPlane(), this.lampPoolMaterial, {});
  }

  private batch(name: string): InstanceBatch {
    const found = this.batches.get(name);
    if (!found) {
      throw new Error(`Unknown batch: ${name}`);
    }
    return found;
  }

  private addGround(): void {
    // A faint blotch of two greens keeps the grass from reading as one flat
    // fill, which is the surest sign of a machine-made scene (DESIGN.md §16).
    const material = matte(COLOR.grass);
    material.map = grassTexture();
    const ground = new Mesh(new PlaneGeometry(GROUND_SIZE, GROUND_SIZE), material);
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    ground.name = 'ground';
    this.root.add(ground);
  }

  /** A flat rectangle on the ground: roads, patches, paths, painted lines. */
  private slab(
    centreX: number,
    centreZ: number,
    sizeX: number,
    sizeZ: number,
    y: number,
    color: number,
  ): void {
    this.batch('slab').place({ x: centreX, y, z: centreZ }, {}, { x: sizeX, z: sizeZ }, color);
  }

  /** Tarmac, raised kerbs and a dashed centre line for every street. */
  private addStreets(): void {
    for (const street of STREETS) {
      const length = street.to - street.from;
      const middle = (street.from + street.to) / 2;
      const alongX = street.axis === 'x';

      this.slab(
        alongX ? middle : street.at,
        alongX ? street.at : middle,
        alongX ? length : ROAD_WIDTH,
        alongX ? ROAD_WIDTH : length,
        LAYER_ROAD,
        COLOR.road,
      );

      const kerbWidth = SIDEWALK_EDGE - ROAD_WIDTH / 2;
      for (const side of [-1, 1] as const) {
        const offset = side * (ROAD_WIDTH / 2 + kerbWidth / 2);
        this.batch('box').place(
          {
            x: alongX ? middle : street.at + offset,
            y: PAVEMENT_HEIGHT / 2,
            z: alongX ? street.at + offset : middle,
          },
          {},
          {
            x: alongX ? length + kerbWidth * 2 : kerbWidth,
            y: PAVEMENT_HEIGHT,
            z: alongX ? kerbWidth : length + kerbWidth * 2,
          },
          COLOR.pavement,
        );
      }

      this.addCentreLine(street);
    }

    // The junctions are plain tarmac, which also covers the kerb corners.
    for (const junction of junctions()) {
      this.slab(
        junction.x,
        junction.z,
        SIDEWALK_EDGE * 2,
        SIDEWALK_EDGE * 2,
        LAYER_ROAD + 0.01,
        COLOR.road,
      );
    }

    this.addZebraCrossings();
  }

  private addCentreLine(street: Street): void {
    const dashLength = 2.6;
    const gap = 4;
    const step = dashLength + gap;
    // Keep the dashes clear of the junction patches at either end.
    const count = Math.floor((street.to - street.from - SIDEWALK_EDGE * 2) / step);
    const alongX = street.axis === 'x';

    for (let index = 0; index < count; index += 1) {
      const along = street.from + SIDEWALK_EDGE + gap / 2 + index * step + dashLength / 2;
      this.slab(
        alongX ? along : street.at,
        alongX ? street.at : along,
        alongX ? dashLength : 0.26,
        alongX ? 0.26 : dashLength,
        LAYER_MARKING,
        COLOR.marking,
      );
    }
  }

  /** Painted stripes across each arm of every junction (DESIGN.md §7). */
  private addZebraCrossings(): void {
    const stripeLength = 1.8;
    const stripeWidth = 0.55;
    const stripesPerCrossing = 6;

    for (const junction of junctions()) {
      for (const [dx, dz] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        if (!this.streetContinues(junction, dx, dz)) {
          continue;
        }
        // A crossing sits just past the pavement corner on each arm.
        const along = SIDEWALK_EDGE + stripeLength / 2 + 0.4;
        const armIsX = dx !== 0;
        for (let stripe = 0; stripe < stripesPerCrossing; stripe += 1) {
          const across = ((stripe + 0.5) / stripesPerCrossing - 0.5) * (ROAD_WIDTH - 0.6);
          this.slab(
            junction.x + (armIsX ? dx * along : across),
            junction.z + (armIsX ? across : dz * along),
            armIsX ? stripeLength : stripeWidth,
            armIsX ? stripeWidth : stripeLength,
            LAYER_MARKING,
            COLOR.marking,
          );
        }
      }
    }
  }

  /** Whether a street actually leaves the junction in the given direction. */
  private streetContinues(junction: { x: number; z: number }, dx: number, dz: number): boolean {
    return STREETS.some((street) => {
      if (dx !== 0) {
        return (
          street.axis === 'x' &&
          street.at === junction.z &&
          (dx > 0 ? street.to > junction.x + 1 : street.from < junction.x - 1)
        );
      }
      return (
        street.axis === 'z' &&
        street.at === junction.x &&
        (dz > 0 ? street.to > junction.z + 1 : street.from < junction.z - 1)
      );
    });
  }

  /** The patches of ground outside the public buildings, and the park lawn. */
  private addOutdoorZones(): void {
    for (const zone of OUTDOOR_ZONES) {
      this.slab(
        (zone.minX + zone.maxX) / 2,
        (zone.minZ + zone.maxZ) / 2,
        zone.maxX - zone.minX,
        zone.maxZ - zone.minZ,
        zone.kind === 'lawn' ? LAYER_ZONE - 0.01 : LAYER_ZONE,
        ZONE_COLORS[zone.kind],
      );

      if (zone.kind === 'terrace') {
        this.addTerraceFurniture(zone);
      }
      if (zone.kind === 'playground') {
        this.addPlaygroundFrame(zone);
      }
      if (zone.kind === 'lawn') {
        this.addParkPathAndBenches(zone);
      }
    }
  }

  /** Round tables with a pair of stools each. */
  private addTerraceFurniture(zone: OutdoorZone): void {
    const cylinder = this.batch('cylinder');
    for (const spawn of zone.spawnPoints) {
      cylinder.place(
        { x: spawn.x + 0.9, y: 0.36, z: spawn.z },
        {},
        { x: 0.5, y: 0.72, z: 0.5 },
        COLOR.wood,
      );
      for (const side of [-0.75, 0.75]) {
        cylinder.place(
          { x: spawn.x + 0.9, y: 0.21, z: spawn.z + side },
          {},
          { x: 0.2, y: 0.42, z: 0.2 },
          COLOR.ironwork,
        );
      }
    }
  }

  /** A climbing frame, so the schoolyard reads as a schoolyard from above. */
  private addPlaygroundFrame(zone: OutdoorZone): void {
    const cylinder = this.batch('cylinder');
    const blue = 0x5f8fb5;
    const centreX = (zone.minX + zone.maxX) / 2;
    const centreZ = (zone.minZ + zone.maxZ) / 2;

    for (const offset of [-2.2, 2.2]) {
      cylinder.place(
        { x: centreX + offset, y: 1.2, z: centreZ },
        {},
        { x: 0.11, y: 2.4, z: 0.11 },
        blue,
      );
    }
    cylinder.place(
      { x: centreX, y: 2.4, z: centreZ },
      { z: Math.PI / 2 },
      { x: 0.11, y: 4.8, z: 0.11 },
      blue,
    );
  }

  /** A path across the park and a few benches. */
  private addParkPathAndBenches(zone: OutdoorZone): void {
    const centreX = (zone.minX + zone.maxX) / 2;
    const centreZ = (zone.minZ + zone.maxZ) / 2;

    this.slab(centreX, centreZ, zone.maxX - zone.minX, 2.6, LAYER_ZONE, COLOR.parkPath);

    const rounded = this.batch('roundedBox');
    for (const offset of [-7, 0, 7]) {
      rounded.place(
        { x: centreX + offset, y: 0.45, z: centreZ - 2.4 },
        {},
        { x: 2.2, y: 0.2, z: 0.6 },
        COLOR.wood,
      );
      rounded.place(
        { x: centreX + offset, y: 0.8, z: centreZ - 2.65 },
        {},
        { x: 2.2, y: 0.5, z: 0.12 },
        COLOR.wood,
      );
    }
  }

  /** Tarmac and painted bays for the car park at the east end. */
  private addParkingLot(): void {
    this.slab(
      (PARKING_LOT.minX + PARKING_LOT.maxX) / 2,
      (PARKING_LOT.minZ + PARKING_LOT.maxZ) / 2,
      PARKING_LOT.maxX - PARKING_LOT.minX,
      PARKING_LOT.maxZ - PARKING_LOT.minZ,
      LAYER_ROAD,
      COLOR.parking,
    );

    for (const space of PARKING_LOT.spaces) {
      for (const side of [-2.2, 2.2]) {
        this.slab(space.x + side, space.z, 0.2, 5.6, LAYER_MARKING, COLOR.marking);
      }
    }

    // A short apron joining the lot to the road it hangs off.
    this.slab(
      PARKING_LOT.entrance.x - 2,
      PARKING_LOT.entrance.z,
      4.5,
      6,
      LAYER_ROAD,
      COLOR.parking,
    );
  }

  /** Low beds of soil with a scatter of flowers on top. */
  private addFlowerBeds(): void {
    const rng = new Rng('flowers');
    for (const bed of FLOWER_BEDS) {
      this.flowerBed(new Matrix4(), bed.minX, bed.maxX, bed.minZ, bed.maxZ, rng);
    }
  }

  /**
   * A bed of soil with flowers scattered over it, placed through `frame` so
   * it works both in world space and inside a house's local space.
   */
  private flowerBed(
    frame: Matrix4,
    minX: number,
    maxX: number,
    minZ: number,
    maxZ: number,
    rng: Rng,
  ): void {
    const width = maxX - minX;
    const depth = maxZ - minZ;

    this.batch('box').add(
      frame
        .clone()
        .multiply(
          composeMatrix(
            { x: (minX + maxX) / 2, y: 0.15, z: (minZ + maxZ) / 2 },
            {},
            { x: width, y: 0.3, z: depth },
          ),
        ),
      COLOR.soil,
    );

    const count = Math.max(3, Math.round(width * depth * 0.9));
    const sphere = this.batch('sphere');
    for (let index = 0; index < count; index += 1) {
      const x = rng.nextFloat(minX + 0.25, maxX - 0.25);
      const z = rng.nextFloat(minZ + 0.25, maxZ - 0.25);
      const size = rng.nextFloat(0.7, 1.2) * 0.17;
      const color = rng.pick(FLOWER_COLORS);
      sphere.add(frame.clone().multiply(composeMatrix({ x, y: 0.36, z }, {}, size)), color);
    }
  }

  private addShrubs(): void {
    const rng = new Rng('shrubs');
    const shrubs = this.batch('shrub');
    for (const shrub of SHRUBS) {
      const color = new Color(COLOR.foliage).offsetHSL(0, rng.nextFloat(-0.05, 0.05), -0.04);
      shrubs.place(
        { x: shrub.position.x, y: shrub.radius * 0.55, z: shrub.position.z },
        {},
        { x: shrub.radius, y: shrub.radius * 0.72, z: shrub.radius },
        color,
      );
    }
  }

  private addBuilding(building: Building): void {
    // The walls and roof are meshes of their own; everything else on the
    // building goes into the shared batches through this frame.
    const frame = composeMatrix(
      { x: building.position.x, y: 0, z: building.position.z },
      { y: building.rotationY },
    );

    const walls = new Mesh(
      new RoundedBoxGeometry(building.width, building.wallHeight, building.depth, 3, ROUNDING),
      matte(jitter(wallColor(building), building.id)),
    );
    walls.position.set(building.position.x, building.wallHeight / 2, building.position.z);
    walls.rotation.y = building.rotationY;
    walls.castShadow = true;
    walls.receiveShadow = true;
    walls.name = building.id;
    this.root.add(walls);

    const roof = roofFor(building);
    roof.applyMatrix4(frame);
    this.root.add(roof);

    this.addRoofTrim(frame, building);

    const lights: BuildingLights = {
      building,
      paneIndices: [],
      glowIndices: [],
      lit: 0,
      written: -1,
    };
    const trimColor = building.style?.trimColor ?? COLOR.ivory;

    for (const placement of windowPlacements(building)) {
      const rotation = { y: placement.rotationY };
      const nx = placement.normalX;
      const nz = placement.normalZ;

      this.batch('windowFrame').add(
        frame.clone().multiply(
          composeMatrix({ x: placement.x, y: placement.y, z: placement.z }, rotation, {
            x: placement.width + 0.24,
            y: placement.height + 0.24,
            z: 0.12,
          }),
        ),
        trimColor,
      );

      // A sill below each window: a small ledge that catches light and shadow.
      this.batch('windowSill').add(
        frame.clone().multiply(
          composeMatrix(
            {
              x: placement.x + nx * 0.1,
              y: placement.y - placement.height / 2 - 0.12,
              z: placement.z + nz * 0.1,
            },
            rotation,
            { x: placement.width + 0.4, y: 0.1, z: 0.28 },
          ),
        ),
        trimColor,
      );

      lights.paneIndices.push(
        this.batch('windowPane').add(
          frame
            .clone()
            .multiply(
              composeMatrix(
                { x: placement.x + nx * 0.07, y: placement.y, z: placement.z + nz * 0.07 },
                rotation,
                { x: placement.width, y: placement.height, z: 1 },
              ),
            ),
          new Color(0, 0, 0),
        ),
      );

      const glowPosition = new Vector3(
        placement.x + nx * GLOW_OFFSET,
        placement.y,
        placement.z + nz * GLOW_OFFSET,
      ).applyMatrix4(frame);
      const glowScale = Math.max(placement.width, 1.1) * GLOW_SCALE;
      lights.glowIndices.push(
        this.batch('windowGlow').add(
          composeMatrix(glowPosition, {}, glowScale),
          new Color(0, 0, 0),
        ),
      );
      this.windowGlowBillboards.push({ position: glowPosition, scale: glowScale });
    }

    this.addDoorAndTrim(frame, building);
    if (building.style) {
      this.addYard(frame, building, building.style);
    }

    this.buildingLights.push(lights);
  }

  /**
   * What sits on and under a roof: a fascia board along the eaves, a ridge
   * cap on a pitched roof, and a chimney on every other house. Small parts,
   * but they are what make a roof look assembled rather than extruded.
   */
  private addRoofTrim(frame: Matrix4, building: Building): void {
    const style = building.style;
    const trimColor = style?.trimColor ?? COLOR.ivory;
    const pitched =
      style?.roofKind === 'gable' || style?.roofKind === 'hip' || building.kind === 'bakery';

    if (pitched) {
      this.batch('box').add(
        frame
          .clone()
          .multiply(
            composeMatrix(
              { x: 0, y: building.wallHeight - 0.04, z: 0 },
              {},
              { x: building.width + 1.1, y: 0.22, z: building.depth + 1.1 },
            ),
          ),
        trimColor,
      );
    }

    if (style?.roofKind === 'gable') {
      this.batch('roundedBox').add(
        frame
          .clone()
          .multiply(
            composeMatrix(
              { x: 0, y: building.wallHeight + building.roofHeight - 0.02, z: 0 },
              {},
              { x: 0.34, y: 0.22, z: building.depth + 1.2 },
            ),
          ),
        darken(style.roofColor, 0.82),
      );
    }

    const houseNumber = Number(building.id.slice(-2));
    if (building.kind === 'house' && pitched && houseNumber % 2 === 0) {
      // Off centre and towards the back, so it clears the ridge.
      const chimney = {
        x: building.width * 0.28,
        y: building.wallHeight + building.roofHeight * 0.55 + 0.5,
        z: -building.depth * 0.18,
      };
      this.batch('roundedBox').add(
        frame.clone().multiply(composeMatrix(chimney, {}, { x: 0.7, y: 1.6, z: 0.7 })),
        darken(style?.wallColor ?? COLOR.ivory, 0.8),
      );
      this.batch('cylinder').add(
        frame
          .clone()
          .multiply(
            composeMatrix(
              { x: chimney.x, y: chimney.y + 0.95, z: chimney.z },
              {},
              { x: 0.16, y: 0.4, z: 0.16 },
            ),
          ),
        0x8a5a48,
      );
    }
  }

  /** A door on the front wall, plus whatever marks the building out. */
  private addDoorAndTrim(frame: Matrix4, building: Building): void {
    const doorHeight = 2.2;
    const doorWidth = building.kind === 'house' ? 1.2 : 2.2;
    const front = building.depth / 2;
    const rounded = this.batch('roundedBox');
    const at = (position: Placement, scale: Scale, rotation = {}): Matrix4 =>
      frame.clone().multiply(composeMatrix(position, rotation, scale));

    rounded.add(
      at({ x: 0, y: doorHeight / 2, z: front + 0.06 }, { x: doorWidth, y: doorHeight, z: 0.16 }),
      building.style?.trimColor === COLOR.ivory ? COLOR.wood : 0x5a4636,
    );

    rounded.add(
      at({ x: 0, y: 0.08, z: front + 0.5 }, { x: doorWidth + 0.8, y: 0.16, z: 0.9 }),
      COLOR.pavement,
    );

    if (building.kind === 'cafe' || building.kind === 'bakery') {
      rounded.add(
        at(
          { x: 0, y: doorHeight + 0.9, z: front + 1 },
          { x: building.width * 0.72, y: 0.22, z: 2.4 },
        ),
        building.kind === 'cafe' ? COLOR.awningCafe : COLOR.awningBakery,
      );
    }

    if (building.kind === 'apartment') {
      rounded.add(
        at({ x: 0, y: doorHeight + 0.5, z: front + 0.7 }, { x: 3.4, y: 0.2, z: 1.6 }),
        COLOR.ivory,
      );
    }

    if (building.kind === 'school') {
      // A little bell tower, so the school is recognisable from above.
      rounded.add(
        at({ x: 0, y: building.wallHeight + 1.7, z: 0 }, { x: 3, y: 3.4, z: 3 }),
        COLOR.ivory,
      );
      this.batch('cone').add(
        at(
          { x: 0, y: building.wallHeight + 4.4, z: 0 },
          { x: 2.4, y: 2, z: 2.4 },
          { y: Math.PI / 4 },
        ),
        0x8a6a52,
      );
    }

    if (building.kind === 'supermarket') {
      // The one lit sign in town keeps its own material.
      const sign = new Mesh(
        new RoundedBoxGeometry(building.width * 0.6, 1.3, 0.3, 2, 0.1),
        new MeshStandardMaterial({
          color: 0x4f7a5c,
          emissive: new Color(0x8fcf9f),
          emissiveIntensity: 0.25,
          roughness: 0.8,
        }),
      );
      sign.applyMatrix4(at({ x: 0, y: building.wallHeight - 1.4, z: front + 0.15 }, 1));
      this.root.add(sign);
    }
  }

  /**
   * The porch, balcony, fence, flower bed and one prop that make a house its
   * own home (DESIGN.md §4). Everything is placed in the house's local space,
   * in front of its door: +Z is the street side.
   */
  private addYard(frame: Matrix4, building: Building, style: HouseStyle): void {
    const front = building.depth / 2;
    const at = (position: Placement, scale: Scale, rotation = {}): Matrix4 =>
      frame.clone().multiply(composeMatrix(position, rotation, scale));
    const box = this.batch('box');
    const rounded = this.batch('roundedBox');
    const cylinder = this.batch('cylinder');

    if (style.porch) {
      rounded.add(
        at({ x: 0, y: 0.1, z: front + 1 }, { x: building.width * 0.55, y: 0.2, z: 2 }),
        style.trimColor,
      );
      for (const side of [-1, 1]) {
        cylinder.add(
          at(
            { x: side * (building.width * 0.27 - 0.2), y: 1.45, z: front + 1.8 },
            { x: 0.09, y: 2.5, z: 0.09 },
          ),
          style.trimColor,
        );
      }
      rounded.add(
        at({ x: 0, y: 2.75, z: front + 1 }, { x: building.width * 0.6, y: 0.18, z: 2.3 }),
        style.roofColor,
      );
    }

    if (style.balcony) {
      const floorHeight = building.wallHeight / building.floors;
      const y = floorHeight * 1.05;
      rounded.add(
        at({ x: building.width * 0.22, y, z: front + 0.6 }, { x: 3.2, y: 0.18, z: 1.2 }),
        style.trimColor,
      );
      box.add(
        at({ x: building.width * 0.22, y: y + 0.45, z: front + 1.16 }, { x: 3.2, y: 0.7, z: 0.08 }),
        style.trimColor,
      );
    }

    if (style.fence) {
      const fenceZ = front + 3.6;
      const halfWidth = building.width / 2 + 1;
      box.add(at({ x: 0, y: 0.55, z: fenceZ }, { x: halfWidth * 2, y: 0.08, z: 0.08 }), COLOR.wood);
      const postCount = Math.round(halfWidth * 2);
      for (let index = 0; index < postCount; index += 1) {
        // Leave the middle open as a gate.
        const x = -halfWidth + (index / (postCount - 1)) * halfWidth * 2;
        if (Math.abs(x) < 0.8) {
          continue;
        }
        box.add(at({ x, y: 0.4, z: fenceZ }, { x: 0.12, y: 0.8, z: 0.12 }), COLOR.wood);
      }
    }

    if (style.flowerBed) {
      const rng = new Rng(`${building.id}:flowers`);
      const bedWidth = building.width * 0.38;
      this.flowerBed(
        frame,
        building.width / 2 - bedWidth - 0.2,
        building.width / 2 - 0.2,
        front + 0.35,
        front + 1.15,
        rng,
      );
    }

    const propX = -(building.width / 2 - 0.9);
    const propZ = front + 2.6;
    switch (style.prop) {
      case 'mailbox':
        cylinder.add(
          at({ x: propX, y: 0.55, z: propZ }, { x: 0.06, y: 1.1, z: 0.06 }),
          COLOR.ironwork,
        );
        rounded.add(at({ x: propX, y: 1.2, z: propZ }, { x: 0.34, y: 0.3, z: 0.5 }), 0xd97b6c);
        break;
      case 'bin':
        cylinder.add(at({ x: propX, y: 0.45, z: propZ }, { x: 0.34, y: 0.9, z: 0.34 }), 0x5f6b73);
        break;
      case 'bicycle': {
        const blue = 0x5f8fb5;
        for (const offset of [-0.5, 0.5]) {
          this.batch('torus').add(at({ x: propX + offset, y: 0.36, z: propZ }, 1), COLOR.ironwork);
        }
        box.add(at({ x: propX, y: 0.62, z: propZ }, { x: 1.0, y: 0.06, z: 0.06 }), blue);
        box.add(at({ x: propX - 0.15, y: 0.8, z: propZ }, { x: 0.06, y: 0.4, z: 0.06 }), blue);
        break;
      }
      case 'flower-pots':
        for (const offset of [-0.5, 0, 0.5]) {
          cylinder.add(
            at({ x: propX + offset, y: 0.16, z: propZ }, { x: 0.2, y: 0.32, z: 0.2 }),
            0xb8695a,
          );
          this.batch('sphere').add(
            at({ x: propX + offset, y: 0.42, z: propZ }, 0.2),
            FLOWER_COLORS[Math.abs(Math.round(offset * 2)) % FLOWER_COLORS.length],
          );
        }
        break;
      case 'none':
        break;
    }
  }

  private addTrees(): void {
    const rng = new Rng('trees');
    const trunks = this.batch('trunk');
    const crowns = this.batch('crown');
    const layers = this.batch('pineLayer');

    for (const tree of TREES) {
      const frame = composeMatrix(
        { x: tree.position.x, y: 0, z: tree.position.z },
        { y: rng.nextFloat(0, Math.PI * 2) },
      );
      const trunkHeight = tree.height * 0.4;
      trunks.add(
        frame
          .clone()
          .multiply(composeMatrix({ x: 0, y: trunkHeight / 2, z: 0 }, {}, { y: trunkHeight })),
        COLOR.trunk,
      );

      const base = tree.shape === 'pine' ? COLOR.pine : COLOR.foliage;
      const color = new Color(base).offsetHSL(
        rng.nextFloat(-0.025, 0.025),
        rng.nextFloat(-0.06, 0.06),
        rng.nextFloat(-0.05, 0.05),
      );

      if (tree.shape === 'pine') {
        for (let layer = 0; layer < 3; layer += 1) {
          const radius = 2.3 - layer * 0.55;
          const height = tree.height * 0.42;
          layers.add(
            frame
              .clone()
              .multiply(
                composeMatrix(
                  { x: 0, y: trunkHeight + layer * (tree.height * 0.2) + height / 2, z: 0 },
                  {},
                  { x: radius, y: height, z: radius },
                ),
              ),
            color,
          );
        }
      } else {
        // Two soft blobs, the upper one smaller, read as a round crown.
        const crownHeight = tree.height - trunkHeight;
        const lower = crownHeight * 0.6;
        crowns.add(
          frame
            .clone()
            .multiply(
              composeMatrix(
                { x: 0, y: trunkHeight + crownHeight * 0.42, z: 0 },
                {},
                { x: lower, y: lower * 0.85, z: lower },
              ),
            ),
          color,
        );
        crowns.add(
          frame.clone().multiply(
            composeMatrix(
              {
                x: crownHeight * 0.12,
                y: trunkHeight + crownHeight * 0.78,
                z: -crownHeight * 0.08,
              },
              {},
              crownHeight * 0.42,
            ),
          ),
          color,
        );
      }
    }
  }

  private addStreetLamps(): void {
    for (const position of streetLampPositions()) {
      const { x, z } = position;
      this.batch('lampPole').place({ x, y: STREET_LAMP_HEIGHT / 2, z }, {}, 1, COLOR.ironwork);
      this.batch('lampHead').place({ x, y: STREET_LAMP_HEIGHT, z });
      this.batch('lampBulb').place({ x, y: STREET_LAMP_HEIGHT - 0.22, z });

      const haloPosition = new Vector3(x, STREET_LAMP_HEIGHT - 0.22, z);
      this.batch('lampHalo').add(composeMatrix(haloPosition, {}, 3));
      this.lampHaloBillboards.push({ position: haloPosition, scale: 3 });

      this.batch('lampPool').place({ x, y: PAVEMENT_HEIGHT + 0.04, z }, {}, { x: 9, z: 9 });
    }
  }

  private addStreetSigns(): void {
    for (const sign of STREET_SIGNS) {
      const frame = composeMatrix(
        { x: sign.position.x, y: 0, z: sign.position.z },
        { y: sign.rotationY },
      );
      this.batch('cylinder').add(
        frame
          .clone()
          .multiply(composeMatrix({ x: 0, y: 1.3, z: 0 }, {}, { x: 0.06, y: 2.6, z: 0.06 })),
        COLOR.ironwork,
      );
      this.batch('roundedBox').add(
        frame
          .clone()
          .multiply(composeMatrix({ x: 0, y: 2.5, z: 0 }, {}, { x: 2.2, y: 0.42, z: 0.08 })),
        COLOR.ivory,
      );
    }
  }

  /**
   * Eases every light towards where the simulation says it should be, and
   * turns the glow quads to face the camera.
   *
   * `deltaSeconds` is real time, so lights take the same moment to warm up
   * whatever speed the town is running at.
   */
  update(world: World, environment: EnvironmentState, deltaSeconds: number, camera: Camera): void {
    const ease = 1 - Math.exp(-deltaSeconds / LIGHT_FADE_SECONDS);
    const panes = this.batch('windowPane').built;
    const glows = this.batch('windowGlow').built;
    const warm = new Color(WINDOW_EMISSIVE);
    const paneColor = new Color();
    const glowColor = new Color();
    let windowsChanged = false;

    for (const lights of this.buildingLights) {
      const target = world.isLit(lights.building.id) ? 1 : 0;
      lights.lit += (target - lights.lit) * ease;

      const shown = lights.lit * environment.windowFactor;
      if (Math.abs(shown - lights.written) < 0.002) {
        continue;
      }
      lights.written = shown;
      windowsChanged = true;

      // The pane's red channel is its light amount; the glow is the warm
      // colour scaled by it, which under additive blending is a fade.
      paneColor.setRGB(shown * 1.15, 0, 0);
      glowColor.copy(warm).multiplyScalar(shown);
      for (const index of lights.paneIndices) {
        panes.setColorAt(index, paneColor);
      }
      for (const index of lights.glowIndices) {
        glows.setColorAt(index, glowColor);
      }
    }
    if (windowsChanged && panes.instanceColor && glows.instanceColor) {
      panes.instanceColor.needsUpdate = true;
      glows.instanceColor.needsUpdate = true;
    }

    this.lampLit += (environment.lampFactor - this.lampLit) * ease;
    this.lampMaterial.emissiveIntensity = this.lampLit * 1.5;
    this.lampPoolMaterial.opacity = this.lampLit * 0.3;
    this.lampHaloMaterial.opacity = this.lampLit * 0.36;

    this.faceCamera(camera);
  }

  /** Turns every glow quad to the camera, only when the camera has turned. */
  private faceCamera(camera: Camera): void {
    if (this.lastCameraQuaternion.equals(camera.quaternion)) {
      return;
    }
    this.lastCameraQuaternion.copy(camera.quaternion);

    const turn = (mesh: InstancedMesh, billboards: Billboard[]): void => {
      const scale = new Vector3();
      const matrix = new Matrix4();
      billboards.forEach((billboard, index) => {
        scale.setScalar(billboard.scale);
        matrix.compose(billboard.position, camera.quaternion, scale);
        mesh.setMatrixAt(index, matrix);
      });
      mesh.instanceMatrix.needsUpdate = true;
    };

    turn(this.batch('windowGlow').built, this.windowGlowBillboards);
    turn(this.batch('lampHalo').built, this.lampHaloBillboards);
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
  const offset = 0.02;
  const shopFront = building.kind === 'supermarket' || building.kind === 'cafe';
  const modern = building.style?.roofKind === 'flat';
  const width = shopFront ? 1.8 : modern ? 1.7 : 1.1;
  const height = shopFront ? 1.9 : modern ? 1.6 : 1.35;

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

function wallColor(building: Building): number {
  if (building.style) {
    return building.style.wallColor;
  }
  switch (building.kind) {
    case 'office':
      return 0xc9cdd2;
    case 'school':
      return 0xe8dcc3;
    case 'supermarket':
      return 0xe4e6e1;
    case 'apartment':
      return 0xd9cfbf;
    case 'cafe':
      return 0xf1e6d2;
    case 'bakery':
      return 0xeadfc6;
    default:
      return COLOR.ivory;
  }
}

/** The roof a building wears: pitched, hipped or flat, by kind and style. */
function roofFor(building: Building): Mesh {
  const style = building.style;
  if (style?.roofKind === 'gable' || building.kind === 'bakery') {
    return gableRoof(building, style?.roofColor ?? 0x8a6a52);
  }
  if (style?.roofKind === 'hip') {
    return hipRoof(building, style.roofColor);
  }
  return flatRoof(building, style?.roofColor ?? 0x6f6a62);
}

/** A pitched roof, built as a triangle extruded along the building's depth. */
function gableRoof(building: Building, color: number): Mesh {
  const overhang = 0.55;
  const halfWidth = building.width / 2 + overhang;

  const profile = new Shape();
  profile.moveTo(-halfWidth, 0);
  profile.lineTo(halfWidth, 0);
  profile.lineTo(0, building.roofHeight);
  profile.closePath();

  const depth = building.depth + overhang * 2;
  const geometry = new ExtrudeGeometry(profile, { depth, bevelEnabled: false });
  geometry.translate(0, 0, -depth / 2);

  const roof = new Mesh(geometry, matte(color));
  roof.position.y = building.wallHeight - 0.05;
  roof.castShadow = true;
  roof.receiveShadow = true;
  return roof;
}

/** A hipped roof: a low four sided pyramid stretched over the footprint. */
function hipRoof(building: Building, color: number): Mesh {
  const overhang = 0.55;
  const roof = new Mesh(new ConeGeometry(Math.SQRT1_2, 1, 4), matte(color));
  roof.scale.set(building.width + overhang * 2, building.roofHeight, building.depth + overhang * 2);
  roof.rotation.y = Math.PI / 4;
  roof.position.y = building.wallHeight - 0.05 + building.roofHeight / 2;
  roof.castShadow = true;
  roof.receiveShadow = true;
  return roof;
}

/** A flat roof with a low lip, used by the shops, the office and modern houses. */
function flatRoof(building: Building, color: number): Mesh {
  const roof = new Mesh(
    new RoundedBoxGeometry(
      building.width + 0.6,
      building.roofHeight,
      building.depth + 0.6,
      2,
      0.12,
    ),
    matte(color),
  );
  roof.position.y = building.wallHeight + building.roofHeight / 2 - 0.05;
  roof.castShadow = true;
  roof.receiveShadow = true;
  return roof;
}

/**
 * The window pane material. Instance colour is not a colour here: its red
 * channel is how lit the window is, and the shader scales the emissive term
 * by it while leaving the glass colour alone. That is what lets one
 * InstancedMesh draw every window in town with each on or off by itself.
 */
function makePaneMaterial(): MeshStandardMaterial {
  const material = new MeshStandardMaterial({
    color: COLOR.glass,
    emissive: new Color(WINDOW_EMISSIVE),
    emissiveIntensity: 1,
    roughness: 0.55,
    metalness: 0,
    side: DoubleSide,
  });
  material.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', '').replace(
      '#include <emissivemap_fragment>',
      [
        '#include <emissivemap_fragment>',
        // USE_COLOR is what the fragment stage defines when instance
        // colours are on; USE_INSTANCING_COLOR is a vertex stage define.
        '#ifdef USE_COLOR',
        '  totalEmissiveRadiance *= vColor.r;',
        '#endif',
      ].join('\n'),
    );
  };
  material.customProgramCacheKey = () => 'tiny-town-window-pane';
  return material;
}

/**
 * Nudges a colour by a hair, keyed on a name, so two walls of the same paint
 * are never exactly the same shade. Deliberately tiny.
 */
function jitter(color: number, key: string): number {
  let hash = 2166136261;
  for (let i = 0; i < key.length; i += 1) {
    hash = Math.imul(hash ^ key.charCodeAt(i), 16777619);
  }
  const unit = ((hash >>> 0) % 1000) / 1000 - 0.5;
  return new Color(color).offsetHSL(unit * 0.01, unit * 0.04, unit * 0.05).getHex();
}

function darken(color: number, factor: number): number {
  return new Color(color).multiplyScalar(factor).getHex();
}

let sharedGrassTexture: DataTexture | undefined;

/** A soft, low frequency blotch of two greens, tiled over the ground. */
function grassTexture(): DataTexture {
  if (sharedGrassTexture) {
    return sharedGrassTexture;
  }
  const size = 64;
  const data = new Uint8Array(size * size * 4);
  const rng = new Rng('grass');
  // Value noise: a coarse grid of random values, smoothly interpolated.
  const cells = 6;
  const grid: number[] = [];
  for (let i = 0; i < (cells + 1) * (cells + 1); i += 1) {
    grid.push(rng.next());
  }
  const smooth = (t: number): number => t * t * (3 - 2 * t);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const gx = (x / size) * cells;
      const gy = (y / size) * cells;
      const x0 = Math.floor(gx) % cells;
      const y0 = Math.floor(gy) % cells;
      const tx = smooth(gx - Math.floor(gx));
      const ty = smooth(gy - Math.floor(gy));
      const at = (cx: number, cy: number): number =>
        grid[(cy % cells) * (cells + 1) + (cx % cells)];
      const top = at(x0, y0) * (1 - tx) + at(x0 + 1, y0) * tx;
      const bottom = at(x0, y0 + 1) * (1 - tx) + at(x0 + 1, y0 + 1) * tx;
      // Keep the swing small: the grass is one colour with a breath in it.
      const value = 240 + (top * (1 - ty) + bottom * ty - 0.5) * 12;
      const index = (y * size + x) * 4;
      data[index] = value;
      data[index + 1] = value;
      data[index + 2] = value;
      data[index + 3] = 255;
    }
  }
  sharedGrassTexture = new DataTexture(data, size, size, RGBAFormat);
  sharedGrassTexture.wrapS = RepeatWrapping;
  sharedGrassTexture.wrapT = RepeatWrapping;
  sharedGrassTexture.repeat.set(GROUND_SIZE / 48, GROUND_SIZE / 48);
  sharedGrassTexture.colorSpace = SRGBColorSpace;
  sharedGrassTexture.needsUpdate = true;
  return sharedGrassTexture;
}

/** A matte material: rough, no metal, the whole town is made of it (DESIGN.md §16). */
function matte(color: number): MeshStandardMaterial {
  return new MeshStandardMaterial({ color: new Color(color), roughness: 0.95, metalness: 0 });
}

/** A unit square lying flat on the ground, to be scaled into any slab. */
function flatUnitPlane(): PlaneGeometry {
  const geometry = new PlaneGeometry(1, 1);
  geometry.applyMatrix4(new Matrix4().makeRotationX(-Math.PI / 2));
  return geometry;
}

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
  SphereGeometry,
  SRGBColorSpace,
  TorusGeometry,
  Vector3,
} from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

import type { Building, HouseStyle } from '../entities/Building.js';
import { Rng } from '../simulation/Rng.js';
import type { World } from '../simulation/World.js';
import { groundHeight, groundTiltX } from '../world/Terrain.js';
import {
  BUILDINGS,
  CHURCH,
  FLOWER_BEDS,
  GROUND_SIZE,
  LIGHTHOUSE,
  OUTDOOR_ZONES,
  PARKING_LOT,
  ROAD_WIDTH,
  SHRUBS,
  SIDEWALK_EDGE,
  STREETS,
  STREET_LAMP_HEIGHT,
  STREET_SIGNS,
  TREES,
  WALL_WHITE,
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
  /** The pale stone of plinths, steps and the lighthouse rock. */
  stone: 0xd8d0c2,
  /** Roof surfaces: a hair greyer than the walls, so a roof reads as a plane. */
  roofWhite: 0xe9e6df,
  dome: 0x2f4e9a,
  equipment: 0x9a9a96,
} as const;

/**
 * One theme colour per public building, run through its awning, door frame
 * and sign (DESIGN.md §4): cafe ochre-red, bakery mustard, supermarket sea
 * blue, school terracotta, office slate, apartments olive.
 */
const THEME_COLORS: Record<Exclude<Building['kind'], 'house'>, number> = {
  cafe: 0xc9705f,
  bakery: 0xd9a83e,
  supermarket: 0x3f7fb8,
  school: 0xc27a5a,
  office: 0x5b7691,
  apartment: 0x7e8a5a,
};

/** Cloths on the washing lines, and the potted plants. */
const CLOTH_COLORS = [0xf5f0e6, 0x3f7fb8, 0xe6a15c, 0xc93a7a, 0xf1e2a3];

/** How far the plinth reaches down into the slope, and how far it shows above it. */
const PLINTH_DEPTH = 1.2;
const PLINTH_LIP = 0.12;

/** The lighthouse beam turns once in this many real seconds. */
const BEAM_PERIOD_SECONDS = 6;
const BEAM_LENGTH = 110;

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

  /** The lighthouse beam: the one light in the night that moves. */
  private readonly beam: Mesh;
  private readonly beamMaterial: MeshBasicMaterial;

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

    this.beamMaterial = new MeshBasicMaterial({
      color: new Color(LAMP_EMISSIVE),
      blending: AdditiveBlending,
      transparent: true,
      depthWrite: false,
      opacity: 0,
    });
    this.beam = makeBeam(this.beamMaterial);

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
    this.addChurch();
    this.addLighthouse();

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
    // Walls: a unit rounded box scaled to each volume, so every wall in town
    // is one draw call. The small radius stays soft at wall size.
    define('wallBox', new RoundedBoxGeometry(1, 1, 1, 3, 0.035), this.matteWhite);
    define('dome', new SphereGeometry(1, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2), this.matteWhite);
    // The lamp room of the lighthouse and the lamp on the church dome.
    define('lampCylinder', new CylinderGeometry(1, 1, 1, 12), this.lampMaterial, {});
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
    // A heightfield: the plane is laid flat, then every vertex is lifted to
    // the ground height there (world/Terrain.ts), so the town sits on its slope.
    const geometry = new PlaneGeometry(GROUND_SIZE, GROUND_SIZE, 200, 200);
    geometry.applyMatrix4(new Matrix4().makeRotationX(-Math.PI / 2));
    const positions = geometry.getAttribute('position');
    for (let index = 0; index < positions.count; index += 1) {
      positions.setY(index, groundHeight(positions.getX(index), positions.getZ(index)));
    }
    positions.needsUpdate = true;
    geometry.computeVertexNormals();
    const ground = new Mesh(geometry, material);
    ground.receiveShadow = true;
    ground.name = 'ground';
    this.root.add(ground);
  }

  /**
   * A flat rectangle on the ground: roads, patches, paths, painted lines.
   * It is laid at the height of its centre and tilted to the grade, so it
   * meets the slope along its whole length.
   */
  private slab(
    centreX: number,
    centreZ: number,
    sizeX: number,
    sizeZ: number,
    y: number,
    color: number,
  ): void {
    this.batch('slab').place(
      { x: centreX, y: groundHeight(centreX, centreZ) + y, z: centreZ },
      { x: groundTiltX(centreX, centreZ) },
      { x: sizeX, z: sizeZ },
      color,
    );
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
        const kerbX = alongX ? middle : street.at + offset;
        const kerbZ = alongX ? street.at + offset : middle;
        this.batch('box').place(
          {
            x: kerbX,
            y: groundHeight(kerbX, kerbZ) + PAVEMENT_HEIGHT / 2,
            z: kerbZ,
          },
          { x: groundTiltX(kerbX, kerbZ) },
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
      const ground = groundHeight(spawn.x, spawn.z);
      cylinder.place(
        { x: spawn.x + 0.9, y: ground + 0.36, z: spawn.z },
        {},
        { x: 0.5, y: 0.72, z: 0.5 },
        COLOR.wood,
      );
      for (const side of [-0.75, 0.75]) {
        cylinder.place(
          { x: spawn.x + 0.9, y: ground + 0.21, z: spawn.z + side },
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
    const ground = groundHeight(centreX, centreZ);

    for (const offset of [-2.2, 2.2]) {
      cylinder.place(
        { x: centreX + offset, y: ground + 1.2, z: centreZ },
        {},
        { x: 0.11, y: 2.4, z: 0.11 },
        blue,
      );
    }
    cylinder.place(
      { x: centreX, y: ground + 2.4, z: centreZ },
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
    const ground = groundHeight(centreX, centreZ - 2.5);
    for (const offset of [-7, 0, 7]) {
      rounded.place(
        { x: centreX + offset, y: ground + 0.45, z: centreZ - 2.4 },
        {},
        { x: 2.2, y: 0.2, z: 0.6 },
        COLOR.wood,
      );
      rounded.place(
        { x: centreX + offset, y: ground + 0.8, z: centreZ - 2.65 },
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
      // The bed is placed through a frame on the slope at its centre.
      const centreX = (bed.minX + bed.maxX) / 2;
      const centreZ = (bed.minZ + bed.maxZ) / 2;
      const frame = composeMatrix(
        { x: centreX, y: groundHeight(centreX, centreZ), z: centreZ },
        { x: groundTiltX(centreX, centreZ) },
      );
      this.flowerBed(
        frame,
        bed.minX - centreX,
        bed.maxX - centreX,
        bed.minZ - centreZ,
        bed.maxZ - centreZ,
        rng,
      );
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
        {
          x: shrub.position.x,
          y: groundHeight(shrub.position.x, shrub.position.z) + shrub.radius * 0.55,
          z: shrub.position.z,
        },
        {},
        { x: shrub.radius, y: shrub.radius * 0.72, z: shrub.radius },
        color,
      );
    }
  }

  private addBuilding(building: Building): void {
    const ground = groundHeight(building.position.x, building.position.z);
    const frame = composeMatrix(
      { x: building.position.x, y: ground, z: building.position.z },
      { y: building.rotationY },
    );
    const at: At = (position, scale, rotation = {}) =>
      frame.clone().multiply(composeMatrix(position, rotation, scale));
    const style = building.style;
    const wall = jitter(style?.wallColor ?? WALL_WHITE, building.id);
    const theme = style
      ? style.trimColor
      : THEME_COLORS[building.kind as keyof typeof THEME_COLORS];
    const volumes = buildingVolumes(building);

    // A plinth of pale stone takes up the slope, so the walls stay level.
    this.batch('box').add(
      at(
        { x: 0, y: PLINTH_LIP - PLINTH_DEPTH / 2, z: 0 },
        { x: building.width + 0.7, y: PLINTH_DEPTH, z: building.depth + 0.7 },
      ),
      COLOR.stone,
    );

    for (const volume of volumes) {
      this.batch('wallBox').add(
        at(
          { x: volume.x, y: volume.base + volume.height / 2, z: volume.z },
          { x: volume.width, y: volume.height, z: volume.depth },
        ),
        wall,
      );
      this.addRoofSurface(at, volume, wall, building.roofHeight);
    }

    const lights: BuildingLights = {
      building,
      paneIndices: [],
      glowIndices: [],
      lit: 0,
      written: -1,
    };

    for (const placement of windowPlacements(building, volumes)) {
      this.addWindow(frame, at, placement, theme, style !== undefined, lights);
    }

    this.addDoorAndFront(at, building, volumes[0], theme);
    if (style) {
      this.addHouseRoof(at, building, style, volumes);
      this.addYard(frame, at, building, style, volumes[0]);
    } else {
      this.addShopRoof(at, building, volumes[0]);
    }

    this.buildingLights.push(lights);
  }

  /** The roof of one volume: a surface a hair greyer than the walls, and a parapet. */
  private addRoofSurface(at: At, volume: Volume, wall: number, parapet: number): void {
    const top = volume.base + volume.height;
    this.batch('box').add(
      at(
        { x: volume.x, y: top + 0.03, z: volume.z },
        { x: volume.width - 0.4, y: 0.06, z: volume.depth - 0.4 },
      ),
      COLOR.roofWhite,
    );
    const thickness = 0.28;
    const box = this.batch('box');
    for (const side of [-1, 1]) {
      box.add(
        at(
          {
            x: volume.x + side * (volume.width / 2 - thickness / 2),
            y: top + parapet / 2,
            z: volume.z,
          },
          { x: thickness, y: parapet, z: volume.depth },
        ),
        wall,
      );
      box.add(
        at(
          {
            x: volume.x,
            y: top + parapet / 2,
            z: volume.z + side * (volume.depth / 2 - thickness / 2),
          },
          { x: volume.width, y: parapet, z: thickness },
        ),
        wall,
      );
    }
  }

  /** One window: frame, sill, pane, glow, and shutters on a house. */
  private addWindow(
    frame: Matrix4,
    at: At,
    placement: WindowPlacement,
    trim: number,
    shutters: boolean,
    lights: BuildingLights,
  ): void {
    const rotation = { y: placement.rotationY };
    const nx = placement.normalX;
    const nz = placement.normalZ;
    // Along the wall, in the building's own axes.
    const tx = Math.cos(placement.rotationY);
    const tz = -Math.sin(placement.rotationY);

    this.batch('windowFrame').add(
      at(
        { x: placement.x, y: placement.y, z: placement.z },
        {
          x: placement.width + 0.2,
          y: placement.height + 0.2,
          z: 0.1,
        },
        rotation,
      ),
      trim,
    );
    this.batch('windowSill').add(
      at(
        {
          x: placement.x + nx * 0.1,
          y: placement.y - placement.height / 2 - 0.1,
          z: placement.z + nz * 0.1,
        },
        { x: placement.width + 0.36, y: 0.08, z: 0.26 },
        rotation,
      ),
      COLOR.ivory,
    );

    if (shutters) {
      const reach = placement.width / 2 + 0.24;
      for (const side of [-1, 1]) {
        this.batch('box').add(
          at(
            {
              x: placement.x + tx * side * reach + nx * 0.05,
              y: placement.y,
              z: placement.z + tz * side * reach + nz * 0.05,
            },
            { x: 0.34, y: placement.height + 0.1, z: 0.06 },
            rotation,
          ),
          trim,
        );
      }
    }

    lights.paneIndices.push(
      this.batch('windowPane').add(
        at(
          { x: placement.x + nx * 0.07, y: placement.y, z: placement.z + nz * 0.07 },
          { x: placement.width, y: placement.height, z: 1 },
          rotation,
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
      this.batch('windowGlow').add(composeMatrix(glowPosition, {}, glowScale), new Color(0, 0, 0)),
    );
    this.windowGlowBillboards.push({ position: glowPosition, scale: glowScale });
  }

  /**
   * The door in the front wall, with its step; and on a shop the awning and
   * the sign in the theme colour that make it a shop (DESIGN.md §4).
   */
  private addDoorAndFront(at: At, building: Building, ground: Volume, theme: number): void {
    const doorHeight = 2.2;
    const shop = building.kind !== 'house';
    const doorWidth = shop ? 2 : 1.2;
    const front = ground.z + ground.depth / 2;
    const rounded = this.batch('roundedBox');

    rounded.add(
      at(
        { x: 0, y: ground.base + doorHeight / 2, z: front + 0.05 },
        { x: doorWidth, y: doorHeight, z: 0.14 },
      ),
      theme,
    );
    rounded.add(
      at(
        { x: 0, y: ground.base + doorHeight + 0.15, z: front + 0.05 },
        { x: doorWidth + 0.3, y: 0.3, z: 0.18 },
      ),
      shop ? theme : COLOR.ivory,
    );
    rounded.add(
      at({ x: 0, y: ground.base + 0.07, z: front + 0.5 }, { x: doorWidth + 0.9, y: 0.14, z: 0.9 }),
      COLOR.stone,
    );

    if (!shop) {
      return;
    }

    const awned =
      building.kind === 'cafe' || building.kind === 'bakery' || building.kind === 'supermarket';
    if (awned) {
      this.batch('box').add(
        at(
          { x: 0, y: ground.base + doorHeight + 0.85, z: front + 0.85 },
          { x: building.width * 0.74, y: 0.1, z: 1.8 },
          { x: -0.32 },
        ),
        theme,
      );
    }

    // The sign: a board in the theme colour with a pale face.
    const signY = ground.base + Math.min(ground.height - 0.8, doorHeight + 1.9);
    rounded.add(
      at({ x: 0, y: signY, z: front + 0.08 }, { x: building.width * 0.42, y: 0.72, z: 0.14 }),
      theme,
    );
    rounded.add(
      at({ x: 0, y: signY, z: front + 0.14 }, { x: building.width * 0.36, y: 0.46, z: 0.08 }),
      COLOR.ivory,
    );
  }

  /**
   * What makes a house's roof its own (DESIGN.md §4): the blue dome on a
   * few, and on the terrace beside the upper storey a washing line, pots, a
   * water tank or a chair. An external stair up the front to the terrace.
   */
  private addHouseRoof(at: At, building: Building, style: HouseStyle, volumes: Volume[]): void {
    const ground = volumes[0];
    const upper = volumes[1];
    const top = upper ?? ground;

    if (style.dome) {
      const y = top.base + top.height;
      this.batch('cylinder').add(
        at({ x: top.x, y: y + 0.28, z: top.z }, { x: 0.95, y: 0.56, z: 0.95 }),
        COLOR.ivory,
      );
      this.batch('dome').add(at({ x: top.x, y: y + 0.52, z: top.z }, 1.05), COLOR.dome);
    }

    // The terrace: the part of the ground roof the upper storey leaves free.
    const terraceX = upper ? -upper.x * 1.5 : 0;
    const terraceY = ground.base + ground.height + 0.06;
    const cylinder = this.batch('cylinder');
    const box = this.batch('box');

    switch (style.roofProp) {
      case 'washing': {
        const span = 1.1;
        for (const side of [-1, 1]) {
          cylinder.add(
            at(
              { x: terraceX + side * span, y: terraceY + 0.8, z: 0 },
              { x: 0.05, y: 1.6, z: 0.05 },
            ),
            COLOR.ironwork,
          );
        }
        box.add(
          at({ x: terraceX, y: terraceY + 1.55, z: 0 }, { x: span * 2, y: 0.03, z: 0.03 }),
          COLOR.ivory,
        );
        const cloths = Number(building.id.slice(-2)) % 2 === 0 ? 3 : 2;
        for (let index = 0; index < cloths; index += 1) {
          const x = terraceX + ((index + 0.5) / cloths - 0.5) * span * 1.7;
          box.add(
            at({ x, y: terraceY + 1.25, z: 0 }, { x: 0.42, y: 0.55, z: 0.03 }),
            CLOTH_COLORS[(Number(building.id.slice(-2)) + index) % CLOTH_COLORS.length],
          );
        }
        break;
      }
      case 'pots':
        for (const offset of [-0.7, 0, 0.7]) {
          cylinder.add(
            at({ x: terraceX + offset, y: terraceY + 0.2, z: 0.6 }, { x: 0.24, y: 0.4, z: 0.24 }),
            0xb8695a,
          );
          this.batch('sphere').add(
            at({ x: terraceX + offset, y: terraceY + 0.55, z: 0.6 }, 0.26),
            COLOR.foliage,
          );
        }
        break;
      case 'tank':
        cylinder.add(
          at({ x: terraceX, y: terraceY + 0.5, z: -0.3 }, { x: 0.55, y: 1, z: 0.55 }),
          COLOR.ivory,
        );
        cylinder.add(
          at({ x: terraceX, y: terraceY + 0.5, z: -0.3 }, { x: 0.58, y: 0.12, z: 0.58 }),
          COLOR.ironwork,
        );
        break;
      case 'chair':
        box.add(
          at({ x: terraceX, y: terraceY + 0.42, z: 0.3 }, { x: 0.5, y: 0.06, z: 0.5 }),
          style.trimColor,
        );
        box.add(
          at({ x: terraceX, y: terraceY + 0.68, z: 0.06 }, { x: 0.5, y: 0.5, z: 0.06 }),
          style.trimColor,
        );
        for (const [dx, dz] of [
          [-0.2, -0.2],
          [0.2, -0.2],
          [-0.2, 0.2],
          [0.2, 0.2],
        ]) {
          box.add(
            at({ x: terraceX + dx, y: terraceY + 0.2, z: 0.3 + dz }, { x: 0.05, y: 0.4, z: 0.05 }),
            style.trimColor,
          );
        }
        break;
    }

    if (style.stair && upper) {
      // Solid masonry steps up the front wall, from the outer corner of the
      // terrace side in towards the upper storey.
      const steps = 7;
      const rise = ground.height / steps;
      const direction = -Math.sign(terraceX);
      const startX = terraceX - direction * (building.width * 0.2 - 0.5);
      for (let index = 0; index < steps; index += 1) {
        const height = rise * (index + 1);
        box.add(
          at(
            {
              x: startX + direction * index * 0.44,
              y: ground.base + height / 2,
              z: ground.z + ground.depth / 2 + 0.5,
            },
            { x: 0.46, y: height, z: 0.9 },
          ),
          COLOR.ivory,
        );
      }
    }
  }

  /** Equipment on a shop's roof: air conditioning, a vent, a tank. */
  private addShopRoof(at: At, building: Building, volume: Volume): void {
    const top = volume.base + volume.height + 0.06;
    const rounded = this.batch('roundedBox');
    const cylinder = this.batch('cylinder');
    const units = building.kind === 'office' ? 3 : 2;
    for (let index = 0; index < units; index += 1) {
      const x = ((index + 0.5) / units - 0.5) * building.width * 0.5;
      rounded.add(
        at({ x, y: top + 0.36, z: -building.depth * 0.22 }, { x: 1, y: 0.72, z: 0.7 }),
        COLOR.equipment,
      );
    }
    cylinder.add(
      at(
        { x: building.width * 0.3, y: top + 0.45, z: building.depth * 0.2 },
        {
          x: 0.3,
          y: 0.9,
          z: 0.3,
        },
      ),
      COLOR.equipment,
    );
    cylinder.add(
      at(
        { x: -building.width * 0.3, y: top + 0.5, z: building.depth * 0.18 },
        {
          x: 0.6,
          y: 1,
          z: 0.6,
        },
      ),
      COLOR.ivory,
    );
  }

  /**
   * The flower bed and one prop that make a house its own home (DESIGN.md
   * §4), in front of its door: +Z is the street side.
   */
  private addYard(
    frame: Matrix4,
    at: At,
    building: Building,
    style: HouseStyle,
    ground: Volume,
  ): void {
    const front = ground.z + ground.depth / 2;
    const box = this.batch('box');
    const rounded = this.batch('roundedBox');
    const cylinder = this.batch('cylinder');

    if (style.flowerBed) {
      const rng = new Rng(`${building.id}:flowers`);
      const bedWidth = building.width * 0.34;
      this.flowerBed(
        frame,
        building.width / 2 - bedWidth - 0.2,
        building.width / 2 - 0.2,
        front + 0.55,
        front + 1.35,
        rng,
      );
    }

    const propX = -(building.width / 2 - 0.9);
    const propZ = front + 2.4;
    switch (style.prop) {
      case 'mailbox':
        cylinder.add(
          at({ x: propX, y: 0.55, z: propZ }, { x: 0.06, y: 1.1, z: 0.06 }),
          COLOR.ironwork,
        );
        rounded.add(
          at({ x: propX, y: 1.2, z: propZ }, { x: 0.34, y: 0.3, z: 0.5 }),
          style.trimColor,
        );
        break;
      case 'bin':
        cylinder.add(at({ x: propX, y: 0.45, z: propZ }, { x: 0.34, y: 0.9, z: 0.34 }), 0x5f6b73);
        break;
      case 'bicycle': {
        for (const offset of [-0.5, 0.5]) {
          this.batch('torus').add(at({ x: propX + offset, y: 0.36, z: propZ }, 1), COLOR.ironwork);
        }
        box.add(at({ x: propX, y: 0.62, z: propZ }, { x: 1.0, y: 0.06, z: 0.06 }), style.trimColor);
        box.add(
          at({ x: propX - 0.15, y: 0.8, z: propZ }, { x: 0.06, y: 0.4, z: 0.06 }),
          style.trimColor,
        );
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

  /**
   * The church at the top of the slope (DESIGN.md §4): a white nave under a
   * deep blue dome, a bell tower with open arches, a cross, and a warm lamp
   * on the dome at night.
   */
  private addChurch(): void {
    const { position, width, depth, rotationY } = CHURCH;
    const ground = groundHeight(position.x, position.z);
    const frame = composeMatrix({ x: position.x, y: ground, z: position.z }, { y: rotationY });
    const at: At = (place, scale, rotation = {}) =>
      frame.clone().multiply(composeMatrix(place, rotation, scale));
    const box = this.batch('box');
    const walls = this.batch('wallBox');
    const wallHeight = 7;
    const front = depth / 2;

    box.add(
      at(
        { x: 0, y: PLINTH_LIP - PLINTH_DEPTH / 2, z: 0 },
        { x: width + 1.2, y: PLINTH_DEPTH, z: depth + 1.2 },
      ),
      COLOR.stone,
    );
    // A forecourt in front of the door, out to the town.
    box.add(at({ x: 0, y: 0.05, z: front + 3 }, { x: width + 4, y: 0.1, z: 6 }), COLOR.stone);

    const nave: Volume = {
      x: 0,
      z: 0,
      width,
      depth,
      base: PLINTH_LIP,
      height: wallHeight,
      floors: 1,
    };
    walls.add(
      at({ x: 0, y: nave.base + wallHeight / 2, z: 0 }, { x: width, y: wallHeight, z: depth }),
      WALL_WHITE,
    );
    this.addRoofSurface(at, nave, WALL_WHITE, 0.5);

    // The dome on its drum, over the middle of the nave.
    const domeRadius = 3.4;
    const drumTop = nave.base + wallHeight + 1.6;
    this.batch('cylinder').add(
      at(
        { x: 0, y: nave.base + wallHeight + 0.8, z: -1 },
        { x: domeRadius - 0.1, y: 1.6, z: domeRadius - 0.1 },
      ),
      WALL_WHITE,
    );
    this.batch('dome').add(at({ x: 0, y: drumTop, z: -1 }, domeRadius), COLOR.dome);
    // The cross on the dome, and the lamp beside it.
    box.add(
      at({ x: 0, y: drumTop + domeRadius + 0.7, z: -1 }, { x: 0.12, y: 1.4, z: 0.12 }),
      COLOR.ivory,
    );
    box.add(
      at({ x: 0, y: drumTop + domeRadius + 0.95, z: -1 }, { x: 0.7, y: 0.12, z: 0.12 }),
      COLOR.ivory,
    );
    const lamp = new Vector3(0, drumTop + domeRadius + 0.2, -1).applyMatrix4(frame);
    this.batch('lampCylinder').add(composeMatrix(lamp, {}, { x: 0.18, y: 0.3, z: 0.18 }));
    this.batch('lampHalo').add(composeMatrix(lamp, {}, 7));
    this.lampHaloBillboards.push({ position: lamp, scale: 7 });

    // The bell tower on the front corner: open arches near the top, a small
    // dome and a cross.
    const towerX = width / 2 - 1.6;
    const towerZ = front - 1.6;
    const towerHeight = 13;
    walls.add(
      at(
        { x: towerX, y: PLINTH_LIP + towerHeight / 2, z: towerZ },
        { x: 2.8, y: towerHeight, z: 2.8 },
      ),
      WALL_WHITE,
    );
    for (const rotation of [0, Math.PI / 2]) {
      box.add(
        at(
          { x: towerX, y: PLINTH_LIP + towerHeight - 2.2, z: towerZ },
          { x: 1.1, y: 2.2, z: 3.0 },
          { y: rotation },
        ),
        0x2a2a30,
      );
    }
    this.batch('cylinder').add(
      at({ x: towerX, y: PLINTH_LIP + towerHeight - 2.9, z: towerZ }, { x: 0.22, y: 0.5, z: 0.22 }),
      0x8a6a3a,
    );
    this.batch('dome').add(
      at({ x: towerX, y: PLINTH_LIP + towerHeight, z: towerZ }, 1.5),
      COLOR.dome,
    );
    box.add(
      at({ x: towerX, y: PLINTH_LIP + towerHeight + 2.1, z: towerZ }, { x: 0.1, y: 1.2, z: 0.1 }),
      COLOR.ivory,
    );
    box.add(
      at({ x: towerX, y: PLINTH_LIP + towerHeight + 2.3, z: towerZ }, { x: 0.6, y: 0.1, z: 0.1 }),
      COLOR.ivory,
    );

    // The door, and the windows down the sides, all in deep blue.
    this.batch('roundedBox').add(
      at({ x: -1, y: PLINTH_LIP + 1.5, z: front + 0.05 }, { x: 1.8, y: 3, z: 0.14 }),
      COLOR.dome,
    );
    this.batch('roundedBox').add(
      at({ x: -1, y: PLINTH_LIP + 3.2, z: front + 0.05 }, { x: 2.2, y: 0.4, z: 0.16 }),
      COLOR.dome,
    );
    for (const side of [-1, 1]) {
      for (const along of [-5, -1.5, 2]) {
        this.batch('windowFrame').add(
          at(
            { x: side * (width / 2 + 0.02), y: PLINTH_LIP + 3.6, z: along },
            { x: 0.9, y: 2.2, z: 0.1 },
            { y: Math.PI / 2 },
          ),
          COLOR.dome,
        );
      }
    }
  }

  /**
   * The lighthouse on the headland (DESIGN.md §4): a white tower with a red
   * band on a rock, a lamp room, and the beam that sweeps round at night.
   */
  private addLighthouse(): void {
    const { position, height } = LIGHTHOUSE;
    const ground = groundHeight(position.x, position.z);
    const cylinder = this.batch('cylinder');
    const x = position.x;
    const z = position.z;

    cylinder.place({ x, y: ground + 0.4, z }, {}, { x: 4.2, y: 1.6, z: 4.2 }, COLOR.stone);
    cylinder.place(
      { x, y: ground + 1.2 + height / 2, z },
      {},
      { x: 1.55, y: height, z: 1.55 },
      WALL_WHITE,
    );
    cylinder.place(
      { x, y: ground + 1.2 + height * 0.45, z },
      {},
      { x: 1.6, y: 2, z: 1.6 },
      0xc0473c,
    );
    // Gallery, lamp room and cap.
    const galleryY = ground + 1.2 + height;
    cylinder.place({ x, y: galleryY, z }, {}, { x: 2.2, y: 0.3, z: 2.2 }, COLOR.ironwork);
    const lampY = galleryY + 1.05;
    this.batch('lampCylinder').place({ x, y: lampY, z }, {}, { x: 1.05, y: 1.5, z: 1.05 });
    this.batch('cone').place({ x, y: lampY + 1.2, z }, {}, { x: 1.3, y: 0.9, z: 1.3 }, 0xc0473c);
    const halo = new Vector3(x, lampY, z);
    this.batch('lampHalo').add(composeMatrix(halo, {}, 9));
    this.lampHaloBillboards.push({ position: halo, scale: 9 });

    this.beam.position.set(x, lampY, z);
    this.root.add(this.beam);
  }

  private addTrees(): void {
    const rng = new Rng('trees');
    const trunks = this.batch('trunk');
    const crowns = this.batch('crown');
    const layers = this.batch('pineLayer');

    for (const tree of TREES) {
      const frame = composeMatrix(
        {
          x: tree.position.x,
          y: groundHeight(tree.position.x, tree.position.z),
          z: tree.position.z,
        },
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
      const ground = groundHeight(x, z);
      const top = ground + STREET_LAMP_HEIGHT;
      this.batch('lampPole').place(
        { x, y: ground + STREET_LAMP_HEIGHT / 2, z },
        {},
        1,
        COLOR.ironwork,
      );
      this.batch('lampHead').place({ x, y: top, z });
      this.batch('lampBulb').place({ x, y: top - 0.22, z });

      const haloPosition = new Vector3(x, top - 0.22, z);
      this.batch('lampHalo').add(composeMatrix(haloPosition, {}, 3));
      this.lampHaloBillboards.push({ position: haloPosition, scale: 3 });

      this.batch('lampPool').place(
        { x, y: ground + PAVEMENT_HEIGHT + 0.04, z },
        { x: groundTiltX(x, z) },
        { x: 9, z: 9 },
      );
    }
  }

  private addStreetSigns(): void {
    for (const sign of STREET_SIGNS) {
      const frame = composeMatrix(
        {
          x: sign.position.x,
          y: groundHeight(sign.position.x, sign.position.z),
          z: sign.position.z,
        },
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
  update(
    world: World,
    environment: EnvironmentState,
    deltaSeconds: number,
    elapsedSeconds: number,
    camera: Camera,
  ): void {
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

    // The beam sweeps on real time: at 20x the town sees a slow pulse.
    this.beamMaterial.opacity = this.lampLit * 0.22;
    this.beam.visible = this.lampLit > 0.01;
    this.beam.rotation.y = (elapsedSeconds * Math.PI * 2) / BEAM_PERIOD_SECONDS;

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

/** A solid part of a building, in its local space: x across, +z the front, y up. */
interface Volume {
  x: number;
  z: number;
  width: number;
  depth: number;
  base: number;
  height: number;
  floors: number;
}

/** Places something in a building's frame: position, scale, then rotation. */
type At = (
  position: Placement,
  scale: Scale,
  rotation?: { x?: number; y?: number; z?: number },
) => Matrix4;

/**
 * The cubes a building is made of (DESIGN.md §4). A house is a full ground
 * storey with a smaller upper storey set back to one side, leaving a roof
 * terrace; a few houses and every public building are a single cube.
 */
function buildingVolumes(building: Building): Volume[] {
  const style = building.style;
  const base = PLINTH_LIP;
  if (!style || style.upper === 'none') {
    return [
      {
        x: 0,
        z: 0,
        width: building.width,
        depth: building.depth,
        base,
        height: building.wallHeight,
        floors: building.floors,
      },
    ];
  }
  const groundHeight = building.wallHeight * 0.52;
  const side = style.upper === 'left' ? -1 : 1;
  return [
    {
      x: 0,
      z: 0,
      width: building.width,
      depth: building.depth,
      base,
      height: groundHeight,
      floors: 1,
    },
    {
      x: side * building.width * 0.2,
      z: -building.depth * 0.04,
      width: building.width * 0.6,
      depth: building.depth * 0.92,
      base: base + groundHeight,
      height: building.wallHeight - groundHeight,
      floors: 1,
    },
  ];
}

/**
 * Lays out windows on the four walls of every volume, in the building's
 * local space. Houses get small windows; a shop's ground floor front is
 * glazed wide.
 */
function windowPlacements(building: Building, volumes: Volume[]): WindowPlacement[] {
  const placements: WindowPlacement[] = [];
  const shop = building.kind !== 'house';
  const offset = 0.02;

  volumes.forEach((volume, volumeIndex) => {
    const floorHeight = volume.height / volume.floors;
    const facades = [
      { rotationY: 0, normalX: 0, normalZ: 1, span: volume.width, reach: volume.depth / 2 },
      { rotationY: Math.PI, normalX: 0, normalZ: -1, span: volume.width, reach: volume.depth / 2 },
      {
        rotationY: Math.PI / 2,
        normalX: 1,
        normalZ: 0,
        span: volume.depth,
        reach: volume.width / 2,
      },
      {
        rotationY: -Math.PI / 2,
        normalX: -1,
        normalZ: 0,
        span: volume.depth,
        reach: volume.width / 2,
      },
    ];

    for (const facade of facades) {
      for (let floor = 0; floor < volume.floors; floor += 1) {
        const isFront = facade.rotationY === 0 && volumeIndex === 0 && floor === 0;
        const shopFront = shop && isFront;
        const width = shopFront ? 2.4 : shop ? 1.4 : 0.95;
        const height = shopFront ? 2.1 : shop ? 1.5 : 1.15;
        const gap = shopFront ? 1.0 : 1.9;
        const columns = Math.max(1, Math.min(6, Math.floor(facade.span / (width + gap))));
        const y = volume.base + floorHeight * (floor + (shopFront ? 0.5 : 0.56));
        for (let column = 0; column < columns; column += 1) {
          const along = ((column + 0.5) / columns - 0.5) * facade.span * 0.82;
          // The front wall keeps its middle clear for the door.
          if (isFront && Math.abs(along) < (shop ? 1.6 : 1.4)) {
            continue;
          }
          placements.push({
            x: volume.x + (facade.normalX === 0 ? along : facade.normalX * (facade.reach + offset)),
            y,
            z: volume.z + (facade.normalZ === 0 ? along : facade.normalZ * (facade.reach + offset)),
            width,
            height,
            rotationY: facade.rotationY,
            normalX: facade.normalX,
            normalZ: facade.normalZ,
          });
        }
      }
    }
  });

  return placements;
}

/**
 * The lighthouse beam: two long soft cones, back to back, drawn additive so
 * they read as light in the air. The mesh turns about its own Y each frame.
 */
function makeBeam(material: MeshBasicMaterial): Mesh {
  const cone = new CylinderGeometry(0.4, 3.2, BEAM_LENGTH, 10, 1, true);
  cone.translate(0, -BEAM_LENGTH / 2, 0);
  cone.rotateZ(Math.PI / 2);
  const other = cone.clone().rotateY(Math.PI);
  const geometry = mergeGeometries([cone, other]);
  const beam = new Mesh(geometry, material);
  beam.name = 'lighthouse-beam';
  beam.frustumCulled = false;
  return beam;
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

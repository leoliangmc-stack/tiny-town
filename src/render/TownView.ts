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
  TorusGeometry,
  type Sprite,
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
import { createGlowSprite, glowTexture } from './glow.js';

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

/** Corner radius of every rounded box: enough to read as soft, not as a pillow. */
const ROUNDING = 0.3;

/** One building's meshes, plus the materials whose glow is animated. */
interface BuildingView {
  building: Building;
  windowMaterial: MeshStandardMaterial;
  windowGlows: Sprite[];
  /** Current lit amount, eased towards the target so lights fade in. */
  lit: number;
}

/**
 * Everything standing still in the town: ground, roads, pavements, buildings
 * and their yards, outdoor zones, the park, the car park, trees, shrubs,
 * flower beds, lamps and signs.
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
      color: COLOR.ironwork,
      emissive: new Color(LAMP_EMISSIVE),
      emissiveIntensity: 0,
      roughness: 0.8,
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
    this.addFlowerBeds();
    this.addShrubs();

    for (const building of BUILDINGS) {
      this.addBuilding(building);
    }

    this.addTrees();
    this.addStreetLamps();
    this.addStreetSigns();
  }

  private addGround(): void {
    const ground = new Mesh(new PlaneGeometry(GROUND_SIZE, GROUND_SIZE), matte(COLOR.grass));
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    ground.name = 'ground';
    this.root.add(ground);
  }

  /** Tarmac, raised kerbs and a dashed centre line for every street. */
  private addStreets(): void {
    const roadMaterial = matte(COLOR.road);
    const kerbMaterial = matte(COLOR.pavement);
    const markingMaterial = matte(COLOR.marking);

    for (const street of STREETS) {
      const length = street.to - street.from;

      const road = new Mesh(slab(length, ROAD_WIDTH, street.axis), roadMaterial);
      road.position.set(...slabPosition(street, 0, LAYER_ROAD));
      road.receiveShadow = true;
      this.root.add(road);

      const kerbWidth = SIDEWALK_EDGE - ROAD_WIDTH / 2;
      for (const side of [-1, 1] as const) {
        const kerb = new Mesh(
          street.axis === 'x'
            ? new BoxGeometry(length + kerbWidth * 2, PAVEMENT_HEIGHT, kerbWidth)
            : new BoxGeometry(kerbWidth, PAVEMENT_HEIGHT, length + kerbWidth * 2),
          kerbMaterial,
        );
        const offset = side * (ROAD_WIDTH / 2 + kerbWidth / 2);
        kerb.position.set(...slabPosition(street, offset, PAVEMENT_HEIGHT / 2));
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

    this.addZebraCrossings(markingMaterial);
  }

  private addCentreLine(street: Street, material: MeshStandardMaterial): void {
    const dashLength = 2.6;
    const gap = 4;
    const step = dashLength + gap;
    // Keep the dashes clear of the junction patches at either end.
    const count = Math.floor((street.to - street.from - SIDEWALK_EDGE * 2) / step);

    const dashes = new InstancedMesh(slab(dashLength, 0.26, street.axis), material, count);
    dashes.receiveShadow = true;
    const placement = new Object3D();

    for (let index = 0; index < count; index += 1) {
      const along = street.from + SIDEWALK_EDGE + gap / 2 + index * step + dashLength / 2;
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

  /** Painted stripes across each arm of every junction (DESIGN.md §7). */
  private addZebraCrossings(material: MeshStandardMaterial): void {
    const stripeLength = 1.8;
    const stripeWidth = 0.55;
    const stripesPerCrossing = 6;
    const crossings = junctions();
    const arms = 4;

    const stripes = new InstancedMesh(
      slab(stripeLength, stripeWidth, 'x'),
      material,
      crossings.length * arms * stripesPerCrossing,
    );
    stripes.receiveShadow = true;
    const placement = new Object3D();
    let index = 0;

    for (const junction of crossings) {
      for (const [dx, dz] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        // A crossing sits just past the pavement corner on each arm.
        const along = SIDEWALK_EDGE + stripeLength / 2 + 0.4;
        const armIsX = dx !== 0;
        if (!this.streetContinues(junction, dx, dz)) {
          index += stripesPerCrossing;
          continue;
        }
        for (let stripe = 0; stripe < stripesPerCrossing; stripe += 1) {
          const across = ((stripe + 0.5) / stripesPerCrossing - 0.5) * (ROAD_WIDTH - 0.6);
          placement.position.set(
            junction.x + (armIsX ? dx * along : across),
            LAYER_MARKING,
            junction.z + (armIsX ? across : dz * along),
          );
          placement.rotation.y = armIsX ? 0 : Math.PI / 2;
          placement.updateMatrix();
          stripes.setMatrixAt(index, placement.matrix);
          index += 1;
        }
      }
    }
    stripes.count = index;
    stripes.instanceMatrix.needsUpdate = true;
    this.root.add(stripes);
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
      const patch = new Mesh(
        new PlaneGeometry(zone.maxX - zone.minX, zone.maxZ - zone.minZ),
        matte(ZONE_COLORS[zone.kind]),
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
    const tableMaterial = matte(COLOR.wood);
    const stoolMaterial = matte(COLOR.ironwork);

    for (const spawn of zone.spawnPoints) {
      const table = new Mesh(new CylinderGeometry(0.5, 0.45, 0.72, 12), tableMaterial);
      table.position.set(spawn.x + 0.9, 0.36, spawn.z);
      table.castShadow = true;
      this.root.add(table);

      for (const side of [-0.75, 0.75]) {
        const stool = new Mesh(new CylinderGeometry(0.2, 0.2, 0.42, 10), stoolMaterial);
        stool.position.set(spawn.x + 0.9, 0.21, spawn.z + side);
        stool.castShadow = true;
        this.root.add(stool);
      }
    }
  }

  /** A climbing frame, so the schoolyard reads as a schoolyard from above. */
  private addPlaygroundFrame(zone: OutdoorZone): void {
    const material = matte(0x5f8fb5);
    const centreX = (zone.minX + zone.maxX) / 2;
    const centreZ = (zone.minZ + zone.maxZ) / 2;

    for (const offset of [-2.2, 2.2]) {
      const post = new Mesh(new CylinderGeometry(0.11, 0.11, 2.4, 8), material);
      post.position.set(centreX + offset, 1.2, centreZ);
      post.castShadow = true;
      this.root.add(post);
    }
    const bar = new Mesh(new CylinderGeometry(0.11, 0.11, 4.8, 8), material);
    bar.rotation.z = Math.PI / 2;
    bar.position.set(centreX, 2.4, centreZ);
    bar.castShadow = true;
    this.root.add(bar);
  }

  /** A path across the park and a few benches. */
  private addParkPathAndBenches(zone: OutdoorZone): void {
    const centreZ = (zone.minZ + zone.maxZ) / 2;

    const path = new Mesh(new PlaneGeometry(zone.maxX - zone.minX, 2.6), matte(COLOR.parkPath));
    path.rotation.x = -Math.PI / 2;
    path.position.set((zone.minX + zone.maxX) / 2, LAYER_ZONE, centreZ);
    path.receiveShadow = true;
    this.root.add(path);

    const benchMaterial = matte(COLOR.wood);
    for (const offset of [-7, 0, 7]) {
      const seat = new Mesh(new RoundedBoxGeometry(2.2, 0.2, 0.6, 2, 0.06), benchMaterial);
      seat.position.set((zone.minX + zone.maxX) / 2 + offset, 0.45, centreZ - 2.4);
      seat.castShadow = true;
      this.root.add(seat);

      const back = new Mesh(new RoundedBoxGeometry(2.2, 0.5, 0.12, 2, 0.05), benchMaterial);
      back.position.set((zone.minX + zone.maxX) / 2 + offset, 0.8, centreZ - 2.65);
      back.castShadow = true;
      this.root.add(back);
    }
  }

  /** Tarmac and painted bays for the car park at the east end. */
  private addParkingLot(): void {
    const surface = new Mesh(
      new PlaneGeometry(PARKING_LOT.maxX - PARKING_LOT.minX, PARKING_LOT.maxZ - PARKING_LOT.minZ),
      matte(COLOR.parking),
    );
    surface.rotation.x = -Math.PI / 2;
    surface.position.set(
      (PARKING_LOT.minX + PARKING_LOT.maxX) / 2,
      LAYER_ROAD,
      (PARKING_LOT.minZ + PARKING_LOT.maxZ) / 2,
    );
    surface.receiveShadow = true;
    this.root.add(surface);

    const lineMaterial = matte(COLOR.marking);
    for (const space of PARKING_LOT.spaces) {
      for (const side of [-2.2, 2.2]) {
        const line = new Mesh(new PlaneGeometry(0.2, 5.6), lineMaterial);
        line.rotation.x = -Math.PI / 2;
        line.position.set(space.x + side, LAYER_MARKING, space.z);
        this.root.add(line);
      }
    }

    // A short apron joining the lot to the road it hangs off.
    const apron = new Mesh(new PlaneGeometry(4.5, 6), matte(COLOR.parking));
    apron.rotation.x = -Math.PI / 2;
    apron.position.set(PARKING_LOT.entrance.x - 2, LAYER_ROAD, PARKING_LOT.entrance.z);
    apron.receiveShadow = true;
    this.root.add(apron);
  }

  /** Low beds of soil with a scatter of flowers on top. */
  private addFlowerBeds(): void {
    const rng = new Rng('flowers');
    const soil = matte(COLOR.soil);

    for (const bed of FLOWER_BEDS) {
      this.root.add(
        flowerBed(bed.minX, bed.maxX, bed.minZ, bed.maxZ, soil, rng, new Object3D(), 0),
      );
    }
  }

  private addShrubs(): void {
    const rng = new Rng('shrubs');
    for (const shrub of SHRUBS) {
      const blob = new Mesh(
        new IcosahedronGeometry(shrub.radius, 1),
        matte(new Color(COLOR.foliage).offsetHSL(0, rng.nextFloat(-0.05, 0.05), -0.04).getHex()),
      );
      blob.position.set(shrub.position.x, shrub.radius * 0.55, shrub.position.z);
      blob.scale.set(1, 0.72, 1);
      blob.castShadow = true;
      this.root.add(blob);
    }
  }

  private addBuilding(building: Building): void {
    const group = new Group();
    group.position.set(building.position.x, 0, building.position.z);
    group.rotation.y = building.rotationY;
    group.name = building.id;

    const wallMaterial = matte(wallColor(building));
    const walls = new Mesh(
      new RoundedBoxGeometry(building.width, building.wallHeight, building.depth, 3, ROUNDING),
      wallMaterial,
    );
    walls.position.y = building.wallHeight / 2;
    walls.castShadow = true;
    walls.receiveShadow = true;
    group.add(walls);

    group.add(roofFor(building));

    const windowMaterial = new MeshStandardMaterial({
      color: COLOR.glass,
      emissive: new Color(WINDOW_EMISSIVE),
      emissiveIntensity: 0,
      roughness: 0.55,
      metalness: 0,
      side: DoubleSide,
    });
    const frameMaterial = matte(building.style?.trimColor ?? COLOR.ivory);

    const windowGlows: Sprite[] = [];
    for (const placement of windowPlacements(building)) {
      const frame = new Mesh(
        new BoxGeometry(placement.width + 0.24, placement.height + 0.24, 0.12),
        frameMaterial,
      );
      frame.position.set(placement.x, placement.y, placement.z);
      frame.rotation.y = placement.rotationY;
      group.add(frame);

      const pane = new Mesh(new PlaneGeometry(placement.width, placement.height), windowMaterial);
      pane.position.set(
        placement.x + placement.normalX * 0.07,
        placement.y,
        placement.z + placement.normalZ * 0.07,
      );
      pane.rotation.y = placement.rotationY;
      group.add(pane);

      const glow = createGlowSprite(WINDOW_EMISSIVE, Math.max(placement.width, 1.1) * 2.4);
      glow.position.set(
        placement.x + placement.normalX * 0.4,
        placement.y,
        placement.z + placement.normalZ * 0.4,
      );
      group.add(glow);
      windowGlows.push(glow);
    }

    this.addDoorAndTrim(group, building);
    if (building.style) {
      this.addYard(group, building, building.style);
    }

    this.root.add(group);
    this.buildingViews.push({ building, windowMaterial, windowGlows, lit: 0 });
  }

  /** A door on the front wall, plus whatever marks the building out. */
  private addDoorAndTrim(group: Group, building: Building): void {
    const doorHeight = 2.2;
    const doorWidth = building.kind === 'house' ? 1.2 : 2.2;
    const door = new Mesh(
      new RoundedBoxGeometry(doorWidth, doorHeight, 0.16, 2, 0.05),
      matte(building.style?.trimColor === COLOR.ivory ? COLOR.wood : 0x5a4636),
    );
    door.position.set(0, doorHeight / 2, building.depth / 2 + 0.06);
    group.add(door);

    if (building.kind === 'cafe' || building.kind === 'bakery') {
      const awning = new Mesh(
        new RoundedBoxGeometry(building.width * 0.72, 0.22, 2.4, 2, 0.08),
        matte(building.kind === 'cafe' ? COLOR.awningCafe : COLOR.awningBakery),
      );
      awning.position.set(0, doorHeight + 0.9, building.depth / 2 + 1);
      awning.castShadow = true;
      group.add(awning);
    }

    if (building.kind === 'apartment') {
      const canopy = new Mesh(new RoundedBoxGeometry(3.4, 0.2, 1.6, 2, 0.06), matte(COLOR.ivory));
      canopy.position.set(0, doorHeight + 0.5, building.depth / 2 + 0.7);
      canopy.castShadow = true;
      group.add(canopy);
    }

    if (building.kind === 'school') {
      // A little bell tower, so the school is recognisable from above.
      const tower = new Mesh(new RoundedBoxGeometry(3, 3.4, 3, 2, 0.2), matte(COLOR.ivory));
      tower.position.set(0, building.wallHeight + 1.7, 0);
      tower.castShadow = true;
      group.add(tower);

      const cap = new Mesh(new ConeGeometry(2.4, 2, 4), matte(0x8a6a52));
      cap.position.set(0, building.wallHeight + 4.4, 0);
      cap.rotation.y = Math.PI / 4;
      cap.castShadow = true;
      group.add(cap);
    }

    if (building.kind === 'supermarket') {
      const sign = new Mesh(
        new RoundedBoxGeometry(building.width * 0.6, 1.3, 0.3, 2, 0.1),
        new MeshStandardMaterial({
          color: 0x4f7a5c,
          emissive: new Color(0x8fcf9f),
          emissiveIntensity: 0.25,
          roughness: 0.8,
        }),
      );
      sign.position.set(0, building.wallHeight - 1.4, building.depth / 2 + 0.15);
      group.add(sign);
    }
  }

  /**
   * The porch, balcony, fence, flower bed and one prop that make a house its
   * own home (DESIGN.md §4). Everything is placed in the house's local space,
   * in front of its door: +Z is the street side.
   */
  private addYard(group: Group, building: Building, style: HouseStyle): void {
    const front = building.depth / 2;
    const trim = matte(style.trimColor);

    if (style.porch) {
      const deck = new Mesh(new RoundedBoxGeometry(building.width * 0.55, 0.2, 2, 2, 0.06), trim);
      deck.position.set(0, 0.1, front + 1);
      deck.receiveShadow = true;
      group.add(deck);

      for (const side of [-1, 1]) {
        const post = new Mesh(new CylinderGeometry(0.09, 0.09, 2.5, 8), trim);
        post.position.set(side * (building.width * 0.27 - 0.2), 1.45, front + 1.8);
        post.castShadow = true;
        group.add(post);
      }
      const canopy = new Mesh(
        new RoundedBoxGeometry(building.width * 0.6, 0.18, 2.3, 2, 0.06),
        matte(style.roofColor),
      );
      canopy.position.set(0, 2.75, front + 1);
      canopy.castShadow = true;
      group.add(canopy);
    }

    if (style.balcony) {
      const floorHeight = building.wallHeight / building.floors;
      const y = floorHeight * 1.05;
      const deck = new Mesh(new RoundedBoxGeometry(3.2, 0.18, 1.2, 2, 0.05), trim);
      deck.position.set(building.width * 0.22, y, front + 0.6);
      deck.castShadow = true;
      group.add(deck);

      const rail = new Mesh(new BoxGeometry(3.2, 0.7, 0.08), trim);
      rail.position.set(building.width * 0.22, y + 0.45, front + 1.16);
      group.add(rail);
    }

    if (style.fence) {
      const fenceZ = front + 3.6;
      const halfWidth = building.width / 2 + 1;
      const rail = new Mesh(new BoxGeometry(halfWidth * 2, 0.08, 0.08), matte(COLOR.wood));
      rail.position.set(0, 0.55, fenceZ);
      group.add(rail);

      const postCount = Math.round(halfWidth * 2);
      const posts = new InstancedMesh(
        new BoxGeometry(0.12, 0.8, 0.12),
        matte(COLOR.wood),
        postCount,
      );
      posts.castShadow = true;
      const placement = new Object3D();
      for (let index = 0; index < postCount; index += 1) {
        // Leave the middle open as a gate.
        const x = -halfWidth + (index / (postCount - 1)) * halfWidth * 2;
        placement.position.set(x, 0.4, fenceZ);
        placement.scale.setScalar(Math.abs(x) < 0.8 ? 0.001 : 1);
        placement.updateMatrix();
        posts.setMatrixAt(index, placement.matrix);
      }
      posts.instanceMatrix.needsUpdate = true;
      group.add(posts);
    }

    if (style.flowerBed) {
      const rng = new Rng(`${building.id}:flowers`);
      const bedWidth = building.width * 0.38;
      group.add(
        flowerBed(
          building.width / 2 - bedWidth - 0.2,
          building.width / 2 - 0.2,
          front + 0.35,
          front + 1.15,
          matte(COLOR.soil),
          rng,
          new Object3D(),
          0,
        ),
      );
    }

    const propX = -(building.width / 2 - 0.9);
    const propZ = front + 2.6;
    switch (style.prop) {
      case 'mailbox': {
        const post = new Mesh(new CylinderGeometry(0.06, 0.06, 1.1, 6), matte(COLOR.ironwork));
        post.position.set(propX, 0.55, propZ);
        group.add(post);
        const box = new Mesh(new RoundedBoxGeometry(0.34, 0.3, 0.5, 2, 0.08), matte(0xd97b6c));
        box.position.set(propX, 1.2, propZ);
        box.castShadow = true;
        group.add(box);
        break;
      }
      case 'bin': {
        const bin = new Mesh(new CylinderGeometry(0.34, 0.3, 0.9, 10), matte(0x5f6b73));
        bin.position.set(propX, 0.45, propZ);
        bin.castShadow = true;
        group.add(bin);
        break;
      }
      case 'bicycle': {
        const wheelMaterial = matte(COLOR.ironwork);
        for (const offset of [-0.5, 0.5]) {
          const wheel = new Mesh(new TorusGeometry(0.34, 0.05, 6, 16), wheelMaterial);
          wheel.position.set(propX + offset, 0.36, propZ);
          wheel.castShadow = true;
          group.add(wheel);
        }
        const frame = new Mesh(new BoxGeometry(1.0, 0.06, 0.06), matte(0x5f8fb5));
        frame.position.set(propX, 0.62, propZ);
        group.add(frame);
        const seatPost = new Mesh(new BoxGeometry(0.06, 0.4, 0.06), matte(0x5f8fb5));
        seatPost.position.set(propX - 0.15, 0.8, propZ);
        group.add(seatPost);
        break;
      }
      case 'flower-pots': {
        const pot = matte(0xb8695a);
        for (const offset of [-0.5, 0, 0.5]) {
          const pot1 = new Mesh(new CylinderGeometry(0.2, 0.15, 0.32, 10), pot);
          pot1.position.set(propX + offset, 0.16, propZ);
          pot1.castShadow = true;
          group.add(pot1);
          const bloom = new Mesh(
            new SphereGeometry(0.2, 10, 8),
            matte(FLOWER_COLORS[Math.abs(Math.round(offset * 2)) % FLOWER_COLORS.length]),
          );
          bloom.position.set(propX + offset, 0.42, propZ);
          group.add(bloom);
        }
        break;
      }
      case 'none':
        break;
    }
  }

  private addTrees(): void {
    const rng = new Rng('trees');

    for (const tree of TREES) {
      const group = new Group();
      group.position.set(tree.position.x, 0, tree.position.z);
      group.rotation.y = rng.nextFloat(0, Math.PI * 2);

      const trunkHeight = tree.height * 0.4;
      const trunk = new Mesh(new CylinderGeometry(0.26, 0.4, trunkHeight, 8), matte(COLOR.trunk));
      trunk.position.y = trunkHeight / 2;
      trunk.castShadow = true;
      group.add(trunk);

      const base = tree.shape === 'pine' ? COLOR.pine : COLOR.foliage;
      const foliageMaterial = matte(
        new Color(base)
          .offsetHSL(
            rng.nextFloat(-0.025, 0.025),
            rng.nextFloat(-0.06, 0.06),
            rng.nextFloat(-0.05, 0.05),
          )
          .getHex(),
      );

      if (tree.shape === 'pine') {
        for (let layer = 0; layer < 3; layer += 1) {
          const radius = 2.3 - layer * 0.55;
          const height = tree.height * 0.42;
          const cone = new Mesh(new ConeGeometry(radius, height, 12), foliageMaterial);
          cone.position.y = trunkHeight + layer * (tree.height * 0.2) + height / 2;
          cone.castShadow = true;
          group.add(cone);
        }
      } else {
        // Two soft blobs, the upper one smaller, read as a round crown.
        const crownHeight = tree.height - trunkHeight;
        const lower = new Mesh(new IcosahedronGeometry(crownHeight * 0.6, 1), foliageMaterial);
        lower.position.y = trunkHeight + crownHeight * 0.42;
        lower.scale.set(1, 0.85, 1);
        lower.castShadow = true;
        group.add(lower);

        const upper = new Mesh(new IcosahedronGeometry(crownHeight * 0.42, 1), foliageMaterial);
        upper.position.set(
          crownHeight * 0.12,
          trunkHeight + crownHeight * 0.78,
          -crownHeight * 0.08,
        );
        upper.castShadow = true;
        group.add(upper);
      }

      this.root.add(group);
    }
  }

  private addStreetLamps(): void {
    const poleMaterial = matte(COLOR.ironwork);

    for (const position of streetLampPositions()) {
      const group = new Group();
      group.position.set(position.x, 0, position.z);

      const pole = new Mesh(new CylinderGeometry(0.08, 0.12, STREET_LAMP_HEIGHT, 8), poleMaterial);
      pole.position.y = STREET_LAMP_HEIGHT / 2;
      pole.castShadow = true;
      group.add(pole);

      const head = new Mesh(new RoundedBoxGeometry(0.7, 0.24, 0.7, 2, 0.08), this.lampMaterial);
      head.position.y = STREET_LAMP_HEIGHT;
      group.add(head);

      const bulb = new Mesh(new SphereGeometry(0.22, 10, 8), this.lampMaterial);
      bulb.position.y = STREET_LAMP_HEIGHT - 0.22;
      group.add(bulb);

      const halo = createGlowSprite(LAMP_EMISSIVE, 3);
      halo.position.y = STREET_LAMP_HEIGHT - 0.22;
      group.add(halo);
      this.lampGlowSprites.push(halo);

      const pool = new Mesh(new PlaneGeometry(9, 9), this.lampPoolMaterial);
      pool.rotation.x = -Math.PI / 2;
      pool.position.y = PAVEMENT_HEIGHT + 0.04;
      group.add(pool);

      this.root.add(group);
    }
  }

  private addStreetSigns(): void {
    const postMaterial = matte(COLOR.ironwork);
    const plateMaterial = matte(COLOR.ivory);

    for (const sign of STREET_SIGNS) {
      const group = new Group();
      group.position.set(sign.position.x, 0, sign.position.z);
      group.rotation.y = sign.rotationY;

      const post = new Mesh(new CylinderGeometry(0.06, 0.06, 2.6, 8), postMaterial);
      post.position.y = 1.3;
      post.castShadow = true;
      group.add(post);

      const plate = new Mesh(new RoundedBoxGeometry(2.2, 0.42, 0.08, 2, 0.04), plateMaterial);
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
    this.lampPoolMaterial.opacity = this.lampLit * 0.3;
    for (const sprite of this.lampGlowSprites) {
      sprite.material.opacity = this.lampLit * 0.36;
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
 * A bed of soil with flowers scattered over it. Returns a group so it can be
 * placed in world space or inside a house's local space alike.
 */
function flowerBed(
  minX: number,
  maxX: number,
  minZ: number,
  maxZ: number,
  soil: MeshStandardMaterial,
  rng: Rng,
  placement: Object3D,
  y: number,
): Group {
  const group = new Group();
  const width = maxX - minX;
  const depth = maxZ - minZ;

  const bed = new Mesh(new RoundedBoxGeometry(width, 0.3, depth, 2, 0.08), soil);
  bed.position.set((minX + maxX) / 2, y + 0.15, (minZ + maxZ) / 2);
  bed.receiveShadow = true;
  group.add(bed);

  const count = Math.max(3, Math.round(width * depth * 0.9));
  const blooms = new InstancedMesh(new SphereGeometry(0.17, 8, 6), matte(0xffffff), count);
  for (let index = 0; index < count; index += 1) {
    placement.position.set(
      rng.nextFloat(minX + 0.25, maxX - 0.25),
      y + 0.36,
      rng.nextFloat(minZ + 0.25, maxZ - 0.25),
    );
    placement.scale.setScalar(rng.nextFloat(0.7, 1.2));
    placement.updateMatrix();
    blooms.setMatrixAt(index, placement.matrix);
    blooms.setColorAt(index, new Color(rng.pick(FLOWER_COLORS)));
  }
  blooms.instanceMatrix.needsUpdate = true;
  group.add(blooms);

  return group;
}

/** A matte material: rough, no metal, the whole town is made of it (DESIGN.md §16). */
function matte(color: number): MeshStandardMaterial {
  return new MeshStandardMaterial({ color: new Color(color), roughness: 0.95, metalness: 0 });
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

import {
  BoxGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  ExtrudeGeometry,
  Group,
  IcosahedronGeometry,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  Shape,
  ShapeGeometry,
  SphereGeometry,
  AdditiveBlending,
  type Sprite,
} from 'three';

import type { Building } from '../entities/Building.js';
import { Rng } from '../simulation/Rng.js';
import type { World } from '../simulation/World.js';
import {
  BUILDINGS,
  GROUND_SIZE,
  ROAD_HALF_X,
  ROAD_HALF_Z,
  ROAD_WIDTH,
  SIDEWALK_HALF_X,
  SIDEWALK_HALF_Z,
  SIDEWALK_WIDTH,
  STREET_LAMP_HEIGHT,
  TREES,
  streetLampPositions,
} from '../world/Town.js';

import type { EnvironmentState } from './Environment.js';
import { createGlowSprite, glowTexture } from './glow.js';

/** How fast a window or lamp fades between off and on, in real seconds. */
const LIGHT_FADE_SECONDS = 0.7;

const WINDOW_EMISSIVE = 0xffb455;
const LAMP_EMISSIVE = 0xffb964;

const WALL_COLORS = [0xd9d2c4, 0xc9b9a6, 0xe0d5c0, 0xcfc3b4, 0xd6c8b2, 0xbfb3a4];
const ROOF_COLORS = [0x8c5b4a, 0x7a4f42, 0x96604c, 0x6f4a44, 0x8a5949];

/** One building's meshes, plus the materials whose glow is animated. */
interface BuildingView {
  building: Building;
  windowMaterial: MeshStandardMaterial;
  windowGlows: Sprite[];
  /** Current lit amount, eased towards the target so lights fade in. */
  lit: number;
}

/**
 * Everything standing still in the town: ground, road, pavement, buildings,
 * trees and street lamps.
 *
 * The geometry is built once from the layout data in world/Town.ts. Each frame
 * only the lights change.
 */
export class TownView {
  readonly root = new Group();

  private readonly buildingViews: BuildingView[] = [];
  private readonly lampMaterial: MeshStandardMaterial;
  private readonly lampGlowMaterials: MeshBasicMaterial[] = [];
  private readonly lampGlowSprites: Sprite[] = [];
  private lampLit = 0;

  constructor() {
    this.root.name = 'town';

    this.addGround();
    this.addRoad();
    this.addSidewalk();

    this.lampMaterial = new MeshStandardMaterial({
      color: 0x2c2c33,
      emissive: new Color(LAMP_EMISSIVE),
      emissiveIntensity: 0,
      roughness: 0.6,
    });

    for (const building of BUILDINGS) {
      this.addBuilding(building);
    }
    this.addTrees();
    this.addStreetLamps();
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

  /** A flat ring of tarmac following the road loop. */
  private addRoad(): void {
    const road = new Mesh(
      ringGeometry(
        ROAD_HALF_X + ROAD_WIDTH / 2,
        ROAD_HALF_Z + ROAD_WIDTH / 2,
        ROAD_HALF_X - ROAD_WIDTH / 2,
        ROAD_HALF_Z - ROAD_WIDTH / 2,
      ),
      new MeshStandardMaterial({ color: 0x3b3c44, roughness: 0.95 }),
    );
    road.rotation.x = -Math.PI / 2;
    road.position.y = 0.02;
    road.receiveShadow = true;
    this.root.add(road);
  }

  /** A slightly raised kerb just outside the road, where the citizens walk. */
  private addSidewalk(): void {
    const outerX = SIDEWALK_HALF_X + SIDEWALK_WIDTH / 2;
    const outerZ = SIDEWALK_HALF_Z + SIDEWALK_WIDTH / 2;
    const innerX = SIDEWALK_HALF_X - SIDEWALK_WIDTH / 2;
    const innerZ = SIDEWALK_HALF_Z - SIDEWALK_WIDTH / 2;

    const shape = ringShape(outerX, outerZ, innerX, innerZ);
    const geometry = new ExtrudeGeometry(shape, { depth: 0.14, bevelEnabled: false });
    const sidewalk = new Mesh(
      geometry,
      new MeshStandardMaterial({ color: 0x9d998d, roughness: 0.9 }),
    );
    sidewalk.rotation.x = Math.PI / 2;
    sidewalk.position.y = 0.14;
    sidewalk.receiveShadow = true;
    this.root.add(sidewalk);
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
        color: WALL_COLORS[index % WALL_COLORS.length],
        roughness: 0.85,
      }),
    );
    walls.position.y = building.wallHeight / 2;
    walls.castShadow = true;
    walls.receiveShadow = true;
    group.add(walls);

    group.add(
      building.kind === 'house'
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
      const pane = new Mesh(new PlaneGeometry(1.1, 1.35), windowMaterial);
      pane.position.set(placement.x, placement.y, placement.z);
      pane.rotation.y = placement.rotationY;
      group.add(pane);

      const glow = createGlowSprite(WINDOW_EMISSIVE, 3);
      glow.position.set(
        placement.x + placement.normalX * 0.35,
        placement.y,
        placement.z + placement.normalZ * 0.35,
      );
      group.add(glow);
      windowGlows.push(glow);
    }

    this.addDoor(group, building);

    this.root.add(group);
    this.buildingViews.push({ building, windowMaterial, windowGlows, lit: 0 });
  }

  /** A door on the front wall, plus an awning and a sign for the cafe. */
  private addDoor(group: Group, building: Building): void {
    const doorHeight = 2.2;
    const door = new Mesh(
      new BoxGeometry(1.2, doorHeight, 0.18),
      new MeshStandardMaterial({ color: 0x4a382c, roughness: 0.8 }),
    );
    door.position.set(0, doorHeight / 2, building.depth / 2 + 0.05);
    group.add(door);

    if (building.kind !== 'cafe') {
      return;
    }

    const awning = new Mesh(
      new BoxGeometry(building.width * 0.72, 0.22, 2.6),
      new MeshStandardMaterial({ color: 0x9c4b3e, roughness: 0.8 }),
    );
    awning.position.set(0, 3.1, building.depth / 2 + 1.1);
    awning.castShadow = true;
    group.add(awning);

    const terrace = new Mesh(
      new PlaneGeometry(building.width * 0.9, 4.4),
      new MeshStandardMaterial({ color: 0xa79883, roughness: 0.95 }),
    );
    terrace.rotation.x = -Math.PI / 2;
    terrace.position.set(0, 0.04, building.depth / 2 + 2.6);
    terrace.receiveShadow = true;
    group.add(terrace);

    for (const offsetX of [-3.6, 0, 3.6]) {
      const table = new Mesh(
        new CylinderGeometry(0.55, 0.5, 0.75, 8),
        new MeshStandardMaterial({ color: 0x6f6152, roughness: 0.9 }),
      );
      table.position.set(offsetX, 0.4, building.depth / 2 + 3);
      table.castShadow = true;
      group.add(table);
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
          const radius = 1.9 - layer * 0.45;
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
    const poolMaterialTemplate = {
      map: glowTexture(),
      color: new Color(LAMP_EMISSIVE),
      blending: AdditiveBlending,
      transparent: true,
      depthWrite: false,
      opacity: 0,
    };

    for (const position of streetLampPositions()) {
      const group = new Group();
      group.position.set(position.x, 0, position.z);

      const pole = new Mesh(
        new CylinderGeometry(0.09, 0.13, STREET_LAMP_HEIGHT, 6),
        new MeshStandardMaterial({ color: 0x2c2c33, roughness: 0.7 }),
      );
      pole.position.y = STREET_LAMP_HEIGHT / 2;
      pole.castShadow = true;
      group.add(pole);

      const head = new Mesh(new BoxGeometry(0.8, 0.22, 0.8), this.lampMaterial);
      head.position.y = STREET_LAMP_HEIGHT;
      group.add(head);

      const bulb = new Mesh(new SphereGeometry(0.26, 10, 8), this.lampMaterial);
      bulb.position.y = STREET_LAMP_HEIGHT - 0.24;
      group.add(bulb);

      const halo = createGlowSprite(LAMP_EMISSIVE, 3.2);
      halo.position.y = STREET_LAMP_HEIGHT - 0.24;
      group.add(halo);
      this.lampGlowSprites.push(halo);

      const poolMaterial = new MeshBasicMaterial({ ...poolMaterialTemplate });
      const pool = new Mesh(new PlaneGeometry(9, 9), poolMaterial);
      pool.rotation.x = -Math.PI / 2;
      pool.position.y = 0.18;
      group.add(pool);
      this.lampGlowMaterials.push(poolMaterial);

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
    for (const material of this.lampGlowMaterials) {
      material.opacity = this.lampLit * 0.34;
    }
    for (const sprite of this.lampGlowSprites) {
      sprite.material.opacity = this.lampLit * 0.38;
    }
  }
}

interface WindowPlacement {
  x: number;
  y: number;
  z: number;
  rotationY: number;
  normalX: number;
  normalZ: number;
}

/** Lays out windows in a grid on all four walls, in the building's local space. */
function windowPlacements(building: Building): WindowPlacement[] {
  const placements: WindowPlacement[] = [];
  const floorHeight = building.wallHeight / building.floors;
  const offset = 0.07;

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
    const columns = Math.max(1, Math.min(3, Math.floor(facade.span / 3.4)));
    for (let floor = 0; floor < building.floors; floor += 1) {
      const y = floorHeight * (floor + 0.55);
      for (let column = 0; column < columns; column += 1) {
        const along = ((column + 0.5) / columns - 0.5) * facade.span * 0.82;
        // The ground floor front wall keeps its middle clear for the door.
        const isDoorway = facade.rotationY === 0 && floor === 0 && Math.abs(along) < 1.3;
        if (isDoorway) {
          continue;
        }
        placements.push({
          x: facade.normalX === 0 ? along : facade.normalX * (facade.depth + offset),
          y,
          z: facade.normalZ === 0 ? along : facade.normalZ * (facade.depth + offset),
          rotationY: facade.rotationY,
          normalX: facade.normalX,
          normalZ: facade.normalZ,
        });
      }
    }
  }

  return placements;
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

/** A flat roof with a low parapet, used by the cafe. */
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

/** A rectangular ring: an outer rectangle with an inner one cut out. */
function ringShape(outerX: number, outerZ: number, innerX: number, innerZ: number): Shape {
  const shape = new Shape();
  shape.moveTo(-outerX, -outerZ);
  shape.lineTo(outerX, -outerZ);
  shape.lineTo(outerX, outerZ);
  shape.lineTo(-outerX, outerZ);
  shape.closePath();

  const hole = new Shape();
  hole.moveTo(-innerX, -innerZ);
  hole.lineTo(innerX, -innerZ);
  hole.lineTo(innerX, innerZ);
  hole.lineTo(-innerX, innerZ);
  hole.closePath();
  shape.holes.push(hole);

  return shape;
}

function ringGeometry(
  outerX: number,
  outerZ: number,
  innerX: number,
  innerZ: number,
): ShapeGeometry {
  return new ShapeGeometry(ringShape(outerX, outerZ, innerX, innerZ));
}

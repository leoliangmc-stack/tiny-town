import {
  Color,
  DoubleSide,
  Group,
  InstancedMesh,
  Matrix4,
  MeshStandardMaterial,
  PlaneGeometry,
  Quaternion,
  SphereGeometry,
  Vector3,
} from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

import type { Point } from '../entities/geometry.js';
import { Rng } from '../simulation/Rng.js';
import { countryside, groundHeight } from '../world/Terrain.js';
import {
  BUILDINGS,
  LANE_WIDTH,
  LIGHTHOUSE,
  PROMENADE_Z,
  STREET_LAMP_HEIGHT,
  TREES,
  streetLampPositions,
} from '../world/Town.js';

import type { EnvironmentState } from './Environment.js';
import { coastZ } from './Scenery.js';

/**
 * Small life outside the town and in the air (SPEC.md 2.14, DESIGN.md §21):
 * a few rabbits and two deer in the meadows, small birds that fly from
 * perch to perch across the town, and gulls over the sea.
 *
 * All of it is render side. The animals run on real time from their own
 * seeded generator; the simulation, the state hash and the navigation
 * graphs never know they exist. Every kind is drawn from three instanced
 * parts shared by all of them (a blob, a box and a wing), so the whole
 * menagerie is three draw calls. At 20x and faster they are hidden, as the
 * fast picture should stay clean.
 */

const RABBIT_COUNT = 6;
const DEER_COUNT = 2;
const BIRD_COUNT = 8;
const GULL_COUNT = 5;

/** The speed from which the animals are hidden. */
const HIDE_FROM_SPEED = 20;

/**
 * Body sizes as multiples of life size (SPEC.md 2.14, decision 31). The town
 * is a miniature, and its people are already out of proportion so they read
 * from the god view; the animals follow the same rule. Their gaits scale with
 * them: a bigger rabbit hops further and higher, not more often.
 */
const RABBIT_SCALE = 3;
const DEER_SCALE = 2.2;
const BIRD_SCALE = 3.2;
const GULL_SCALE = 1.9;

const RABBIT_COLOR = 0x8d7b67;
const DEER_COLOR = 0xa88a60;
const WHITE = 0xf2f2ee;
const BIRD_COLORS = [0x4a4a4a, 0x6b5a4a, 0x7d7d7d, 0x5a5048];
const GULL_WING = 0xbdbdb8;

type RabbitState = 'graze' | 'hop';
type DeerState = 'graze' | 'alert' | 'walk';
type BirdState = 'perched' | 'flying';
type GullState = 'circling' | 'landing' | 'resting' | 'rising';

interface Rabbit {
  x: number;
  z: number;
  heading: number;
  state: RabbitState;
  timer: number;
  hopsLeft: number;
  hopPhase: number;
  targetX: number;
  targetZ: number;
}

interface Deer {
  x: number;
  z: number;
  heading: number;
  state: DeerState;
  timer: number;
  targetX: number;
  targetZ: number;
  /** 0 with the head down, 1 with it up; eased towards the state's value. */
  headUp: number;
  stride: number;
}

interface Perch {
  x: number;
  y: number;
  z: number;
}

interface Bird {
  perch: Perch;
  state: BirdState;
  timer: number;
  heading: number;
  /** The flight: from, control, to, and how far along it is. */
  from: Vector3;
  control: Vector3;
  to: Vector3;
  progress: number;
  duration: number;
  color: number;
  position: Vector3;
}

interface Gull {
  state: GullState;
  centre: Point;
  radius: number;
  angle: number;
  altitude: number;
  timer: number;
  flapUntil: number;
  from: Vector3;
  control: Vector3;
  to: Vector3;
  progress: number;
  duration: number;
  rest: Perch;
  heading: number;
  position: Vector3;
}

/** The three instanced parts everything is drawn with. */
type Part = 'blob' | 'box' | 'wing';

export class Wildlife {
  readonly root = new Group();

  private readonly parts: Record<Part, InstancedMesh>;
  private readonly used: Record<Part, number> = { blob: 0, box: 0, wing: 0 };
  private readonly hidden = new Matrix4().makeScale(0, 0, 0);
  private readonly rng = new Rng('wildlife');

  private readonly rabbits: Rabbit[] = [];
  private readonly deer: Deer[] = [];
  private readonly birds: Bird[] = [];
  private readonly gulls: Gull[] = [];
  private readonly perches: Perch[] = [];
  private readonly rests: Perch[] = [];

  private time = 0;
  private night = false;
  /** Set by the capture tooling to hold every animal still for a screenshot. */
  frozen = false;

  constructor() {
    this.root.name = 'wildlife';

    // Double sided for the wings, which are single planes seen from any side.
    const matte = new MeshStandardMaterial({ roughness: 0.9, metalness: 0, side: DoubleSide });
    const wingGeometry = new PlaneGeometry(1, 1);
    wingGeometry.rotateX(-Math.PI / 2);
    const make = (geometry: InstancedMesh['geometry'], capacity: number): InstancedMesh => {
      const mesh = new InstancedMesh(geometry, matte, capacity);
      mesh.frustumCulled = false;
      mesh.castShadow = true;
      this.root.add(mesh);
      return mesh;
    };
    this.parts = {
      blob: make(
        new SphereGeometry(1, 8, 6),
        RABBIT_COUNT * 5 + DEER_COUNT + BIRD_COUNT * 2 + GULL_COUNT * 2,
      ),
      box: make(new RoundedBoxGeometry(1, 1, 1, 2, 0.12), DEER_COUNT * 7),
      wing: make(wingGeometry, (BIRD_COUNT + GULL_COUNT) * 2),
    };

    this.collectPerches();
    this.placeRabbits();
    this.placeDeer();
    this.placeBirds();
    this.placeGulls();
  }

  /** Where a small bird may sit: parapets, lamp tops and tree tops. */
  private collectPerches(): void {
    for (const building of BUILDINGS) {
      const ground = groundHeight(building.position.x, building.position.z);
      const stacked = building.style !== undefined && building.style.upper !== 'none';
      const wall = stacked ? building.wallHeight * 0.52 : building.wallHeight;
      const top = ground + 0.12 + wall + building.roofHeight;
      const cos = Math.cos(building.rotationY);
      const sin = Math.sin(building.rotationY);
      for (const side of [-1, 1]) {
        const localX = side * (building.width / 2 - 0.5);
        const localZ = building.depth / 2 - 0.35;
        this.perches.push({
          x: building.position.x + localX * cos + localZ * sin,
          y: top,
          z: building.position.z - localX * sin + localZ * cos,
        });
      }
    }
    for (const lamp of streetLampPositions()) {
      this.perches.push({
        x: lamp.x,
        y: groundHeight(lamp.x, lamp.z) + STREET_LAMP_HEIGHT + 0.15,
        z: lamp.z,
      });
    }
    for (const tree of TREES) {
      if (tree.shape === 'cypress') {
        this.perches.push({
          x: tree.position.x,
          y: groundHeight(tree.position.x, tree.position.z) + tree.height + 0.5,
          z: tree.position.z,
        });
      }
    }

    // Where a gull may rest: the sea wall, the lighthouse gallery, the sand.
    const wallZ = PROMENADE_Z - LANE_WIDTH / 2 - 0.25;
    for (let x = -80; x <= 80; x += 16) {
      this.rests.push({ x, y: groundHeight(x, wallZ) + 0.55, z: wallZ });
    }
    this.rests.push({
      x: LIGHTHOUSE.position.x,
      y: groundHeight(LIGHTHOUSE.position.x, LIGHTHOUSE.position.z) + 1.2 + LIGHTHOUSE.height + 0.3,
      z: LIGHTHOUSE.position.z,
    });
    for (let x = -90; x <= 90; x += 30) {
      this.rests.push({ x, y: 0.1, z: coastZ(x) + 5 });
    }
  }

  /** A spot in the meadows, clear of the town and of the sea, within reach of the camera. */
  private meadowSpot(minRadius: number, maxRadius: number, minZ: number): Point {
    for (let attempt = 0; attempt < 200; attempt += 1) {
      const angle = this.rng.nextFloat(0, Math.PI * 2);
      const radius = this.rng.nextFloat(minRadius, maxRadius);
      const x = Math.cos(angle) * radius;
      const z = Math.sin(angle) * radius;
      if (z >= minZ && countryside(x, z) > 0.75) {
        return { x, z };
      }
    }
    return { x: 0, z: maxRadius };
  }

  private placeRabbits(): void {
    for (let index = 0; index < RABBIT_COUNT; index += 1) {
      const spot = this.meadowSpot(115, 185, -30);
      this.rabbits.push({
        x: spot.x,
        z: spot.z,
        heading: this.rng.nextFloat(0, Math.PI * 2),
        state: 'graze',
        timer: this.rng.nextFloat(1, 5),
        hopsLeft: 0,
        hopPhase: 0,
        targetX: spot.x,
        targetZ: spot.z,
      });
    }
  }

  private placeDeer(): void {
    for (let index = 0; index < DEER_COUNT; index += 1) {
      const spot = this.meadowSpot(150, 230, 40);
      this.deer.push({
        x: spot.x,
        z: spot.z,
        heading: this.rng.nextFloat(0, Math.PI * 2),
        state: 'graze',
        timer: this.rng.nextFloat(3, 8),
        targetX: spot.x,
        targetZ: spot.z,
        headUp: 0,
        stride: 0,
      });
    }
  }

  private placeBirds(): void {
    for (let index = 0; index < BIRD_COUNT; index += 1) {
      const perch = this.rng.pick(this.perches);
      this.birds.push({
        perch,
        state: 'perched',
        timer: this.rng.nextFloat(2, 14),
        heading: this.rng.nextFloat(0, Math.PI * 2),
        from: new Vector3(),
        control: new Vector3(),
        to: new Vector3(),
        progress: 0,
        duration: 1,
        color: this.rng.pick(BIRD_COLORS),
        position: new Vector3(perch.x, perch.y, perch.z),
      });
    }
  }

  private placeGulls(): void {
    for (let index = 0; index < GULL_COUNT; index += 1) {
      const centre = { x: this.rng.nextFloat(-110, 110), z: this.rng.nextFloat(-140, -92) };
      const radius = this.rng.nextFloat(14, 30);
      const angle = this.rng.nextFloat(0, Math.PI * 2);
      const altitude = this.rng.nextFloat(14, 26);
      this.gulls.push({
        state: 'circling',
        centre,
        radius,
        angle,
        altitude,
        timer: this.rng.nextFloat(20, 60),
        flapUntil: 0,
        from: new Vector3(),
        control: new Vector3(),
        to: new Vector3(),
        progress: 0,
        duration: 1,
        rest: this.rests[0],
        heading: 0,
        position: new Vector3(
          centre.x + Math.cos(angle) * radius,
          altitude,
          centre.z + Math.sin(angle) * radius,
        ),
      });
    }
  }

  /** Where each kind is right now, for whoever wants to look at one. */
  positions(): { rabbits: Vector3[]; deer: Vector3[]; birds: Vector3[]; gulls: Vector3[] } {
    return {
      rabbits: this.rabbits.map(
        (rabbit) => new Vector3(rabbit.x, groundHeight(rabbit.x, rabbit.z), rabbit.z),
      ),
      deer: this.deer.map((deer) => new Vector3(deer.x, groundHeight(deer.x, deer.z), deer.z)),
      birds: this.birds.map((bird) => bird.position.clone()),
      gulls: this.gulls.map((gull) => gull.position.clone()),
    };
  }

  /**
   * Moves everything on by `deltaSeconds` of real time. Hidden at speed;
   * at night the birds stay on their perches and the gulls come in to rest.
   */
  update(deltaSeconds: number, speed: number, environment: EnvironmentState): void {
    const visible = speed < HIDE_FROM_SPEED;
    this.root.visible = visible;
    if (!visible) {
      return;
    }
    const dt = this.frozen ? 0 : Math.min(deltaSeconds, 0.1);
    this.time += dt;
    this.night = environment.lampFactor > 0.5;
    this.used.blob = 0;
    this.used.box = 0;
    this.used.wing = 0;

    for (const rabbit of this.rabbits) {
      this.moveRabbit(rabbit, dt);
      this.drawRabbit(rabbit);
    }
    for (const deer of this.deer) {
      this.moveDeer(deer, dt);
      this.drawDeer(deer);
    }
    for (const bird of this.birds) {
      this.moveBird(bird, dt);
      this.drawBird(bird);
    }
    for (const gull of this.gulls) {
      this.moveGull(gull, dt);
      this.drawGull(gull);
    }

    for (const part of ['blob', 'box', 'wing'] as const) {
      const mesh = this.parts[part];
      for (let index = this.used[part]; index < mesh.count; index += 1) {
        mesh.setMatrixAt(index, this.hidden);
      }
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) {
        mesh.instanceColor.needsUpdate = true;
      }
    }
  }

  // --- Rabbits: nibble, then a few hops, then nibble again ---

  private moveRabbit(rabbit: Rabbit, dt: number): void {
    rabbit.timer -= dt;
    if (rabbit.state === 'graze') {
      if (rabbit.timer <= 0) {
        const distance = this.rng.nextFloat(3, 8) * RABBIT_SCALE;
        const angle = rabbit.heading + this.rng.nextFloat(-1.6, 1.6);
        const targetX = rabbit.x + Math.cos(angle) * distance;
        const targetZ = rabbit.z + Math.sin(angle) * distance;
        // Stay in the meadow: a hop that would leave it is turned round.
        const turn = countryside(targetX, targetZ) < 0.7 || Math.hypot(targetX, targetZ) > 200;
        rabbit.heading = turn ? angle + Math.PI : angle;
        rabbit.targetX = turn ? rabbit.x - Math.cos(angle) * distance : targetX;
        rabbit.targetZ = turn ? rabbit.z - Math.sin(angle) * distance : targetZ;
        rabbit.hopsLeft = Math.max(2, Math.round(distance / (1.1 * RABBIT_SCALE)));
        rabbit.hopPhase = 0;
        rabbit.state = 'hop';
      }
      return;
    }
    const hopSeconds = 0.42;
    rabbit.hopPhase += dt / hopSeconds;
    const step = ((1.1 * RABBIT_SCALE) / hopSeconds) * dt;
    rabbit.x += Math.cos(rabbit.heading) * step;
    rabbit.z += Math.sin(rabbit.heading) * step;
    if (rabbit.hopPhase >= 1) {
      rabbit.hopPhase = 0;
      rabbit.hopsLeft -= 1;
      if (rabbit.hopsLeft <= 0) {
        rabbit.state = 'graze';
        rabbit.timer = this.rng.nextFloat(2.5, 7);
      }
    }
  }

  private drawRabbit(rabbit: Rabbit): void {
    const ground = groundHeight(rabbit.x, rabbit.z);
    const hop =
      rabbit.state === 'hop' ? Math.sin(Math.PI * rabbit.hopPhase) * 0.32 * RABBIT_SCALE : 0;
    // Nibbling: the head dips in a slow rhythm while grazing.
    const nibble = rabbit.state === 'graze' ? 0.04 * Math.max(0, Math.sin(this.time * 5)) : 0;
    const base = new Matrix4().makeRotationY(-rabbit.heading + Math.PI / 2);
    base.setPosition(rabbit.x, ground + hop, rabbit.z);
    base.multiply(new Matrix4().makeScale(RABBIT_SCALE, RABBIT_SCALE, RABBIT_SCALE));
    const stretch = 1 + hop * 0.6;

    this.place(
      'blob',
      base,
      { x: 0, y: 0.22, z: 0 },
      { x: 0.3, y: 0.24, z: 0.4 * stretch },
      RABBIT_COLOR,
    );
    this.place('blob', base, { x: 0, y: 0.34 - nibble * 3, z: 0.3 }, 0.16, RABBIT_COLOR);
    for (const side of [-1, 1]) {
      this.place(
        'blob',
        base,
        { x: side * 0.06, y: 0.52 - nibble * 3, z: 0.24 },
        { x: 0.045, y: 0.17, z: 0.07 },
        RABBIT_COLOR,
        { x: -0.35 },
      );
    }
    this.place('blob', base, { x: 0, y: 0.26, z: -0.38 }, 0.07, WHITE);
  }

  // --- Deer: graze, look up and listen, walk on ---

  private moveDeer(deer: Deer, dt: number): void {
    deer.timer -= dt;
    const wanted = deer.state === 'graze' ? 0 : 1;
    deer.headUp += (wanted - deer.headUp) * Math.min(1, dt * 2.5);

    if (deer.state === 'graze' && deer.timer <= 0) {
      deer.state = 'alert';
      deer.timer = this.rng.nextFloat(1.5, 3.5);
      return;
    }
    if (deer.state === 'alert' && deer.timer <= 0) {
      if (this.rng.next() < 0.4) {
        deer.state = 'graze';
        deer.timer = this.rng.nextFloat(4, 9);
        return;
      }
      const distance = this.rng.nextFloat(10, 24) * DEER_SCALE;
      for (let attempt = 0; attempt < 8; attempt += 1) {
        const angle = this.rng.nextFloat(0, Math.PI * 2);
        const targetX = deer.x + Math.cos(angle) * distance;
        const targetZ = deer.z + Math.sin(angle) * distance;
        if (
          countryside(targetX, targetZ) > 0.8 &&
          targetZ > 30 &&
          Math.hypot(targetX, targetZ) < 240
        ) {
          deer.targetX = targetX;
          deer.targetZ = targetZ;
          deer.heading = angle;
          deer.state = 'walk';
          return;
        }
      }
      deer.state = 'graze';
      deer.timer = this.rng.nextFloat(4, 9);
      return;
    }
    if (deer.state === 'walk') {
      const speed = 1.1 * DEER_SCALE;
      const dx = deer.targetX - deer.x;
      const dz = deer.targetZ - deer.z;
      const remaining = Math.hypot(dx, dz);
      if (remaining < speed * dt) {
        deer.x = deer.targetX;
        deer.z = deer.targetZ;
        deer.state = 'graze';
        deer.timer = this.rng.nextFloat(4, 9);
        return;
      }
      deer.x += (dx / remaining) * speed * dt;
      deer.z += (dz / remaining) * speed * dt;
      deer.stride += dt * 5;
    }
  }

  private drawDeer(deer: Deer): void {
    const ground = groundHeight(deer.x, deer.z);
    const base = new Matrix4().makeRotationY(-deer.heading + Math.PI / 2);
    base.setPosition(deer.x, ground, deer.z);
    base.multiply(new Matrix4().makeScale(DEER_SCALE, DEER_SCALE, DEER_SCALE));
    const walking = deer.state === 'walk';
    const swing = walking ? Math.sin(deer.stride) * 0.35 : 0;

    this.place('box', base, { x: 0, y: 0.98, z: 0 }, { x: 0.5, y: 0.62, z: 1.25 }, DEER_COLOR);
    // The neck leans forward and down to graze, up to listen.
    const neckTilt = 1.1 - deer.headUp * 1.0;
    this.place(
      'box',
      base,
      { x: 0, y: 1.2 + deer.headUp * 0.18, z: 0.62 + (1 - deer.headUp) * 0.12 },
      { x: 0.2, y: 0.62, z: 0.2 },
      DEER_COLOR,
      { x: neckTilt },
    );
    const headY = 0.95 + deer.headUp * 0.7;
    const headZ = 1.0 + (1 - deer.headUp) * 0.05;
    this.place('box', base, { x: 0, y: headY, z: headZ }, { x: 0.18, y: 0.2, z: 0.36 }, DEER_COLOR);
    for (const [x, z, phase] of [
      [-0.17, 0.45, 0],
      [0.17, 0.45, Math.PI],
      [-0.17, -0.45, Math.PI],
      [0.17, -0.45, 0],
    ]) {
      this.place('box', base, { x, y: 0.42, z }, { x: 0.1, y: 0.86, z: 0.1 }, DEER_COLOR, {
        x: Math.sin(deer.stride + phase) * 0.35 * (walking ? 1 : 0) + swing * 0,
      });
    }
    this.place('blob', base, { x: 0, y: 1.05, z: -0.66 }, { x: 0.16, y: 0.16, z: 0.08 }, WHITE);
  }

  // --- Birds: sit a while, then fly to another perch ---

  private moveBird(bird: Bird, dt: number): void {
    if (bird.state === 'perched') {
      bird.timer -= dt;
      if (bird.timer <= 0 && !this.night) {
        this.startFlight(bird, this.nextPerch(bird.perch, 70));
      } else if (bird.timer <= 0) {
        bird.timer = this.rng.nextFloat(3, 8);
        bird.heading += this.rng.nextFloat(-1, 1);
      }
      return;
    }
    bird.progress += dt / bird.duration;
    if (bird.progress >= 1) {
      bird.state = 'perched';
      bird.position.copy(bird.to);
      bird.timer = this.rng.nextFloat(5, 16);
      return;
    }
    const next = bezier(bird.from, bird.control, bird.to, Math.min(1, bird.progress + 0.01));
    bezier(bird.from, bird.control, bird.to, bird.progress, bird.position);
    bird.heading = Math.atan2(next.z - bird.position.z, next.x - bird.position.x);
  }

  private nextPerch(current: Perch, reach: number): Perch {
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const candidate = this.rng.pick(this.perches);
      const away = Math.hypot(candidate.x - current.x, candidate.z - current.z);
      if (candidate !== current && away > 8 && away < reach) {
        return candidate;
      }
    }
    return this.rng.pick(this.perches);
  }

  private startFlight(bird: Bird, perch: Perch): void {
    bird.from.set(bird.perch.x, bird.perch.y, bird.perch.z);
    bird.to.set(perch.x, perch.y, perch.z);
    const lift = this.rng.nextFloat(5, 11);
    bird.control.copy(bird.from).add(bird.to).multiplyScalar(0.5);
    bird.control.y = Math.max(bird.from.y, bird.to.y) + lift;
    bird.control.x += this.rng.nextFloat(-6, 6);
    bird.control.z += this.rng.nextFloat(-6, 6);
    bird.duration = Math.max(1.2, bird.from.distanceTo(bird.to) / 9);
    bird.progress = 0;
    bird.perch = perch;
    bird.state = 'flying';
  }

  private drawBird(bird: Bird): void {
    const flying = bird.state === 'flying';
    // Wingbeats on the way up, a glide on the way down.
    const climbing = flying && bird.progress < 0.55;
    // Folded along the body on the perch; beating on the climb; spread on the glide.
    const flap = climbing ? Math.sin(this.time * 19) * 0.75 : flying ? 0.12 : 0.4;
    const base = new Matrix4().makeRotationY(-bird.heading + Math.PI / 2);
    const hop = !flying ? 0.02 * Math.max(0, Math.sin(this.time * 3 + bird.perch.x)) : 0;
    base.setPosition(bird.position.x, bird.position.y + 0.08 * BIRD_SCALE + hop, bird.position.z);
    base.multiply(new Matrix4().makeScale(BIRD_SCALE, BIRD_SCALE, BIRD_SCALE));
    this.place('blob', base, { x: 0, y: 0, z: 0 }, { x: 0.1, y: 0.09, z: 0.17 }, bird.color);
    this.place('blob', base, { x: 0, y: 0.06, z: 0.15 }, 0.06, bird.color);
    this.drawWings(base, flying ? 0.24 : 0.14, 0.14, flap, bird.color);
  }

  /** A pair of wings, each turned about the body by the flap angle. */
  private drawWings(base: Matrix4, span: number, chord: number, flap: number, color: number): void {
    for (const side of [-1, 1]) {
      const hinge = new Matrix4().makeRotationZ(side * flap).setPosition(side * 0.03, 0.02, 0);
      const wing = new Matrix4().compose(
        new Vector3(side * span * 0.5, 0, 0),
        new Quaternion(),
        new Vector3(span, 1, chord),
      );
      this.parts.wing.setMatrixAt(this.used.wing, base.clone().multiply(hinge).multiply(wing));
      this.parts.wing.setColorAt(this.used.wing, new Color(color));
      this.used.wing += 1;
    }
  }

  // --- Gulls: wheel over the water, come in to rest, go up again ---

  private moveGull(gull: Gull, dt: number): void {
    gull.timer -= dt;
    switch (gull.state) {
      case 'circling': {
        gull.angle += dt * 0.22;
        gull.position.set(
          gull.centre.x + Math.cos(gull.angle) * gull.radius,
          gull.altitude + Math.sin(this.time * 0.4 + gull.radius) * 1.5,
          gull.centre.z + Math.sin(gull.angle) * gull.radius,
        );
        gull.heading = gull.angle + Math.PI / 2;
        if (gull.timer <= 0 || this.night) {
          gull.rest = this.rng.pick(this.rests);
          gull.from.copy(gull.position);
          gull.to.set(gull.rest.x, gull.rest.y, gull.rest.z);
          gull.control.copy(gull.from).add(gull.to).multiplyScalar(0.5);
          gull.control.y = gull.from.y + 3;
          gull.duration = Math.max(3, gull.from.distanceTo(gull.to) / 7);
          gull.progress = 0;
          gull.state = 'landing';
        }
        break;
      }
      case 'landing': {
        gull.progress += dt / gull.duration;
        if (gull.progress >= 1) {
          gull.position.copy(gull.to);
          gull.state = 'resting';
          gull.timer = this.rng.nextFloat(12, 30);
          break;
        }
        const next = bezier(gull.from, gull.control, gull.to, Math.min(1, gull.progress + 0.01));
        bezier(gull.from, gull.control, gull.to, gull.progress, gull.position);
        gull.heading = Math.atan2(next.z - gull.position.z, next.x - gull.position.x);
        break;
      }
      case 'resting': {
        if (gull.timer <= 0 && !this.night) {
          gull.centre = { x: this.rng.nextFloat(-110, 110), z: this.rng.nextFloat(-140, -92) };
          gull.radius = this.rng.nextFloat(14, 30);
          gull.altitude = this.rng.nextFloat(14, 26);
          gull.angle = this.rng.nextFloat(0, Math.PI * 2);
          gull.from.copy(gull.position);
          gull.to.set(
            gull.centre.x + Math.cos(gull.angle) * gull.radius,
            gull.altitude,
            gull.centre.z + Math.sin(gull.angle) * gull.radius,
          );
          gull.control.copy(gull.from).add(gull.to).multiplyScalar(0.5);
          gull.control.y = gull.to.y + 4;
          gull.duration = Math.max(3, gull.from.distanceTo(gull.to) / 6);
          gull.progress = 0;
          gull.flapUntil = this.time + gull.duration * 0.7;
          gull.state = 'rising';
        } else if (gull.timer <= 0) {
          gull.timer = this.rng.nextFloat(10, 20);
        }
        break;
      }
      case 'rising': {
        gull.progress += dt / gull.duration;
        if (gull.progress >= 1) {
          gull.state = 'circling';
          gull.timer = this.rng.nextFloat(25, 60);
          break;
        }
        const next = bezier(gull.from, gull.control, gull.to, Math.min(1, gull.progress + 0.01));
        bezier(gull.from, gull.control, gull.to, gull.progress, gull.position);
        gull.heading = Math.atan2(next.z - gull.position.z, next.x - gull.position.x);
        break;
      }
    }
    // Now and then a few wingbeats even on the wheel.
    if (gull.state === 'circling' && gull.flapUntil < this.time && this.rng.next() < dt * 0.12) {
      gull.flapUntil = this.time + 1.4;
    }
  }

  private drawGull(gull: Gull): void {
    const airborne = gull.state !== 'resting';
    const flapping = airborne && this.time < gull.flapUntil;
    const flap = flapping ? Math.sin(this.time * 9) * 0.6 : airborne ? 0.1 : 0.95;
    const base = new Matrix4().makeRotationY(-gull.heading + Math.PI / 2);
    // A gentle bank on the wheel.
    if (gull.state === 'circling') {
      base.multiply(new Matrix4().makeRotationZ(-0.25));
    }
    base.setPosition(gull.position.x, gull.position.y + 0.1, gull.position.z);
    base.multiply(new Matrix4().makeScale(GULL_SCALE, GULL_SCALE, GULL_SCALE));
    this.place('blob', base, { x: 0, y: 0, z: 0 }, { x: 0.15, y: 0.12, z: 0.34 }, WHITE);
    this.place('blob', base, { x: 0, y: 0.05, z: 0.32 }, { x: 0.08, y: 0.07, z: 0.1 }, WHITE);
    this.drawWings(base, airborne ? 0.62 : 0.3, 0.17, flap, GULL_WING);
  }

  /** Writes one instance of a part, placed in `base`'s frame. */
  private place(
    part: Exclude<Part, 'wing'>,
    base: Matrix4,
    position: { x: number; y: number; z: number },
    scale: { x: number; y: number; z: number } | number,
    color: number,
    rotation: { x?: number; y?: number; z?: number } = {},
  ): void {
    const scaleVector =
      typeof scale === 'number'
        ? new Vector3(scale, scale, scale)
        : new Vector3(scale.x, scale.y, scale.z);
    const quaternion = new Quaternion().setFromEuler(
      scratch.rotation.set(rotation.x ?? 0, rotation.y ?? 0, rotation.z ?? 0),
    );
    const local = new Matrix4().compose(
      new Vector3(position.x, position.y, position.z),
      quaternion,
      scaleVector,
    );
    const mesh = this.parts[part];
    mesh.setMatrixAt(this.used[part], base.clone().multiply(local));
    mesh.setColorAt(this.used[part], new Color(color));
    this.used[part] += 1;
  }
}

const scratch = new Group();

/** A point on a quadratic bezier, written into `out` when given. */
function bezier(
  from: Vector3,
  control: Vector3,
  to: Vector3,
  t: number,
  out = new Vector3(),
): Vector3 {
  const u = 1 - t;
  return out.set(
    u * u * from.x + 2 * u * t * control.x + t * t * to.x,
    u * u * from.y + 2 * u * t * control.y + t * t * to.y,
    u * u * from.z + 2 * u * t * control.z + t * t * to.z,
  );
}

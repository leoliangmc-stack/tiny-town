import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  Points,
  ShaderMaterial,
  Vector3,
} from 'three';

import { Rng } from '../simulation/Rng.js';
import { groundHeight } from '../world/Terrain.js';
import { BUILDINGS, PARK, SQUARE } from '../world/Town.js';

import { coastZ } from './Scenery.js';

/**
 * The fireworks of Mid-Autumn night (SPEC.md 2.15, decisions 37 and 39): a
 * full show along the beach, with salvos and five kinds of burst, and small
 * low shells going up all over the town, from rooftops, the square and the
 * park.
 *
 * One point cloud draws every spark. Sparks live in a fixed pool with a
 * free list, so a busy sky never allocates. Everything runs on real time
 * from this module's own seeded generator; the simulation never sees it.
 */

const MAX_SPARKS = 12000;
const GRAVITY = 7;

const COLORS = [0xffd36b, 0xff5a4a, 0xff8fc8, 0x7cf08a, 0xbfe3ff, 0xffa84a, 0xd4a0ff];
const WILLOW_GOLD = 0xffc85a;

export type BurstKind = 'peony' | 'chrysanthemum' | 'willow' | 'ring' | 'crackle';

/**
 * A moment the fireworks make a sound (decision 43): a shell leaving its
 * launcher, or bursting. The ambience hears these and plays them, delayed by
 * the distance the way thunder is.
 */
export interface FireworkSound {
  kind: 'launch' | 'burst';
  position: Vector3;
  /** A beach shell: big and high. The town's are small and low. */
  big: boolean;
  burst: BurstKind;
  /** Seconds from the launch to the burst. */
  fuse: number;
}

/** Sounds kept for the ambience between frames; beyond this nobody is listening. */
const MAX_PENDING_SOUNDS = 64;
const BEACH_KINDS: readonly BurstKind[] = [
  'peony',
  'peony',
  'chrysanthemum',
  'chrysanthemum',
  'willow',
  'ring',
  'crackle',
];
const TOWN_KINDS: readonly BurstKind[] = ['peony', 'peony', 'chrysanthemum', 'ring', 'crackle'];

/** How a launch site throws its shells: the beach big and high, the town small and low. */
interface Scale {
  climb: [number, number];
  fuse: [number, number];
  sparks: number;
  burstSpeed: number;
  size: number;
  life: [number, number];
}
const BEACH: Scale = {
  climb: [36, 46],
  fuse: [1.6, 2.3],
  sparks: 120,
  burstSpeed: 32,
  size: 1.9,
  life: [1.7, 2.6],
};
const TOWN: Scale = {
  climb: [17, 23],
  fuse: [1.1, 1.5],
  sparks: 46,
  burstSpeed: 13,
  size: 1.15,
  life: [1.1, 1.6],
};

/** Real seconds between launches, at random within these ranges. */
const BEACH_GAP: [number, number] = [0.14, 0.55];
const TOWN_GAP: [number, number] = [0.18, 0.55];
/** How often a beach launch is a salvo of several shells, and how many. */
const SALVO_CHANCE = 0.28;
const SALVO_SIZE: [number, number] = [3, 5];

const SPARK_VERTEX = /* glsl */ `
  attribute vec3 sparkColor;
  attribute float sparkAlpha;
  attribute float sparkSize;
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    vColor = sparkColor;
    vAlpha = sparkAlpha;
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = sparkSize * (1300.0 / -mvPosition.z);
    gl_Position = projectionMatrix * mvPosition;
  }
`;

const SPARK_FRAGMENT = /* glsl */ `
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    vec2 p = gl_PointCoord - 0.5;
    float d = length(p) * 2.0;
    float glow = pow(max(0.0, 1.0 - d), 1.8);
    if (glow <= 0.0) discard;
    gl_FragColor = vec4(vColor * glow * vAlpha * 2.2, 1.0);
  }
`;

interface Spark {
  position: Vector3;
  velocity: Vector3;
  age: number;
  life: number;
  color: Color;
  size: number;
  /** A shell climbs and bursts; a star falls and fades; an ember just fades. */
  kind: 'shell' | 'star' | 'ember';
  /** What a shell bursts into, and how big. */
  burst: BurstKind;
  burstColor: Color;
  scale: Scale;
  /** How quickly the air slows it, and how much gravity pulls. */
  drag: number;
  fall: number;
  /** Embers dropped behind it per second. */
  trail: number;
  /** Crackle stars flicker hard at the end. */
  strobe: boolean;
  twinkle: number;
}

interface Pending {
  at: number;
  from: Vector3;
  scale: Scale;
  kinds: readonly BurstKind[];
}

export class Fireworks {
  readonly points: Points<BufferGeometry, ShaderMaterial>;

  private readonly rng = new Rng('mid-autumn-fireworks');
  private readonly pool: Spark[] = [];
  /** Indices of the dead sparks, ready to reuse. */
  private readonly free: number[] = [];
  private readonly alive: boolean[] = [];
  private readonly positions: Float32Array;
  private readonly colors: Float32Array;
  private readonly alphas: Float32Array;
  private readonly sizes: Float32Array;
  private readonly townSites: Vector3[];
  private readonly pending: Pending[] = [];
  private readonly sounds: FireworkSound[] = [];
  private untilBeach = 0;
  private untilTown = 0;
  private time = 0;

  constructor() {
    for (let index = 0; index < MAX_SPARKS; index += 1) {
      this.pool.push({
        position: new Vector3(),
        velocity: new Vector3(),
        age: 0,
        life: 1,
        color: new Color(),
        size: 1,
        kind: 'star',
        burst: 'peony',
        burstColor: new Color(),
        scale: BEACH,
        drag: 1.3,
        fall: 0.35,
        trail: 0,
        strobe: false,
        twinkle: 0,
      });
      this.alive.push(false);
      this.free.push(MAX_SPARKS - 1 - index);
    }
    this.townSites = townLaunchSites();

    this.positions = new Float32Array(MAX_SPARKS * 3);
    this.colors = new Float32Array(MAX_SPARKS * 3);
    this.alphas = new Float32Array(MAX_SPARKS);
    this.sizes = new Float32Array(MAX_SPARKS);
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(this.positions, 3));
    geometry.setAttribute('sparkColor', new BufferAttribute(this.colors, 3));
    geometry.setAttribute('sparkAlpha', new BufferAttribute(this.alphas, 1));
    geometry.setAttribute('sparkSize', new BufferAttribute(this.sizes, 1));
    geometry.setDrawRange(0, 0);
    this.points = new Points(
      geometry,
      new ShaderMaterial({
        vertexShader: SPARK_VERTEX,
        fragmentShader: SPARK_FRAGMENT,
        blending: AdditiveBlending,
        transparent: true,
        depthWrite: false,
      }),
    );
    this.points.name = 'fireworks';
    this.points.frustumCulled = false;
    this.points.renderOrder = 3;
  }

  /** How many sparks are in the air, for tooling. */
  get sparkCount(): number {
    return MAX_SPARKS - this.free.length;
  }

  /** Starts the show a moment from now. */
  start(): void {
    this.untilBeach = 0.2;
    this.untilTown = 0.6;
  }

  /** Clears the sky at once. */
  stop(): void {
    this.pending.length = 0;
    this.free.length = 0;
    for (let index = 0; index < MAX_SPARKS; index += 1) {
      this.alive[index] = false;
      this.free.push(MAX_SPARKS - 1 - index);
    }
    this.points.geometry.setDrawRange(0, 0);
  }

  update(dt: number): void {
    this.time += dt;

    this.untilBeach -= dt;
    if (this.untilBeach <= 0) {
      this.launchFromBeach();
      this.untilBeach = this.rng.nextFloat(BEACH_GAP[0], BEACH_GAP[1]);
    }
    this.untilTown -= dt;
    if (this.untilTown <= 0) {
      const site = this.rng.pick(this.townSites);
      this.queue(0, site, TOWN, TOWN_KINDS);
      this.untilTown = this.rng.nextFloat(TOWN_GAP[0], TOWN_GAP[1]);
    }
    for (let index = this.pending.length - 1; index >= 0; index -= 1) {
      const pending = this.pending[index];
      if (pending.at <= this.time) {
        this.pending.splice(index, 1);
        this.launch(pending.from, pending.scale, pending.kinds);
      }
    }
    this.step(dt);
  }

  /** One shell from somewhere along the sand, or now and then a salvo of them. */
  private launchFromBeach(): void {
    const salvo = this.rng.chance(SALVO_CHANCE);
    const count = salvo ? this.rng.nextInt(SALVO_SIZE[0], SALVO_SIZE[1]) : 1;
    const middle = this.rng.nextFloat(-80, 40);
    for (let shot = 0; shot < count; shot += 1) {
      const x = salvo ? middle + (shot - (count - 1) / 2) * 9 : this.rng.nextFloat(-85, 45);
      const z = coastZ(x) + this.rng.nextFloat(3, 8);
      const from = new Vector3(x, groundHeight(x, z) + 0.5, z);
      this.queue(salvo ? shot * 0.12 : 0, from, BEACH, BEACH_KINDS);
    }
  }

  private queue(delay: number, from: Vector3, scale: Scale, kinds: readonly BurstKind[]): void {
    this.pending.push({ at: this.time + delay, from, scale, kinds });
  }

  private launch(from: Vector3, scale: Scale, kinds: readonly BurstKind[]): void {
    const shell = this.spawn();
    if (!shell) {
      return;
    }
    shell.kind = 'shell';
    shell.position.copy(from);
    shell.velocity.set(
      this.rng.nextFloat(-2, 2),
      this.rng.nextFloat(scale.climb[0], scale.climb[1]),
      this.rng.nextFloat(-2, 1),
    );
    shell.life = this.rng.nextFloat(scale.fuse[0], scale.fuse[1]);
    shell.color.setHex(0xffe2b0);
    shell.size = scale.size * 0.85;
    shell.scale = scale;
    shell.burst = this.rng.pick(kinds);
    shell.burstColor.setHex(shell.burst === 'willow' ? WILLOW_GOLD : this.rng.pick(COLORS));
    shell.drag = 0;
    shell.fall = 1;
    shell.trail = 40;
    shell.strobe = false;
    this.hear({
      kind: 'launch',
      position: from.clone(),
      big: scale === BEACH,
      burst: shell.burst,
      fuse: shell.life,
    });
  }

  /** The launches and bursts since the last call, oldest first (decision 43). */
  takeSounds(): FireworkSound[] {
    return this.sounds.splice(0);
  }

  private hear(sound: FireworkSound): void {
    this.sounds.push(sound);
    if (this.sounds.length > MAX_PENDING_SOUNDS) {
      this.sounds.shift();
    }
  }

  private spawn(): Spark | undefined {
    const index = this.free.pop();
    if (index === undefined) {
      return undefined;
    }
    this.alive[index] = true;
    const spark = this.pool[index];
    spark.age = 0;
    spark.twinkle = this.rng.next() * 10;
    spark.trail = 0;
    spark.strobe = false;
    return spark;
  }

  private explode(shell: Spark): void {
    const { scale, burst } = shell;
    this.hear({
      kind: 'burst',
      position: shell.position.clone(),
      big: scale === BEACH,
      burst,
      fuse: 0,
    });
    const base = shell.burstColor;
    // Now and then a second colour mixed in, and now and then a big one.
    const second = this.rng.chance(0.35) ? new Color(this.rng.pick(COLORS)) : base;
    const big = this.rng.chance(0.25);
    const grow = big ? 1.3 : 1;
    let count = Math.round(scale.sparks * (big ? 1.5 : 1));
    let speed = scale.burstSpeed * grow;
    if (burst === 'ring') {
      count = Math.round(count * 0.6);
    }
    if (burst === 'willow') {
      speed *= 0.75;
    }
    // A ring lies in a tilted plane.
    const tilt = new Vector3(
      this.rng.nextFloat(-0.6, 0.6),
      1,
      this.rng.nextFloat(-0.6, 0.6),
    ).normalize();
    const across = new Vector3(1, 0, 0).cross(tilt).normalize();
    const along = tilt.clone().cross(across);

    for (let index = 0; index < count; index += 1) {
      const star = this.spawn();
      if (!star) {
        return;
      }
      star.kind = 'star';
      star.position.copy(shell.position);
      star.scale = scale;
      star.size = scale.size * grow;
      star.color.copy(index % 3 === 0 ? second : base);
      star.life = this.rng.nextFloat(scale.life[0], scale.life[1]);
      star.drag = 1.3;
      star.fall = 0.35;
      const pace = speed * (0.8 + 0.2 * this.rng.next());

      if (burst === 'ring') {
        const angle = (index / count) * Math.PI * 2;
        star.velocity
          .copy(across)
          .multiplyScalar(Math.cos(angle) * pace)
          .addScaledVector(along, Math.sin(angle) * pace);
      } else {
        // Evenly round a sphere.
        const u = this.rng.next() * 2 - 1;
        const angle = this.rng.next() * Math.PI * 2;
        const flat = Math.sqrt(1 - u * u);
        star.velocity.set(flat * Math.cos(angle) * pace, u * pace, flat * Math.sin(angle) * pace);
      }

      if (burst === 'chrysanthemum') {
        star.trail = 7;
      } else if (burst === 'willow') {
        // Gold, long lived, slowed hard and drooping, with long tails.
        star.color.setHex(WILLOW_GOLD);
        star.life *= 1.9;
        star.drag = 2.2;
        star.fall = 0.55;
        star.trail = 9;
      } else if (burst === 'crackle') {
        star.color.lerp(new Color(0xffffff), 0.5);
        star.strobe = true;
        star.size *= 0.8;
      }
    }
  }

  private step(dt: number): void {
    let written = 0;
    for (let index = 0; index < MAX_SPARKS; index += 1) {
      if (!this.alive[index]) {
        continue;
      }
      const spark = this.pool[index];
      spark.age += dt;
      if (spark.kind === 'shell') {
        spark.velocity.y -= GRAVITY * dt;
      } else {
        // Air drag slows the stars, then gravity takes them down.
        spark.velocity.multiplyScalar(Math.exp(-spark.drag * dt));
        spark.velocity.y -= GRAVITY * spark.fall * dt;
      }
      spark.position.addScaledVector(spark.velocity, dt);

      if (spark.trail > 0 && this.rng.chance(spark.trail * dt)) {
        const ember = this.spawn();
        if (ember) {
          ember.kind = 'ember';
          ember.position.copy(spark.position);
          ember.velocity.set(0, -1, 0);
          ember.drag = 2;
          ember.fall = 0.1;
          // A willow's long gold tails outlast the others'.
          ember.life = spark.kind === 'shell' ? 0.5 : spark.drag > 2 ? 0.8 : 0.45;
          ember.color.copy(spark.kind === 'shell' ? new Color(0xffc27a) : spark.color);
          ember.size = spark.size * 0.55;
        }
      }

      if (spark.age >= spark.life) {
        this.alive[index] = false;
        // The shell's own slot is freed after its stars take theirs, so
        // none of them is handed the shell they are reading from.
        if (spark.kind === 'shell') {
          this.explode(spark);
        }
        this.free.push(index);
        continue;
      }

      const t = spark.age / spark.life;
      let alpha = spark.kind === 'shell' ? 1 : 1 - t * t;
      if (spark.kind === 'star' && t > 0.55) {
        // They twinkle out at the end; crackle strobes hard.
        alpha *= spark.strobe
          ? Math.sin(spark.age * 55 + spark.twinkle) > 0.2
            ? 1.4
            : 0.05
          : 0.6 + 0.4 * Math.sin(spark.age * 30 + spark.twinkle);
      }
      const offset = written * 3;
      this.positions[offset] = spark.position.x;
      this.positions[offset + 1] = spark.position.y;
      this.positions[offset + 2] = spark.position.z;
      this.colors[offset] = spark.color.r;
      this.colors[offset + 1] = spark.color.g;
      this.colors[offset + 2] = spark.color.b;
      this.alphas[written] = Math.max(0, alpha);
      this.sizes[written] = spark.size;
      written += 1;
    }

    const geometry = this.points.geometry;
    geometry.setDrawRange(0, written);
    for (const name of ['position', 'sparkColor', 'sparkAlpha', 'sparkSize']) {
      (geometry.getAttribute(name) as BufferAttribute).needsUpdate = true;
    }
  }

  dispose(): void {
    this.points.geometry.dispose();
    this.points.material.dispose();
  }
}

/**
 * Where the town's small fireworks go up: the flat roofs of the bigger
 * buildings and a few of the houses, the square and the park.
 */
function townLaunchSites(): Vector3[] {
  const sites: Vector3[] = [];
  BUILDINGS.forEach((building, index) => {
    if (building.kind === 'house' && index % 3 !== 0) {
      return;
    }
    const { x, z } = building.position;
    sites.push(
      new Vector3(x, groundHeight(x, z) + building.wallHeight + building.roofHeight + 0.3, z),
    );
  });
  const square = { x: (SQUARE.minX + SQUARE.maxX) / 2, z: (SQUARE.minZ + SQUARE.maxZ) / 2 };
  const park = { x: (PARK.minX + PARK.maxX) / 2, z: (PARK.minZ + PARK.maxZ) / 2 };
  for (const { x, z } of [square, park, { x: park.x - 8, z: park.z + 6 }]) {
    sites.push(new Vector3(x, groundHeight(x, z) + 0.3, z));
  }
  return sites;
}

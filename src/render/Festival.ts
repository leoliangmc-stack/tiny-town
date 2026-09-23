import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  Group,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  PlaneGeometry,
  Points,
  Quaternion,
  ShaderMaterial,
  SphereGeometry,
  Vector3,
  type Camera,
} from 'three';

import type { Point } from '../entities/geometry.js';
import { Rng } from '../simulation/Rng.js';
import { groundHeight } from '../world/Terrain.js';
import { STREET_LAMP_HEIGHT, streetLampPositions } from '../world/Town.js';

import { glowTexture } from './glow.js';
import { coastZ } from './Scenery.js';

/**
 * Mid-Autumn night (SPEC.md 2.15, decision 37): red lanterns on every street
 * lamp and strung between neighbouring lamps, and fireworks going up from
 * the beach. The sky, the full moon and the lit windows are the
 * Environment's and the TownView's; this is the rest of the party.
 *
 * All of it is render side and runs on real time from its own seeded
 * generator. The lanterns are two instanced draw calls, the fireworks one
 * point cloud.
 */

const LANTERN_RED = new Color(0xe8402a);
const LANTERN_GLOW = new Color(0xff7a3c);

/** Lanterns strung between two lamps this far apart, or not at all. */
const STRING_MIN = 10;
const STRING_MAX = 30;
const LANTERNS_PER_STRING = 5;
const STRING_SAG = 1.3;

/** The pool of spark particles, shells and bursts together. */
const MAX_SPARKS = 2600;
const SPARKS_PER_BURST = 110;
const GRAVITY = 7;
/** Real seconds between launches, at random within this range. */
const LAUNCH_GAP: [number, number] = [0.45, 1.5];

const FIREWORK_COLORS = [0xffd36b, 0xff5a4a, 0xff8fc8, 0x7cf08a, 0xbfe3ff, 0xffa84a, 0xd4a0ff];

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
  alive: boolean;
  position: Vector3;
  velocity: Vector3;
  age: number;
  life: number;
  color: Color;
  size: number;
  /** A shell climbs and bursts; a star falls and fades; a trail just fades. */
  kind: 'shell' | 'star' | 'trail';
  /** The colour a shell bursts into. */
  burst?: Color;
  twinkle: number;
}

interface Lantern {
  position: Vector3;
  scale: number;
  phase: number;
}

export class Festival {
  readonly root = new Group();

  private readonly rng = new Rng('mid-autumn');
  private readonly lanterns: Lantern[] = [];
  private readonly bodies: InstancedMesh;
  private readonly glows: InstancedMesh;
  private readonly sparks: Spark[] = [];
  private readonly points: Points<BufferGeometry, ShaderMaterial>;
  private readonly positions: Float32Array;
  private readonly colors: Float32Array;
  private readonly alphas: Float32Array;
  private readonly sizes: Float32Array;
  private active = false;
  private untilLaunch = 0;
  private time = 0;

  constructor() {
    this.root.name = 'mid-autumn';
    this.root.visible = false;
    this.placeLanterns();

    const lanternGeometry = new SphereGeometry(1, 12, 10);
    lanternGeometry.scale(0.42, 0.5, 0.42);
    this.bodies = new InstancedMesh(
      lanternGeometry,
      new MeshBasicMaterial({ color: LANTERN_RED, toneMapped: false }),
      this.lanterns.length,
    );
    this.glows = new InstancedMesh(
      new PlaneGeometry(1, 1),
      new MeshBasicMaterial({
        map: glowTexture(),
        color: LANTERN_GLOW,
        blending: AdditiveBlending,
        transparent: true,
        depthWrite: false,
        opacity: 0.75,
      }),
      this.lanterns.length,
    );
    const matrix = new Matrix4();
    const identity = new Quaternion();
    this.lanterns.forEach((lantern, index) => {
      this.bodies.setMatrixAt(
        index,
        matrix.compose(lantern.position, identity, new Vector3().setScalar(lantern.scale)),
      );
    });
    for (const mesh of [this.bodies, this.glows]) {
      mesh.frustumCulled = false;
      this.root.add(mesh);
    }
    this.glows.renderOrder = 2;
    // No cord is drawn: a line that fine vanishes from the god view, and
    // the lanterns alone trace each curve.

    for (let index = 0; index < MAX_SPARKS; index += 1) {
      this.sparks.push({
        alive: false,
        position: new Vector3(),
        velocity: new Vector3(),
        age: 0,
        life: 1,
        color: new Color(),
        size: 1,
        kind: 'star',
        twinkle: 0,
      });
    }
    this.positions = new Float32Array(MAX_SPARKS * 3);
    this.colors = new Float32Array(MAX_SPARKS * 3);
    this.alphas = new Float32Array(MAX_SPARKS);
    this.sizes = new Float32Array(MAX_SPARKS);
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(this.positions, 3));
    geometry.setAttribute('sparkColor', new BufferAttribute(this.colors, 3));
    geometry.setAttribute('sparkAlpha', new BufferAttribute(this.alphas, 1));
    geometry.setAttribute('sparkSize', new BufferAttribute(this.sizes, 1));
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
    this.root.add(this.points);
  }

  get isActive(): boolean {
    return this.active;
  }

  /** How many lanterns hang in town. */
  get lanternCount(): number {
    return this.lanterns.length;
  }

  setActive(on: boolean): void {
    this.active = on;
    this.root.visible = on;
    if (on) {
      this.untilLaunch = 0.3;
    } else {
      for (const spark of this.sparks) {
        spark.alive = false;
      }
    }
  }

  /** A lantern under every lamp head, and strings of them between neighbours. */
  private placeLanterns(): void {
    const lamps = streetLampPositions();
    const top = (lamp: Point): Vector3 =>
      new Vector3(lamp.x, groundHeight(lamp.x, lamp.z) + STREET_LAMP_HEIGHT - 0.35, lamp.z);

    for (const lamp of lamps) {
      const head = top(lamp);
      this.lanterns.push({
        // Hung off to one side of the pole, below the lamp.
        position: head.clone().add(new Vector3(0.7, -1.2, 0)),
        scale: 1.25,
        phase: this.rng.next() * Math.PI * 2,
      });
    }

    const strung = new Set<string>();
    lamps.forEach((lamp, index) => {
      let best: { other: number; away: number } | undefined;
      lamps.forEach((other, otherIndex) => {
        if (otherIndex === index) {
          return;
        }
        const away = Math.hypot(other.x - lamp.x, other.z - lamp.z);
        if (away >= STRING_MIN && away <= STRING_MAX && (!best || away < best.away)) {
          best = { other: otherIndex, away };
        }
      });
      if (!best) {
        return;
      }
      const key = [index, best.other].sort((a, b) => a - b).join('|');
      if (strung.has(key)) {
        return;
      }
      strung.add(key);
      const from = top(lamp);
      const to = top(lamps[best.other]);
      for (let bead = 1; bead <= LANTERNS_PER_STRING; bead += 1) {
        const t = bead / (LANTERNS_PER_STRING + 1);
        const at = from.clone().lerp(to, t);
        at.y -= STRING_SAG * 4 * t * (1 - t) + 0.45;
        this.lanterns.push({ position: at, scale: 0.8, phase: this.rng.next() * Math.PI * 2 });
      }
    });
  }

  update(deltaSeconds: number, camera: Camera): void {
    if (!this.active) {
      return;
    }
    const dt = Math.min(deltaSeconds, 0.1);
    this.time += dt;

    // The lanterns sway a hair and their glows breathe.
    const matrix = new Matrix4();
    const size = new Vector3();
    this.lanterns.forEach((lantern, index) => {
      const breathe = 1 + 0.08 * Math.sin(this.time * 1.7 + lantern.phase);
      size.setScalar(lantern.scale * 3.2 * breathe);
      this.glows.setMatrixAt(index, matrix.compose(lantern.position, camera.quaternion, size));
    });
    this.glows.instanceMatrix.needsUpdate = true;

    this.untilLaunch -= dt;
    if (this.untilLaunch <= 0) {
      this.launch();
      this.untilLaunch = this.rng.nextFloat(LAUNCH_GAP[0], LAUNCH_GAP[1]);
    }
    this.stepSparks(dt);
  }

  /** A shell goes up from somewhere along the sand. */
  private launch(): void {
    const x = this.rng.nextFloat(-85, 45);
    const z = coastZ(x) + this.rng.nextFloat(3, 8);
    const shell = this.spawn();
    if (!shell) {
      return;
    }
    shell.kind = 'shell';
    shell.position.set(x, groundHeight(x, z) + 0.5, z);
    shell.velocity.set(
      this.rng.nextFloat(-2, 2),
      this.rng.nextFloat(36, 44),
      this.rng.nextFloat(-2, 1),
    );
    shell.life = this.rng.nextFloat(1.6, 2.2);
    shell.color.setHex(0xffe2b0);
    shell.size = 1.6;
    shell.burst = new Color(this.rng.pick(FIREWORK_COLORS));
  }

  private spawn(): Spark | undefined {
    const spark = this.sparks.find((candidate) => !candidate.alive);
    if (!spark) {
      return undefined;
    }
    spark.alive = true;
    spark.age = 0;
    spark.twinkle = this.rng.next() * 10;
    return spark;
  }

  private explode(shell: Spark): void {
    const base = shell.burst ?? new Color(0xffffff);
    // Now and then a second colour mixed in, and now and then a big one.
    const second = this.rng.next() < 0.35 ? new Color(this.rng.pick(FIREWORK_COLORS)) : base;
    const big = this.rng.next() < 0.25;
    const count = big ? SPARKS_PER_BURST * 1.5 : SPARKS_PER_BURST;
    const speed = big ? 42 : 32;
    for (let index = 0; index < count; index += 1) {
      const star = this.spawn();
      if (!star) {
        return;
      }
      // Evenly round a sphere, with a little spread in speed.
      const u = this.rng.next() * 2 - 1;
      const angle = this.rng.next() * Math.PI * 2;
      const across = Math.sqrt(1 - u * u);
      const pace = speed * (0.8 + 0.2 * this.rng.next());
      star.kind = 'star';
      star.position.copy(shell.position);
      star.velocity.set(across * Math.cos(angle) * pace, u * pace, across * Math.sin(angle) * pace);
      star.life = this.rng.nextFloat(1.6, 2.5);
      star.color.copy(index % 3 === 0 ? second : base);
      star.size = big ? 2.2 : 1.8;
    }
  }

  private stepSparks(dt: number): void {
    let written = 0;
    for (const spark of this.sparks) {
      if (!spark.alive) {
        continue;
      }
      spark.age += dt;
      if (spark.kind === 'shell') {
        spark.velocity.y -= GRAVITY * dt;
        spark.position.addScaledVector(spark.velocity, dt);
        // A short trail of embers behind the climbing shell.
        const ember = this.rng.next() < 0.7 ? this.spawn() : undefined;
        if (ember) {
          ember.kind = 'trail';
          ember.position.copy(spark.position);
          ember.velocity.set(0, -1, 0);
          ember.life = 0.5;
          ember.color.setHex(0xffc27a);
          ember.size = 1;
        }
        if (spark.age >= spark.life) {
          spark.alive = false;
          this.explode(spark);
          continue;
        }
      } else {
        // Air drag slows the stars, then gravity takes them down.
        spark.velocity.multiplyScalar(Math.exp(-1.3 * dt));
        spark.velocity.y -= GRAVITY * 0.35 * dt;
        spark.position.addScaledVector(spark.velocity, dt);
        if (spark.age >= spark.life) {
          spark.alive = false;
          continue;
        }
      }

      const t = spark.age / spark.life;
      let alpha = spark.kind === 'shell' ? 1 : 1 - t * t;
      if (spark.kind === 'star' && t > 0.55) {
        // They twinkle out at the end.
        alpha *= 0.6 + 0.4 * Math.sin(spark.age * 30 + spark.twinkle);
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
    this.bodies.geometry.dispose();
    this.glows.geometry.dispose();
    this.points.geometry.dispose();
    this.points.material.dispose();
  }
}

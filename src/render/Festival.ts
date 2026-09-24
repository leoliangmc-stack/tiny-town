import {
  AdditiveBlending,
  Color,
  Group,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  PlaneGeometry,
  Quaternion,
  SphereGeometry,
  Vector3,
  type Camera,
} from 'three';

import type { Point } from '../entities/geometry.js';
import { Rng } from '../simulation/Rng.js';
import { groundHeight } from '../world/Terrain.js';
import { STREET_LAMP_HEIGHT, streetLampPositions } from '../world/Town.js';

import { Fireworks, type FireworkSound } from './Fireworks.js';
import { glowTexture } from './glow.js';

/**
 * Mid-Autumn night (SPEC.md 2.15, decision 37): red lanterns on every street
 * lamp and strung between neighbouring lamps, and the fireworks over the
 * beach and the town (Fireworks.ts). The sky, the full moon and the lit
 * windows are the Environment's and the TownView's, the Moon Palace and the
 * dragons have their own modules; this is the rest of the party.
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
  private readonly fireworks = new Fireworks();
  private active = false;
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

    this.root.add(this.fireworks.points);
  }

  get isActive(): boolean {
    return this.active;
  }

  /** How many firework sparks are in the air, for tooling. */
  get sparkCount(): number {
    return this.fireworks.sparkCount;
  }

  /** How many lanterns hang in town. */
  get lanternCount(): number {
    return this.lanterns.length;
  }

  setActive(on: boolean): void {
    this.active = on;
    this.root.visible = on;
    if (on) {
      this.fireworks.start();
    } else {
      this.fireworks.stop();
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

    this.fireworks.update(dt);
  }

  /** The fireworks' launches and bursts since the last frame, for the ambience. */
  takeFireworkSounds(): FireworkSound[] {
    return this.fireworks.takeSounds();
  }

  dispose(): void {
    this.bodies.geometry.dispose();
    this.glows.geometry.dispose();
    this.fireworks.dispose();
  }
}

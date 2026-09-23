import {
  AdditiveBlending,
  Color,
  CylinderGeometry,
  Group,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  Quaternion,
  SphereGeometry,
  Vector3,
  type Camera,
} from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

import type { World } from '../simulation/World.js';
import { groundHeight } from '../world/Terrain.js';
import { SIDEWALK_EDGE, TRAFFIC_LIGHTS, type TrafficLight } from '../world/Town.js';

import { glowTexture } from './glow.js';

/**
 * The traffic lights the cars already obey (SPEC.md 2.5, decision 35): a
 * post on each corner of the two signalled junctions, its head facing the
 * traffic that keeps to the right on the way in. Each head shows red, amber
 * or green from the same phase the VehicleSystem reads, so a car waiting at
 * a junction is waiting at a red light you can see.
 */

const POST_HEIGHT = 3.4;
const PAVEMENT_HEIGHT = 0.18;
/** How far in from the corner of the pavement a post stands. */
const POST_INSET = 0.7;
/** The last part of each green shows amber, in game minutes. */
const AMBER_MINUTES = 0.25;

const LAMP_SPACING = 0.36;
const RED = new Color(0xff3b2f);
const AMBER = new Color(0xffb020);
const GREEN = new Color(0x3ee07a);
const DARK = new Color(0x2a2c2e);

type Aspect = 'red' | 'amber' | 'green';

interface Head {
  light: TrafficLight;
  axis: 'x' | 'z';
  /** Where the lamps' centre is, and the way the face looks. */
  position: Vector3;
  facing: Vector3;
}

export class TrafficLights {
  readonly root = new Group();

  private readonly heads: Head[] = [];
  private readonly lamps: InstancedMesh;
  private readonly glows: InstancedMesh;
  private readonly color = new Color();

  constructor() {
    this.root.name = 'traffic-lights';
    for (const light of TRAFFIC_LIGHTS) {
      const corner = SIDEWALK_EDGE - POST_INSET;
      for (const sx of [-1, 1] as const) {
        for (const sz of [-1, 1] as const) {
          // Traffic keeps right, so a car coming in along x from the +x side
          // drives on the -z half and meets the post on corner (+x, -z); and
          // a car coming in along z from the +z side meets the one on (+x, +z).
          const axis: 'x' | 'z' = sx === -sz ? 'x' : 'z';
          const facing = axis === 'x' ? new Vector3(sx, 0, 0) : new Vector3(0, 0, sz);
          const x = light.x + sx * corner;
          const z = light.z + sz * corner;
          const y = groundHeight(x, z) + PAVEMENT_HEIGHT + POST_HEIGHT - 0.55;
          this.heads.push({
            light,
            axis,
            position: new Vector3(x, y, z).addScaledVector(facing, 0.2),
            facing,
          });
        }
      }
    }

    const matte = new MeshStandardMaterial({ roughness: 0.7, metalness: 0.1 });
    const posts = new InstancedMesh(
      new CylinderGeometry(0.07, 0.08, POST_HEIGHT, 8),
      matte,
      this.heads.length,
    );
    const housings = new InstancedMesh(
      new RoundedBoxGeometry(0.46, 1.25, 0.34, 2, 0.06),
      matte,
      this.heads.length,
    );
    this.lamps = new InstancedMesh(
      new SphereGeometry(0.12, 10, 8),
      new MeshBasicMaterial({ toneMapped: false }),
      this.heads.length * 3,
    );
    this.glows = new InstancedMesh(
      new PlaneGeometry(1, 1),
      new MeshBasicMaterial({
        map: glowTexture(),
        blending: AdditiveBlending,
        transparent: true,
        depthWrite: false,
        toneMapped: false,
      }),
      this.heads.length,
    );

    const matrix = new Matrix4();
    const rotation = new Quaternion();
    const unit = new Vector3(1, 1, 1);
    this.heads.forEach((head, index) => {
      const base = new Vector3(head.position.x, 0, head.position.z).addScaledVector(
        head.facing,
        -0.2,
      );
      base.y = groundHeight(base.x, base.z) + PAVEMENT_HEIGHT + POST_HEIGHT / 2;
      posts.setMatrixAt(index, matrix.compose(base, rotation, unit));
      posts.setColorAt(index, this.color.setHex(0x3a3d40));
      rotation.setFromUnitVectors(new Vector3(0, 0, 1), head.facing);
      const housing = head.position.clone().addScaledVector(head.facing, -0.05);
      housings.setMatrixAt(index, matrix.compose(housing, rotation, unit));
      housings.setColorAt(index, this.color.setHex(0x2f3336));
      rotation.identity();
      for (let lamp = 0; lamp < 3; lamp += 1) {
        const at = head.position
          .clone()
          .addScaledVector(head.facing, 0.14)
          .add(new Vector3(0, (1 - lamp) * LAMP_SPACING, 0));
        this.lamps.setMatrixAt(index * 3 + lamp, matrix.compose(at, rotation, unit));
      }
    });

    for (const mesh of [posts, housings, this.lamps, this.glows]) {
      mesh.frustumCulled = false;
      this.root.add(mesh);
    }
    posts.castShadow = true;
    housings.castShadow = true;
    this.glows.renderOrder = 2;
  }

  /** Which lamp a head shows at a moment of the game clock. */
  aspect(head: Head, minuteOfDay: number, world: World): Aspect {
    const green = world.vehicleSystem.isGreen(head.light, head.axis, minuteOfDay);
    if (!green) {
      return 'red';
    }
    const cycle = head.light.greenMinutes * 2;
    const phase = minuteOfDay % cycle;
    const greenEnds = head.axis === 'x' ? head.light.greenMinutes : cycle;
    return greenEnds - phase <= AMBER_MINUTES ? 'amber' : 'green';
  }

  update(world: World, camera: Camera, night: number): void {
    const minute = world.time.minuteOfDay;
    const matrix = new Matrix4();
    const glowSize = 1.2 + 1.4 * night;
    const glowScale = new Vector3(glowSize, glowSize, glowSize);
    this.heads.forEach((head, index) => {
      const aspect = this.aspect(head, minute, world);
      const lit: Aspect[] = ['red', 'amber', 'green'];
      lit.forEach((which, lamp) => {
        const on = which === aspect;
        const color = which === 'red' ? RED : which === 'amber' ? AMBER : GREEN;
        this.lamps.setColorAt(index * 3 + lamp, on ? color : DARK);
        if (on) {
          const at = head.position
            .clone()
            .addScaledVector(head.facing, 0.3)
            .add(new Vector3(0, (1 - lamp) * LAMP_SPACING, 0));
          this.glows.setMatrixAt(index, matrix.compose(at, camera.quaternion, glowScale));
          this.glows.setColorAt(index, this.color.copy(color).multiplyScalar(0.55 + 0.45 * night));
        }
      });
    });
    this.glows.instanceMatrix.needsUpdate = true;
    if (this.lamps.instanceColor) {
      this.lamps.instanceColor.needsUpdate = true;
    }
    if (this.glows.instanceColor) {
      this.glows.instanceColor.needsUpdate = true;
    }
  }
}

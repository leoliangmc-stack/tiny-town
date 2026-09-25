import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  type Camera,
  Color,
  Group,
  InstancedMesh,
  type Material,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  Quaternion,
  Vector3,
} from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

import {
  carPose,
  COUNTRY_CARS,
  COUNTRY_ROAD_WIDTH,
  COUNTRY_ROADS,
  type Path,
} from '../world/Countryside.js';
import { groundHeight } from '../world/Terrain.js';

import type { EnvironmentState } from './Environment.js';
import { glowTexture } from './glow.js';

/**
 * The country road out of the town and the cars on it (SPEC.md 2.14,
 * decision 44).
 *
 * The road is a ribbon of plain tarmac draped over the rolling ground. The
 * cars drive between the fishing village and the hill village on real time,
 * like the boats: they are background, never enter the town, and the
 * simulation, the state hash and the navigation graphs never know about them.
 * After dark each shows a warm glow ahead and a red one behind, which is what
 * reads from the god view. Road and cars together are six draw calls.
 */

/** The same warm grey as the town's streets, a shade paler with dust. */
const TARMAC = 0x807b72;
/** How far the ribbon floats over the ground, with a polygon offset to keep it on top. */
const ROAD_LIFT = 0.06;

const CAR_LENGTH = 4.2;
const CAR_WIDTH = 1.9;
const CAR_BODY_HEIGHT = 0.8;
const HEADLIGHT = 0xfff0c8;
const TAILLIGHT = 0xff5a3c;

type Part = 'body' | 'cabin' | 'headGlow' | 'tailGlow';

export class CountryRoad {
  readonly root = new Group();

  private readonly parts: Record<Part, InstancedMesh>;
  private readonly headMaterial: MeshBasicMaterial;
  private readonly tailMaterial: MeshBasicMaterial;
  private readonly hidden = new Matrix4().makeScale(0, 0, 0);
  private readonly matrix = new Matrix4();
  private readonly position = new Vector3();
  private readonly rotation = new Quaternion();
  private readonly size = new Vector3();
  private readonly up = new Vector3(0, 1, 0);
  private readonly forward = new Vector3();

  constructor() {
    this.root.name = 'country-road';

    const tarmac = new MeshStandardMaterial({
      color: TARMAC,
      roughness: 0.95,
      metalness: 0,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });
    for (const road of COUNTRY_ROADS) {
      const mesh = new Mesh(ribbon(road, COUNTRY_ROAD_WIDTH), tarmac);
      mesh.receiveShadow = true;
      mesh.name = 'country-road';
      this.root.add(mesh);
    }

    const count = COUNTRY_CARS.length;
    const paint = new MeshStandardMaterial({ roughness: 0.8, metalness: 0 });
    const glass = new MeshStandardMaterial({ color: 0x8fa6b8, roughness: 0.5, metalness: 0 });
    const glow = (color: number): MeshBasicMaterial =>
      new MeshBasicMaterial({
        map: glowTexture(),
        color,
        blending: AdditiveBlending,
        transparent: true,
        depthWrite: false,
        opacity: 0,
      });
    this.headMaterial = glow(HEADLIGHT);
    this.tailMaterial = glow(TAILLIGHT);

    const make = (part: Part, geometry: BufferGeometry, material: Material): InstancedMesh => {
      const mesh = new InstancedMesh(geometry, material, count);
      mesh.name = `country-car-${part}`;
      mesh.frustumCulled = false;
      this.root.add(mesh);
      return mesh;
    };
    this.parts = {
      body: make('body', new RoundedBoxGeometry(1, 1, 1, 2, 0.12), paint),
      cabin: make('cabin', new RoundedBoxGeometry(1, 1, 1, 2, 0.15), glass),
      headGlow: make('headGlow', new PlaneGeometry(1, 1), this.headMaterial),
      tailGlow: make('tailGlow', new PlaneGeometry(1, 1), this.tailMaterial),
    };
    this.parts.headGlow.renderOrder = 2;
    this.parts.tailGlow.renderOrder = 2;
    COUNTRY_CARS.forEach((car, index) => {
      this.parts.body.setColorAt(index, new Color(car.color));
    });
  }

  /** Drives every car on to `elapsedSeconds` of real time; lights come on with the street lamps. */
  update(environment: EnvironmentState, elapsedSeconds: number, camera: Camera): void {
    this.headMaterial.opacity = environment.lampFactor * 0.9;
    this.tailMaterial.opacity = environment.lampFactor * 0.7;

    COUNTRY_CARS.forEach((car, index) => {
      const pose = carPose(car, elapsedSeconds);
      if (pose.scale <= 0.01) {
        for (const mesh of Object.values(this.parts)) {
          mesh.setMatrixAt(index, this.hidden);
        }
        return;
      }
      const s = pose.scale;
      const ground = groundHeight(pose.x, pose.z);
      this.rotation.setFromAxisAngle(this.up, pose.heading);
      const forward = this.forward.set(Math.sin(pose.heading), 0, Math.cos(pose.heading));

      this.place('body', index, pose.x, ground + 0.35 * s + (CAR_BODY_HEIGHT * s) / 2, pose.z, {
        x: CAR_WIDTH * s,
        y: CAR_BODY_HEIGHT * s,
        z: CAR_LENGTH * s,
      });
      this.position
        .set(pose.x, ground + (0.35 + CAR_BODY_HEIGHT + 0.3) * s, pose.z)
        .addScaledVector(forward, -0.25 * s);
      this.matrix.compose(
        this.position,
        this.rotation,
        this.size.set(CAR_WIDTH * 0.84 * s, 0.62 * s, CAR_LENGTH * 0.5 * s),
      );
      this.parts.cabin.setMatrixAt(index, this.matrix);

      // The lights: a glow just ahead of the bonnet and a smaller red one behind.
      const lampHeight = ground + 0.75 * s;
      this.position
        .set(pose.x, lampHeight, pose.z)
        .addScaledVector(forward, (CAR_LENGTH / 2 + 0.6) * s);
      this.matrix.compose(this.position, camera.quaternion, this.size.setScalar(3.2 * s));
      this.parts.headGlow.setMatrixAt(index, this.matrix);
      this.position
        .set(pose.x, lampHeight, pose.z)
        .addScaledVector(forward, -(CAR_LENGTH / 2 + 0.2) * s);
      this.matrix.compose(this.position, camera.quaternion, this.size.setScalar(1.6 * s));
      this.parts.tailGlow.setMatrixAt(index, this.matrix);
    });

    for (const mesh of Object.values(this.parts)) {
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) {
        mesh.instanceColor.needsUpdate = true;
      }
    }
  }

  private place(
    part: Part,
    index: number,
    x: number,
    y: number,
    z: number,
    size: { x: number; y: number; z: number },
  ): void {
    this.matrix.compose(
      this.position.set(x, y, z),
      this.rotation,
      this.size.set(size.x, size.y, size.z),
    );
    this.parts[part].setMatrixAt(index, this.matrix);
  }

  dispose(): void {
    for (const child of this.root.children) {
      if (child instanceof Mesh) {
        child.geometry.dispose();
        (child.material as Material).dispose();
      }
    }
  }
}

/**
 * A flat strip `width` wide along a path, every vertex lifted to the ground
 * under it, so the road rides the meadows' swell instead of cutting through.
 */
export function ribbon(path: Path, width: number): BufferGeometry {
  const { points } = path;
  const positions: number[] = [];
  const indices: number[] = [];
  for (let index = 0; index < points.length; index += 1) {
    const before = points[Math.max(0, index - 1)];
    const after = points[Math.min(points.length - 1, index + 1)];
    const dx = after.x - before.x;
    const dz = after.z - before.z;
    const length = Math.hypot(dx, dz) || 1;
    // Left of the direction of travel, half a road wide.
    const nx = (dz / length) * (width / 2);
    const nz = (-dx / length) * (width / 2);
    for (const side of [1, -1]) {
      const x = points[index].x + nx * side;
      const z = points[index].z + nz * side;
      positions.push(x, groundHeight(x, z) + ROAD_LIFT, z);
    }
    if (index > 0) {
      const a = (index - 1) * 2;
      indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
  geometry.setIndex(indices);
  // Left, right, next left: wound anticlockwise seen from above, so it faces up.
  geometry.computeVertexNormals();
  return geometry;
}

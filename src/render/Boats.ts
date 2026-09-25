import {
  AdditiveBlending,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  Euler,
  Group,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  Quaternion,
  Vector3,
  type Camera,
  type Material,
} from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

import { COASTER_VOYAGE, LAUNCH_VOYAGE, type Voyage, voyagePose } from '../world/Countryside.js';

import type { EnvironmentState } from './Environment.js';
import { glowTexture } from './glow.js';

/**
 * Boats on the sea (SPEC.md 2.14, decision 32): two sailboats circling
 * inshore, a fishing boat running along the coast and a ferry crossing far
 * out, its ends lost in the haze. Two more come and go (decision 44): a
 * coaster that leaves the fishing village's harbour for the horizon and comes
 * back, and a small passenger boat between that harbour and the island.
 *
 * Like the clouds and the swell they move on real time and are pure render
 * side: the simulation, the state hash and the navigation graphs never know
 * they exist. They stay visible at every speed; they are background, and at
 * 100x they drift about as fast as the clouds do. Every boat is built from
 * six instanced parts shared by all of them, so the fleet is six draw calls.
 */

/** The water surface the boats float on, just above the sea plane. */
const WATERLINE = 0.05;

/** The ferry wraps round between these x, beyond the fog at either end. */
const FERRY_REACH = 420;
/** Over this many metres at each end the ferry shrinks away, in case the fog is thin. */
const FERRY_FADE = 60;

const WARM_LAMP = 0xffd9a0;

type BoatKind = 'sail' | 'fishing' | 'ferry' | 'coaster' | 'launch';

/** A closed loop on the water: an ellipse, sailed once every `period` seconds. */
interface Loop {
  kind: 'loop';
  centreX: number;
  centreZ: number;
  radiusX: number;
  radiusZ: number;
  period: number;
  /** Where on the loop the boat starts, in radians. */
  phase: number;
  /** 1 anticlockwise seen from above, -1 clockwise. */
  direction: 1 | -1;
}

/** A straight crossing along x at a fixed z, wrapping round at the ends. */
interface Crossing {
  kind: 'crossing';
  z: number;
  /** Metres per second. */
  speed: number;
  /** Where along the crossing it starts, in metres from the west end. */
  start: number;
}

/** A voyage between two harbours, or out to the horizon and back (world/Countryside.ts). */
interface Plied {
  kind: 'voyage';
  voyage: Voyage;
}

interface BoatSpec {
  kind: BoatKind;
  hull: number;
  trim: number;
  /** Hull length; the other sizes follow from it. */
  length: number;
  course: Loop | Crossing | Plied;
}

/**
 * The fleet. Every loop keeps well clear of the shore (the beach reaches no
 * further out than z = -91) and of the lighthouse on its headland.
 */
const BOATS: readonly BoatSpec[] = [
  {
    kind: 'sail',
    hull: 0xf5f2ea,
    trim: 0x3f7fb8,
    length: 6,
    course: {
      kind: 'loop',
      centreX: -45,
      centreZ: -135,
      radiusX: 70,
      radiusZ: 22,
      period: 150,
      phase: 0.6,
      direction: 1,
    },
  },
  {
    kind: 'sail',
    hull: 0xf5f2ea,
    trim: 0xc9705f,
    length: 5.4,
    course: {
      kind: 'loop',
      centreX: 60,
      centreZ: -165,
      radiusX: 55,
      radiusZ: 24,
      period: 185,
      phase: 3.4,
      direction: -1,
    },
  },
  {
    kind: 'fishing',
    hull: 0x3f7fb8,
    trim: 0xf5f2ea,
    length: 6.5,
    course: {
      kind: 'loop',
      centreX: -5,
      centreZ: -101,
      radiusX: 85,
      radiusZ: 5,
      period: 170,
      phase: 2,
      direction: -1,
    },
  },
  {
    kind: 'ferry',
    hull: 0x2f4e9a,
    trim: 0xf5f2ea,
    length: 24,
    course: { kind: 'crossing', z: -225, speed: 4.5, start: 300 },
  },
  {
    kind: 'coaster',
    hull: 0x8a4a3c,
    trim: 0xf5f2ea,
    length: 16,
    course: { kind: 'voyage', voyage: COASTER_VOYAGE },
  },
  {
    kind: 'launch',
    hull: 0xf5f2ea,
    trim: 0x2f4e9a,
    length: 9,
    course: { kind: 'voyage', voyage: LAUNCH_VOYAGE },
  },
];

type Part = 'hull' | 'cabin' | 'mast' | 'sail' | 'wake' | 'lamp';

/** How many of each part a boat of each kind uses. */
const PARTS_PER_KIND: Record<BoatKind, Record<Part, number>> = {
  sail: { hull: 1, cabin: 1, mast: 1, sail: 2, wake: 1, lamp: 1 },
  fishing: { hull: 1, cabin: 2, mast: 1, sail: 0, wake: 1, lamp: 1 },
  ferry: { hull: 1, cabin: 2, mast: 1, sail: 0, wake: 1, lamp: 1 },
  coaster: { hull: 1, cabin: 3, mast: 1, sail: 0, wake: 1, lamp: 1 },
  launch: { hull: 1, cabin: 2, mast: 1, sail: 0, wake: 1, lamp: 1 },
};

export class Boats {
  readonly root = new Group();

  private readonly parts: Record<Part, InstancedMesh>;
  private readonly used: Record<Part, number> = {
    hull: 0,
    cabin: 0,
    mast: 0,
    sail: 0,
    wake: 0,
    lamp: 0,
  };
  private readonly lampMaterial: MeshBasicMaterial;
  private readonly hidden = new Matrix4().makeScale(0, 0, 0);
  private readonly color = new Color();

  constructor() {
    this.root.name = 'boats';

    const matte = new MeshStandardMaterial({ roughness: 0.75, metalness: 0 });
    const cloth = new MeshStandardMaterial({ roughness: 0.95, metalness: 0, side: DoubleSide });
    const wakeMaterial = new MeshBasicMaterial({
      map: glowTexture(),
      color: 0xffffff,
      transparent: true,
      depthWrite: false,
      opacity: 0.5,
    });
    this.lampMaterial = new MeshBasicMaterial({
      map: glowTexture(),
      color: WARM_LAMP,
      blending: AdditiveBlending,
      transparent: true,
      depthWrite: false,
      opacity: 0,
    });

    const wake = new PlaneGeometry(1, 1);
    wake.rotateX(-Math.PI / 2);

    const count = (part: Part): number =>
      BOATS.reduce((sum, boat) => sum + PARTS_PER_KIND[boat.kind][part], 0);
    const make = (part: Part, geometry: BufferGeometry, material: Material): InstancedMesh => {
      const mesh = new InstancedMesh(geometry, material, count(part));
      mesh.name = `boat-${part}`;
      mesh.frustumCulled = false;
      this.root.add(mesh);
      return mesh;
    };
    this.parts = {
      hull: make('hull', hullGeometry(), matte),
      cabin: make('cabin', new RoundedBoxGeometry(1, 1, 1, 2, 0.1), matte),
      mast: make('mast', new CylinderGeometry(1, 1, 1, 6), matte),
      sail: make('sail', sailGeometry(), cloth),
      wake: make('wake', wake, wakeMaterial),
      lamp: make('lamp', new PlaneGeometry(1, 1), this.lampMaterial),
    };
    // Wakes and lamp glows are drawn after the water and the hulls.
    this.parts.wake.renderOrder = 1;
    this.parts.lamp.renderOrder = 2;
  }

  /** Where every boat is right now, for tests and tooling. */
  positions(elapsedSeconds: number): Vector3[] {
    return BOATS.map((boat) => {
      const { x, z } = where(boat, elapsedSeconds);
      return new Vector3(x, WATERLINE, z);
    });
  }

  /**
   * Sails every boat on to `elapsedSeconds` of real time. Lamps come on with
   * the street lamps, at a fraction of a window's warmth.
   */
  update(environment: EnvironmentState, elapsedSeconds: number, camera: Camera): void {
    this.lampMaterial.opacity = environment.lampFactor * 0.55;
    for (const part of Object.keys(this.used) as Part[]) {
      this.used[part] = 0;
    }

    BOATS.forEach((boat, index) => {
      this.draw(boat, index, elapsedSeconds, camera);
    });

    for (const part of Object.keys(this.parts) as Part[]) {
      const mesh = this.parts[part];
      for (let slot = this.used[part]; slot < mesh.count; slot += 1) {
        mesh.setMatrixAt(slot, this.hidden);
      }
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) {
        mesh.instanceColor.needsUpdate = true;
      }
    }
  }

  private draw(boat: BoatSpec, index: number, time: number, camera: Camera): void {
    const { x, z, heading, scale, moving } = where(boat, time);
    const length = boat.length * scale;
    if (length <= 0.01) {
      return;
    }
    const big = boat.kind === 'ferry' || boat.kind === 'coaster';
    const width = length * (big ? 0.24 : boat.kind === 'launch' ? 0.3 : 0.36);
    const hullHeight = length * (big ? 0.13 : 0.2);

    // A gentle swell: bob, roll and pitch, each on its own beat per boat.
    const bob = Math.sin(time * 1.3 + index * 1.7) * 0.08 * scale;
    const roll = Math.sin(time * 0.9 + index * 2.3) * (big ? 0.01 : 0.05);
    const pitch = Math.sin(time * 1.1 + index * 0.7) * (big ? 0.006 : 0.03);
    // Sailboats heel a little away from the wind.
    const heel = boat.kind === 'sail' ? 0.12 : 0;
    const base = new Matrix4().compose(
      new Vector3(x, WATERLINE + bob, z),
      new Quaternion().setFromEuler(new Euler(pitch, heading, roll + heel, 'YXZ')),
      new Vector3(1, 1, 1),
    );

    const place = (
      part: Part,
      local: Vector3,
      size: Vector3,
      color?: number,
      rotation?: Quaternion,
    ): void => {
      const slot = this.used[part]++;
      const matrix = new Matrix4().compose(local, rotation ?? new Quaternion(), size);
      this.parts[part].setMatrixAt(slot, base.clone().multiply(matrix));
      if (color !== undefined) {
        this.parts[part].setColorAt(slot, this.color.setHex(color));
      }
    };

    // The hull sits a third under water.
    place(
      'hull',
      new Vector3(0, hullHeight * 0.17, 0),
      new Vector3(width, hullHeight, length),
      boat.hull,
    );

    // The wake: a soft pale streak behind, flat on the water, not rolling with the hull.
    // A boat tied up at a quay leaves none.
    const wakeSlot = this.used.wake++;
    const wakeLength = moving ? length * 2.4 : 0;
    const back = new Vector3(Math.sin(heading), 0, Math.cos(heading)).multiplyScalar(-length * 1.1);
    this.parts.wake.setMatrixAt(
      wakeSlot,
      new Matrix4().compose(
        new Vector3(x + back.x, WATERLINE + 0.03, z + back.z),
        new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), heading),
        new Vector3(width * 1.6, 1, wakeLength),
      ),
    );

    const deck = hullHeight * 0.67;
    let lampAt: Vector3;
    if (boat.kind === 'sail') {
      const mastHeight = length * 1.25;
      place(
        'cabin',
        new Vector3(0, deck + 0.2, -length * 0.12),
        new Vector3(width * 0.6, 0.45, length * 0.3),
        boat.trim,
      );
      place(
        'mast',
        new Vector3(0, deck + mastHeight / 2, length * 0.08),
        new Vector3(0.07, mastHeight, 0.07),
        0xd8d2c4,
      );
      // Mainsail aft of the mast, jib forward of it.
      place(
        'sail',
        new Vector3(0, deck + 0.5, length * 0.06),
        new Vector3(1, mastHeight * 0.92, length * 0.5),
        0xfbf8f0,
      );
      place(
        'sail',
        new Vector3(0, deck + 0.4, length * 0.48),
        new Vector3(1, mastHeight * 0.78, length * 0.36),
        0xf3eee2,
      );
      lampAt = new Vector3(0, deck + mastHeight, length * 0.08);
    } else if (boat.kind === 'fishing') {
      place(
        'cabin',
        new Vector3(0, deck + 0.55, -length * 0.1),
        new Vector3(width * 0.7, 1.1, length * 0.3),
        boat.trim,
      );
      place(
        'cabin',
        new Vector3(0, deck + 1.15, -length * 0.1),
        new Vector3(width * 0.76, 0.12, length * 0.34),
        0xc9705f,
      );
      place(
        'mast',
        new Vector3(0, deck + 1.6, length * 0.2),
        new Vector3(0.06, 3.2, 0.06),
        0x8b6b4e,
      );
      lampAt = new Vector3(0, deck + 3.2, length * 0.2);
    } else if (boat.kind === 'coaster') {
      // The coaster: a white bridge aft, two stacks of cargo forward, a funnel.
      place(
        'cabin',
        new Vector3(0, deck + 1.4, -length * 0.34),
        new Vector3(width * 0.8, 2.8, length * 0.18),
        boat.trim,
      );
      place(
        'cabin',
        new Vector3(0, deck + 0.6, length * 0.02),
        new Vector3(width * 0.78, 1.2, length * 0.26),
        0x3f7fb8,
      );
      place(
        'cabin',
        new Vector3(0, deck + 0.6, length * 0.3),
        new Vector3(width * 0.7, 1.2, length * 0.2),
        0xc9a45f,
      );
      place(
        'mast',
        new Vector3(0, deck + 3.4, -length * 0.4),
        new Vector3(0.5, 1.6, 0.5),
        0x3f3d3a,
      );
      lampAt = new Vector3(0, deck + 3.2, -length * 0.3);
    } else if (boat.kind === 'launch') {
      // The passenger boat: a long low cabin with a coloured roof and a short mast.
      place(
        'cabin',
        new Vector3(0, deck + 0.55, -length * 0.05),
        new Vector3(width * 0.8, 1.1, length * 0.5),
        0xf5f2ea,
      );
      place(
        'cabin',
        new Vector3(0, deck + 1.15, -length * 0.05),
        new Vector3(width * 0.86, 0.14, length * 0.56),
        boat.trim,
      );
      place('mast', new Vector3(0, deck + 2, length * 0.1), new Vector3(0.06, 2.2, 0.06), 0xd8d2c4);
      lampAt = new Vector3(0, deck + 3.1, length * 0.1);
    } else {
      // The ferry: a long white superstructure and a funnel.
      place(
        'cabin',
        new Vector3(0, deck + 1.1, -length * 0.05),
        new Vector3(width * 0.86, 2.2, length * 0.62),
        boat.trim,
      );
      place(
        'cabin',
        new Vector3(0, deck + 2.7, -length * 0.08),
        new Vector3(width * 0.6, 1.1, length * 0.3),
        boat.trim,
      );
      place(
        'mast',
        new Vector3(0, deck + 3.8, -length * 0.22),
        new Vector3(0.8, 2.2, 0.8),
        0xc9705f,
      );
      lampAt = new Vector3(0, deck + 3.5, length * 0.1);
    }

    // A small lamp: a warm glow turned to the camera.
    const lampSlot = this.used.lamp++;
    const lampWorld = lampAt.applyMatrix4(base);
    const glowSize = big ? 5 : 3;
    this.parts.lamp.setMatrixAt(
      lampSlot,
      new Matrix4().compose(
        lampWorld,
        camera.quaternion,
        new Vector3(glowSize, glowSize, glowSize),
      ),
    );
  }

  dispose(): void {
    for (const mesh of Object.values(this.parts)) {
      mesh.geometry.dispose();
      (mesh.material as Material).dispose();
    }
  }
}

/** Where a boat is at a moment, which way it faces, and how much of it to draw. */
function where(
  boat: BoatSpec,
  time: number,
): { x: number; z: number; heading: number; scale: number; moving: boolean } {
  const course = boat.course;
  if (course.kind === 'voyage') {
    return voyagePose(course.voyage, time);
  }
  if (course.kind === 'loop') {
    const angle = course.phase + (course.direction * time * Math.PI * 2) / course.period;
    const x = course.centreX + course.radiusX * Math.cos(angle);
    const z = course.centreZ + course.radiusZ * Math.sin(angle);
    const dx = -course.radiusX * Math.sin(angle) * course.direction;
    const dz = course.radiusZ * Math.cos(angle) * course.direction;
    // Heading is measured from +Z towards +X, as for the cars.
    return { x, z, heading: Math.atan2(dx, dz), scale: 1, moving: true };
  }
  const span = FERRY_REACH * 2;
  const along = (((course.start + time * course.speed) % span) + span) % span;
  const x = along - FERRY_REACH;
  const fromEnd = Math.min(along, span - along);
  const scale = Math.min(1, fromEnd / FERRY_FADE);
  return { x, z: course.z, heading: Math.PI / 2, scale, moving: true };
}

/**
 * A hull: a box whose bow narrows to a point and whose keel is narrower than
 * its deck. Forward is +Z; the unit hull is 1 wide, 1 high and 1 long.
 */
function hullGeometry(): BufferGeometry {
  const box = new BoxGeometry(1, 1, 1, 1, 1, 4);
  const positions = box.getAttribute('position') as BufferAttribute;
  for (let index = 0; index < positions.count; index += 1) {
    let x = positions.getX(index);
    const y = positions.getY(index);
    const z = positions.getZ(index);
    // Bow: narrow the front third to a point.
    const bow = Math.max(0, (z - 0.15) / 0.35);
    x *= 1 - 0.92 * Math.min(1, bow);
    // Keel: the bottom a little narrower than the deck.
    if (y < 0) {
      x *= 0.72;
    }
    // A slight rise of the deck line towards the bow.
    positions.setXYZ(index, x, y > 0 ? y + Math.max(0, z) * 0.25 : y, z);
  }
  const geometry = box.toNonIndexed();
  geometry.computeVertexNormals();
  box.dispose();
  return geometry;
}

/**
 * A sail: a right triangle in the boat's YZ plane, its luff up the mast (the
 * +Y edge at z = 0) and its foot running aft to z = -1. Unit sized.
 */
function sailGeometry(): BufferGeometry {
  const geometry = new BufferGeometry();
  geometry.setAttribute(
    'position',
    new BufferAttribute(new Float32Array([0, 0, 0, 0, 1, 0, 0, 0, -1]), 3),
  );
  geometry.computeVertexNormals();
  return geometry;
}

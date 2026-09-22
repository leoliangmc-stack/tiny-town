import {
  CapsuleGeometry,
  Color,
  Group,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  SphereGeometry,
} from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

import type { Citizen } from '../entities/Citizen.js';
import { isOutside, isWalking } from '../entities/Citizen.js';
import type { World } from '../simulation/World.js';

/**
 * Body proportions, in metres. A little small in the body and a little large
 * in the head, as a figure from a model set is, but nowhere near chibi
 * (DESIGN.md §5).
 */
const LEG_LENGTH = 0.62;
const LEG_RADIUS = 0.1;
const HIP_HEIGHT = LEG_LENGTH + 0.02;
const TORSO_HEIGHT = 0.6;
const TORSO_WIDTH = 0.46;
const TORSO_DEPTH = 0.28;
const SHOULDER_HEIGHT = HIP_HEIGHT + TORSO_HEIGHT - 0.06;
const ARM_LENGTH = 0.5;
const ARM_RADIUS = 0.075;
const HEAD_RADIUS = 0.24;
const NECK = 0.04;
const HEAD_CENTRE_Y = HIP_HEIGHT + TORSO_HEIGHT + NECK + HEAD_RADIUS;

/** The walk: how far the legs swing, and how many radians of cycle per metre. */
const STRIDE_RADIANS_PER_METRE = 3.4;
const LEG_SWING = 0.55;
const ARM_SWING = 0.4;
const BOB_HEIGHT = 0.035;

/** How quickly the drawn position catches up with the simulated one. */
const FOLLOW_SECONDS = 0.12;

const SKIN_COLORS = [0xe9c2a0, 0xd5a27a, 0xf0d2b4, 0xa4704f, 0xc48b66];
const HAIR_COLORS = [0x4a3627, 0x2b2320, 0xb58a5a, 0x8a6a4c, 0xd8c4a5, 0x5d5a58];
const TROUSER_COLORS = [0x5c6572, 0x8b7d6b, 0x3f4a5c, 0x6f6a5f, 0x7c8a9a];

interface CitizenModel {
  citizen: Citizen;
  group: Group;
  leftLeg: Object3D;
  rightLeg: Object3D;
  leftArm: Object3D;
  rightArm: Object3D;
  /** Drawn position, eased towards the simulated one so 1x looks smooth. */
  x: number;
  z: number;
  heading: number;
}

/**
 * The miniature people: head, hair, torso, two arms and two legs, each a
 * part that can move, so a walk is a walk and not a slide (DESIGN.md §5–6).
 *
 * The simulation moves in fixed ticks, which at 1x is ten updates a second, so
 * the drawn position eases towards the simulated one instead of snapping to it
 * (SPEC.md 3.2: the renderer interpolates between ticks).
 */
export class CitizenView {
  readonly root = new Group();

  private readonly models: CitizenModel[] = [];

  constructor(world: World) {
    this.root.name = 'citizens';

    world.citizens.forEach((citizen, index) => {
      const model = buildFigure(citizen, index);
      this.root.add(model.group);
      this.models.push(model);
    });
  }

  update(deltaSeconds: number): void {
    const ease = 1 - Math.exp(-deltaSeconds / FOLLOW_SECONDS);

    for (const model of this.models) {
      const { citizen, group } = model;
      const outside = isOutside(citizen);
      group.visible = outside;
      if (!outside) {
        // Snap while hidden, so reappearing at the door does not slide.
        model.x = citizen.position.x;
        model.z = citizen.position.z;
        continue;
      }

      model.x += (citizen.position.x - model.x) * ease;
      model.z += (citizen.position.z - model.z) * ease;
      model.heading = easeAngle(model.heading, citizen.heading, ease);

      const walking = isWalking(citizen);
      const phase = walking ? citizen.distanceWalked * STRIDE_RADIANS_PER_METRE : 0;
      const swing = Math.sin(phase);

      model.leftLeg.rotation.x = swing * LEG_SWING;
      model.rightLeg.rotation.x = -swing * LEG_SWING;
      model.leftArm.rotation.x = -swing * ARM_SWING;
      model.rightArm.rotation.x = swing * ARM_SWING;

      // The body rises as the legs pass each other, twice per cycle.
      const bob = walking ? Math.abs(Math.cos(phase)) * BOB_HEIGHT : 0;
      group.position.set(model.x, bob, model.z);
      group.rotation.y = model.heading;
    }
  }

  /** The drawn object for a citizen, used by camera follow in Phase 6. */
  objectFor(citizenId: string): Object3D | undefined {
    return this.models.find((model) => model.citizen.id === citizenId)?.group;
  }
}

/** One figure, standing at the origin of its group and facing +Z. */
function buildFigure(citizen: Citizen, index: number): CitizenModel {
  const group = new Group();
  group.name = citizen.id;

  const skin = matte(SKIN_COLORS[index % SKIN_COLORS.length]);
  const shirt = matte(citizen.shirtColor);
  const trousers = matte(TROUSER_COLORS[index % TROUSER_COLORS.length]);
  const hair = matte(HAIR_COLORS[(index * 5) % HAIR_COLORS.length]);

  const leftLeg = limb(LEG_LENGTH, LEG_RADIUS, trousers);
  leftLeg.position.set(-0.12, HIP_HEIGHT, 0);
  group.add(leftLeg);

  const rightLeg = limb(LEG_LENGTH, LEG_RADIUS, trousers);
  rightLeg.position.set(0.12, HIP_HEIGHT, 0);
  group.add(rightLeg);

  const torso = new Mesh(
    new RoundedBoxGeometry(TORSO_WIDTH, TORSO_HEIGHT, TORSO_DEPTH, 3, 0.1),
    shirt,
  );
  torso.position.y = HIP_HEIGHT + TORSO_HEIGHT / 2;
  torso.castShadow = true;
  group.add(torso);

  const leftArm = limb(ARM_LENGTH, ARM_RADIUS, shirt);
  leftArm.position.set(-(TORSO_WIDTH / 2 + ARM_RADIUS + 0.02), SHOULDER_HEIGHT, 0);
  group.add(leftArm);

  const rightArm = limb(ARM_LENGTH, ARM_RADIUS, shirt);
  rightArm.position.set(TORSO_WIDTH / 2 + ARM_RADIUS + 0.02, SHOULDER_HEIGHT, 0);
  group.add(rightArm);

  const head = new Mesh(new SphereGeometry(HEAD_RADIUS, 16, 12), skin);
  head.position.y = HEAD_CENTRE_Y;
  head.castShadow = true;
  group.add(head);

  // A cap of hair: the top of a slightly larger sphere, with a different cut
  // per person so silhouettes differ from above.
  const cut = 0.5 + ((index * 3) % 4) * 0.08;
  const hairCap = new Mesh(
    new SphereGeometry(HEAD_RADIUS + 0.03, 16, 10, 0, Math.PI * 2, 0, Math.PI * cut),
    hair,
  );
  hairCap.position.y = HEAD_CENTRE_Y + 0.01;
  hairCap.rotation.y = Math.PI;
  group.add(hairCap);

  return {
    citizen,
    group,
    leftLeg,
    rightLeg,
    leftArm,
    rightArm,
    x: citizen.position.x,
    z: citizen.position.z,
    heading: citizen.heading,
  };
}

/**
 * A limb hanging from a pivot: the pivot sits at the joint and the capsule
 * hangs below it, so rotating the pivot swings the limb.
 */
function limb(length: number, radius: number, material: MeshStandardMaterial): Object3D {
  const pivot = new Object3D();
  const mesh = new Mesh(new CapsuleGeometry(radius, length - radius * 2, 4, 8), material);
  mesh.position.y = -length / 2;
  mesh.castShadow = true;
  pivot.add(mesh);
  return pivot;
}

function matte(color: number): MeshStandardMaterial {
  return new MeshStandardMaterial({ color: new Color(color), roughness: 0.95, metalness: 0 });
}

/** Eases an angle the short way round the circle. */
function easeAngle(from: number, to: number, ease: number): number {
  let difference = ((to - from + Math.PI) % (Math.PI * 2)) - Math.PI;
  if (difference < -Math.PI) {
    difference += Math.PI * 2;
  }
  return from + difference * ease;
}

import {
  CapsuleGeometry,
  Color,
  Group,
  Mesh,
  MeshStandardMaterial,
  SphereGeometry,
  type Object3D,
} from 'three';

import type { Citizen } from '../entities/Citizen.js';
import { isOutside, isWalking } from '../entities/Citizen.js';
import type { World } from '../simulation/World.js';

/** Body proportions, in metres, against a house wall about five metres high. */
const BODY_RADIUS = 0.3;
const BODY_LENGTH = 0.72;
const HEAD_RADIUS = 0.26;
const BODY_CENTRE_Y = BODY_RADIUS + BODY_LENGTH / 2;
const HEAD_CENTRE_Y = BODY_CENTRE_Y + BODY_LENGTH / 2 + HEAD_RADIUS * 0.72;

/** Bounce of the walking step: how often, and how far. */
const BOB_FREQUENCY = 2.6;
const BOB_HEIGHT = 0.07;

/** How quickly the drawn position catches up with the simulated one. */
const FOLLOW_SECONDS = 0.12;

const SKIN_COLORS = [0xe8b98f, 0xc98b62, 0xf0cba6, 0x8d5a3b, 0xd9a075];

interface CitizenModel {
  citizen: Citizen;
  group: Group;
  /** Drawn position, eased towards the simulated one so 1x looks smooth. */
  x: number;
  z: number;
  heading: number;
}

/**
 * The capsule people.
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
      const group = new Group();
      group.name = citizen.id;

      const body = new Mesh(
        new CapsuleGeometry(BODY_RADIUS, BODY_LENGTH, 4, 10),
        new MeshStandardMaterial({ color: new Color(citizen.shirtColor), roughness: 0.75 }),
      );
      body.position.y = BODY_CENTRE_Y;
      body.castShadow = true;
      group.add(body);

      const head = new Mesh(
        new SphereGeometry(HEAD_RADIUS, 12, 10),
        new MeshStandardMaterial({
          color: new Color(SKIN_COLORS[index % SKIN_COLORS.length]),
          roughness: 0.8,
        }),
      );
      head.position.y = HEAD_CENTRE_Y;
      head.castShadow = true;
      group.add(head);

      this.root.add(group);
      this.models.push({
        citizen,
        group,
        x: citizen.position.x,
        z: citizen.position.z,
        heading: citizen.heading,
      });
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

      const stride = isWalking(citizen) ? citizen.distanceWalked * BOB_FREQUENCY : 0;
      const bob = Math.abs(Math.sin(stride)) * BOB_HEIGHT;
      group.position.set(model.x, bob, model.z);
      group.rotation.y = model.heading;
      // A slight lean into the step, in time with the bounce.
      group.rotation.z = Math.sin(stride) * 0.045;
    }
  }

  /** The drawn object for a citizen, used by camera follow in Phase 6. */
  objectFor(citizenId: string): Object3D | undefined {
    return this.models.find((model) => model.citizen.id === citizenId)?.group;
  }
}

/** Eases an angle the short way round the circle. */
function easeAngle(from: number, to: number, ease: number): number {
  let difference = ((to - from + Math.PI) % (Math.PI * 2)) - Math.PI;
  if (difference < -Math.PI) {
    difference += Math.PI * 2;
  }
  return from + difference * ease;
}

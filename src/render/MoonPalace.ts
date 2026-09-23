import {
  AdditiveBlending,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CatmullRomCurve3,
  Color,
  DoubleSide,
  Group,
  LatheGeometry,
  Mesh,
  MeshBasicMaterial,
  SphereGeometry,
  Sprite,
  SpriteMaterial,
  TorusGeometry,
  Vector2,
  Vector3,
  ConeGeometry,
  type Material,
} from 'three';

import { Rng } from '../simulation/Rng.js';

import { SKY_RADIUS } from './Environment.js';
import { glowTexture } from './glow.js';
import { cylinderBetween, hipRoof, merge, paint, selfLitMaterial } from './shapes.js';

/**
 * The Moon Palace, Guanghan Gong (SPEC.md 2.15, decision 39): a palace of
 * white jade, red pillars and green glazed roofs on a cloud, standing in
 * front of the full moon on Mid-Autumn night, with an osmanthus tree beside
 * it. Chang'e stands on the cloud before its stairs with the Jade Rabbit in
 * her arms and her ribbon streaming. From the town she is a speck; a tap on
 * the palace flies the camera in to her (App.visitPalace).
 *
 * The moon is a direction on the sky dome, infinitely far away, and the
 * palace is not, so no single place keeps the two in line from every
 * camera. Instead the palace stays put and the moon's disc is drawn behind
 * it from wherever the camera is (`moonDiscDirection`).
 *
 * Built in its own frame: the cloud top at y = 0, the front facing +Z, one
 * unit a metre. Render side only, on real time.
 */

/** Where the palace stands: this far out from the town along the moon's direction. */
export const PALACE_DISTANCE = 820;

/** Where Chang'e stands in the palace's frame, and the height of her chest. */
const CHANGE_AT = new Vector3(-3, 0.2, 21);
const CHANGE_CHEST = 3;
/** Chang'e is drawn this much larger than life, like the rest of the miniature. */
const CHANGE_SCALE = 1.25;

/** How far the palace reaches around its centre, for picking. */
const PALACE_RADIUS = 36;

const JADE = 0xe8efe9;
const JADE_SHADE = 0xc9d6d0;
const PILLAR_RED = 0xb8322a;
const ROOF_GREEN = 0x2f8f86;
const RIDGE_GOLD = 0xe2b64a;
const WINDOW_WARM = 0xffcf7a;
const WALL = 0xf3e9d6;
const LANTERN_RED = 0xe8402a;

export class MoonPalace {
  readonly root = new Group();

  private readonly rng = new Rng('moon-palace');
  private readonly figure = new Group();
  private readonly ribbon: Mesh<BufferGeometry, Material>;
  private readonly ribbonBase: Vector3[];
  private readonly ears: Mesh[] = [];
  private readonly glows: Sprite[] = [];
  private readonly materials: Material[] = [];
  private readonly base = new Vector3();
  private time = 0;

  constructor() {
    this.root.name = 'moon-palace';
    this.root.visible = false;

    const solid = selfLitMaterial(0.45);
    solid.side = DoubleSide;
    const cloud = selfLitMaterial(0.5);
    const bright = new MeshBasicMaterial({ vertexColors: true, fog: false, toneMapped: false });
    this.materials.push(solid, cloud, bright);

    this.root.add(new Mesh(cloudGeometry(this.rng), cloud));
    this.root.add(new Mesh(palaceGeometry(), solid));
    this.root.add(new Mesh(lampGeometry(), bright));
    this.root.add(new Mesh(osmanthusGeometry(this.rng), solid));
    this.root.add(new Mesh(blossomGeometry(this.rng), bright));

    for (const at of lanternPlaces()) {
      const glow = new Sprite(
        new SpriteMaterial({
          map: glowTexture(),
          color: new Color(0xff8a4a),
          blending: AdditiveBlending,
          transparent: true,
          depthWrite: false,
          fog: false,
          opacity: 0.8,
        }),
      );
      glow.position.copy(at);
      glow.scale.setScalar(4.5);
      this.glows.push(glow);
      this.materials.push(glow.material);
      this.root.add(glow);
    }

    // Chang'e and the Jade Rabbit.
    const skin = selfLitMaterial(0.42);
    this.materials.push(skin);
    this.figure.add(new Mesh(changeGeometry(), skin));
    const rabbit = rabbitGeometry();
    this.figure.add(new Mesh(rabbit.body, skin));
    for (const ear of rabbit.ears) {
      const mesh = new Mesh(ear.geometry, skin);
      mesh.position.copy(ear.root);
      this.ears.push(mesh);
      this.figure.add(mesh);
    }
    const ribbonMaterial = selfLitMaterial(0.6);
    ribbonMaterial.side = DoubleSide;
    this.materials.push(ribbonMaterial);
    this.ribbonBase = ribbonPath();
    this.ribbon = new Mesh(ribbonGeometry(this.ribbonBase.length), ribbonMaterial);
    this.ribbon.frustumCulled = false;
    this.figure.add(this.ribbon);
    this.figure.position.copy(CHANGE_AT);
    this.figure.scale.setScalar(CHANGE_SCALE);
    this.figure.rotation.y = 0.18;
    this.root.add(this.figure);

    this.root.traverse((node) => {
      node.frustumCulled = false;
    });
  }

  /** Puts the palace out along `direction` from `town`, its front turned to the town. */
  place(town: Vector3, direction: Vector3): void {
    this.base.copy(town).addScaledVector(direction.clone().normalize(), PALACE_DISTANCE);
    // Sit the palace a little below the middle of the moon.
    this.base.y -= 14;
    this.root.position.copy(this.base);
    this.root.rotation.set(0, Math.atan2(town.x - this.base.x, town.z - this.base.z), 0);
    this.root.updateMatrixWorld(true);
  }

  setVisible(on: boolean): void {
    this.root.visible = on;
  }

  get centre(): Vector3 {
    return this.root.position.clone().add(new Vector3(0, 10, 0));
  }

  get radius(): number {
    return PALACE_RADIUS;
  }

  /** Chang'e's chest in the world, for the camera to look at. */
  get changeFocus(): Vector3 {
    return this.figure.localToWorld(new Vector3(0, CHANGE_CHEST / CHANGE_SCALE, 0.3));
  }

  /** A good place to see Chang'e from: in front of her, a little above, facing her. */
  changeViewpoint(): Vector3 {
    const front = new Vector3(Math.sin(this.root.rotation.y), 0, Math.cos(this.root.rotation.y));
    return this.changeFocus.addScaledVector(front, 16).add(new Vector3(0, 2.2, 0));
  }

  /**
   * Which way to draw the moon's disc so that it sits behind the palace as
   * seen from `eye`. The sky dome is centred on the town, not the camera,
   * so the disc goes where the line from the eye through the palace meets
   * the dome. Close in, the line runs instead to a fixed point on the dome
   * behind the palace, so the moon holds still while the viewer circles
   * Chang'e.
   */
  moonDiscDirection(eye: Vector3, out: Vector3): Vector3 {
    const heart = this.root.position.clone().add(new Vector3(0, 16, 0));
    const behind = heart.clone().normalize().multiplyScalar(SKY_RADIUS);
    const t = Math.min(1, Math.max(0, (eye.distanceTo(heart) - 120) / 300));
    const aim = behind.lerp(heart, t);
    // Where the line from the eye through the aim point leaves the dome.
    const along = aim.sub(eye).normalize();
    const b = eye.dot(along);
    const c = eye.lengthSq() - SKY_RADIUS * SKY_RADIUS;
    const reach = -b + Math.sqrt(Math.max(0, b * b - c));
    return out.copy(eye).addScaledVector(along, reach).normalize();
  }

  update(deltaSeconds: number): void {
    if (!this.root.visible) {
      return;
    }
    this.time += deltaSeconds;
    const t = this.time;
    // The whole cloud rides a slow swell.
    this.root.position.copy(this.base);
    this.root.position.y += Math.sin(t * 0.4) * 1.2;

    this.glows.forEach((glow, index) => {
      glow.material.opacity = 0.65 + 0.2 * Math.sin(t * 1.6 + index * 1.7);
    });
    // The rabbit's ears twitch now and then.
    const twitch = Math.max(0, Math.sin(t * 0.9)) ** 12;
    this.ears.forEach((ear, index) => {
      ear.rotation.x = -0.25 - 0.35 * twitch * (index === 0 ? 1 : 0.7);
      ear.rotation.z = (index === 0 ? 0.18 : -0.18) + 0.05 * Math.sin(t * 2 + index);
    });
    this.flutter(t);
  }

  /** The ribbon streams: still where it lies on her arms, free at both ends. */
  private flutter(t: number): void {
    const count = this.ribbonBase.length;
    const geometry = this.ribbon.geometry;
    const position = geometry.getAttribute('position') as BufferAttribute;
    const point = new Vector3();
    const next = new Vector3();
    const side = new Vector3();
    const up = new Vector3(0, 1, 0);
    const width = 0.2;
    const bent: Vector3[] = [];
    for (let index = 0; index < count; index += 1) {
      const u = index / (count - 1);
      // Free ends: the ends of the strip, far from the arms.
      const free = Math.pow(Math.abs(u - 0.5) * 2, 1.6);
      const wave = Math.sin(t * 2.2 - u * 14) * free;
      const lift = Math.cos(t * 1.7 - u * 11) * free;
      bent.push(
        this.ribbonBase[index]
          .clone()
          .add(new Vector3(wave * 0.35, lift * 0.45, -Math.abs(wave) * 0.4)),
      );
    }
    for (let index = 0; index < count; index += 1) {
      point.copy(bent[index]);
      next.copy(bent[Math.min(count - 1, index + 1)]).sub(bent[Math.max(0, index - 1)]);
      side.crossVectors(next, up).normalize();
      if (side.lengthSq() < 0.5) {
        side.set(1, 0, 0);
      }
      // The strip turns flat to the wind as it goes.
      const twist = Math.sin(index * 0.35 + t * 1.3) * 0.6;
      const across = side.clone().applyAxisAngle(next.normalize(), twist).multiplyScalar(width);
      position.setXYZ(index * 2, point.x - across.x, point.y - across.y, point.z - across.z);
      position.setXYZ(index * 2 + 1, point.x + across.x, point.y + across.y, point.z + across.z);
    }
    position.needsUpdate = true;
    geometry.computeVertexNormals();
  }

  dispose(): void {
    this.root.traverse((node) => {
      if (node instanceof Mesh) {
        node.geometry.dispose();
      }
    });
    for (const material of this.materials) {
      material.dispose();
    }
  }
}

// --- The palace ---------------------------------------------------------------

/** A billowing cloud of flattened spheres, lighter on top. */
function cloudGeometry(rng: Rng): BufferGeometry {
  const parts: BufferGeometry[] = [];
  const puff = (x: number, y: number, z: number, r: number, color: number): void => {
    const geometry = new SphereGeometry(r, 16, 10);
    geometry.scale(1, 0.55, 1);
    geometry.translate(x, y, z);
    parts.push(paint(geometry, color));
  };
  for (let index = 0; index < 34; index += 1) {
    const angle = rng.next() * Math.PI * 2;
    const reach = Math.sqrt(rng.next());
    const x = Math.cos(angle) * reach * 34;
    const z = Math.sin(angle) * reach * 22 + 2;
    const r = rng.nextFloat(6, 11) * (1 - 0.3 * reach);
    puff(x, rng.nextFloat(-6, -2.5), z, r, reach > 0.6 ? 0xdfe6f4 : 0xf4f6fb);
  }
  // Wisps trailing off to the sides and a round terrace in front for Chang'e.
  for (const side of [-1, 1]) {
    for (let index = 0; index < 5; index += 1) {
      puff(side * (38 + index * 6), -4 - index * 1.2, 4 - index * 2, 5 - index * 0.6, 0xd6deef);
    }
  }
  puff(CHANGE_AT.x, -2.9, CHANGE_AT.z, 5.5, 0xf8f9fd);
  puff(CHANGE_AT.x + 4, -3.4, CHANGE_AT.z - 3, 4.5, 0xeef1f9);
  return merge(parts);
}

function box(
  width: number,
  height: number,
  depth: number,
  x: number,
  y: number,
  z: number,
  color: number,
): BufferGeometry {
  const geometry = new BoxGeometry(width, height, depth);
  geometry.translate(x, y + height / 2, z);
  return paint(geometry, color);
}

/** The white jade terraces, the halls, their pillars and their roofs. */
function palaceGeometry(): BufferGeometry {
  const parts: BufferGeometry[] = [];

  // Three terraces of white jade, with a stair up the front.
  const tiers = [
    { w: 58, d: 32, y: 0 },
    { w: 50, d: 26, y: 1.6 },
    { w: 34, d: 20, y: 3.2 },
  ];
  for (const tier of tiers) {
    parts.push(box(tier.w, 1.6, tier.d, 0, tier.y, 0, tier.y === 1.6 ? JADE_SHADE : JADE));
    // A balustrade of posts along the front and the sides.
    const top = tier.y + 1.6;
    for (let x = -tier.w / 2 + 1; x <= tier.w / 2 - 1; x += 2.4) {
      if (Math.abs(x) < 4) {
        continue;
      }
      parts.push(box(0.3, 0.9, 0.3, x, top, tier.d / 2 - 0.3, JADE));
    }
    parts.push(
      box(tier.w / 2 - 4, 0.15, 0.2, -(tier.w / 4 + 2), top + 0.75, tier.d / 2 - 0.3, JADE),
    );
    parts.push(box(tier.w / 2 - 4, 0.15, 0.2, tier.w / 4 + 2, top + 0.75, tier.d / 2 - 0.3, JADE));
  }
  for (let step = 0; step < 6; step += 1) {
    parts.push(box(7, 0.8, 1.2, 0, step * 0.8, tiers[0].d / 2 + 4.2 - step * 1.1, JADE));
  }

  // The main hall: a ring of red pillars, warm lit walls, two roofs.
  const floor = 4.8;
  const pillarHeight = 7;
  for (const z of [-5.5, 5.5]) {
    for (let x = -12; x <= 12; x += 3.43) {
      parts.push(
        cylinderBetween(
          new Vector3(x, floor, z),
          new Vector3(x, floor + pillarHeight, z),
          0.42,
          0.38,
          PILLAR_RED,
        ),
      );
    }
  }
  parts.push(box(23, 6.6, 9.6, 0, floor, 0, WALL));
  for (let x = -10.3; x <= 10.4; x += 3.43) {
    parts.push(box(2.3, 4.2, 0.2, x, floor + 1.2, 4.85, WINDOW_WARM));
  }
  // A beam round the top of the pillars, and a gold plaque over the door.
  parts.push(box(27, 0.8, 12.5, 0, floor + pillarHeight - 0.2, 0, PILLAR_RED));
  parts.push(box(3.4, 1.4, 0.3, 0, floor + pillarHeight - 1.8, 5.9, RIDGE_GOLD));

  const lowerEave = floor + pillarHeight + 0.6;
  parts.push(translated(hipRoof(31, 18, 3.4, 1.6, ROOF_GREEN), 0, lowerEave, 0));
  // The upper storey, and the top roof with its gold ridge and ridge beasts.
  const upper = lowerEave + 1.8;
  parts.push(box(15, 4.4, 7.4, 0, upper, 0, WALL));
  for (let x = -6; x <= 6; x += 3) {
    parts.push(box(1.9, 2.6, 0.2, x, upper + 0.9, 3.75, WINDOW_WARM));
  }
  for (const x of [-7.2, 7.2]) {
    for (const z of [-3.6, 3.6]) {
      parts.push(
        cylinderBetween(
          new Vector3(x, upper, z),
          new Vector3(x, upper + 4.4, z),
          0.3,
          0.28,
          PILLAR_RED,
        ),
      );
    }
  }
  const topEave = upper + 4.6;
  parts.push(translated(hipRoof(22, 12, 5.2, 1.4, ROOF_GREEN), 0, topEave, 0));
  parts.push(box(10.2, 0.5, 0.6, 0, topEave + 5.0, 0, RIDGE_GOLD));
  for (const x of [-5.4, 5.4]) {
    parts.push(box(0.7, 1.6, 0.7, x, topEave + 5.0, 0, RIDGE_GOLD));
  }
  // A gold pearl on the ridge.
  parts.push(translated(paint(new SphereGeometry(0.7, 12, 8), RIDGE_GOLD), 0, topEave + 6.1, 0));

  // Two pavilions on the second terrace, joined to the hall by galleries.
  for (const side of [-1, 1]) {
    const x = side * 20.5;
    const z = -2;
    const base = 3.2;
    for (const dx of [-3, 3]) {
      for (const dz of [-3, 3]) {
        parts.push(
          cylinderBetween(
            new Vector3(x + dx, base, z + dz),
            new Vector3(x + dx, base + 5.6, z + dz),
            0.3,
            0.28,
            PILLAR_RED,
          ),
        );
      }
    }
    parts.push(box(5, 3.6, 5, x, base, z, WALL));
    parts.push(box(3.2, 2.4, 0.2, x, base + 0.8, z + 2.55, WINDOW_WARM));
    parts.push(box(7.6, 0.5, 7.6, x, base + 5.5, z, PILLAR_RED));
    parts.push(translated(hipRoof(10, 10, 4.6, 1.3, ROOF_GREEN), x, base + 6, z));
    parts.push(translated(paint(new ConeGeometry(0.5, 1.8, 8), RIDGE_GOLD), x, base + 11.4, z));
    // The gallery: a low roof on posts from the pavilion to the hall.
    const from = side * 12.5;
    const to = side * 17.5;
    const mid = (from + to) / 2;
    for (const px of [from, to]) {
      for (const pz of [-3.4, -0.6]) {
        parts.push(
          cylinderBetween(
            new Vector3(px, base, pz),
            new Vector3(px, base + 3.4, pz),
            0.22,
            0.2,
            PILLAR_RED,
          ),
        );
      }
    }
    parts.push(translated(hipRoof(6.4, 4.2, 1.4, 0.4, ROOF_GREEN), mid, base + 3.4, -2));
  }
  return merge(parts);
}

function translated(geometry: BufferGeometry, x: number, y: number, z: number): BufferGeometry {
  geometry.translate(x, y, z);
  return geometry;
}

/** Where the palace's lanterns hang: the eave corners and either side of the stair. */
function lanternPlaces(): Vector3[] {
  const places: Vector3[] = [];
  const eave = 4.8 + 7 + 0.6;
  for (const x of [-14.8, 14.8]) {
    for (const z of [-8.3, 8.3]) {
      places.push(new Vector3(x, eave - 0.6, z));
    }
  }
  for (const x of [-4.5, 4.5]) {
    places.push(new Vector3(x, 4.8 + 3.2, 8.8));
  }
  for (const side of [-1, 1]) {
    places.push(new Vector3(side * 20.5 + side * 4.6, 3.2 + 5.2, 2.6));
  }
  for (const x of [-4.4, 4.4]) {
    places.push(new Vector3(x, 1.4, 19));
  }
  return places;
}

/** The lanterns themselves, bright red, and the lit tassels. */
function lampGeometry(): BufferGeometry {
  const parts: BufferGeometry[] = [];
  for (const at of lanternPlaces()) {
    const body = new SphereGeometry(0.55, 12, 10);
    body.scale(1, 1.2, 1);
    body.translate(at.x, at.y, at.z);
    parts.push(paint(body, LANTERN_RED));
    parts.push(box(0.5, 0.15, 0.5, at.x, at.y + 0.62, at.z, RIDGE_GOLD));
    parts.push(box(0.08, 0.5, 0.08, at.x, at.y - 1.15, at.z, RIDGE_GOLD));
  }
  return merge(parts);
}

/** The osmanthus tree: a crooked trunk and a round dark crown. */
function osmanthusGeometry(rng: Rng): BufferGeometry {
  const parts: BufferGeometry[] = [];
  const foot = new Vector3(16, 3.2, 9);
  const knee = foot.clone().add(new Vector3(-0.8, 3.2, 0.4));
  const top = knee.clone().add(new Vector3(0.9, 3, -0.3));
  parts.push(cylinderBetween(foot, knee, 0.75, 0.55, 0x6b4a34));
  parts.push(cylinderBetween(knee, top, 0.55, 0.35, 0x6b4a34));
  for (let index = 0; index < 14; index += 1) {
    const angle = rng.next() * Math.PI * 2;
    const reach = rng.nextFloat(0.5, 3.4);
    const leaf = new SphereGeometry(rng.nextFloat(1.8, 2.6), 12, 8);
    leaf.translate(
      top.x + Math.cos(angle) * reach,
      top.y + rng.nextFloat(-1, 2.2),
      top.z + Math.sin(angle) * reach,
    );
    parts.push(paint(leaf, index % 3 === 0 ? 0x3e6b45 : 0x2f5a3a));
  }
  return merge(parts);
}

/** Gold blossoms scattered over the crown, lit. */
function blossomGeometry(rng: Rng): BufferGeometry {
  const parts: BufferGeometry[] = [];
  const crown = new Vector3(16.1, 9.4, 9.1);
  for (let index = 0; index < 70; index += 1) {
    const direction = new Vector3(
      rng.nextFloat(-1, 1),
      rng.nextFloat(-0.4, 1),
      rng.nextFloat(-1, 1),
    ).normalize();
    const at = crown.clone().addScaledVector(direction, rng.nextFloat(3.4, 4.6));
    const bloom = new SphereGeometry(0.16, 6, 4);
    bloom.translate(at.x, at.y + 0.6, at.z);
    parts.push(paint(bloom, 0xffd060));
  }
  return merge(parts);
}

// --- Chang'e and the Jade Rabbit ------------------------------------------

const SKIN = 0xf6dcc8;
const HAIR = 0x1c1a22;
const ROBE_WHITE = 0xfbf3f4;
const ROBE_PINK = 0xf2b3c6;
const BODICE = 0xc9dcf2;
const SASH = 0xd8434f;

function lathe(profile: Array<[number, number]>, color: number, segments = 20): BufferGeometry {
  const geometry = new LatheGeometry(
    profile.map(([radius, y]) => new Vector2(radius, y)),
    segments,
  );
  return paint(geometry, color);
}

/** Chang'e: a long flared robe, a fitted bodice, arms round the rabbit, a high bun. */
function changeGeometry(): BufferGeometry {
  const parts: BufferGeometry[] = [];
  // The skirt pools on the cloud and trails a little behind.
  const skirt = lathe(
    [
      [0.02, 0],
      [1.25, 0],
      [1.05, 0.35],
      [0.78, 1.2],
      [0.55, 2.0],
      [0.42, 2.38],
    ],
    ROBE_WHITE,
    28,
  );
  skirt.scale(1, 1, 1.15);
  skirt.translate(0, 0, -0.12);
  parts.push(skirt);
  const overskirt = lathe(
    [
      [0.92, 0.7],
      [0.7, 1.4],
      [0.52, 2.05],
      [0.45, 2.32],
    ],
    ROBE_PINK,
    28,
  );
  parts.push(overskirt);
  const sash = new TorusGeometry(0.44, 0.07, 6, 24);
  sash.rotateX(Math.PI / 2);
  parts.push(translated(paint(sash, SASH), 0, 2.36, 0));
  parts.push(box(0.16, 1.2, 0.05, 0.08, 1.2, 0.46, SASH));
  // Bodice and shoulders.
  parts.push(
    lathe(
      [
        [0.43, 2.3],
        [0.47, 2.7],
        [0.45, 3.0],
        [0.3, 3.22],
        [0.12, 3.3],
      ],
      BODICE,
    ),
  );
  // Neck and head, with a face just readable up close.
  parts.push(cylinderBetween(new Vector3(0, 3.25, 0), new Vector3(0, 3.45, 0), 0.09, 0.08, SKIN));
  const head = new SphereGeometry(0.3, 20, 16);
  head.scale(0.92, 1.05, 0.95);
  parts.push(translated(paint(head, SKIN), 0, 3.66, 0.02));
  for (const x of [-0.1, 0.1]) {
    const eye = new SphereGeometry(0.035, 8, 6);
    eye.scale(1.4, 0.7, 0.6);
    parts.push(translated(paint(eye, HAIR), x, 3.69, 0.3));
  }
  const lips = new SphereGeometry(0.04, 8, 6);
  lips.scale(1.4, 0.6, 0.6);
  parts.push(translated(paint(lips, 0xd4485a), 0, 3.52, 0.28));
  // Hair: a cap, a fall down the back, and a double loop bun on top.
  const cap = new SphereGeometry(0.33, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.62);
  cap.rotateX(-0.9);
  parts.push(translated(paint(cap, HAIR), 0, 3.68, -0.06));
  const fall = new SphereGeometry(0.3, 12, 10);
  fall.scale(0.9, 2.2, 0.5);
  parts.push(translated(paint(fall, HAIR), 0, 3.15, -0.24));
  for (const x of [-0.16, 0.16]) {
    const loop = new TorusGeometry(0.16, 0.06, 8, 18);
    loop.rotateY(Math.PI / 2 + (x < 0 ? 0.3 : -0.3));
    parts.push(translated(paint(loop, HAIR), x, 4.12, -0.05));
  }
  parts.push(box(0.6, 0.04, 0.04, 0, 4.0, 0.02, RIDGE_GOLD));
  for (const x of [-0.3, 0.3]) {
    parts.push(translated(paint(new SphereGeometry(0.06, 8, 6), RIDGE_GOLD), x, 4.0, 0.02));
  }
  // Arms curled round the rabbit, and wide sleeves falling from them.
  for (const side of [-1, 1]) {
    const shoulder = new Vector3(side * 0.42, 3.12, 0);
    const elbow = new Vector3(side * 0.5, 2.62, 0.3);
    const hand = new Vector3(side * 0.14, 2.82, 0.62);
    parts.push(cylinderBetween(shoulder, elbow, 0.12, 0.1, BODICE));
    parts.push(cylinderBetween(elbow, hand, 0.1, 0.07, BODICE));
    parts.push(translated(paint(new SphereGeometry(0.075, 8, 6), SKIN), hand.x, hand.y, hand.z));
    const sleeve = new ConeGeometry(0.34, 1.5, 14, 1, true);
    sleeve.translate(0, -0.75, 0);
    sleeve.rotateZ(side * 0.12);
    parts.push(translated(paint(sleeve, ROBE_WHITE), elbow.x + side * 0.05, elbow.y + 0.05, 0.36));
  }
  return merge(parts);
}

/** The Jade Rabbit, white with red eyes, held against her chest. */
function rabbitGeometry(): {
  body: BufferGeometry;
  ears: Array<{ geometry: BufferGeometry; root: Vector3 }>;
} {
  const parts: BufferGeometry[] = [];
  const body = new SphereGeometry(0.28, 16, 12);
  body.scale(1, 0.9, 1.15);
  parts.push(translated(paint(body, 0xffffff), 0, 2.86, 0.62));
  const head = new SphereGeometry(0.17, 16, 12);
  parts.push(translated(paint(head, 0xffffff), 0.03, 3.1, 0.8));
  for (const x of [-0.07, 0.11]) {
    parts.push(translated(paint(new SphereGeometry(0.03, 8, 6), 0xd02030), x, 3.14, 0.94));
  }
  parts.push(translated(paint(new SphereGeometry(0.03, 8, 6), 0xf3a0b0), 0.03, 3.07, 0.97));
  parts.push(translated(paint(new SphereGeometry(0.09, 10, 8), 0xffffff), 0, 2.72, 0.35));
  const ears = [-0.05, 0.1].map((x) => {
    const ear = new SphereGeometry(0.055, 10, 8);
    ear.scale(0.8, 3.2, 0.45);
    ear.translate(0, 0.16, 0);
    return { geometry: paint(ear, 0xfff4f6), root: new Vector3(x, 3.22, 0.76) };
  });
  return { body: merge(parts), ears };
}

/** The ribbon's resting line: from behind her left, over both arms, away to the right. */
function ribbonPath(): Vector3[] {
  const curve = new CatmullRomCurve3([
    new Vector3(-1.9, 0.9, -1.4),
    new Vector3(-1.3, 1.9, -0.6),
    new Vector3(-0.62, 2.62, 0.35),
    new Vector3(-0.4, 3.1, -0.3),
    new Vector3(0, 3.25, -0.42),
    new Vector3(0.4, 3.1, -0.3),
    new Vector3(0.62, 2.62, 0.35),
    new Vector3(1.4, 2.2, -0.5),
    new Vector3(2.3, 1.6, -1.6),
  ]);
  return curve.getPoints(59);
}

/** A strip of two vertices per point along the ribbon, filled in by the flutter. */
function ribbonGeometry(points: number): BufferGeometry {
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(points * 2 * 3), 3));
  const colors = new Float32Array(points * 2 * 3);
  const shade = new Color(0xef7f9c);
  const tip = new Color(0xf8c9d6);
  for (let index = 0; index < points; index += 1) {
    const u = index / (points - 1);
    const color = shade.clone().lerp(tip, Math.pow(Math.abs(u - 0.5) * 2, 2));
    for (let side = 0; side < 2; side += 1) {
      colors.set([color.r, color.g, color.b], (index * 2 + side) * 3);
    }
  }
  geometry.setAttribute('color', new BufferAttribute(colors, 3));
  const indices: number[] = [];
  for (let index = 0; index < points - 1; index += 1) {
    const a = index * 2;
    indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  geometry.setIndex(indices);
  return geometry;
}

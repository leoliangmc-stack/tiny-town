import {
  CanvasTexture,
  Group,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  SRGBColorSpace,
  Vector3,
  type Quaternion,
} from 'three';

/**
 * The icons that can appear over a citizen's head (SPEC.md 2.10): ☂ when an
 * umbrella goes up, 💬 when somebody joins a conversation outdoors, ☕ when
 * somebody sits down on the cafe terrace.
 */
export type IconKind = 'umbrella' | 'chat' | 'coffee';

/** At most this many icons on screen at once; SPEC.md 2.10 allows three to five. */
export const MAX_ICONS = 4;

/** Real seconds an icon lives, fading in and out (SPEC.md 2.10: two to three). */
export const ICON_SECONDS = 2.5;
const FADE_IN_SECONDS = 0.3;
const FADE_OUT_SECONDS = 1;

/** A citizen who just had an icon waits this long, in real seconds, for the next. */
export const CITIZEN_COOLDOWN_SECONDS = 20;

const ICON_SIZE = 0.7;
const ICON_OPACITY = 0.92;

export interface ActiveIcon {
  citizenId: string;
  kind: IconKind;
  /** Real seconds since it appeared. */
  age: number;
}

/**
 * Which icons are showing. Plain logic with no Three.js objects, so the rules
 * of SPEC.md 2.10 can be tested in Node: a few at a time, each for a couple of
 * seconds, and never the same person twice in quick succession.
 *
 * An icon offered while every slot is taken is dropped, not queued: an icon
 * that turned up late would be about something that happened a while ago.
 */
export class IconScheduler {
  private readonly active: ActiveIcon[] = [];
  private readonly lastShown = new Map<string, number>();
  private elapsed = 0;

  get icons(): readonly ActiveIcon[] {
    return this.active;
  }

  /** Shows an icon over the citizen if there is room; true when it was taken. */
  offer(citizenId: string, kind: IconKind): boolean {
    if (this.active.length >= MAX_ICONS) {
      return false;
    }
    const last = this.lastShown.get(citizenId);
    if (last !== undefined && this.elapsed - last < CITIZEN_COOLDOWN_SECONDS) {
      return false;
    }
    this.active.push({ citizenId, kind, age: 0 });
    this.lastShown.set(citizenId, this.elapsed);
    return true;
  }

  /** Ages every icon and lets the finished ones go. */
  advance(deltaSeconds: number): void {
    this.elapsed += deltaSeconds;
    for (const icon of this.active) {
      icon.age += deltaSeconds;
    }
    this.removeWhere((icon) => icon.age >= ICON_SECONDS);
  }

  /** Takes a citizen's icon down at once, for when they leave the street. */
  remove(citizenId: string): void {
    this.removeWhere((icon) => icon.citizenId === citizenId);
  }

  /** Takes every icon down, for high speeds. */
  clear(): void {
    this.active.length = 0;
  }

  /** How visible an icon of this age is, 0 to 1. */
  static opacity(age: number): number {
    if (age <= 0 || age >= ICON_SECONDS) {
      return 0;
    }
    const fadeIn = Math.min(1, age / FADE_IN_SECONDS);
    const fadeOut = Math.min(1, (ICON_SECONDS - age) / FADE_OUT_SECONDS);
    return Math.min(fadeIn, fadeOut);
  }

  private removeWhere(test: (icon: ActiveIcon) => boolean): void {
    for (let i = this.active.length - 1; i >= 0; i -= 1) {
      if (test(this.active[i])) {
        this.active.splice(i, 1);
      }
    }
  }
}

/**
 * The icons drawn over the citizens' heads: a small pool of billboards, one
 * per slot, each with its own material so each can fade on its own. At most
 * MAX_ICONS draw calls, and none when nothing is showing.
 */
export class OverheadIcons {
  readonly root = new Group();
  readonly scheduler = new IconScheduler();

  private readonly slots: Array<{ mesh: Mesh; material: MeshBasicMaterial }> = [];
  private readonly scratch = new Vector3();

  constructor() {
    this.root.name = 'overhead-icons';
    const geometry = new PlaneGeometry(ICON_SIZE, ICON_SIZE);
    for (let i = 0; i < MAX_ICONS; i += 1) {
      const material = new MeshBasicMaterial({
        map: iconTexture('umbrella'),
        transparent: true,
        depthWrite: false,
        opacity: 0,
      });
      const mesh = new Mesh(geometry, material);
      mesh.visible = false;
      mesh.renderOrder = 10;
      this.root.add(mesh);
      this.slots.push({ mesh, material });
    }
  }

  /**
   * Ages the icons and places them. `anchor` writes the point over the
   * citizen's head into `target` and returns false when they cannot be seen,
   * which takes their icon down.
   */
  update(
    deltaSeconds: number,
    anchor: (citizenId: string, target: Vector3) => boolean,
    cameraQuaternion: Quaternion,
  ): void {
    this.scheduler.advance(deltaSeconds);
    for (const icon of [...this.scheduler.icons]) {
      if (!anchor(icon.citizenId, this.scratch)) {
        this.scheduler.remove(icon.citizenId);
      }
    }

    this.slots.forEach((slot, index) => {
      const icon = this.scheduler.icons[index];
      slot.mesh.visible = icon !== undefined;
      if (!icon) {
        return;
      }
      anchor(icon.citizenId, slot.mesh.position);
      const map = iconTexture(icon.kind);
      if (slot.material.map !== map) {
        slot.material.map = map;
        slot.material.needsUpdate = true;
      }
      slot.material.opacity = IconScheduler.opacity(icon.age) * ICON_OPACITY;
      slot.mesh.quaternion.copy(cameraQuaternion);
    });
  }
}

const textures = new Map<IconKind, CanvasTexture>();

/** Each icon is a light glyph on a dark disc, drawn once on a canvas. */
function iconTexture(kind: IconKind): CanvasTexture {
  const known = textures.get(kind);
  if (known) {
    return known;
  }
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d');
  if (context) {
    context.fillStyle = 'rgba(46, 48, 62, 0.88)';
    context.beginPath();
    context.arc(size / 2, size / 2, size / 2 - 4, 0, Math.PI * 2);
    context.fill();
    if (kind === 'umbrella') {
      drawUmbrella(context, size);
    } else if (kind === 'chat') {
      drawChat(context, size);
    } else {
      drawCoffee(context, size);
    }
  }
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  textures.set(kind, texture);
  return texture;
}

/** The canopy as a half disc with a scalloped edge, and the handle below. */
function drawUmbrella(context: CanvasRenderingContext2D, size: number): void {
  context.fillStyle = '#f5f0e6';
  context.beginPath();
  context.arc(size / 2, size * 0.52, size * 0.3, Math.PI, 0);
  context.closePath();
  context.fill();
  context.fillStyle = 'rgba(46, 48, 62, 0.88)';
  for (const dx of [-0.2, 0, 0.2]) {
    context.beginPath();
    context.arc(size / 2 + dx * size, size * 0.53, size * 0.06, 0, Math.PI * 2);
    context.fill();
  }
  context.strokeStyle = '#f5f0e6';
  context.lineWidth = 6;
  context.lineCap = 'round';
  context.beginPath();
  context.moveTo(size / 2, size * 0.52);
  context.lineTo(size / 2, size * 0.78);
  context.arc(size / 2 - 7, size * 0.78, 7, 0, Math.PI);
  context.stroke();
}

/** A speech bubble with three dots in it. */
function drawChat(context: CanvasRenderingContext2D, size: number): void {
  context.fillStyle = '#f5f0e6';
  context.beginPath();
  context.ellipse(size / 2, size * 0.46, size * 0.28, size * 0.2, 0, 0, Math.PI * 2);
  context.fill();
  // The tail, down and to the left.
  context.beginPath();
  context.moveTo(size * 0.36, size * 0.58);
  context.lineTo(size * 0.3, size * 0.76);
  context.lineTo(size * 0.48, size * 0.63);
  context.closePath();
  context.fill();
  context.fillStyle = 'rgba(46, 48, 62, 0.88)';
  for (const dx of [-0.11, 0, 0.11]) {
    context.beginPath();
    context.arc(size / 2 + dx * size, size * 0.46, size * 0.035, 0, Math.PI * 2);
    context.fill();
  }
}

/** A cup on a saucer with a wisp of steam. */
function drawCoffee(context: CanvasRenderingContext2D, size: number): void {
  context.fillStyle = '#f5f0e6';
  context.strokeStyle = '#f5f0e6';
  context.lineCap = 'round';
  // The cup: wider at the rim, rounded at the bottom.
  context.beginPath();
  context.moveTo(size * 0.3, size * 0.46);
  context.lineTo(size * 0.62, size * 0.46);
  context.quadraticCurveTo(size * 0.6, size * 0.7, size * 0.46, size * 0.7);
  context.quadraticCurveTo(size * 0.32, size * 0.7, size * 0.3, size * 0.46);
  context.fill();
  // The handle.
  context.lineWidth = 5;
  context.beginPath();
  context.arc(size * 0.64, size * 0.55, size * 0.06, -Math.PI / 2, Math.PI / 2);
  context.stroke();
  // The saucer.
  context.lineWidth = 6;
  context.beginPath();
  context.moveTo(size * 0.26, size * 0.76);
  context.lineTo(size * 0.66, size * 0.76);
  context.stroke();
  // Steam.
  context.lineWidth = 4;
  for (const x of [0.4, 0.52]) {
    context.beginPath();
    context.moveTo(size * x, size * 0.4);
    context.quadraticCurveTo(size * (x - 0.05), size * 0.33, size * x, size * 0.27);
    context.quadraticCurveTo(size * (x + 0.05), size * 0.22, size * x, size * 0.17);
    context.stroke();
  }
}

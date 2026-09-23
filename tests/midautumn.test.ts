import { BufferAttribute, Mesh, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';

import { Dragons } from '../src/render/Dragons.js';
import { SKY_RADIUS } from '../src/render/Environment.js';
import { Fireworks } from '../src/render/Fireworks.js';
import { MoonPalace } from '../src/render/MoonPalace.js';
import { nextRainbowMode, type RainbowMode } from '../src/render/Rainbow.js';

/**
 * SPEC.md 2.8 and 2.15 (decisions 38 and 39): the rainbow button, and the
 * render side parts of Mid-Autumn night that can be checked without a GPU.
 */

describe('the rainbow button', () => {
  it('goes rainbow, double, none, and round again', () => {
    const seen: RainbowMode[] = [];
    let mode: RainbowMode = 'none';
    for (let press = 0; press < 6; press += 1) {
      mode = nextRainbowMode(mode);
      seen.push(mode);
    }
    expect(seen).toEqual(['single', 'double', 'none', 'single', 'double', 'none']);
  });
});

describe('Mid-Autumn fireworks', () => {
  it('go up over the beach and over the town, within the spark pool', () => {
    const fireworks = new Fireworks();
    fireworks.start();
    let overTown = 0;
    let high = 0;
    for (let frame = 0; frame < 60 * 20; frame += 1) {
      fireworks.update(1 / 60);
      const geometry = fireworks.points.geometry;
      const position = geometry.getAttribute('position') as BufferAttribute;
      for (let index = 0; index < geometry.drawRange.count; index += 1) {
        const y = position.getY(index);
        // Well inland of the beach, low: the town's own small shells.
        if (position.getZ(index) > 10 && y < 45) {
          overTown += 1;
        }
        if (y > 55) {
          high += 1;
        }
      }
    }
    expect(overTown).toBeGreaterThan(0);
    expect(high).toBeGreaterThan(0);
    expect(fireworks.sparkCount).toBeLessThanOrEqual(12000);
    fireworks.stop();
    expect(fireworks.sparkCount).toBe(0);
  });
});

describe('the Moon Palace', () => {
  const palace = new MoonPalace();
  const town = new Vector3(0, 6, 0);
  palace.place(town, new Vector3(-0.4, 0.25, -1).normalize());
  palace.root.updateMatrixWorld(true);

  it('keeps the moon behind itself from any camera over the town', () => {
    const heart = palace.root.position.clone().add(new Vector3(0, 16, 0));
    for (const eye of [
      new Vector3(80, 60, 160),
      new Vector3(-150, 40, 60),
      new Vector3(0, 120, 220),
    ]) {
      const moon = palace.moonDiscDirection(eye, new Vector3()).multiplyScalar(SKY_RADIUS);
      const towardsMoon = moon.sub(eye).normalize();
      const towardsPalace = heart.clone().sub(eye).normalize();
      // Well inside the full moon's disc, about 0.05 radians across its radius.
      expect(towardsMoon.angleTo(towardsPalace)).toBeLessThan(0.01);
    }
  });

  it('shows Chang’e from a viewpoint close in front of her', () => {
    const away = palace.changeViewpoint().distanceTo(palace.changeFocus);
    expect(away).toBeGreaterThan(8);
    expect(away).toBeLessThan(30);
  });
});

describe('the dragons', () => {
  it('fly over the town, above the rooftops, all the time', () => {
    const dragons = new Dragons();
    dragons.setVisible(true);
    let lowest = Infinity;
    for (let frame = 0; frame < 60 * 60; frame += 10) {
      dragons.update(1 / 6);
      dragons.root.traverse((node) => {
        if (node instanceof Mesh && node.name === 'dragon-body') {
          const position = node.geometry.getAttribute('position') as BufferAttribute;
          for (let index = 0; index < position.count; index += 1) {
            lowest = Math.min(lowest, position.getY(index));
          }
        }
      });
    }
    expect(dragons.count).toBe(3);
    // The tallest building stands about 22 metres above the lowest ground.
    expect(lowest).toBeGreaterThan(22);
  });
});

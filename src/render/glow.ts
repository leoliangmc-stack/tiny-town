import { AdditiveBlending, Color, DataTexture, RGBAFormat, Sprite, SpriteMaterial } from 'three';

/**
 * A soft round glow, used for lamp bulbs, the pools of light they throw, and
 * lit windows.
 *
 * There is no bloom pass in v1, so the warmth around a light is drawn on
 * purpose: one radial texture, blended additively. It is what sells the town
 * at night in a time-lapse.
 */
const GLOW_TEXTURE_SIZE = 64;

let sharedGlowTexture: DataTexture | undefined;

/** A radial falloff from white in the centre to nothing at the edge. */
export function glowTexture(): DataTexture {
  if (sharedGlowTexture) {
    return sharedGlowTexture;
  }

  const size = GLOW_TEXTURE_SIZE;
  const data = new Uint8Array(size * size * 4);

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const dx = (x + 0.5) / size - 0.5;
      const dy = (y + 0.5) / size - 0.5;
      const radius = Math.min(1, Math.hypot(dx, dy) * 2);
      const falloff = Math.pow(1 - radius, 2.4);
      const index = (y * size + x) * 4;
      data[index] = 255;
      data[index + 1] = 255;
      data[index + 2] = 255;
      data[index + 3] = Math.round(falloff * 255);
    }
  }

  sharedGlowTexture = new DataTexture(data, size, size, RGBAFormat);
  sharedGlowTexture.needsUpdate = true;
  return sharedGlowTexture;
}

/** A glow sprite that always faces the camera. */
export function createGlowSprite(color: number, scale: number): Sprite {
  const material = new SpriteMaterial({
    map: glowTexture(),
    color: new Color(color),
    blending: AdditiveBlending,
    transparent: true,
    depthWrite: false,
    opacity: 0,
  });

  const sprite = new Sprite(material);
  sprite.scale.setScalar(scale);
  return sprite;
}

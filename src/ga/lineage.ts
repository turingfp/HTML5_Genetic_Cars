/**
 * Colours for family lines.
 *
 * A lineage is just a number, so its colour has to come from that number alone:
 * two cars in the same family must agree without consulting anything, and a
 * family that dies out must not hand its colour to an unrelated newcomer.
 *
 * The golden ratio step is the standard trick. Successive integers land far
 * apart on the colour wheel, so a handful of families on screen at once are all
 * easy to tell apart, and there is no palette to run out of.
 */

const GOLDEN_RATIO_CONJUGATE = 0.618033988749895;

/** Hue in [0, 1) for a family line. */
export function lineageHue(lineage: number): number {
  return (lineage * GOLDEN_RATIO_CONJUGATE) % 1;
}

/** CSS colour for a family line. */
export function lineageColour(lineage: number, saturation = 70, lightness = 62, alpha = 1): string {
  const h = Math.round(lineageHue(lineage) * 360);
  return `hsla(${h}, ${saturation}%, ${lightness}%, ${alpha})`;
}

/** Packed 0xRRGGBB for a family line, for the renderers that want a hex. */
export function lineageHex(lineage: number, saturation = 0.66, lightness = 0.56): number {
  const h = lineageHue(lineage);
  const c = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const x = c * (1 - Math.abs(((h * 6) % 2) - 1));
  const m = lightness - c / 2;
  const sector = Math.floor(h * 6) % 6;
  const rgb: [number, number, number] =
    sector === 0 ? [c, x, 0]
    : sector === 1 ? [x, c, 0]
    : sector === 2 ? [0, c, x]
    : sector === 3 ? [0, x, c]
    : sector === 4 ? [x, 0, c]
    : [c, 0, x];
  const byte = (v: number) => Math.round((v + m) * 255) & 0xff;
  return (byte(rgb[0]) << 16) | (byte(rgb[1]) << 8) | byte(rgb[2]);
}

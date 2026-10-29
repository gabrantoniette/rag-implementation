import { createCanvas, loadImage } from '@napi-rs/canvas';

export interface DecodedImage {
  width: number;
  height: number;
  /** RGBA pixels, row-major. */
  rgba: Uint8ClampedArray;
}

/** Decodes PNG, JPEG, BMP or WebP bytes, optionally downscaling so width <= maxWidth. */
export async function decodeImage(bytes: Uint8Array, maxWidth?: number): Promise<DecodedImage> {
  const image = await loadImage(Buffer.from(bytes));
  const scale = maxWidth && image.width > maxWidth ? maxWidth / image.width : 1;
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(image, 0, 0, width, height);
  return { width, height, rgba: ctx.getImageData(0, 0, width, height).data };
}

export function rgbaToRgb(rgba: Uint8ClampedArray): Uint8ClampedArray {
  const rgb = new Uint8ClampedArray((rgba.length / 4) * 3);
  for (let i = 0, j = 0; i < rgba.length; i += 4, j += 3) {
    rgb[j] = rgba[i]!;
    rgb[j + 1] = rgba[i + 1]!;
    rgb[j + 2] = rgba[i + 2]!;
  }
  return rgb;
}

/**
 * 64-bit difference hash: grayscale 9x8 thumbnail, one bit per horizontal neighbour comparison.
 * Near-identical frames have a small Hamming distance.
 */
export async function differenceHash(bytes: Uint8Array): Promise<bigint> {
  const image = await loadImage(Buffer.from(bytes));
  const canvas = createCanvas(9, 8);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(image, 0, 0, 9, 8);
  const { data } = ctx.getImageData(0, 0, 9, 8);
  const gray = (x: number, y: number) => {
    const i = (y * 9 + x) * 4;
    return 0.299 * data[i]! + 0.587 * data[i + 1]! + 0.114 * data[i + 2]!;
  };
  let hash = 0n;
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      hash = (hash << 1n) | (gray(x, y) > gray(x + 1, y) ? 1n : 0n);
    }
  }
  return hash;
}

export function hammingDistance(a: bigint, b: bigint): number {
  let x = a ^ b;
  let count = 0;
  while (x > 0n) {
    count += Number(x & 1n);
    x >>= 1n;
  }
  return count;
}

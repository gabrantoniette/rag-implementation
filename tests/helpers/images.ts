import { createCanvas } from '@napi-rs/canvas';
import type { PdfImage } from './pdf.js';

const FONT = 'Arial, "DejaVu Sans", "Liberation Sans", sans-serif';

/** Black text on a white background, one line per entry. */
export function drawTextCanvas(
  lines: string[],
  options: { width?: number; fontSize?: number } = {},
) {
  const fontSize = options.fontSize ?? 36;
  const width = options.width ?? 1400;
  const height = Math.round(lines.length * fontSize * 1.6 + fontSize * 2);
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = '#000000';
  ctx.font = `${fontSize}px ${FONT}`;
  ctx.textBaseline = 'top';
  lines.forEach((line, i) => ctx.fillText(line, fontSize, fontSize + i * fontSize * 1.6));
  return canvas;
}

export async function drawTextPng(
  lines: string[],
  options?: { width?: number; fontSize?: number },
) {
  return new Uint8Array(await drawTextCanvas(lines, options).encode('png'));
}

/** Raw RGB pixels of drawn text, for embedding as an image page in a PDF (no text layer). */
export function drawTextRgb(
  lines: string[],
  options?: { width?: number; fontSize?: number },
): PdfImage {
  const canvas = drawTextCanvas(lines, options);
  const { data, width, height } = canvas
    .getContext('2d')
    .getImageData(0, 0, canvas.width, canvas.height);
  const rgb = new Uint8Array(width * height * 3);
  for (let i = 0, j = 0; i < data.length; i += 4, j += 3) {
    rgb[j] = data[i]!;
    rgb[j + 1] = data[i + 1]!;
    rgb[j + 2] = data[i + 2]!;
  }
  return { width, height, rgb };
}

/** A simple scene (sky, grass, a ball) for the structural caption check. */
export async function drawScenePng(): Promise<Uint8Array> {
  const canvas = createCanvas(640, 480);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#7ec0ee';
  ctx.fillRect(0, 0, 640, 300);
  ctx.fillStyle = '#2e8b57';
  ctx.fillRect(0, 300, 640, 180);
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(320, 340, 40, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#000000';
  ctx.lineWidth = 3;
  ctx.stroke();
  return new Uint8Array(await canvas.encode('png'));
}

/** A flat-colour frame; identical calls produce identical images (dedup test). */
export async function solidPng(color: string, width = 320, height = 180): Promise<Uint8Array> {
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, width / 3, height);
  return new Uint8Array(await canvas.encode('png'));
}

/** Alternating stripes; a frame with a different layout than solidPng for dedup tests. */
export async function stripesPng(width = 320, height = 180): Promise<Uint8Array> {
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  for (let x = 0; x < width; x += 20) {
    ctx.fillStyle = (x / 20) % 2 === 0 ? '#ffffff' : '#000000';
    ctx.fillRect(x, 0, 20, height);
  }
  return new Uint8Array(await canvas.encode('png'));
}

/** 24-bit BMP encoder (canvas cannot encode BMP), for the image-format fixture. */
export function encodeBmp(width: number, height: number, rgba: Uint8ClampedArray): Uint8Array {
  const rowSize = Math.ceil((width * 3) / 4) * 4;
  const size = 54 + rowSize * height;
  const buf = Buffer.alloc(size);
  buf.write('BM', 0, 'latin1');
  buf.writeUInt32LE(size, 2);
  buf.writeUInt32LE(54, 10);
  buf.writeUInt32LE(40, 14);
  buf.writeInt32LE(width, 18);
  buf.writeInt32LE(height, 22);
  buf.writeUInt16LE(1, 26);
  buf.writeUInt16LE(24, 28);
  buf.writeUInt32LE(rowSize * height, 34);
  for (let y = 0; y < height; y++) {
    const row = 54 + (height - 1 - y) * rowSize; // bottom-up rows
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      buf[row + x * 3] = rgba[i + 2]!;
      buf[row + x * 3 + 1] = rgba[i + 1]!;
      buf[row + x * 3 + 2] = rgba[i]!;
    }
  }
  return new Uint8Array(buf);
}

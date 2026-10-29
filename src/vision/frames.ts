import { differenceHash, hammingDistance } from './image.js';
import type { VideoFrame } from './media-tools.js';

/**
 * Drops near-duplicate frames: a frame is kept only if its difference hash is more than
 * maxHamming bits away from the last kept frame.
 */
export async function dedupeFrames(
  frames: VideoFrame[],
  maxHamming: number,
): Promise<VideoFrame[]> {
  const kept: VideoFrame[] = [];
  let last: bigint | null = null;
  for (const frame of frames) {
    const hash = await differenceHash(frame.png);
    if (last !== null && hammingDistance(hash, last) <= maxHamming) continue;
    kept.push(frame);
    last = hash;
  }
  return kept;
}

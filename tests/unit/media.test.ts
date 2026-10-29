import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { WhisperRecognizer } from '../../src/adapters/whisper.js';
import { MediaToolMissingError } from '../../src/core/errors.js';
import { silentLogger } from '../../src/core/logger.js';
import { formatLocator } from '../../src/core/locator.js';
import { projectPath } from '../../src/core/paths.js';
import { createRegistry } from '../../src/loaders/index.js';
import { VISUAL_PREFIX } from '../../src/loaders/image.js';
import { MockCaptioner } from '../../src/vision/captioner.js';
import { FfmpegTools, SAMPLE_RATE, findFfmpeg } from '../../src/vision/ffmpeg.js';
import { dedupeFrames } from '../../src/vision/frames.js';
import type { MediaTools, SpeechRecognizer, VideoFrame } from '../../src/vision/media-tools.js';
import { MockOcr } from '../../src/vision/ocr.js';
import { loaderContext, writeFixture } from '../helpers/context.js';
import { solidPng, stripesPng } from '../helpers/images.js';

const registry = createRegistry(50 * 1024 * 1024);
const ffmpeg = findFfmpeg(process.env.FFMPEG_PATH ?? '');
const dummyMedia = new Uint8Array([0, 0, 0, 0x20, 0x66, 0x74, 0x79, 0x70]); // not decoded by tests

function fakeAsr(): SpeechRecognizer & { calls: number } {
  return {
    calls: 0,
    async transcribe(samples) {
      this.calls++;
      const seconds = samples.length / SAMPLE_RATE;
      return Array.from({ length: Math.floor(seconds / 10) }, (_, i) => ({
        text: `Commentary segment ${i + 1} about the second half.`,
        startSec: i * 10,
        endSec: i * 10 + 10,
      }));
    },
  };
}

async function fakeMedia(frames: VideoFrame[], seconds: number): Promise<MediaTools> {
  return {
    ffmpegPath: 'fake-ffmpeg',
    decodeAudio: async () => new Float32Array(seconds * SAMPLE_RATE),
    extractFrames: async () => frames,
  };
}

describe('media loader (no real ffmpeg needed)', () => {
  it('throws MediaToolMissingError with install instructions when ffmpeg is missing', async () => {
    const file = writeFixture('media', 'interview.mp3', dummyMedia);
    const error = await registry.loadFile(file, loaderContext()).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(MediaToolMissingError);
    expect((error as Error).message).toContain('winget install Gyan.FFmpeg');
  });

  it('prefers a sidecar subtitle file and skips transcription', async () => {
    const file = writeFixture('media', 'final.mp3', dummyMedia);
    writeFixture(
      'media',
      'final.srt',
      '1\n00:00:01,000 --> 00:00:04,000\nThe final whistle blows.\n',
    );
    const asr = fakeAsr();
    const doc = await registry.loadFile(file, loaderContext({ asr }));
    expect(asr.calls).toBe(0);
    expect(doc.format).toBe('audio');
    expect(doc.sections).toEqual([
      {
        path: [],
        text: 'The final whistle blows.',
        locator: { kind: 'time', startSec: 1, endSec: 4 },
        modality: 'audio',
        kind: 'transcript',
      },
    ]);
  });

  it('identical frames collapse to one after deduplication', async () => {
    const red = await solidPng('#cc0000');
    const stripes = await stripesPng();
    const kept = await dedupeFrames(
      [
        { timeSec: 0, png: red },
        { timeSec: 1, png: red },
        { timeSec: 2, png: await solidPng('#cc0000') },
        { timeSec: 3, png: stripes },
      ],
      5,
    );
    expect(kept.map((f) => f.timeSec)).toEqual([0, 3]);
  });

  it('visual sections are time-ordered, interleaved with audio windows and tagged', async () => {
    const a = await solidPng('#cc0000');
    const b = await stripesPng();
    const frames: VideoFrame[] = [
      { timeSec: 5, png: a },
      { timeSec: 95, png: b },
      { timeSec: 96, png: b }, // near-duplicate of the previous frame
    ];
    const captioner = new MockCaptioner('Players line up on a grass pitch.');
    const ocr = new MockOcr('HOME 2 - 1 AWAY');
    const doc = await registry.loadFile(
      writeFixture('media', 'highlights.mp4', dummyMedia),
      loaderContext({ media: await fakeMedia(frames, 180), asr: fakeAsr(), ocr, captioner }),
    );
    expect(doc.format).toBe('video');
    expect(captioner.calls).toBe(2);
    const kinds = doc.sections.map((s) => `${s.modality}@${formatLocator(s.locator)}`);
    // Audio windows are at most 90 s; frames at 5 s and 95 s (the 96 s duplicate is dropped).
    expect(kinds).toEqual([
      'audio@00:00:00-00:01:30',
      'visual@00:00:05-00:00:05 on-screen',
      'audio@00:01:30-00:03:00',
      'visual@00:01:35-00:01:35 on-screen',
    ]);
    const starts = doc.sections.map((s) => (s.locator.kind === 'time' ? s.locator.startSec : -1));
    expect([...starts].sort((x, y) => x - y)).toEqual(starts);
    const visual = doc.sections.find((s) => s.modality === 'visual')!;
    expect(visual.text).toBe(
      `${VISUAL_PREFIX} Players line up on a grass pitch.\nOn-screen text: HOME 2 - 1 AWAY`,
    );
    expect(visual.path).toEqual(['Visual']);
  });

  it('--no-visual skips keyframe analysis', async () => {
    const extract = vi.fn(async () => [] as VideoFrame[]);
    const media: MediaTools = {
      ffmpegPath: 'fake',
      decodeAudio: async () => new Float32Array(30 * SAMPLE_RATE),
      extractFrames: extract,
    };
    const doc = await registry.loadFile(
      writeFixture('media', 'novisual.mp4', dummyMedia),
      loaderContext({ media, asr: fakeAsr(), visual: false }),
    );
    expect(extract).not.toHaveBeenCalled();
    expect(doc.sections.every((s) => s.modality === 'audio')).toBe(true);
  });
});

describe.skipIf(!ffmpeg)('media with real ffmpeg', () => {
  const tools = () => new FfmpegTools(ffmpeg!, silentLogger);
  const clip = () => {
    const out = writeFixture('media', 'lavfi-clip.mp4', new Uint8Array());
    const r = spawnSync(ffmpeg!, [
      '-y',
      '-hide_banner',
      '-loglevel',
      'error',
      '-f',
      'lavfi',
      '-i',
      'testsrc=duration=5:size=320x240:rate=10',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=440:duration=5',
      '-shortest',
      '-pix_fmt',
      'yuv420p',
      out,
    ]);
    expect(r.status).toBe(0);
    return out;
  };

  it('decodes audio to 16 kHz mono float32 samples of the expected length', async () => {
    const samples = await tools().decodeAudio(clip());
    expect(samples).toBeInstanceOf(Float32Array);
    expect(Math.abs(samples.length - 5 * SAMPLE_RATE)).toBeLessThan(SAMPLE_RATE / 2);
  });

  it('a generated 5-second clip yields at least one frame with a timestamp', async () => {
    const frames = await tools().extractFrames(clip(), {
      sceneThreshold: 0.3,
      minIntervalSeconds: 30,
      frameMaxWidth: 1024,
      maxFrames: 60,
    });
    expect(frames.length).toBeGreaterThanOrEqual(1);
    expect(frames[0]!.timeSec).toBeGreaterThanOrEqual(0);
    expect(existsSync(projectPath('.cache', 'frames'))).toBe(true);
  });
});

const userClips = (() => {
  const dir = projectPath('tests', 'assets', 'user');
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => /\.(wav|mp3|m4a|flac)$/i.test(f))
    .map((f) => path.join(dir, f));
})();

describe.skipIf(!ffmpeg || userClips.length === 0)('real Whisper transcription (user clip)', () => {
  it('transcribes a short English speech clip', async () => {
    const samples = await new FfmpegTools(ffmpeg!, silentLogger).decodeAudio(userClips[0]!);
    const asr = new WhisperRecognizer();
    const segments = await asr.transcribe(samples);
    await asr.close();
    expect(segments.length).toBeGreaterThan(0);
    expect(
      segments
        .map((s) => s.text)
        .join(' ')
        .trim().length,
    ).toBeGreaterThan(0);
  });
});

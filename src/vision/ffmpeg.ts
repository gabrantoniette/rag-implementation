import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { sha1 } from '../core/hash.js';
import type { Logger } from '../core/logger.js';
import { PATHS } from '../core/paths.js';
import type { FrameExtractionOptions, MediaTools, VideoFrame } from './media-tools.js';

export const SAMPLE_RATE = 16_000;

/** ffmpeg from FFMPEG_PATH or PATH; null when it cannot be run. Never installs anything. */
export function findFfmpeg(ffmpegPathEnv = ''): string | null {
  const candidates = ffmpegPathEnv ? [ffmpegPathEnv] : ['ffmpeg'];
  for (const candidate of candidates) {
    const result = spawnSync(candidate, ['-version'], { stdio: 'ignore', windowsHide: true });
    if (result.status === 0) return candidate;
  }
  return null;
}

function run(bin: string, args: string[]): Promise<{ stdout: Buffer; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { windowsHide: true });
    const out: Buffer[] = [];
    let err = '';
    child.stdout.on('data', (d: Buffer) => out.push(d));
    child.stderr.on('data', (d: Buffer) => (err += d.toString()));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve({ stdout: Buffer.concat(out), stderr: err });
      else reject(new Error(`ffmpeg exited with code ${code}: ${err.slice(-500)}`));
    });
  });
}

/** Escapes commas inside a filtergraph expression (arguments are passed without a shell). */
const expr = (s: string) => s.replace(/,/g, '\\,');

export class FfmpegTools implements MediaTools {
  constructor(
    readonly ffmpegPath: string,
    private readonly logger: Logger,
    private readonly framesRoot = PATHS.framesCache,
  ) {}

  /** 16 kHz mono float32 little-endian PCM on stdout. */
  async decodeAudio(filePath: string): Promise<Float32Array> {
    const { stdout } = await run(this.ffmpegPath, [
      '-nostdin',
      '-hide_banner',
      '-loglevel',
      'error',
      '-i',
      filePath,
      '-vn',
      '-ac',
      '1',
      '-ar',
      String(SAMPLE_RATE),
      '-f',
      'f32le',
      '-acodec',
      'pcm_f32le',
      'pipe:1',
    ]);
    const samples = new Float32Array(stdout.byteLength / 4);
    for (let i = 0; i < samples.length; i++) samples[i] = stdout.readFloatLE(i * 4);
    return samples;
  }

  /**
   * Scene-change keyframes (scene > threshold) plus one frame whenever minIntervalSeconds passed
   * since the last kept frame, scaled to frameMaxWidth, capped at maxFrames. Frames are written to
   * .cache/frames/<hash>/ inside the project and deleted after reading.
   */
  async extractFrames(filePath: string, o: FrameExtractionOptions): Promise<VideoFrame[]> {
    const dir = path.join(this.framesRoot, sha1(path.resolve(filePath)));
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    try {
      const select = expr(
        `gt(scene,${o.sceneThreshold})+isnan(prev_selected_t)+gte(t-prev_selected_t,${o.minIntervalSeconds})`,
      );
      const scale = `scale=w=${expr(`min(${o.frameMaxWidth},iw)`)}:h=-2`;
      const { stderr } = await run(this.ffmpegPath, [
        '-nostdin',
        '-hide_banner',
        '-i',
        filePath,
        '-vf',
        `select=${select},${scale},showinfo`,
        '-fps_mode',
        'vfr',
        '-frames:v',
        String(o.maxFrames),
        path.join(dir, 'frame-%04d.png'),
      ]);
      const times = [...stderr.matchAll(/pts_time:\s*([\d.]+)/g)].map((m) => Number(m[1]));
      const files = readdirSync(dir)
        .filter((f) => f.endsWith('.png'))
        .sort();
      return files.map((f, i) => {
        this.logger.debug(`frame ${i + 1}/${files.length} at ${times[i] ?? 0}s`);
        return { timeSec: times[i] ?? 0, png: new Uint8Array(readFileSync(path.join(dir, f))) };
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
}

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { CorruptDocumentError, MediaToolMissingError } from '../core/errors.js';
import type { Section } from '../core/types.js';
import { dedupeFrames } from '../vision/frames.js';
import { SAMPLE_RATE } from '../vision/ffmpeg.js';
import { VISUAL_PREFIX } from './image.js';
import { baseTitle, decodeText } from './registry.js';
import { parseSubtitles } from './subtitle.js';
import { windowCues } from './transcript.js';
import type { DocumentLoader, LoaderContext, LoaderInput } from './types.js';

export const VIDEO_EXTENSIONS = ['.mp4', '.mkv', '.webm', '.mov'];
export const AUDIO_EXTENSIONS = ['.mp3', '.wav', '.m4a', '.flac'];

/** A subtitle file next to the media file with the same base name, if any. */
export function findSidecar(mediaPath: string): string | null {
  const base = mediaPath.slice(0, -path.extname(mediaPath).length);
  for (const ext of ['.srt', '.vtt']) if (existsSync(base + ext)) return base + ext;
  return null;
}

async function transcriptSections(input: LoaderInput, ctx: LoaderContext): Promise<Section[]> {
  const sidecar = input.path ? findSidecar(input.path) : null;
  if (sidecar) {
    ctx.logger.info(`Using sidecar subtitles ${path.basename(sidecar)} instead of transcription`);
    return windowCues(parseSubtitles(decodeText(readFileSync(sidecar))), ctx, 'audio');
  }
  if (!ctx.media) throw new MediaToolMissingError('ffmpeg');
  if (!ctx.asr) throw new Error('No speech recognizer configured for audio transcription');
  const samples = await ctx.media.decodeAudio(input.path!);
  const minutes = samples.length / SAMPLE_RATE / 60;
  if (minutes > ctx.parameters.media.warnAudioMinutes) {
    ctx.logger.warn(`Audio is ${minutes.toFixed(1)} minutes long; transcription will take a while`);
  }
  const segments = await ctx.asr.transcribe(samples, SAMPLE_RATE);
  return windowCues(segments, ctx, 'audio');
}

async function visualSections(input: LoaderInput, ctx: LoaderContext): Promise<Section[]> {
  if (!ctx.media) {
    ctx.logger.warn('ffmpeg is not available; video keyframe analysis skipped', { uri: input.uri });
    return [];
  }
  const v = ctx.parameters.media.visual;
  const frames = await ctx.media.extractFrames(input.path!, {
    sceneThreshold: v.sceneThreshold,
    minIntervalSeconds: v.minIntervalSeconds,
    frameMaxWidth: v.frameMaxWidth,
    maxFrames: v.maxFrames,
  });
  const kept = await dedupeFrames(frames, v.dedupHammingMax);
  const sections: Section[] = [];
  for (const [i, frame] of kept.entries()) {
    ctx.logger.info(`Analysing frame ${i + 1}/${kept.length} at ${frame.timeSec.toFixed(1)}s`);
    const caption = ctx.captioner ? (await ctx.captioner.caption(frame.png)).trim() : '';
    const onScreen = ctx.ocr
      ? (await ctx.ocr.recognize(frame.png)).text.replace(/\s+/g, ' ').trim()
      : '';
    const parts: string[] = [];
    if (caption) parts.push(`${VISUAL_PREFIX} ${caption}`);
    if (onScreen) parts.push(`On-screen text: ${onScreen}`);
    if (parts.length === 0) continue;
    sections.push({
      path: ['Visual'],
      text: parts.join('\n'),
      locator: { kind: 'time', startSec: frame.timeSec, endSec: frame.timeSec, visual: true },
      modality: 'visual',
      kind: 'transcript',
    });
  }
  return sections;
}

const startOf = (s: Section) => (s.locator.kind === 'time' ? s.locator.startSec : 0);

/**
 * Audio and video. A sidecar .srt/.vtt with the same base name is preferred over transcription;
 * otherwise ffmpeg decodes 16 kHz mono PCM and Whisper transcribes it, windowed like subtitles.
 * Video files also get keyframe analysis (OCR + caption per kept frame, '[Visual description]'),
 * interleaved with the transcript in time order. People are never identified; everything is local.
 */
export const mediaLoader: DocumentLoader = {
  name: 'media',
  extensions: [...VIDEO_EXTENSIONS, ...AUDIO_EXTENSIONS],
  async load(input, ctx) {
    if (!input.path)
      throw new CorruptDocumentError(input.uri, 'media must be loaded from a file path');
    const isVideo = VIDEO_EXTENSIONS.includes(input.extension);
    const audio = await transcriptSections(input, ctx);
    const visual = isVideo && ctx.visual !== false ? await visualSections(input, ctx) : [];
    // Stable sort: on equal times the transcript window comes first.
    const sections = [...audio, ...visual]
      .map((s, i) => ({ s, i }))
      .sort((a, b) => startOf(a.s) - startOf(b.s) || a.i - b.i)
      .map(({ s }) => s);
    return {
      title: baseTitle(input.fileName),
      format: isVideo ? 'video' : 'audio',
      sections,
      metadata: { audioSections: audio.length, visualSections: visual.length },
    };
  },
};

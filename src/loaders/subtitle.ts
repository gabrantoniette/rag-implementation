import { CorruptDocumentError } from '../core/errors.js';
import { baseTitle, decodeText } from './registry.js';
import { type Cue, windowCues } from './transcript.js';
import type { DocumentLoader } from './types.js';

const TIME = /(?:(\d+):)?(\d{1,2}):(\d{2})[.,](\d{1,3})/;

function seconds(stamp: string): number {
  const m = stamp.match(TIME);
  if (!m) return Number.NaN;
  const [, h, min, s, ms] = m;
  return Number(h ?? 0) * 3600 + Number(min) * 60 + Number(s) + Number(ms!.padEnd(3, '0')) / 1000;
}

function cleanCueText(lines: string[]): string {
  return lines
    .join(' ')
    .replace(/<[^>]+>/g, '')
    .replace(/\{\\[^}]*\}/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Parses SRT and WebVTT cues (VTT NOTE, STYLE and REGION blocks are skipped). */
export function parseSubtitles(text: string): Cue[] {
  const cues: Cue[] = [];
  for (const block of text.split(/\n\s*\n/)) {
    const lines = block.split('\n').filter((l) => l.trim() !== '');
    const timing = lines.findIndex((l) => l.includes('-->'));
    if (timing < 0) continue;
    const first = lines[0]!.trim();
    if (/^(NOTE|STYLE|REGION)\b/.test(first)) continue;
    const [startRaw, endRaw] = lines[timing]!.split('-->');
    const startSec = seconds(startRaw ?? '');
    const endSec = seconds(endRaw ?? '');
    if (Number.isNaN(startSec) || Number.isNaN(endSec)) continue;
    const cueText = cleanCueText(lines.slice(timing + 1));
    if (cueText) cues.push({ startSec, endSec, text: cueText });
  }
  return cues;
}

export const subtitleLoader: DocumentLoader = {
  name: 'subtitle',
  extensions: ['.srt', '.vtt'],
  async load(input, ctx) {
    const text = decodeText(input.bytes);
    if (input.extension === '.vtt' && !text.trimStart().startsWith('WEBVTT')) {
      throw new CorruptDocumentError(input.uri, 'missing WEBVTT header');
    }
    const cues = parseSubtitles(text);
    return {
      title: baseTitle(input.fileName),
      format: input.extension.slice(1),
      sections: windowCues(cues, ctx, 'text'),
      metadata: { cueCount: cues.length },
    };
  },
};

import type { Modality, Section } from '../core/types.js';
import type { LoaderContext } from './types.js';

export interface Cue {
  startSec: number;
  endSec: number;
  text: string;
}

/**
 * Merges cues into windows of about targetTokens and at most maxSeconds, located by time range.
 * Used for subtitle files and for Whisper transcripts alike.
 */
export function windowCues(
  cues: Cue[],
  ctx: LoaderContext,
  modality: Modality,
  path: string[] = [],
): Section[] {
  const target = ctx.parameters.chunking.targetTokens;
  const maxSeconds = ctx.parameters.media.subtitleWindowMaxSeconds;
  const sections: Section[] = [];
  let group: Cue[] = [];
  let tokens = 0;
  const flush = () => {
    if (group.length === 0) return;
    sections.push({
      path,
      text: group.map((c) => c.text).join(' '),
      locator: {
        kind: 'time',
        startSec: group[0]!.startSec,
        endSec: group[group.length - 1]!.endSec,
      },
      modality,
      kind: 'transcript',
    });
    group = [];
    tokens = 0;
  };
  for (const cue of cues) {
    const text = cue.text.trim();
    if (!text) continue;
    const t = ctx.tokens.count(text);
    const tooLong = group.length > 0 && cue.endSec - group[0]!.startSec > maxSeconds;
    if (group.length > 0 && (tokens + t > target || tooLong)) flush();
    group.push({ ...cue, text });
    tokens += t;
  }
  flush();
  return sections;
}

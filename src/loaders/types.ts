import type { Parameters } from '../core/config.js';
import type { Logger } from '../core/logger.js';
import type { TokenCounter } from '../core/tokens.js';
import type { MetadataValue, ParsedDocument, Section } from '../core/types.js';
import type { ImageCaptioner, OcrEngine } from '../vision/types.js';
import type { MediaTools, SpeechRecognizer } from '../vision/media-tools.js';

export interface LoaderInput {
  bytes: Uint8Array;
  /** Normalized source location (absolute file path or URL). */
  uri: string;
  fileName: string;
  /** Lower-case extension including the dot, for example '.pdf'. */
  extension: string;
  /** Absolute path when the source is a file on disk (media tools and sidecars need it). */
  path?: string;
  /** Explicit title (text sources and CRUD overrides). */
  title?: string;
}

export interface LoaderContext {
  tokens: TokenCounter;
  parameters: Parameters;
  logger: Logger;
  ocr?: OcrEngine;
  captioner?: ImageCaptioner;
  /** ffmpeg wrapper; absent when ffmpeg is not installed. */
  media?: MediaTools;
  asr?: SpeechRecognizer;
  /** Keyframe analysis for video files (default true; --no-visual turns it off). */
  visual?: boolean;
}

/** What a loader returns; the registry adds id and contentHash. */
export interface LoadedContent {
  title: string;
  format: string;
  sections: Section[];
  metadata?: Record<string, MetadataValue>;
  links?: string[];
}

export interface DocumentLoader {
  readonly name: string;
  readonly extensions: readonly string[];
  load(input: LoaderInput, ctx: LoaderContext): Promise<LoadedContent>;
}

export type { ParsedDocument };

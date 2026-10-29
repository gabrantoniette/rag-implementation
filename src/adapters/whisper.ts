import { type AutomaticSpeechRecognitionPipeline, pipeline } from '@huggingface/transformers';
import type { SpeechRecognizer, TranscriptSegment } from '../vision/media-tools.js';
import { configureTransformers } from './transformers-env.js';

export const DEFAULT_ASR_MODEL = 'Xenova/whisper-tiny.en';

/** Whisper through Transformers.js: English, timestamps on, 30 s chunks with 5 s stride. */
export class WhisperRecognizer implements SpeechRecognizer {
  private pipe: Promise<AutomaticSpeechRecognitionPipeline> | null = null;

  constructor(private readonly modelId = DEFAULT_ASR_MODEL) {}

  private load() {
    if (!this.pipe) {
      configureTransformers();
      this.pipe = pipeline('automatic-speech-recognition', this.modelId, {
        dtype: 'q8',
      }) as Promise<AutomaticSpeechRecognitionPipeline>;
    }
    return this.pipe;
  }

  async transcribe(samples: Float32Array): Promise<TranscriptSegment[]> {
    const pipe = await this.load();
    const output = (await pipe(samples, {
      return_timestamps: true,
      chunk_length_s: 30,
      stride_length_s: 5,
    })) as { text: string; chunks?: { text: string; timestamp: [number, number | null] }[] };
    const chunks = output.chunks ?? [{ text: output.text, timestamp: [0, null] }];
    const duration = samples.length / 16_000;
    return chunks
      .map((c) => ({
        text: c.text.trim(),
        startSec: c.timestamp[0] ?? 0,
        endSec: c.timestamp[1] ?? duration,
      }))
      .filter((s) => s.text);
  }

  async close(): Promise<void> {
    if (this.pipe) await (await this.pipe).dispose();
    this.pipe = null;
  }
}

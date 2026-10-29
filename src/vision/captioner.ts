import {
  AutoProcessor,
  AutoTokenizer,
  Florence2ForConditionalGeneration,
  type ImageToTextPipeline,
  RawImage,
  pipeline,
} from '@huggingface/transformers';
import { configureTransformers } from '../adapters/transformers-env.js';
import type { Logger } from '../core/logger.js';
import { decodeImage, rgbaToRgb } from './image.js';
import type { ImageCaptioner } from './types.js';

async function toRawImage(bytes: Uint8Array, maxWidth = 1024): Promise<RawImage> {
  const { width, height, rgba } = await decodeImage(bytes, maxWidth);
  return new RawImage(rgbaToRgb(rgba), width, height, 3);
}

const FLORENCE_ID = 'onnx-community/Florence-2-base-ft';
const FLORENCE_TASK = '<MORE_DETAILED_CAPTION>';

/**
 * Florence-2 base with the <MORE_DETAILED_CAPTION> task. Per-module dtypes follow the
 * Transformers.js dtype guide (fp16 embeddings and vision encoder, q4 encoder and decoder).
 */
export class Florence2Captioner implements ImageCaptioner {
  readonly name = FLORENCE_ID;
  private parts: Promise<{
    model: Florence2ForConditionalGeneration;
    processor: Awaited<ReturnType<typeof AutoProcessor.from_pretrained>>;
    tokenizer: Awaited<ReturnType<typeof AutoTokenizer.from_pretrained>>;
  }> | null = null;

  load() {
    if (!this.parts) {
      configureTransformers();
      this.parts = (async () => ({
        model: (await Florence2ForConditionalGeneration.from_pretrained(FLORENCE_ID, {
          dtype: {
            embed_tokens: 'fp16',
            vision_encoder: 'fp16',
            encoder_model: 'q4',
            decoder_model_merged: 'q4',
          },
        })) as Florence2ForConditionalGeneration,
        processor: await AutoProcessor.from_pretrained(FLORENCE_ID),
        tokenizer: await AutoTokenizer.from_pretrained(FLORENCE_ID),
      }))();
    }
    return this.parts;
  }

  async caption(bytes: Uint8Array): Promise<string> {
    const { model, processor, tokenizer } = await this.load();
    const image = await toRawImage(bytes);
    const visionInputs = await processor(image);
    const prompts = (
      processor as unknown as { construct_prompts(t: string): string[] }
    ).construct_prompts(FLORENCE_TASK);
    const textInputs = tokenizer(prompts);
    const ids = await model.generate({ ...textInputs, ...visionInputs, max_new_tokens: 100 });
    const text = tokenizer.batch_decode(ids as never, { skip_special_tokens: false })[0] ?? '';
    const result = (
      processor as unknown as {
        post_process_generation(
          t: string,
          task: string,
          size: [number, number],
        ): Record<string, string>;
      }
    ).post_process_generation(text, FLORENCE_TASK, image.size);
    return (result[FLORENCE_TASK] ?? '').trim();
  }

  async close(): Promise<void> {
    if (this.parts) await (await this.parts).model.dispose();
    this.parts = null;
  }
}

/** Fallback captioner: ViT-GPT2 through the image-to-text pipeline (shorter captions). */
export class VitGpt2Captioner implements ImageCaptioner {
  readonly name = 'Xenova/vit-gpt2-image-captioning';
  private pipe: Promise<ImageToTextPipeline> | null = null;

  load() {
    if (!this.pipe) {
      configureTransformers();
      this.pipe = pipeline('image-to-text', this.name, {
        dtype: 'q8',
      }) as Promise<ImageToTextPipeline>;
    }
    return this.pipe;
  }

  async caption(bytes: Uint8Array): Promise<string> {
    const pipe = await this.load();
    const out = (await pipe(await toRawImage(bytes, 512))) as { generated_text: string }[];
    return (out[0]?.generated_text ?? '').trim();
  }

  async close(): Promise<void> {
    if (this.pipe) await (await this.pipe).dispose();
    this.pipe = null;
  }
}

/** Fixed caption for unit tests. */
export class MockCaptioner implements ImageCaptioner {
  readonly name = 'mock-captioner';
  calls = 0;
  constructor(private readonly text = 'A mock description of the image.') {}
  async caption(): Promise<string> {
    this.calls++;
    return this.text;
  }
  async close(): Promise<void> {}
}

/**
 * Florence-2 first, ViT-GPT2 as fallback. Each candidate must load and caption a probe image;
 * returns null (captioning disabled, with a warning) if neither runs on this machine.
 */
export async function createCaptioner(
  logger: Logger,
  probe: Uint8Array,
  candidates: ImageCaptioner[] = [new Florence2Captioner(), new VitGpt2Captioner()],
): Promise<ImageCaptioner | null> {
  for (const captioner of candidates) {
    try {
      const text = await captioner.caption(probe);
      if (text) return captioner;
      logger.warn(`Captioner ${captioner.name} returned an empty caption; trying the next one`);
    } catch (error) {
      logger.warn(`Captioner ${captioner.name} could not run on this machine`, error);
      await captioner.close().catch(() => {});
    }
  }
  logger.warn('No image captioner could run; image descriptions are disabled (OCR still works)');
  return null;
}

/**
 * Picks the captioner on first use (the first real image doubles as the probe), so commands that
 * never see an image never download a vision model.
 */
export class LazyCaptioner implements ImageCaptioner {
  private inner: Promise<ImageCaptioner | null> | null = null;
  constructor(private readonly logger: Logger) {}

  get name(): string {
    return 'auto (Florence-2, fallback ViT-GPT2)';
  }

  async caption(image: Uint8Array): Promise<string> {
    this.inner ??= createCaptioner(this.logger, image);
    const captioner = await this.inner;
    return captioner ? captioner.caption(image) : '';
  }

  async close(): Promise<void> {
    if (this.inner) await (await this.inner)?.close();
    this.inner = null;
  }
}

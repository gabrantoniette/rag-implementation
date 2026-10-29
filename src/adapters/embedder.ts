import { type FeatureExtractionPipeline, pipeline } from '@huggingface/transformers';
import type { Embedder } from '../core/ports.js';
import { configureTransformers } from './transformers-env.js';

export interface EmbedderModel {
  id: string;
  dimensions: number;
  pooling: 'cls' | 'mean';
  /** Instruction prepended to queries only. */
  queryPrefix: string;
}

/**
 * Xenova/bge-small-en-v1.5: CLS pooling per the upstream BAAI 1_Pooling config (the Xenova card's
 * example uses mean pooling; see docs/dependencies.md), L2-normalized, query instruction prefix.
 */
export const BGE_SMALL: EmbedderModel = {
  id: 'Xenova/bge-small-en-v1.5',
  dimensions: 384,
  pooling: 'cls',
  queryPrefix: 'Represent this sentence for searching relevant passages: ',
};

/** Fallback if BGE cannot load. Changing models requires re-indexing (dimensions must match). */
export const MINILM: EmbedderModel = {
  id: 'Xenova/all-MiniLM-L6-v2',
  dimensions: 384,
  pooling: 'mean',
  queryPrefix: '',
};

/** Local embeddings with Transformers.js (dtype q8, CPU). */
export class TransformersEmbedder implements Embedder {
  readonly modelId: string;
  readonly dimensions: number;
  private extractor: Promise<FeatureExtractionPipeline> | null = null;

  constructor(
    private readonly model: EmbedderModel = BGE_SMALL,
    private readonly batchSize = 16,
  ) {
    this.modelId = model.id;
    this.dimensions = model.dimensions;
  }

  private load(): Promise<FeatureExtractionPipeline> {
    if (!this.extractor) {
      configureTransformers();
      this.extractor = pipeline('feature-extraction', this.model.id, {
        dtype: 'q8',
      }) as Promise<FeatureExtractionPipeline>;
    }
    return this.extractor;
  }

  private async embed(texts: string[]): Promise<number[][]> {
    const extractor = await this.load();
    const out: number[][] = [];
    for (let i = 0; i < texts.length; i += this.batchSize) {
      const batch = texts.slice(i, i + this.batchSize);
      const tensor = await extractor(batch, { pooling: this.model.pooling, normalize: true });
      out.push(...(tensor.tolist() as number[][]));
      tensor.dispose();
    }
    return out;
  }

  async embedQuery(text: string): Promise<number[]> {
    const [vector] = await this.embed([`${this.model.queryPrefix}${text}`]);
    return vector!;
  }

  embedPassages(texts: string[]): Promise<number[][]> {
    return this.embed(texts);
  }

  async close(): Promise<void> {
    if (this.extractor) await (await this.extractor).dispose();
    this.extractor = null;
  }
}

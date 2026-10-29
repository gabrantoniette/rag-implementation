import { AutoTokenizer } from '@huggingface/transformers';
import type { TokenCounter } from '../core/tokens.js';
import { configureTransformers } from './transformers-env.js';

export const DEFAULT_EMBEDDING_MODEL = 'Xenova/bge-small-en-v1.5';

/** Token counter backed by the embedding model's own tokenizer (special tokens excluded). */
export async function createModelTokenCounter(
  modelId = DEFAULT_EMBEDDING_MODEL,
): Promise<TokenCounter> {
  configureTransformers();
  const tokenizer = await AutoTokenizer.from_pretrained(modelId);
  return {
    count: (text: string) => tokenizer.encode(text, { add_special_tokens: false }).length,
  };
}

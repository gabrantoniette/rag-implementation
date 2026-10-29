import { env } from '@huggingface/transformers';
import { PATHS } from '../core/paths.js';

let configured = false;

/** Points the Transformers.js model cache inside the project folder (folder lock). Idempotent. */
export function configureTransformers(): void {
  if (configured) return;
  env.cacheDir = PATHS.transformersCache;
  env.allowLocalModels = true;
  env.allowRemoteModels = true;
  configured = true;
}

import { csvLoader } from './csv.js';
import { htmlLoader } from './html.js';
import { imageLoader } from './image.js';
import { jsonLoader } from './json.js';
import { markdownLoader } from './markdown.js';
import { mediaLoader } from './media.js';
import { officeLoader } from './office.js';
import { pdfLoader } from './pdf.js';
import { LoaderRegistry } from './registry.js';
import { subtitleLoader } from './subtitle.js';
import { textLoader } from './text.js';
import type { DocumentLoader } from './types.js';

export const CORE_LOADERS: DocumentLoader[] = [
  markdownLoader,
  textLoader,
  htmlLoader,
  csvLoader,
  jsonLoader,
  pdfLoader,
  subtitleLoader,
  officeLoader,
  imageLoader,
  mediaLoader,
];

export function createRegistry(
  maxBytes: number,
  loaders: DocumentLoader[] = CORE_LOADERS,
): LoaderRegistry {
  const registry = new LoaderRegistry({ maxBytes });
  for (const loader of loaders) registry.register(loader);
  return registry;
}

export { LoaderRegistry };

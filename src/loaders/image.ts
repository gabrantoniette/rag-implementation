import type { Section } from '../core/types.js';
import { baseTitle } from './registry.js';
import type { DocumentLoader } from './types.js';

/** Prefix that marks model-generated descriptions, so the answering model can tell them from source text. */
export const VISUAL_PREFIX = '[Visual description]';

/**
 * Images: a 'Text in image' section from OCR (low-confidence words dropped) and an
 * 'Image description' section from the captioner. Captions never identify people.
 * Supported types follow tesseract.js (bmp, jpg, png, webp).
 */
export const imageLoader: DocumentLoader = {
  name: 'image',
  extensions: ['.png', '.jpg', '.jpeg', '.bmp', '.webp'],
  async load(input, ctx) {
    const sections: Section[] = [];
    if (ctx.ocr) {
      const ocr = await ctx.ocr.recognize(input.bytes);
      if (ocr.text.trim()) {
        sections.push({
          path: ['Text in image'],
          text: ocr.text.trim(),
          locator: { kind: 'image' },
          modality: 'ocr',
          kind: 'prose',
        });
      }
    } else {
      ctx.logger.warn('No OCR engine configured; text in the image is not read', {
        uri: input.uri,
      });
    }
    if (ctx.captioner) {
      const caption = await ctx.captioner.caption(input.bytes);
      if (caption.trim()) {
        sections.push({
          path: ['Image description'],
          text: `${VISUAL_PREFIX} ${caption.trim()}`,
          locator: { kind: 'image' },
          modality: 'visual',
          kind: 'prose',
        });
      }
    } else {
      ctx.logger.warn('No image captioner available; the image is not described', {
        uri: input.uri,
      });
    }
    return {
      title: baseTitle(input.fileName),
      format: 'image',
      sections,
      metadata: { captioner: ctx.captioner?.name ?? 'none' },
    };
  },
};

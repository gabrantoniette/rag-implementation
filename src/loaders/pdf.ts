import { extractText, getDocumentProxy, renderPageAsImage } from 'unpdf';
import { CorruptDocumentError, EncryptedDocumentError } from '../core/errors.js';
import type { Section } from '../core/types.js';
import { baseTitle } from './registry.js';
import type { DocumentLoader } from './types.js';

/** Joins wrapped lines into paragraphs and undoes end-of-line hyphenation. */
export function tidyPageText(text: string): string {
  return text
    .replace(/-\n(?=[a-z])/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{2,}/g, '\u0000')
    .replace(/\n/g, ' ')
    .replace(/\u0000/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

function isPasswordError(error: unknown): boolean {
  const e = error as { name?: string; message?: string };
  return e?.name === 'PasswordException' || /password/i.test(e?.message ?? '');
}

/**
 * PDF: one section per page from the text layer. A page with fewer than ocrPageMinChars characters
 * is rendered (scale 2, @napi-rs/canvas) and OCRed when an OCR engine is available; such sections
 * have modality 'ocr' and the locator 'page n (OCR)'.
 */
export const pdfLoader: DocumentLoader = {
  name: 'pdf',
  extensions: ['.pdf'],
  async load(input, ctx) {
    // pdf.js may transfer (detach) the buffer it receives, so it gets a copy.
    let pdf: Awaited<ReturnType<typeof getDocumentProxy>>;
    try {
      pdf = await getDocumentProxy(new Uint8Array(input.bytes));
    } catch (error) {
      if (isPasswordError(error)) throw new EncryptedDocumentError(input.uri, { cause: error });
      throw new CorruptDocumentError(input.uri, (error as Error).message, { cause: error });
    }
    try {
      const { text: pages } = await extractText(pdf, { mergePages: false });
      const info = (await pdf.getMetadata().catch(() => null))?.info as
        { Title?: string } | undefined;
      const minChars = ctx.parameters.media.ocrPageMinChars;
      const sections: Section[] = [];
      let ocrPages = 0;
      for (const [i, raw] of pages.entries()) {
        const page = i + 1;
        const text = tidyPageText(raw);
        if (text.replace(/\s/g, '').length >= minChars) {
          sections.push({
            path: [],
            text,
            locator: { kind: 'page', page },
            modality: 'text',
            kind: 'prose',
          });
          continue;
        }
        if (!ctx.ocr) {
          ctx.logger.warn(`PDF page ${page} has no text layer and no OCR engine is configured`, {
            uri: input.uri,
          });
          continue;
        }
        const png = await renderPageAsImage(pdf, page, {
          canvasImport: () => import('@napi-rs/canvas'),
          scale: 2,
        });
        const ocr = await ctx.ocr.recognize(new Uint8Array(png));
        ocrPages++;
        if (ocr.text.trim()) {
          sections.push({
            path: [],
            text: ocr.text.trim(),
            locator: { kind: 'page', page, ocr: true },
            modality: 'ocr',
            kind: 'prose',
          });
        }
      }
      return {
        title: info?.Title?.trim() || baseTitle(input.fileName),
        format: 'pdf',
        sections,
        metadata: { pageCount: pages.length, ocrPages },
      };
    } finally {
      await pdf.loadingTask.destroy().catch(() => {});
    }
  },
};

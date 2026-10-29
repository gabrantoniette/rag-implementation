import { renderPageAsImage } from 'unpdf';
import { afterAll, describe, expect, it } from 'vitest';
import { createLogger } from '../../src/core/logger.js';
import { formatLocator } from '../../src/core/locator.js';
import { createRegistry } from '../../src/loaders/index.js';
import { VISUAL_PREFIX } from '../../src/loaders/image.js';
import { MockCaptioner, createCaptioner } from '../../src/vision/captioner.js';
import { MockOcr, TesseractOcr } from '../../src/vision/ocr.js';
import { loaderContext, writeFixture } from '../helpers/context.js';
import { drawScenePng, drawTextPng, drawTextRgb } from '../helpers/images.js';
import { makePdf } from '../helpers/pdf.js';

const registry = createRegistry(50 * 1024 * 1024);
const ocr = new TesseractOcr();
afterAll(() => ocr.close());

const words = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9.\s]/g, ' ')
    .split(/\s+/)
    .map((w) => w.replace(/\.$/, ''))
    .filter(Boolean);

const GOLD_LINES = [
  'Usain Bolt set the 100 metres world record of 9.58 seconds',
  'at the World Championships in Berlin in August 2009.',
];

describe('OCR and images', () => {
  it('OCR chain: page 1 of a text-layer PDF rendered to PNG is read back (>= 90% of gold words)', async () => {
    const pdf = makePdf([{ lines: GOLD_LINES }]);
    const png = await renderPageAsImage(pdf, 1, {
      canvasImport: () => import('@napi-rs/canvas'),
      scale: 2,
    });
    const result = await ocr.recognize(new Uint8Array(png));
    const found = new Set(words(result.text));
    const gold = words(GOLD_LINES.join(' '));
    const hits = gold.filter((w) => found.has(w)).length;
    expect(hits / gold.length).toBeGreaterThanOrEqual(0.9);
  });

  it('an image with drawn text yields a "Text in image" section with that text', async () => {
    const png = await drawTextPng(['Serena Williams won 23 Grand Slam singles titles.']);
    const captioner = new MockCaptioner('A white page with a line of black text.');
    const doc = await registry.loadFile(
      writeFixture('images', 'serena.png', png),
      loaderContext({ ocr, captioner }),
    );
    expect(doc.format).toBe('image');
    expect(doc.sections.map((s) => s.path)).toEqual([['Text in image'], ['Image description']]);
    expect(doc.sections[0]!.text).toContain('Serena Williams won 23 Grand Slam singles titles.');
    expect(doc.sections[0]!.modality).toBe('ocr');
    expect(doc.sections[1]!.text).toBe(`${VISUAL_PREFIX} A white page with a line of black text.`);
    expect(doc.sections[1]!.modality).toBe('visual');
    expect(formatLocator(doc.sections[0]!.locator)).toBe('image');
  });

  it('a PDF page without a text layer falls back to OCR (MockOcr)', async () => {
    const pdf = makePdf([
      { lines: ['This first page has a normal text layer with enough characters.'] },
      { image: drawTextRgb(['scanned page']) },
    ]);
    const mock = new MockOcr('Text recovered from the scanned page.');
    const doc = await registry.loadFile(
      writeFixture('images', 'mixed.pdf', pdf),
      loaderContext({ ocr: mock }),
    );
    expect(mock.calls).toBe(1);
    expect(doc.sections).toHaveLength(2);
    expect(doc.sections[0]!.modality).toBe('text');
    expect(doc.sections[1]!).toMatchObject({
      text: 'Text recovered from the scanned page.',
      modality: 'ocr',
      locator: { kind: 'page', page: 2, ocr: true },
    });
    expect(formatLocator(doc.sections[1]!.locator)).toBe('page 2 (OCR)');
    expect(doc.metadata.ocrPages).toBe(1);
  });

  it('a scanned PDF page is read by real tesseract', async () => {
    const pdf = makePdf([{ image: drawTextRgb(GOLD_LINES, { fontSize: 40 }) }]);
    const doc = await registry.loadFile(
      writeFixture('images', 'scanned.pdf', pdf),
      loaderContext({ ocr }),
    );
    expect(doc.sections).toHaveLength(1);
    expect(doc.sections[0]!.locator).toEqual({ kind: 'page', page: 1, ocr: true });
    const found = new Set(words(doc.sections[0]!.text));
    const gold = words(GOLD_LINES.join(' '));
    expect(gold.filter((w) => found.has(w)).length / gold.length).toBeGreaterThanOrEqual(0.9);
  });

  // Florence-2 (~357 MB) and ViT-GPT2 (~246 MB) are not downloaded in CI.
  it.skipIf(process.env.CI)(
    'caption check (structural only): a non-empty description',
    async () => {
      const scene = await drawScenePng();
      const captioner = await createCaptioner(createLogger({ level: 'error' }), scene);
      expect(captioner, 'no captioner could run on this machine').not.toBeNull();
      const caption = await captioner!.caption(scene);
      expect(caption.trim().length).toBeGreaterThan(0);
      await captioner!.close();
    },
  );
});

import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { type Worker, createWorker } from 'tesseract.js';
import { PATHS } from '../core/paths.js';
import type { OcrEngine, OcrResult, OcrWord } from './types.js';

interface BlockTree {
  paragraphs?: { lines?: { words?: { text: string; confidence: number }[] }[] }[];
}

/**
 * tesseract.js with English data. The traineddata is downloaded once and cached in
 * .cache/tesseract (cachePath); later runs read it from there (langPath) without network.
 * One reusable worker; close() terminates it. Words below minConfidence are dropped.
 */
export class TesseractOcr implements OcrEngine {
  private worker: Promise<Worker> | null = null;

  constructor(
    private readonly minConfidence = 60,
    private readonly cacheDir = PATHS.tesseractCache,
  ) {}

  private load(): Promise<Worker> {
    if (!this.worker) {
      mkdirSync(this.cacheDir, { recursive: true });
      const cached = ['eng.traineddata', 'eng.traineddata.gz'].some((f) =>
        existsSync(path.join(this.cacheDir, f)),
      );
      this.worker = createWorker('eng', 1, {
        cachePath: this.cacheDir,
        ...(cached ? { langPath: this.cacheDir } : {}),
      });
    }
    return this.worker;
  }

  async recognize(image: Uint8Array): Promise<OcrResult> {
    const worker = await this.load();
    const { data } = await worker.recognize(Buffer.from(image), {}, { text: true, blocks: true });
    const blocks = (data as unknown as { blocks?: BlockTree[] | null }).blocks ?? [];
    const words: OcrWord[] = [];
    const lines: string[] = [];
    for (const block of blocks) {
      for (const paragraph of block.paragraphs ?? []) {
        for (const line of paragraph.lines ?? []) {
          const kept: string[] = [];
          for (const w of line.words ?? []) {
            const text = w.text.trim();
            if (!text) continue;
            words.push({ text, confidence: w.confidence });
            if (w.confidence >= this.minConfidence) kept.push(text);
          }
          if (kept.length > 0) lines.push(kept.join(' '));
        }
        lines.push('');
      }
    }
    const confidence =
      words.length > 0 ? words.reduce((s, w) => s + w.confidence, 0) / words.length : 0;
    return {
      text: lines
        .join('\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim(),
      confidence,
      words,
    };
  }

  async close(): Promise<void> {
    if (this.worker) await (await this.worker).terminate();
    this.worker = null;
  }
}

/** Deterministic OCR for unit tests: returns the configured text for every image. */
export class MockOcr implements OcrEngine {
  calls = 0;
  constructor(private readonly text = 'mock ocr text') {}
  async recognize(): Promise<OcrResult> {
    this.calls++;
    const words = this.text
      .split(/\s+/)
      .filter(Boolean)
      .map((t) => ({ text: t, confidence: 95 }));
    return { text: this.text, confidence: 95, words };
  }
  async close(): Promise<void> {}
}

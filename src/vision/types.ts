export interface OcrWord {
  text: string;
  confidence: number;
}

export interface OcrResult {
  /** Text built from words at or above the confidence threshold, line breaks preserved. */
  text: string;
  /** Mean confidence of all recognized words (0-100). */
  confidence: number;
  words: OcrWord[];
}

/** Optical character recognition (English). Images are PNG/JPEG/BMP/WebP bytes. */
export interface OcrEngine {
  recognize(image: Uint8Array): Promise<OcrResult>;
  close(): Promise<void>;
}

/** Model-generated description of an image. Never identifies people. */
export interface ImageCaptioner {
  readonly name: string;
  caption(image: Uint8Array): Promise<string>;
  close(): Promise<void>;
}

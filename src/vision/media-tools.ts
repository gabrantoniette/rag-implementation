/** A decoded video frame (PNG bytes) with its timestamp. */
export interface VideoFrame {
  timeSec: number;
  png: Uint8Array;
}

export interface FrameExtractionOptions {
  sceneThreshold: number;
  minIntervalSeconds: number;
  frameMaxWidth: number;
  maxFrames: number;
}

/** Thin wrapper over an external ffmpeg binary. */
export interface MediaTools {
  readonly ffmpegPath: string;
  /** Decodes any audio or video file to 16 kHz mono float32 PCM samples. */
  decodeAudio(filePath: string): Promise<Float32Array>;
  /** Scene-change keyframes plus at least one frame every minIntervalSeconds. */
  extractFrames(filePath: string, options: FrameExtractionOptions): Promise<VideoFrame[]>;
}

export interface TranscriptSegment {
  text: string;
  startSec: number;
  endSec: number;
}

/** Speech to text with timestamps (English). */
export interface SpeechRecognizer {
  transcribe(samples: Float32Array, sampleRate: number): Promise<TranscriptSegment[]>;
}

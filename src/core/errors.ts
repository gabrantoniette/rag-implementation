/** Base class so callers can tell this project's typed errors from unexpected ones. */
export class RagError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = new.target.name;
  }
}

export class ConfigError extends RagError {}

export class UnsupportedFormatError extends RagError {
  constructor(
    readonly extension: string,
    readonly supported: readonly string[],
  ) {
    super(
      `Unsupported format '${extension || '(none)'}'. Supported extensions: ${supported.join(', ')}`,
    );
  }
}

export class FileTooLargeError extends RagError {
  constructor(
    readonly sizeBytes: number,
    readonly limitBytes: number,
  ) {
    super(`File is ${sizeBytes} bytes; the limit is ${limitBytes} bytes.`);
  }
}

export class EmptyDocumentError extends RagError {
  constructor(readonly uri: string) {
    super(`No extractable text in '${uri}'.`);
  }
}

export class EncryptedDocumentError extends RagError {
  constructor(
    readonly uri: string,
    options?: { cause?: unknown },
  ) {
    super(`'${uri}' is encrypted or password-protected; it cannot be read.`, options);
  }
}

export class CorruptDocumentError extends RagError {
  constructor(
    readonly uri: string,
    detail: string,
    options?: { cause?: unknown },
  ) {
    super(`'${uri}' could not be parsed: ${detail}`, options);
  }
}

export class ArchiveLimitError extends RagError {
  constructor(
    readonly uri: string,
    detail: string,
    options?: { cause?: unknown },
  ) {
    super(`'${uri}' exceeds the archive safety limits: ${detail}`, options);
  }
}

export class MediaToolMissingError extends RagError {
  constructor(readonly tool: string) {
    super(
      `${tool} was not found on PATH or in FFMPEG_PATH. Audio and video need it. ` +
        `Install it (Windows: 'winget install Gyan.FFmpeg'; macOS: 'brew install ffmpeg'; ` +
        `Debian/Ubuntu: 'sudo apt install ffmpeg') or set FFMPEG_PATH in .env.`,
    );
  }
}

export class ConflictError extends RagError {
  constructor(readonly id: string) {
    super(`A document with id '${id}' already exists.`);
  }
}

export class NotFoundError extends RagError {
  constructor(readonly id: string) {
    super(`No document with id '${id}'.`);
  }
}

export class PromptBuildError extends RagError {}

export class ModelNotAllowedError extends RagError {
  constructor(readonly model: string) {
    super(`Model '${model}' is not on the free-model allowlist; the request was not sent.`);
  }
}

export class QuotaExceededError extends RagError {}

export class LlmHttpError extends RagError {
  constructor(
    readonly status: number,
    detail: string,
  ) {
    super(`OpenRouter returned HTTP ${status}: ${detail}`);
  }
}

export class FetchBlockedError extends RagError {}

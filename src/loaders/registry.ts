import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import {
  CorruptDocumentError,
  EmptyDocumentError,
  EncryptedDocumentError,
  FileTooLargeError,
  UnsupportedFormatError,
} from '../core/errors.js';
import { defaultDocumentId, normalizeUri, sha256 } from '../core/hash.js';
import type { ParsedDocument, Section } from '../core/types.js';
import type { DocumentLoader, LoadedContent, LoaderContext, LoaderInput } from './types.js';

const OFFICE_EXTENSIONS = new Set(['.docx', '.xlsx', '.pptx']);

function startsWith(bytes: Uint8Array, signature: number[], offset = 0): boolean {
  return signature.every((b, i) => bytes[offset + i] === b);
}

/** PDF: '%PDF-' within the first 1024 bytes (some writers prepend junk). */
function looksLikePdf(bytes: Uint8Array): boolean {
  const head = Buffer.from(bytes.subarray(0, 1024)).toString('latin1');
  return head.includes('%PDF-');
}

/** ZIP local file header: 'PK\x03\x04'. */
function looksLikeZip(bytes: Uint8Array): boolean {
  return startsWith(bytes, [0x50, 0x4b, 0x03, 0x04]);
}

/** UTF-8 decode with the BOM stripped and line endings normalized to \n. */
export function decodeText(bytes: Uint8Array): string {
  return new TextDecoder('utf-8').decode(bytes).replace(/\r\n?/g, '\n');
}

export function contentHashOf(content: Pick<LoadedContent, 'title' | 'sections'>): string {
  return sha256(
    JSON.stringify({
      title: content.title,
      sections: content.sections.map((s: Section) => [s.path, s.text, s.locator, s.modality]),
    }),
  );
}

export interface RegistryOptions {
  maxBytes: number;
}

/** Loaders keyed by extension. Adding a format means one loader file and one register() call. */
export class LoaderRegistry {
  private readonly loaders = new Map<string, DocumentLoader>();

  constructor(private readonly options: RegistryOptions) {}

  register(loader: DocumentLoader): this {
    for (const ext of loader.extensions) this.loaders.set(ext.toLowerCase(), loader);
    return this;
  }

  supportedExtensions(): string[] {
    return [...this.loaders.keys()].sort();
  }

  /** Longest registered suffix of the file name (so '.wikipedia.html' wins over '.html'). */
  extensionOf(fileName: string): string {
    const name = fileName.toLowerCase();
    const match = [...this.loaders.keys()]
      .filter((ext) => name.endsWith(ext))
      .sort((a, b) => b.length - a.length)[0];
    return match ?? path.extname(name);
  }

  loaderFor(extension: string): DocumentLoader {
    const loader = this.loaders.get(extension.toLowerCase());
    if (!loader) throw new UnsupportedFormatError(extension, this.supportedExtensions());
    return loader;
  }

  async loadFile(
    filePath: string,
    ctx: LoaderContext,
    overrides: { title?: string } = {},
  ): Promise<ParsedDocument> {
    const abs = path.resolve(filePath);
    const extension = this.extensionOf(path.basename(abs));
    this.loaderFor(extension);
    const info = await stat(abs);
    if (info.size > this.options.maxBytes)
      throw new FileTooLargeError(info.size, this.options.maxBytes);
    const bytes = new Uint8Array(await readFile(abs));
    return this.loadBytes(
      {
        bytes,
        uri: normalizeUri(abs),
        fileName: path.basename(abs),
        extension,
        path: abs,
        ...overrides,
      },
      ctx,
    );
  }

  async loadBytes(input: LoaderInput, ctx: LoaderContext): Promise<ParsedDocument> {
    const loader = this.loaderFor(input.extension);
    if (input.bytes.byteLength > this.options.maxBytes) {
      throw new FileTooLargeError(input.bytes.byteLength, this.options.maxBytes);
    }
    if (input.bytes.byteLength === 0) throw new EmptyDocumentError(input.uri);
    if (input.extension === '.pdf' && !looksLikePdf(input.bytes)) {
      throw new CorruptDocumentError(input.uri, 'missing %PDF- signature');
    }
    if (OFFICE_EXTENSIONS.has(input.extension) && !looksLikeZip(input.bytes)) {
      // Password-protected OOXML files are stored inside an OLE compound file (D0 CF 11 E0).
      if (startsWith(input.bytes, [0xd0, 0xcf, 0x11, 0xe0]))
        throw new EncryptedDocumentError(input.uri);
      throw new CorruptDocumentError(input.uri, 'not a ZIP-based Office file');
    }
    const content = await loader.load(input, ctx);
    const sections = content.sections.filter((s) => s.text.trim().length > 0);
    if (sections.length === 0) throw new EmptyDocumentError(input.uri);
    const title = input.title ?? content.title;
    return {
      id: defaultDocumentId(input.uri),
      title,
      uri: input.uri,
      format: content.format,
      contentHash: contentHashOf({ title, sections }),
      sections,
      metadata: content.metadata ?? {},
      links: content.links ?? [],
    };
  }

  /** Text sources (CRUD { text, format, title }): `format` is an extension such as 'md' or '.csv'. */
  async loadText(
    text: string,
    format: string,
    title: string,
    uri: string,
    ctx: LoaderContext,
  ): Promise<ParsedDocument> {
    const extension = format.startsWith('.') ? format.toLowerCase() : `.${format.toLowerCase()}`;
    return this.loadBytes(
      {
        bytes: new TextEncoder().encode(text),
        uri,
        fileName: `${title}${extension}`,
        extension,
        title,
      },
      ctx,
    );
  }
}

/** File name without extension, used as the default title. */
export function baseTitle(fileName: string): string {
  return path.basename(fileName, path.extname(fileName));
}

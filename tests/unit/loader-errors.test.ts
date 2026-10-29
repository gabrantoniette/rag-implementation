import { describe, expect, it } from 'vitest';
import {
  CorruptDocumentError,
  EmptyDocumentError,
  EncryptedDocumentError,
  FileTooLargeError,
  UnsupportedFormatError,
} from '../../src/core/errors.js';
import { createRegistry } from '../../src/loaders/index.js';
import { loaderContext, writeFixture } from '../helpers/context.js';
import { makePdf } from '../helpers/pdf.js';

const ctx = loaderContext();

describe('loader typed errors', () => {
  it('unsupported extension lists the supported ones', async () => {
    const registry = createRegistry(1024 * 1024);
    const file = writeFixture('errors', 'legacy.doc', 'old word file');
    const error = await registry.loadFile(file, ctx).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(UnsupportedFormatError);
    expect((error as UnsupportedFormatError).supported).toContain('.pdf');
    expect((error as Error).message).toMatch(/\.md.*\.txt|\.txt/);
  });

  it('oversize file throws FileTooLargeError before parsing', async () => {
    const registry = createRegistry(100);
    const file = writeFixture('errors', 'big.txt', 'x'.repeat(101));
    await expect(registry.loadFile(file, ctx)).rejects.toBeInstanceOf(FileTooLargeError);
  });

  it('empty file and whitespace-only file throw EmptyDocumentError', async () => {
    const registry = createRegistry(1024);
    await expect(
      registry.loadFile(writeFixture('errors', 'empty.txt', ''), ctx),
    ).rejects.toBeInstanceOf(EmptyDocumentError);
    await expect(
      registry.loadFile(writeFixture('errors', 'blank.md', '\n   \n\t\n'), ctx),
    ).rejects.toBeInstanceOf(EmptyDocumentError);
  });

  it('encrypted PDF throws EncryptedDocumentError', async () => {
    const registry = createRegistry(1024 * 1024);
    const file = writeFixture(
      'errors',
      'locked.pdf',
      makePdf([{ lines: ['secret'] }], { encrypted: true }),
    );
    await expect(registry.loadFile(file, ctx)).rejects.toBeInstanceOf(EncryptedDocumentError);
  });

  it('a file whose bytes do not match its extension throws CorruptDocumentError', async () => {
    const registry = createRegistry(1024 * 1024);
    const file = writeFixture('errors', 'fake.pdf', 'this is not a pdf at all');
    await expect(registry.loadFile(file, ctx)).rejects.toBeInstanceOf(CorruptDocumentError);
  });
});

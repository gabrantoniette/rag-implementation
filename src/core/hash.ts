import { createHash } from 'node:crypto';
import path from 'node:path';

export function sha1(text: string): string {
  return createHash('sha1').update(text, 'utf8').digest('hex');
}

export function sha256(text: string | Uint8Array): string {
  const h = createHash('sha256');
  if (typeof text === 'string') h.update(text, 'utf8');
  else h.update(text);
  return h.digest('hex');
}

/**
 * Normalizes a source location so the same source always maps to the same document id:
 * URLs lose their fragment and trailing slash; file paths become absolute with forward slashes
 * (lower-cased on Windows, where paths are case-insensitive).
 */
export function normalizeUri(uri: string): string {
  if (/^https?:\/\//i.test(uri)) {
    const u = new URL(uri);
    u.hash = '';
    u.hostname = u.hostname.toLowerCase();
    return u.toString().replace(/\/$/, '');
  }
  const abs = path.resolve(uri).split(path.sep).join('/');
  return process.platform === 'win32' ? abs.toLowerCase() : abs;
}

export function defaultDocumentId(uri: string): string {
  return sha1(normalizeUri(uri));
}

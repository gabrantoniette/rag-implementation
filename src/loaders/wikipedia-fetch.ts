import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { APP_URL } from '../config/app-info.js';
import { ConfigError, FetchBlockedError } from '../core/errors.js';
import { WIKIPEDIA_EXTENSION } from './wikipedia.js';

export const CorpusEntrySchema = z.object({
  title: z.string().min(1),
  sport: z.string().min(1),
  reason: z.string().min(1),
});
export const CorpusSchema = z.array(CorpusEntrySchema).min(1);
export type CorpusEntry = z.infer<typeof CorpusEntrySchema>;

export interface ArticleMeta {
  title: string;
  key: string;
  url: string;
  revid: number;
  retrieved_at: string;
  license: string;
  pageId: number;
}

/** Wikimedia User-Agent policy: client name/version, contact information, library. */
export function wikimediaUserAgent(contact: string): string {
  if (!contact.trim()) {
    throw new ConfigError(
      'WIKIMEDIA_CONTACT is empty. Set it in .env (a URL or email address where Wikimedia can reach ' +
        'you) before fetching; see https://meta.wikimedia.org/wiki/User-Agent_policy',
    );
  }
  return `rag-implementation/0.1.0 (${APP_URL}; ${contact.trim()}) node/${process.versions.node}`;
}

/** File-system-safe base name for an article key. */
export function rawBaseName(key: string): string {
  return key.replace(/[\\/:*?"<>|]/g, '_');
}

export function rawPaths(rawDir: string, key: string) {
  const base = path.join(rawDir, rawBaseName(key));
  return { html: `${base}${WIKIPEDIA_EXTENSION}`, meta: `${base}.meta.json` };
}

/**
 * One article through the MediaWiki REST API (GET /w/rest.php/v1/page/{title}/with_html), which
 * returns the HTML, the latest revision id and the license in a single request.
 * HTTP 429 or 403 raises FetchBlockedError: the caller must stop, not retry around the limit.
 */
export async function fetchArticle(
  title: string,
  userAgent: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ html: string; meta: ArticleMeta }> {
  const slug = encodeURIComponent(title.replace(/ /g, '_'));
  const url = `https://en.wikipedia.org/w/rest.php/v1/page/${slug}/with_html`;
  const response = await fetchImpl(url, {
    headers: { 'User-Agent': userAgent, 'Api-User-Agent': userAgent, Accept: 'application/json' },
  });
  if (response.status === 429 || response.status === 403) {
    throw new FetchBlockedError(
      `Wikipedia answered HTTP ${response.status} for '${title}'. Fetching stopped; do not retry ` +
        'around the limit.',
    );
  }
  if (!response.ok) throw new Error(`HTTP ${response.status} for '${title}'`);
  const json = (await response.json()) as {
    id: number;
    key: string;
    title: string;
    latest: { id: number; timestamp: string };
    license: { url: string; title: string };
    html: string;
  };
  return {
    html: json.html,
    meta: {
      title: json.title,
      key: json.key,
      url: `https://en.wikipedia.org/wiki/${json.key}`,
      revid: json.latest.id,
      retrieved_at: new Date().toISOString(),
      license: `${json.license.title} (${json.license.url})`,
      pageId: json.id,
    },
  };
}

export function saveArticle(rawDir: string, html: string, meta: ArticleMeta): string {
  mkdirSync(rawDir, { recursive: true });
  const paths = rawPaths(rawDir, meta.key);
  writeFileSync(paths.html, html, 'utf8');
  writeFileSync(paths.meta, `${JSON.stringify(meta, null, 2)}\n`, 'utf8');
  return paths.html;
}

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { FetchBlockedError } from '../../src/core/errors.js';
import { defaultDocumentId } from '../../src/core/hash.js';
import { projectPath } from '../../src/core/paths.js';
import { createRegistry } from '../../src/loaders/index.js';
import { articleTitleFromHref } from '../../src/loaders/wikipedia.js';
import { fetchArticle, wikimediaUserAgent } from '../../src/loaders/wikipedia-fetch.js';
import { loaderContext, writeFixture } from '../helpers/context.js';

const FIXTURE = projectPath('tests', 'fixtures', 'wikipedia', 'Sample_athlete.wikipedia.html');
const registry = createRegistry(50 * 1024 * 1024);
const ctx = loaderContext();

describe('Wikipedia loader (saved HTML fixture)', () => {
  it('keeps article links and excludes file, category, help, reference, navbox and red links', async () => {
    const doc = await registry.loadFile(FIXTURE, ctx);
    expect(doc.format).toBe('wikipedia-html');
    expect(doc.title).toBe('Sample athlete');
    expect(doc.links).toEqual([
      'Tennis',
      'Wimbledon Championships',
      'Australian Open',
      'Basel',
      'Peter Carter (tennis)',
      'Rival player',
    ]);
    const all = JSON.stringify(doc);
    for (const excluded of [
      'Sample painter', // hatnote
      'Reference only link',
      'Navbox only link',
      'External section link',
      'Nonexistent coach',
      'Category:',
      'Help:',
      'File:',
    ]) {
      expect(doc.links.join('|')).not.toContain(excluded);
      expect(all.includes(`"target":"${excluded}`)).toBe(false);
    }
  });

  it('splits by heading path, drops reference sections and keeps the infobox as its own section', async () => {
    const doc = await registry.loadFile(FIXTURE, ctx);
    expect(doc.sections.map((s) => s.path)).toEqual([
      [],
      ['Infobox'],
      ['Career', 'Early years'],
      ['Legacy'],
    ]);
    expect(doc.sections[0]!.text).toContain('won the Wimbledon Championships three times.');
    expect(doc.sections[0]!.text).not.toContain('[1]');
    expect(doc.sections[1]!.text).toBe('Born: 1 May 1990 Basel\n\nSport: Tennis');
    expect(doc.sections[2]!.links).toEqual([
      { anchor: 'Basel', target: 'Basel' },
      { anchor: 'Peter Carter', target: 'Peter Carter (tennis)' },
    ]);
    expect(JSON.stringify(doc.sections)).not.toMatch(/References|External section link/);
  });

  it('uses the canonical article URL and revision metadata from the sidecar meta file', async () => {
    const html = readFileSync(FIXTURE);
    const file = writeFixture('wikipedia', 'Sample_athlete.wikipedia.html', html);
    writeFixture(
      'wikipedia',
      'Sample_athlete.meta.json',
      JSON.stringify({
        title: 'Sample athlete',
        url: 'https://en.wikipedia.org/wiki/Sample_athlete',
        revid: 123456,
        retrieved_at: '2026-10-29T00:00:00.000Z',
        license:
          'Creative Commons Attribution-Share Alike 4.0 (https://creativecommons.org/licenses/by-sa/4.0/)',
      }),
    );
    const doc = await registry.loadFile(file, ctx);
    expect(doc.uri).toBe('https://en.wikipedia.org/wiki/Sample_athlete');
    expect(doc.id).toBe(defaultDocumentId('https://en.wikipedia.org/wiki/Sample_athlete'));
    expect(doc.metadata.revid).toBe(123456);
    expect(String(doc.metadata.license)).toMatch(/Share Alike 4\.0/);
  });

  it('parses article titles from hrefs and rejects other namespaces', () => {
    expect(articleTitleFromHref('./Roger_Federer')).toBe('Roger Federer');
    expect(articleTitleFromHref('/wiki/Pel%C3%A9#Career')).toBe('Pelé');
    expect(articleTitleFromHref('./Star_Wars:_Episode_IV')).toBe('Star Wars: Episode IV');
    expect(articleTitleFromHref('./Template:Infobox_tennis')).toBeNull();
    expect(articleTitleFromHref('./Template_talk:Infobox')).toBeNull();
    expect(articleTitleFromHref('https://example.org/x')).toBeNull();
  });
});

describe('Wikipedia fetch (no network)', () => {
  it('refuses to build a User-Agent without a contact', () => {
    expect(() => wikimediaUserAgent('')).toThrow(/WIKIMEDIA_CONTACT/);
    expect(wikimediaUserAgent('ops@example.org')).toMatch(
      /^rag-implementation\/0\.1\.0 \(https:\/\/github\.com\/gabrantoniette\/rag-implementation; ops@example\.org\)/,
    );
  });

  it('stops on HTTP 429 instead of retrying around the limit', async () => {
    const fake = (async () => new Response('slow down', { status: 429 })) as typeof fetch;
    await expect(fetchArticle('Tennis', 'ua', fake)).rejects.toBeInstanceOf(FetchBlockedError);
  });

  it('sends the User-Agent and maps the REST response to metadata', async () => {
    let seen: Headers | undefined;
    const fake = (async (_url: string, init?: RequestInit) => {
      seen = new Headers(init?.headers);
      return Response.json({
        id: 1,
        key: 'Tennis',
        title: 'Tennis',
        latest: { id: 999, timestamp: '2026-10-01T00:00:00Z' },
        license: { url: 'https://creativecommons.org/licenses/by-sa/4.0/', title: 'CC BY-SA 4.0' },
        html: '<html><body><p>x</p></body></html>',
      });
    }) as typeof fetch;
    const { meta } = await fetchArticle('Tennis', 'test-agent/1.0 (contact)', fake);
    expect(seen?.get('User-Agent')).toBe('test-agent/1.0 (contact)');
    expect(meta).toMatchObject({ revid: 999, url: 'https://en.wikipedia.org/wiki/Tennis' });
  });
});

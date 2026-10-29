import { existsSync, readFileSync } from 'node:fs';
import * as cheerio from 'cheerio';
import type { MetadataValue, Section, WikiLink } from '../core/types.js';
import { type Element, htmlSections } from './html-walk.js';
import { baseTitle, decodeText } from './registry.js';
import type { DocumentLoader } from './types.js';

export const WIKIPEDIA_EXTENSION = '.wikipedia.html';

/** Sections dropped from Wikipedia articles (reference apparatus, not article prose). */
export const DROPPED_WIKI_SECTIONS = [
  'References',
  'External links',
  'See also',
  'Notes',
  'Further reading',
  'Citations',
  'Sources',
  'Bibliography',
  'Footnotes',
  'Explanatory notes',
  'General and cited sources',
];

/** Elements removed before walking: references, navigation boxes, maintenance templates. */
export const WIKI_DROP = [
  'script',
  'style',
  'link',
  'meta',
  'noscript',
  'sup.reference',
  '.mw-ref',
  '.reference',
  'ol.references',
  '.mw-references-wrap',
  '.reflist',
  '.navbox',
  '.navbox-styles',
  '.vertical-navbox',
  '.sidebar',
  'table.sidebar',
  '.navbox-inner',
  '.mw-editsection',
  '.metadata',
  '.noprint',
  '.ambox',
  '.sistersitebox',
  '.portalbox',
  '.authority-control',
  '.shortdescription',
  '.mw-empty-elt',
  '.mwe-math-mathml-a11y',
  '.hatnote',
  '.mw-cite-backlink',
  'figure img',
  '.infobox',
];

/** Non-article namespaces whose links are ignored. */
const NAMESPACES = new Set(
  [
    'file',
    'image',
    'media',
    'category',
    'help',
    'template',
    'wikipedia',
    'wp',
    'portal',
    'special',
    'talk',
    'module',
    'draft',
    'user',
    'mediawiki',
    'timedtext',
    'book',
    'wikt',
    'wiktionary',
    'project',
  ].flatMap((n) => [n, `${n} talk`]),
);

/** Article title from a Parsoid ('./Title') or classic ('/wiki/Title') href; null otherwise. */
export function articleTitleFromHref(href: string): string | null {
  const m = href.match(/^(?:\.\/|\/wiki\/|https?:\/\/en\.wikipedia\.org\/wiki\/)([^?#]+)/);
  if (!m) return null;
  let title: string;
  try {
    title = decodeURIComponent(m[1]!).replace(/_/g, ' ').trim();
  } catch {
    return null;
  }
  const colon = title.indexOf(':');
  if (colon > 0 && NAMESPACES.has(title.slice(0, colon).toLowerCase())) return null;
  return title || null;
}

function linkOf(a: Element): WikiLink | null {
  const attribs = a.attribs ?? {};
  const rel = attribs.rel ?? '';
  const href = attribs.href ?? '';
  if (rel && !rel.includes('mw:WikiLink')) return null; // external, interwiki, media links
  if ((attribs.class ?? '').split(/\s+/).includes('new')) return null; // red link
  const target = articleTitleFromHref(href);
  if (!target) return null;
  const anchor = cheerio.load(a).text().replace(/\s+/g, ' ').trim();
  return anchor ? { anchor, target } : null;
}

/** Infobox rows as 'label: value' paragraphs (kept as its own section). */
function infoboxSection($: cheerio.CheerioAPI): Section | null {
  const box = $('table.infobox').first();
  if (box.length === 0) return null;
  const rows: string[] = [];
  const links: WikiLink[] = [];
  box.find('tr').each((_, tr) => {
    const label = $(tr).children('th').first().text().replace(/\s+/g, ' ').trim();
    const value = $(tr).children('td').first().text().replace(/\s+/g, ' ').trim();
    if (label && value) rows.push(`${label}: ${value}`);
    $(tr)
      .find('a')
      .each((__, a) => {
        const link = linkOf(a as Element);
        if (link) links.push(link);
      });
  });
  if (rows.length === 0) return null;
  return {
    path: ['Infobox'],
    text: rows.join('\n\n'),
    locator: { kind: 'heading', path: ['Infobox'] },
    modality: 'text',
    kind: 'prose',
    links,
  };
}

interface WikiMeta {
  title?: string;
  url?: string;
  revid?: number;
  retrieved_at?: string;
  license?: string;
  pageId?: number;
}

function readMeta(path?: string): WikiMeta {
  if (!path) return {};
  const metaPath = path.slice(0, -WIKIPEDIA_EXTENSION.length) + '.meta.json';
  return existsSync(metaPath) ? (JSON.parse(readFileSync(metaPath, 'utf8')) as WikiMeta) : {};
}

/**
 * Wikipedia article HTML (MediaWiki REST, Parsoid). Sections follow the article headings,
 * reference sections and navigation boxes are dropped, and every section keeps its hyperlinks
 * (anchor text and target title) for WikiLinkExtractor. The canonical article URL is the
 * document uri, so the same article always maps to the same id.
 */
export const wikipediaLoader: DocumentLoader = {
  name: 'wikipedia',
  extensions: [WIKIPEDIA_EXTENSION],
  async load(input) {
    const meta = readMeta(input.path);
    const $ = cheerio.load(decodeText(input.bytes));
    const infobox = infoboxSection($);
    const body = $('body').get(0);
    const { sections, firstH1 } = body
      ? htmlSections($, body, { drop: WIKI_DROP, dropSectionTitles: DROPPED_WIKI_SECTIONS, linkOf })
      : { sections: [], firstH1: undefined };
    const title =
      meta.title || $('head > title').first().text().trim() || firstH1 || baseTitle(input.fileName);
    const all = infobox ? [sections[0], infobox, ...sections.slice(1)].filter(Boolean) : sections;
    const links = [...new Set(all.flatMap((s) => (s!.links ?? []).map((l) => l.target)))].filter(
      (t) => t !== title,
    );
    const metadata: Record<string, MetadataValue> = {};
    if (meta.revid !== undefined) metadata.revid = meta.revid;
    if (meta.license) metadata.license = meta.license;
    if (meta.retrieved_at) metadata.retrievedAt = meta.retrieved_at;
    if (meta.url) metadata.url = meta.url;
    return {
      title,
      format: 'wikipedia-html',
      sections: all as Section[],
      links,
      metadata,
      ...(meta.url ? { uri: meta.url } : {}),
    };
  },
};

/** Words of prose after reference sections and boilerplate were removed. */
export function wordCount(sections: Section[]): number {
  return sections.reduce((n, s) => n + (s.text.match(/\S+/g)?.length ?? 0), 0);
}

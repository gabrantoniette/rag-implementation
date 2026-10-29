import type { Cheerio, CheerioAPI } from 'cheerio';
import type { contains } from 'cheerio';

/** DOM node and element types, derived from cheerio (domhandler is not a direct dependency). */
export type AnyNode = Parameters<typeof contains>[0];
export type Element = ReturnType<Cheerio<AnyNode>['children']> extends Cheerio<infer E> ? E : never;
import type { Section, WikiLink } from '../core/types.js';

const BLOCK_TAGS = new Set([
  'address',
  'article',
  'aside',
  'blockquote',
  'body',
  'caption',
  'dd',
  'details',
  'dialog',
  'div',
  'dl',
  'dt',
  'fieldset',
  'figcaption',
  'figure',
  'footer',
  'form',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'header',
  'hr',
  'html',
  'li',
  'main',
  'nav',
  'ol',
  'p',
  'pre',
  'section',
  'summary',
  'table',
  'tbody',
  'td',
  'tfoot',
  'th',
  'thead',
  'tr',
  'ul',
]);

export interface HtmlWalkOptions {
  /** Elements removed before walking (scripts, navigation, references...). */
  drop: string[];
  /** Headings whose whole section is skipped (case-insensitive exact match). */
  dropSectionTitles?: string[];
  /** Turns an anchor into a link record; return null to ignore it. */
  linkOf?: (anchor: Element) => WikiLink | null;
  /** The first <h1> is the document title rather than a section level (default true). */
  firstH1IsTitle?: boolean;
}

const collapse = (s: string) => s.replace(/\s+/g, ' ').trim();

/** Walks an HTML body in document order and returns sections split by heading path. */
export function htmlSections(
  $: CheerioAPI,
  root: AnyNode,
  options: HtmlWalkOptions,
): { sections: Section[]; firstH1?: string } {
  for (const selector of options.drop) $(selector).remove();
  const dropTitles = new Set((options.dropSectionTitles ?? []).map((t) => t.toLowerCase()));
  const sections: Section[] = [];
  const stack: { level: number; title: string }[] = [];
  let paragraphs: string[] = [];
  let links: WikiLink[] = [];
  let inline: string[] = [];
  let skipLevel: number | null = null;
  let firstH1: string | undefined;

  const collectLinks = (el: AnyNode) => {
    if (!options.linkOf || skipLevel !== null) return;
    for (const a of $(el).find('a').addBack('a').toArray()) {
      const link = options.linkOf(a as Element);
      if (link) links.push(link);
    }
  };
  const flushInline = () => {
    const text = collapse(inline.join(' '));
    if (text && skipLevel === null) paragraphs.push(text);
    inline = [];
  };
  const flushSection = () => {
    flushInline();
    const text = paragraphs.join('\n\n').trim();
    if (text && skipLevel === null) {
      const path = stack.map((h) => h.title);
      sections.push({
        path,
        text,
        locator: { kind: 'heading', path },
        modality: 'text',
        kind: 'prose',
        ...(options.linkOf ? { links } : {}),
      });
    }
    paragraphs = [];
    links = [];
  };
  const hasBlockChild = (el: Element) =>
    $(el)
      .children()
      .toArray()
      .some((c) => BLOCK_TAGS.has(c.tagName.toLowerCase()));

  const walk = (node: AnyNode) => {
    for (const child of $(node).contents().toArray()) {
      const nodeType = String(child.type);
      if (nodeType === 'text') {
        if (skipLevel === null) inline.push((child as unknown as { data: string }).data);
        continue;
      }
      if (nodeType !== 'tag' && nodeType !== 'script' && nodeType !== 'style') continue;
      const el = child as Element;
      const tag = el.tagName.toLowerCase();
      const heading = tag.match(/^h([1-6])$/);
      if (heading) {
        flushSection();
        const level = Number(heading[1]);
        const title = collapse($(el).text());
        if (level === 1 && options.firstH1IsTitle !== false && firstH1 === undefined) {
          firstH1 = title;
          stack.length = 0;
          continue;
        }
        if (skipLevel !== null && level <= skipLevel) skipLevel = null;
        while (stack.length > 0 && stack[stack.length - 1]!.level >= level) stack.pop();
        stack.push({ level, title });
        if (skipLevel === null && dropTitles.has(title.toLowerCase())) skipLevel = level;
        continue;
      }
      if (!BLOCK_TAGS.has(tag)) {
        if (skipLevel === null) {
          inline.push($(el).text());
          collectLinks(el);
        }
        continue;
      }
      flushInline();
      if (tag === 'table') {
        if (skipLevel === null) {
          const rows = $(el)
            .find('tr')
            .toArray()
            .map((tr) =>
              $(tr)
                .children('th,td')
                .toArray()
                .map((cell) => collapse($(cell).text()))
                .filter(Boolean)
                .join(' | '),
            )
            .filter(Boolean);
          if (rows.length > 0) paragraphs.push(rows.join('\n'));
          collectLinks(el);
        }
        continue;
      }
      if (tag === 'pre') {
        if (skipLevel === null) paragraphs.push($(el).text().trim());
        continue;
      }
      if (hasBlockChild(el)) {
        walk(el);
        flushInline();
        continue;
      }
      if (skipLevel === null) {
        const text = collapse($(el).text());
        if (text) paragraphs.push(tag === 'li' ? `- ${text}` : text);
        collectLinks(el);
      }
    }
  };

  walk(root);
  flushSection();
  return { sections, firstH1 };
}

import type { Section } from '../core/types.js';
import { baseTitle, decodeText } from './registry.js';
import type { DocumentLoader } from './types.js';

/** Minimal YAML front matter: top-level 'key: value' lines between '---' fences. */
function frontMatter(text: string): { data: Record<string, string>; body: string } {
  const match = text.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!match) return { data: {}, body: text };
  const data: Record<string, string> = {};
  for (const line of match[1]!.split('\n')) {
    const kv = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (kv) data[kv[1]!] = kv[2]!.trim().replace(/^["']|["']$/g, '');
  }
  return { data, body: text.slice(match[0].length) };
}

/** Sections by heading path. Headings inside fenced code blocks are ignored. */
export function markdownSections(body: string): { sections: Section[]; firstH1?: string } {
  const sections: Section[] = [];
  const stack: { level: number; title: string }[] = [];
  let buf: string[] = [];
  let fence: string | null = null;
  let firstH1: string | undefined;
  const flush = () => {
    const text = buf.join('\n').trim();
    if (text) {
      const path = stack.map((h) => h.title);
      sections.push({
        path,
        text,
        locator: { kind: 'heading', path },
        modality: 'text',
        kind: 'prose',
      });
    }
    buf = [];
  };
  for (const line of body.split('\n')) {
    const marker = line.trimStart().match(/^(```|~~~)/)?.[1];
    if (fence) {
      buf.push(line);
      if (marker === fence) fence = null;
      continue;
    }
    if (marker) {
      fence = marker;
      buf.push(line);
      continue;
    }
    const heading = line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (heading) {
      flush();
      const level = heading[1]!.length;
      const title = heading[2]!.trim();
      if (level === 1 && firstH1 === undefined) {
        firstH1 = title;
        stack.length = 0;
        continue; // The document title is not a section level.
      }
      while (stack.length > 0 && stack[stack.length - 1]!.level >= level) stack.pop();
      stack.push({ level, title });
      continue;
    }
    buf.push(line);
  }
  flush();
  return { sections, firstH1 };
}

export const markdownLoader: DocumentLoader = {
  name: 'markdown',
  extensions: ['.md', '.markdown'],
  async load(input) {
    const { data, body } = frontMatter(decodeText(input.bytes));
    const { sections, firstH1 } = markdownSections(body);
    return {
      title: data.title || firstH1 || baseTitle(input.fileName),
      format: 'markdown',
      sections,
      metadata: Object.fromEntries(Object.entries(data).map(([k, v]) => [`frontmatter.${k}`, v])),
    };
  },
};

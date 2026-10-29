import * as cheerio from 'cheerio';
import { baseTitle, decodeText } from './registry.js';
import { htmlSections } from './html-walk.js';
import type { DocumentLoader } from './types.js';

export const HTML_DROP = ['script', 'style', 'noscript', 'template', 'nav', 'footer', 'aside'];

/** Generic HTML: boilerplate removed, sections by heading path. */
export const htmlLoader: DocumentLoader = {
  name: 'html',
  extensions: ['.html', '.htm'],
  async load(input) {
    const $ = cheerio.load(decodeText(input.bytes));
    const pageTitle = $('head > title').first().text().trim();
    const body = $('body').get(0);
    if (!body)
      return { title: pageTitle || baseTitle(input.fileName), format: 'html', sections: [] };
    const { sections, firstH1 } = htmlSections($, body, { drop: HTML_DROP });
    return { title: pageTitle || firstH1 || baseTitle(input.fileName), format: 'html', sections };
  },
};

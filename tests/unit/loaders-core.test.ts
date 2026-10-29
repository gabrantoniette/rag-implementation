import { describe, expect, it } from 'vitest';
import { formatLocator } from '../../src/core/locator.js';
import { createRegistry } from '../../src/loaders/index.js';
import { bytes, loaderContext, writeFixture } from '../helpers/context.js';
import { makePdf } from '../helpers/pdf.js';

const registry = createRegistry(50 * 1024 * 1024);
const ctx = loaderContext();

const load = (name: string, content: string | Uint8Array) =>
  registry.loadFile(writeFixture('core', name, content), ctx);

describe('core loaders', () => {
  it('markdown: front matter title and heading paths; fenced headings ignored', async () => {
    const doc = await load(
      'guide.md',
      [
        '---',
        'title: Tennis Basics',
        'author: Fixture',
        '---',
        '# Ignored H1 title',
        'Intro paragraph about tennis.',
        '## Scoring',
        'Points go 15, 30, 40.',
        '```',
        '# not a heading',
        '```',
        '### Tiebreak',
        'A tiebreak is played at six games all.',
        '## Surfaces',
        'Grass, clay and hard courts.',
      ].join('\n'),
    );
    expect(doc.title).toBe('Tennis Basics');
    expect(doc.format).toBe('markdown');
    expect(doc.metadata['frontmatter.author']).toBe('Fixture');
    expect(doc.sections.map((s) => s.path)).toEqual([
      [],
      ['Scoring'],
      ['Scoring', 'Tiebreak'],
      ['Surfaces'],
    ]);
    expect(doc.sections[1]!.text).toContain('# not a heading');
    expect(doc.sections[2]!.locator).toEqual({ kind: 'heading', path: ['Scoring', 'Tiebreak'] });
  });

  it('text: paragraphs grouped with paragraph-range locators', async () => {
    const para = (n: number) => `Paragraph ${n} ` + 'word '.repeat(120);
    const doc = await load('notes.txt', [1, 2, 3, 4, 5].map(para).join('\n\n'));
    expect(doc.format).toBe('text');
    expect(doc.sections.length).toBeGreaterThan(1);
    expect(doc.sections[0]!.locator).toEqual({ kind: 'paragraphs', start: 1, end: 2 });
    const last = doc.sections[doc.sections.length - 1]!.locator;
    expect(last.kind === 'paragraphs' && last.end).toBe(5);
  });

  it('html: boilerplate removed and heading paths kept', async () => {
    const doc = await load(
      'page.html',
      `<html><head><title>Olympic Games</title><style>p{color:red}</style></head><body>
        <nav>Home | About</nav><h1>Olympic Games</h1><p>The modern Games began in 1896.</p>
        <h2>Summer</h2><p>Held every four years.</p><script>var x = 1;</script>
        <h3>Host cities</h3><ul><li>Athens</li><li>Paris</li></ul>
        <aside>Related links</aside><footer>Copyright</footer></body></html>`,
    );
    expect(doc.title).toBe('Olympic Games');
    expect(doc.sections.map((s) => s.path)).toEqual([[], ['Summer'], ['Summer', 'Host cities']]);
    const all = doc.sections.map((s) => s.text).join('\n');
    expect(all).not.toMatch(/Home \| About|var x|color:red|Related links|Copyright/);
    expect(doc.sections[2]!.text).toContain('- Athens');
  });

  it('csv: rows serialized with column names, grouped, header repeated, row-range locators', async () => {
    const lines = ['player,country,titles'];
    for (let i = 1; i <= 60; i++) lines.push(`Player ${i},Country ${i},${i}`);
    const doc = await load('players.csv', '﻿' + lines.join('\n'));
    expect(doc.format).toBe('csv');
    expect(doc.sections.length).toBeGreaterThan(1);
    expect(doc.sections[0]!.kind).toBe('table');
    expect(doc.sections[0]!.text.split('\n')[0]).toBe('Columns: player, country, titles');
    expect(doc.sections[1]!.text.split('\n')[0]).toBe('Columns: player, country, titles');
    expect(doc.sections[0]!.text).toContain('player: Player 1; country: Country 1; titles: 1');
    expect(doc.sections[0]!.locator).toMatchObject({ kind: 'rows', start: 1 });
    const last = doc.sections[doc.sections.length - 1]!.locator;
    expect(last).toMatchObject({ kind: 'rows', end: 60 });
  });

  it('tsv: tab-delimited rows', async () => {
    const doc = await load('teams.tsv', 'team\tcity\nLakers\tLos Angeles\nCeltics\tBoston\n');
    expect(doc.format).toBe('tsv');
    expect(doc.sections[0]!.text).toContain('team: Celtics; city: Boston');
    expect(doc.sections[0]!.locator).toEqual({ kind: 'rows', start: 1, end: 2 });
  });

  it('json: array of records behaves like rows; single object flattened to key paths', async () => {
    const arr = await load(
      'races.json',
      JSON.stringify([
        { race: 'Monaco', winner: { name: 'Driver A' } },
        { race: 'Monza', winner: { name: 'Driver B' } },
      ]),
    );
    expect(arr.sections[0]!.text).toContain('race: Monza; winner.name: Driver B');
    expect(arr.sections[0]!.locator).toEqual({ kind: 'records', start: 1, end: 2 });
    const obj = await load(
      'team.json',
      JSON.stringify({ name: 'Club', stadium: { city: 'Madrid' } }),
    );
    expect(obj.sections[0]!.text).toBe('name: Club\nstadium.city: Madrid');
    expect(obj.sections[0]!.locator).toEqual({ kind: 'keys', first: 'name', last: 'stadium.city' });
  });

  it('jsonl: one record per line', async () => {
    const doc = await load(
      'events.jsonl',
      '{"year":1896,"city":"Athens"}\n{"year":1900,"city":"Paris"}\n',
    );
    expect(doc.format).toBe('jsonl');
    expect(doc.sections[0]!.text).toContain('year: 1900; city: Paris');
    expect(doc.sections[0]!.locator).toEqual({ kind: 'records', start: 1, end: 2 });
  });

  it('pdf: one section per page with page locators and the document title', async () => {
    const pdf = makePdf(
      [
        {
          lines: ['The first page talks about the Tour de France,', 'a cycling race held in July.'],
        },
        { lines: ['The second page covers the Giro d Italia,', 'which usually starts in May.'] },
      ],
      { title: 'Grand Tours' },
    );
    const doc = await load('tours.pdf', pdf);
    expect(doc.title).toBe('Grand Tours');
    expect(doc.sections).toHaveLength(2);
    expect(doc.sections[0]!.locator).toEqual({ kind: 'page', page: 1 });
    expect(doc.sections[1]!.locator).toEqual({ kind: 'page', page: 2 });
    expect(doc.sections[1]!.text).toContain('Giro d Italia, which usually starts in May.');
    expect(formatLocator(doc.sections[1]!.locator)).toBe('page 2');
  });

  it('srt and vtt: cues merged into time windows of at most 90 seconds', async () => {
    const cue = (i: number, start: number) => {
      const t = (s: number) =>
        `00:${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
      return `${i}\n${t(start)},000 --> ${t(start + 4)},500\n<i>Cue ${i}</i> commentary line.\n`;
    };
    const srt = Array.from({ length: 30 }, (_, i) => cue(i + 1, i * 5)).join('\n');
    const doc = await load('match.srt', srt);
    expect(doc.format).toBe('srt');
    expect(doc.sections.length).toBeGreaterThan(1);
    for (const s of doc.sections) {
      expect(s.locator.kind).toBe('time');
      if (s.locator.kind === 'time')
        expect(s.locator.endSec - s.locator.startSec).toBeLessThanOrEqual(90);
    }
    expect(doc.sections[0]!.text.startsWith('Cue 1 commentary line.')).toBe(true);
    expect(formatLocator(doc.sections[0]!.locator)).toMatch(/^00:00:00-00:01:\d\d$/);

    const vtt = await load(
      'clip.vtt',
      'WEBVTT\n\nNOTE a comment\n\nintro\n00:01.000 --> 00:03.500 align:start\nHello and welcome.\n\n00:04.000 --> 00:06.000\nKick-off!\n',
    );
    expect(vtt.sections).toHaveLength(1);
    expect(vtt.sections[0]!.text).toBe('Hello and welcome. Kick-off!');
    expect(vtt.sections[0]!.locator).toEqual({ kind: 'time', startSec: 1, endSec: 6 });
  });

  it('text sources are loaded from memory with an explicit title', async () => {
    const doc = await registry.loadText('# Hello\nWorld', 'md', 'In memory', 'memory://hello', ctx);
    expect(doc.title).toBe('In memory');
    expect(doc.uri).toBe('memory://hello');
    expect(doc.sections[0]!.text).toBe('World');
  });

  it('identical content gives the same content hash; any change gives a new one', async () => {
    const a = await registry.loadText('alpha', 'txt', 't', 'memory://a', ctx);
    const b = await registry.loadText('alpha', 'txt', 't', 'memory://b', ctx);
    const c = await registry.loadText('alpha!', 'txt', 't', 'memory://a', ctx);
    expect(a.contentHash).toBe(b.contentHash);
    expect(a.contentHash).not.toBe(c.contentHash);
    expect(bytes('x')).toBeInstanceOf(Uint8Array);
  });
});

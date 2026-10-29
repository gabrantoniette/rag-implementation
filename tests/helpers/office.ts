import JSZip from 'jszip';

const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PKG_REL = 'http://schemas.openxmlformats.org/package/2006/relationships';

function rels(entries: [id: string, type: string, target: string][]): string {
  return (
    `${XML}<Relationships xmlns="${PKG_REL}">` +
    entries
      .map(
        ([id, type, target]) =>
          `<Relationship Id="${id}" Type="${REL}/${type}" Target="${target}"/>`,
      )
      .join('') +
    '</Relationships>'
  );
}

function coreProps(title: string): string {
  return (
    `${XML}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" ` +
    'xmlns:dc="http://purl.org/dc/elements/1.1/">' +
    `<dc:title>${esc(title)}</dc:title></cp:coreProperties>`
  );
}

async function zip(files: Record<string, string>): Promise<Uint8Array> {
  const z = new JSZip();
  for (const [name, content] of Object.entries(files)) z.file(name, content);
  return z.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}

export type DocxBlock =
  | { heading: string; level: 1 | 2 | 3 }
  | { paragraph: string; footnote?: string }
  | { table: string[][] };

/** Minimal Word document: styles with heading outline levels, paragraphs, tables and footnotes. */
export async function makeDocx(title: string, blocks: DocxBlock[]): Promise<Uint8Array> {
  const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  const run = (t: string) => `<w:r><w:t xml:space="preserve">${esc(t)}</w:t></w:r>`;
  const footnotes: string[] = [];
  const body = blocks
    .map((b) => {
      if ('heading' in b) {
        return `<w:p><w:pPr><w:pStyle w:val="Heading${b.level}"/></w:pPr>${run(b.heading)}</w:p>`;
      }
      if ('paragraph' in b) {
        let note = '';
        if (b.footnote) {
          footnotes.push(b.footnote);
          note = `<w:r><w:rPr><w:rStyle w:val="FootnoteReference"/></w:rPr><w:footnoteReference w:id="${footnotes.length}"/></w:r>`;
        }
        return `<w:p>${run(b.paragraph)}${note}</w:p>`;
      }
      const rows = b.table
        .map((r) => `<w:tr>${r.map((c) => `<w:tc><w:p>${run(c)}</w:p></w:tc>`).join('')}</w:tr>`)
        .join('');
      return `<w:tbl>${rows}</w:tbl>`;
    })
    .join('');
  const styles =
    `${XML}<w:styles xmlns:w="${W}">` +
    '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>' +
    [1, 2, 3]
      .map(
        (l) =>
          `<w:style w:type="paragraph" w:styleId="Heading${l}"><w:name w:val="heading ${l}"/>` +
          `<w:basedOn w:val="Normal"/><w:pPr><w:outlineLvl w:val="${l - 1}"/></w:pPr></w:style>`,
      )
      .join('') +
    '</w:styles>';
  const footnotesXml =
    `${XML}<w:footnotes xmlns:w="${W}">` +
    '<w:footnote w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:footnote>' +
    '<w:footnote w:type="continuationSeparator" w:id="0"><w:p><w:r><w:continuationSeparator/></w:r></w:p></w:footnote>' +
    footnotes
      .map((f, i) => `<w:footnote w:id="${i + 1}"><w:p>${run(f)}</w:p></w:footnote>`)
      .join('') +
    '</w:footnotes>';
  return zip({
    '[Content_Types].xml':
      `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
      '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
      '<Override PartName="/word/footnotes.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml"/>' +
      '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>' +
      '</Types>',
    '_rels/.rels': rels([
      ['rId1', 'officeDocument', 'word/document.xml'],
      ['rId2', 'metadata/core-properties', 'docProps/core.xml'],
    ]).replace(`${REL}/metadata/core-properties`, `${PKG_REL}/metadata/core-properties`),
    'word/_rels/document.xml.rels': rels([
      ['rId1', 'styles', 'styles.xml'],
      ['rId2', 'footnotes', 'footnotes.xml'],
    ]),
    'word/document.xml': `${XML}<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`,
    'word/styles.xml': styles,
    'word/footnotes.xml': footnotesXml,
    'docProps/core.xml': coreProps(title),
  });
}

export interface XlsxSheet {
  name: string;
  /** Cell values; a value { f, v } is a formula with its cached result. */
  rows: (string | number | { f: string; v: number })[][];
}

const colName = (i: number) => String.fromCharCode(65 + i);

/** Minimal Excel workbook with inline strings, numbers and formulas with cached values. */
export async function makeXlsx(title: string, sheets: XlsxSheet[]): Promise<Uint8Array> {
  const S = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
  const files: Record<string, string> = {};
  sheets.forEach((sheet, si) => {
    const rows = sheet.rows
      .map((r, ri) => {
        const cells = r
          .map((v, ci) => {
            const ref = `${colName(ci)}${ri + 1}`;
            if (typeof v === 'number') return `<c r="${ref}"><v>${v}</v></c>`;
            if (typeof v === 'object') return `<c r="${ref}"><f>${esc(v.f)}</f><v>${v.v}</v></c>`;
            return `<c r="${ref}" t="inlineStr"><is><t>${esc(v)}</t></is></c>`;
          })
          .join('');
        return `<row r="${ri + 1}">${cells}</row>`;
      })
      .join('');
    files[`xl/worksheets/sheet${si + 1}.xml`] =
      `${XML}<worksheet xmlns="${S}"><sheetData>${rows}</sheetData></worksheet>`;
  });
  files['[Content_Types].xml'] =
    `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
    sheets
      .map(
        (_, i) =>
          `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
      )
      .join('') +
    '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>' +
    '</Types>';
  files['_rels/.rels'] = rels([
    ['rId1', 'officeDocument', 'xl/workbook.xml'],
    ['rId2', 'metadata/core-properties', 'docProps/core.xml'],
  ]).replace(`${REL}/metadata/core-properties`, `${PKG_REL}/metadata/core-properties`);
  files['xl/workbook.xml'] =
    `${XML}<workbook xmlns="${S}" xmlns:r="${REL}"><sheets>` +
    sheets
      .map((s, i) => `<sheet name="${esc(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
      .join('') +
    '</sheets></workbook>';
  files['xl/_rels/workbook.xml.rels'] = rels(
    sheets.map((_, i) => [`rId${i + 1}`, 'worksheet', `worksheets/sheet${i + 1}.xml`]),
  );
  files['docProps/core.xml'] = coreProps(title);
  return zip(files);
}

export interface PptxSlide {
  title: string;
  body: string[];
  notes?: string;
}

/** Minimal PowerPoint deck: title and body placeholders per slide, optional speaker notes. */
export async function makePptx(title: string, slides: PptxSlide[]): Promise<Uint8Array> {
  const P = 'http://schemas.openxmlformats.org/presentationml/2006/main';
  const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
  const para = (t: string) => `<a:p><a:r><a:t>${esc(t)}</a:t></a:r></a:p>`;
  const shape = (id: number, ph: string, paragraphs: string[]) =>
    `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${ph} ${id}"/><p:cNvSpPr/><p:nvPr><p:ph type="${ph}"/></p:nvPr></p:nvSpPr>` +
    `<p:spPr/><p:txBody><a:bodyPr/>${paragraphs.map(para).join('')}</p:txBody></p:sp>`;
  const tree = (shapes: string) =>
    `<p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>${shapes}</p:spTree></p:cSld>`;
  const files: Record<string, string> = {};
  slides.forEach((s, i) => {
    const n = i + 1;
    files[`ppt/slides/slide${n}.xml`] =
      `${XML}<p:sld xmlns:p="${P}" xmlns:a="${A}" xmlns:r="${REL}">` +
      tree(shape(2, 'title', [s.title]) + shape(3, 'body', s.body)) +
      '</p:sld>';
    const slideRels: [string, string, string][] = [];
    if (s.notes) {
      slideRels.push(['rId1', 'notesSlide', `../notesSlides/notesSlide${n}.xml`]);
      files[`ppt/notesSlides/notesSlide${n}.xml`] =
        `${XML}<p:notes xmlns:p="${P}" xmlns:a="${A}" xmlns:r="${REL}">` +
        tree(shape(2, 'body', [s.notes])) +
        '</p:notes>';
    }
    files[`ppt/slides/_rels/slide${n}.xml.rels`] = rels(slideRels);
  });
  files['[Content_Types].xml'] =
    `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>' +
    slides
      .map(
        (s, i) =>
          `<Override PartName="/ppt/slides/slide${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>` +
          (s.notes
            ? `<Override PartName="/ppt/notesSlides/notesSlide${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.notesSlide+xml"/>`
            : ''),
      )
      .join('') +
    '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>' +
    '</Types>';
  files['_rels/.rels'] = rels([
    ['rId1', 'officeDocument', 'ppt/presentation.xml'],
    ['rId2', 'metadata/core-properties', 'docProps/core.xml'],
  ]).replace(`${REL}/metadata/core-properties`, `${PKG_REL}/metadata/core-properties`);
  files['ppt/presentation.xml'] =
    `${XML}<p:presentation xmlns:p="${P}" xmlns:a="${A}" xmlns:r="${REL}"><p:sldIdLst>` +
    slides.map((_, i) => `<p:sldId id="${256 + i}" r:id="rId${i + 1}"/>`).join('') +
    '</p:sldIdLst></p:presentation>';
  files['ppt/_rels/presentation.xml.rels'] = rels(
    slides.map((_, i) => [`rId${i + 1}`, 'slide', `slides/slide${i + 1}.xml`]),
  );
  files['docProps/core.xml'] = coreProps(title);
  return zip(files);
}

/** A ZIP whose single entry is large but compresses tiny (decompression-limit test). */
export async function makeZipBomb(
  entryName: string,
  uncompressedBytes: number,
): Promise<Uint8Array> {
  return zip({
    '[Content_Types].xml': `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"></Types>`,
    [entryName]: 'A'.repeat(uncompressedBytes),
  });
}

import { deflateSync } from 'node:zlib';

/** An RGB image to place on a page (raw 8-bit RGB pixels, row-major). */
export interface PdfImage {
  width: number;
  height: number;
  rgb: Uint8Array;
}

export interface PdfPage {
  /** Lines of text drawn with Helvetica 12pt (creates a text layer). */
  lines?: string[];
  /** An image filling most of the page (no text layer). */
  image?: PdfImage;
}

export interface PdfOptions {
  title?: string;
  /** Adds a Standard security handler with a non-empty user password, so readers need a password. */
  encrypted?: boolean;
}

const escapePdfString = (s: string) =>
  s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');

/**
 * Writes a tiny but valid PDF (correct xref offsets). Test-only helper: fixtures are generated at
 * test time and never downloaded.
 */
export function makePdf(pages: PdfPage[], options: PdfOptions = {}): Uint8Array {
  const objects: (string | Buffer)[] = [];
  const add = (body: string | Buffer) => {
    objects.push(body);
    return objects.length; // object number
  };
  const catalog = add(''); // placeholder, filled later
  const pagesObj = add('');
  const font = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  const pageRefs: number[] = [];
  for (const page of pages) {
    let content = '';
    let xobjects = '';
    if (page.image) {
      const { width, height, rgb } = page.image;
      const data = deflateSync(Buffer.from(rgb));
      const img = add(
        Buffer.concat([
          Buffer.from(
            `<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceRGB ` +
              `/BitsPerComponent 8 /Filter /FlateDecode /Length ${data.length} >>\nstream\n`,
            'latin1',
          ),
          data,
          Buffer.from('\nendstream', 'latin1'),
        ]),
      );
      const w = 540;
      const h = Math.round((w * height) / width);
      content += `q ${w} 0 0 ${h} 36 ${792 - 72 - h} cm /Im1 Do Q\n`;
      xobjects = ` /XObject << /Im1 ${img} 0 R >>`;
    }
    if (page.lines?.length) {
      content += 'BT /F1 12 Tf 14 TL 72 720 Td\n';
      content += page.lines.map((l) => `(${escapePdfString(l)}) Tj T*`).join('\n');
      content += '\nET\n';
    }
    const stream = add(
      `<< /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}endstream`,
    );
    pageRefs.push(
      add(
        `<< /Type /Page /Parent ${pagesObj} 0 R /MediaBox [0 0 612 792] ` +
          `/Resources << /Font << /F1 ${font} 0 R >>${xobjects} >> /Contents ${stream} 0 R >>`,
      ),
    );
  }
  objects[pagesObj - 1] =
    `<< /Type /Pages /Kids [${pageRefs.map((r) => `${r} 0 R`).join(' ')}] /Count ${pageRefs.length} >>`;
  objects[catalog - 1] = `<< /Type /Catalog /Pages ${pagesObj} 0 R >>`;
  const info = add(`<< /Title (${escapePdfString(options.title ?? '')}) >>`);
  let encrypt = 0;
  if (options.encrypted) {
    // O and U are arbitrary 32-byte strings: the empty user password will not validate.
    const o = 'A'.repeat(32);
    const u = 'B'.repeat(32);
    encrypt = add(`<< /Filter /Standard /V 1 /R 2 /O (${o}) /U (${u}) /P -44 >>`);
  }

  const chunks: Buffer[] = [Buffer.from('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n', 'latin1')];
  const offsets: number[] = [];
  let length = chunks[0]!.length;
  objects.forEach((body, i) => {
    offsets.push(length);
    const head = Buffer.from(`${i + 1} 0 obj\n`, 'latin1');
    const payload = typeof body === 'string' ? Buffer.from(body, 'latin1') : body;
    const tail = Buffer.from('\nendobj\n', 'latin1');
    chunks.push(head, payload, tail);
    length += head.length + payload.length + tail.length;
  });
  const xrefStart = length;
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) xref += `${String(off).padStart(10, '0')} 00000 n \n`;
  const id = '<0123456789ABCDEF0123456789ABCDEF>';
  xref +=
    `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R /Info ${info} 0 R` +
    (encrypt ? ` /Encrypt ${encrypt} 0 R /ID [${id} ${id}]` : '') +
    ` >>\nstartxref\n${xrefStart}\n%%EOF\n`;
  chunks.push(Buffer.from(xref, 'latin1'));
  return new Uint8Array(Buffer.concat(chunks));
}

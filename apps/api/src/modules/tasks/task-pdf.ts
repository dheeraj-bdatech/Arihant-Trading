/**
 * Minimal dependency-free PDF writer for the performance evidence report: A4 pages, Helvetica /
 * Helvetica-Bold (built-in Type1, WinAnsi), filled bars, simple tables with truncation, automatic page
 * breaks, and a footer on every page carrying the evidence disclaimer and page numbers.
 */

const PAGE_W = 595.28;
const PAGE_H = 841.89;
const MARGIN = 40;
const FOOTER_H = 46;

type RGB = [number, number, number];
const hex = (h: string): RGB => [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255];
export const PDF_COLORS = { ink: hex('#14213D'), muted: hex('#4A5568'), teal: hex('#0F5E63'), tealSoft: hex('#E3EFEE'), terracotta: hex('#9A3412'), line: hex('#DCD8CE'), strip: hex('#FBFAF7'), white: [1, 1, 1] as RGB };

/** Keep text inside WinAnsi; replace common Unicode punctuation. */
export function pdfSafe(text: unknown): string {
  return String(text ?? '')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/→/g, '->')
    .replace(/…/g, '...')
    .replace(/₹/g, 'Rs ')
    .replace(/·/g, '-')
    .replace(/[^\x20-\x7E\xA0-\xFF]/g, '?');
}

const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
const n = (v: number) => (Math.round(v * 100) / 100).toString();

/** Approximate Helvetica advance widths (good enough for wrapping/truncation). */
function textWidth(s: string, size: number, bold: boolean) {
  let w = 0;
  for (const ch of s) {
    if ('il.,:;|!\'`'.includes(ch)) w += 0.28;
    else if ('fjrtI()[] '.includes(ch)) w += 0.34;
    else if ('mwMW@'.includes(ch)) w += 0.86;
    else if (ch >= 'A' && ch <= 'Z') w += 0.68;
    else if (ch >= '0' && ch <= '9') w += 0.56;
    else w += 0.52;
  }
  return w * size * (bold ? 1.06 : 1);
}

export class PdfBuilder {
  private pages: string[][] = [];
  private ops: string[] = [];
  private y = 0;
  readonly width = PAGE_W - MARGIN * 2;

  constructor(private readonly footer: { title: string; disclaimer: string }) {
    this.newPage();
  }

  private newPage() {
    this.ops = [];
    this.pages.push(this.ops);
    this.y = PAGE_H - MARGIN;
  }

  ensure(height: number) {
    if (this.y - height < MARGIN + FOOTER_H) this.newPage();
  }

  private fill(c: RGB) {
    return `${n(c[0])} ${n(c[1])} ${n(c[2])} rg`;
  }

  rect(x: number, yTop: number, w: number, h: number, color: RGB) {
    this.ops.push(`${this.fill(color)} ${n(x)} ${n(yTop - h)} ${n(w)} ${n(h)} re f`);
  }

  line(x1: number, y1: number, x2: number, y2: number, color: RGB = PDF_COLORS.line) {
    this.ops.push(`${n(color[0])} ${n(color[1])} ${n(color[2])} RG 0.6 w ${n(x1)} ${n(y1)} m ${n(x2)} ${n(y2)} l S`);
  }

  textAt(x: number, y: number, text: string, opts: { size?: number; bold?: boolean; color?: RGB; maxWidth?: number } = {}) {
    const size = opts.size ?? 9;
    let s = pdfSafe(text);
    if (opts.maxWidth && textWidth(s, size, !!opts.bold) > opts.maxWidth) {
      while (s.length > 1 && textWidth(`${s}..`, size, !!opts.bold) > opts.maxWidth) s = s.slice(0, -1);
      s = `${s.trimEnd()}..`;
    }
    this.ops.push(`BT /${opts.bold ? 'F2' : 'F1'} ${n(size)} Tf ${this.fill(opts.color ?? PDF_COLORS.ink)} ${n(x)} ${n(y)} Td (${esc(s)}) Tj ET`);
  }

  private wrap(text: string, size: number, bold: boolean, width: number): string[] {
    const out: string[] = [];
    for (const para of pdfSafe(text).split(/\n/)) {
      let cur = '';
      for (const word of para.split(/\s+/)) {
        const next = cur ? `${cur} ${word}` : word;
        if (textWidth(next, size, bold) > width && cur) {
          out.push(cur);
          cur = word;
        } else cur = next;
      }
      out.push(cur);
    }
    return out;
  }

  paragraph(text: string, opts: { size?: number; bold?: boolean; color?: RGB; gap?: number } = {}) {
    const size = opts.size ?? 9;
    for (const l of this.wrap(text, size, !!opts.bold, this.width)) {
      this.ensure(size + 4);
      this.textAt(MARGIN, this.y - size, l, opts);
      this.y -= size + 3.5;
    }
    this.y -= opts.gap ?? 4;
  }

  heading(text: string) {
    this.ensure(30);
    this.y -= 8;
    this.rect(MARGIN, this.y, this.width, 20, PDF_COLORS.tealSoft);
    this.textAt(MARGIN + 8, this.y - 14, text, { size: 11, bold: true, color: PDF_COLORS.teal });
    this.y -= 28;
  }

  title(text: string, sub: string) {
    this.rect(0, PAGE_H, PAGE_W, 74, PDF_COLORS.ink);
    this.textAt(MARGIN, PAGE_H - 36, text, { size: 17, bold: true, color: PDF_COLORS.white });
    this.textAt(MARGIN, PAGE_H - 56, sub, { size: 9.5, color: [0.85, 0.87, 0.9] });
    this.y = PAGE_H - 92;
  }

  callout(text: string) {
    const lines = this.wrap(text, 8.5, true, this.width - 20);
    const h = lines.length * 12 + 12;
    this.ensure(h + 6);
    this.rect(MARGIN, this.y, this.width, h, [0.984, 0.922, 0.867]);
    this.rect(MARGIN, this.y, 3, h, PDF_COLORS.terracotta);
    lines.forEach((l, i) => this.textAt(MARGIN + 12, this.y - 15 - i * 12, l, { size: 8.5, bold: true, color: PDF_COLORS.terracotta }));
    this.y -= h + 8;
  }

  /** Two-column key/value grid. */
  kv(rows: [string, string][], cols = 2) {
    const colW = this.width / cols;
    for (let i = 0; i < rows.length; i += cols) {
      this.ensure(16);
      for (let c = 0; c < cols && i + c < rows.length; c++) {
        const [k, v] = rows[i + c];
        const x = MARGIN + c * colW;
        this.textAt(x, this.y - 10, k, { size: 8, color: PDF_COLORS.muted, maxWidth: colW * 0.55 });
        this.textAt(x + colW * 0.56, this.y - 10, v, { size: 9, bold: true, maxWidth: colW * 0.42 });
      }
      this.line(MARGIN, this.y - 14, MARGIN + this.width, this.y - 14);
      this.y -= 16;
    }
    this.y -= 4;
  }

  table(columns: { label: string; width: number; align?: 'left' | 'right' }[], rows: string[][], opts: { size?: number } = {}) {
    const size = opts.size ?? 7.5;
    const total = columns.reduce((a, c) => a + c.width, 0);
    const widths = columns.map((c) => (c.width / total) * this.width);
    const header = () => {
      this.ensure(32);
      this.rect(MARGIN, this.y, this.width, 15, PDF_COLORS.ink);
      let x = MARGIN;
      columns.forEach((c, i) => {
        this.textAt(x + 3, this.y - 10.5, c.label, { size: size, bold: true, color: PDF_COLORS.white, maxWidth: widths[i] - 6 });
        x += widths[i];
      });
      this.y -= 15;
    };
    header();
    rows.forEach((r, ri) => {
      if (this.y - 13 < MARGIN + FOOTER_H) {
        this.newPage();
        header();
      }
      if (ri % 2 === 1) this.rect(MARGIN, this.y, this.width, 13, PDF_COLORS.strip);
      let x = MARGIN;
      r.forEach((cell, i) => {
        const w = widths[i];
        const s = pdfSafe(cell);
        const tx = columns[i].align === 'right' ? x + w - 3 - Math.min(textWidth(s, size, false), w - 6) : x + 3;
        this.textAt(tx, this.y - 9.5, s, { size, maxWidth: w - 6 });
        x += w;
      });
      this.y -= 13;
    });
    this.y -= 8;
  }

  /** Serialises to a PDF buffer, stamping the footer on every page. */
  build(): Buffer {
    const total = this.pages.length;
    this.pages.forEach((ops, i) => {
      const f: string[] = [];
      f.push(`${n(PDF_COLORS.line[0])} ${n(PDF_COLORS.line[1])} ${n(PDF_COLORS.line[2])} RG 0.6 w ${MARGIN} ${MARGIN + FOOTER_H - 8} m ${PAGE_W - MARGIN} ${MARGIN + FOOTER_H - 8} l S`);
      const disc = this.wrap(this.footer.disclaimer, 7, true, this.width - 60);
      disc.forEach((l, li) => f.push(`BT /F2 7 Tf ${this.fill(PDF_COLORS.terracotta)} ${MARGIN} ${n(MARGIN + FOOTER_H - 20 - li * 9)} Td (${esc(l)}) Tj ET`));
      f.push(`BT /F1 7 Tf ${this.fill(PDF_COLORS.muted)} ${MARGIN} ${MARGIN} Td (${esc(pdfSafe(this.footer.title))}) Tj ET`);
      f.push(`BT /F1 7 Tf ${this.fill(PDF_COLORS.muted)} ${n(PAGE_W - MARGIN - 50)} ${MARGIN} Td (Page ${i + 1} of ${total}) Tj ET`);
      ops.push(...f);
    });

    const objects: string[] = [];
    const add = (body: string) => {
      objects.push(body);
      return objects.length;
    };
    const catalogId = add('');
    const pagesId = add('');
    const f1 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
    const f2 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
    const pageIds: number[] = [];
    for (const ops of this.pages) {
      const content = ops.join('\n');
      const contentId = add(`<< /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}\nendstream`);
      pageIds.push(
        add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] /Contents ${contentId} 0 R /Resources << /Font << /F1 ${f1} 0 R /F2 ${f2} 0 R >> >> >>`),
      );
    }
    objects[catalogId - 1] = `<< /Type /Catalog /Pages ${pagesId} 0 R >>`;
    objects[pagesId - 1] = `<< /Type /Pages /Kids [${pageIds.map((p) => `${p} 0 R`).join(' ')}] /Count ${pageIds.length} >>`;

    let out = '%PDF-1.4\n%\xE2\xE3\xCF\xD3\n';
    const offsets: number[] = [];
    objects.forEach((o, i) => {
      offsets.push(Buffer.byteLength(out, 'latin1'));
      out += `${i + 1} 0 obj\n${o}\nendobj\n`;
    });
    const xref = Buffer.byteLength(out, 'latin1');
    out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
    out += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    return Buffer.from(out, 'latin1');
  }
}

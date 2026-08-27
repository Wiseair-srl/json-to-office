import { describe, expect, it } from 'vitest';
import { parsePdfTextBbox } from './pdf-text-geometry';

// Captured verbatim from `pdftotext -bbox` (poppler 26.07) over a
// LibreOffice-produced PDF — the exact producer pair the harness uses.
const CAPTURED = `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd"><html xmlns="http://www.w3.org/1999/xhtml">
<head>
<title></title>
<meta name="Producer" content="LibreOffice 26.2.1.2 (AARCH64)"/>
</head>
<body>
<doc>
  <page width="595.303937" height="841.889764">
    <word xMin="56.800000" yMin="56.730764" xMax="86.800000" yMax="68.050764">Hello</word>
    <word xMin="92.800000" yMin="56.730764" xMax="140.800000" yMax="68.050764">geometry</word>
  </page>
  <page width="960.000000" height="540.000000">
    <word xMin="72.000000" yMin="100.500000" xMax="120.250000" yMax="115.750000">R&amp;D</word>
  </page>
</doc>
</body>
</html>
`;

describe('parsePdfTextBbox', () => {
  it('parses pages, sizes, and word boxes from captured poppler output', () => {
    const pages = parsePdfTextBbox(CAPTURED);
    expect(pages).toHaveLength(2);
    expect(pages[0].widthPt).toBeCloseTo(595.303937);
    expect(pages[0].heightPt).toBeCloseTo(841.889764);
    expect(pages[0].words).toHaveLength(2);
    expect(pages[0].words[0]).toEqual({
      text: 'Hello',
      xMin: 56.8,
      yMin: 56.730764,
      xMax: 86.8,
      yMax: 68.050764,
    });
    expect(pages[1].widthPt).toBe(960);
    expect(pages[1].words[0].yMax).toBeCloseTo(115.75);
  });

  it('decodes XML entities in word text', () => {
    const pages = parsePdfTextBbox(CAPTURED);
    expect(pages[1].words[0].text).toBe('R&D');
  });

  it('returns an empty page list for output with no pages', () => {
    expect(parsePdfTextBbox('<doc></doc>')).toEqual([]);
  });

  it('keeps a page with no words as an empty word list', () => {
    const pages = parsePdfTextBbox(
      '<page width="960.0" height="540.0"></page>'
    );
    expect(pages).toEqual([{ widthPt: 960, heightPt: 540, words: [] }]);
  });
});

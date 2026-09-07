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
    expect(pages).toEqual([
      { widthPt: 960, heightPt: 540, words: [], lines: [] },
    ]);
  });
});

// Captured from `pdftotext -bbox-layout`: the same words, grouped into the
// flows, blocks and lines poppler's layout analysis found.
const CAPTURED_LAYOUT = `<html xmlns="http://www.w3.org/1999/xhtml">
<body>
<doc>
  <page width="595.303937" height="841.889764">
    <flow>
      <block xMin="54.55" yMin="42.50" xMax="136.00" yMax="58.37">
        <line xMin="54.55" yMin="42.50" xMax="136.00" yMax="58.37">
          <word xMin="54.55" yMin="42.50" xMax="79.46" yMax="58.37">Your</word>
          <word xMin="82.77" yMin="42.50" xMax="136.00" yMax="58.37">Company</word>
        </line>
      </block>
      <block xMin="54.55" yMin="100.00" xMax="200.00" yMax="140.00">
        <line xMin="54.55" yMin="100.00" xMax="200.00" yMax="118.00">
          <word xMin="54.55" yMin="100.00" xMax="100.00" yMax="118.00">Revenue</word>
        </line>
        <line xMin="54.55" yMin="122.00" xMax="200.00" yMax="140.00">
          <word xMin="54.55" yMin="122.00" xMax="90.00" yMax="140.00">grew</word>
        </line>
      </block>
    </flow>
  </page>
  <page width="595.303937" height="841.889764">
  </page>
</doc>
</body>
</html>
`;

describe('parsePdfTextBbox with layout output', () => {
  it('keeps every word in stream order and records the lines they sit on', () => {
    const pages = parsePdfTextBbox(CAPTURED_LAYOUT);
    expect(pages).toHaveLength(2);
    expect(pages[0].words.map((w) => w.text)).toEqual([
      'Your',
      'Company',
      'Revenue',
      'grew',
    ]);
    expect(pages[0].lines).toEqual([
      { xMin: 54.55, yMin: 42.5, xMax: 136, yMax: 58.37, words: [0, 1] },
      { xMin: 54.55, yMin: 100, xMax: 200, yMax: 118, words: [2] },
      { xMin: 54.55, yMin: 122, xMax: 200, yMax: 140, words: [3] },
    ]);
    expect(pages[1]).toEqual({
      widthPt: 595.303937,
      heightPt: 841.889764,
      words: [],
      lines: [],
    });
  });

  it('leaves lines empty for plain -bbox output, where poppler groups nothing', () => {
    const pages = parsePdfTextBbox(CAPTURED);
    expect(pages[0].lines).toEqual([]);
  });
});

/**
 * What a `word/theme/theme1.xml` says about the document's theme: its name,
 * the scheme colours and the Latin faces of the major and minor fonts.
 *
 * Deliberately blind to what the two backends legitimately write differently:
 * the colour and font scheme names, PANOSE, the empty East Asian and
 * complex-script faces, Office's per-script supplemental fonts and the format
 * scheme.
 */

export interface ThemePartSummary {
  name: string;
  /**
   * Keyed by DrawingML element (dk1, lt1, …, hlink, folHlink): `RRGGBB`, or
   * `sys:RRGGBB` for a sysClr's lastClr.
   */
  colors: Record<string, string>;
  headings: string | undefined;
  body: string | undefined;
}

const unescape = (value: string): string =>
  value
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');

/**
 * Summarize a theme part. Throws when there is no `a:theme` element, so a
 * missing part (read as `''`) can never compare equal to another.
 */
export function summarizeThemePart(xml: string): ThemePartSummary {
  const theme = /<a:theme\b[^>]*\bname="([^"]*)"/.exec(xml);
  if (!theme) throw new Error('no a:theme element in theme part');

  const colors: Record<string, string> = {};
  const scheme = /<a:clrScheme\b[^>]*>([\s\S]*?)<\/a:clrScheme>/.exec(xml);
  if (scheme) {
    for (const m of scheme[1].matchAll(
      /<a:(\w+)><a:srgbClr val="([0-9A-Fa-f]{6})"/g
    )) {
      colors[m[1]] = m[2].toUpperCase();
    }
    for (const m of scheme[1].matchAll(
      /<a:(\w+)><a:sysClr [^>]*lastClr="([0-9A-Fa-f]{6})"/g
    )) {
      colors[m[1]] = `sys:${m[2].toUpperCase()}`;
    }
  }

  const latin = (collection: 'majorFont' | 'minorFont'): string | undefined => {
    const m = new RegExp(`<a:${collection}><a:latin typeface="([^"]*)"`).exec(
      xml
    );
    return m ? unescape(m[1]) : undefined;
  };

  return {
    name: unescape(theme[1]),
    colors,
    headings: latin('majorFont'),
    body: latin('minorFont'),
  };
}

/** What the bundled `consulting` theme's part says, as summarized above. */
export const CONSULTING_THEME_PART: ThemePartSummary = {
  name: 'consulting',
  colors: {
    dk1: '1A1F26',
    lt1: 'FFFFFF',
    dk2: '4B5563',
    lt2: 'F2F4F7',
    accent1: '1A1F26',
    accent2: '4B5563',
    accent3: '1B4F8A',
    accent4: '5B8DC9',
    accent5: 'A9C4E4',
    accent6: '7B8794',
    hlink: '0563C1',
    folHlink: '954F72',
  },
  headings: 'Arial',
  body: 'Calibri',
};

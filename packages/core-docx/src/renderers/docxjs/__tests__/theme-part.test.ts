/**
 * The Word theme on docx.js: `word/theme/theme1.xml` carries the IR theme,
 * and nothing else in the package changes with it.
 *
 * docx.js writes a theme part on every document since 9.8.0. Handing it the
 * IR theme must move that part and only that part — no relationship, content
 * type or other part may notice — since nothing this adapter writes refers to
 * the theme outside a native chart's part, and that names slots (Text 1,
 * Background 1), not their values.
 *
 * One exception, docx.js's own: since 9.14.0 it writes Word's `Caption` style,
 * whose colour names the Text 2 slot (`w:themeColor="dark2"`) and also carries
 * that slot's value as `w:val`, as Word does. Word and LibreOffice take the
 * slot; the value is a fallback, and it follows the theme. That one attribute
 * is the only thing outside the theme part allowed to move.
 */

import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { compileDocumentToIr } from '../../../core/generateFromIr';
import { createDocxJsRenderer } from '../index';
import type { DocxIR } from '../../../ir/types';
import type { ReportComponentDefinition } from '../../../types';
import {
  CONSULTING_THEME_PART,
  summarizeThemePart,
} from '../../../__tests__/fixtures/themePart';

const THEME = 'word/theme/theme1.xml';
const STYLES = 'word/styles.xml';

/** The Text 2 value docx.js copies into its `Caption` style's colour. */
const CAPTION_COLOR =
  /(<w:style w:type="paragraph" w:styleId="Caption">.*?<w:color w:val=")([0-9A-F]{6})(" w:themeColor="dark2"\/>)/s;

function captionColor(styles: string | undefined): string | undefined {
  return CAPTION_COLOR.exec(styles ?? '')?.[2];
}

function withoutCaptionColor(styles: string | undefined): string {
  return (styles ?? '').replace(CAPTION_COLOR, '$1$3');
}

async function compile(theme: string): Promise<DocxIR> {
  const compiled = await compileDocumentToIr(
    {
      name: 'docx',
      props: { theme },
      children: [
        { name: 'heading', props: { text: 'Heading', level: 1 } },
        { name: 'paragraph', props: { text: 'Body text.' } },
      ],
    } as unknown as ReportComponentDefinition,
    { warnings: [] }
  );
  return compiled.ir;
}

async function parts(ir: DocxIR): Promise<Map<string, string>> {
  const zip = await JSZip.loadAsync(await createDocxJsRenderer().render(ir));
  const out = new Map<string, string>();
  for (const name of Object.keys(zip.files).sort()) {
    const entry = zip.files[name];
    if (!entry.dir) out.set(name, await entry.async('string'));
  }
  return out;
}

describe('theme part (docx.js)', () => {
  it('moves theme1.xml and nothing else', async () => {
    const ir = await compile('consulting');
    const themed = await parts(ir);
    const office = await parts({ ...ir, theme: undefined });

    expect([...themed.keys()]).toEqual([...office.keys()]);
    for (const [name, xml] of themed) {
      if (name === THEME) expect(xml, name).not.toEqual(office.get(name));
      else if (name === STYLES)
        expect(withoutCaptionColor(xml), name).toEqual(
          withoutCaptionColor(office.get(name))
        );
      else expect(xml, name).toEqual(office.get(name));
    }
    // The Caption fallback is each theme's Text 2: Office's, then consulting's.
    expect(captionColor(office.get(STYLES))).toBe('44546A');
    expect(captionColor(themed.get(STYLES))).toBe(
      CONSULTING_THEME_PART.colors.dk2
    );
    expect(themed.get('word/_rels/document.xml.rels')).toEqual(
      office.get('word/_rels/document.xml.rels')
    );
    expect(themed.get('[Content_Types].xml')).toEqual(
      office.get('[Content_Types].xml')
    );
  }, 60_000);

  it("carries the document's theme name, colours and fonts", async () => {
    const xml = (await parts(await compile('consulting'))).get(THEME) ?? '';

    expect(summarizeThemePart(xml)).toEqual(CONSULTING_THEME_PART);
    expect(xml).toContain(
      '<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="consulting">'
    );
    expect(xml).toContain('<a:majorFont><a:latin typeface="Arial"/>');
    expect(xml).toContain(
      '<a:minorFont><a:latin typeface="Calibri" panose="020F0502020204030204"/>'
    );
  }, 60_000);

  it("writes Office's theme when the IR has none", async () => {
    const ir = await compile('consulting');
    const xml = (await parts({ ...ir, theme: undefined })).get(THEME) ?? '';
    const summary = summarizeThemePart(xml);

    expect(summary.name).toBe('Office Theme');
    expect(summary.colors.dk1).toBe('sys:000000');
    expect(summary.headings).toBe('Calibri Light');
  }, 60_000);

  it("keeps PANOSE only for the role whose face is Office's own", async () => {
    // minimal sets Calibri for both roles: Office's minor face, not its major.
    const xml = (await parts(await compile('minimal'))).get(THEME) ?? '';

    expect(xml).toContain('<a:majorFont><a:latin typeface="Calibri"/>');
    expect(xml).toContain(
      '<a:minorFont><a:latin typeface="Calibri" panose="020F0502020204030204"/>'
    );
  }, 60_000);
});

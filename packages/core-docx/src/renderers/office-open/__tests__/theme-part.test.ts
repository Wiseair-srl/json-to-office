/**
 * The Word theme on `office-open`: the backend always writes Office's theme
 * part, and `themePart.ts` splices the IR theme into it.
 *
 * The splice must move that part and only that part, say what docx.js says
 * for the same IR — name, scheme colours, Latin faces — and fail loudly
 * rather than half-apply when the backend's part changes shape.
 */

import { describe, expect, it } from 'vitest';
import AdmZip from 'adm-zip';
import JSZip from 'jszip';
import { compileDocumentToIr } from '../../../core/generateFromIr';
import { resolveDocxRenderer } from '../../registry';
import { spliceTheme } from '../themePart';
import type { DocxIR, DocxIrTheme } from '../../../ir/types';
import type { DocxRenderer } from '../../types';
import type { ReportComponentDefinition } from '../../../types';
import {
  CONSULTING_THEME_PART,
  summarizeThemePart,
} from '../../../__tests__/fixtures/themePart';

const THEME = 'word/theme/theme1.xml';

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

async function parts(
  renderer: DocxRenderer,
  ir: DocxIR
): Promise<Map<string, string>> {
  const zip = await JSZip.loadAsync(await renderer.render(ir));
  const out = new Map<string, string>();
  for (const name of Object.keys(zip.files).sort()) {
    const entry = zip.files[name];
    if (!entry.dir) out.set(name, await entry.async('string'));
  }
  return out;
}

async function themePart(renderer: DocxRenderer, ir: DocxIR): Promise<string> {
  return (await parts(renderer, ir)).get(THEME) ?? '';
}

const renderers = async () => ({
  docxjs: await resolveDocxRenderer('docxjs'),
  officeOpen: await resolveDocxRenderer('office-open'),
});

describe('theme part (office-open)', () => {
  it('moves theme1.xml and nothing else', async () => {
    const { officeOpen } = await renderers();
    const ir = await compile('consulting');
    const themed = await parts(officeOpen, ir);
    const office = await parts(officeOpen, { ...ir, theme: undefined });

    expect([...themed.keys()]).toEqual([...office.keys()]);
    for (const [name, xml] of themed) {
      if (name === THEME) expect(xml, name).not.toEqual(office.get(name));
      else expect(xml, name).toEqual(office.get(name));
    }
    expect(themed.get('word/_rels/document.xml.rels')).toEqual(
      office.get('word/_rels/document.xml.rels')
    );
    expect(themed.get('[Content_Types].xml')).toEqual(
      office.get('[Content_Types].xml')
    );
    expect(summarizeThemePart(themed.get(THEME) ?? '')).toEqual(
      CONSULTING_THEME_PART
    );
  }, 60_000);

  it.each(['consulting', 'minimal'])(
    'says what docx.js says for %s',
    async (name) => {
      const { docxjs, officeOpen } = await renderers();
      const ir = await compile(name);
      expect(summarizeThemePart(await themePart(officeOpen, ir))).toEqual(
        summarizeThemePart(await themePart(docxjs, ir))
      );
    },
    60_000
  );

  it('escapes the name on both backends', async () => {
    const { docxjs, officeOpen } = await renderers();
    const compiled = await compile('consulting');
    if (!compiled.theme) throw new Error('the compiler set no theme');
    const name = 'A & "B" <c> $& $1';
    const ir = { ...compiled, theme: { ...compiled.theme, name } };

    for (const renderer of [docxjs, officeOpen]) {
      expect(summarizeThemePart(await themePart(renderer, ir)).name).toBe(name);
    }
  }, 60_000);

  it("keeps PANOSE only for the role whose face is Office's own", async () => {
    // minimal sets Calibri for both roles: Office's minor face, not its major.
    const { officeOpen } = await renderers();
    const xml = await themePart(officeOpen, await compile('minimal'));

    expect(xml).toContain('<a:majorFont><a:latin typeface="Calibri"/>');
    expect(xml).toContain(
      '<a:minorFont><a:latin typeface="Calibri" panose="020F0502020204030204"/>'
    );
  }, 60_000);
});

describe('spliceTheme', () => {
  const theme: DocxIrTheme = {
    name: 'consulting',
    colors: { accent1: { hex: '1A1F26' } },
  };

  it('fails when an element it writes is not there exactly once', () => {
    const zip = new AdmZip();
    zip.addFile(
      THEME,
      Buffer.from(
        '<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Office Theme"><a:themeElements><a:clrScheme name="Office"><a:dk1><a:srgbClr val="000000"/></a:dk1></a:clrScheme></a:themeElements></a:theme>',
        'utf8'
      )
    );
    expect(() => spliceTheme(zip, theme)).toThrow(/accent1/);
  }, 60_000);

  it('fails when the backend wrote no theme part', () => {
    expect(() => spliceTheme(new AdmZip(), theme)).toThrow(/theme1/);
  }, 60_000);
});

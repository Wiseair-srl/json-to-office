/**
 * A table in a section header or footer takes the same `componentDefaults`
 * cascade as a body table: theme `componentDefaults.table`, then the
 * document's `componentDefaults`, then the table's own props.
 */
import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import { generateBufferFromJson } from '../core/generator';
import { minimalTheme } from '../templates/themes';
import type { ThemeConfig } from '../styles';

const theme = {
  ...minimalTheme,
  name: 'chrome-tables',
  componentDefaults: {
    table: {
      hideBorders: true,
      cellDefaults: { horizontalAlignment: 'right' },
    },
  },
} as ThemeConfig;

const table = (props: Record<string, unknown> = {}) => ({
  name: 'table',
  props: {
    columns: [
      { cells: [{ content: 'Left' }] },
      { cells: [{ content: 'Right' }] },
    ],
    ...props,
  },
});

async function generate(
  section: Record<string, unknown>,
  renderer: 'docxjs' | 'office-open',
  documentProps: Record<string, unknown> = {}
) {
  const buf = await generateBufferFromJson(
    {
      name: 'docx',
      props: { theme: 'chrome-tables', ...documentProps },
      children: [{ name: 'section', ...section }],
    } as any,
    { renderer, customThemes: { 'chrome-tables': theme } }
  );
  const zip = await JSZip.loadAsync(buf);
  const part = async (re: RegExp) => {
    const files = zip.file(re);
    return files.length ? files[0].async('string') : undefined;
  };
  return {
    body: (await part(/^word\/document\.xml$/))!,
    header: await part(/^word\/header\d+\.xml$/),
    footer: await part(/^word\/footer\d+\.xml$/),
  };
}

const tableXml = (xml: string | undefined) =>
  xml?.match(/<w:tbl>[\s\S]*?<\/w:tbl>/)?.[0];
const cellsOf = (xml: string | undefined) =>
  [...(tableXml(xml) ?? '').matchAll(/<w:tc>[\s\S]*?<\/w:tc>/g)].map(
    ([cell]) => cell
  );

describe.each(['docxjs', 'office-open'] as const)(
  'componentDefaults.table in page chrome (%s)',
  (renderer) => {
    it('applies the theme defaults to a footer table', async () => {
      const { footer, body } = await generate(
        { props: { footer: [table()] }, children: [table()] },
        renderer
      );
      const cells = cellsOf(footer);
      expect(cells).toHaveLength(2);
      for (const cell of cells) {
        expect(cell).toContain('<w:jc w:val="right"/>');
        const borders = cell.match(
          /<w:tcBorders>([\s\S]*?)<\/w:tcBorders>/
        )?.[1];
        for (const side of ['top', 'left', 'bottom', 'right'])
          expect(borders).toMatch(new RegExp(`<w:${side} [^>]*w:val="none"`));
      }
      // The same table in the body and in the footer is the same table.
      expect(tableXml(footer)).toBe(tableXml(body));
    });

    it('leaves a body table unchanged', async () => {
      const withFooter = await generate(
        { props: { footer: [table()] }, children: [table()] },
        renderer
      );
      const withoutFooter = await generate({ children: [table()] }, renderer);
      expect(tableXml(withFooter.body)).toBe(tableXml(withoutFooter.body));
    });

    it('lets document defaults and the table props win, as in the body', async () => {
      const documentDefaults = {
        componentDefaults: {
          table: { cellDefaults: { horizontalAlignment: 'center' } },
        },
      };
      const body = [{ name: 'paragraph', props: { text: 'Body' } }];
      const fromDocument = await generate(
        { props: { header: [table()] }, children: body },
        renderer,
        documentDefaults
      );
      const headerCells = cellsOf(fromDocument.header);
      expect(headerCells).toHaveLength(2);
      for (const cell of headerCells)
        expect(cell).toContain('<w:jc w:val="center"/>');

      const fromProps = await generate(
        {
          props: {
            footer: [table({ cellDefaults: { horizontalAlignment: 'left' } })],
          },
          children: body,
        },
        renderer,
        documentDefaults
      );
      expect(cellsOf(fromProps.footer)).toHaveLength(2);
      for (const cell of cellsOf(fromProps.footer))
        expect(cell).toMatch(/<w:jc w:val="(?:left|start)"\/>/);
    });
  }
);

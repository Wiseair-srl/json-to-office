/**
 * `text-box` with `renderAs: 'shape'` emits a native Word text box (a WPS
 * shape) instead of the default borderless one-cell table. It gains real wrap
 * modes and z-order and loses autofit, per-side borders and lazy percentages —
 * so anything it cannot express falls back to the table path with a warning
 * rather than emitting a shape that clips its own content.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import JSZip from 'jszip';
import { Paragraph, Table } from 'docx';
import { generateBufferFromJson } from '../../core/generator';
import { renderTextBoxComponent } from '../text-box';
import { minimalTheme } from '../../templates/themes';
import { getAvailableWidthTwips } from '../../utils/widthUtils';
import type { TextBoxComponentDefinition, RenderContext } from '../../types';

const context: RenderContext = {
  theme: { name: 'minimal', colors: {}, fonts: {}, spacing: {} },
  fullTheme: minimalTheme,
  document: { title: 'Test', date: new Date() },
  section: { currentLayout: 'single', columnCount: 1, pageNumber: 1 },
  utils: {
    formatDate: (date: Date) => date.toISOString(),
    parseText: (text: string) => [{ text }],
    getStyle: (name: string) => ({ name }),
  },
  depth: 0,
} as unknown as RenderContext;

const paragraphChild = {
  name: 'paragraph',
  props: { text: 'Boxed text.' },
};

function textBox(
  props: Record<string, unknown>,
  children: unknown[] = [paragraphChild]
): TextBoxComponentDefinition {
  return {
    name: 'text-box',
    props,
    children,
  } as unknown as TextBoxComponentDefinition;
}

function render(component: TextBoxComponentDefinition) {
  return renderTextBoxComponent(component, minimalTheme, 'minimal', context);
}

async function documentXml(children: unknown[]): Promise<string> {
  const buf = await generateBufferFromJson({
    name: 'docx',
    props: { theme: 'minimal' },
    children,
  } as never);
  const zip = await JSZip.loadAsync(buf);
  return zip.file('word/document.xml')!.async('string');
}

function shapeXml(xml: string): string {
  const match = xml.match(/<wps:wsp>[\s\S]*?<\/wps:wsp>/);
  expect(match, 'no wps:wsp in document.xml').not.toBeNull();
  return match![0];
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('text-box renderAs default', () => {
  it('still renders a table when renderAs is absent', async () => {
    const result = await render(textBox({ width: 200 }));
    expect(result).toHaveLength(1);
    expect(result[0]).toBeInstanceOf(Table);
  });

  it('still renders a table for an explicit renderAs: table', async () => {
    const result = await render(textBox({ renderAs: 'table', width: 200 }));
    expect(result[0]).toBeInstanceOf(Table);
  });
});

describe('text-box renderAs shape', () => {
  it('hosts the shape in a single paragraph', async () => {
    const result = await render(
      textBox({ renderAs: 'shape', width: 200, height: 100 })
    );
    expect(result).toHaveLength(1);
    expect(result[0]).toBeInstanceOf(Paragraph);
  });

  it('writes a text box shape sized in EMU', async () => {
    const xml = await documentXml([
      textBox({ renderAs: 'shape', width: 200, height: 100 }),
    ]);

    const shape = shapeXml(xml);
    expect(shape).toContain('<wps:cNvSpPr txBox="1"/>');
    expect(shape).toContain('<a:ext cx="1905000" cy="952500"/>');
    expect(shape).toContain('<wps:txbx><w:txbxContent>');
    expect(shape).toContain('Boxed text.');
  });

  it('maps shading.fill to a solid fill', async () => {
    const xml = await documentXml([
      textBox({
        renderAs: 'shape',
        width: 200,
        height: 100,
        style: { shading: { fill: '#F0FDF4' } },
      }),
    ]);

    expect(shapeXml(xml)).toContain(
      '<a:solidFill><a:srgbClr val="F0FDF4"/></a:solidFill>'
    );
  });

  it('maps a border to a single outline in EMU', async () => {
    const xml = await documentXml([
      textBox({
        renderAs: 'shape',
        width: 200,
        height: 100,
        style: {
          border: {
            top: { style: 'solid', width: 2, color: '#16A34A' },
            right: { style: 'solid', width: 2, color: '#16A34A' },
            bottom: { style: 'solid', width: 2, color: '#16A34A' },
            left: { style: 'solid', width: 2, color: '#16A34A' },
          },
        },
      }),
    ]);

    expect(shapeXml(xml)).toContain(
      '<a:ln w="19050"><a:solidFill><a:srgbClr val="16A34A"/></a:solidFill></a:ln>'
    );
  });

  it('keeps the fill and drops the border when both are asked for', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const xml = await documentXml([
      textBox({
        renderAs: 'shape',
        width: 200,
        height: 100,
        style: {
          shading: { fill: '#F0FDF4' },
          border: { left: { style: 'solid', width: 3, color: '#16A34A' } },
        },
      }),
    ]);

    const shape = shapeXml(xml);
    expect(shape).toContain('<a:srgbClr val="F0FDF4"/>');
    expect(shape).not.toContain('<a:ln');
    expect(warn.mock.calls.flat().join(' ')).toContain(
      'cannot carry a fill and a border at once'
    );
  });

  it('warns and uses the first side when the borders differ', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const xml = await documentXml([
      textBox({
        renderAs: 'shape',
        width: 200,
        height: 100,
        style: {
          border: {
            top: { style: 'solid', width: 1, color: '#111111' },
            left: { style: 'solid', width: 4, color: '#222222' },
          },
        },
      }),
    ]);

    expect(shapeXml(xml)).toContain('<a:srgbClr val="111111"/>');
    expect(warn.mock.calls.flat().join(' ')).toContain(
      'using the first declared border side and ignoring left'
    );
  });

  it('drops the outline entirely for style: none', async () => {
    const xml = await documentXml([
      textBox({
        renderAs: 'shape',
        width: 200,
        height: 100,
        style: { border: { top: { style: 'none' } } },
      }),
    ]);

    expect(shapeXml(xml)).not.toContain('<a:ln');
  });

  it('maps padding to body-property insets in EMU', async () => {
    const xml = await documentXml([
      textBox({
        renderAs: 'shape',
        width: 200,
        height: 100,
        style: { padding: { top: 6, right: 8, bottom: 6, left: 8 } },
      }),
    ]);

    expect(shapeXml(xml)).toContain(
      '<wps:bodyPr lIns="76200" rIns="76200" tIns="57150" bIns="57150"/>'
    );
  });

  it('anchors a floating shape and inlines a non-floating one', async () => {
    const inline = await documentXml([
      textBox({ renderAs: 'shape', width: 200, height: 100 }),
    ]);
    expect(inline).toContain('<wp:inline');
    expect(inline).not.toContain('<wp:anchor');

    const floated = await documentXml([
      textBox({
        renderAs: 'shape',
        width: 200,
        height: 100,
        floating: {
          horizontalPosition: { relative: 'margin', align: 'right' },
          verticalPosition: { relative: 'paragraph', offset: 720 },
          wrap: { type: 'square' },
        },
      }),
    ]);
    expect(floated).toContain('<wp:anchor');
    expect(floated).toContain('<wp:align>right</wp:align>');
    // 720 twips = 457200 EMU
    expect(floated).toContain('<wp:posOffset>457200</wp:posOffset>');
    expect(floated).toContain('<wp:wrapSquare');
  });

  it('resolves a percentage width eagerly and warns', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const xml = await documentXml([
      textBox({ renderAs: 'shape', width: '50%', height: 100 }),
    ]);

    // Half the page's content box, converted twips → px → EMU.
    const halfContentPx = Math.round(
      getAvailableWidthTwips(minimalTheme, 'minimal') / 2 / 15
    );
    expect(shapeXml(xml)).toContain(`cx="${halfContentPx * 9525}"`);
    expect(warn.mock.calls.flat().join(' ')).toContain(
      'resolves percentage sizes at generation time'
    );
  });
});

describe('text-box renderAs shape fallbacks', () => {
  it('falls back to the table path when height is missing', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const result = await render(textBox({ renderAs: 'shape', width: 200 }));

    expect(result[0]).toBeInstanceOf(Table);
    expect(warn.mock.calls.flat().join(' ')).toContain(
      'needs an explicit width and height'
    );
  });

  it('falls back to the table path for nested columns', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const result = await render(
      textBox({ renderAs: 'shape', width: 200, height: 100 }, [
        {
          name: 'columns',
          props: { columns: 2 },
          children: [
            { name: 'paragraph', props: { text: 'Left' } },
            { name: 'paragraph', props: { text: 'Right' } },
          ],
        },
      ])
    );

    expect(result).toHaveLength(1);
    expect(result[0]).toBeInstanceOf(Table);
    expect(warn.mock.calls.flat().join(' ')).toContain(
      'requires paragraph-only content'
    );
  });

  it.each(['dashed', 'dotted', 'double'])(
    'falls back to the table path for a %s border rather than drawing it solid',
    async (style) => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const result = await render(
        textBox({
          renderAs: 'shape',
          width: 200,
          height: 100,
          style: { border: { top: { style, width: 2, color: '#16A34A' } } },
        })
      );

      expect(result[0]).toBeInstanceOf(Table);
      expect(warn.mock.calls.flat().join(' ')).toContain(
        `cannot draw a ${style} border`
      );
    }
  );

  it('renders each child exactly once when falling back', async () => {
    // A child rendered twice registers its bookmark twice, and the registry
    // reports that as a duplicate — the observable symptom of a fallback that
    // re-renders content the shape attempt already built.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await documentXml([
      textBox({ renderAs: 'shape', width: 200, height: 100 }, [
        {
          name: 'columns',
          props: { columns: 2 },
          children: [
            { name: 'heading', id: 'boxed-heading', props: { text: 'Boxed' } },
            { name: 'paragraph', props: { text: 'Right' } },
          ],
        },
      ]),
    ]);

    expect(warn.mock.calls.flat().join(' ')).not.toContain(
      'Duplicate bookmark ID'
    );
  });
});

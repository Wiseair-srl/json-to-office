/**
 * A border's `w:val`, through both backends.
 *
 * Two vocabularies meet here. A component authors its border the CSS way —
 * `solid`, `dashed`, `dotted`, `double`, `none` — and a theme states OOXML's
 * own words. `w:val` only takes the second: ST_Border has no `solid`.
 *
 * The compiler used to pass a text box's authored word into the IR. docx.js
 * drew the word it did not know as `single`; office-open wrote
 * `<w:top w:val="solid" …/>`, and LibreOffice drew no border around the box at
 * all. The corpus goldens could not see it — they record the default
 * backend's bytes, and those were right — so the border is asserted directly,
 * on both backends, from the same document.
 */

import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { DOCX_RENDERER_IDS } from '@json-to-office/shared-docx';
import {
  compileDocumentToIr,
  generateBufferViaIr,
} from '../core/generateFromIr';
import type { DocxIrBlock } from '../ir/types';
import { validateDocxIr } from '../ir/validation';
import type { ThemeConfig } from '../styles';
import { minimalTheme } from '../templates/themes';
import { CORPUS } from './fixtures/corpus';

const blue = (style: string) => ({ style, width: 1, color: '#0000FF' });

function boxed(border: Record<string, unknown>) {
  return {
    name: 'docx',
    props: { theme: 'minimal' },
    children: [
      {
        name: 'section',
        children: [
          {
            name: 'text-box',
            props: { style: { border } },
            children: [{ name: 'paragraph', props: { text: 'Boxed.' } }],
          },
        ],
      },
    ],
  };
}

/** Every side authored `solid`: the report that found the leak. */
const SOLID = boxed({
  top: blue('solid'),
  bottom: blue('solid'),
  left: blue('solid'),
  right: blue('solid'),
});

async function part(
  document: unknown,
  renderer: string,
  name: string,
  customThemes?: Record<string, ThemeConfig>
): Promise<string> {
  const { buffer } = await generateBufferViaIr(
    structuredClone(document) as never,
    { renderer: renderer as never, ...(customThemes ? { customThemes } : {}) }
  );
  const zip = await JSZip.loadAsync(buffer);
  return zip.file(name)!.async('string');
}

/** The one cell's `w:tcBorders` — the text box's own border. */
function cellBorders(xml: string): string {
  const all = xml.match(/<w:tcBorders>[\s\S]*?<\/w:tcBorders>/g) ?? [];
  expect(all, 'expected exactly one bordered cell').toHaveLength(1);
  return all[0];
}

/** `w:val` per side, read off a border set. */
function values(borders: string): Record<string, string> {
  return Object.fromEntries(
    [...borders.matchAll(/<w:(\w+) w:val="([^"]*)"/g)].map(([, side, val]) => [
      side,
      val,
    ])
  );
}

describe('text-box borders', () => {
  it('reach the IR as `single`, not as the authored `solid`', async () => {
    const { ir } = await compileDocumentToIr(structuredClone(SOLID) as never);
    const [table] = ir.sections[0].children as DocxIrBlock[];
    expect(table.kind).toBe('table');
    const cell = table.kind === 'table' ? table.rows[0].cells[0] : undefined;

    expect(cell?.borders).toEqual({
      top: expect.objectContaining({ style: 'single' }),
      right: expect.objectContaining({ style: 'single' }),
      bottom: expect.objectContaining({ style: 'single' }),
      left: expect.objectContaining({ style: 'single' }),
    });
  });

  it.each(DOCX_RENDERER_IDS)(
    '%s writes a solid side as w:val="single"',
    async (renderer) => {
      const xml = await part(SOLID, renderer, 'word/document.xml');
      const borders = cellBorders(xml);

      expect(values(borders)).toEqual({
        top: 'single',
        left: 'single',
        bottom: 'single',
        right: 'single',
      });
      // 1pt in eighths of a point, in the authored colour.
      expect(borders.match(/w:sz="8"/g)).toHaveLength(4);
      expect(borders.match(/w:color="0000FF"/g)).toHaveLength(4);
      expect(xml).not.toContain('w:val="solid"');
    }
  );

  it.each(DOCX_RENDERER_IDS)(
    '%s spells the rest of the vocabulary as OOXML does',
    async (renderer) => {
      const xml = await part(
        boxed({
          top: blue('none'),
          right: blue('dashed'),
          bottom: blue('double'),
          left: blue('dotted'),
        }),
        renderer,
        'word/document.xml'
      );

      expect(values(cellBorders(xml))).toEqual({
        top: 'none',
        left: 'dotted',
        bottom: 'double',
        right: 'dashed',
      });
    }
  );

  it('writes byte-identical cell borders on both backends', async () => {
    // As for the divider: small enough to agree exactly, and saying so is
    // what makes the next divergence visible.
    const [docxjs, officeOpen] = await Promise.all([
      part(SOLID, 'docxjs', 'word/document.xml'),
      part(SOLID, 'office-open', 'word/document.xml'),
    ]);

    expect(cellBorders(officeOpen)).toBe(cellBorders(docxjs));
  });
});

describe('theme borders', () => {
  function ruled(theme: string, themeOverrides?: unknown) {
    return {
      name: 'docx',
      props: { theme, ...(themeOverrides ? { themeOverrides } : {}) },
      children: [{ name: 'paragraph', props: { text: 'Ruled.' } }],
    };
  }

  /** The `w:pBdr` of the Normal style. */
  function normalBorders(styles: string): string {
    const normal = styles.match(
      /<w:style [^>]*w:styleId="Normal"[\s\S]*?<\/w:style>/
    );
    expect(normal, 'no Normal style').not.toBeNull();
    const borders = normal![0].match(/<w:pBdr>[\s\S]*?<\/w:pBdr>/);
    expect(borders, 'Normal carries no pBdr').not.toBeNull();
    return borders![0];
  }

  it.each(DOCX_RENDERER_IDS)(
    '%s writes a theme border style as the theme states it',
    async (renderer) => {
      // Already OOXML's words. docx.js used to draw anything outside a
      // six-word map as `single`, so these two came out plain there and as
      // asked on office-open.
      const styles = await part(
        ruled('minimal', {
          styles: {
            normal: {
              borders: {
                top: { style: 'wave', size: 6, color: '#E6620C' },
                bottom: { style: 'triple', size: 4, color: '#E6620C' },
              },
            },
          },
        }),
        renderer,
        'word/styles.xml'
      );

      expect(values(normalBorders(styles))).toEqual({
        top: 'wave',
        bottom: 'triple',
      });
    }
  );

  it.each(DOCX_RENDERER_IDS)(
    '%s draws a word outside ST_Border as `single`',
    async (renderer) => {
      // A theme handed over as an object is not validated on the way in, so
      // the schema's own guard never runs on it.
      const theme = structuredClone(minimalTheme) as ThemeConfig;
      (theme.styles as Record<string, any>).normal.borders = {
        top: { style: 'solid', size: 6, color: '#E6620C' },
      };
      const styles = await part(ruled('ruled'), renderer, 'word/styles.xml', {
        ruled: theme,
      });

      expect(values(normalBorders(styles))).toEqual({ top: 'single' });
    }
  );
});

describe('the corpus', () => {
  it('compiles every border it draws in OOXML vocabulary', async () => {
    const violations: string[] = [];
    for (const testCase of CORPUS) {
      const { ir } = await compileDocumentToIr(
        structuredClone(testCase.document) as never,
        { warnings: [] }
      );
      for (const { path, message } of validateDocxIr(ir)) {
        if (path.includes('borders.')) {
          violations.push(`${testCase.name}: ${path}: ${message}`);
        }
      }
    }

    expect(violations).toEqual([]);
  }, 120_000);
});

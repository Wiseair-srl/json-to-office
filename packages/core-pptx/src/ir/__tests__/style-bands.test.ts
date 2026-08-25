/**
 * Where a named style puts a text box that gives no coordinates.
 *
 * Every positionless text box used to resolve to (0, 0), so a title slide with
 * a `title` and a `subtitle` — the shape both shipped starters had — drew both
 * blocks on top of each other in the top-left corner. A style names a role and
 * a role has a place on the slide, so each named style carries a default band;
 * what is worth pinning here is that the bands differ where they have to, that
 * an authored coordinate still wins on its own axis, and that the case no band
 * can fix is reported rather than drawn in silence.
 */

import { describe, expect, it } from 'vitest';
import { compileDocumentToIr } from '../../core/generateFromIr';
import type { PresentationComponentDefinition } from '../../types';
import { EMU_PER_INCH } from '../types';
import type { PptxIrTextBoxElement } from '../types';

const WIDTH_INCHES = 13.333;
const HEIGHT_INCHES = 7.5;

function deck(children: unknown[]): PresentationComponentDefinition {
  return {
    name: 'pptx',
    props: {
      title: 'Bands',
      slideWidth: WIDTH_INCHES,
      slideHeight: HEIGHT_INCHES,
    },
    children,
  } as PresentationComponentDefinition;
}

const text = (props: Record<string, unknown>): unknown => ({
  name: 'text',
  props,
});

async function boxes(
  children: unknown[]
): Promise<{ elements: PptxIrTextBoxElement[]; codes: string[] }> {
  const { ir, warnings } = await compileDocumentToIr(
    deck([{ name: 'slide', children }])
  );
  return {
    elements: ir.slides[0].elements as PptxIrTextBoxElement[],
    codes: warnings.map((warning) => warning.code as string),
  };
}

describe('named styles carry a default band', () => {
  it('separates a title from its subtitle on one slide', async () => {
    const { elements, codes } = await boxes([
      text({ text: 'Quarterly review', style: 'title' }),
      text({ text: 'Where we are', style: 'subtitle' }),
    ]);

    const [title, subtitle] = elements;
    // The defect this fixes: both used to sit at y = 0, one over the other.
    expect(title.transform.yEmu).toBeGreaterThan(0);
    expect(subtitle.transform.yEmu).toBeGreaterThan(
      title.transform.yEmu + title.transform.heightEmu
    );
    expect(codes).not.toContain('TEXT_OVERLAP_UNPOSITIONED');
  });

  it('keeps a heading clear of the top edge and of the body under it', async () => {
    const { elements, codes } = await boxes([
      text({ text: 'Agenda', style: 'heading1' }),
      text({ text: 'Results\nRisks', style: 'body' }),
    ]);

    const [heading, body] = elements;
    expect(heading.transform.xEmu).toBeGreaterThan(0);
    expect(heading.transform.yEmu).toBeGreaterThan(0);
    expect(body.transform.yEmu).toBeGreaterThan(
      heading.transform.yEmu + heading.transform.heightEmu
    );
    expect(codes).not.toContain('TEXT_OVERLAP_UNPOSITIONED');
  });

  it('keeps every band inside the slide', async () => {
    const { elements } = await boxes(
      [
        'title',
        'subtitle',
        'heading1',
        'heading2',
        'heading3',
        'body',
        'caption',
      ].map((style) => text({ text: style, style }))
    );

    for (const element of elements) {
      expect(element.transform.xEmu).toBeGreaterThanOrEqual(0);
      expect(
        element.transform.xEmu + element.transform.widthEmu
      ).toBeLessThanOrEqual(WIDTH_INCHES * EMU_PER_INCH);
      expect(
        element.transform.yEmu + element.transform.heightEmu
      ).toBeLessThanOrEqual(HEIGHT_INCHES * EMU_PER_INCH);
    }
  });

  it('scales the band with the slide rather than pinning inches', async () => {
    const { ir } = await compileDocumentToIr({
      name: 'pptx',
      props: { title: 'Small', slideWidth: 10, slideHeight: 7.5 },
      children: [
        { name: 'slide', children: [text({ text: 'T', style: 'title' })] },
      ],
    } as PresentationComponentDefinition);

    const wide = (await boxes([text({ text: 'T', style: 'title' })]))
      .elements[0];
    const narrow = ir.slides[0].elements[0] as PptxIrTextBoxElement;

    expect(narrow.transform.xEmu).toBeLessThan(wide.transform.xEmu);
    // Same slide height, so the band lands at the same distance down.
    expect(narrow.transform.yEmu).toBe(wide.transform.yEmu);
  });

  it('leaves an unstyled text box at the origin it has always had', async () => {
    const { elements } = await boxes([text({ text: 'Bare' })]);

    expect(elements[0].transform.xEmu).toBe(0);
    expect(elements[0].transform.yEmu).toBe(0);
  });

  it('lets an authored coordinate win on its own axis', async () => {
    const { elements } = await boxes([
      text({ text: 'Half-placed', style: 'title', x: 1 }),
    ]);

    expect(elements[0].transform.xEmu).toBe(EMU_PER_INCH);
    // `y` was never stated, so the band still answers for it.
    expect(elements[0].transform.yEmu).toBeGreaterThan(0);
  });
});

describe('overlapping text nobody positioned', () => {
  it('reports two boxes of the same style landing in one band', async () => {
    const { codes } = await boxes([
      text({ text: 'First', style: 'body' }),
      text({ text: 'Second', style: 'body' }),
    ]);

    expect(codes).toContain('TEXT_OVERLAP_UNPOSITIONED');
  });

  it('says nothing when one of the two was placed by hand', async () => {
    const { codes } = await boxes([
      text({ text: 'First', style: 'body' }),
      text({ text: 'Second', style: 'body', x: 0.5, y: 5 }),
    ]);

    // An overlap involving an authored position is a composition, not an
    // accident, so it is not this warning's business.
    expect(codes).not.toContain('TEXT_OVERLAP_UNPOSITIONED');
  });

  it('does not carry an overlap across a slide boundary', async () => {
    const { warnings } = await compileDocumentToIr(
      deck([
        { name: 'slide', children: [text({ text: 'A', style: 'body' })] },
        { name: 'slide', children: [text({ text: 'B', style: 'body' })] },
      ])
    );

    expect(warnings.map((warning) => warning.code)).not.toContain(
      'TEXT_OVERLAP_UNPOSITIONED'
    );
  });
});

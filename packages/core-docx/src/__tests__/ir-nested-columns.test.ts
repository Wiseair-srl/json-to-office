/**
 * `columns` nested inside a text box, through the IR path.
 *
 * At the top level a `columns` component becomes a section with a real column
 * layout, which the layout stage resolves before the compiler ever sees it —
 * the corpus covers that thoroughly. Inside a text box there is no section to
 * give and the columns become table cells instead, which is a different code
 * path and the one checked here.
 */

import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { generateBufferFromJson } from '../core/generator';
import { generateBufferViaIr } from '../core/generateFromIr';

function sha256(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}

async function expectParity(document: unknown): Promise<void> {
  const legacy = (await generateBufferFromJson(
    structuredClone(document) as never,
    { validation: { enabled: false } }
  )) as Buffer;
  const { buffer } = await generateBufferViaIr(
    structuredClone(document) as never
  );

  expect(sha256(buffer)).toBe(sha256(legacy));
}

const textBox = (columns: unknown, children: unknown[]) => ({
  name: 'docx',
  props: { title: 'Nested columns' },
  children: [
    {
      name: 'text-box',
      props: { style: { padding: { top: 6, right: 6, bottom: 6, left: 6 } } },
      children: [{ name: 'columns', props: columns, children }],
    },
  ],
});

const p = (text: string) => ({ name: 'paragraph', props: { text } });

describe('nested columns through DocxIR', () => {
  it('renders an equal-width count the same as the pre-IR writer', async () => {
    await expectParity(
      textBox({ columns: 2 }, [p('Left side.'), p('Right side.')])
    );
  }, 30_000);

  it('renders explicit widths and gaps the same', async () => {
    await expectParity(
      textBox(
        {
          columns: [
            { width: 200, gap: 24 },
            { width: '30%' },
            { width: 'auto' },
          ],
        },
        [p('One.'), p('Two.'), p('Three.'), p('Four.')]
      )
    );
  }, 30_000);

  it('renders a column with nothing dealt to it the same', async () => {
    await expectParity(textBox({ columns: 3, gap: 36 }, [p('Only one item.')]));
  }, 30_000);
});

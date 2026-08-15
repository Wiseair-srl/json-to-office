import JSZip from 'jszip';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { generateBufferFromJson } from '../generator';
import type { PresentationComponentDefinition } from '../../types';

const document: PresentationComponentDefinition = {
  name: 'pptx',
  props: { title: 'Deterministic deck', author: 'JTO' },
  children: [
    {
      name: 'slide',
      props: {},
      children: [
        { name: 'text', props: { text: 'Same input' } },
        {
          name: 'chart',
          props: {
            type: 'bar',
            data: [{ name: 'Series', labels: ['A'], values: [1] }],
          },
        },
      ],
    },
  ],
};

describe('deterministic PPTX packaging', () => {
  it('produces identical bytes for repeated generation by default', async () => {
    const first = await generateBufferFromJson(document);
    const second = await generateBufferFromJson(document);

    const firstZip = await JSZip.loadAsync(first);
    const secondZip = await JSZip.loadAsync(second);
    const differences: string[] = [];
    const paths = new Set([
      ...Object.keys(firstZip.files),
      ...Object.keys(secondZip.files),
    ]);
    for (const path of paths) {
      if (!firstZip.files[path] || !secondZip.files[path]) {
        differences.push(path);
        continue;
      }
      if (firstZip.files[path].dir) continue;
      const firstEntry = await firstZip.files[path].async('nodebuffer');
      const secondEntry = await secondZip.files[path].async('nodebuffer');
      const hash = (value: Buffer) =>
        createHash('sha256').update(value).digest('hex');
      if (hash(firstEntry) !== hash(secondEntry)) differences.push(path);
    }

    expect(differences).toEqual([]);
    expect(first.equals(second)).toBe(true);
  });

  it('uses generatedAt for core metadata and package entry timestamps', async () => {
    const generatedAt = '2024-06-07T08:09:10.000Z';
    const buffer = await generateBufferFromJson(document, { generatedAt });
    const zip = await JSZip.loadAsync(buffer);
    const coreXml = await zip.file('docProps/core.xml')!.async('string');

    expect(coreXml).toContain(
      '<dcterms:created xsi:type="dcterms:W3CDTF">2024-06-07T08:09:10Z</dcterms:created>'
    );
    expect(coreXml).toContain(
      '<dcterms:modified xsi:type="dcterms:W3CDTF">2024-06-07T08:09:10Z</dcterms:modified>'
    );
    expect(
      Object.values(zip.files).every(
        (entry) => entry.date.toISOString() === generatedAt
      )
    ).toBe(true);

    const workbookPath = Object.keys(zip.files).find((path) =>
      path.endsWith('.xlsx')
    );
    expect(workbookPath).toBeDefined();
    const workbook = await JSZip.loadAsync(
      await zip.file(workbookPath!)!.async('nodebuffer')
    );
    const workbookCore = await workbook
      .file('docProps/core.xml')!
      .async('string');
    expect(workbookCore).toContain('2024-06-07T08:09:10Z');
    expect(
      Object.values(workbook.files).every(
        (entry) => entry.date.toISOString() === generatedAt
      )
    ).toBe(true);
  });

  it('preserves runtime timestamps when deterministic packaging is disabled', async () => {
    const buffer = await generateBufferFromJson(document, {
      deterministic: false,
      generatedAt: '2024-06-07T08:09:10.000Z',
    });
    const zip = await JSZip.loadAsync(buffer);
    const coreXml = await zip.file('docProps/core.xml')!.async('string');

    expect(coreXml).not.toContain('2024-06-07T08:09:10Z');
    expect(
      Object.values(zip.files).some(
        (entry) => entry.date.toISOString() !== '2024-06-07T08:09:10.000Z'
      )
    ).toBe(true);
  });
});

import AdmZip from 'adm-zip';
import { describe, expect, it } from 'vitest';
import type { ReportComponentDefinition } from '../../types';
import { generateBufferFromJson } from '../generator';
import { clearComponentCache } from '../cached-render';

const document: ReportComponentDefinition = {
  name: 'docx',
  props: { theme: 'minimal' },
  children: [
    { name: 'heading', props: { level: 1, text: 'Stable build' } },
    {
      name: 'paragraph',
      props: { text: 'Same JSON, same bytes. Built {DATE} at {DATETIME}.' },
    },
    {
      name: 'paragraph',
      props: {
        text: 'Updated text',
        revision: {
          segments: [
            { type: 'delete', text: 'Old text' },
            { type: 'insert', text: 'Updated text' },
          ],
        },
      },
    },
  ],
};

describe('deterministic DOCX generation', () => {
  it('produces byte-identical output across repeated builds by default', async () => {
    const first = await generateBufferFromJson(document);
    const second = await generateBufferFromJson(document);

    expect(second.equals(first)).toBe(true);
  });

  it('uses generatedAt for normalized package metadata', async () => {
    const generatedAt = '2025-06-07T08:09:10.000Z';
    const buffer = await generateBufferFromJson(document, { generatedAt });
    const coreXml = new AdmZip(buffer)
      .getEntry('docProps/core.xml')
      ?.getData()
      .toString('utf8');

    expect(coreXml).toContain(
      `<dcterms:created xsi:type="dcterms:W3CDTF">${generatedAt}</dcterms:created>`
    );
    expect(coreXml).toContain(
      `<dcterms:modified xsi:type="dcterms:W3CDTF">${generatedAt}</dcterms:modified>`
    );

    const documentXml = new AdmZip(buffer)
      .getEntry('word/document.xml')
      ?.getData()
      .toString('utf8');
    expect(documentXml).toContain('2025-06-07');
    expect(documentXml).toContain('2025-06-07 08:09:10Z');
  });

  it('scopes cached nested placeholders to generatedAt', async () => {
    await clearComponentCache();
    const tableDocument: ReportComponentDefinition = {
      name: 'docx',
      props: {},
      children: [
        {
          name: 'section',
          props: {},
          children: [
            {
              name: 'table',
              props: {
                columns: [
                  {
                    header: { content: 'When' },
                    cells: [{ content: '{DATE}' }],
                  },
                ],
              },
            },
          ],
        },
      ],
    };

    const first = await generateBufferFromJson(tableDocument, {
      generatedAt: '2024-01-01T00:00:00Z',
    });
    const second = await generateBufferFromJson(tableDocument, {
      generatedAt: '2025-02-02T00:00:00Z',
    });
    const documentXml = (buffer: Buffer) =>
      new AdmZip(buffer)
        .getEntry('word/document.xml')
        ?.getData()
        .toString('utf8');

    expect(documentXml(first)).toContain('2024-01-01');
    expect(documentXml(second)).toContain('2025-02-02');
    expect(documentXml(second)).not.toContain('2024-01-01');
  });

  it('writes identical ZIP timestamps regardless of host timezone', async () => {
    // 02:30 on this date does not exist in America/New_York (DST spring
    // forward). Encoding the DOS field via a reconstructed local Date would
    // silently shift it an hour and break cross-host byte identity.
    const generatedAt = '2025-03-09T02:30:00.000Z';
    const original = process.env.TZ;
    const headerTimes: number[] = [];

    try {
      for (const timezone of [
        'UTC',
        'America/New_York',
        'Australia/Lord_Howe',
      ]) {
        process.env.TZ = timezone;
        const buffer = await generateBufferFromJson(document, { generatedAt });
        const entry = new AdmZip(buffer).getEntry('word/document.xml');
        headerTimes.push(
          (entry!.header as unknown as { timeval: number }).timeval
        );
      }
    } finally {
      if (original === undefined) delete process.env.TZ;
      else process.env.TZ = original;
    }

    expect(new Set(headerTimes).size).toBe(1);
  });

  it('rejects an invalid generatedAt value', async () => {
    await expect(
      generateBufferFromJson(document, { generatedAt: 'not-a-date' })
    ).rejects.toThrow('generatedAt must be a valid date');
  });

  it('re-registers numbering definitions on repeated cached renders', async () => {
    await clearComponentCache();
    const listDocument: ReportComponentDefinition = {
      name: 'docx',
      props: { theme: 'minimal' },
      children: [
        {
          name: 'list',
          props: { items: ['One', 'Two'], format: 'numbered' },
        },
        { name: 'paragraph', props: { text: '- Three\n- Four' } },
      ],
    };

    await generateBufferFromJson(listDocument);
    const second = await generateBufferFromJson(listDocument);
    const numberingXml = new AdmZip(second)
      .getEntry('word/numbering.xml')
      ?.getData()
      .toString('utf8');
    const documentXml = new AdmZip(second)
      .getEntry('word/document.xml')
      ?.getData()
      .toString('utf8');

    const references = new Set(
      [...(documentXml?.matchAll(/<w:numId w:val="(\d+)"/g) ?? [])].map(
        (match) => match[1]
      )
    );
    const definitions = new Set(
      [...(numberingXml?.matchAll(/<w:num w:numId="(\d+)"/g) ?? [])].map(
        (match) => match[1]
      )
    );
    expect(references.size).toBeGreaterThanOrEqual(2);
    expect([...references].every((id) => definitions.has(id))).toBe(true);
  });
});

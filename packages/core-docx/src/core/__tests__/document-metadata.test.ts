/**
 * Document Metadata Tests
 * Root `props.metadata` must reach Word's document properties.
 */

import AdmZip from 'adm-zip';
import { describe, expect, it } from 'vitest';
import type { ReportComponentDefinition } from '../../types';
import { generateBufferFromJson } from '../generator';

const documentWith = (
  metadata: Record<string, unknown>
): ReportComponentDefinition =>
  ({
    name: 'docx',
    props: { theme: 'minimal', metadata },
    children: [{ name: 'paragraph', props: { text: 'Body' } }],
  }) as ReportComponentDefinition;

const entryXml = (buffer: Buffer, path: string) =>
  new AdmZip(buffer).getEntry(path)?.getData().toString('utf8');

describe('document metadata', () => {
  it('writes metadata into docProps/core.xml', async () => {
    const buffer = await generateBufferFromJson(
      documentWith({
        title: 'Annual Report 2024',
        subtitle: 'Air quality & mobility',
        description: 'Yearly summary of network readings.',
        author: 'Wiseair',
        tags: ['air quality', 'annual'],
      })
    );

    const coreXml = entryXml(buffer, 'docProps/core.xml');

    expect(coreXml).toContain('<dc:title>Annual Report 2024</dc:title>');
    expect(coreXml).toContain(
      '<dc:subject>Air quality &amp; mobility</dc:subject>'
    );
    expect(coreXml).toContain(
      '<dc:description>Yearly summary of network readings.</dc:description>'
    );
    expect(coreXml).toContain('<dc:creator>Wiseair</dc:creator>');
    expect(coreXml).toContain('<cp:lastModifiedBy>Wiseair</cp:lastModifiedBy>');
    expect(coreXml).toContain('<cp:keywords>air quality, annual</cp:keywords>');
  });

  it('writes company and version as custom document properties', async () => {
    const buffer = await generateBufferFromJson(
      documentWith({ company: 'Wiseair S.r.l.', version: '2.1.0' })
    );
    const customXml = entryXml(buffer, 'docProps/custom.xml');

    expect(customXml).toContain(
      '<property fmtid="{D5CDD505-2E9C-101B-9397-08002B2CF9AE}" pid="2" name="Company"><vt:lpwstr>Wiseair S.r.l.</vt:lpwstr></property>'
    );
    expect(customXml).toContain(
      '<property fmtid="{D5CDD505-2E9C-101B-9397-08002B2CF9AE}" pid="3" name="Version"><vt:lpwstr>2.1.0</vt:lpwstr></property>'
    );
  });

  it('writes version even when company is absent', async () => {
    const buffer = await generateBufferFromJson(documentWith({ version: '7' }));

    expect(entryXml(buffer, 'docProps/custom.xml')).toContain(
      'name="Version"><vt:lpwstr>7</vt:lpwstr>'
    );
  });

  // Package timestamps belong to the `generatedAt` generation option; the
  // schema must not advertise metadata fields the pipeline cannot honor.
  it.each(['created', 'modified'])(
    'rejects metadata.%s instead of accepting it inertly',
    async (field) => {
      await expect(
        generateBufferFromJson(
          documentWith({ [field]: '2024-01-01T00:00:00Z' })
        )
      ).rejects.toThrow('Document validation failed');
    }
  );

  it('leaves core properties at docx defaults when metadata is absent', async () => {
    const buffer = await generateBufferFromJson({
      name: 'docx',
      props: { theme: 'minimal' },
      children: [{ name: 'paragraph', props: { text: 'Body' } }],
    } as ReportComponentDefinition);

    const coreXml = entryXml(buffer, 'docProps/core.xml');

    expect(coreXml).not.toContain('<dc:title>');
    expect(coreXml).not.toContain('<cp:keywords>');
  });

  it('keeps output byte-identical and dcterms owned by generatedAt', async () => {
    const generatedAt = '2025-06-07T08:09:10.000Z';
    const document = documentWith({
      title: 'Stable build',
      author: 'Wiseair',
      company: 'Wiseair S.r.l.',
      tags: ['one', 'two'],
    });

    const first = await generateBufferFromJson(document, { generatedAt });
    const second = await generateBufferFromJson(document, { generatedAt });

    expect(second.equals(first)).toBe(true);
    expect(entryXml(first, 'docProps/core.xml')).toContain(
      `<dcterms:created xsi:type="dcterms:W3CDTF">${generatedAt}</dcterms:created>`
    );
  });
});

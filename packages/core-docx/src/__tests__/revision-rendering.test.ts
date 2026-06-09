/**
 * Revision rendering: `revision` props must produce native OOXML tracked
 * changes (w:ins / w:del) and `trackRevisions` must reach settings.xml.
 */
import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import { generateBufferFromJson } from '../core/generator';

async function readZipEntry(buf: Buffer, path: string): Promise<string> {
  const zip = await JSZip.loadAsync(buf);
  const entry = zip.file(path);
  if (!entry) throw new Error(`${path} missing`);
  return entry.async('string');
}

const REVISION = {
  author: 'jto-agent',
  date: '2026-06-09T10:00:00Z',
  segments: [
    { type: 'equal', text: 'The fee is ' },
    { type: 'delete', text: '10%' },
    { type: 'insert', text: '12%' },
    { type: 'equal', text: ' of revenue.' },
  ],
};

describe('tracked-change rendering', () => {
  it('renders paragraph revision segments as w:ins and w:del', async () => {
    const buf = await generateBufferFromJson({
      name: 'docx',
      props: { theme: 'minimal' },
      children: [
        {
          name: 'paragraph',
          props: { text: 'The fee is 12% of revenue.', revision: REVISION },
        },
      ],
    } as any);
    const xml = await readZipEntry(buf, 'word/document.xml');
    expect(xml).toMatch(/<w:ins [^>]*w:author="jto-agent"/);
    expect(xml).toMatch(/<w:del [^>]*w:author="jto-agent"/);
    expect(xml).toContain('12%');
    expect(xml).toMatch(/<w:delText[^>]*>10%<\/w:delText>/);
  });

  it('renders heading revisions and keeps heading style', async () => {
    const buf = await generateBufferFromJson({
      name: 'docx',
      props: { theme: 'minimal' },
      children: [
        {
          name: 'heading',
          props: {
            text: 'New Title',
            level: 1,
            revision: {
              segments: [
                { type: 'delete', text: 'Old Title' },
                { type: 'insert', text: 'New Title' },
              ],
            },
          },
        },
      ],
    } as any);
    const xml = await readZipEntry(buf, 'word/document.xml');
    expect(xml).toContain('<w:ins ');
    expect(xml).toContain('<w:del ');
    expect(xml).toMatch(/<w:delText[^>]*>Old Title<\/w:delText>/);
  });

  it('renders list item revisions including fully deleted items', async () => {
    const buf = await generateBufferFromJson({
      name: 'docx',
      props: { theme: 'minimal' },
      children: [
        {
          name: 'list',
          props: {
            items: [
              { text: 'alpha', level: 0 },
              {
                text: '',
                level: 0,
                revision: { segments: [{ type: 'delete', text: 'beta' }] },
              },
              {
                text: 'gamma',
                level: 0,
                revision: { segments: [{ type: 'insert', text: 'gamma' }] },
              },
            ],
          },
        },
      ],
    } as any);
    const xml = await readZipEntry(buf, 'word/document.xml');
    expect(xml).toMatch(/<w:delText[^>]*>beta<\/w:delText>/);
    expect(xml).toContain('<w:ins ');
    expect(xml).toContain('gamma');
  });

  it('emits w:trackRevisions in settings.xml when trackRevisions is set', async () => {
    const buf = await generateBufferFromJson({
      name: 'docx',
      props: { theme: 'minimal', trackRevisions: true },
      children: [{ name: 'paragraph', props: { text: 'x' } }],
    } as any);
    const settings = await readZipEntry(buf, 'word/settings.xml');
    expect(settings).toContain('<w:trackRevisions/>');
  });

  it('does not emit w:trackRevisions by default', async () => {
    const buf = await generateBufferFromJson({
      name: 'docx',
      props: { theme: 'minimal' },
      children: [{ name: 'paragraph', props: { text: 'x' } }],
    } as any);
    const settings = await readZipEntry(buf, 'word/settings.xml');
    expect(settings).not.toContain('<w:trackRevisions/>');
  });

  it('renders \\n in segments as line breaks (w:br), not literal newlines', async () => {
    const buf = await generateBufferFromJson({
      name: 'docx',
      props: { theme: 'minimal' },
      children: [
        {
          name: 'paragraph',
          props: {
            text: 'line one\nline two',
            revision: {
              segments: [
                { type: 'equal', text: 'line one\nline two' },
                { type: 'insert', text: ' added' },
              ],
            },
          },
        },
      ],
    } as any);
    const xml = await readZipEntry(buf, 'word/document.xml');
    expect(xml).toContain('<w:br/>');
    expect(xml).not.toMatch(/<w:t[^>]*>line one\nline two<\/w:t>/);
  });

  it('resolves placeholders in unchanged (equal) segments', async () => {
    const buf = await generateBufferFromJson({
      name: 'docx',
      props: { theme: 'minimal' },
      children: [
        {
          name: 'paragraph',
          props: {
            text: 'Generated {YEAR} for final review',
            revision: {
              segments: [
                { type: 'equal', text: 'Generated {YEAR} for ' },
                { type: 'insert', text: 'final ' },
                { type: 'equal', text: 'review' },
              ],
            },
          },
        },
      ],
    } as any);
    const xml = await readZipEntry(buf, 'word/document.xml');
    expect(xml).not.toContain('{YEAR}');
    expect(xml).toContain(String(new Date().getFullYear()));
  });

  it('keeps the bookmark anchor on a revised paragraph with an id', async () => {
    const buf = await generateBufferFromJson({
      name: 'docx',
      props: { theme: 'minimal' },
      children: [
        {
          name: 'paragraph',
          props: { text: 'See [the target](#target) below.' },
        },
        {
          name: 'paragraph',
          props: {
            text: 'Target paragraph revised',
            id: 'target',
            revision: {
              segments: [
                { type: 'equal', text: 'Target paragraph ' },
                { type: 'insert', text: 'revised' },
              ],
            },
          },
        },
      ],
    } as any);
    const xml = await readZipEntry(buf, 'word/document.xml');
    expect(xml).toMatch(/<w:bookmarkStart[^>]*w:name="target"/);
  });

  it('bypasses the component cache for revisions nested in containers', async () => {
    const textBox = {
      name: 'text-box',
      props: {},
      children: [
        {
          name: 'paragraph',
          props: {
            text: 'inner',
            revision: { segments: [{ type: 'insert', text: 'inner' }] },
          },
        },
      ],
    };
    // Doc A primes the cache with the container's rendered (id-bearing) runs
    await generateBufferFromJson({
      name: 'docx',
      props: { theme: 'minimal' },
      children: [textBox],
    } as any);
    // Doc B renders another revision first, then the identical container:
    // a stale cache hit would replay duplicate ids
    const buf = await generateBufferFromJson({
      name: 'docx',
      props: { theme: 'minimal' },
      children: [
        {
          name: 'paragraph',
          props: {
            text: 'outer',
            revision: { segments: [{ type: 'insert', text: 'outer' }] },
          },
        },
        textBox,
      ],
    } as any);
    const xml = await readZipEntry(buf, 'word/document.xml');
    const ids = [...xml.matchAll(/<w:ins [^>]*w:id="(\d+)"/g)].map((m) => m[1]);
    expect(ids.length).toBe(2);
    expect(new Set(ids).size).toBe(2);
  });

  it('assigns unique revision ids within a document', async () => {
    const buf = await generateBufferFromJson({
      name: 'docx',
      props: { theme: 'minimal' },
      children: [
        {
          name: 'paragraph',
          props: {
            text: 'a',
            revision: { segments: [{ type: 'insert', text: 'a' }] },
          },
        },
        {
          name: 'paragraph',
          props: {
            text: 'b',
            revision: { segments: [{ type: 'insert', text: 'b' }] },
          },
        },
      ],
    } as any);
    const xml = await readZipEntry(buf, 'word/document.xml');
    const ids = [...xml.matchAll(/<w:ins [^>]*w:id="(\d+)"/g)].map((m) => m[1]);
    expect(ids.length).toBe(2);
    expect(new Set(ids).size).toBe(2);
  });
});

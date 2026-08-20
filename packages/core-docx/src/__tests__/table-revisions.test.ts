/**
 * Table revisions: row insert/delete (`w:trPr/w:ins` | `w:del`), cell text
 * revisions, and the paragraph-mark half that makes an accepted deletion
 * actually remove the row.
 */
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import JSZip from 'jszip';
import { generateBufferFromJson } from '../core/generator';

async function documentXml(table: unknown): Promise<string> {
  const buf = await generateBufferFromJson({
    name: 'docx',
    props: { theme: 'minimal', trackRevisions: true },
    children: [table],
  } as never);
  const zip = await JSZip.loadAsync(buf);
  return zip.file('word/document.xml')!.async('string');
}

function rows(xml: string): string[] {
  const table = xml.slice(xml.indexOf('<w:tbl>'), xml.indexOf('</w:tbl>'));
  return table.match(/<w:tr>[\s\S]*?<\/w:tr>/g) ?? [];
}

/**
 * Model Word's "accept all changes" on the raw XML: a row marked deleted goes
 * away entirely, deleted runs go with it, and insertions become ordinary text.
 *
 * The point is the row *count*. A `w:trPr/w:del` without matching run and
 * paragraph-mark deletions leaves an empty row behind on accept — a failure
 * mode that string assertions on the un-accepted XML cannot see.
 */
function acceptAllChanges(xml: string): string {
  return (
    xml
      // Rows whose trPr carries a deletion disappear wholesale.
      .replace(
        /<w:tr>(?:(?!<\/w:tr>)[\s\S])*?<w:del [\s\S]*?<\/w:tr>/g,
        (row) =>
          /<w:trPr>(?:(?!<\/w:trPr>)[\s\S])*<w:del /.test(row) ? '' : row
      )
      // Remaining deleted runs and paragraph marks go too.
      .replace(/<w:del [^>]*>[\s\S]*?<\/w:del>/g, '')
      .replace(/<w:del [^>]*\/>/g, '')
      // Insertions become ordinary content.
      .replace(/<w:ins [^>]*\/>/g, '')
      .replace(/<w:ins [^>]*>([\s\S]*?)<\/w:ins>/g, '$1')
  );
}

/** Model "reject all changes": insertions vanish, deletions come back. */
function rejectAllChanges(xml: string): string {
  return xml
    .replace(/<w:tr>(?:(?!<\/w:tr>)[\s\S])*?<w:ins [\s\S]*?<\/w:tr>/g, (row) =>
      /<w:trPr>(?:(?!<\/w:trPr>)[\s\S])*<w:ins /.test(row) ? '' : row
    )
    .replace(/<w:ins [^>]*>[\s\S]*?<\/w:ins>/g, '')
    .replace(/<w:ins [^>]*\/>/g, '');
}

const RATE_CARD = {
  name: 'table',
  props: {
    columns: [
      {
        header: { content: 'Tier' },
        cells: [
          { content: 'Basic' },
          { content: 'Legacy' },
          { content: 'Enterprise' },
        ],
      },
      {
        header: { content: 'Price' },
        cells: [{ content: '10' }, { content: '15' }, { content: '99' }],
      },
    ],
    rows: [
      {},
      { revision: { type: 'delete', author: 'Legal' } },
      { revision: { type: 'insert', author: 'Sales' } },
    ],
  },
};

describe('table row revisions', () => {
  it('marks the row, its runs and its paragraph marks', async () => {
    const xml = await documentXml(RATE_CARD);
    const [, kept, deleted, inserted] = rows(xml);

    expect(kept).not.toContain('<w:trPr>');

    expect(deleted).toMatch(
      /<w:trPr><w:del w:id="\d+" w:author="Legal" w:date="[^"]+"\/><\/w:trPr>/
    );
    // Cell text struck through, and both cells' paragraph marks deleted.
    expect(deleted.match(/<w:delText/g)).toHaveLength(2);
    expect(deleted.match(/<w:pPr>[\s\S]*?<w:rPr><w:del /g)).toHaveLength(2);

    expect(inserted).toMatch(
      /<w:trPr><w:ins w:id="\d+" w:author="Sales" w:date="[^"]+"\/><\/w:trPr>/
    );
    expect(inserted.match(/<w:pPr>[\s\S]*?<w:rPr><w:ins /g)).toHaveLength(2);
  });

  it('allocates a unique id per revision element, stably across renders', async () => {
    // OOXML requires uniqueness, not document order — a row's paragraph marks
    // are allocated before the cell text they follow. What has to hold is that
    // the same input always yields the same ids.
    const revisionIds = (xml: string) =>
      Array.from(xml.matchAll(/<w:(?:ins|del) w:id="(\d+)"/g)).map((match) =>
        Number(match[1])
      );

    const first = revisionIds(await documentXml(RATE_CARD));
    const second = revisionIds(await documentXml(RATE_CARD));

    expect(first.length).toBeGreaterThan(0);
    expect(new Set(first).size).toBe(first.length);
    expect(second).toEqual(first);
  });

  it('drops the deleted row entirely once changes are accepted', async () => {
    const xml = await documentXml(RATE_CARD);

    expect(rows(xml)).toHaveLength(4); // header + 3 data rows

    const accepted = acceptAllChanges(xml);
    const acceptedRows = rows(accepted);

    // The deleted row is gone, not left behind empty.
    expect(acceptedRows).toHaveLength(3);
    expect(accepted).not.toContain('Legacy');
    expect(accepted).toContain('Basic');
    expect(accepted).toContain('Enterprise');
  });

  it('drops the inserted row once changes are rejected', async () => {
    const xml = await documentXml(RATE_CARD);
    const rejected = rejectAllChanges(xml);

    expect(rows(rejected)).toHaveLength(3);
    expect(rejected).not.toContain('Enterprise');
    expect(rejected).toContain('Legacy');
  });

  it('carries row cantSplit and tableHeader', async () => {
    const xml = await documentXml({
      name: 'table',
      props: {
        columns: [
          {
            header: { content: 'A' },
            cells: [{ content: '1' }, { content: '2' }],
          },
        ],
        rows: [{ cantSplit: true }, { tableHeader: true }],
      },
    });
    const [, first, second] = rows(xml);

    expect(first).toContain('<w:cantSplit/>');
    expect(second).toContain('<w:tblHeader/>');
  });
});

describe('table cell revisions', () => {
  it('renders a cell-level revision on a plain string cell', async () => {
    const xml = await documentXml({
      name: 'table',
      props: {
        columns: [
          {
            header: { content: 'Price' },
            cells: [
              {
                content: '25',
                revision: {
                  author: 'Sales',
                  segments: [
                    { type: 'delete', text: '20' },
                    { type: 'insert', text: '25' },
                  ],
                },
              },
            ],
          },
        ],
      },
    });

    const cell = xml.match(
      /<w:tc>(?:(?!<\/w:tc>)[\s\S])*<w:ins [\s\S]*?<\/w:tc>/
    );
    expect(cell, 'expected a revision inside a table cell').not.toBeNull();
    expect(cell![0]).toMatch(/<w:delText[^>]*>20<\/w:delText>/);
    expect(cell![0]).toContain('25');
  });

  it('renders a revision on a header cell', async () => {
    const xml = await documentXml({
      name: 'table',
      props: {
        columns: [
          {
            header: {
              content: 'Net fee',
              revision: {
                segments: [
                  { type: 'delete', text: 'Gross fee' },
                  { type: 'insert', text: 'Net fee' },
                ],
              },
            },
            cells: [{ content: '12%' }],
          },
        ],
      },
    });

    expect(xml).toMatch(/<w:delText[^>]*>Gross fee<\/w:delText>/);
  });
});

describe('table revision determinism', () => {
  it('produces identical bytes in a fresh process', () => {
    // `deterministic-generation.test.ts` compares two builds inside one
    // process, so any ordering that depends on process-global state moves both
    // sides equally. A separate process is the only way to see it.
    const root = resolve(__dirname, '../../../..');
    const tsx = join(root, 'node_modules/.bin/tsx');
    if (!existsSync(tsx)) {
      console.warn(
        'tsx not resolvable; skipping cross-process determinism check'
      );
      return;
    }

    const dir = mkdtempSync(join(tmpdir(), 'jto-determinism-'));
    const script = join(dir, 'generate.ts');
    writeFileSync(
      script,
      `import { generateBufferFromJson } from ${JSON.stringify(
        resolve(__dirname, '../core/generator')
      )};
const definition = ${JSON.stringify({
        name: 'docx',
        props: { theme: 'minimal', trackRevisions: true },
        children: [RATE_CARD],
      })};
generateBufferFromJson(definition as never).then((buf) =>
  process.stdout.write(buf.toString('base64'))
);
`
    );

    const run = () =>
      execFileSync(tsx, [script], { encoding: 'utf8', cwd: root });

    expect(run()).toBe(run());
  }, 60000);
});

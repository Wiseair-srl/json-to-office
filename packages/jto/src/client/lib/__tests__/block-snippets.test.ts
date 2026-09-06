/**
 * Block snippets are text in, edits out. These drive the pure module the
 * Monaco completion provider wraps: which cursor positions offer what, and —
 * the property that matters — that applying a snippet together with its
 * additional edits leaves a document the validator accepts with no
 * unresolved reference.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  blockReferencesFromDocument,
  type BlockReference,
} from '@json-to-office/shared';
import { validatePresentationDocument } from '@json-to-office/shared-pptx';
import {
  applyTextEdits,
  blockCompletionContext,
  blockSnippets,
  insertBlockDefinitions,
  invocationSnippet,
} from '../block-snippets';
import {
  blockDefinitionsSignature,
  readDocumentBlockDefinitions,
} from '../document-blocks';

// LF regardless of how git checked the file out: the fixtures below splice a
// cursor into it by matching whole lines, which CRLF (a Windows runner with
// autocrlf) silently defeats.
const deckText = readFileSync(
  new URL(
    '../../public/templates/consulting-deck-blocks.pptx.json',
    import.meta.url
  ),
  'utf8'
).replace(/\r\n/g, '\n');
const deck = () => JSON.parse(deckText);
const references: BlockReference[] = blockReferencesFromDocument(deck(), {
  template: 'consulting-deck-blocks',
  format: 'pptx',
});

/** A pretty-printed deck without definitions, with `|` marking the cursor. */
function bare(children: string): string {
  const text = JSON.stringify(
    {
      name: 'pptx',
      props: { theme: 'consulting', slideWidth: 13.333, slideHeight: 7.5 },
      children: [{ name: 'slide', children: ['@@'] }],
    },
    null,
    2
  );
  return text.replace('"@@"', children);
}
const cursor = (text: string) => ({
  text: text.replace('|', ''),
  offset: text.indexOf('|'),
});
/**
 * What Monaco does with a snippet: fill each tab stop with its placeholder
 * and prepend the insertion line's indentation to every following line.
 */
const resolveSnippet = (snippet: string, text: string, offset: number) => {
  const start = text.lastIndexOf('\n', offset - 1) + 1;
  const indent = /^[ \t]*/.exec(text.slice(start, offset))?.[0] ?? '';
  return snippet
    .replace(/\$\{\d+:((?:[^}\\]|\\.)*)\}/g, (_m, value: string) =>
      value.replace(/\\([\\$}])/g, '$1')
    )
    .split('\n')
    .map((line, index) => (index === 0 ? line : indent + line))
    .join('\n');
};

describe('readDocumentBlockDefinitions', () => {
  it('reads the definitions of a complete document', () => {
    expect(Object.keys(readDocumentBlockDefinitions(deckText))).toEqual([
      'action-chart',
    ]);
  });
  it('tolerates a document mid-edit and skips a half-typed definition', () => {
    const broken = deckText
      .replace('"children": [', '"children": [ {"name": "slide" ')
      .replace(
        '"action-chart": {',
        '"draft": {"slots": {}}, "action-chart": {'
      );
    const definitions = readDocumentBlockDefinitions(broken);
    expect(Object.keys(definitions)).toEqual(['action-chart']);
    expect(readDocumentBlockDefinitions('')).toEqual({});
    expect(readDocumentBlockDefinitions('{"name": "pptx", "props": {')).toEqual(
      {}
    );
  });
  it('signs definitions by content', () => {
    const a = readDocumentBlockDefinitions(deckText);
    expect(blockDefinitionsSignature(a)).toBe(
      blockDefinitionsSignature(readDocumentBlockDefinitions(deckText))
    );
    expect(blockDefinitionsSignature(a)).not.toBe(
      blockDefinitionsSignature({})
    );
  });
});

describe('blockCompletionContext', () => {
  it.each([
    ['a ref string', '{"name": "block", "props": {"ref": "|"}}', 'ref'],
    ['a fresh object', '{|}', 'component'],
    ['an unfinished key', '{"|"}', 'component'],
    ['a name being typed', '{"name": "|"}', 'component'],
    ['an empty children array', '|', 'component'],
  ])('recognises %s', (_case, child, kind) => {
    const { text, offset } = cursor(bare(child));
    expect(blockCompletionContext(text, offset, 'pptx')?.kind).toBe(kind);
  });
  it.each([
    ['a text prop', '{"name": "text", "props": {"text": "|"}}'],
    [
      'a slot value',
      '{"name": "block", "props": {"ref": "x", "slots": {"title": "|"}}}',
    ],
    ['a slot key', '{"name": "block", "props": {"ref": "x", "slots": {"|"}}}'],
  ])('offers nothing at %s', (_case, child) => {
    const { text, offset } = cursor(bare(child));
    expect(blockCompletionContext(text, offset, 'pptx')).toBeNull();
  });
  it('offers nothing inside a multi-line object or under the wrong owner', () => {
    const multi = cursor(bare('{\n        "name": "|"\n      }'));
    expect(blockCompletionContext(multi.text, multi.offset, 'pptx')).toBeNull();
    const root = cursor(
      '{\n  "name": "pptx",\n  "props": {},\n  "children": [{"name": "|"}]\n}'
    );
    expect(blockCompletionContext(root.text, root.offset, 'pptx')).toBeNull();
    const docx = cursor(
      '{\n  "name": "docx",\n  "children": [{"name": "section", "children": [{"name": "|"}]}]\n}'
    );
    expect(blockCompletionContext(docx.text, docx.offset, 'docx')?.kind).toBe(
      'component'
    );
  });
});

describe('insertBlockDefinitions', () => {
  const definition = references[0].definition;
  it('adds to an existing blocks object, keeping what is there', () => {
    const text = deckText;
    const edited = applyTextEdits(
      text,
      insertBlockDefinitions(text, { statement: { slots: {}, body: [] } })
    );
    const parsed = JSON.parse(edited);
    expect(Object.keys(parsed.props.blocks)).toEqual([
      'statement',
      'action-chart',
    ]);
    expect(parsed.props.blocks['action-chart']).toEqual(definition);
    expect(edited).toContain('\n      "statement": {\n        "slots": {},');
  });
  it('creates blocks under props, and props under the root, as needed', () => {
    const withProps = JSON.stringify(
      { name: 'pptx', props: { theme: 'consulting' }, children: [] },
      null,
      2
    );
    const a = applyTextEdits(
      withProps,
      insertBlockDefinitions(withProps, { 'action-chart': definition })
    );
    expect(JSON.parse(a).props).toEqual({
      theme: 'consulting',
      blocks: { 'action-chart': definition },
    });
    expect(a).toContain('\n    "blocks": {\n      "action-chart": {');
    const noProps = '{\n  "name": "pptx",\n  "children": []\n}';
    const b = applyTextEdits(
      noProps,
      insertBlockDefinitions(noProps, { 'action-chart': definition })
    );
    expect(JSON.parse(b)).toEqual({
      name: 'pptx',
      children: [],
      props: { blocks: { 'action-chart': definition } },
    });
    expect(b).toContain(
      '\n  "props": {\n    "blocks": {\n      "action-chart"'
    );
    const emptyProps =
      '{\n  "name": "pptx",\n  "props": {},\n  "children": []\n}';
    const c = applyTextEdits(
      emptyProps,
      insertBlockDefinitions(emptyProps, { 'action-chart': definition })
    );
    expect(JSON.parse(c).props.blocks['action-chart']).toEqual(definition);
  });
  it('never overwrites a definition the document already has', () => {
    expect(
      insertBlockDefinitions(deckText, {
        'action-chart': { slots: {}, body: [] },
      })
    ).toEqual([]);
  });
});

describe('blockSnippets', () => {
  const options = { references, definitions: {}, format: 'pptx' as const };

  it('offers a reference at ref and brings its definition along', () => {
    const { text, offset } = cursor(
      bare('{"name": "block", "props": {"ref": "|"}}')
    );
    const [snippet, ...rest] = blockSnippets(text, offset, options);
    expect(rest).toEqual([]);
    expect(snippet).toMatchObject({
      kind: 'ref',
      label: 'action-chart',
      detail: 'block from consulting-deck-blocks',
      insertText: '"action-chart"',
      // Monaco matches the opening quote already typed against this.
      filterText: '"action-chart',
    });
    // Letters the author typed are theirs to match, not part of the lead:
    // a lead that swallowed them would match every block.
    const typed = cursor(bare('{"name": "block", "props": {"ref": "chr|"}}'));
    expect(
      blockSnippets(typed.text, typed.offset, options).map((s) => s.filterText)
    ).toEqual(['"action-chart']);
    expect(snippet.documentation).toBe(references[0].description);
    const edited = applyTextEdits(text, [
      { ...snippet.replace, content: snippet.insertText },
      ...snippet.additionalEdits,
    ]);
    const document = JSON.parse(edited);
    expect(document.props.blocks['action-chart']).toEqual(
      references[0].definition
    );
    // Resolved: the only complaints are the slots the definition requires.
    const errors = validatePresentationDocument(document).errors;
    expect(errors.length).toBeGreaterThan(0);
    expect(
      errors.every((e) =>
        e.path.startsWith('/children/0/children/0/props/slots')
      )
    ).toBe(true);
  });

  it('offers a whole invocation with tab stops that validates once applied', () => {
    for (const child of ['{|}', '{"name": "|"}', '|']) {
      const { text, offset } = cursor(bare(child));
      const [snippet] = blockSnippets(text, offset, options);
      expect(snippet.kind).toBe('component');
      expect(snippet.filterText).toBe(
        child.slice(0, child.indexOf('|')) + 'action-chart'
      );
      const typed = cursor(bare(child.replace('|', 'act|')));
      if (child !== '|')
        expect(
          blockSnippets(typed.text, typed.offset, options)[0].filterText
        ).toBe(child.slice(0, child.indexOf('|')) + 'action-chart');
      expect(snippet.insertText).toContain('${1:');
      expect(snippet.insertText).toContain('"ref": "action-chart"');
      const edited = applyTextEdits(text, [
        {
          ...snippet.replace,
          content: resolveSnippet(snippet.insertText, text, offset),
        },
        ...snippet.additionalEdits,
      ]);
      const document = JSON.parse(edited);
      expect(document.children[0].children[0]).toEqual(references[0].example);
      expect(validatePresentationDocument(document).errors).toEqual([]);
      // The child sits at indent 8, so the invocation's lines sit at 10.
      if (child !== '|')
        expect(edited).toContain('\n          "name": "block",');
    }
  });

  it('offers the document’s own definitions without re-inserting them', () => {
    const text = deckText.replace(
      '"children": [\n        {\n          "name": "block",',
      '"children": [\n        {"name": "|"},\n        {\n          "name": "block",'
    );
    const { text: clean, offset } = cursor(text);
    const definitions = readDocumentBlockDefinitions(clean);
    const snippets = blockSnippets(clean, offset, { ...options, definitions });
    expect(snippets.map((s) => [s.label, s.detail])).toEqual([
      ['action-chart', 'block defined in this document'],
    ]);
    expect(snippets[0].additionalEdits).toEqual([]);
    const edited = applyTextEdits(clean, [
      {
        ...snippets[0].replace,
        content: resolveSnippet(snippets[0].insertText, clean, offset),
      },
    ]);
    expect(validatePresentationDocument(JSON.parse(edited)).errors).toEqual([]);
  });

  it('inserts a reference’s dependencies before it', () => {
    const chrome = {
      slots: {},
      body: [{ name: 'text', props: { text: 'c', x: 1, y: 1, w: 1, h: 1 } }],
    };
    const composite = {
      slots: { title: { type: 'string' as const, required: true } },
      body: [
        { name: 'block', props: { ref: 'chrome' } },
        {
          name: 'text',
          props: { text: { $slot: '/title' }, x: 1, y: 2, w: 8, h: 1 },
        },
      ],
    };
    const source = {
      name: 'pptx',
      props: { blocks: { chrome, composite } },
      children: [],
    };
    const refs = blockReferencesFromDocument(source, {
      template: 'source',
      format: 'pptx',
    });
    const { text, offset } = cursor(bare('{|}'));
    const snippet = blockSnippets(text, offset, {
      ...options,
      references: refs,
    }).find((s) => s.label === 'composite')!;
    const edited = applyTextEdits(text, [
      {
        ...snippet.replace,
        content: resolveSnippet(snippet.insertText, text, offset),
      },
      ...snippet.additionalEdits,
    ]);
    const document = JSON.parse(edited);
    expect(Object.keys(document.props.blocks)).toEqual(['chrome', 'composite']);
    expect(validatePresentationDocument(document).errors).toEqual([]);
  });

  it('escapes snippet syntax inside slot text', () => {
    const snippet = invocationSnippet({
      name: 'block',
      props: { ref: 'x', slots: { title: 'Cost: $1 } "quoted"' } },
    });
    // `$` and `}` are snippet syntax; the JSON escape's backslash is doubled.
    expect(snippet).toContain(
      String.raw`"${'$'}{1:Cost: \$1 \} \\"quoted\\"}"`
    );
    expect(JSON.parse(resolveSnippet(snippet, '', 0)).props.slots.title).toBe(
      'Cost: $1 } "quoted"'
    );
  });
});

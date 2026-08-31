/**
 * The inline mini-language, node by node.
 *
 * The corpus pins what these turn into as bytes; this pins the grammar itself —
 * which decorator wins where they overlap, what an unmatched marker does, where
 * a line break lands, and which of the bracket syntaxes each caller opts into.
 */

import { describe, expect, it } from 'vitest';
import {
  containsCrossReference,
  containsLink,
  containsPlaceholder,
  containsUnsupportedSyntax,
  parseInline,
  parseLiteral,
} from '../inline';
import type { DocxIrInline, DocxIrRunFormatting } from '../types';

/** The text of every run, with a marker for the nodes that carry none. */
function shape(nodes: DocxIrInline[]): string[] {
  return nodes.map((node) => {
    switch (node.kind) {
      case 'text':
        return node.text;
      case 'lineBreak':
        return '<br>';
      case 'tab':
        return '<tab>';
      case 'hyperlink':
        return `<link ${
          node.target.kind === 'external'
            ? node.target.url
            : `#${node.target.anchor}`
        }>`;
      case 'field':
        return `<field ${node.instruction}>`;
      default:
        return `<${node.kind}>`;
    }
  });
}

/** Bold/italic per run, as a compact string: `b`, `i`, `bi` or `-`. */
function emphasis(nodes: DocxIrInline[]): string[] {
  return nodes.flatMap((node) => {
    if (node.kind !== 'text') return [];
    const formatting = node.formatting ?? {};
    const marks =
      `${formatting.bold ? 'b' : ''}${formatting.italic ? 'i' : ''}` || '-';
    return [marks];
  });
}

const base: DocxIrRunFormatting = {};

describe('decorators', () => {
  it('leaves plain text as one run', () => {
    expect(shape(parseInline('This is plain text', { base }))).toEqual([
      'This is plain text',
    ]);
  });

  it.each([
    ['**bold**', 'b'],
    ['__bold__', 'b'],
    ['*italic*', 'i'],
    ['_italic_', 'i'],
    ['***both***', 'bi'],
    ['___both___', 'bi'],
  ])('reads %s as %s', (text, marks) => {
    const nodes = parseInline(`a ${text} b`, { base });
    expect(shape(nodes)).toEqual(['a ', text.replace(/[*_]/g, ''), ' b']);
    expect(emphasis(nodes)).toEqual(['-', marks, '-']);
  });

  it('states both flags on a decorated run, not only the one it names', () => {
    // `**bold**` means bold *and not italic*, so the run says so rather than
    // inheriting whatever surrounded it.
    const [, bold] = parseInline('a **bold** b', { base });
    expect(bold.kind === 'text' && bold.formatting).toEqual({
      bold: true,
      italic: false,
    });
  });

  it('reads several decorators in one string', () => {
    const nodes = parseInline('**one** and *two* and ***three***', { base });
    expect(emphasis(nodes)).toEqual(['b', '-', 'i', '-', 'bi']);
  });

  it('reads a decorator at either end', () => {
    expect(emphasis(parseInline('**start** middle **end**', { base }))).toEqual(
      ['b', '-', 'b']
    );
  });

  it('reads an unclosed ** as an empty italic pair, not as literal text', () => {
    // The two asterisks match each other as a single-star pair with nothing
    // between them, so they vanish and the rest stays plain. Pinned rather
    // than endorsed: the corpus records the bytes this produces.
    const nodes = parseInline('Unclosed **bold text', { base });
    expect(shape(nodes)).toEqual(['Unclosed ', 'bold text']);
    expect(emphasis(nodes)).toEqual(['-', '-']);
  });

  it('reads a marker that is really part of an identifier as text', () => {
    // `snake_case_name` has two underscores, so the pair matches — the
    // behaviour is pinned rather than endorsed.
    expect(shape(parseInline('file_name_here.txt', { base }))).toEqual([
      'file',
      'name',
      'here.txt',
    ]);
  });

  it('carries the base formatting onto every run', () => {
    const nodes = parseInline('a **bold** b', {
      base: { fontFamily: 'Arial', sizeHalfPoints: 24 },
    });

    for (const node of nodes) {
      if (node.kind !== 'text') continue;
      expect(node.formatting).toEqual(
        expect.objectContaining({ fontFamily: 'Arial', sizeHalfPoints: 24 })
      );
    }
  });

  it('recolours only the runs a decorator made bold', () => {
    const nodes = parseInline('a **bold** b', {
      base: { color: { hex: '000000' } },
      boldColor: { hex: 'FF0000' },
    });

    expect(
      nodes.flatMap((node) =>
        node.kind === 'text' ? [node.formatting?.color?.hex] : []
      )
    ).toEqual(['000000', 'FF0000', '000000']);
  });

  it('gives empty text one empty run', () => {
    expect(shape(parseInline('', { base }))).toEqual(['']);
  });
});

describe('breaks and tabs', () => {
  it('turns a newline into a break between runs', () => {
    expect(shape(parseInline('one\ntwo', { base }))).toEqual([
      'one',
      '<br>',
      'two',
    ]);
  });

  it('keeps a blank line as a break plus an empty run', () => {
    // The empty run is what the break attaches to; without it the gap would
    // collapse.
    expect(shape(parseInline('one\n\ntwo', { base }))).toEqual([
      'one',
      '<br>',
      '',
      '<br>',
      'two',
    ]);
  });

  it('drops a leading newline, which has nothing to break from', () => {
    expect(shape(parseInline('\nafter', { base }))).toEqual(['<br>', 'after']);
  });

  it('breaks a line inside a decorated span', () => {
    const nodes = parseInline('**bold start\nbold end**', { base });
    expect(shape(nodes)).toEqual(['bold start', '<br>', 'bold end']);
    expect(emphasis(nodes)).toEqual(['b', 'b']);
  });

  it('turns a tab into a run of its own', () => {
    expect(shape(parseInline('left\tright', { base }))).toEqual([
      'left',
      '<tab>',
      'right',
    ]);
  });
});

describe('bracket syntaxes', () => {
  it('leaves a link literal unless the caller asks for links', () => {
    expect(shape(parseInline('see [here](https://x.test)', { base }))).toEqual([
      'see [here](https://x.test)',
    ]);
  });

  it('lowers a link when the caller asks for one', () => {
    const nodes = parseInline('see [here](https://x.test)', {
      base,
      hyperlinks: true,
    });

    expect(shape(nodes)).toEqual(['see ', '<link https://x.test>']);
  });

  it('reads a # target as a bookmark rather than a URL', () => {
    const nodes = parseInline('[jump](#intro)', { base, hyperlinks: true });
    expect(shape(nodes)).toEqual(['<link #intro>']);
  });

  it('keeps emphasis inside a link', () => {
    const [link] = parseInline('[**bold link**](https://x.test)', {
      base,
      hyperlinks: true,
    });

    expect(link.kind).toBe('hyperlink');
    if (link.kind !== 'hyperlink') return;
    expect(emphasis(link.children)).toEqual(['b']);
  });

  it('resolves a placeholder the caller knows', () => {
    const nodes = parseInline('Page {PAGE} of it', {
      base,
      resolvePlaceholder: (name) =>
        name === 'PAGE' ? { kind: 'field', instruction: 'PAGE' } : undefined,
    });

    expect(shape(nodes)).toEqual(['Page ', '<field PAGE>', ' of it']);
  });

  it('leaves a placeholder it does not know as written', () => {
    expect(
      shape(
        parseInline('Hello {NAME}!', {
          base,
          resolvePlaceholder: () => undefined,
        })
      )
    ).toEqual(['Hello ', '{NAME}', '!']);
  });

  it('resolves a placeholder inside a decorated span', () => {
    const nodes = parseInline('**{YEAR}**', {
      base,
      resolvePlaceholder: () => ({ kind: 'text', text: '2000' }),
    });

    expect(shape(nodes)).toEqual(['2000']);
    expect(emphasis(nodes)).toEqual(['b']);
  });

  it('resolves several placeholders in one string', () => {
    const nodes = parseInline('{A} {B}, {C}', {
      base,
      resolvePlaceholder: (name) => ({
        kind: 'text',
        text: name.toLowerCase(),
      }),
    });

    expect(shape(nodes)).toEqual(['a', ' ', 'b', ', ', 'c']);
  });
});

describe('escapes', () => {
  it.each([
    ['\\*', '*'],
    ['\\_', '_'],
    ['\\[', '['],
    ['\\]', ']'],
    ['\\{', '{'],
    ['\\}', '}'],
    ['\\\\', '\\'],
  ])('reads %s as the character itself', (written, rendered) => {
    expect(shape(parseInline(`a ${written} b`, { base }))).toEqual([
      `a ${rendered} b`,
    ]);
  });

  it('keeps an escaped identifier out of the decorator grammar', () => {
    // The reason escapes exist: two underscores in a code sample used to read
    // as an emphasis pair and swallow their own delimiters.
    const nodes = parseInline('grant\\_type=client\\_credentials', { base });
    expect(shape(nodes)).toEqual(['grant_type=client_credentials']);
    expect(emphasis(nodes)).toEqual(['-']);
  });

  it('leaves the decorators around an escape working', () => {
    const nodes = parseInline('**a\\_b** and *c*', { base });
    expect(shape(nodes)).toEqual(['a_b', ' and ', 'c']);
    expect(emphasis(nodes)).toEqual(['b', '-', 'i']);
  });

  it('escapes a link and a placeholder out of their syntaxes', () => {
    expect(
      shape(
        parseInline('\\[not a link\\](x) and \\{PAGE\\}', {
          base,
          hyperlinks: true,
          resolvePlaceholder: () => ({ kind: 'text', text: 'resolved' }),
        })
      )
    ).toEqual(['[not a link](x) and {PAGE}']);
  });

  it('ends an escape at one character, so \\\\_ still opens emphasis', () => {
    const nodes = parseInline('a \\\\_b_ c', { base });
    expect(shape(nodes)).toEqual(['a \\', 'b', ' c']);
    expect(emphasis(nodes)).toEqual(['-', 'i', '-']);
  });

  it('leaves a backslash before anything else alone', () => {
    expect(shape(parseInline('C:\\temp and 50\\% done', { base }))).toEqual([
      'C:\\temp and 50\\% done',
    ]);
  });

  it('leaves an authored private-use character alone', () => {
    // The escape pass swaps each metacharacter for a private-use sentinel, so
    // a document that legitimately contains one of those codepoints — an icon
    // font puts its glyphs there — must not come back as the metacharacter.
    expect(shape(parseInline('\uE000\uE001\uE006', { base }))).toEqual([
      '\uE000\uE001\uE006',
    ]);
  });

  it('keeps an authored private-use character next to a real escape', () => {
    expect(shape(parseInline('\uE000 and grant\\_type', { base }))).toEqual([
      '\uE000 and grant_type',
    ]);
  });

  it('decodes an escape inside a link destination', () => {
    const [link] = parseInline('[x](https://host/a\\_b)', {
      base,
      hyperlinks: true,
    });

    expect(link.kind).toBe('hyperlink');
    if (link.kind !== 'hyperlink') return;
    expect(link.target).toEqual({
      kind: 'external',
      url: 'https://host/a_b',
    });
  });

  it('decodes an escape inside a bookmark anchor', () => {
    const [link] = parseInline('[x](#a\\_b)', { base, hyperlinks: true });

    expect(link.kind).toBe('hyperlink');
    if (link.kind !== 'hyperlink') return;
    expect(link.target).toEqual({ kind: 'bookmark', anchor: 'a_b' });
  });

  it('does not unescape on the literal path, which promises verbatim text', () => {
    expect(shape(parseLiteral('grant\\_type', { base }))).toEqual([
      'grant\\_type',
    ]);
  });
});

describe('literal text', () => {
  it('renders every character as written, brackets and all', () => {
    expect(
      shape(
        parseLiteral('**not bold** and [not a link](x)\nsame line', { base })
      )
    ).toEqual(['**not bold** and [not a link](x)\nsame line']);
  });

  it('still splits out a no-proof word', () => {
    const nodes = parseLiteral('Wiseair ships things', {
      base,
      noProofWords: ['Wiseair'],
    });

    expect(shape(nodes)).toEqual(['Wiseair', ' ships things']);
    expect(nodes[0].kind === 'text' && nodes[0].formatting?.noProof).toBe(true);
  });
});

describe('recognising syntax without parsing it', () => {
  it('spots a link, a placeholder and a cross-reference', () => {
    expect(containsLink('a [b](c)')).toBe(true);
    expect(containsLink('a b c')).toBe(false);
    expect(containsPlaceholder('a {B} c')).toBe(true);
    expect(containsCrossReference('see [@intro]')).toBe(true);
    expect(containsCrossReference('see [^intro]')).toBe(false);
  });

  it('names nothing unsupported, now that every syntax is lowered', () => {
    expect(containsUnsupportedSyntax('[a](b) {C} [@d] [^e]')).toBeUndefined();
  });
});

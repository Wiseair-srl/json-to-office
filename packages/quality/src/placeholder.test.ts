import { describe, expect, it } from 'vitest';
import {
  collectPlaceholders,
  detectPlaceholder,
  SCAFFOLD_MARKER_SYNTAX,
} from './placeholder';

describe('scaffold markers', () => {
  it('recognises the documented marker syntax', () => {
    expect(SCAFFOLD_MARKER_SYNTAX).toBe('{{…}}');
    expect(detectPlaceholder('{{title}}')).toMatchObject({
      kind: 'scaffold-marker',
      pattern: 'scaffold-marker',
      excerpt: '{{title}}',
    });
    expect(detectPlaceholder('{{ kpi.value }}')?.kind).toBe('scaffold-marker');
    expect(
      detectPlaceholder('Revenue grew to {{figure}} last year.')
    ).toMatchObject({ kind: 'scaffold-marker', excerpt: '{{figure}}' });
  });

  it('leaves single braces and empty markers alone', () => {
    expect(detectPlaceholder('{title}')).toBeUndefined();
    expect(detectPlaceholder('{{}}')).toBeUndefined();
    expect(detectPlaceholder('{{   }}')).toBeUndefined();
  });

  it('wins over filler when both are present', () => {
    expect(detectPlaceholder('Lorem ipsum {{slot}}')?.kind).toBe(
      'scaffold-marker'
    );
  });
});

describe('filler text', () => {
  it('flags lorem ipsum anywhere in the string', () => {
    expect(detectPlaceholder('Lorem ipsum dolor sit amet')).toMatchObject({
      kind: 'filler',
      pattern: 'lorem-ipsum',
    });
    expect(detectPlaceholder('…trailing LOREM IPSUM copy')?.kind).toBe(
      'filler'
    );
  });

  it('flags "your … here" and "… goes here" fillers', () => {
    for (const text of [
      'Your title here',
      'Your company name here',
      'Title goes here',
      'Subtitle text goes here',
      'Click to add title',
      'Click to edit master text styles',
    ]) {
      expect(detectPlaceholder(text)?.kind, text).toBe('filler');
    }
  });

  it('flags a whole-string bracketed placeholder', () => {
    expect(detectPlaceholder('[Client name]')).toMatchObject({
      kind: 'filler',
      pattern: 'bracketed',
    });
    expect(detectPlaceholder('  [insert date]  ')?.kind).toBe('filler');
  });

  it('flags bare authoring debris', () => {
    for (const text of ['TODO', 'todo', 'XXX', 'Placeholder', 'Sample text']) {
      expect(detectPlaceholder(text)?.kind, text).toBe('filler');
    }
  });
});

describe('real prose stays clean', () => {
  it('passes text that only resembles a placeholder', () => {
    for (const text of [
      'Adoption grew 14% year on year.',
      'See [1] for the derivation.',
      'The figures here are provisional.',
      'Your team reviewed the plan in March.',
      'TBD',
      'N/A',
      '[]',
      'Revenue [EUR m]',
      '[label](https://example.com)',
      'Where do we go from here?',
    ]) {
      expect(detectPlaceholder(text), text).toBeUndefined();
    }
  });

  it('ignores empty and whitespace-only strings', () => {
    expect(detectPlaceholder('')).toBeUndefined();
    expect(detectPlaceholder('   \n ')).toBeUndefined();
  });
});

describe('collectPlaceholders', () => {
  it('points at the string it found, as a JSON pointer', () => {
    const document = {
      name: 'docx',
      metadata: { title: '{{title}}' },
      children: [
        { name: 'paragraph', props: { text: 'Lorem ipsum dolor.' } },
        { name: 'paragraph', props: { text: 'Adoption grew 14%.' } },
      ],
    };
    expect(collectPlaceholders(document)).toEqual([
      {
        path: '/metadata/title',
        text: '{{title}}',
        match: {
          kind: 'scaffold-marker',
          pattern: 'scaffold-marker',
          excerpt: '{{title}}',
        },
      },
      {
        path: '/children/0/props/text',
        text: 'Lorem ipsum dolor.',
        match: {
          kind: 'filler',
          pattern: 'lorem-ipsum',
          excerpt: 'Lorem ipsum',
        },
      },
    ]);
  });

  it('escapes pointer segments', () => {
    const found = collectPlaceholders({ 'a/b': { '~x': '{{slot}}' } });
    expect(found.map((entry) => entry.path)).toEqual(['/a~1b/~0x']);
  });

  it('skips disabled subtrees — they never reach the page', () => {
    const document = {
      children: [
        { name: 'text', enabled: false, props: { text: '{{unused}}' } },
        { name: 'text', props: { text: '{{used}}' } },
      ],
    };
    expect(collectPlaceholders(document).map((entry) => entry.text)).toEqual([
      '{{used}}',
    ]);
  });

  it('returns nothing for a clean document', () => {
    expect(
      collectPlaceholders({ children: [{ props: { text: 'Real copy.' } }] })
    ).toEqual([]);
  });
});

/**
 * External hyperlinks.
 *
 * A separate area because these cases could not exist until relationship ids
 * were canonicalized during packaging: docx.js mints external-hyperlink ids
 * from `Math.random`, so any linked document produced different bytes on every
 * render and had no golden hash to record. See
 * `utils/packageDocument.ts#canonicalizeRelationshipIds`.
 *
 * A link inside a *table cell* is deliberately absent. That path emits a
 * relationship reference the relationships part never declares, so the document
 * is damaged and its bytes vary run to run — a defect that predates the
 * renderer IR work and is not something a golden should enshrine. The
 * `no dangling relationship references` test in `relationship-ids.test.ts`
 * documents it.
 */

import type { CorpusCase } from './corpus-types';

const doc = (children: unknown[]): unknown => ({
  name: 'docx',
  props: { metadata: { title: 'Links', author: 'JTO' } },
  children: [{ name: 'section', props: {}, children }],
});

const para = (text: string, props: Record<string, unknown> = {}): unknown => ({
  name: 'paragraph',
  props: { text, ...props },
});

export const CASES: CorpusCase[] = [
  {
    name: 'links/single-external',
    document: doc([para('See [the docs](https://example.com) for details.')]),
  },
  {
    name: 'links/multiple-in-one-paragraph',
    document: doc([
      para(
        'Compare [alpha](https://example.com/a), [beta](https://example.org/b) and [gamma](https://example.net/c).'
      ),
    ]),
  },
  {
    name: 'links/across-paragraphs',
    document: doc([
      para('First [one](https://example.com/1).'),
      para('Then [two](https://example.com/2).'),
      para('Finally [three](https://example.com/3).'),
    ]),
  },
  {
    name: 'links/repeated-target',
    document: doc([
      para(
        'Go [here](https://example.com) or [here again](https://example.com).'
      ),
    ]),
  },
  {
    name: 'links/decorated-text',
    document: doc([
      para('Read the [**important** guide](https://example.com/guide).'),
      para('And the [*optional* appendix](https://example.com/appendix).'),
    ]),
  },
  {
    name: 'links/query-and-fragment',
    document: doc([
      para(
        'Search [results](https://example.com/search?q=a%20b&page=2#top) here.'
      ),
    ]),
  },
  {
    name: 'links/internal-anchor',
    document: doc([
      {
        name: 'heading',
        id: 'methods',
        props: { text: 'Methods', level: 1 },
      },
      para('Jump back to [Methods](#methods).'),
    ]),
  },
  {
    name: 'links/mixed-internal-and-external',
    document: doc([
      {
        name: 'heading',
        id: 'overview',
        props: { text: 'Overview', level: 1 },
      },
      para('See [Overview](#overview) or the [website](https://example.com).'),
    ]),
  },
  {
    name: 'links/in-heading',
    document: doc([
      {
        name: 'heading',
        props: {
          text: 'The [project](https://example.com) at a glance',
          level: 2,
        },
      },
    ]),
  },
  {
    name: 'links/in-list-item',
    document: doc([
      {
        name: 'list',
        props: {
          items: [
            'Plain item',
            'Item with [a link](https://example.com/one)',
            'Item with [another](https://example.com/two)',
          ],
        },
      },
    ]),
  },
  {
    name: 'links/in-header-and-footer',
    document: {
      name: 'docx',
      props: { metadata: { title: 'Links', author: 'JTO' } },
      children: [
        {
          name: 'section',
          props: {
            header: [para('Home: [example.com](https://example.com)')],
            footer: [para('Support: [help](https://example.com/help)')],
          },
          children: [para('Body text.')],
        },
      ],
    },
  },
];

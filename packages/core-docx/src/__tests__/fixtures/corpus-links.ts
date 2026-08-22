/**
 * External hyperlinks.
 *
 * A separate area because these cases could not exist until relationship ids
 * were canonicalized during packaging: docx.js mints external-hyperlink ids
 * from `Math.random`, so any linked document produced different bytes on every
 * render and had no golden hash to record. See
 * `utils/packageDocument.ts#canonicalizeRelationshipIds`.
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
    // A table is cached across renders while a paragraph is not, so this is
    // the case that catches a hyperlink relationship registered against the
    // wrong document. Both a header cell and a body cell carry one, and one
    // body cell carries none, so a link is pinned wherever a cell can hold it.
    name: 'links/in-table-cell',
    document: doc([
      {
        name: 'table',
        props: {
          columns: [
            {
              header: { content: 'Source' },
              cells: [
                { content: 'See [alpha](https://example.com/alpha)' },
                { content: 'No link here' },
              ],
            },
            {
              header: { content: 'See [the docs](https://example.com/docs)' },
              cells: [
                { content: 'Read [beta](https://example.org/beta) too' },
                { content: 'Then [gamma](https://example.net/gamma)' },
              ],
            },
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

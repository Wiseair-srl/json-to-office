/**
 * The authoring surface this server promises agents, recorded by hand.
 *
 * The registries in `shared-docx` / `shared-pptx` and the JSON Schema this
 * server generates are not two sources: the schema is generated *from* the
 * registry, so a component dropped from one disappears from the other in the
 * same edit and a registry-against-schema comparison can never fail. This file
 * is the independent party. It is maintained by hand, so any change to the
 * component names, the per-renderer profiles or the container rules has to be
 * written down here before `discovery-drift.test.ts` will go green — which is
 * the acknowledgement the derived comparison could not ask for.
 *
 * Changing an entry is legitimate; changing one without meaning to is the bug.
 * Agents write documents against these names, so a removal or a rename is a
 * breaking change to this package's public surface whatever the registry edit
 * that caused it looked like.
 */

import type { FormatName } from '../../lib/adapters.js';

export interface PublishedComponentSurface {
  /** The component that roots a document and carries `props.renderer`. */
  rootComponent: string;
  /**
   * Component names each renderer profile accepts, keyed by renderer id in
   * schema declaration order — the first key is the format's default renderer.
   * A renderer that cannot draw a component simply omits it.
   */
  renderers: Record<string, readonly string[]>;
  /**
   * Containers and the children they accept, unioned across renderers. Every
   * component with children appears; leaves do not.
   */
  allowedChildren: Record<string, readonly string[]>;
}

export const PUBLISHED_SURFACE: Record<FormatName, PublishedComponentSurface> =
  {
    docx: {
      rootComponent: 'docx',
      renderers: {
        docxjs: [
          'columns',
          'divider',
          'docx',
          'heading',
          'highcharts',
          'image',
          'block',
          'group',
          'list',
          'paragraph',
          'section',
          'statistic',
          'table',
          'text-box',
          'toc',
          'visual',
        ],
        // `chart` is office-open's alone: docx.js has no chart primitive at
        // all, so it narrows its own profile rather than accepting a component
        // it would have to drop. Same shape as the pptx split below.
        'office-open': [
          'chart',
          'columns',
          'divider',
          'docx',
          'heading',
          'highcharts',
          'image',
          'block',
          'group',
          'list',
          'paragraph',
          'section',
          'statistic',
          'table',
          'text-box',
          'toc',
          'visual',
        ],
      },
      allowedChildren: {
        group: [
          'group',
          'block',
          'heading',
          'paragraph',
          'image',
          'statistic',
          'table',
          'list',
          'toc',
          'divider',
          'highcharts',
          'chart',
          'visual',
          'columns',
          'text-box',
        ],
        columns: [
          'group',
          'chart',
          'divider',
          'heading',
          'highcharts',
          'image',
          'block',
          'list',
          'paragraph',
          'statistic',
          'table',
          'text-box',
          'toc',
          'visual',
        ],
        docx: ['section'],
        section: [
          'chart',
          'columns',
          'divider',
          'heading',
          'highcharts',
          'image',
          'block',
          'group',
          'list',
          'paragraph',
          'statistic',
          'table',
          'text-box',
          'toc',
          'visual',
        ],
        'text-box': ['divider', 'heading', 'image', 'paragraph'],
      },
    },

    pptx: {
      rootComponent: 'pptx',
      renderers: {
        pptxgenjs: [
          'chart',
          'highcharts',
          'image',
          'pptx',
          'shape',
          'slide',
          'table',
          'text',
        ],
        'office-open': [
          'chart',
          'highcharts',
          'image',
          'pptx',
          'shape',
          'slide',
          'table',
          'text',
        ],
      },
      allowedChildren: {
        pptx: ['slide'],
        slide: ['chart', 'highcharts', 'image', 'shape', 'table', 'text'],
      },
    },
  };

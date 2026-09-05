/**
 * DOCX parity corpus — theme.
 *
 * Everything that decides how a document *looks* before a single component
 * prop is read: the three bundled themes, the in-document theme object
 * (`themeOverrides`), the colour-token vocabulary components resolve against,
 * document-level `componentDefaults`, the font surface (roles, families, the
 * registry, numeric weights) and the proofing surface (`language`, `noProof`,
 * `noProofWords`).
 *
 * The three `theme/builtin-*` cases share one body (`SAMPLER`) on purpose: the
 * only difference between their hashes is the theme name, so a hash that moves
 * for exactly one of them names a single theme file, and one that moves for all
 * three names the theme→docx adapter.
 *
 * A deliberately absent corner:
 *
 * - A colour token that is not in the palette. `resolveColor` throws
 *   `Invalid color value: "…"` rather than degrading, so such a document is a
 *   validation failure, not a corpus case.
 * Custom theme styles, including the new type roles, compile to Word styles.
 * `theme/shared-foundation` covers their projection; `theme/toc-entry-styles`
 * covers the canonical TOC1..TOC6 identifiers.
 *
 * The two shipped example documents are imported rather than copied, so they
 * keep tracking `templates/documents/` as it changes. `inlineImages` swaps any
 * `image.path` for an inline data URI — a corpus case may not reach the
 * network. The current examples carry only inline SVG images, so the pass is
 * a no-op that stays as a guard for future edits.
 */

import type { CorpusCase } from './corpus-types';
import practiceNoteExample from '../../templates/documents/practice-note.docx.json';
import fieldReviewExample from '../../templates/documents/field-review.docx.json';

/** A 4x2 PNG, so aspect-ratio maths has something to work with. */
const PNG_4X2 =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAQAAAACCAYAAABytg0kAAAAFElEQVR42mNk+M9QzwAFjDAGACPuA/8fMSCgAAAAAElFTkSuQmCC';

const doc = (
  children: unknown[],
  props: Record<string, unknown> = {}
): unknown => ({
  name: 'docx',
  props: {
    theme: 'minimal',
    metadata: { title: 'Theme corpus', author: 'JTO' },
    ...props,
  },
  children,
});

const section = (
  children: unknown[],
  props: Record<string, unknown> = {}
): unknown => ({ name: 'section', props, children });

/** One section holding the given children — the shape most cases want. */
const page = (
  children: unknown[],
  docProps: Record<string, unknown> = {}
): unknown => doc([section(children)], docProps);

const p = (props: Record<string, unknown>): unknown => ({
  name: 'paragraph',
  props,
});

const h = (props: Record<string, unknown>): unknown => ({
  name: 'heading',
  props,
});

/**
 * A body that touches every surface a theme controls: the six heading styles,
 * the title/subtitle styles, normal body text, a list (marker font + indent
 * defaults), a table (border colour + cell defaults), a statistic and an
 * image (alignment defaults).
 */
const SAMPLER: unknown[] = [
  p({ text: 'Theme Sampler', themeStyle: 'title' }),
  p({ text: 'One body per bundled theme', themeStyle: 'subtitle' }),
  h({ text: 'Heading one', level: 1 }),
  p({
    text: 'Body copy in the theme’s normal style, long enough that the line spacing and the justification setting both have somewhere to show.',
  }),
  h({ text: 'Heading two', level: 2 }),
  h({ text: 'Heading three', level: 3 }),
  h({ text: 'Heading four', level: 4 }),
  h({ text: 'Heading five', level: 5 }),
  h({ text: 'Heading six', level: 6 }),
  { name: 'list', props: { items: ['First item', 'Second item'] } },
  {
    name: 'table',
    props: {
      columns: [
        { header: { content: 'Metric' }, cells: [{ content: 'Latency' }] },
        { header: { content: 'Value' }, cells: [{ content: '42 ms' }] },
      ],
    },
  },
  {
    name: 'statistic',
    props: { number: '99.95', unit: '%', description: 'Uptime' },
  },
  { name: 'image', props: { base64: PNG_4X2, width: 160, alt: 'Swatch' } },
];

/**
 * A body whose every colour flows through the token-or-hex resolver, so the
 * case isolates colour resolution from everything else. Called once with
 * palette token names and once with the hex values those tokens hold under
 * `minimal`, which makes the two hashes the two branches of the resolver.
 *
 * `table.borderColor` is absent on purpose: it is a bare-hex slot that never
 * reaches the token resolver, so it would be noise in both halves.
 */
const colorBody = (
  c: Record<
    'primary' | 'secondary' | 'accent' | 'textMuted' | 'backgroundSecondary',
    string
  >
): unknown[] => [
  h({ text: 'Tokens', level: 1, font: { color: c.primary } }),
  p({ text: 'Body in **bold** and plain.', boldColor: c.accent }),
  p({ text: 'Secondary text.', font: { color: c.secondary } }),
  {
    name: 'list',
    props: {
      items: ['Marked', 'Items'],
      levels: [
        {
          level: 0,
          format: 'bullet',
          text: '▪',
          font: { color: c.accent, size: 12, bold: true },
        },
      ],
    },
  },
  {
    name: 'table',
    props: {
      headerCellDefaults: {
        backgroundColor: c.backgroundSecondary,
        color: c.primary,
      },
      cellDefaults: { color: c.textMuted },
      columns: [
        { header: { content: 'Token' }, cells: [{ content: 'primary' }] },
        {
          header: { content: 'Use' },
          cells: [{ content: 'headings', backgroundColor: 'transparent' }],
        },
      ],
    },
  },
];

/** The token names `colorBody` reads, as themselves. */
const COLOR_TOKENS = {
  primary: 'primary',
  secondary: 'secondary',
  accent: 'accent',
  textMuted: 'textMuted',
  backgroundSecondary: 'backgroundSecondary',
} as const;

/** Deep clone with every `image.path` swapped for an inline data URI. */
function inlineImages<T>(node: T): T {
  if (Array.isArray(node)) {
    return node.map((child) => inlineImages(child)) as unknown as T;
  }
  if (node !== null && typeof node === 'object') {
    const source = node as Record<string, unknown>;
    const clone: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(source)) {
      clone[key] = inlineImages(value);
    }
    const props = clone.props;
    if (
      source.name === 'image' &&
      props !== null &&
      typeof props === 'object' &&
      typeof (props as Record<string, unknown>).path === 'string'
    ) {
      const imageProps = props as Record<string, unknown>;
      delete imageProps.path;
      imageProps.base64 = PNG_4X2;
    }
    return clone as unknown as T;
  }
  return node;
}

export const CASES: CorpusCase[] = [
  {
    name: 'theme/shared-foundation',
    document: page(
      [
        p({ text: 'A shared visual system', themeStyle: 'display' }),
        p({ text: 'Source: field observations', themeStyle: 'source' }),
        p({
          text: 'Explicit override',
          themeStyle: 'display',
          font: { case: 'none', size: 12 },
        }),
      ],
      {
        theme: 'vermilion',
        themeOverrides: {
          palette: {
            rule: '#123456',
            textMuted: 'rule',
            chart: ['rule', '#337755'],
          },
          typography: {
            roles: {
              display: {
                face: 'heading',
                weight: 300,
                case: 'upper',
                color: 'textMuted',
                tracking: 2,
              },
              source: { size: 9, case: 'smallCaps' },
            },
            scale: { a4: { base: 12, ratio: 1.25, baselinePt: 4 } },
          },
          spacing: { canvas: { a4: { safeAreaIn: 0.5 } } },
          chrome: { sourceLine: { type: 'source' } },
          motif: { kind: 'rule', color: 'rule' },
        },
      }
    ),
  },
  // --------------------------------------------------------------------------
  // The bundled themes — one body, one case per theme
  // --------------------------------------------------------------------------
  {
    name: 'theme/builtin-minimal',
    document: page(SAMPLER, { theme: 'minimal' }),
  },
  {
    name: 'theme/builtin-devportal',
    document: page(SAMPLER, { theme: 'devportal' }),
  },
  {
    name: 'theme/builtin-vermilion',
    document: page(SAMPLER, { theme: 'vermilion' }),
  },

  // --------------------------------------------------------------------------
  // Theme selection corners
  // --------------------------------------------------------------------------
  {
    // No `theme` at all: the resolver must land on `minimal`, which makes this
    // hash the twin of `theme/builtin-minimal` minus the explicit name.
    name: 'theme/name-omitted',
    document: {
      name: 'docx',
      props: { metadata: { title: 'Theme corpus', author: 'JTO' } },
      children: [section(SAMPLER)],
    },
  },
  {
    // An unknown name warns and falls back rather than throwing.
    name: 'theme/name-unknown-falls-back',
    document: page(SAMPLER, { theme: 'no-such-theme' }),
  },

  // --------------------------------------------------------------------------
  // themeOverrides — the in-document theme object
  // --------------------------------------------------------------------------
  {
    // A complete palette, all four font roles and the predefined styles,
    // written inline: a whole theme that never touches the theme registry.
    name: 'theme/inline-theme-object',
    document: page(SAMPLER, {
      theme: 'minimal',
      themeOverrides: {
        colors: {
          primary: '#123456',
          secondary: '#5A6472',
          accent: '#C2410C',
          text: '#1C1917',
          background: '#FFFFFF',
          border: '#E7E5E4',
          textPrimary: '#0C0A09',
          textSecondary: '#44403C',
          textMuted: '#A8A29E',
          borderPrimary: '#D6D3D1',
          borderSecondary: '#F5F5F4',
          backgroundPrimary: '#FFFFFF',
          backgroundSecondary: '#FAFAF9',
        },
        fonts: {
          heading: { family: 'Georgia', size: 22 },
          body: { family: 'Cambria', size: 11 },
          mono: { family: 'Consolas', size: 10 },
          light: { family: 'Georgia', size: 26 },
        },
        styles: {
          normal: {
            font: 'body',
            size: 11,
            color: 'text',
            alignment: 'justify',
            lineSpacing: { type: 'multiple', value: 1.4 },
            spacing: { after: 8 },
          },
          title: {
            font: 'light',
            size: 30,
            color: 'primary',
            alignment: 'center',
            spacing: { after: 18 },
          },
          subtitle: {
            font: 'light',
            size: 15,
            italic: true,
            color: 'textMuted',
            alignment: 'center',
            spacing: { after: 24 },
          },
          heading1: {
            font: 'heading',
            size: 22,
            bold: true,
            color: 'primary',
            spacing: { before: 16, after: 10 },
          },
          heading2: {
            font: 'heading',
            size: 17,
            bold: true,
            color: 'accent',
            spacing: { before: 12, after: 8 },
          },
          heading3: {
            font: 'heading',
            size: 14,
            bold: false,
            italic: true,
            color: 'secondary',
          },
        },
      },
    }),
  },
  {
    // Colours only: fonts and styles must survive untouched from `minimal`.
    // The body is the token-referencing one, because `minimal`'s own styles
    // spell their colours as hex — a repalette is invisible to `SAMPLER`.
    name: 'theme/overrides-colors-only',
    document: page(colorBody(COLOR_TOKENS), {
      theme: 'minimal',
      themeOverrides: {
        colors: {
          primary: '#7C3AED',
          secondary: '#475569',
          accent: '#F59E0B',
          textMuted: '#94A3B8',
          backgroundSecondary: '#EEF2FF',
        },
      },
    }),
  },
  {
    // A font role override that sets only `family`: the merge is per-role and
    // per-field, so each role must keep the size the theme gave it.
    name: 'theme/overrides-fonts-partial',
    document: page(SAMPLER, {
      theme: 'minimal',
      themeOverrides: {
        fonts: {
          heading: { family: 'Times New Roman' },
          body: { family: 'Georgia' },
          mono: { family: 'Courier New' },
          light: { family: 'Trebuchet MS' },
        },
      },
    }),
  },
  {
    // Style-level metrics that have no component-prop equivalent: borders
    // (including the between-paragraph rule), indent, character spacing,
    // glyph scale, outline level and the keep/widow flags.
    name: 'theme/overrides-styles-metrics',
    document: page(
      [
        p({ text: 'Metric title', themeStyle: 'title' }),
        h({ text: 'Ruled heading', level: 1 }),
        p({ text: 'First paragraph of the ruled pair.' }),
        p({ text: 'Second paragraph of the ruled pair.' }),
        h({ text: 'Condensed heading', level: 2 }),
        p({ text: 'Trailing paragraph.' }),
      ],
      {
        theme: 'minimal',
        themeOverrides: {
          styles: {
            normal: {
              font: 'body',
              size: 11,
              color: 'text',
              lineSpacing: { type: 'atLeast', value: 14 },
              spacing: { before: 2, after: 6 },
              indent: { left: 240, hanging: 120 },
              borders: {
                left: { style: 'thick', size: 12, color: 'accent', space: 4 },
                between: {
                  style: 'dashed',
                  size: 4,
                  color: '#CCCCCC',
                  space: 2,
                },
              },
              widowControl: true,
            },
            title: {
              font: 'light',
              size: 28,
              characterSpacing: { type: 'condensed', value: 16 },
              scale: 96,
              alignment: 'left',
            },
            heading1: {
              font: 'heading',
              size: 20,
              bold: true,
              color: 'primary',
              keepNext: true,
              keepLinesTogether: true,
              outlineLevel: 0,
              priority: 9,
              followingStyle: 'normal',
              spacing: { before: 14, after: 8 },
            },
            heading2: {
              font: 'heading',
              size: 16,
              characterSpacing: { type: 'expanded', value: 3 },
              scale: 115,
              underline: true,
              color: 'secondary',
            },
          },
        },
      }
    ),
  },
  {
    // baseStyle inheritance: heading3 inherits from heading2, which inherits
    // from heading1; heading4 names a base that does not exist and must fall
    // back to its own properties rather than dropping them. The dangling base
    // logs `Invalid style name: nowhere` during generation — expected output,
    // not a failure.
    name: 'theme/overrides-styles-base-chain',
    document: page(
      [
        h({ text: 'Root', level: 1 }),
        h({ text: 'Inherits root', level: 2 }),
        h({ text: 'Inherits the inheritor', level: 3 }),
        h({ text: 'Dangling base', level: 4 }),
      ],
      {
        theme: 'minimal',
        themeOverrides: {
          styles: {
            heading1: {
              font: 'heading',
              size: 24,
              bold: true,
              color: '#0F172A',
              spacing: { before: 12, after: 8 },
            },
            heading2: { baseStyle: 'heading1', size: 18, color: '#334155' },
            heading3: { baseStyle: 'heading2', size: 14, italic: true },
            heading4: { baseStyle: 'nowhere', size: 12, color: '#64748B' },
          },
        },
      }
    ),
  },
  {
    // `themeOverrides: {}` must not change the resolved theme.
    name: 'theme/overrides-empty',
    document: page(SAMPLER, { theme: 'minimal', themeOverrides: {} }),
  },
  {
    // Overrides layered over a theme that is not the fallback, so the merge is
    // proved to read the named theme rather than the default one.
    name: 'theme/overrides-over-named-theme',
    document: page(SAMPLER, {
      theme: 'devportal',
      themeOverrides: {
        colors: { primary: '#8A1538', accent: '#B08D57' },
        fonts: { heading: { family: 'Georgia' } },
        styles: { heading1: { size: 26, color: 'primary' } },
      },
    }),
  },

  // --------------------------------------------------------------------------
  // Colour tokens
  // --------------------------------------------------------------------------
  {
    // Every colour written as a palette token: heading font, bold decorator,
    // list marker, table borders, header fill and cell text.
    name: 'theme/color-tokens-in-components',
    document: page(colorBody(COLOR_TOKENS), { theme: 'minimal' }),
  },
  {
    // The same body with `minimal`'s hex values inlined: the other branch of
    // the colour resolver, and the control the token case is read against.
    name: 'theme/color-hex-literals',
    document: page(
      colorBody({
        primary: '#2B302B',
        secondary: '#4A5B4E',
        accent: '#6E7F71',
        textMuted: '#75726A',
        backgroundSecondary: '#F1EFE9',
      }),
      { theme: 'minimal' }
    ),
  },
  {
    // accent4/5/6 exist to match the PPTX palette vocabulary. The bundled
    // themes fill them (as chart-series colours), so this pins the other
    // half: overrides replacing the bundled values.
    name: 'theme/color-extra-accent-slots',
    document: page(
      [
        p({ text: 'Accent four', font: { color: 'accent4' } }),
        p({ text: 'Accent five', font: { color: 'accent5' } }),
        p({ text: 'Accent six', font: { color: 'accent6' } }),
      ],
      {
        theme: 'minimal',
        themeOverrides: {
          colors: {
            accent4: '#0EA5E9',
            accent5: '#22C55E',
            accent6: '#EF4444',
          },
        },
      }
    ),
  },

  // --------------------------------------------------------------------------
  // Fonts
  // --------------------------------------------------------------------------
  {
    // A document-scoped font registry of safe families (no fetch, no embed),
    // wired to the theme roles and referenced again from a component.
    name: 'theme/font-registry-safe-families',
    document: page(
      [
        h({ text: 'Registered heading', level: 1 }),
        p({ text: 'Registered body text.' }),
        p({ text: 'Local family override.', font: { family: 'Verdana' } }),
      ],
      {
        theme: 'minimal',
        fontRegistry: [
          {
            id: 'Georgia',
            family: 'Georgia',
            category: 'serif',
            sources: [{ kind: 'safe', family: 'Georgia' }],
          },
          {
            id: 'Consolas',
            family: 'Consolas',
            category: 'mono',
            sources: [{ kind: 'safe', family: 'Consolas' }],
          },
          {
            id: 'Verdana',
            family: 'Verdana',
            category: 'sans',
            sources: [{ kind: 'safe', family: 'Verdana' }],
          },
        ],
        themeOverrides: {
          fonts: {
            heading: { family: 'Georgia', size: 20 },
            body: { family: 'Georgia', size: 11 },
            mono: { family: 'Consolas', size: 10 },
          },
        },
      }
    ),
  },
  {
    // Numeric weights across the 100–900 range, plus the two interactions the
    // schema calls out: `bold: true` as shorthand for 700, and `fontWeight`
    // winning when both are set.
    name: 'theme/font-numeric-weights',
    document: page(
      [
        p({ text: 'Weight 100', font: { fontWeight: 100 } }),
        p({ text: 'Weight 300', font: { fontWeight: 300 } }),
        p({ text: 'Weight 400', font: { fontWeight: 400 } }),
        p({ text: 'Weight 600', font: { fontWeight: 600 } }),
        p({ text: 'Weight 900', font: { fontWeight: 900 } }),
        p({ text: 'Bold shorthand', font: { bold: true } }),
        p({ text: 'Weight beats bold', font: { bold: true, fontWeight: 300 } }),
        h({ text: 'Heading at 200', level: 2, font: { fontWeight: 200 } }),
      ],
      {
        theme: 'minimal',
        themeOverrides: {
          styles: { heading3: { font: 'heading', fontWeight: 500, size: 14 } },
        },
      }
    ),
  },

  // --------------------------------------------------------------------------
  // TOC entry styles
  // --------------------------------------------------------------------------
  {
    // TOC1..TOC3 are the one family of styles outside the predefined nine that
    // reaches the package, and the only place tab stops with leaders are
    // authored at theme level.
    name: 'theme/toc-entry-styles',
    document: page(
      [
        {
          name: 'toc',
          props: { title: 'Contents', depth: { from: 1, to: 3 } },
        },
        h({ text: 'Level one', level: 1 }),
        h({ text: 'Level two', level: 2 }),
        h({ text: 'Level three', level: 3 }),
        p({ text: 'Body after the tree.' }),
      ],
      {
        theme: 'minimal',
        themeOverrides: {
          styles: {
            TOC1: {
              font: 'heading',
              size: 12,
              bold: true,
              color: 'primary',
              spacing: { before: 6, after: 2 },
              tabStops: [{ type: 'right', position: 'max', leader: 'dot' }],
            },
            TOC2: {
              font: 'body',
              size: 11,
              color: 'textSecondary',
              indent: { left: 220 },
              tabStops: [{ type: 'right', position: 9026, leader: 'hyphen' }],
            },
            TOC3: {
              font: 'body',
              size: 10,
              italic: true,
              color: 'textMuted',
              indent: { left: 440 },
              tabStops: [{ type: 'right', position: 'max', leader: 'none' }],
            },
          },
        },
      }
    ),
  },

  // --------------------------------------------------------------------------
  // Document-level component defaults
  // --------------------------------------------------------------------------
  {
    // A default for every component slot the schema exposes, on components
    // that set nothing themselves.
    name: 'theme/component-defaults-document',
    document: page(
      [
        h({ text: 'Defaulted heading', level: 1 }),
        p({ text: 'Defaulted paragraph.' }),
        { name: 'list', props: { items: ['Alpha', 'Beta'] } },
        {
          name: 'statistic',
          props: { number: '12', description: 'Defaulted stat' },
        },
        { name: 'image', props: { base64: PNG_4X2 } },
        {
          name: 'table',
          props: {
            columns: [
              { header: { content: 'Left' }, cells: [{ content: 'one' }] },
              { header: { content: 'Right' }, cells: [{ content: 'two' }] },
            ],
          },
        },
        {
          name: 'columns',
          props: { columns: 2 },
          children: [p({ text: 'Left column.' }), p({ text: 'Right column.' })],
        },
      ],
      {
        theme: 'minimal',
        componentDefaults: {
          heading: {
            alignment: 'center',
            spacing: { before: 10, after: 6 },
            keepNext: true,
          },
          paragraph: {
            alignment: 'justify',
            font: { family: 'Georgia', size: 12, color: 'textSecondary' },
            spacing: { after: 8 },
            indent: { firstLine: 240 },
          },
          list: {
            format: 'lowerRoman',
            indent: 4,
            spacing: { after: 4, item: 2 },
          },
          table: {
            borderColor: '#334455',
            borderSize: 2,
            width: 90,
            cellDefaults: { padding: 4, color: 'text' },
            headerCellDefaults: {
              backgroundColor: 'backgroundSecondary',
              font: { bold: true },
            },
          },
          image: { alignment: 'center', width: 120 },
          statistic: { alignment: 'center', size: 'large' },
          section: { pageBreak: false },
          columns: { gap: 12 },
        },
      }
    ),
  },
  {
    // The same defaults with every component contradicting them, so the case
    // pins which side of the merge wins.
    name: 'theme/component-defaults-instance-wins',
    document: page(
      [
        h({
          text: 'Overriding heading',
          level: 1,
          alignment: 'right',
          spacing: { before: 0, after: 0 },
          keepNext: false,
        }),
        p({
          text: 'Overriding paragraph.',
          alignment: 'left',
          font: { family: 'Verdana', size: 9, color: 'primary' },
          spacing: { after: 0 },
          indent: { firstLine: 0 },
        }),
        {
          name: 'list',
          props: {
            items: ['Alpha', 'Beta'],
            format: 'decimal',
            indent: 1,
            spacing: { after: 0, item: 0 },
          },
        },
        {
          name: 'statistic',
          props: {
            number: '12',
            description: 'Overriding stat',
            alignment: 'left',
            size: 'small',
          },
        },
        {
          name: 'image',
          props: { base64: PNG_4X2, alignment: 'right', width: 60 },
        },
        {
          name: 'table',
          props: {
            borderColor: '#AA0000',
            borderSize: 6,
            width: 50,
            cellDefaults: { padding: 1, color: 'textMuted' },
            headerCellDefaults: {
              backgroundColor: 'transparent',
              font: { bold: false },
            },
            columns: [
              { header: { content: 'Left' }, cells: [{ content: 'one' }] },
              { header: { content: 'Right' }, cells: [{ content: 'two' }] },
            ],
          },
        },
      ],
      {
        theme: 'minimal',
        componentDefaults: {
          heading: {
            alignment: 'center',
            spacing: { before: 10, after: 6 },
            keepNext: true,
          },
          paragraph: {
            alignment: 'justify',
            font: { family: 'Georgia', size: 12, color: 'textSecondary' },
            spacing: { after: 8 },
            indent: { firstLine: 240 },
          },
          list: {
            format: 'lowerRoman',
            indent: 4,
            spacing: { after: 4, item: 2 },
          },
          table: {
            borderColor: '#334455',
            borderSize: 2,
            width: 90,
            cellDefaults: { padding: 4, color: 'text' },
            headerCellDefaults: {
              backgroundColor: 'backgroundSecondary',
              font: { bold: true },
            },
          },
          image: { alignment: 'center', width: 120 },
          statistic: { alignment: 'center', size: 'large' },
        },
      }
    ),
  },
  {
    // Heading numbering is switched on document-wide and opted out of once,
    // which is the only way `numbering: false` is meaningful.
    name: 'theme/component-defaults-heading-numbering',
    document: page(
      [
        h({ text: 'Numbered one', level: 1 }),
        h({ text: 'Numbered one point one', level: 2 }),
        h({ text: 'Unnumbered aside', level: 2, numbering: false }),
        h({ text: 'Numbered one point two', level: 2 }),
        h({ text: 'Numbered two', level: 1 }),
      ],
      {
        theme: 'minimal',
        componentDefaults: { heading: { numbering: true } },
      }
    ),
  },

  // --------------------------------------------------------------------------
  // Language and proofing
  // --------------------------------------------------------------------------
  {
    // The document default proofing language, with nothing overriding it.
    name: 'theme/language-document-default',
    document: page(
      [
        h({ text: 'Rapporto annuale', level: 1 }),
        p({ text: 'Il documento è redatto interamente in italiano.' }),
        { name: 'list', props: { items: ['Primo punto', 'Secondo punto'] } },
      ],
      { theme: 'minimal', language: 'it-IT' }
    ),
  },
  {
    // A document language plus every local escape from it: a component
    // language, a no-proof component, and a language tag with a script and a
    // region subtag.
    name: 'theme/language-component-overrides',
    document: page(
      [
        h({ text: 'Übersicht', level: 1, language: 'de-DE' }),
        p({ text: 'Ce paragraphe suit la langue du document.' }),
        p({ text: 'This one is tagged English.', language: 'en-GB' }),
        p({ text: 'const total = items.length;', noProof: true }),
        p({ text: '这一段使用繁体中文标签。', language: 'zh-Hant-TW' }),
      ],
      { theme: 'minimal', language: 'fr-FR' }
    ),
  },
  {
    // The document-level known-words allowlist, a component list merged on top
    // of it, and a component that inherits the document list unchanged.
    name: 'theme/no-proof-words',
    document: page(
      [
        p({ text: 'Wiseair ships json-to-office to every pptx pipeline.' }),
        p({
          text: 'Arcline and Meridian appear only here.',
          noProofWords: ['Arcline', 'Meridian'],
        }),
        h({
          text: 'json-to-office at Wiseair',
          level: 2,
          noProofWords: ['docx'],
        }),
      ],
      {
        theme: 'minimal',
        noProofWords: ['Wiseair', 'json-to-office', 'pptx'],
      }
    ),
  },

  // --------------------------------------------------------------------------
  // The shipped example documents, end to end
  // --------------------------------------------------------------------------
  {
    // `minimal` theme, no overrides: single column, hairline page frame from
    // a header-anchored SVG, ruled callout and note boxes.
    name: 'theme/example-practice-note',
    document: inlineImages(practiceNoteExample),
  },
  {
    // `devportal` theme, no overrides: two-column editorial layout, column
    // breaks, pull quotes and a headerless scorecard table.
    name: 'theme/example-field-review',
    document: inlineImages(fieldReviewExample),
  },
];

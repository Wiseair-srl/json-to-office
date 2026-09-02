import type { FormatName } from '../env';
import { definedColorKeys, type ThemeJson } from './model';

/**
 * A document that shows a theme.
 *
 * "Preview specimen" renders this through the ordinary generate + preview
 * path, so what the author sees is the real output of the real pipeline in
 * the theme they are editing: every named style, the colour tokens as
 * swatches, a table, and (PPTX) a native chart drawn from the palette.
 *
 * Only tokens the theme defines are referenced. A DOCX theme that leaves
 * `accent4` unset throws on a component that names it, and the specimen must
 * never be the thing that fails.
 */

const BODY_TEXT =
  'Body text in the normal style, with **bold**, *italic* and `mono` runs beside plain words so weight and the mono role read next to each other. A second sentence gives the line spacing and paragraph spacing room to show.';

const TOKEN_ROLES: Record<string, string> = {
  primary: 'Headings and the strongest brand colour',
  secondary: 'Supporting brand colour',
  accent: 'Highlights and emphasis',
  text: 'Body text',
  textPrimary: 'Primary text',
  textSecondary: 'Secondary text',
  textMuted: 'Captions and muted text',
  text2: 'Secondary text and captions',
  background: 'Page background',
  backgroundPrimary: 'Primary surface',
  backgroundSecondary: 'Alternate surface',
  background2: 'Alternate surface and rules',
  border: 'Rules and borders',
  borderPrimary: 'Primary rules',
  borderSecondary: 'Subtle rules',
  accent4: 'Chart series 4',
  accent5: 'Chart series 5',
  accent6: 'Chart series 6',
};

/** The colour keys worth a swatch: hex values only, references included. */
function swatchTokens(theme: ThemeJson | undefined): string[] {
  if (!theme) return [];
  return definedColorKeys(theme);
}

function hasStyle(theme: ThemeJson | undefined, name: string): boolean {
  const styles = theme?.styles;
  return !!styles && typeof styles === 'object' && name in (styles as object);
}

function docxSpecimen(
  themeName: string,
  theme: ThemeJson | undefined
): unknown {
  const tokens = swatchTokens(theme);
  const children: unknown[] = [];

  children.push(
    hasStyle(theme, 'title')
      ? {
          name: 'paragraph',
          props: { text: 'Theme specimen', themeStyle: 'title' },
        }
      : { name: 'heading', props: { text: 'Theme specimen', level: 1 } }
  );
  if (hasStyle(theme, 'subtitle')) {
    children.push({
      name: 'paragraph',
      props: {
        text: `Every named style, colour and font of "${themeName}", on one page.`,
        themeStyle: 'subtitle',
      },
    });
  } else {
    children.push({
      name: 'paragraph',
      props: {
        text: `Every named style, colour and font of "${themeName}", on one page.`,
      },
    });
  }

  children.push(
    { name: 'heading', props: { text: 'Heading 1 — Typography', level: 1 } },
    { name: 'paragraph', props: { text: BODY_TEXT } },
    { name: 'heading', props: { text: 'Heading 2 — Structure', level: 2 } },
    {
      name: 'paragraph',
      props: {
        text: 'A second paragraph under a second-level heading, so the spacing before and after headings can be judged against running text.',
      },
    },
    { name: 'heading', props: { text: 'Heading 3 — Detail', level: 3 } },
    {
      name: 'list',
      props: {
        items: [
          'Primary carries the headings',
          'Secondary supports it',
          'Accent marks emphasis',
        ],
      },
    },
    { name: 'divider', props: {} },
    { name: 'heading', props: { text: 'Figures', level: 2 } },
    {
      name: 'statistic',
      props: {
        number: '42%',
        description:
          'A statistic: the number in the heading font, the caption below it',
      },
    }
  );

  if (tokens.length > 0) {
    children.push(
      { name: 'heading', props: { text: 'Colours', level: 2 } },
      {
        name: 'table',
        props: {
          columns: [
            {
              header: { content: 'Token' },
              cells: tokens.map((token) => ({ content: token })),
            },
            {
              header: { content: 'Swatch' },
              cells: tokens.map((token) => ({
                content: ' ',
                backgroundColor: token,
              })),
            },
            {
              header: { content: 'Role' },
              cells: tokens.map((token) => ({
                content: TOKEN_ROLES[token] ?? '',
              })),
            },
          ],
        },
      }
    );
  }

  return {
    name: 'docx',
    props: {
      theme: themeName,
      metadata: {
        title: `${themeName} sample`,
        author: 'json-to-office playground',
        description: `Sample rendered in the "${themeName}" theme`,
      },
    },
    children: [{ name: 'section', props: {}, children }],
  };
}

function pptxSpecimen(
  themeName: string,
  theme: ThemeJson | undefined
): unknown {
  const tokens = swatchTokens(theme);
  const text = (
    content: string,
    style: string,
    x: number,
    y: number,
    w: number,
    h: number
  ) => ({ name: 'text', props: { text: content, style, x, y, w, h } });

  const slides: unknown[] = [
    {
      name: 'slide',
      props: { meta: { title: 'Title' } },
      children: [
        text('Theme specimen', 'title', 0.5, 1.6, 9, 1.2),
        text(
          `Named styles, colours and fonts of "${themeName}"`,
          'subtitle',
          0.5,
          2.9,
          9,
          0.8
        ),
      ],
    },
    {
      name: 'slide',
      props: { meta: { title: 'Typography' } },
      children: [
        text('Typography', 'heading1', 0.5, 0.4, 9, 0.8),
        text('Heading 2 — the section style', 'heading2', 0.5, 1.3, 9, 0.6),
        text('Heading 3 — the detail style', 'heading3', 0.5, 1.95, 9, 0.5),
        text(
          'Body text in the body style. It runs long enough to wrap onto a second line, so the line spacing and the body size can be judged against the headings above it.',
          'body',
          0.5,
          2.55,
          9,
          1.4
        ),
        text(
          'Caption — the smallest voice on the slide',
          'caption',
          0.5,
          4.1,
          9,
          0.4
        ),
      ],
    },
  ];

  if (tokens.length > 0) {
    const perRow = 6;
    const swatches: unknown[] = [];
    tokens.forEach((token, index) => {
      const column = index % perRow;
      const row = Math.floor(index / perRow);
      const x = 0.5 + column * 1.5;
      const y = 1.3 + row * 1.6;
      swatches.push(
        {
          name: 'shape',
          props: { type: 'rect', x, y, w: 1.3, h: 0.9, fill: { color: token } },
        },
        text(token, 'caption', x, y + 0.95, 1.3, 0.4)
      );
    });
    slides.push({
      name: 'slide',
      props: { meta: { title: 'Colours' } },
      children: [text('Colours', 'heading1', 0.5, 0.4, 9, 0.8), ...swatches],
    });
  }

  slides.push({
    name: 'slide',
    props: { meta: { title: 'Chart and table' } },
    children: [
      text('Chart and table', 'heading1', 0.5, 0.4, 9, 0.8),
      {
        name: 'chart',
        props: {
          type: 'bar',
          x: 0.5,
          y: 1.3,
          w: 4.6,
          h: 3.6,
          showLegend: true,
          data: [
            {
              name: 'Revenue',
              labels: ['Q1', 'Q2', 'Q3', 'Q4'],
              values: [120, 132, 145, 160],
            },
            {
              name: 'Cost',
              labels: ['Q1', 'Q2', 'Q3', 'Q4'],
              values: [80, 84, 91, 95],
            },
            {
              name: 'Margin',
              labels: ['Q1', 'Q2', 'Q3', 'Q4'],
              values: [40, 48, 54, 65],
            },
          ],
        },
      },
      {
        name: 'table',
        props: {
          x: 5.4,
          y: 1.3,
          w: 4.1,
          headerRow: true,
          rows: [
            [{ text: 'Metric' }, { text: 'Value' }],
            [{ text: 'Revenue' }, { text: '$4.2M' }],
            [{ text: 'Users' }, { text: '12,847' }],
            [{ text: 'Retention' }, { text: '94%' }],
          ],
        },
      },
    ],
  });

  return {
    name: 'pptx',
    props: { title: `${themeName} sample`, theme: themeName },
    children: slides,
  };
}

/** The output name a theme's sample builds under, so the header says what it is. */
export function sampleOutputName(themeName: string): string {
  return `Sample · ${themeName}`;
}

export function isSampleOutputName(name: string): boolean {
  return name.startsWith('Sample · ');
}

/**
 * The specimen for `themeName`. `theme` is the parsed theme when the caller
 * has it; it decides which tokens and styles the specimen dares to name.
 */
export function buildThemeSpecimen(
  format: FormatName,
  themeName: string,
  theme?: ThemeJson
): unknown {
  return format === 'docx'
    ? docxSpecimen(themeName, theme)
    : pptxSpecimen(themeName, theme);
}

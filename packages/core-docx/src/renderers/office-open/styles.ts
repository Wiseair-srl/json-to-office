/**
 * DocxIR styles, as `@office-open/docx` style options.
 *
 * A mechanical translation: which styles exist and what each one says was
 * decided by the compiler, and this only renames the fields. Nothing here reads
 * a theme.
 */

import type { DocxIrBuiltInStyle, DocxIrStyles } from '../../ir/types';
import { paragraphProperties, runProperties } from './emit';

type Opts = Record<string, unknown>;

function builtIn(style: DocxIrBuiltInStyle): Opts {
  return {
    ...(style.run ? { run: runProperties(style.run) } : {}),
    ...(style.paragraph
      ? { paragraph: paragraphProperties(style.paragraph) }
      : {}),
  };
}

/** Turn the IR's style set into the options the backend builds `styles.xml` from. */
export function emitStyles(styles: DocxIrStyles): Opts {
  // `w:docDefaults` says what the IR says and nothing more. Left out, either
  // half is filled with Word 365's own — theme fonts at 11pt, kerning,
  // ligatures, en-US/zh-CN/ar-SA, 8pt after and 1.16 lines — where docx.js
  // writes it empty, so a paragraph that states no spacing took 8pt after and
  // 1.16 lines on this backend alone. `null` asks the backend for an empty one.
  const defaults: Opts = {
    document: {
      run:
        Object.keys(styles.defaults.run).length > 0
          ? runProperties(styles.defaults.run)
          : null,
      paragraph:
        Object.keys(styles.defaults.paragraph).length > 0
          ? paragraphProperties(styles.defaults.paragraph)
          : null,
    },
  };
  for (const slot of [
    'footnoteText',
    'footnoteReference',
    'endnoteText',
    'endnoteReference',
  ] as const) {
    const style = styles.builtIn?.[slot];
    if (style) defaults[slot] = builtIn(style);
  }

  return {
    paragraphStyles: styles.paragraph.map((style) => ({
      id: style.id,
      name: style.name,
      ...(style.basedOn !== undefined ? { basedOn: style.basedOn } : {}),
      ...(style.next !== undefined ? { next: style.next } : {}),
      ...(style.quickFormat !== undefined
        ? { quickFormat: style.quickFormat }
        : {}),
      ...(style.run ? { run: runProperties(style.run) } : {}),
      ...(style.paragraph
        ? { paragraph: paragraphProperties(style.paragraph) }
        : {}),
    })),
    ...(styles.character.length > 0
      ? {
          characterStyles: styles.character.map((style) => ({
            id: style.id,
            name: style.name,
            ...(style.basedOn !== undefined ? { basedOn: style.basedOn } : {}),
            run: runProperties(style.run),
          })),
        }
      : {}),
    default: defaults,
  };
}

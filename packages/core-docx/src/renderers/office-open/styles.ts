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
  const documentDefaults: Opts = {
    ...(Object.keys(styles.defaults.run).length > 0
      ? { run: runProperties(styles.defaults.run) }
      : {}),
    ...(Object.keys(styles.defaults.paragraph).length > 0
      ? { paragraph: paragraphProperties(styles.defaults.paragraph) }
      : {}),
  };

  const defaults: Opts = {
    ...(Object.keys(documentDefaults).length > 0
      ? { document: documentDefaults }
      : {}),
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
    ...(Object.keys(defaults).length > 0 ? { default: defaults } : {}),
  };
}

/**
 * DocxIR styles, as docx.js style options.
 *
 * A mechanical translation: which styles exist and what each one says was
 * decided by the compiler, and this only renames the fields and restores the
 * units docx.js expects. Nothing here reads a theme.
 */

import {
  AlignmentType,
  BorderStyle,
  LineRuleType,
  UnderlineType,
  type IBaseParagraphStyleOptions,
  type IParagraphStylePropertiesOptions,
  type IRunStylePropertiesOptions,
  type IStylesOptions,
} from 'docx';
import type {
  DocxIrBorder,
  DocxIrBorders,
  DocxIrBuiltInStyle,
  DocxIrParagraphFormatting,
  DocxIrRunFormatting,
  DocxIrStyles,
} from '../../ir/types';
import { ALIGNMENT } from './emit';

/** Border style names, as docx.js spells them. */
const BORDER_STYLE: Record<
  string,
  (typeof BorderStyle)[keyof typeof BorderStyle]
> = {
  none: BorderStyle.NONE,
  single: BorderStyle.SINGLE,
  double: BorderStyle.DOUBLE,
  dashed: BorderStyle.DASHED,
  dotted: BorderStyle.DOTTED,
  thick: BorderStyle.THICK,
};

function runProperties(
  formatting: DocxIrRunFormatting
): IRunStylePropertiesOptions {
  const out: Record<string, unknown> = {};
  if (formatting.fontFamily !== undefined) out.font = formatting.fontFamily;
  if (formatting.sizeHalfPoints !== undefined) {
    out.size = formatting.sizeHalfPoints;
  }
  if (formatting.color) out.color = formatting.color.hex;
  if (formatting.bold !== undefined) out.bold = formatting.bold;
  if (formatting.italic !== undefined) out.italic = formatting.italic;
  if (formatting.underline) {
    out.underline = {
      type: formatting.underline
        .type as (typeof UnderlineType)[keyof typeof UnderlineType],
      ...(formatting.underline.color
        ? { color: formatting.underline.color.hex }
        : {}),
    };
  }
  if (formatting.strike !== undefined) out.strike = formatting.strike;
  if (formatting.superScript) out.superScript = true;
  if (formatting.subScript) out.subScript = true;
  if (formatting.smallCaps !== undefined) out.smallCaps = formatting.smallCaps;
  if (formatting.allCaps !== undefined) out.allCaps = formatting.allCaps;
  if (formatting.highlight !== undefined) out.highlight = formatting.highlight;
  if (formatting.characterSpacingTwentieths !== undefined) {
    out.characterSpacing = formatting.characterSpacingTwentieths;
  }
  if (formatting.scalePercent !== undefined)
    out.scale = formatting.scalePercent;
  if (formatting.noProof !== undefined) out.noProof = formatting.noProof;
  if (formatting.language !== undefined) {
    out.language = { value: formatting.language };
  }
  return out as IRunStylePropertiesOptions;
}

function border(value: DocxIrBorder) {
  return {
    style: BORDER_STYLE[value.style] ?? BorderStyle.SINGLE,
    ...(value.sizeEighthPoints !== undefined
      ? { size: value.sizeEighthPoints }
      : {}),
    ...(value.color ? { color: value.color.hex } : {}),
    ...(value.spacePoints !== undefined ? { space: value.spacePoints } : {}),
  };
}

function borders(value: DocxIrBorders) {
  const out: Record<string, unknown> = {};
  for (const side of ['top', 'bottom', 'left', 'right', 'between'] as const) {
    const side_ = value[side];
    if (side_) out[side] = border(side_);
  }
  return out;
}

function paragraphProperties(
  formatting: DocxIrParagraphFormatting
): IParagraphStylePropertiesOptions {
  const out: Record<string, unknown> = {};
  if (formatting.spacing) {
    const spacing: Record<string, unknown> = {};
    if (formatting.spacing.beforeTwips !== undefined) {
      spacing.before = formatting.spacing.beforeTwips;
    }
    if (formatting.spacing.afterTwips !== undefined) {
      spacing.after = formatting.spacing.afterTwips;
    }
    if (formatting.spacing.lineTwips !== undefined) {
      spacing.line = formatting.spacing.lineTwips;
    }
    if (formatting.spacing.lineRule !== undefined) {
      spacing.lineRule = formatting.spacing
        .lineRule as (typeof LineRuleType)[keyof typeof LineRuleType];
    }
    out.spacing = spacing;
  }
  if (formatting.alignment !== undefined) {
    out.alignment =
      ALIGNMENT[formatting.alignment] ??
      (formatting.alignment as (typeof AlignmentType)[keyof typeof AlignmentType]);
  }
  if (formatting.keepNext !== undefined) out.keepNext = formatting.keepNext;
  if (formatting.keepLines !== undefined) out.keepLines = formatting.keepLines;
  if (formatting.widowControl !== undefined) {
    out.widowControl = formatting.widowControl;
  }
  if (formatting.pageBreakBefore !== undefined) {
    out.pageBreakBefore = formatting.pageBreakBefore;
  }
  if (formatting.outlineLevel !== undefined) {
    out.outlineLevel = formatting.outlineLevel;
  }
  if (formatting.borders) out.border = borders(formatting.borders);
  if (formatting.indent) {
    const indent: Record<string, unknown> = {};
    if (formatting.indent.leftTwips !== undefined) {
      indent.left = formatting.indent.leftTwips;
    }
    if (formatting.indent.rightTwips !== undefined) {
      indent.right = formatting.indent.rightTwips;
    }
    if (formatting.indent.firstLineTwips !== undefined) {
      indent.firstLine = formatting.indent.firstLineTwips;
    }
    if (formatting.indent.hangingTwips !== undefined) {
      indent.hanging = formatting.indent.hangingTwips;
    }
    out.indent = indent;
  }
  if (formatting.tabStops) {
    out.tabStops = formatting.tabStops.map((stop) => ({
      type: stop.type,
      position: stop.positionTwips,
      ...(stop.leader ? { leader: stop.leader } : {}),
    }));
  }
  if (formatting.bidirectional !== undefined) {
    out.bidirectional = formatting.bidirectional;
  }
  return out as IParagraphStylePropertiesOptions;
}

function builtIn(style: DocxIrBuiltInStyle): IBaseParagraphStyleOptions {
  return {
    ...(style.run ? { run: runProperties(style.run) } : {}),
    ...(style.paragraph
      ? { paragraph: paragraphProperties(style.paragraph) }
      : {}),
  };
}

/** Turn the IR's style set into the options docx.js builds `styles.xml` from. */
export function emitStyles(styles: DocxIrStyles): IStylesOptions {
  const documentDefaults = {
    ...(Object.keys(styles.defaults.run).length > 0
      ? { run: runProperties(styles.defaults.run) }
      : {}),
    ...(Object.keys(styles.defaults.paragraph).length > 0
      ? { paragraph: paragraphProperties(styles.defaults.paragraph) }
      : {}),
  };

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
    default: {
      ...(Object.keys(documentDefaults).length > 0
        ? { document: documentDefaults }
        : {}),
      ...(styles.builtIn?.footnoteText
        ? { footnoteText: builtIn(styles.builtIn.footnoteText) }
        : {}),
      ...(styles.builtIn?.footnoteReference
        ? { footnoteReference: builtIn(styles.builtIn.footnoteReference) }
        : {}),
      ...(styles.builtIn?.endnoteText
        ? { endnoteText: builtIn(styles.builtIn.endnoteText) }
        : {}),
      ...(styles.builtIn?.endnoteReference
        ? { endnoteReference: builtIn(styles.builtIn.endnoteReference) }
        : {}),
    },
  };
}

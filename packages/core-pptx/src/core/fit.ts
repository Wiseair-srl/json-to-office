/**
 * Bounded text fit.
 *
 * A text component may declare `fit: { maxLines, shrink }`. The engine
 * estimates the lines the text takes at its effective size with the shared
 * width model; when it exceeds `maxLines` — or the box height when no line
 * count is declared — it steps down through the declared readable sizes, in
 * order, and takes the first that fits. Nothing else is tried: no size the
 * author did not declare, no reflow into another box. When nothing fits the
 * text is rejected with `text_fit_overflow` at the pointer the author can
 * patch — the slot for block content, the component otherwise.
 *
 * Runs after layout, so widths are absolute, and before quality analysis and
 * compilation, so both see the size that was actually chosen.
 */

import { BlockEvaluationError } from '@json-to-office/shared';
import type { PptxComponentInput, PptxThemeConfig, StyleName } from '../types';
import {
  defaultLineHeightPt,
  estimateTextHeightPt,
} from '../utils/textMetrics';
import { dimensionInches } from './dimensions';

export interface TextFitOptions {
  theme: PptxThemeConfig;
  slideWidth: number;
  slideHeight: number;
  /** Compiled pointer → the pointer diagnostics should name. */
  toAuthored?: (path: string) => string;
}

type Props = Record<string, unknown>;

interface Fit {
  maxLines?: number;
  shrink?: number[];
}

function textOf(props: Props): string | undefined {
  if (typeof props.text === 'string') return props.text;
  if (Array.isArray(props.runs))
    return props.runs
      .map((run) => {
        const record = run as Props;
        return `${typeof record.text === 'string' ? record.text : ''}${
          record.breakLine ? '\n' : ''
        }`;
      })
      .join('');
  return undefined;
}

export function applyTextFit(
  components: PptxComponentInput[],
  basePath: string,
  options: TextFitOptions
): PptxComponentInput[] {
  return components.map((component, index) =>
    fitOne(component, `${basePath}/children/${index}`, options)
  );
}

function fitOne(
  component: PptxComponentInput,
  path: string,
  options: TextFitOptions
): PptxComponentInput {
  if (component.enabled === false) return component;
  if (component.children && component.children.length > 0) {
    return {
      ...component,
      children: applyTextFit(component.children, path, options),
    };
  }
  if (component.name !== 'text') return component;
  const props = (component.props ?? {}) as Props;
  const fit = props.fit as Fit | undefined;
  if (!fit) return component;
  const text = textOf(props);
  if (text === undefined) return component;

  const style =
    typeof props.style === 'string'
      ? options.theme.styles?.[props.style as StyleName]
      : undefined;
  const authoredSize =
    typeof props.fontSize === 'number'
      ? props.fontSize
      : style?.fontSize ?? options.theme.defaults.fontSize;
  const x = dimensionInches(props.x, options.slideWidth) ?? 0;
  const widthIn =
    dimensionInches(props.w, options.slideWidth) ??
    Math.max(0.1, options.slideWidth - x);
  const heightIn = dimensionInches(props.h, options.slideHeight);
  const explicitSpacing =
    typeof props.lineSpacing === 'number'
      ? props.lineSpacing
      : style?.lineSpacing;
  const multiple =
    typeof props.lineSpacingMultiple === 'number'
      ? props.lineSpacingMultiple
      : undefined;
  const before =
    typeof props.paraSpaceBefore === 'number' ? props.paraSpaceBefore : 0;
  const after =
    typeof props.paraSpaceAfter === 'number'
      ? props.paraSpaceAfter
      : style?.paraSpaceAfter ?? 0;

  const measure = (size: number) =>
    estimateTextHeightPt(
      text,
      widthIn * 72,
      size,
      multiple !== undefined
        ? size * multiple
        : explicitSpacing ?? defaultLineHeightPt(size),
      before,
      after
    );
  const fits = (size: number): boolean => {
    const estimate = measure(size);
    if (fit.maxLines !== undefined && estimate.lines > fit.maxLines)
      return false;
    if (heightIn !== undefined && estimate.heightPt > heightIn * 72)
      return false;
    return true;
  };

  if (fits(authoredSize)) return component;
  for (const size of fit.shrink ?? []) {
    if (fits(size)) {
      return { ...component, props: { ...props, fontSize: size } };
    }
  }
  const estimate = measure(authoredSize);
  const bound =
    fit.maxLines !== undefined
      ? `${fit.maxLines} line${fit.maxLines === 1 ? '' : 's'}`
      : `a ${Math.round((heightIn ?? 0) * 72)}pt box`;
  const tried =
    fit.shrink && fit.shrink.length > 0
      ? ` and at ${fit.shrink.join(', ')}pt`
      : '';
  throw new BlockEvaluationError([
    {
      path: (options.toAuthored ?? ((pointer) => pointer))(
        `${path}/props/text`
      ),
      code: 'text_fit_overflow',
      message:
        `Text runs to ${estimate.lines} line${estimate.lines === 1 ? '' : 's'} at ${authoredSize}pt` +
        ` in a ${Math.round(widthIn * 72)}pt-wide box; it must fit ${bound}${tried}.` +
        ' Shorten the text, or declare wider bounds in the definition.',
    },
  ]);
}

/**
 * Slide layout resolution: frames, distribution and nested grids.
 *
 * After block expansion a slide holds content components, transparent
 * `group`s, and groups that carry a frame. This pass turns every one of them
 * into what the compiler has always drawn — components at absolute inches —
 * so that a block body written against a frame, a row of two-to-four metric
 * tiles, or a 1.1 : 1 two-column split needs no plugin and no per-block code.
 *
 * Rules, top to bottom:
 *
 * - At the slide level nothing changes for content: a `grid` placement is
 *   resolved against the slide grid exactly as before, an authored
 *   coordinate stays as authored, and a component with neither keeps its
 *   compiler default (the style band for text). A frameless, directionless
 *   group is a plain sequence: its children are slide-level children.
 * - A group with a frame (`x`/`y`/`w`/`h`, or `grid`) is a nested coordinate
 *   system. Inside it a child's numbers are offsets from the frame origin,
 *   percentages are fractions of the frame, and an omitted `x`/`y` or `w`/`h`
 *   means "the frame's". Its `gridConfig` merges over the enclosing grid; a
 *   nested grid spans the frame with no margin unless the config states one.
 * - A group with a `direction` distributes its enabled children into cells
 *   along that axis — equal, or by `weights` — separated by `gap`. A child
 *   fills its cell unless it states its own offsets. A child that collapsed
 *   away (an optional slot) simply is not there, so the rest redistribute.
 *
 * Geometry is decided once, here. The quality facts, the fit pass and the
 * compiler all read the same absolute boxes.
 */

import type { GridConfig, PipelineWarning, PptxComponentInput } from '../types';
import { dimensionInches } from './dimensions';
import {
  mergeGridConfigs,
  resolveComponentGridPosition,
  resolveGridPosition,
} from './grid';

export interface SlideLayoutOptions {
  grid?: GridConfig;
  slideWidth: number;
  slideHeight: number;
  warnings?: PipelineWarning[];
}

interface Extent {
  x: number;
  y: number;
  w: number;
  h: number;
}

type Props = Record<string, unknown>;

function hasFrame(props: Props): boolean {
  return ['x', 'y', 'w', 'h', 'grid'].some((key) => props[key] !== undefined);
}

/** Resolve every slide child to absolute inches; groups keep only their children. */
export function resolveSlideLayout(
  components: PptxComponentInput[],
  options: SlideLayoutOptions
): PptxComponentInput[] {
  return components.map((component) => placeAtRoot(component, options));
}

function placeAtRoot(
  component: PptxComponentInput,
  options: SlideLayoutOptions
): PptxComponentInput {
  if (component.name !== 'group') {
    return resolveComponentGridPosition(
      component,
      options.grid,
      options.slideWidth,
      options.slideHeight,
      options.warnings
    );
  }
  const props = (component.props ?? {}) as Props;
  const config = mergeGridConfigs(
    options.grid,
    props.gridConfig as GridConfig | undefined
  );
  const slide: Extent = {
    x: 0,
    y: 0,
    w: options.slideWidth,
    h: options.slideHeight,
  };
  if (!hasFrame(props) && props.direction === undefined) {
    // A plain sequence: its children are slide-level children.
    return {
      ...component,
      props: {},
      children: (component.children ?? []).map((child) =>
        placeAtRoot(child, { ...options, grid: config })
      ),
    };
  }
  const frame = boxWithin(props, slide, config, options);
  return {
    ...component,
    props: {},
    children: layoutChildren(component, frame, nestedConfig(config, props)),
  };
}

/**
 * A nested grid spans its frame. The enclosing grid's margin is the slide's
 * safe area, which has no meaning an inch inside a tile, so it is dropped
 * unless the group's own `gridConfig` states one.
 */
function nestedConfig(
  config: GridConfig | undefined,
  props: Props
): GridConfig {
  const own = props.gridConfig as GridConfig | undefined;
  return {
    ...(config ?? {}),
    margin: own?.margin ?? 0,
  };
}

/** A component's absolute box inside `extent`, from grid, coordinates or both. */
function boxWithin(
  props: Props,
  extent: Extent,
  config: GridConfig | undefined,
  options: SlideLayoutOptions
): Extent {
  const grid = props.grid as
    | { column: number; row: number; columnSpan?: number; rowSpan?: number }
    | undefined;
  const base = grid
    ? resolveGridPosition(grid, config, extent.w, extent.h, options.warnings)
    : { x: 0, y: 0, w: extent.w, h: extent.h };
  return {
    x: extent.x + (dimensionInches(props.x, extent.w) ?? base.x),
    y: extent.y + (dimensionInches(props.y, extent.h) ?? base.y),
    w: dimensionInches(props.w, extent.w) ?? base.w,
    h: dimensionInches(props.h, extent.h) ?? base.h,
  };
}

function layoutChildren(
  group: PptxComponentInput,
  frame: Extent,
  config: GridConfig
): PptxComponentInput[] {
  const children = group.children ?? [];
  const props = (group.props ?? {}) as Props;
  const direction = props.direction as 'row' | 'column' | undefined;
  if (!direction) {
    return children.map((child) => placeInside(child, frame, config));
  }
  const gap = typeof props.gap === 'number' ? props.gap : 0;
  const weights = Array.isArray(props.weights) ? props.weights : [];
  const active = children.filter((child) => child.enabled !== false);
  const total = active.reduce(
    (sum, _child, index) => sum + weightAt(weights, index),
    0
  );
  const along = direction === 'row' ? frame.w : frame.h;
  const usable = Math.max(0, along - gap * Math.max(0, active.length - 1));
  let cursor = direction === 'row' ? frame.x : frame.y;
  let activeIndex = 0;
  return children.map((child) => {
    if (child.enabled === false) return child;
    const size =
      total > 0 ? (usable * weightAt(weights, activeIndex)) / total : 0;
    const cell: Extent =
      direction === 'row'
        ? { x: cursor, y: frame.y, w: size, h: frame.h }
        : { x: frame.x, y: cursor, w: frame.w, h: size };
    cursor += size + gap;
    activeIndex += 1;
    return placeInside(child, cell, config);
  });
}

function weightAt(weights: unknown[], index: number): number {
  const value = weights[index];
  return typeof value === 'number' && value > 0 ? value : 1;
}

function placeInside(
  component: PptxComponentInput,
  extent: Extent,
  config: GridConfig
): PptxComponentInput {
  const props = (component.props ?? {}) as Props;
  const box = boxWithin(props, extent, config, {
    slideWidth: extent.w,
    slideHeight: extent.h,
  });
  if (component.name === 'group') {
    return {
      ...component,
      props: {},
      children: layoutChildren(component, box, nestedConfig(config, props)),
    };
  }
  const { grid: _grid, ...rest } = props; // eslint-disable-line @typescript-eslint/no-unused-vars
  return {
    ...component,
    props: { ...rest, x: box.x, y: box.y, w: box.w, h: box.h },
  };
}

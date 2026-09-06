# PPTX warnings

PPTX generation reports recoverable pipeline problems as structured warnings.
The presentation is still produced, although the affected content may be
skipped, clamped or rendered with a fallback.

Warnings are different from [validation errors](/guide/validation): validation
stops generation when the document contract is invalid. They are also different
from [design-quality findings](/guide/design-quality), which assess a valid
document against advisory rules and an optional policy gate.

## Collect warnings

Use the warning-aware generation entry point:

```ts
import { generateBufferWithWarnings } from '@json-to-office/json-to-pptx';

const { buffer, warnings } = await generateBufferWithWarnings(deck);

for (const warning of warnings) {
  console.warn(
    `[${warning.code}] ${warning.message}`,
    warning.component ?? '',
    warning.slide ?? ''
  );
}
```

Each `PipelineWarning` has this shape:

```ts
{
  code: string;
  message: string;
  component?: string;
  slide?: number;
}
```

`component` and `slide` are present when that context is available. Warning
order follows pipeline discovery and should not be used as a stable identifier;
branch on `code`.

## Warning codes

| Code                         | Meaning                                                                                                                                                                    |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `UNKNOWN_COMPONENT`          | Component name is not recognized; the node is skipped. Normally reachable only when validation is disabled or expansion produces an invalid standard component.            |
| `UNKNOWN_CHART_TYPE`         | `chart.type` is not supported.                                                                                                                                             |
| `UNKNOWN_SHAPE`              | `shape.type` is not supported.                                                                                                                                             |
| `UNKNOWN_PATTERN_PRESET`     | `fill.pattern.preset` is unsupported; the shape falls back to the solid foreground.                                                                                        |
| `ADVANCED_FILL_FALLBACK`     | A shape fill sets both gradient and pattern, so gradient wins; or a gradient has no stops and is ignored.                                                                  |
| `CHART_NO_DATA`              | A chart has no data series to render.                                                                                                                                      |
| `CHART_INVALID_SERIES`       | A series is missing labels or values; the chart is skipped.                                                                                                                |
| `CHART_MULTI_SERIES`         | A pie or doughnut chart has multiple series; only the first is rendered.                                                                                                   |
| `CHART_FONT_WEIGHT_DROPPED`  | A chart font weight renders as Regular because that PowerPoint slot has no bold toggle and the face cannot be resolved to a non-RIBBI subfamily.                           |
| `IMAGE_NO_SOURCE`            | An image has none of `path`, `base64` or `svg`; it is skipped.                                                                                                             |
| `IMAGE_PROBE_FAILED`         | Intrinsic image dimensions could not be read; auto-sizing may be affected.                                                                                                 |
| `IMAGE_ZERO_BOX`             | The resolved image box has zero width or height.                                                                                                                           |
| `IMAGE_SVG_RASTER_FAILED`    | Inline SVG rasterization failed. Viewers without SVG support show a broken-image placeholder; PowerPoint 2016 and later can use the original SVG.                          |
| `IMAGE_PATH_OUTSIDE_ROOTS`   | An image path resolves outside the allowed document roots; the image is dropped.                                                                                           |
| `TEXT_NO_CONTENT`            | Text has no renderable content and is skipped. With validation enabled, neither `text` nor `runs` is rejected earlier; an empty `runs` array can still reach this warning. |
| `TEXT_OVERLAP_UNPOSITIONED`  | Two text components without `x`/`y` overlap. Give at least one explicit coordinates or use styles with different default bands.                                            |
| `THEME_COLOR_FALLBACK`       | An optional theme color slot is missing; the renderer uses `primary`.                                                                                                      |
| `UNKNOWN_COLOR`              | A color is neither valid hex nor a semantic token, or its theme slot resolves to neither; the renderer falls back to `primary`.                                            |
| `GRID_POSITION_CLAMPED`      | A grid column or row is outside the grid and is clamped into range.                                                                                                        |
| `FONT_UNRESOLVED`            | A referenced font family cannot be resolved. See [Fonts](/guide/fonts).                                                                                                    |
| `HYPERLINK_SLIDE_UNRESOLVED` | `hyperlink.slide` matches no emitted slide because the target is disabled or the index is outside the authored range; the link is dropped and content renders unlinked.    |

Every code in the table except `HYPERLINK_SLIDE_UNRESOLVED` is a member of the
exported `WarningCodes` registry. Hyperlink resolution owns the remaining code;
match its literal value when handling it.

## Decide how strict to be

Warnings do not fail generation. A CI workflow can impose a zero-warning policy:

```ts
const { buffer, warnings } = await generateBufferWithWarnings(deck);

if (warnings.length > 0) {
  throw new Error(
    warnings.map(({ code, message }) => `${code}: ${message}`).join('\n')
  );
}
```

For a more targeted policy, compare `warning.code` against the codes your
workflow considers fatal. Keep [design-quality gating](/guide/design-quality#policies-and-gates)
separate: quality diagnostics have severity, certainty, suppressions and a
threshold; pipeline warnings do not.

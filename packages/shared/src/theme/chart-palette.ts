/**
 * Default series-color tokens for charts. Single source of truth for every
 * format: the PPTX `chart` and `highcharts` components and the DOCX
 * `highcharts` component all resolve this list, in this order, against the
 * active theme when the author sets no explicit colors. Both theme schemas
 * declare all six tokens (accent4-6 optional in each), so a theme that fills
 * every slot produces the same palette in a deck and in a document.
 *
 * Slots the theme leaves unset are skipped in both formats: the implicit
 * palette shrinks and the chart library cycles the shorter list rather than
 * repeating `primary` for every empty slot. A theme carrying only
 * primary/secondary/accent — which is what the bundled DOCX themes carry —
 * therefore paints series 4+ identically in a deck and in a document.
 *
 * Skipping compacts holes: a theme defining accent5 but not accent4 yields
 * [primary, secondary, accent, accent5], so accent5 paints series 4. The list
 * is a preference-ordered pool of candidate colors, not fixed per-series slots,
 * so keeping a color the theme did define beats dropping or duplicating one.
 *
 * A slot may also hold another token's name (`"accent4": "primary"`) — both
 * theme schemas allow it — and both formats walk that reference to hex before
 * using it, so a chained slot lands on the same color in a deck as in a
 * document. A slot whose value reaches no hex (`"accent4": "nonsense"`, or a
 * reference cycle) is dropped from the implicit palette in both formats rather
 * than emitted verbatim: PowerPoint and Highcharts both answer an unparseable
 * color with silent black. Parity here covers the token names the two schemas
 * share; each format also has private color keys (DOCX `textSecondary`, PPTX
 * `text2`) that only resolve in their own format.
 *
 * Only the implicit palette skips. An author who names a token explicitly
 * (PPTX `chartColors: ['accent4']`) still gets the `primary` fallback and a
 * warning — naming an undefined token is an authoring error and stays loud.
 * PPTX warns THEME_COLOR_FALLBACK for an unset slot and UNKNOWN_COLOR for one
 * holding an unresolvable value; DOCX throws.
 */
export const DEFAULT_CHART_THEME_COLORS = [
  'primary',
  'secondary',
  'accent',
  'accent4',
  'accent5',
  'accent6',
];

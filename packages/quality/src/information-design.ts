import {
  QUALITY_CODES,
  type DiagnosticSeverity,
  type JsonPatchOperation,
  type QualityRuleFinding,
} from './types';

/**
 * Information design shared by both formats: what a chart claims about its
 * numbers, and how a table lays them out.
 *
 * Both formats ask the same questions of a chart — is the comparison distorted,
 * is the palette the renderer's or the document's, can a reader tell what the
 * numbers mean — but neither can answer them from the same props. A slide chart
 * is `chartColors` and `valAxisMinVal`; a document chart drops the axis floor
 * entirely; a Highcharts config spells all of it a third way. So the shapes
 * below are the questions, each format's fact builder is the translation, and
 * the rule logic is written once here.
 *
 * Fixes stay with the formats. A repair is a patch against authored JSON, and
 * the two table models are transposes of each other — DOCX columns each own
 * their cells, PPTX rows each own theirs — so the same repair is one operation
 * in one format and one per row in the other. The finding builders take the
 * patch they are handed and never invent it.
 */

/** How a chart turns a number into something on the page. */
export type ChartEncoding = 'length' | 'position' | 'angle' | 'other';

/** The slot a chart carries for its takeaway or its source, if it has one. */
export interface ChartAnnotationSlot {
  stated: boolean;
  /**
   * Where the finding points. An empty slot has no pointer of its own — the
   * property is simply absent — so this is the component the author has to
   * add it to.
   */
  path: string;
  /** The property that carries it, named for the message: `props.caption`. */
  slot: string;
}

export interface ChartInfoDesign {
  /** RFC 6901 pointer to the chart component. */
  path: string;
  /** The authored type name, verbatim — `bar3D`, `column`, `pie`. */
  chartType: string;
  encoding: ChartEncoding;
  /** A perspective projection: pptx `bar3D`, Highcharts `chart.options3d`. */
  threeD: boolean;
  seriesCount: number;
  /** Categories in the longest series — a pie's slice count. */
  categoryCount: number;
  /** The document states the series colours rather than leaving the default. */
  seriesColorsStated: boolean;
  /** Where the palette belongs, whether or not it is stated. */
  seriesColorsPath: string;
  /** The authored value-axis floor; absent when the renderer picks one. */
  valueAxisMin?: number;
  /** Something on the chart names the unit its numbers are in. */
  unitStated: boolean;
  /** Absent when the component carries no caption or source slot at all. */
  annotation?: ChartAnnotationSlot;
}

export interface ChartInfoDesignOptions {
  /** Series past which a plot asks the eye to track too many lines. */
  maximumSeries?: number;
  /** Slices past which a pie stops being readable. */
  maximumSlices?: number;
  /** The patch that states the palette, when the format can build one. */
  seriesColorFix?: readonly JsonPatchOperation[];
}

export const DEFAULT_MAXIMUM_CHART_SERIES = 4;
export const DEFAULT_MAXIMUM_PIE_SLICES = 6;

/**
 * Every finding one chart earns.
 *
 * Ordered by how much of the chart each finding invalidates: a distorted
 * comparison first, then an overloaded one, then the scale, then the palette,
 * and last the two advisory gaps in what the chart tells a reader.
 */
export function chartInfoDesignFindings(
  chart: ChartInfoDesign,
  options: ChartInfoDesignOptions = {}
): QualityRuleFinding[] {
  const maximumSeries = options.maximumSeries ?? DEFAULT_MAXIMUM_CHART_SERIES;
  const maximumSlices = options.maximumSlices ?? DEFAULT_MAXIMUM_PIE_SLICES;
  const findings: QualityRuleFinding[] = [];

  if (chart.threeD) {
    findings.push({
      code: QUALITY_CODES.CHART_3D,
      severity: 'warning',
      category: 'information-design',
      certainty: 'deterministic',
      message: `\`${chart.chartType}\` draws the data in perspective, which makes the front of the chart read larger than the back — the comparison the chart exists for is the thing the projection distorts.`,
      path: chart.path,
      suggestion:
        'Use the flat form of the same chart; depth adds no dimension of data.',
      context: { chartType: chart.chartType },
      evidence: { actual: chart.chartType, summary: '3D projection' },
    });
  }

  // Slices and series are the same failure — too many things to compare at
  // once — counted differently by charts that encode with angle and charts
  // that encode with length or position. A line chart with twelve months is
  // a time series; a pie with twelve wedges is a colour-matching exercise.
  if (chart.encoding === 'angle') {
    if (chart.categoryCount > maximumSlices) {
      findings.push(
        overloadedFinding(chart, {
          actual: chart.categoryCount,
          maximum: maximumSlices,
          unit: 'slices',
          message: `${chart.categoryCount} slices in one ${chart.chartType} — past ${maximumSlices} the wedges are too close in angle to rank by eye.`,
          suggestion:
            'Keep the largest slices and gather the rest into one "other", or use a bar chart, where length ranks at a glance.',
        })
      );
    }
  } else if (chart.seriesCount > maximumSeries) {
    findings.push(
      overloadedFinding(chart, {
        actual: chart.seriesCount,
        maximum: maximumSeries,
        unit: 'series',
        message: `${chart.seriesCount} series on one chart — past ${maximumSeries} the reader spends the chart on the legend.`,
        suggestion:
          'Show the series that carry the message and drop or aggregate the rest, or split the chart into small multiples.',
      })
    );
  }

  // Only a chart that encodes with length: a bar twice as long has to mean
  // twice as much. A line encodes with position, where a zoomed axis is how
  // a small movement is made visible, and is standard practice.
  if (
    chart.encoding === 'length' &&
    chart.valueAxisMin !== undefined &&
    chart.valueAxisMin !== 0
  ) {
    findings.push({
      code: QUALITY_CODES.CHART_AXIS_BASELINE,
      severity: 'warning',
      category: 'information-design',
      certainty: 'deterministic',
      message: `The value axis starts at ${chart.valueAxisMin}, so the bars are lengths of a number nobody stated — a 2% difference can be drawn as a doubling.`,
      path: chart.path,
      suggestion:
        'Start the value axis at zero. To show a small movement, plot the change itself, or use a line chart, where position rather than length carries the value.',
      context: { valueAxisMin: chart.valueAxisMin },
      evidence: { actual: chart.valueAxisMin, expected: 0 },
    });
  }

  if (!chart.seriesColorsStated) {
    findings.push({
      code: QUALITY_CODES.CHART_SERIES_COLORS,
      severity: 'warning',
      category: 'brand',
      certainty: 'deterministic',
      message:
        'No series colours: the chart paints in the renderer’s default palette, which belongs to no document.',
      path: chart.seriesColorsPath,
      suggestion:
        'Name one theme colour per series, so the chart is part of the document rather than a picture pasted into it.',
      context: { seriesCount: chart.seriesCount },
      ...(options.seriesColorFix &&
        options.seriesColorFix.length > 0 && {
          fixes: options.seriesColorFix,
        }),
    });
  }

  // Advisory, both of them: the unit can live in the sentence beside the
  // chart and the source in a footnote, and neither is visible from here.
  if (!chart.unitStated) {
    findings.push({
      code: QUALITY_CODES.CHART_UNITS,
      severity: 'info',
      category: 'information-design',
      certainty: 'deterministic',
      message:
        'Nothing on the chart names the unit of its numbers — the axis title, the value format and the chart title are all silent.',
      path: chart.path,
      suggestion:
        'Put the unit where the numbers are: a value-axis title like "Revenue (€m)", or a format code on the labels.',
    });
  }

  if (chart.annotation && !chart.annotation.stated) {
    findings.push({
      code: QUALITY_CODES.CHART_ANNOTATION,
      severity: 'info',
      category: 'information-design',
      certainty: 'deterministic',
      message: `Nothing in \`${chart.annotation.slot}\`: the chart states no takeaway and cites no source.`,
      path: chart.annotation.path,
      context: { slot: chart.annotation.slot },
      suggestion:
        'Caption the chart with what it shows and where the numbers came from; a chart nobody has to interpret is worth the line.',
    });
  }

  return findings;
}

function overloadedFinding(
  chart: ChartInfoDesign,
  input: {
    actual: number;
    maximum: number;
    unit: string;
    message: string;
    suggestion: string;
  }
): QualityRuleFinding {
  return {
    code: QUALITY_CODES.CHART_OVERLOADED,
    severity: 'warning',
    category: 'information-design',
    certainty: 'deterministic',
    message: input.message,
    path: chart.path,
    suggestion: input.suggestion,
    context: {
      chartType: chart.chartType,
      [input.unit]: input.actual,
      maximum: input.maximum,
    },
    evidence: {
      actual: input.actual,
      expected: input.maximum,
      unit: input.unit,
    },
  };
}

/* ------------------------------------------------------------------ *
 * Highcharts
 * ------------------------------------------------------------------ */

/** What a Highcharts config says, in the vocabulary the rules speak. */
export interface HighchartsChartShape {
  chartType: string;
  encoding: ChartEncoding;
  threeD: boolean;
  seriesCount: number;
  categoryCount: number;
  seriesColorsStated: boolean;
  valueAxisMin?: number;
  unitStated: boolean;
  annotationStated: boolean;
}

type Rec = Record<string, unknown>;

function record(value: unknown): Rec | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Rec)
    : undefined;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function finite(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value)
    ? value
    : undefined;
}

/** Highcharts spells a chart type on `chart.type` or on each series. */
const ANGLE_TYPES = new Set(['pie', 'variablepie', 'funnel', 'pyramid']);
const LENGTH_TYPES = new Set([
  'bar',
  'column',
  'waterfall',
  'bullet',
  'columnrange',
  'columnpyramid',
]);
const POSITION_TYPES = new Set([
  'line',
  'spline',
  'area',
  'areaspline',
  'arearange',
  'scatter',
  'bubble',
]);

/** Whether a type name draws lengths, positions or angles. */
export function chartEncodingFor(chartType: string): ChartEncoding {
  const name = chartType.toLowerCase();
  if (ANGLE_TYPES.has(name) || name === 'doughnut' || name === 'donut') {
    return 'angle';
  }
  if (
    LENGTH_TYPES.has(name) ||
    name.startsWith('bar') ||
    name === 'histogram'
  ) {
    return 'length';
  }
  if (POSITION_TYPES.has(name)) return 'position';
  return 'other';
}

/**
 * Read a Highcharts config into the shape the rules judge.
 *
 * Deliberately tolerant: `options` is an opaque record in the schema and is
 * forwarded to the export server verbatim, so anything this cannot find is
 * reported as unstated rather than guessed at — and an unstated *unit* is only
 * ever advisory, which is what makes that the safe direction.
 */
export function normalizeHighchartsChart(
  options: unknown
): HighchartsChartShape {
  const config = record(options) ?? {};
  const chart = record(config.chart) ?? {};
  const series = Array.isArray(config.series) ? config.series : [];
  const seriesRecords = series.flatMap((entry) => {
    const found = record(entry);
    return found ? [found] : [];
  });

  const chartType = text(chart.type) || text(seriesRecords[0]?.type) || 'line';
  const options3d = record(chart.options3d);

  const categoryCount = Math.max(
    0,
    ...seriesRecords.map((entry) =>
      Array.isArray(entry.data) ? entry.data.length : 0
    ),
    Array.isArray(record(config.xAxis)?.categories)
      ? (record(config.xAxis)?.categories as unknown[]).length
      : 0
  );

  const paletteStated =
    (Array.isArray(config.colors) && config.colors.length > 0) ||
    (seriesRecords.length > 0 &&
      seriesRecords.every((entry) => typeof entry.color === 'string'));

  // `yAxis` is a single object or an array of them; the primary axis is the
  // one a value is read against unless the config says otherwise.
  const yAxis = Array.isArray(config.yAxis)
    ? record(config.yAxis[0])
    : record(config.yAxis);

  const labelFormats = [
    ...Object.values(record(config.plotOptions) ?? {}).flatMap((entry) => {
      const labels = record(record(entry)?.dataLabels);
      return [text(labels?.format), text(labels?.valueSuffix)];
    }),
    text(record(yAxis?.labels)?.format),
    text(record(config.tooltip)?.valueSuffix),
  ];

  return {
    chartType,
    encoding: chartEncodingFor(chartType),
    threeD: options3d?.enabled === true,
    seriesCount: seriesRecords.length,
    categoryCount,
    seriesColorsStated: paletteStated,
    ...(finite(yAxis?.min) !== undefined && {
      valueAxisMin: finite(yAxis?.min),
    }),
    unitStated:
      hasUnitMarker(text(record(yAxis?.title)?.text)) ||
      hasUnitMarker(text(record(config.title)?.text)) ||
      hasUnitMarker(text(record(config.subtitle)?.text)) ||
      labelFormats.some((format) => hasUnitMarker(format)),
    annotationStated:
      text(record(config.caption)?.text).trim() !== '' ||
      text(record(config.subtitle)?.text).trim() !== '',
  };
}

/* ------------------------------------------------------------------ *
 * Tables
 * ------------------------------------------------------------------ */

export type TableAlignment = 'left' | 'center' | 'right' | 'justify' | 'mixed';

export interface TableColumnInfoDesign {
  index: number;
  /**
   * RFC 6901 pointer the findings about this column report. A column-major
   * table has a node for it; a row-major one points at the column's top cell,
   * so that two columns of one table never share an address.
   */
  path: string;
  /** Header text, when the table has a header row. */
  header?: string;
  /** Body cell text in row order, header excluded. */
  values: readonly string[];
  /** Effective alignment of the body cells; `mixed` when they disagree. */
  alignment: TableAlignment;
}

export interface TableInfoDesign {
  /** RFC 6901 pointer to the table component. */
  path: string;
  columns: readonly TableColumnInfoDesign[];
  /** Rows the table draws, header included — what the surface has to hold. */
  rowCount: number;
  /** Every cell draws a visible border on all four sides. */
  fullGrid: boolean;
  /** Where the grid is declared, for the finding to point at. */
  gridPath?: string;
}

export interface TableInfoDesignOptions<
  TColumn extends TableColumnInfoDesign = TableColumnInfoDesign,
> {
  maximumRows?: number;
  /** What the rows have to fit on, for the message. */
  rowSurface?: 'slide' | 'page';
  rowSeverity?: DiagnosticSeverity;
  /** The patch that right-aligns one column, when the format can build one. */
  alignFix?: (column: TColumn) => readonly JsonPatchOperation[] | undefined;
}

export function tableInfoDesignFindings<TColumn extends TableColumnInfoDesign>(
  table: TableInfoDesign & { columns: readonly TColumn[] },
  options: TableInfoDesignOptions<TColumn> = {}
): QualityRuleFinding[] {
  const findings: QualityRuleFinding[] = [];

  for (const column of table.columns) {
    const profile = columnNumericProfile(column.values);
    if (!profile.numeric) continue;

    if (column.alignment !== 'right') {
      const fixes = options.alignFix?.(column);
      findings.push({
        code: QUALITY_CODES.TABLE_NUMERIC_ALIGN,
        severity: 'warning',
        category: 'information-design',
        certainty: 'deterministic',
        message: `${describeColumn(column)} holds ${profile.counted} numbers and is aligned ${column.alignment} — digits only line up by place value when they are flush right.`,
        path: column.path,
        suggestion:
          'Right-align the column, header included, so units sit over units and the reader can compare magnitudes down the column.',
        context: {
          column: column.index,
          alignment: column.alignment,
          ...(column.header !== undefined && { header: column.header }),
        },
        evidence: {
          actual: column.alignment,
          expected: 'right',
          values: { numbers: profile.counted },
        },
        ...(fixes && fixes.length > 0 && { fixes }),
      });
    }

    if (profile.decimals.length > 1) {
      findings.push({
        code: QUALITY_CODES.TABLE_MIXED_DECIMALS,
        severity: 'warning',
        category: 'information-design',
        certainty: 'deterministic',
        message: `${describeColumn(column)} is rounded ${profile.decimals.length} different ways (${profile.decimals.join(', ')} decimal places) — a column of numbers reads as one quantity, and inconsistent precision reads as inconsistent data.`,
        path: column.path,
        suggestion:
          'Round every cell in the column to the precision the source actually supports, and pad the rest with zeros.',
        context: {
          column: column.index,
          decimalPlaces: profile.decimals,
          ...(column.header !== undefined && { header: column.header }),
        },
        evidence: {
          actual: profile.decimals,
          unit: 'decimal places',
        },
      });
    }
  }

  if (table.fullGrid) {
    findings.push({
      code: QUALITY_CODES.TABLE_GRID,
      severity: 'info',
      category: 'information-design',
      certainty: 'deterministic',
      message:
        'Every cell is boxed on all four sides, which spends ink on the container rather than on the numbers and reads as a spreadsheet.',
      path: table.gridPath ?? table.path,
      suggestion:
        'Keep a rule under the header and, where rows need separating, between rows; drop the vertical rules and the outer box, and let alignment and space do the work.',
    });
  }

  const maximumRows = options.maximumRows;
  if (maximumRows !== undefined && table.rowCount > maximumRows) {
    const surface = options.rowSurface ?? 'page';
    findings.push({
      code: QUALITY_CODES.TABLE_ROW_COUNT,
      severity: options.rowSeverity ?? 'info',
      category: 'information-design',
      certainty: 'deterministic',
      message: `${table.rowCount} rows ${surface === 'slide' ? 'on one slide' : 'in one table'} — past ${maximumRows} the table is a data dump rather than something anybody reads in place.`,
      path: table.path,
      suggestion:
        surface === 'slide'
          ? 'Show the rows that carry the message and move the rest to an appendix or to the document.'
          : 'Summarise the rows that carry the argument here and move the full set to an appendix.',
      context: { rows: table.rowCount, maximum: maximumRows },
      evidence: {
        actual: table.rowCount,
        expected: maximumRows,
        unit: 'rows',
      },
    });
  }

  return findings;
}

function describeColumn(column: TableColumnInfoDesign): string {
  return column.header !== undefined && column.header.trim() !== ''
    ? `Column "${column.header.trim()}"`
    : `Column ${column.index + 1}`;
}

/* ------------------------------------------------------------------ *
 * Numbers
 * ------------------------------------------------------------------ */

/**
 * A cell that stands for a missing value rather than for text.
 *
 * Real tables are full of these, and reading one as text would make every
 * column with a gap invisible to the alignment rule — which is the column
 * most likely to have been laid out carelessly.
 */
const BLANK_CELL = /^(?:|[-–—]|n\/?a|n\.a\.|tbd|\.|·|–|—)$/i;

/** Symbols and suffixes a number wears, none of which change what it is. */
const CURRENCY = /[$€£¥₹¢₽₺]|\b(?:usd|eur|gbp|chf|jpy|cad|aud)\b/gi;
const MAGNITUDE_SUFFIX = /(?<=\d)\s*(?:k|m|mn|bn|b|tn|pp|bps|x)\b/i;

export interface ColumnNumericProfile {
  /** At least two cells parse as numbers and none of the rest is text. */
  numeric: boolean;
  /** Every distinct decimal-place count found, ascending. */
  decimals: readonly number[];
  /** How many cells actually carried a number. */
  counted: number;
}

/**
 * Whether a column is a column of numbers, and how it is rounded.
 *
 * Two numbers is the floor: a single figure beside a label is a fact, not a
 * column, and right-aligning it is a matter of taste rather than of place
 * value. One non-blank cell that is not a number disqualifies the column
 * outright — a total row spelled "Total" belongs to the label column, and a
 * column mixing prose and figures has a bigger problem than its alignment.
 */
export function columnNumericProfile(
  values: readonly string[]
): ColumnNumericProfile {
  const decimals = new Set<number>();
  let counted = 0;
  for (const value of values) {
    const trimmed = value.trim();
    if (BLANK_CELL.test(trimmed)) continue;
    const parsed = parseNumericCell(trimmed);
    if (!parsed) return { numeric: false, decimals: [], counted };
    counted += 1;
    decimals.add(parsed.decimals);
  }
  return {
    numeric: counted >= 2,
    decimals: [...decimals].sort((a, b) => a - b),
    counted,
  };
}

/**
 * The number a cell states, and how many decimal places it is written to.
 *
 * The separator question has no universal answer — `1.234` is one thousand
 * two hundred and thirty-four in Milan and one-point-two-three-four in
 * Chicago — so the rule is positional rather than locale-aware: exactly three
 * digits after the last separator is a thousands group, anything else is a
 * decimal fraction. That reads `50,00` as fifty (the form the stock annual
 * report writes currency in) and `1,234` as one thousand two hundred and
 * thirty-four, which is the common case in both conventions.
 */
export function parseNumericCell(
  text: string
): { value: number; decimals: number } | undefined {
  let body = text.trim();
  if (body === '') return undefined;

  // Accounting negatives: (1,200) is minus one thousand two hundred.
  let sign = 1;
  const bracketed = /^\((.*)\)$/.exec(body);
  if (bracketed) {
    sign = -1;
    body = bracketed[1].trim();
  }

  body = body.replace(CURRENCY, '').replace(/%/g, '').trim();
  body = body.replace(MAGNITUDE_SUFFIX, '').trim();
  body = body.replace(/[\s'’]/g, '');

  const leading = /^([+\-−])(.*)$/.exec(body);
  if (leading) {
    if (leading[1] !== '+') sign = -sign;
    body = leading[2];
  }
  if (body === '' || !/^[\d.,]+$/.test(body)) return undefined;

  const separators = [...body].filter(
    (character) => character === '.' || character === ','
  );
  if (separators.length === 0) {
    if (!/^\d+$/.test(body)) return undefined;
    return { value: sign * Number(body), decimals: 0 };
  }

  const lastIndex = Math.max(body.lastIndexOf('.'), body.lastIndexOf(','));
  const head = body.slice(0, lastIndex);
  const tail = body.slice(lastIndex + 1);
  if (!/^\d+$/.test(tail) || tail === '') return undefined;
  // Every earlier separator has to be a thousands mark, so what sits between
  // them has to be a group of three: "1.2.3" is a date, not a number.
  if (head !== '' && !/^\d{1,3}(?:[.,]\d{3})*$/.test(head)) return undefined;

  const digitsOnlyHead = head.replace(/[.,]/g, '');
  // Three trailing digits is a thousands group only when every separator in
  // the number is the same character. Once both marks appear, the last one is
  // unambiguously the decimal point in either convention: `1,234.567` and
  // `1.234,567` are the same number, and reading either as 1234567 would put
  // a three-decimal column in with the integers.
  const otherMark = body[lastIndex] === '.' ? ',' : '.';
  const thousands = tail.length === 3 && !head.includes(otherMark);
  const value = thousands
    ? Number(`${digitsOnlyHead}${tail}`)
    : Number(`${digitsOnlyHead === '' ? '0' : digitsOnlyHead}.${tail}`);
  if (!Number.isFinite(value)) return undefined;
  return { value: sign * value, decimals: thousands ? 0 : tail.length };
}

/**
 * Whether a label names the unit its numbers are in.
 *
 * Deliberately generous — a parenthesised suffix counts, and so does any
 * currency or percent sign — because the finding it feeds is advisory and the
 * unit may well be in the sentence beside the chart. "Revenue" alone does not
 * count: it names the quantity, which is not the same as saying whether the
 * axis is in euros, millions of euros, or index points.
 */
const UNIT_MARKER =
  /[%$€£¥₹]|\([^)]{1,24}\)|\b(?:bn|mn|pp|bps|kg|km|kwh|mwh?|gwh?|tco2e?|usd|eur|gbp|chf|units?|hours?|days?|weeks?|months?|years?|fte|index|per\s+\w+)\b/i;

export function hasUnitMarker(label: string): boolean {
  return UNIT_MARKER.test(label);
}

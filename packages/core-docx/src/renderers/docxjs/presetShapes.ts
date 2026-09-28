/**
 * OOXML preset names → the names `docx/shapes` takes.
 *
 * The IR speaks OOXML — `a:prstGeom/@prst`, `a:prstDash/@val` — because that
 * is what a DOCX stores and what the office-open backend writes verbatim.
 * `docx/shapes` takes readable names instead (`roundRect` is
 * `"roundedRectangle"`, `sysDot` is `"shortDot"`) and translates them back on
 * the way out. Its own OOXML tables are declared but not exported, so the
 * mapping lives here.
 *
 * Both maps are total over what docx 9.8.0 accepts, and a compile-time guard
 * breaks the build when an upgrade adds a name the map lacks. Both lookups
 * throw on a name they do not know rather than passing it through: docx throws
 * for an unknown preset, but it writes an empty `<a:prstDash/>` for an unknown
 * dash, which Word reads as solid — a silent change of look.
 */

import type { LineDash, PresetShapeType } from 'docx/shapes';

/**
 * OOXML `a:prstGeom/@prst` → `docx/shapes` preset name, total over the 187
 * `ST_ShapeType` values. Generated from `PRESET_SHAPE_OOXML_NAMES` in
 * `docx/dist/shapes.d.ts`, in upstream order.
 */
export const OOXML_PRESET_TO_DOCX = {
  line: 'line',
  lineInv: 'inverseLine',
  straightConnector1: 'straightConnector',
  bentConnector2: 'elbowConnectorOneBend',
  bentConnector3: 'elbowConnector',
  bentConnector4: 'elbowConnectorThreeBends',
  bentConnector5: 'elbowConnectorFourBends',
  curvedConnector2: 'curvedConnectorOneBend',
  curvedConnector3: 'curvedConnector',
  curvedConnector4: 'curvedConnectorThreeBends',
  curvedConnector5: 'curvedConnectorFourBends',
  triangle: 'triangle',
  rtTriangle: 'rightTriangle',
  diamond: 'diamond',
  parallelogram: 'parallelogram',
  trapezoid: 'trapezoid',
  nonIsoscelesTrapezoid: 'nonIsoscelesTrapezoid',
  pentagon: 'pentagon',
  hexagon: 'hexagon',
  heptagon: 'heptagon',
  octagon: 'octagon',
  decagon: 'decagon',
  dodecagon: 'dodecagon',
  ellipse: 'ellipse',
  teardrop: 'teardrop',
  pieWedge: 'pieWedge',
  pie: 'pie',
  blockArc: 'blockArc',
  donut: 'donut',
  noSmoking: 'noSymbol',
  chord: 'chord',
  arc: 'arc',
  frame: 'frame',
  halfFrame: 'halfFrame',
  corner: 'lShape',
  diagStripe: 'diagonalStripe',
  plus: 'cross',
  plaque: 'plaque',
  can: 'cylinder',
  cube: 'cube',
  bevel: 'beveledRectangle',
  foldedCorner: 'foldedCorner',
  smileyFace: 'smileyFace',
  heart: 'heart',
  lightningBolt: 'lightningBolt',
  sun: 'sun',
  moon: 'moon',
  cloud: 'cloud',
  leftBracket: 'leftBracket',
  rightBracket: 'rightBracket',
  leftBrace: 'leftBrace',
  rightBrace: 'rightBrace',
  bracketPair: 'bracketPair',
  bracePair: 'bracePair',
  rect: 'rectangle',
  roundRect: 'roundedRectangle',
  round1Rect: 'roundedCornerRectangle',
  round2SameRect: 'topRoundedCornersRectangle',
  round2DiagRect: 'diagonalRoundedCornersRectangle',
  snip1Rect: 'snippedCornerRectangle',
  snip2SameRect: 'topSnippedCornersRectangle',
  snip2DiagRect: 'diagonalSnippedCornersRectangle',
  snipRoundRect: 'roundedAndSnippedCornersRectangle',
  rightArrow: 'rightArrow',
  leftArrow: 'leftArrow',
  upArrow: 'upArrow',
  downArrow: 'downArrow',
  leftRightArrow: 'leftRightArrow',
  upDownArrow: 'upDownArrow',
  quadArrow: 'quadArrow',
  leftRightUpArrow: 'leftRightUpArrow',
  bentArrow: 'bentArrow',
  uturnArrow: 'uTurnArrow',
  leftUpArrow: 'leftUpArrow',
  bentUpArrow: 'bentUpArrow',
  curvedRightArrow: 'curvedRightArrow',
  curvedLeftArrow: 'curvedLeftArrow',
  curvedUpArrow: 'curvedUpArrow',
  curvedDownArrow: 'curvedDownArrow',
  stripedRightArrow: 'stripedRightArrow',
  notchedRightArrow: 'notchedRightArrow',
  homePlate: 'pentagonArrow',
  chevron: 'chevron',
  rightArrowCallout: 'rightArrowCallout',
  downArrowCallout: 'downArrowCallout',
  leftArrowCallout: 'leftArrowCallout',
  upArrowCallout: 'upArrowCallout',
  leftRightArrowCallout: 'leftRightArrowCallout',
  upDownArrowCallout: 'upDownArrowCallout',
  quadArrowCallout: 'quadArrowCallout',
  circularArrow: 'circularArrow',
  leftCircularArrow: 'leftCircularArrow',
  leftRightCircularArrow: 'leftRightCircularArrow',
  swooshArrow: 'swooshArrow',
  mathPlus: 'mathPlus',
  mathMinus: 'mathMinus',
  mathMultiply: 'mathMultiply',
  mathDivide: 'mathDivide',
  mathEqual: 'mathEqual',
  mathNotEqual: 'mathNotEqual',
  flowChartProcess: 'flowChartProcess',
  flowChartAlternateProcess: 'flowChartAlternateProcess',
  flowChartDecision: 'flowChartDecision',
  flowChartInputOutput: 'flowChartInputOutput',
  flowChartPredefinedProcess: 'flowChartPredefinedProcess',
  flowChartInternalStorage: 'flowChartInternalStorage',
  flowChartDocument: 'flowChartDocument',
  flowChartMultidocument: 'flowChartMultidocument',
  flowChartTerminator: 'flowChartTerminator',
  flowChartPreparation: 'flowChartPreparation',
  flowChartManualInput: 'flowChartManualInput',
  flowChartManualOperation: 'flowChartManualOperation',
  flowChartConnector: 'flowChartConnector',
  flowChartOffpageConnector: 'flowChartOffpageConnector',
  flowChartPunchedCard: 'flowChartPunchedCard',
  flowChartPunchedTape: 'flowChartPunchedTape',
  flowChartSummingJunction: 'flowChartSummingJunction',
  flowChartOr: 'flowChartOr',
  flowChartCollate: 'flowChartCollate',
  flowChartSort: 'flowChartSort',
  flowChartExtract: 'flowChartExtract',
  flowChartMerge: 'flowChartMerge',
  flowChartOfflineStorage: 'flowChartOfflineStorage',
  flowChartOnlineStorage: 'flowChartOnlineStorage',
  flowChartDelay: 'flowChartDelay',
  flowChartMagneticTape: 'flowChartMagneticTape',
  flowChartMagneticDisk: 'flowChartMagneticDisk',
  flowChartMagneticDrum: 'flowChartMagneticDrum',
  flowChartDisplay: 'flowChartDisplay',
  irregularSeal1: 'explosion12',
  irregularSeal2: 'explosion14',
  star4: 'star4',
  star5: 'star5',
  star6: 'star6',
  star7: 'star7',
  star8: 'star8',
  star10: 'star10',
  star12: 'star12',
  star16: 'star16',
  star24: 'star24',
  star32: 'star32',
  ribbon2: 'ribbonUp',
  ribbon: 'ribbonDown',
  ellipseRibbon2: 'curvedRibbonUp',
  ellipseRibbon: 'curvedRibbonDown',
  leftRightRibbon: 'leftRightRibbon',
  verticalScroll: 'verticalScroll',
  horizontalScroll: 'horizontalScroll',
  wave: 'wave',
  doubleWave: 'doubleWave',
  wedgeRectCallout: 'rectangularCallout',
  wedgeRoundRectCallout: 'roundedRectangularCallout',
  wedgeEllipseCallout: 'ellipticalCallout',
  cloudCallout: 'cloudCallout',
  borderCallout1: 'lineCallout',
  borderCallout2: 'bentLineCallout',
  borderCallout3: 'doubleBentLineCallout',
  accentCallout1: 'lineCalloutWithAccentBar',
  accentCallout2: 'bentLineCalloutWithAccentBar',
  accentCallout3: 'doubleBentLineCalloutWithAccentBar',
  callout1: 'lineCalloutWithNoBorder',
  callout2: 'bentLineCalloutWithNoBorder',
  callout3: 'doubleBentLineCalloutWithNoBorder',
  accentBorderCallout1: 'lineCalloutWithBorderAndAccentBar',
  accentBorderCallout2: 'bentLineCalloutWithBorderAndAccentBar',
  accentBorderCallout3: 'doubleBentLineCalloutWithBorderAndAccentBar',
  actionButtonBlank: 'actionButtonBlank',
  actionButtonHome: 'actionButtonHome',
  actionButtonHelp: 'actionButtonHelp',
  actionButtonInformation: 'actionButtonInformation',
  actionButtonForwardNext: 'actionButtonForwardNext',
  actionButtonBackPrevious: 'actionButtonBackPrevious',
  actionButtonEnd: 'actionButtonEnd',
  actionButtonBeginning: 'actionButtonBeginning',
  actionButtonReturn: 'actionButtonReturn',
  actionButtonDocument: 'actionButtonDocument',
  actionButtonSound: 'actionButtonSound',
  actionButtonMovie: 'actionButtonMovie',
  gear6: 'gear6',
  gear9: 'gear9',
  funnel: 'funnel',
  cornerTabs: 'cornerTabs',
  squareTabs: 'squareTabs',
  plaqueTabs: 'plaqueTabs',
  chartX: 'chartX',
  chartStar: 'chartStar',
  chartPlus: 'chartPlus',
} as const satisfies Record<string, PresetShapeType>;

// Compile-time completeness: a docx upgrade that adds a preset this map does
// not reach fails the build here, not a document at render time.
type MissingPreset = Exclude<
  PresetShapeType,
  (typeof OOXML_PRESET_TO_DOCX)[keyof typeof OOXML_PRESET_TO_DOCX]
>;
const presetsComplete: [MissingPreset] extends [never] ? true : never = true;
void presetsComplete;

/** The `docx/shapes` name for an OOXML preset geometry. */
export function docxPresetShape(geometry: string): PresetShapeType {
  const name = Object.hasOwn(OOXML_PRESET_TO_DOCX, geometry)
    ? OOXML_PRESET_TO_DOCX[geometry as keyof typeof OOXML_PRESET_TO_DOCX]
    : undefined;
  if (!name) {
    throw new Error(
      `the docxjs renderer has no preset for the OOXML geometry "${geometry}"`
    );
  }
  return name;
}

/** OOXML `a:prstDash/@val` → `docx/shapes` dash name, total over `ST_PresetLineDashVal`. */
export const OOXML_DASH_TO_DOCX = {
  solid: 'solid',
  dot: 'dot',
  dash: 'dash',
  lgDash: 'longDash',
  dashDot: 'dashDot',
  lgDashDot: 'longDashDot',
  lgDashDotDot: 'longDashDotDot',
  sysDash: 'shortDash',
  sysDot: 'shortDot',
  sysDashDot: 'shortDashDot',
  sysDashDotDot: 'shortDashDotDot',
} as const satisfies Record<string, LineDash>;

type MissingDash = Exclude<
  LineDash,
  (typeof OOXML_DASH_TO_DOCX)[keyof typeof OOXML_DASH_TO_DOCX]
>;
const dashesComplete: [MissingDash] extends [never] ? true : never = true;
void dashesComplete;

/**
 * The `docx/shapes` name for an OOXML dash. Throws on an unknown one, which
 * docx itself would write as an empty `<a:prstDash/>` without a word.
 */
export function docxLineDash(dash: string): LineDash {
  const name = Object.hasOwn(OOXML_DASH_TO_DOCX, dash)
    ? OOXML_DASH_TO_DOCX[dash as keyof typeof OOXML_DASH_TO_DOCX]
    : undefined;
  if (!name) {
    throw new Error(
      `the docxjs renderer has no line dash for the OOXML value "${dash}"`
    );
  }
  return name;
}

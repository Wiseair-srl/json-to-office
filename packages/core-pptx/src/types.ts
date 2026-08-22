/**
 * PPTX Core Types
 */

import type {
  ServicesConfig,
  FontRegistryDefinition,
} from '@json-to-office/shared';
import type {
  GradientFill,
  PptxComponentDefaults,
} from '@json-to-office/shared-pptx';

export interface PptxComponentInput {
  name: string;
  id?: string;
  enabled?: boolean;
  props: Record<string, any>;
  children?: PptxComponentInput[];
}

export interface PresentationComponentDefinition {
  name: 'pptx';
  $schema?: string;
  id?: string;
  props: {
    title?: string;
    author?: string;
    subject?: string;
    company?: string;
    theme?: string;
    fontRegistry?: FontRegistryDefinition;
    slideWidth?: number;
    slideHeight?: number;
    rtlMode?: boolean;
    language?: string;
    pageNumberFormat?: '9' | '09';
    componentDefaults?: PptxComponentDefaults;
    grid?: GridConfig;
    templates?: TemplateSlideDefinition[];
  };
  children?: PptxComponentInput[];
}

export interface SlideComponentDefinition {
  name: 'slide';
  id?: string;
  props: {
    background?: {
      color?: string;
      gradient?: GradientFill;
      image?: { path?: string; base64?: string };
    };
    transition?: {
      type?: string;
      speed?: string;
    };
    notes?: string;
    layout?: string;
    hidden?: boolean;
    template?: string;
    placeholders?: Record<string, PptxComponentInput>;
  };
  children?: PptxComponentInput[];
}

export interface ProcessedPresentation {
  metadata: {
    title?: string;
    author?: string;
    subject?: string;
    company?: string;
  };
  theme: PptxThemeConfig;
  grid?: GridConfig;
  slideWidth: number;
  slideHeight: number;
  rtlMode: boolean;
  /** Default presentation language (BCP-47) for spell-checking */
  language?: string;
  pageNumberFormat: '9' | '09';
  slides: ProcessedSlide[];
  templates?: TemplateSlideDefinition[];
  services?: ServicesConfig;
}

export interface ProcessedSlide {
  components: PptxComponentInput[];
  background?: {
    color?: string;
    gradient?: GradientFill;
    image?: { path?: string; base64?: string };
  };
  /**
   * Slide transition, as authored.
   *
   * Carried through processing rather than dropped there: a backend without a
   * transition API has to be told the deck wants one so it can refuse, and a
   * backend with one has to be able to write it (#257).
   */
  transition?: { type?: string; speed?: string };
  notes?: string;
  layout?: string;
  hidden?: boolean;
  template?: string;
  placeholders?: Record<string, PptxComponentInput>;
}

export interface GridConfig {
  columns?: number;
  rows?: number;
  margin?:
    | number
    | { top: number; right: number; bottom: number; left: number };
  gutter?: number | { column: number; row: number };
}

export interface GridPosition {
  column: number;
  row: number;
  columnSpan?: number;
  rowSpan?: number;
}

export interface TextStyle {
  fontSize?: number;
  fontFace?: string;
  fontColor?: string;
  bold?: boolean;
  /**
   * Per-style weight (100–900). Overrides `bold` when set — renderer picks
   * the closest embedded variant via CSS font-matching and emits the run
   * under a synthetic family alias (e.g. "Inter Light" for weight 300).
   */
  fontWeight?: number;
  italic?: boolean;
  align?: string;
  lineSpacing?: number;
  charSpacing?: number;
  paraSpaceAfter?: number;
}

export type StyleName =
  | 'title'
  | 'subtitle'
  | 'heading1'
  | 'heading2'
  | 'heading3'
  | 'body'
  | 'caption';

export interface PptxThemeConfig {
  name: string;
  colors: {
    primary: string;
    secondary: string;
    accent: string;
    background: string;
    text: string;
    text2?: string;
    background2?: string;
    accent4?: string;
    accent5?: string;
    accent6?: string;
  };
  fonts: {
    heading: string;
    body: string;
  };
  fontRegistry?: FontRegistryDefinition;
  defaults: {
    fontSize: number;
    fontColor: string;
  };
  styles?: Partial<Record<StyleName, TextStyle>>;
  componentDefaults?: PptxComponentDefaults;
}

export interface PlaceholderDefinition {
  name: string;
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  grid?: GridPosition;
  defaults?: PptxComponentInput;
}

export interface TemplateSlideDefinition {
  name: string;
  background?: {
    color?: string;
    gradient?: GradientFill;
    image?: { path?: string; base64?: string };
  };
  margin?: number | [number, number, number, number];
  slideNumber?: {
    x: number;
    y: number;
    w?: number;
    h?: number;
    color?: string;
    fontSize?: number;
  };
  objects?: PptxComponentInput[];
  placeholders?: PlaceholderDefinition[];
  grid?: GridConfig;
}

export interface SlideContext {
  slideNumber: number;
  totalSlides: number;
  pageNumberFormat: '9' | '09';
  /** Default presentation language (BCP-47); text runs inherit it unless overridden */
  language?: string;
}

export interface SlideRenderContext {
  slideCtx?: SlideContext;
  services?: ServicesConfig;
  slideWidth: number;
  slideHeight: number;
  /**
   * Per-generation registry of fills (gradient/pattern) that pptxgenjs cannot
   * express. Components render a sentinel solid fill tagged with a unique
   * objectName; the PptxGenJS packaging pass swaps the sentinel for the real
   * fill XML after generation.
   */
  pendingFills?: PendingXmlFill[];
}

/**
 * A fill to be spliced into the slide XML during packaging. The component that
 * registered it rendered a sentinel `<a:solidFill>` on a shape whose
 * `cNvPr name` equals `objectName`.
 */
export interface PendingXmlFill {
  objectName: string;
  /** Complete replacement fill element (e.g. `<a:gradFill>…</a:gradFill>`). */
  xml: string;
}

export interface PipelineWarning {
  code: string; // WarningCode at call sites; string here to avoid circular import
  message: string;
  component?: string;
  slide?: number;
}

export function isPresentationComponent(
  component: unknown
): component is PresentationComponentDefinition {
  return (
    typeof component === 'object' &&
    component !== null &&
    (component as any).name === 'pptx'
  );
}

export function isSlideComponent(
  component: unknown
): component is SlideComponentDefinition {
  return (
    typeof component === 'object' &&
    component !== null &&
    (component as any).name === 'slide'
  );
}

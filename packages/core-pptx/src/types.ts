/**
 * PPTX Core Types
 */

import type { ServicesConfig } from '@json-to-office/shared';
import type { PptxComponentDefaults } from '@json-to-office/shared-pptx';

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
    slideWidth?: number;
    slideHeight?: number;
    rtlMode?: boolean;
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
  pageNumberFormat: '9' | '09';
  slides: ProcessedSlide[];
  templates?: TemplateSlideDefinition[];
  services?: ServicesConfig;
}

export interface ProcessedSlide {
  components: PptxComponentInput[];
  background?: {
    color?: string;
    image?: { path?: string; base64?: string };
  };
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
  background?: { color?: string; image?: { path?: string; base64?: string } };
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
}

export interface SlideRenderContext {
  slideCtx?: SlideContext;
  services?: ServicesConfig;
  slideWidth: number;
  slideHeight: number;
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

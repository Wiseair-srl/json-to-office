/**
 * PPTX Core Types
 */

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
  slideWidth: number;
  slideHeight: number;
  rtlMode: boolean;
  slides: ProcessedSlide[];
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
}

export interface GridConfig {
  columns?: number;
  rows?: number;
  margin?: number | { top: number; right: number; bottom: number; left: number };
  gutter?: number | { column: number; row: number };
}

export interface GridPosition {
  column: number;
  row: number;
  columnSpan?: number;
  rowSpan?: number;
}

export interface PptxThemeConfig {
  name: string;
  colors: {
    primary: string;
    secondary: string;
    accent: string;
    background: string;
    text: string;
  };
  fonts: {
    heading: string;
    body: string;
  };
  defaults: {
    fontSize: number;
    fontColor: string;
  };
  grid?: GridConfig;
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

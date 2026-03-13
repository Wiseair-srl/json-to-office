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
    masters?: MasterSlideDefinition[];
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
    master?: string;
    placeholders?: Record<string, PptxComponentInput[]>;
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
  masters?: MasterSlideDefinition[];
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
  master?: string;
  placeholders?: Record<string, PptxComponentInput[]>;
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

export interface TextStyle {
  fontSize?: number;
  fontFace?: string;
  fontColor?: string;
  bold?: boolean;
  italic?: boolean;
  align?: string;
  lineSpacing?: number;
  paraSpaceAfter?: number;
}

export type StyleName = 'title' | 'subtitle' | 'heading1' | 'heading2' | 'heading3' | 'body' | 'caption';

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
  grid?: GridConfig;
  styles?: Partial<Record<StyleName, TextStyle>>;
}

export interface PlaceholderDefinition {
  name: string;
  type: 'title' | 'body' | 'pic' | 'chart' | 'tbl' | 'media';
  x?: number; y?: number; w?: number; h?: number;
  grid?: GridPosition;
  fontSize?: number; fontFace?: string; color?: string;
  align?: string; valign?: string;
  margin?: number | number[];
  bold?: boolean; italic?: boolean;
  style?: StyleName;
  text?: string;
}

export type MasterImageObject = { image: { path?: string; data?: string; x?: number; y?: number; w?: number; h?: number; grid?: GridPosition } };
export type MasterTextObject = { text: { text: string; x?: number; y?: number; w?: number; h?: number; grid?: GridPosition; fontSize?: number; fontFace?: string; color?: string; bold?: boolean; italic?: boolean; align?: string } };
export type MasterRectObject = { rect: { x?: number; y?: number; w?: number; h?: number; grid?: GridPosition; fill?: string; line?: { color?: string; width?: number } } };
export type MasterLineObject = { line: { x?: number; y?: number; w?: number; h?: number; grid?: GridPosition; line?: { color?: string; width?: number } } };
export type MasterObject = MasterImageObject | MasterTextObject | MasterRectObject | MasterLineObject;

export interface MasterSlideDefinition {
  name: string;
  background?: { color?: string; image?: { path?: string; base64?: string } };
  margin?: number | [number, number, number, number];
  slideNumber?: { x: number; y: number; w?: number; h?: number; color?: string; fontSize?: number };
  objects?: MasterObject[];
  placeholders?: PlaceholderDefinition[];
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

import { ISectionOptions } from 'docx';
import type { ThemeName } from '../styles';

// Import types from shared that core needs for its internal use
import type {
  ComponentDefinition as SharedComponentDefinition,
  ReportComponent,
  SectionComponent,
  ColumnsComponent,
  HeadingComponent,
  ParagraphComponent,
  ImageComponent,
  HighchartsComponent,
  StatisticComponent,
  TableComponent,
  HeaderComponent,
  FooterComponent,
  ListComponent,
  TocComponent,
  TextBoxComponent,

  // Import props types needed internally
  ReportProps as SharedReportProps,
  SectionProps as SharedSectionProps,
  HeadingProps as SharedHeadingProps,
  ParagraphProps as SharedParagraphProps,
  ColumnsProps as SharedColumnsProps,
  ImageProps as SharedImageProps,
  StatisticProps as SharedStatisticProps,
  TableProps as SharedTableProps,
  HeaderProps as SharedHeaderProps,
  FooterProps as SharedFooterProps,
  ListProps as SharedListProps,
  TocProps as SharedTocProps,
  TextBoxProps as SharedTextBoxProps,
} from '@json-to-docx/shared';

// Import type guards from shared (these are runtime functions core needs)
export {
  isReportComponent,
  isSectionComponent,
  isHeadingComponent,
  isParagraphComponent,
  isColumnsComponent,
  isImageComponent,
  isTextBoxComponent,
  isStatisticComponent,
  isTableComponent,
  isListComponent,
  isTocComponent,
  isHeaderComponent,
  isFooterComponent,
  isHighchartsComponent,
} from '@json-to-docx/shared';

// Re-export component definitions for internal use (type aliases for clarity)
export type ComponentDefinition = SharedComponentDefinition;
export type ReportComponentDefinition = ReportComponent & {
  /** Optional schema field for JSON validation */
  $schema?: string;
};
export type SectionComponentDefinition = SectionComponent;
export type HeadingComponentDefinition = HeadingComponent;
export type ParagraphComponentDefinition = ParagraphComponent;
export type ColumnsComponentDefinition = ColumnsComponent;
export type ImageComponentDefinition = ImageComponent;
export type TextBoxComponentDefinition = TextBoxComponent;
export type StatisticComponentDefinition = StatisticComponent;
export type TableComponentDefinition = TableComponent;
export type HeaderComponentDefinition = HeaderComponent;
export type FooterComponentDefinition = FooterComponent;
export type ListComponentDefinition = ListComponent;
export type TocComponentDefinition = TocComponent;

// Export StandardComponentDefinition as union of all standard component types
export type StandardComponentDefinition =
  | ReportComponent
  | SectionComponent
  | ColumnsComponent
  | HeadingComponent
  | ParagraphComponent
  | TextBoxComponent
  | ImageComponent
  | HighchartsComponent
  | StatisticComponent
  | TableComponent
  | HeaderComponent
  | FooterComponent
  | ListComponent
  | TocComponent;

// Re-export props types for internal use
export type ReportProps = SharedReportProps;
export type SectionProps = SharedSectionProps;
export type HeadingProps = SharedHeadingProps;
export type ParagraphProps = SharedParagraphProps;
export type ColumnsProps = SharedColumnsProps;
export type ImageProps = SharedImageProps;
export type TextBoxProps = SharedTextBoxProps;
export type StatisticProps = SharedStatisticProps;
export type TableProps = SharedTableProps;
export type HeaderProps = SharedHeaderProps;
export type FooterProps = SharedFooterProps;
export type ListProps = SharedListProps;
export type TocProps = SharedTocProps;

// Re-export ThemeName for easier access
export type { ThemeName };

// ============================================================================
// CORE-SPECIFIC INTERFACES
// ============================================================================

export interface ColumnSettings {
  count: number;
  equalWidth?: boolean;
  space?: number;
  /** Optional explicit column children with widths/spaces in twips */
  children?: { width?: number; space?: number }[];
}

export interface PageSizeOptions {
  width: number;
  height: number;
}

export interface PageMarginOptions {
  top: number;
  right: number;
  bottom: number;
  left: number;
  header?: number;
  footer?: number;
}

export interface PageNumberOptions {
  start?: number;
  formatType?:
    | 'decimal'
    | 'upperRoman'
    | 'lowerRoman'
    | 'upperLetter'
    | 'lowerLetter';
}

export interface PageBorderOptions {
  top?: { style: string; size: number; color: string };
  right?: { style: string; size: number; color: string };
  bottom?: { style: string; size: number; color: string };
  left?: { style: string; size: number; color: string };
}

export interface SectionProperties {
  page?: {
    size?: PageSizeOptions;
    margin?: PageMarginOptions;
    pageNumbers?: PageNumberOptions;
    borders?: PageBorderOptions;
    textDirection?: 'ltr' | 'rtl';
  };
  column?: ColumnSettings;
  type?: 'continuous' | 'nextColumn' | 'nextPage' | 'evenPage' | 'oddPage';
  headers?: ISectionOptions['headers'];
  footers?: ISectionOptions['footers'];
}

// Internal interfaces used by DocumentGenerator helper methods
export interface ImageContent {
  path: string;
  caption?: string;
  width?: number;
  height?: number;
  alignment?: 'left' | 'center' | 'right';
}

export interface StatisticContent {
  number: string;
  description: string;
  alignment?: 'left' | 'center' | 'right';
}

export interface TableData {
  headers: string[];
  rows: (string | SharedComponentDefinition)[][];
  style?: 'minimal' | 'classic' | 'minimal';
}

/**
 * Rendering context for components
 */
export interface RenderContext {
  theme: {
    name: string;
    colors: Record<string, string>;
    fonts: Record<string, string>;
    spacing: Record<string, number>;
  };
  /** Full theme configuration for custom components */
  fullTheme: import('../styles').ThemeConfig;
  document: {
    title?: string;
    subtitle?: string;
    author?: string;
    company?: string;
    date: Date;
  };
  section: {
    currentLayout: 'single' | 'multi-column';
    columnCount: number;
    pageNumber: number;
    level?: number;
    /** Bookmark ID for section-scoped TOCs (when TOC is inside a section) */
    sectionBookmarkId?: string;
    /** Heading level of the parent section title (used to exclude it from section-scoped TOCs) */
    sectionTitleLevel?: number;
  };
  utils: {
    formatDate: (_date: Date) => string;
    parseText: (_text: string) => { text: string }[];
    getStyle: (_name: string) => { name: string };
    [key: string]: unknown;
  };
  parent?: SharedComponentDefinition;
  depth: number;
  custom?: Record<string, unknown>;
}

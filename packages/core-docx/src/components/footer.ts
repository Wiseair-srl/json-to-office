/**
 * Footer Component
 * Standard component for rendering footer elements in documents
 */

import { Paragraph, TextRun } from 'docx';
import {
  ComponentDefinition,
  FooterComponentDefinition,
  isFooterComponent,
} from '../types';
import { ThemeConfig, getBodyTextStyle } from '../styles';
import { getThemeColors } from '../themes/defaults';
import { getAlignment } from '../utils/alignmentUtils';

/**
 * Render footer component
 */
export function renderFooterComponent(
  component: ComponentDefinition,
  theme: ThemeConfig,
  themeName: string
): Paragraph[] {
  if (!isFooterComponent(component)) return [];

  const footerComp = component as FooterComponentDefinition;
  const bodyStyle = getBodyTextStyle(theme, themeName);

  // Simple footer implementation - just a text paragraph
  return [
    new Paragraph({
      children: [
        new TextRun({
          text: `[Footer: ${footerComp.props.alignment || 'center'}]`,
          font: bodyStyle.font,
          size: bodyStyle.size,
          color: getThemeColors(theme).secondary,
        }),
      ],
      alignment: getAlignment(footerComp.props.alignment || 'center'),
      style: 'Normal',
    }),
  ];
}

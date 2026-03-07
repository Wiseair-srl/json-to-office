/**
 * Header Component
 * Standard component for rendering header elements in documents
 */

import { Paragraph, TextRun } from 'docx';
import {
  ComponentDefinition,
  HeaderComponentDefinition,
  isHeaderComponent,
} from '../types';
import { ThemeConfig, getBodyTextStyle } from '../styles';
import { getThemeColors } from '../themes/defaults';
import { getAlignment } from '../utils/alignmentUtils';

/**
 * Render header component
 */
export function renderHeaderComponent(
  component: ComponentDefinition,
  theme: ThemeConfig,
  themeName: string
): Paragraph[] {
  if (!isHeaderComponent(component)) return [];

  const headerComp = component as HeaderComponentDefinition;
  const bodyStyle = getBodyTextStyle(theme, themeName);

  // Simple header implementation - just a text paragraph
  return [
    new Paragraph({
      children: [
        new TextRun({
          text: `[Header: ${headerComp.props.alignment || 'center'}]`,
          font: bodyStyle.font,
          size: bodyStyle.size,
          color: getThemeColors(theme).secondary,
        }),
      ],
      alignment: getAlignment(headerComp.props.alignment || 'center'),
      style: 'Normal',
    }),
  ];
}

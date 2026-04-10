/**
 * Image Component
 * Standard component for rendering images in documents
 */

import { Paragraph } from 'docx';
import { ComponentDefinition, isImageComponent } from '../types';
import { ThemeConfig } from '../styles';
import { createImage } from '../core/content';

/**
 * Render image component
 */
export async function renderImageComponent(
  component: ComponentDefinition,
  theme: ThemeConfig,
  themeName?: string
): Promise<Paragraph[]> {
  if (!isImageComponent(component)) return [];

  // Props are pre-resolved by resolveComponentTree
  const resolvedConfig = component.props;

  // Use base64 if provided, otherwise use path
  const imageSource = resolvedConfig.base64 || resolvedConfig.path;

  if (!imageSource) {
    throw new Error(
      'Image component requires either "path" or "base64" property'
    );
  }

  return await createImage(imageSource, theme, themeName, {
    caption: resolvedConfig.caption,
    width: resolvedConfig.width,
    height: resolvedConfig.height,
    widthRelativeTo: (resolvedConfig as any).widthRelativeTo,
    heightRelativeTo: (resolvedConfig as any).heightRelativeTo,
    alignment: resolvedConfig.alignment,
    spacing: resolvedConfig.spacing,
    floating: resolvedConfig.floating,
    keepNext: resolvedConfig.keepNext,
    keepLines: resolvedConfig.keepLines,
  });
}

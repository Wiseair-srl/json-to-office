/**
 * Image Component
 * Standard component for rendering images in documents
 */

import { Paragraph } from 'docx';
import { ComponentDefinition, isImageComponent } from '../types';
import { ThemeConfig } from '../styles';
import { resolveImageProps } from '../styles/utils/componentDefaults';
import { createImage } from '../core/content';

/**
 * Render image component
 */
export async function renderImageComponent(
  component: ComponentDefinition,
  theme: ThemeConfig
): Promise<Paragraph[]> {
  if (!isImageComponent(component)) return [];

  // Resolve configuration with theme defaults
  const resolvedConfig = resolveImageProps(component.props, theme);

  // Use base64 if provided, otherwise use path
  const imageSource = resolvedConfig.base64 || resolvedConfig.path;

  if (!imageSource) {
    throw new Error(
      'Image component requires either "path" or "base64" property'
    );
  }

  return await createImage(imageSource, theme, {
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

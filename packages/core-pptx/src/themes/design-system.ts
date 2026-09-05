import {
  designCanvas,
  resolveTypeRoles,
  validateDesignColors,
} from '@json-to-office/shared';
import type { PptxThemeConfig, GridConfig } from '../types';
import { resolveColor } from '../utils/color';

export function resolvePptxDesignSystem(
  theme: PptxThemeConfig,
  width = 10,
  height = 7.5
): PptxThemeConfig {
  validateDesignColors(theme, theme.colors);
  if (!theme.typography) return theme;
  const canvas = designCanvas('pptx', { width, height });
  const roles = resolveTypeRoles(theme, canvas, theme.defaults.fontSize);
  const styles = { ...theme.styles };
  for (const [name, role] of Object.entries(roles)) {
    const key = name as keyof typeof styles;
    styles[key] = {
      fontFace:
        theme.fonts[role.face ?? 'body'] ??
        (role.face === 'light' ? theme.fonts.heading : theme.fonts.body),
      fontSize: role.size,
      ...(role.weight !== undefined && { fontWeight: role.weight }),
      ...(role.color !== undefined && {
        fontColor: resolveColor(role.color, theme),
      }),
      ...(role.case !== undefined && { case: role.case }),
      ...(role.lineHeight !== undefined && {
        lineSpacing: role.lineHeight * role.size,
      }),
      ...(role.tracking !== undefined && {
        charSpacing: (role.tracking * role.size) / 100,
      }),
      ...(role.spaceBefore !== undefined && {
        paraSpaceBefore: role.spaceBefore,
      }),
      ...(role.spaceAfter !== undefined && { paraSpaceAfter: role.spaceAfter }),
      ...styles[key],
    };
  }
  return { ...theme, styles };
}

export function designGrid(
  theme: PptxThemeConfig,
  width: number,
  height: number
): GridConfig | undefined {
  const space =
    theme.spacing?.canvas?.[designCanvas('pptx', { width, height })];
  if (!space) return undefined;
  return {
    ...(space.safeAreaIn !== undefined && { margin: space.safeAreaIn }),
    ...(space.gutterIn !== undefined && { gutter: space.gutterIn }),
    ...(space.columns !== undefined && { columns: space.columns }),
    ...(space.rows !== undefined && { rows: space.rows }),
  };
}

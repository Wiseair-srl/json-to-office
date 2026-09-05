import {
  designCanvas,
  resolveTypeRoles,
  validateDesignColors,
} from '@json-to-office/shared';
import { getThemeColors } from './defaults';
import type { ThemeConfig } from '../styles';

/** Materialize visual tokens before either pipeline reads style/layout defaults. */
export function resolveDocxDesignSystem(theme: ThemeConfig): ThemeConfig {
  validateDesignColors(theme, getThemeColors(theme));
  if (!theme.typography && !theme.spacing) return theme;
  const canvas = designCanvas('docx', theme.page.size);
  const roles = resolveTypeRoles(theme, canvas, theme.fonts.body.size ?? 11);
  const styles: Record<string, object> = { ...theme.styles };
  for (const [name, role] of Object.entries(roles)) {
    const spacing = {
      ...(role.spaceBefore !== undefined && { before: role.spaceBefore }),
      ...(role.spaceAfter !== undefined && { after: role.spaceAfter }),
    };
    styles[name] = {
      font: role.face ?? 'body',
      size: role.size,
      ...(role.weight !== undefined && { fontWeight: role.weight }),
      ...(role.color !== undefined && { color: role.color }),
      ...(role.case !== undefined && { case: role.case }),
      ...(role.lineHeight !== undefined && {
        lineSpacing: { type: 'multiple', value: role.lineHeight },
      }),
      ...(role.tracking !== undefined && {
        characterSpacing: {
          type: role.tracking < 0 ? 'condensed' : 'expanded',
          value: (Math.abs(role.tracking) * role.size) / 5,
        },
      }),
      ...(Object.keys(spacing).length && { spacing }),
      ...styles[name],
    };
  }
  const gap = theme.spacing?.blockGap?.normal ?? theme.spacing?.basePt;
  const scale = theme.typography?.scale?.[canvas];
  if (scale || gap !== undefined) {
    styles.normal = {
      ...(scale && { size: scale.base }),
      ...(gap !== undefined && { spacing: { after: gap } }),
      ...styles.normal,
    };
  }
  const space = theme.spacing?.canvas?.[canvas];
  const safe = space?.safeAreaIn;
  return {
    ...theme,
    styles,
    page: {
      ...theme.page,
      margins: {
        ...theme.page.margins,
        ...(safe !== undefined && {
          top: safe * 1440,
          bottom: safe * 1440,
          left: safe * 1440,
          right: safe * 1440,
        }),
        ...(space?.gutterIn !== undefined && { gutter: space.gutterIn * 1440 }),
      },
    },
  };
}

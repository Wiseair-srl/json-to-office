/**
 * The `section-opener` block, lowered to primitives.
 *
 * The number as an eyebrow in the theme's `eyebrow` role, then the title as
 * a level-1 heading — a real heading, so the table of contents, heading
 * numbering and cross-references all see the section the way Word does. The
 * tracker is not drawn in the flow at all: it is what the running head in
 * force reads for the enclosing section, resolved by {@link sectionTracker}.
 */

import type { SectionOpenerProps } from '@json-to-office/shared-docx';
import type { ThemeConfig } from '../styles';
import type { ComponentDefinition } from '../types';
import { FALLBACK_EYEBROW_FONT, roleProps } from './recipe';
import type { BlockCompilation } from './types';

export function compileSectionOpener(
  props: SectionOpenerProps,
  theme: ThemeConfig
): BlockCompilation {
  const children: ComponentDefinition[] = [];
  const sourceMap: Record<string, string> = {};
  const pageBreak = props.pageBreak === true;

  if (props.number !== undefined) {
    children.push({
      name: 'paragraph',
      props: {
        text: String(props.number),
        keepNext: true,
        spacing: { after: 2 },
        ...(pageBreak && { pageBreak: true }),
        ...roleProps(theme, 'eyebrow', FALLBACK_EYEBROW_FONT),
      },
    });
    sourceMap['/children/0'] = '';
    sourceMap['/children/0/props/text'] = '/props/number';
  }

  const index = children.length;
  children.push({
    name: 'heading',
    props: {
      text: props.title,
      level: 1,
      ...(pageBreak && index === 0 && { pageBreak: true }),
    },
  });
  sourceMap[`/children/${index}`] = '';
  sourceMap[`/children/${index}/props/text`] = '/props/title';

  return { children, sourceMap };
}

/**
 * The tracker a section shows in its running head: the first enabled
 * `section-opener` among its direct children, its `tracker` or, failing that,
 * its `title`. Returns the authored pointer of the slot the text came from,
 * relative to the section, so chrome findings can point at it.
 */
export function sectionTracker(section: {
  children?: unknown;
}): { text: string; slot: string } | undefined {
  if (!Array.isArray(section.children)) return undefined;
  for (const [index, child] of section.children.entries()) {
    if (
      typeof child !== 'object' ||
      child === null ||
      (child as { name?: unknown }).name !== 'section-opener' ||
      (child as { enabled?: unknown }).enabled === false
    ) {
      continue;
    }
    const props = (child as { props?: Partial<SectionOpenerProps> }).props;
    if (!props) continue;
    if (typeof props.tracker === 'string' && props.tracker !== '') {
      return { text: props.tracker, slot: `/children/${index}/props/tracker` };
    }
    if (typeof props.title === 'string' && props.title !== '') {
      return { text: props.title, slot: `/children/${index}/props/title` };
    }
  }
  return undefined;
}

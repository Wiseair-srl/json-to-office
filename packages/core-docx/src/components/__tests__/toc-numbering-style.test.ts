/**
 * Regression: `toc.numberingStyle` has no counterpart in Word's TOC field
 * (docx's ITableOfContentsOptions exposes every TOC switch and none of them
 * control numbering). The prop stays in the schema for back-compat, so the
 * renderer must say out loud that it is doing nothing instead of dropping it.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderTocComponent } from '../toc';
import { createMockTheme } from './helpers';
import type { TocComponentDefinition } from '../../types';
import { TableOfContents } from 'docx';

describe('TOC numberingStyle', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('warns that numberingStyle is ignored when it is set', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const component: TocComponentDefinition = {
      name: 'toc',
      props: { numberingStyle: 'bullet' },
    };

    const result = renderTocComponent(component, createMockTheme());

    expect(warn).toHaveBeenCalledTimes(1);
    const message = warn.mock.calls[0][0] as string;
    expect(message).toContain('numberingStyle');
    expect(message).toContain('bullet');
    expect(message).toMatch(/ignored/i);

    // The TOC itself still renders normally
    expect(result).toHaveLength(1);
    expect(result[0]).toBeInstanceOf(TableOfContents);
  });

  it('warns for every numberingStyle value, including "none"', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    for (const numberingStyle of ['numeric', 'bullet', 'none'] as const) {
      renderTocComponent(
        { name: 'toc', props: { numberingStyle } },
        createMockTheme()
      );
    }

    expect(warn).toHaveBeenCalledTimes(3);
  });

  it('stays silent when numberingStyle is not set', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const component: TocComponentDefinition = {
      name: 'toc',
      props: { title: 'Contents', depth: { to: 2 } },
    };

    const result = renderTocComponent(component, createMockTheme());

    expect(warn).not.toHaveBeenCalled();
    expect(result).toHaveLength(2);
  });
});

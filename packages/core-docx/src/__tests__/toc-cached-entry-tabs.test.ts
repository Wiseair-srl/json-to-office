/**
 * Cached TOC entries take their tab stop from the theme's TOCn style.
 *
 * A reader that shows the cached entries without refreshing the field
 * (LibreOffice, and therefore our PDF path) lays them out with whatever tabs
 * the entry paragraphs carry. Paragraph tabs beat style tabs, so an entry that
 * pins its own dot-leader stop contradicts a theme whose TOC styles ask for no
 * leader — Word hides it by refreshing, nothing else does. Both renderers.
 */
import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import { generateBufferFromJson } from '../core/generator';

const RENDERERS = ['docxjs', 'office-open'] as const;

async function parts(
  renderer: (typeof RENDERERS)[number]
): Promise<{ document: string; styles: string }> {
  const buf = await generateBufferFromJson({
    name: 'docx',
    props: { theme: 'consulting' },
    renderer,
    children: [
      { name: 'toc', props: { title: 'Contents', depth: { from: 1, to: 3 } } },
      { name: 'heading', props: { text: 'Getting Started', level: 1 } },
      { name: 'heading', props: { text: 'Prerequisites', level: 2 } },
      { name: 'heading', props: { text: 'Install', level: 3 } },
    ],
  } as never);
  const zip = await JSZip.loadAsync(buf);
  return {
    document: await zip.file('word/document.xml')!.async('string'),
    styles: await zip.file('word/styles.xml')!.async('string'),
  };
}

/** Each cached entry paragraph in the TOC's structured document tag. */
function entryParagraphs(document: string): string[] {
  const sdt = document.match(/<w:sdt>[\s\S]*?<\/w:sdt>/)?.[0] ?? '';
  return (sdt.match(/<w:p[ >][\s\S]*?<\/w:p>/g) ?? []).filter((p) =>
    /<w:pStyle w:val="TOC\d"\/>/.test(p)
  );
}

/** One style's definition in styles.xml. */
function style(styles: string, id: string): string {
  return (
    styles.match(
      new RegExp(`<w:style [^>]*w:styleId="${id}"[^>]*>[\\s\\S]*?</w:style>`)
    )?.[0] ?? ''
  );
}

describe.each(RENDERERS)('cached TOC entry tabs (%s)', (renderer) => {
  it('writes the entries with no paragraph-level tab stops', async () => {
    const { document } = await parts(renderer);
    const entries = entryParagraphs(document);

    expect(entries).toHaveLength(3);
    for (const entry of entries) {
      expect(entry).toContain('<w:tab/>');
      expect(entry).not.toContain('<w:tabs>');
      expect(entry).not.toContain('w:leader="dot"');
    }
  });

  it('leaves the tab stop to the theme TOC styles', async () => {
    const { styles } = await parts(renderer);

    for (const id of ['TOC1', 'TOC2', 'TOC3']) {
      expect(style(styles, id)).toMatch(
        /<w:tabs><w:tab w:val="right" w:pos="9026"( w:leader="none")?\/><\/w:tabs>/
      );
    }
  });
});

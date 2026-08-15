import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { processPresentation } from '../structure';
import { generateBufferFromJson } from '../generator';
import type { PresentationComponentDefinition } from '../../types';

function threeSlideDeck(): PresentationComponentDefinition {
  return {
    name: 'pptx',
    props: { title: 'Slide enabled contract' },
    children: [
      {
        name: 'slide',
        props: { notes: 'first' },
        children: [{ name: 'text', props: { text: 'First' } }],
      },
      {
        name: 'slide',
        props: { notes: 'second' },
        children: [{ name: 'text', props: { text: 'Second' } }],
      },
      {
        name: 'slide',
        props: { notes: 'third' },
        children: [{ name: 'text', props: { text: 'Third' } }],
      },
    ],
  };
}

function disableMiddle(deck: PresentationComponentDefinition) {
  (deck.children![1] as { enabled?: boolean }).enabled = false;
  return deck;
}

describe('slide enabled flag', () => {
  it('drops a slide marked enabled: false and keeps the rest in order', () => {
    const processed = processPresentation(disableMiddle(threeSlideDeck()));

    expect(processed.slides).toHaveLength(2);
    expect(processed.slides.map((s) => s.notes)).toEqual(['first', 'third']);
  });

  it('keeps slides without an enabled prop and with enabled: true', () => {
    const deck = threeSlideDeck();
    (deck.children![1] as { enabled?: boolean }).enabled = true;

    const processed = processPresentation(deck);

    expect(processed.slides.map((s) => s.notes)).toEqual([
      'first',
      'second',
      'third',
    ]);
  });

  it('renumbers the surviving slides so page numbers stay contiguous', async () => {
    const deck = disableMiddle(threeSlideDeck());
    deck.children!.forEach((slide) => {
      slide.children = [
        { name: 'text', props: { text: '{PAGE_NUMBER}/{PAGE_COUNT}' } },
      ];
    });

    const zip = await JSZip.loadAsync(await generateBufferFromJson(deck));
    const slideFiles = Object.keys(zip.files).filter((p) =>
      /^ppt\/slides\/slide\d+\.xml$/.test(p)
    );

    expect(slideFiles).toHaveLength(2);
    expect(await zip.file('ppt/slides/slide1.xml')!.async('string')).toContain(
      '1/2'
    );
    expect(await zip.file('ppt/slides/slide2.xml')!.async('string')).toContain(
      '2/2'
    );
  });

  it('accepts enabled through the validation gate and still drops the slide', async () => {
    // generateBufferFromJson runs the schema validation gate, so reaching a
    // buffer at all proves `enabled` is an accepted slide field; the emitted
    // slides prove the flag is honoured on the full pipeline, not just in
    // processPresentation.
    const zip = await JSZip.loadAsync(
      await generateBufferFromJson(disableMiddle(threeSlideDeck()))
    );
    const slideFiles = Object.keys(zip.files).filter((p) =>
      /^ppt\/slides\/slide\d+\.xml$/.test(p)
    );

    expect(slideFiles).toHaveLength(2);

    const first = await zip.file('ppt/slides/slide1.xml')!.async('string');
    const second = await zip.file('ppt/slides/slide2.xml')!.async('string');

    expect(first).toContain('<a:t>First</a:t>');
    expect(second).toContain('<a:t>Third</a:t>');
    expect(first + second).not.toContain('Second');
  });
});

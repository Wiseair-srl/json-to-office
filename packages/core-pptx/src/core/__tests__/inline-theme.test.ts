import { describe, it, expect } from 'vitest';
import { processPresentation } from '../structure';
import { generateBufferWithWarnings } from '../generator';
import type { PresentationComponentDefinition } from '../../types';

const inlineTheme = {
  name: 'editorial',
  colors: {
    primary: '#1A1A1A',
    secondary: '#444444',
    accent: '#CC785C',
    background: '#FFFFFF',
    text: '#1A1A1A',
    text2: '#888888',
  },
  fonts: { heading: 'Arial', body: 'Arial' },
  defaults: { fontSize: 18, fontColor: '#1A1A1A' },
};

const doc = (theme: unknown): PresentationComponentDefinition =>
  ({
    name: 'pptx',
    props: { title: 'Inline theme test', theme },
    children: [
      {
        name: 'slide',
        props: {},
        children: [{ name: 'text', props: { text: 'Hello', color: 'accent' } }],
      },
    ],
  }) as unknown as PresentationComponentDefinition;

describe('inline document theme', () => {
  it('processPresentation resolves an inline theme object directly', () => {
    const processed = processPresentation(doc(inlineTheme));

    expect(processed.theme.colors.accent).toBe('#CC785C');
    expect(processed.theme.name).toBe('editorial');
  });

  it('processPresentation still resolves theme names', () => {
    const processed = processPresentation(doc('minimal'));

    expect(processed.theme.name).toBe('minimal');
  });

  it('generateBufferWithWarnings renders a document with an inline theme', async () => {
    const { buffer, warnings } = await generateBufferWithWarnings(
      doc(inlineTheme)
    );

    expect(buffer.length).toBeGreaterThan(0);
    expect(warnings.filter((w) => String(w.code).includes('THEME'))).toEqual(
      []
    );
  });
});

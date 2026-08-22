import { describe, expect, it } from 'vitest';
import {
  generateBufferFromJson,
  generateBufferWithWarnings,
  PresentationValidationError,
} from '../generator';
import type { PresentationComponentDefinition } from '../../types';

function validDeck(): PresentationComponentDefinition {
  return {
    name: 'pptx',
    props: { title: 'Validation contract' },
    children: [
      {
        name: 'slide',
        props: {},
        children: [
          {
            name: 'text',
            props: { text: 'Hello', x: 1, y: 1, w: 4, h: 1 },
          },
        ],
      },
    ],
  };
}

describe('PPTX generation validation', () => {
  it('generates valid object and JSON-string inputs', async () => {
    const objectBuffer = await generateBufferFromJson(validDeck());
    const stringBuffer = await generateBufferFromJson(
      JSON.stringify(validDeck())
    );

    expect(objectBuffer.length).toBeGreaterThan(0);
    expect(stringBuffer.length).toBeGreaterThan(0);
  });

  it('rejects the dead text fontColor prop on buffer generation', async () => {
    const deck = validDeck();
    (deck.children![0].children![0].props as any).fontColor = 'CC785C';

    await expect(generateBufferFromJson(deck)).rejects.toBeInstanceOf(
      PresentationValidationError
    );

    try {
      await generateBufferFromJson(deck);
    } catch (error) {
      expect(error).toBeInstanceOf(PresentationValidationError);
      expect(
        (error as PresentationValidationError).errors.some(
          (entry) =>
            entry.path.includes('/children/0/children/0/props') &&
            entry.message.includes('fontColor')
        )
      ).toBe(true);
    }
  });

  it('applies the same gate to the warning-collecting buffer API', async () => {
    const deck = validDeck();
    (deck.children![0].children![0].props as any).fontColor = 'CC785C';

    await expect(generateBufferWithWarnings(deck)).rejects.toBeInstanceOf(
      PresentationValidationError
    );
  });

  it('rejects illegal tree placement before rendering', async () => {
    const deck = validDeck();
    deck.children = [{ name: 'text', props: { text: 'No slide' } }];

    await expect(generateBufferFromJson(deck)).rejects.toThrow(
      /not allowed inside "pptx"/
    );
  });

  it('supports the migration escape hatch for unknown props', async () => {
    const deck = validDeck();
    (deck.children![0].children![0].props as any).fontColor = 'CC785C';

    const buffer = await generateBufferFromJson(deck, {
      validation: { allowUnknownFields: true },
    });

    expect(buffer.length).toBeGreaterThan(0);
  });

  it('supports explicitly disabling validation', async () => {
    const deck = validDeck();
    (deck.children![0].children![0].props as any).fontColor = 'CC785C';

    const buffer = await generateBufferFromJson(deck, {
      validation: { enabled: false },
    });

    expect(buffer.length).toBeGreaterThan(0);
  });
});

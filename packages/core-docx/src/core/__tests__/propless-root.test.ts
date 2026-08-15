import { describe, expect, it } from 'vitest';
import type { ReportComponentDefinition } from '../../types';
import { generateBufferFromJson } from '../generator';
import { createDocumentGenerator } from '../../plugin/createDocumentGenerator';

const children = [
  { name: 'heading', props: { level: 1, text: 'Propless root' } },
  { name: 'paragraph', props: { text: 'No props key on the docx node.' } },
] as ReportComponentDefinition['children'];

// A root written without `props` validates clean, so generation must treat it
// as `props: {}` rather than throwing on `document.props.theme`.
describe('propless docx root', () => {
  it('generates and matches the same document written with props: {}', async () => {
    const propless = { name: 'docx', children } as ReportComponentDefinition;
    const empty: ReportComponentDefinition = {
      name: 'docx',
      props: {},
      children,
    };

    const withoutProps = await generateBufferFromJson(propless);
    const withEmptyProps = await generateBufferFromJson(empty);

    expect(withoutProps.length).toBeGreaterThan(0);
    expect(withoutProps.equals(withEmptyProps)).toBe(true);
  });

  it('generates through the plugin generator without a theme option', async () => {
    const generator = createDocumentGenerator({});

    const result = await generator.generate({
      name: 'docx',
      children,
    } as ReportComponentDefinition);

    expect(result.document).toBeDefined();
    expect(result.standardDefinition.children!.length).toBe(2);
  });

  // Only an absent/undefined `props` is defaulted. A malformed explicit value
  // must not be rewritten into a valid shape.
  describe('malformed explicit props', () => {
    // Control: these pass under the old truthiness check too, because
    // validation rejects a non-object `props` before normalization runs.
    // Kept to pin that the validator is the first line of defence.
    for (const bad of [null, false, '', 0]) {
      it(`is rejected by validation — props: ${JSON.stringify(bad)}`, async () => {
        await expect(
          generateBufferFromJson({
            name: 'docx',
            props: bad,
            children,
          } as unknown as ReportComponentDefinition)
        ).rejects.toThrow();
      });
    }

    // The discriminating case. With validation off nothing else catches a
    // malformed root, so defaulting on truthiness silently turned `props:
    // null` into `{}` and produced a document byte-identical to the propless
    // one. It must fail instead.
    it('is not rewritten into {} when validation is disabled', async () => {
      const opts = { validation: { enabled: false } } as never;

      await expect(
        generateBufferFromJson(
          {
            name: 'docx',
            props: null,
            children,
          } as unknown as ReportComponentDefinition,
          opts
        )
      ).rejects.toThrow();

      // …while a genuinely propless root still builds on the same path.
      const propless = await generateBufferFromJson(
        { name: 'docx', children } as ReportComponentDefinition,
        opts
      );
      expect(propless.length).toBeGreaterThan(0);
    });
  });
});

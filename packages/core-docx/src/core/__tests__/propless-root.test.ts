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
});

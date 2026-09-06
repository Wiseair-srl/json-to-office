import { describe, it, expect } from 'vitest';
import { validateBlueprint, isBlueprint } from './schema';

const blueprint = {
  id: 'memo',
  format: 'docx',
  title: 'Memo',
  description: 'A one-page memo.',
  whenToUse: 'A decision that needs one page.',
  theme: 'consulting',
  profile: 'executive-report',
  definitions: 'client-report-blocks.docx.json',
  numbering: 'none',
  toc: false,
  variants: {
    plain: {
      description: 'Heading and body.',
      whenToUse: 'Always.',
      pages: { min: 1, max: 2 },
      children: [{ name: 'section', children: [] }],
    },
  },
};

describe('blueprint schema', () => {
  it('accepts a whole-document plan with at least one variant', () => {
    expect(validateBlueprint(blueprint)).toEqual([]);
    expect(isBlueprint(blueprint)).toBe(true);
  });
  it('rejects an empty variant, an unknown key and a bad id', () => {
    const issues = validateBlueprint({
      ...blueprint,
      id: 'Memo!',
      extra: true,
      variants: { plain: { ...blueprint.variants.plain, children: [] } },
    });
    expect(issues.map((issue) => issue.path)).toEqual(
      expect.arrayContaining(['/id', '/variants/plain/children'])
    );
    expect(issues.map((issue) => issue.path)).toContain('/extra');
  });
});

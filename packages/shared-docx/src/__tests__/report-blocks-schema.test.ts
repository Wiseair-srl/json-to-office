/**
 * The report-architecture blocks' slot bounds, as a validator reports them.
 *
 * `cover`, `section-opener` and `running-head` carry one-line text slots. A
 * line break inside any of them would break the recipe that draws it — a
 * running head is one line by definition — so the shape is a schema bound and
 * an agent gets a path-addressed error at the slot, not a rendered page with
 * a two-line tracker.
 */
import { describe, expect, it } from 'vitest';
import { validateStrict } from '../validation/unified';
import { COVER_BUDGET } from '../schemas/components/cover';
import { SECTION_OPENER_BUDGET } from '../schemas/components/section-opener';
import { RUNNING_HEAD_BUDGET } from '../schemas/components/running-head';

const inSection = (...components: unknown[]) => ({
  name: 'docx',
  props: {},
  children: [{ name: 'section', children: components }],
});

const paths = (document: unknown) =>
  validateStrict.document(document).errors.map((error) => error.path);

describe('cover schema', () => {
  it('needs a title and accepts every other slot', () => {
    expect(
      validateStrict.document(
        inSection({ name: 'cover', props: { title: 'Annual review' } })
      ).valid
    ).toBe(true);
    expect(
      validateStrict.document(
        inSection({
          name: 'cover',
          props: {
            title: 'Annual review',
            subtitle: 'What changed and what to do next',
            client: 'Acme',
            date: 'September 2026',
            confidentiality: 'Confidential',
            logo: { svg: '<svg xmlns="http://www.w3.org/2000/svg"/>' },
          },
        })
      ).valid
    ).toBe(true);
    expect(COVER_BUDGET).toEqual({
      title: { maxWords: 12 },
      subtitle: { maxWords: 30 },
    });
  });

  it('reports a missing, empty or multi-line title at the slot', () => {
    expect(
      paths(inSection({ name: 'cover', props: {} })).some((path) =>
        path.startsWith('/children/0/children/0/props')
      )
    ).toBe(true);
    expect(paths(inSection({ name: 'cover', props: { title: '' } }))).toContain(
      '/children/0/children/0/props/title'
    );
    expect(
      paths(inSection({ name: 'cover', props: { title: 'one\ntwo' } }))
    ).toContain('/children/0/children/0/props/title');
  });

  it('rejects unknown props, a logo with no source, and authored children', () => {
    expect(
      validateStrict.document(
        inSection({ name: 'cover', props: { title: 'x', fill: '#FFF' } })
      ).valid
    ).toBe(false);
    expect(
      paths(inSection({ name: 'cover', props: { title: 'x', logo: {} } }))
    ).toContain('/children/0/children/0/props/logo');
    expect(
      validateStrict.document(
        inSection({
          name: 'cover',
          props: { title: 'x' },
          children: [{ name: 'paragraph', props: { text: 'y' } }],
        })
      ).valid
    ).toBe(false);
  });
});

describe('section-opener schema', () => {
  it('needs a title; number, tracker and pageBreak are optional', () => {
    expect(
      validateStrict.document(
        inSection({ name: 'section-opener', props: { title: 'Results' } })
      ).valid
    ).toBe(true);
    expect(
      validateStrict.document(
        inSection({
          name: 'section-opener',
          props: {
            number: '02',
            title: 'Results',
            tracker: 'Results',
            pageBreak: true,
          },
        })
      ).valid
    ).toBe(true);
    expect(
      validateStrict.document(
        inSection({ name: 'section-opener', props: { number: 2, title: 'R' } })
      ).valid
    ).toBe(true);
    expect(SECTION_OPENER_BUDGET).toEqual({
      title: { maxWords: 12 },
      tracker: { maxWords: 6 },
    });
  });

  it('reports a multi-line title or tracker at the slot', () => {
    expect(
      paths(inSection({ name: 'section-opener', props: { title: 'a\nb' } }))
    ).toContain('/children/0/children/0/props/title');
    expect(
      paths(
        inSection({
          name: 'section-opener',
          props: { title: 'a', tracker: 'b\rc' },
        })
      )
    ).toContain('/children/0/children/0/props/tracker');
  });
});

describe('running-head schema', () => {
  it('accepts no props at all, and every slot', () => {
    expect(
      validateStrict.document(inSection({ name: 'running-head' })).valid
    ).toBe(true);
    expect(
      validateStrict.document(
        inSection({
          name: 'running-head',
          props: {
            title: 'Annual review',
            tracker: 'Summary',
            confidentiality: 'Confidential',
            date: 'September 2026',
            pageNumbers: false,
          },
        })
      ).valid
    ).toBe(true);
    expect(RUNNING_HEAD_BUDGET).toEqual({
      title: { maxWords: 12 },
      tracker: { maxWords: 6 },
      confidentiality: { maxWords: 6 },
      date: { maxWords: 6 },
    });
  });

  it('reports a multi-line slot at the slot and rejects unknown props', () => {
    expect(
      paths(inSection({ name: 'running-head', props: { title: 'a\nb' } }))
    ).toContain('/children/0/children/0/props/title');
    expect(
      validateStrict.document(
        inSection({ name: 'running-head', props: { tab: 9026 } })
      ).valid
    ).toBe(false);
  });
});

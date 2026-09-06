/**
 * What the `client-report` profile asks of a report, and what the theme never
 * does: a takeaway and a source wherever a block declares the slot, and a
 * running head with page numbers on every section after the cover. The same
 * document on `technical-report` owes none of it, and a document may name the
 * profile it wants judged by.
 */
import { describe, expect, it } from 'vitest';
import { QUALITY_CODES } from '@json-to-office/quality';
import { analyzeDocxQuality } from './preflight';
import { block, example, para, section } from '../blocks/__tests__/example';
import { invocation } from '../blocks/__tests__/example';

const profile = (id: string) => ({ id, formats: ['docx'] });
const chromeFindings = (doc: unknown, options = {}) =>
  analyzeDocxQuality(doc, options).diagnostics.filter(
    (finding) => finding.code === QUALITY_CODES.CHROME_MISSING
  );

/** A cover, then two body sections; `chrome` decides what the first carries. */
const report = (chrome: unknown[], theme = 'consulting') => {
  const doc = example();
  doc.props.theme = theme;
  doc.children = [
    section(block('cover', { title: 'Cover' })),
    section(
      ...chrome,
      block('section-opener', { number: '01', title: 'One' }),
      para('Body.')
    ),
    section(
      block('section-opener', { number: '02', title: 'Two' }),
      para('Body.')
    ),
  ];
  return doc;
};
const runningHead = (slots = {}) => block('running-head', slots);

describe('required chrome under the client-report profile', () => {
  it('asks for the takeaway and the source a block declares, at the slot, and for nothing on the default profile', () => {
    const doc = example();
    const chart = invocation('chart-figure');
    delete chart.props.slots.takeaway;
    const kpi = invocation('kpi-row');
    delete kpi.props.slots.source;
    doc.children = [section(runningHead(), chart, kpi)];
    expect(chromeFindings(doc, { profile: profile('client-report') })).toEqual([
      expect.objectContaining({
        path: '/children/0/children/1/props/slots/takeaway',
        relatedPaths: ['/children/0/children/1'],
      }),
      expect.objectContaining({
        path: '/children/0/children/2/props/slots/source',
      }),
    ]);
    expect(
      chromeFindings(doc, { profile: profile('technical-report') })
    ).toEqual([]);
  });

  it('asks for a running head with page numbers on every section after the cover', () => {
    expect(
      chromeFindings(report([]), { profile: profile('client-report') })
    ).toEqual([
      expect.objectContaining({
        path: '/children/1',
        context: expect.objectContaining({
          missing: ['header', 'footer', 'pageNumber'],
        }),
      }),
      expect.objectContaining({ path: '/children/2' }),
    ]);
    expect(
      chromeFindings(report([runningHead({ pageNumbers: false })]), {
        profile: profile('client-report'),
      })
    ).toEqual([
      expect.objectContaining({
        path: '/children/1',
        context: expect.objectContaining({ missing: ['pageNumber'] }),
      }),
      expect.objectContaining({ path: '/children/2' }),
    ]);
    expect(
      chromeFindings(report([runningHead()]), {
        profile: profile('client-report'),
      })
    ).toEqual([]);
    expect(
      chromeFindings(report([]), { profile: profile('technical-report') })
    ).toEqual([]);
  });

  it('reads a linked part from the section it links to', () => {
    const doc = report([runningHead()]);
    doc.children[2].props = {
      header: 'linkToPrevious',
      footer: 'linkToPrevious',
    };
    expect(chromeFindings(doc, { profile: profile('client-report') })).toEqual(
      []
    );
    doc.children[2].props = { header: 'linkToPrevious', footer: [] };
    expect(chromeFindings(doc, { profile: profile('client-report') })).toEqual([
      expect.objectContaining({
        path: '/children/2',
        context: expect.objectContaining({ missing: ['footer', 'pageNumber'] }),
      }),
    ]);
  });

  it.each(['consulting', 'minimal', 'vermilion', 'devportal'])(
    'judges the same requirements on the %s theme',
    (theme) => {
      expect(
        chromeFindings(report([], theme), { profile: profile('client-report') })
      ).toHaveLength(2);
      expect(
        chromeFindings(report([runningHead()], theme), {
          profile: profile('client-report'),
        })
      ).toEqual([]);
    }
  );
});

describe('the profile a document names', () => {
  it('is used when the caller names none, loses to one the caller names, and falls back when unknown', () => {
    const doc = report([]);
    doc.props.qualityProfile = 'client-report';
    const declared = analyzeDocxQuality(doc);
    expect(declared.profileId).toBe('client-report');
    expect(
      declared.diagnostics.filter(
        (finding) => finding.code === QUALITY_CODES.CHROME_MISSING
      )
    ).toHaveLength(2);
    const named = analyzeDocxQuality(doc, {
      profile: profile('technical-report'),
    });
    expect(named.profileId).toBe('technical-report');
    expect(
      chromeFindings(doc, { profile: profile('technical-report') })
    ).toEqual([]);
    doc.props.qualityProfile = 'no-such-profile';
    expect(analyzeDocxQuality(doc).profileId).toBe('technical-report');
  });
});

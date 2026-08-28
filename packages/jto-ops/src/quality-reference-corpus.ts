import { DOCX_QUALITY_PROFILES } from '@json-to-office/core-docx';
import { PPTX_QUALITY_PROFILES } from '@json-to-office/core-pptx';
import type {
  DiagnosticSeverity,
  QualityCategory,
  QualityCertainty,
  QualityProfile,
} from '@json-to-office/quality';
import type { FormatName } from './format-adapter';

export type QualityReferenceTier = 'poor' | 'professional' | 'excellent';

/**
 * Stock templates that count as reference-quality documents — the calibration
 * bar for the quality rules. The remaining playground templates (`Alternative
 * deck 16_9`, `Brand template 16_9`, `Company deck 16_9`, `Company deck 4_3`)
 * are starting points, not quality references: they may carry findings and
 * must never constrain a threshold. Add a template here only when it is
 * accepted as reference quality.
 */
export const STOCK_REFERENCE_TEMPLATES: readonly string[] = [
  'modern-annual-report-1.docx.json',
  'modern-annual-report-2.docx.json',
  'modern-annual-report-3.docx.json',
  'standard-annual-report.docx.json',
  'tech-report.docx.json',
  'data-report-presentation.pptx.json',
  'management-plan.pptx.json',
  'minimalist-pitch-deck.pptx.json',
];

export interface ExpectedQualityDiagnostic {
  code: string;
  category: QualityCategory;
  certainty: QualityCertainty;
  severity: DiagnosticSeverity;
}

export interface QualityReferenceCase {
  id: string;
  format: FormatName;
  tier: QualityReferenceTier;
  profile: QualityProfile;
  renderer: string;
  rationale: string;
  document: Record<string, unknown>;
  expected: readonly ExpectedQualityDiagnostic[];
}

function docxDocument(profileId: string, tier: QualityReferenceTier) {
  const poor = tier === 'poor';
  return {
    name: 'docx',
    props: { theme: 'minimal' },
    metadata: { title: `${profileId}-${tier}` },
    children: [
      { name: 'heading', props: { text: 'Decision', level: 1 } },
      {
        name: 'heading',
        props: { text: 'Evidence', level: poor ? 3 : 2 },
      },
      {
        name: 'paragraph',
        props: {
          text:
            tier === 'excellent'
              ? 'Conclusion first; supporting detail follows in reading order.'
              : 'Supporting detail in reading order.',
        },
      },
      {
        name: 'table',
        props: {
          columns: [
            {
              header: { content: 'Measure' },
              cells: [{ content: 'Adoption' }],
              width: poor ? 400 : 200,
            },
            {
              header: { content: 'Value' },
              cells: [{ content: '72%' }],
              width: poor ? 400 : 200,
            },
          ],
        },
      },
    ],
  };
}

function bodyWords(count: number): string {
  return Array.from({ length: count }, (_, index) => `word${index}`).join(' ');
}

/**
 * Type size and body length are judged against the profile's own bar, so a
 * `poor` slide has to be poor *for that profile*: 12pt over 90 words is an
 * ordinary technical slide and an unreadable executive one. That is why
 * `executive-presentation/poor` and `technical-presentation/professional`
 * carry the same slide body — only the profile decides the verdict.
 */
function pptxSlideBody(profileId: string, tier: QualityReferenceTier) {
  const executive = profileId === 'executive-presentation';
  if (tier === 'excellent') {
    return { text: 'One decision. One supporting number.', fontSize: 28 };
  }
  if (tier === 'professional') {
    return executive
      ? { text: 'Decision and supporting evidence.', fontSize: 18 }
      : { text: bodyWords(90), fontSize: 12 };
  }
  return executive
    ? { text: bodyWords(90), fontSize: 12 }
    : { text: bodyWords(145), fontSize: 5 };
}

function pptxDocument(profileId: string, tier: QualityReferenceTier) {
  const body = pptxSlideBody(profileId, tier);
  return {
    name: 'pptx',
    props: {
      theme: 'minimal',
      slideWidth: 13.333,
      slideHeight: 7.5,
      title: `${profileId}-${tier}`,
    },
    children: [
      {
        name: 'slide',
        props: {},
        children: [
          {
            name: 'text',
            props: {
              text: body.text,
              fontSize: body.fontSize,
            },
          },
        ],
      },
    ],
  };
}

/**
 * Pinned per profile by hand. Reading the severity back off the profile's own
 * `rules` block would agree with itself after that block was deleted, which is
 * exactly the regression these expectations exist to catch.
 */
function expectedDocx(
  profileId: string,
  tier: QualityReferenceTier
): readonly ExpectedQualityDiagnostic[] {
  if (tier !== 'poor') return [];
  return [
    {
      code: 'W_QUALITY_HEADING_SKIP',
      category: 'hierarchy',
      certainty: 'deterministic',
      severity: profileId === 'executive-report' ? 'warning' : 'info',
    },
    {
      code: 'W_QUALITY_TABLE_WIDTH_OVERFLOW',
      category: 'integrity',
      certainty: 'deterministic',
      severity: 'warning',
    },
  ];
}

function expectedPptx(
  tier: QualityReferenceTier
): readonly ExpectedQualityDiagnostic[] {
  if (tier !== 'poor') return [];
  return [
    {
      code: 'W_QUALITY_FONT_SIZE_MIN',
      category: 'legibility',
      certainty: 'measured',
      severity: 'warning',
    },
    {
      code: 'W_QUALITY_SLIDE_DENSITY',
      category: 'information-design',
      certainty: 'estimated',
      severity: 'warning',
    },
  ];
}

function pptxRationale(profileId: string, tier: QualityReferenceTier): string {
  const executive = profileId === 'executive-presentation';
  if (tier === 'poor') {
    return executive
      ? 'Type and density a technical deck tolerates and an executive audience cannot scan.'
      : 'Unreadable type and document-like density on one slide.';
  }
  if (tier === 'professional') {
    return executive
      ? 'Readable, bounded, single-message slide.'
      : 'Detail-dense but readable — what a technical deck is for.';
  }
  return 'Decisive composition with ample type and minimal cognitive load.';
}

const docxProfiles = Object.values(DOCX_QUALITY_PROFILES);
const pptxProfiles = Object.values(PPTX_QUALITY_PROFILES);

export const QUALITY_REFERENCE_CORPUS: readonly QualityReferenceCase[] = [
  ...docxProfiles.flatMap((profile) =>
    (['poor', 'professional', 'excellent'] as const).map((tier) => ({
      id: `${profile.id}/${tier}`,
      format: 'docx' as const,
      tier,
      profile,
      renderer: 'docxjs',
      rationale:
        tier === 'poor'
          ? 'Broken outline plus a table wider than the page.'
          : tier === 'professional'
            ? 'Clear hierarchy and bounded table geometry.'
            : 'Conclusion-first structure with deliberate hierarchy and rhythm.',
      document: docxDocument(profile.id, tier),
      expected: expectedDocx(profile.id, tier),
    }))
  ),
  ...pptxProfiles.flatMap((profile) =>
    (['poor', 'professional', 'excellent'] as const).map((tier) => ({
      id: `${profile.id}/${tier}`,
      format: 'pptx' as const,
      tier,
      profile,
      renderer: 'pptxgenjs',
      rationale: pptxRationale(profile.id, tier),
      document: pptxDocument(profile.id, tier),
      expected: expectedPptx(tier),
    }))
  ),
];

/**
 * The same authored document read against a second profile. Each entry pins
 * what the *other* profile says about a case its own profile calls poor, so
 * the corpus proves the profile — not the document — moved the verdict.
 */
export const QUALITY_REFERENCE_CROSS_PROFILE: readonly {
  caseId: string;
  profile: QualityProfile;
  expected: readonly ExpectedQualityDiagnostic[];
}[] = [
  {
    caseId: 'executive-report/poor',
    profile: DOCX_QUALITY_PROFILES['technical-report'],
    expected: [
      {
        code: 'W_QUALITY_HEADING_SKIP',
        category: 'hierarchy',
        certainty: 'deterministic',
        severity: 'info',
      },
      {
        code: 'W_QUALITY_TABLE_WIDTH_OVERFLOW',
        category: 'integrity',
        certainty: 'deterministic',
        severity: 'warning',
      },
    ],
  },
  {
    caseId: 'executive-presentation/poor',
    profile: PPTX_QUALITY_PROFILES['technical-presentation'],
    expected: [],
  },
];

/** Pinned authored-structure hashes; renderer/package goldens live in each core. */
export const QUALITY_REFERENCE_DIGESTS: Readonly<Record<string, string>> = {
  'executive-report/poor':
    'b8732a4f507cfb26fc517bdab8b0215b1238648e55cecfaad501856d1148da1d',
  'executive-report/professional':
    '8ecf6e3a18aa1548124aeb1b94e655614f281fcabd2bfd88e243360563d9bb17',
  'executive-report/excellent':
    'd0fa2eecb17c904c9cda00decbeb2122bdfa22e0643bcd068af879d42714621b',
  'technical-report/poor':
    '8c8e4bdcc01e694fda1a755f44bc6037867c6195bea43c5b8c983798ac6238b7',
  'technical-report/professional':
    '248a128be1e0c8a957c400b34895f7f2e8ad032b52512d5102c44e28dd345caa',
  'technical-report/excellent':
    '8409d54f86a2add09f52a26ee9f075b023c205a4047f5db3599f1d99265d3dcb',
  'legal-appendix/poor':
    '7d54c02db6da12cbe7c2616589b56d0605dea4aa520abebbe9b86c23b21a1351',
  'legal-appendix/professional':
    'e7ce76730a34deb12a0bc3a6e6847cde3256c0c40c8999b6f3c1c392b75b3b36',
  'legal-appendix/excellent':
    '17670dbb01c9f7b94f8a03429602609157c3893bb58a47ead92d2d0d18c55531',
  'executive-presentation/poor':
    'b0b6381c95adb078b37644168239f7940213bb1dfc8f2c535c1195dce7fb4b57',
  'executive-presentation/professional':
    'ccd4f28492260e58ed6e4ebf96c9628fea42eed5c95cd7a98fd8bbf70a6f17dc',
  'executive-presentation/excellent':
    '7a26eead97ebd0863236cdb281f63403fcaeb083ea0c7e8e68739b902ed4b740',
  'technical-presentation/poor':
    'bdb8460c0467987e822ecc9c98c0e3439a2cf974b45d29a965eb3ae8c56771ce',
  'technical-presentation/professional':
    'c70d4adeb5c2d57712a9ad27814aeaa5a03b9d2403c56126f7f4ad25c0de352a',
  'technical-presentation/excellent':
    '2e6b70ef98a686c1a311adb36298a6b14e16b758ba72e3aad82479929fa06f6d',
};

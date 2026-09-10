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
 * bar for the quality rules. Since the four legacy playground decks were
 * dropped from the repo this list is every shipped template, but the two are
 * not the same thing: a template earns a place here by being accepted as
 * reference quality, not by being present in `public/templates`. A new
 * starting-point template ships without being added here.
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
          // Every tier's slide is titled: the tiers differ by type and
          // density, and an untitled slide would say the same thing about
          // all three while telling us nothing about either.
          {
            name: 'text',
            props: { text: `${profileId} ${tier}`, style: 'title' },
          },
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
      severity:
        profileId === 'executive-report' ||
        profileId === 'client-report' ||
        profileId === 'technical-report'
          ? 'warning'
          : 'info',
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
  profileId: string,
  tier: QualityReferenceTier
): readonly ExpectedQualityDiagnostic[] {
  // Every tier writes its size by hand; only the consulting profile asks
  // whether the theme paints it. `minimal` paints 10, 14, 18, 20, 22, 28 and
  // 36pt, so the 28pt `excellent` slide is on the scale and the others are
  // not — the same slide, judged by the archetype that cares.
  const offScale: readonly ExpectedQualityDiagnostic[] =
    profileId === 'consulting-deck' && tier !== 'excellent'
      ? [
          {
            code: 'W_QUALITY_TYPE_OFF_SCALE',
            category: 'consistency',
            certainty: 'deterministic',
            severity: 'warning',
          },
        ]
      : [];
  if (tier !== 'poor') return offScale;
  return [
    ...offScale,
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
      expected: expectedPptx(profile.id, tier),
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
    profile: DOCX_QUALITY_PROFILES['general'],
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
  'client-report/poor':
    'dfcf64943986670ce418593c0f1af3f7fa007ef6b2c13e9664f2eede257263eb',
  'client-report/professional':
    '2405d79b0e192e90922b99aadef5e3382105f7aba71633daad24c2a13da94135',
  'client-report/excellent':
    'f3f31cd7cea47990ed05c1ddaebe3a4e811b45d688d87c5ee9b5d1eaaca0edb6',
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
  'general/poor':
    '6793a0dd27d1032a562998a2afb707faa97fae0709fdb00029c971e20a1f39f9',
  'general/professional':
    'd48d10118d930eab8c61c75a13b5f01cad6feafbf3932242fc5ef9e69c50da55',
  'general/excellent':
    '593300b6f3894cc5da0e07da458df198f13b1c8819e9136a0b5acfd107202c4a',
  'legal-appendix/poor':
    '7d54c02db6da12cbe7c2616589b56d0605dea4aa520abebbe9b86c23b21a1351',
  'legal-appendix/professional':
    'e7ce76730a34deb12a0bc3a6e6847cde3256c0c40c8999b6f3c1c392b75b3b36',
  'legal-appendix/excellent':
    '17670dbb01c9f7b94f8a03429602609157c3893bb58a47ead92d2d0d18c55531',
  'executive-presentation/poor':
    '3d00419c255b971d7837967a77153230cf7292d2e1273f0c940be4f5fd000058',
  'executive-presentation/professional':
    '093bf8c03fa95a5d0e659a4146720db71feeb6b8322c1472cba9854301d51a1e',
  'executive-presentation/excellent':
    '56525b6d5f37bd63afd786183399301630c9f2b689f5e551ab42a34ef037aa9b',
  'technical-presentation/poor':
    '68d3c3e81af664f4d9db36be44b28373130b842450cb54f4754cc33f29045e88',
  'technical-presentation/professional':
    '30e6f0544bcd6077ac596a749c760c462ffda6ead69b20386fb9f196e270f3cc',
  'technical-presentation/excellent':
    '11a9716afeb41b205dc864589a254e17a401606a07e730d5a847a692cb32f1af',
  'consulting-deck/poor':
    'b0441e9248ee39df9a6c2f2c5cb01cb4378d900ccad70fe54c3cd6644cf816c0',
  'consulting-deck/professional':
    'cd7c54cc9a4f71cf27ae26e36473108af8c673898aeb885d9d8141027e24b10d',
  'consulting-deck/excellent':
    '84e215320fb61932af8bd9ea5a7b28b1608be68b0212a3a36aae6f297e0d068b',
};

/**
 * `jto://guide/design/<format>`: the design guidance an agent reads before
 * authoring, rendered from the registries the product runs on — the themes
 * the core resolves, the profiles and rule pack `jto_validate` judges by, the
 * block catalogue and the blueprints. Nothing here is written apart from the
 * data: a rule that gains a sentence gains it in the pack, a theme that
 * changes its voice changes it in its file, and the guide follows. The drift
 * test holds the markdown to the arrays it was rendered from.
 *
 * The one thing the guide has to teach that no single registry states is the
 * boundary between them: a theme paints, a profile requires.
 */

import type {
  QualityCategory,
  QualityProfile,
  QualityRule,
} from '@json-to-office/quality';
import { RENDERED_QUALITY_RULES } from '@json-to-office/jto-ops';
import {
  RUBRIC,
  SHIPPING_QUESTION,
  type Blueprint,
  type RubricLevel,
} from '@json-to-office/shared';

import type { FormatName } from './adapters.js';
import { loadCore } from './core.js';
import { themeDescriptions, type ThemeDescription } from './themes.js';
import { blockReferenceCatalog } from '../templates/blocks.js';
import { galleryManifests } from '../templates/gallery.js';

export interface GuideRule {
  id: string;
  code: string;
  description: string;
  category: QualityCategory;
  defaultSeverity: string;
  certainty: string;
  defaultEnabled: boolean;
  parameters?: Readonly<Record<string, unknown>>;
}

export interface GuideProfile {
  id: string;
  description: string;
  default: boolean;
  rules: Readonly<NonNullable<QualityProfile['rules']>>;
}

export interface GuideBlock {
  name: string;
  template: string;
  description: string;
  slots: string[];
}

export interface GuideBlueprint {
  id: string;
  title: string;
  description: string;
  whenToUse: string;
  theme: string;
  profile: string;
}

export interface GuideTemplate {
  name: string;
  archetype: string;
  whenToUse: string;
  theme: string;
  pages: number;
}

export interface DesignGuide {
  format: FormatName;
  generatedFrom: string[];
  themes: ThemeDescription[];
  profiles: GuideProfile[];
  rules: GuideRule[];
  blocks: GuideBlock[];
  blueprints: GuideBlueprint[];
  /** Whole designed documents, distinct from blocks and blueprints. */
  templates: GuideTemplate[];
  /**
   * What "good" means, the same table `jto_critique` returns and the
   * evaluation judge is prompted from (#345).
   */
  rubric: { levels: RubricLevel[]; shippingQuestion: string };
  /** The same data, rendered to read. */
  markdown: string;
}

const CATEGORY_ORDER: readonly QualityCategory[] = [
  'integrity',
  'legibility',
  'hierarchy',
  'composition',
  'consistency',
  'information-design',
  'brand',
  'accessibility',
];

function guideRule(rule: QualityRule): GuideRule {
  return {
    id: rule.id,
    code: rule.code,
    description: rule.description ?? '',
    category: rule.category,
    defaultSeverity: rule.defaultSeverity,
    certainty: rule.defaultCertainty,
    defaultEnabled: rule.defaultEnabled ?? true,
    ...(rule.defaultParameters &&
      Object.keys(rule.defaultParameters).length > 0 && {
        parameters: rule.defaultParameters,
      }),
  };
}

function guideProfile(
  profile: QualityProfile,
  defaultId: string | undefined
): GuideProfile {
  return {
    id: profile.id,
    description: profile.description ?? '',
    default: profile.id === defaultId,
    rules: profile.rules ?? {},
  };
}

function guideBlueprint(blueprint: Blueprint): GuideBlueprint {
  return {
    id: blueprint.id,
    title: blueprint.title,
    description: blueprint.description ?? '',
    whenToUse: blueprint.whenToUse ?? '',
    theme: blueprint.theme,
    profile: blueprint.profile,
  };
}

const FORMAT_LABEL: Record<FormatName, string> = {
  docx: 'Word reports',
  pptx: 'PowerPoint decks',
};

function describeParameters(
  parameters: Readonly<Record<string, unknown>> | undefined
): string {
  if (!parameters) return '';
  const parts = Object.entries(parameters).map(
    ([name, value]) =>
      `${name}: ${Array.isArray(value) ? value.join(', ') || 'none' : String(value)}`
  );
  return parts.length ? ` (${parts.join('; ')})` : '';
}

function renderTheme(theme: ThemeDescription): string {
  const lines = [
    `- \`${theme.name}\` — ${theme.displayName}. ${theme.description.replace(/\.$/, '')}.`,
    `  Use it for: ${theme.whenToUse}`,
    `  Type: ${theme.fonts.heading} headings, ${theme.fonts.body} body.`,
  ];
  if (theme.typography) {
    const roles = Object.entries(theme.typography.roles)
      .map(([role, size]) => `${role} ${size}pt`)
      .join(', ');
    lines.push(`  Extended: type roles ${roles}.`);
    if (theme.chrome?.length)
      lines.push(`  Chrome recipes: ${theme.chrome.join(', ')}.`);
    if (theme.motif) lines.push(`  Motif: ${theme.motif}.`);
  } else {
    lines.push(
      '  Plain theme: palette, fonts and styles only; no type roles, chrome recipes or motif.'
    );
  }
  return lines.join('\n');
}

function renderProfile(profile: GuideProfile): string {
  const configured = Object.entries(profile.rules).map(([id, config]) => {
    const state = [
      config.enabled === true ? 'on' : config.enabled === false ? 'off' : '',
      config.severity ?? '',
    ]
      .filter(Boolean)
      .join(', ');
    return `${id}${state ? ` ${state}` : ''}${describeParameters(config.parameters)}`;
  });
  return [
    `- \`${profile.id}\`${profile.default ? ' (default)' : ''} — ${profile.description}`,
    configured.length
      ? `  Configures: ${configured.join('; ')}.`
      : '  Keeps every rule at its default.',
  ].join('\n');
}

function renderRules(rules: GuideRule[]): string {
  return CATEGORY_ORDER.filter((category) =>
    rules.some((rule) => rule.category === category)
  )
    .map((category) => {
      const entries = rules
        .filter((rule) => rule.category === category)
        .map(
          (rule) =>
            `- \`${rule.code}\` (${rule.id}; ${rule.defaultSeverity}, ${rule.certainty}${
              rule.defaultEnabled ? '' : '; off until a profile enables it'
            }${describeParameters(rule.parameters)}) — ${rule.description}`
        );
      return [`### ${category}`, ...entries].join('\n');
    })
    .join('\n\n');
}

export function renderDesignGuide(
  guide: Omit<DesignGuide, 'markdown'>
): string {
  const sections = [
    `# Design guide — ${FORMAT_LABEL[guide.format]}`,
    '',
    `Generated from ${guide.generatedFrom.join(', ')}. What is written here is what \`jto_validate\` enforces and what the cores resolve; nothing is stated apart from that data.`,
    '',
    '## Themes paint, profiles require',
    '',
    'A theme is a visual system: its palette, type roles, spacing, chrome recipes and motif decide how every component looks, and a block or a chrome slot takes its look from the theme without being asked. A profile is the bar a document is judged by: which chrome must be present, which slots must be filled, how strictly sizes must keep to the theme’s scale. Selecting a theme never adds a requirement; selecting a profile never changes a colour. Pick the theme for the look, and the profile — or a blueprint, which names one — for the archetype.',
    '',
    '## Themes',
    '',
    guide.themes.map(renderTheme).join('\n'),
    '',
    '## Profiles',
    '',
    guide.profiles.map(renderProfile).join('\n'),
    '',
    '## Rules',
    '',
    'Every finding is path-addressed and names what it expected; `evidence.values.source` says whether the theme or the profile asked for it. Apply the RFC 6902 fix when a finding carries one.',
    '',
    renderRules(guide.rules),
  ];
  if (guide.blocks.length) {
    sections.push(
      '',
      '## Blocks',
      '',
      'Two ways to extend the format: code plugins for programmable behaviour, registered explicitly as dependencies; and JSON blocks — reusable compositions with typed slots — for anything a document can say in data. The references below are extracted from complete playground templates: copy a definition and its dependencies from `jto://blocks` into `props.blocks`, then invoke it by name, and the theme styles every slot. A block a workspace defines itself carries the same metadata; read its `/props/blocks` with `jto_workspace_inspect`. A catalogue name is never a runtime global.',
      '',
      guide.blocks
        .map(
          (block) =>
            `- \`${block.name}\` (${block.template}) — ${block.description} Slots: ${block.slots.join(', ') || 'none'}.`
        )
        .join('\n')
    );
  }
  if (guide.blueprints.length) {
    sections.push(
      '',
      '## Blueprints',
      '',
      'Archetypes as data; `jto_scaffold` turns one into a draft workspace with a fill map. A markdown outline fills that draft: `#` the title, each `##` the next section (on a deck, the next content slide), the paragraphs and bullets beneath it the body. On a deck the outline also shapes the slides — bullets past a list’s length become consecutive slides, a table fills a two-column slide’s evidence column, and bullets that read `Label: figure` become KPI rows.',
      '',
      guide.blueprints
        .map(
          (blueprint) =>
            `- \`${blueprint.id}\` — ${blueprint.title}. ${blueprint.description} Use it for: ${blueprint.whenToUse} Theme \`${blueprint.theme}\`, profile \`${blueprint.profile}\`.`
        )
        .join('\n')
    );
  }
  if (guide.templates.length) {
    sections.push(
      '',
      '## Templates',
      '',
      'Whole designed documents bundled with the server, distinct from a block (one composition) and a blueprint (a plan to fill). Read one from `jto://templates/<name>`, and its thumbnail first.',
      '',
      guide.templates
        .map(
          (template) =>
            `- \`${template.name}\` — ${template.archetype}, ${template.pages} pages on \`${template.theme}\`. ${template.whenToUse}`
        )
        .join('\n')
    );
  }
  sections.push(
    '',
    '## Rubric',
    '',
    'What the levels mean, and the question the target is stated against. A higher level never compensates for a failure below it. `jto_critique` returns this same table with the evidence to judge against it.',
    '',
    guide.rubric.levels
      .map((entry) => `${entry.level}. **${entry.name}** — ${entry.bar}`)
      .join('\n'),
    '',
    guide.rubric.shippingQuestion
  );
  sections.push(
    '',
    '## Workflow',
    '',
    'THEME with `jto_discover`; STRUCTURE with `jto_scaffold` or an explicit plan; FILL by fill-map pointer with `jto_workspace_patch`; CHECK with `jto_validate` after every edit and `jto_preview` when the question is visual; SHIP with `jto_generate`.',
    ''
  );
  return sections.join('\n');
}

export async function designGuide(format: FormatName): Promise<DesignGuide> {
  const core = await loadCore(format);
  // The rendered pass is a rule pack of its own, format-filtered the way the
  // engine filters it; the guide lists it beside the format's static rules
  // so a profile author sees every id a profile can configure.
  const rules = [
    ...(core?.rules ?? []),
    ...RENDERED_QUALITY_RULES.rules.filter(
      (rule) => rule.formats === undefined || rule.formats.includes(format)
    ),
  ].map(guideRule);
  const profiles = Object.values(core?.profiles ?? {})
    .map((profile) => guideProfile(profile, core?.defaultProfileId))
    .sort((a, b) => a.id.localeCompare(b.id));
  const blocks = blockReferenceCatalog(format).map((block) => ({
    name: block.name,
    template: block.template,
    description: block.description,
    slots: Object.keys(
      (block.slotsSchema as { properties?: Record<string, unknown> })
        .properties ?? {}
    ),
  }));
  const blueprints = Object.values(core?.blueprints ?? {})
    .map(guideBlueprint)
    .sort((a, b) => a.id.localeCompare(b.id));
  const templates = galleryManifests(format).map((manifest) => ({
    name: manifest.name,
    archetype: manifest.archetype,
    whenToUse: manifest.whenToUse,
    theme: manifest.theme,
    pages: manifest.pages,
  }));
  const body = {
    format,
    generatedFrom: [
      'the theme registry',
      'the quality profiles',
      'the rule pack',
      'the rendered rule pack',
      'the block catalogue',
      ...(blueprints.length ? ['the blueprints'] : []),
      'the template gallery',
      'the rubric',
    ],
    themes: await themeDescriptions(format),
    profiles,
    rules,
    blocks,
    blueprints,
    templates,
    rubric: {
      levels: RUBRIC.map((entry) => ({ ...entry })),
      shippingQuestion: SHIPPING_QUESTION,
    },
  };
  return { ...body, markdown: renderDesignGuide(body) };
}

export type {
  ResolvedFont,
  ResolvedFontSource,
  FontRuntimeOpts,
  FontSource,
  FontRegistryEntry,
} from './types';

export {
  collectFontNames,
  collectFontNamesFromDocx,
  collectFontNamesFromPptx,
} from './collect';

export {
  validateFontReferences,
  type FontResolutionIssue,
  type FontIssueCode,
  type FontValidationResult,
  type FontValidationInput,
} from './validator';

export {
  WEIGHT_LABELS,
  synthesizeFamilyName,
  type SynthesizedFamily,
} from './synthesize';

export { rewriteFontFamilyName } from './sources/ttf-name';

export { FontRegistry, type FontRegistryInput } from './registry';

export { detectFontFormat } from './sources/format';

export {
  POPULAR_GOOGLE_FONTS,
  type PopularGoogleFont,
} from './catalog/popular-google';

export {
  UPSTREAM_OVERRIDES,
  getUpstreamOverride,
  type UpstreamOverride,
  type UpstreamVariant,
} from './catalog/upstream-overrides';

export { fetchGoogleFontSources } from './sources/google-fetcher';

export {
  applyFontSubstitution,
  buildDefaultSubstitutionMap,
  defaultSubstituteFor,
  applyExportMode,
  scopedThemeName,
  type FontSubstitution,
  type ApplyFontSubstitutionResult,
  type ApplyExportModeInput,
  type ApplyExportModeResult,
  type ApplyExportModeWarning,
} from './substitute';

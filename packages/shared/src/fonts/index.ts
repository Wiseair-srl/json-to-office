export type {
  ResolvedFont,
  ResolvedFontSource,
  FontRuntimeOpts,
  FontSource,
  FontRegistryEntry,
} from './types';

export { collectFontNamesFromDocx, collectFontNamesFromPptx } from './collect';

export {
  validateFontReferences,
  type FontResolutionIssue,
  type FontValidationResult,
  type FontValidationInput,
} from './validator';

export { FontRegistry, type FontRegistryInput } from './registry';

export { detectFontFormat } from './sources/format';

export {
  POPULAR_GOOGLE_FONTS,
  type PopularGoogleFont,
} from './catalog/popular-google';

export { fetchGoogleFontSources } from './sources/google-fetcher';

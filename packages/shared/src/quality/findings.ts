/**
 * Compatibility re-export. New code imports quality contracts from
 * `@json-to-office/quality`; shared keeps this path so existing consumers do
 * not break during the package split.
 */
export {
  QUALITY_CODES,
  type QualityCode,
  type QualityFinding,
  type QualityFindingSeverity,
} from '@json-to-office/quality';

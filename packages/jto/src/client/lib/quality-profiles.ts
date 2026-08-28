/**
 * The shipped quality profiles, and the one place a stored profile id is
 * turned into a request.
 *
 * Settings persist to a single localStorage key shared by both playgrounds
 * (`window.__JTO_FORMAT__` picks the format; the origin is the same), so a
 * profile chosen on the DOCX playground is still in storage when the PPTX one
 * opens. Sending it would be worse than useless: the client stamps
 * `formats: [FORMAT]` itself, so the server's compatibility check passes, the
 * id matches no registered profile, and the analysis silently runs on defaults
 * while the panel and the response both report the profile as active.
 * Resolution therefore happens here, at the point of use, rather than in a
 * component that only guards while it is mounted.
 */

import { FORMAT, type FormatName } from './env';
import { parseQualityPolicy } from './quality-policy';

export interface QualityProfileChoice {
  id: string;
  label: string;
  description: string;
}

export const QUALITY_PROFILES: Record<
  FormatName,
  readonly QualityProfileChoice[]
> = {
  docx: [
    {
      id: 'executive-report',
      label: 'Executive report',
      description: 'Short decision document with strict outline continuity',
    },
    {
      id: 'technical-report',
      label: 'Technical report',
      description: 'Portable professional report defaults',
    },
    {
      id: 'legal-appendix',
      label: 'Legal appendix',
      description: 'Dense appendix: preserve integrity without editorial taste',
    },
  ],
  pptx: [
    {
      id: 'executive-presentation',
      label: 'Executive presentation',
      description: 'Decision deck optimized for scan speed and projection',
    },
    {
      id: 'technical-presentation',
      label: 'Technical presentation',
      description: 'Portable professional presentation defaults',
    },
  ],
};

/** The profiles offerable for the format this playground is serving. */
export function profilesForFormat(): readonly QualityProfileChoice[] {
  return QUALITY_PROFILES[FORMAT];
}

/** The profile id stored for this format, if it still names a shipped one. */
export function storedProfileId(
  ids: Partial<Record<FormatName, string>> | undefined
): string | undefined {
  const id = ids?.[FORMAT];
  return isProfileForFormat(id) ? id : undefined;
}

/** True when `id` names a profile the current format actually ships. */
export function isProfileForFormat(id: string | undefined): id is string {
  return id !== undefined && QUALITY_PROFILES[FORMAT].some((p) => p.id === id);
}

export interface QualityRequestOptions {
  profile?: { id: string; formats: string[] };
  policy?: Record<string, unknown>;
}

/**
 * Build the `options.quality` payload for a generate or validate request.
 *
 * Returns undefined when neither a profile nor a gate was asked for, so the
 * request omits the key entirely and the server keeps its own defaults. A
 * profile id belonging to the other format is dropped rather than sent.
 */
export function buildQualityOptions(
  profileId: string | undefined,
  gate: string | undefined,
  policyText?: string
): QualityRequestOptions | undefined {
  const options: QualityRequestOptions = {};
  if (isProfileForFormat(profileId)) {
    options.profile = { id: profileId, formats: [FORMAT] };
  }
  // A policy still being typed is not sent at all: the run keeps working under
  // the last good one rather than failing on every unbalanced brace.
  const parsed = parseQualityPolicy(policyText);
  const authored = parsed.ok ? parsed.policy : undefined;
  const hasGate = gate === 'error' || gate === 'warning' || gate === 'info';
  if (authored || hasGate) {
    options.policy = {
      ...(authored ?? {}),
      // The Gate control owns this field; `parseQualityPolicy` rejects a policy
      // that also names it, so there is nothing here to overwrite.
      ...(hasGate && { gate }),
    };
  }
  return options.profile || options.policy ? options : undefined;
}

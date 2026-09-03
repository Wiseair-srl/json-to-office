/**
 * Headless against Desktop.
 *
 * The runner is a proxy for the surface this epic actually targets: Paolo, in
 * Claude Desktop. A proxy is worth what its agreement with the real thing is
 * worth, and "we assume it generalises" is not a number. So a small set of
 * briefs is run both ways and the ship/no-ship verdicts are compared.
 *
 * Reported as raw agreement and Cohen's kappa, because raw agreement alone
 * flatters a lopsided set: if nine of ten runs are unshippable in both places,
 * agreeing nine times out of ten is what chance would have done anyway.
 */

export interface PairedVerdict {
  briefId: string;
  headless: boolean;
  desktop: boolean;
}

export interface AgreementReport {
  pairs: number;
  agreed: number;
  rawAgreement: number;
  /** Cohen's kappa. NaN when one rater never varies — undefined, not zero. */
  kappa: number;
  /** The confusion matrix, so a reader can see which way the two differ. */
  matrix: {
    bothShippable: number;
    headlessOnly: number;
    desktopOnly: number;
    neither: number;
  };
  disagreements: string[];
}

export function agreement(verdicts: readonly PairedVerdict[]): AgreementReport {
  const matrix = {
    bothShippable: 0,
    headlessOnly: 0,
    desktopOnly: 0,
    neither: 0,
  };
  for (const verdict of verdicts) {
    if (verdict.headless && verdict.desktop) matrix.bothShippable += 1;
    else if (verdict.headless) matrix.headlessOnly += 1;
    else if (verdict.desktop) matrix.desktopOnly += 1;
    else matrix.neither += 1;
  }

  const pairs = verdicts.length;
  const agreed = matrix.bothShippable + matrix.neither;
  const observed = pairs === 0 ? 0 : agreed / pairs;

  // Chance agreement from the two raters' own marginals.
  const headlessYes = matrix.bothShippable + matrix.headlessOnly;
  const desktopYes = matrix.bothShippable + matrix.desktopOnly;
  const expected =
    pairs === 0
      ? 0
      : (headlessYes / pairs) * (desktopYes / pairs) +
        ((pairs - headlessYes) / pairs) * ((pairs - desktopYes) / pairs);

  return {
    pairs,
    agreed,
    rawAgreement: observed,
    kappa: expected === 1 ? Number.NaN : (observed - expected) / (1 - expected),
    matrix,
    disagreements: verdicts
      .filter((verdict) => verdict.headless !== verdict.desktop)
      .map((verdict) => verdict.briefId)
      .sort(),
  };
}

/**
 * The scaffold markers a document still carries.
 *
 * One question asked from two places with opposite answers: `jto_validate`
 * counts them and still says `ok`, because a draft is a legitimate thing to
 * hold; `jto_generate` refuses on the first, because a file is what someone
 * sends on. Filler text (lorem, "Your title here") is not a marker: nobody put
 * it there on purpose, so nobody can be sure it is not the real copy.
 */

import {
  collectPlaceholders,
  type PlaceholderOccurrence,
} from '@json-to-office/quality';

export function scaffoldMarkerOccurrences(
  document: unknown
): PlaceholderOccurrence[] {
  return collectPlaceholders(document).filter(
    (occurrence) => occurrence.match.kind === 'scaffold-marker'
  );
}

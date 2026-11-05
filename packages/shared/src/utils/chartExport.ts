/**
 * One chart's post to a Highcharts export server, for docx and pptx alike.
 *
 * Both formats post the same body to the same `/export` route and read the
 * same base64 answer, so the call — and the host's `acceptImage` check on
 * what comes back — lives here once rather than in each renderer.
 */

import type { HighchartsServiceConfig } from '../types/services';
import { recordChartRetry } from './chartRequests';
import { postJsonToServiceWithOutcome } from './serviceClient';

/**
 * Warning code for a chart embedded although the host's `acceptImage`
 * refused every image the export server returned for it.
 */
export const CHART_IMAGE_REJECTED_WARNING = 'W_CHART_IMAGE_REJECTED';

/** The minimum of an export request this module reads. */
export interface ChartExportRequestBody {
  infile: unknown;
  scale?: number;
}

/** What one chart's export ended with. */
export interface ChartExport {
  /** The PNG, base64 as the export server sent it (no `data:` prefix). */
  base64: string;
  /**
   * Present only when `acceptImage` refused every image: `base64` is then the
   * last one, and `attempts` is how many posts were made.
   */
  rejected?: { attempts: number };
}

/** The sentence a `W_CHART_IMAGE_REJECTED` warning carries. */
export function chartImageRejectedMessage(
  attempts: number,
  where?: string
): string {
  const at = where ? ` at ${where}` : '';
  const tries = `${attempts} attempt${attempts === 1 ? '' : 's'}`;
  return (
    `The chart${at} was embedded with an image acceptImage refused: ` +
    `no image it accepted came back in ${tries}, so the last refused one was used.`
  );
}

function decodeBase64(text: string): Uint8Array {
  const buffer = (
    globalThis as {
      Buffer?: { from(text: string, encoding: 'base64'): Uint8Array };
    }
  ).Buffer;
  if (buffer) return new Uint8Array(buffer.from(text, 'base64'));
  const binary = atob(text.replace(/\s+/g, ''));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * Post one chart to `${serverUrl}/export` and return its PNG.
 *
 * Without `services.acceptImage` this is the plain call it always was: the
 * same request, the same retries, the same bytes back. With it, each image is
 * judged before it is returned, inside the attempt — so nothing refused ever
 * reaches the per-document memo as an accepted render.
 */
export async function exportChartImage(
  serverUrl: string,
  requestBody: ChartExportRequestBody,
  services: HighchartsServiceConfig | undefined
): Promise<ChartExport> {
  const acceptImage = services?.acceptImage;
  const outcome = await postJsonToServiceWithOutcome<string>({
    url: serverUrl,
    path: '/export',
    body: requestBody,
    headers: services?.headers,
    timeoutMs: services?.timeoutMs,
    retries: services?.retries,
    onRetry: recordChartRetry,
    serviceLabel: 'Highcharts export server',
    // The code lets a server route report a missing export server as a
    // dependency outage with this message, not as an internal error.
    onUnreachable: (url, cause) =>
      `Highcharts Export Server is not running at ${url}. ` +
      'Start it with: npx highcharts-export-server --enableServer true\n' +
      `Cause: ${cause}`,
    decode: (response) => response.text(),
    ...(acceptImage
      ? {
          accept: (base64: string, attempt: number) =>
            acceptImage({
              image: decodeBase64(base64),
              mediaType: 'png',
              options: requestBody.infile as Record<string, unknown>,
              ...(requestBody.scale !== undefined
                ? { scale: requestBody.scale }
                : {}),
              attempt,
            }),
        }
      : {}),
  });

  return outcome.accepted
    ? { base64: outcome.body }
    : { base64: outcome.body, rejected: { attempts: outcome.attempts } };
}

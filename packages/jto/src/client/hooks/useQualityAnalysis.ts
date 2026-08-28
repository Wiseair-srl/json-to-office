import { useCallback, useContext, useEffect, useRef } from 'react';
import { API_ENDPOINTS } from '../config/api';
import { countBySeverity, findingsFromAnalysis } from '../lib/quality-findings';
import { buildQualityOptions, storedProfileId } from '../lib/quality-profiles';
import {
  isStaleQualityTicket,
  nextQualityTicket,
} from '../lib/quality-sequence';
import type { QualityState } from '../store/output-store';
import {
  OutputStoreContext,
  useOutputStore,
} from '../store/output-store-provider';
import { useSettingsStore } from '../store/settings-store-provider';
import { isJsonMediaType } from './usePresentationGenerator';

/**
 * Long enough that a burst of typing costs one request rather than one per
 * keystroke, short enough that a pause reads as "the panel just updated".
 *
 * The upper bound is not taste: `/api/*` rate-limits on `METHOD:path`, and in
 * production that budget is 100 requests per 15 minutes (server config
 * `RATE_LIMIT_MAX`). One analysis per typing pause has to stay well under
 * ~7 requests/minute sustained or the panel starts answering 429 to the author
 * who is typing the most.
 */
const ANALYSIS_DEBOUNCE_MS = 1500;

interface ValidateResponseBody {
  success?: boolean;
  data?: { valid?: boolean; qualityAnalysis?: unknown };
  error?: string;
  /** `QUALITY_GATE_FAILED` distinguishes a real rejection from a 429 or a 500. */
  code?: string;
  /** Present on a gate failure: the analysis that tripped it. */
  quality?: unknown;
}

/** The JSON body, or undefined when the response is not JSON at all. */
async function readJsonBody(
  response: Response
): Promise<ValidateResponseBody | undefined> {
  // A proxy that never reached the API answers with its own HTML error page,
  // and parsing that unguarded is what turns a dead backend into
  // `Unexpected token '<'` instead of the status it actually was.
  if (!isJsonMediaType(response.headers.get('content-type'))) return undefined;
  try {
    return (await response.json()) as ValidateResponseBody;
  } catch {
    return undefined;
  }
}

/**
 * The analysis-level fields, read one at a time.
 *
 * Spreading the server's object into the store would let an unexpected type
 * through to the panel, where a `blocked` that is a string reads as truthy and
 * a `profileId` that is an object renders as `[object Object]`.
 */
function readAnalysisFlags(
  analysis: unknown
): Pick<QualityState, 'profileId' | 'blocked' | 'truncated'> {
  if (!analysis || typeof analysis !== 'object') return {};
  const source = analysis as Record<string, unknown>;
  return {
    ...(typeof source.profileId === 'string'
      ? { profileId: source.profileId }
      : {}),
    ...(typeof source.blocked === 'boolean' ? { blocked: source.blocked } : {}),
    ...(typeof source.truncated === 'boolean'
      ? { truncated: source.truncated }
      : {}),
  };
}

/** The API's own message when there is one; the status is all that is left. */
function describeFailure(
  response: Response,
  body: ValidateResponseBody | undefined
): string {
  if (body?.error) return body.error;
  return `Quality analysis failed (${response.status}${
    response.statusText ? ` ${response.statusText}` : ''
  }).`;
}

/**
 * Re-run the quality analysis as the document changes, without rendering it.
 *
 * `/validate` returns the rich diagnostics `/generate` flattens into warnings,
 * so this is what keeps the panel current between builds — the author sees the
 * findings move while editing rather than only after asking for bytes.
 */
export function useQualityAnalysis(): {
  analyze: (
    documentName: string,
    documentText: string,
    options?: { immediate?: boolean }
  ) => void;
  cancel: () => void;
} {
  const setOutput = useOutputStore((state) => state.setOutput);
  const outputStore = useContext(OutputStoreContext)!;
  // Read here rather than inside the request so a settings change re-creates
  // `analyze`, and a caller holding the old one cannot keep analysing under a
  // profile the author has already switched away from.
  const profileIds = useSettingsStore((state) => state.qualityProfileIds);
  const profileId = storedProfileId(profileIds);
  const gate = useSettingsStore((state) => state.qualityGate);

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const cancel = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    abortRef.current?.abort();
    abortRef.current = null;
  }, []);

  // An analysis that outlives its component would resolve into a store nobody
  // is reading, and worse, overwrite findings a later mount had already put
  // there.
  useEffect(() => cancel, [cancel]);

  /**
   * Commit a result unless a newer analysis has already landed.
   *
   * Aborting only reaches this hook instance's own request, and there are
   * several instances plus the build writing the same slice, so the ticket is
   * what actually orders them.
   */
  const commit = useCallback(
    (ticket: number, next: QualityState) => {
      if (isStaleQualityTicket(outputStore.getState().quality, ticket)) return;
      setOutput({ quality: next });
    },
    [outputStore, setOutput]
  );

  const run = useCallback(
    async (documentName: string, documentText: string) => {
      let jsonDefinition: unknown;
      try {
        jsonDefinition = JSON.parse(documentText);
      } catch {
        // Half-typed JSON is the normal state of an editor, not something to
        // report. Keep the previous findings on screen: blanking the panel on
        // every unbalanced brace is worse than showing findings one keystroke
        // out of date.
        return;
      }

      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      const ticket = nextQualityTicket();

      const quality = buildQualityOptions(profileId, gate);

      try {
        const response = await fetch(API_ENDPOINTS.validate, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jsonDefinition,
            options: quality ? { quality } : {},
          }),
          signal: controller.signal,
        });
        const body = await readJsonBody(response);

        // A superseded request has already been replaced by a newer one, whose
        // answer is the current one; writing this stale result would undo it.
        if (controller.signal.aborted) return;

        if (!response.ok) {
          const message = describeFailure(response, body);
          if (body?.code === 'QUALITY_GATE_FAILED') {
            // A real rejection, and it carries the diagnostics that caused it.
            const findings = findingsFromAnalysis(body.quality);
            commit(ticket, {
              findings,
              counts: countBySeverity(findings),
              documentName,
              seq: ticket,
              blocked: true,
              source: 'validate',
              analyzedAt: Date.now(),
              gateError: message,
            });
            return;
          }
          // Everything else — 429 from the rate limiter, 413, a 500, a dead
          // proxy — says nothing about the document. Reporting it as a gate
          // failure would tell an author with no gate configured that their
          // document was blocked, and discarding the findings alongside it
          // would take away the only thing on screen that was still true.
          const previous = outputStore.getState().quality;
          commit(ticket, {
            ...(previous ?? {
              findings: [],
              counts: { error: 0, warning: 0, info: 0 },
              source: 'validate' as const,
            }),
            documentName,
            seq: ticket,
            analyzedAt: Date.now(),
            gateError: undefined,
            analysisError: message,
          });
          return;
        }

        // `success` is false for a schema-invalid document and for a blocked
        // one, neither of which is a failed request — the analysis, when there
        // is one, is still in `data`.
        const analysis = body?.data?.qualityAnalysis;
        const findings = findingsFromAnalysis(analysis);
        commit(ticket, {
          findings,
          counts: countBySeverity(findings),
          ...readAnalysisFlags(analysis),
          documentName,
          seq: ticket,
          source: 'validate',
          analyzedAt: Date.now(),
        });
      } catch {
        // An abort lands here, and so does a dropped connection. Neither says
        // anything about the document, so the last analysis stands.
      } finally {
        if (abortRef.current === controller) abortRef.current = null;
      }
    },
    [commit, gate, outputStore, profileId]
  );

  const analyze = useCallback(
    (
      documentName: string,
      documentText: string,
      options?: { immediate?: boolean }
    ) => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      if (options?.immediate) {
        void run(documentName, documentText);
        return;
      }
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        void run(documentName, documentText);
      }, ANALYSIS_DEBOUNCE_MS);
    },
    [run]
  );

  return { analyze, cancel };
}

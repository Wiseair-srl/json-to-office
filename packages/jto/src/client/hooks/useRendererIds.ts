import { useEffect, useState } from 'react';
import { API_ENDPOINTS } from '../config/api';

interface RendererList {
  /** Registered backend ids, the format's default first. */
  ids: string[];
  default: string | null;
}

const EMPTY: RendererList = { ids: [], default: null };

/**
 * Fetched once per page load, not once per mount.
 *
 * The set of backends is fixed for the life of the server, and this hook runs
 * in every mounted preview header — without the shared promise a page with two
 * of them asks the same question five times.
 */
let pending: Promise<RendererList> | undefined;

function loadRenderers(): Promise<RendererList> {
  pending ??= (async () => {
    try {
      const response = await fetch(API_ENDPOINTS.renderers);
      if (!response.ok) return EMPTY;
      const body = (await response.json()) as {
        success?: boolean;
        data?: RendererList;
      };
      if (!body?.success || !Array.isArray(body.data?.ids)) return EMPTY;
      return body.data;
    } catch {
      // A playground without the list simply shows no backend control.
      return EMPTY;
    }
  })();
  return pending;
}

/**
 * The generation backends this server registers.
 *
 * Fetched rather than listed here: the ids come from the core's renderer
 * registry, and a hard-coded copy would let the playground offer a backend the
 * server does not have — or hide one it gained. An empty list is the honest
 * answer while the request is in flight or if it failed, and the caller is
 * expected to render no control for it rather than an empty dropdown.
 */
export function useRendererIds(): RendererList {
  const [renderers, setRenderers] = useState<RendererList>(EMPTY);

  useEffect(() => {
    let cancelled = false;
    void loadRenderers().then((list) => {
      if (!cancelled) setRenderers(list);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return renderers;
}

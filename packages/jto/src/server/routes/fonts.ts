/**
 * Font catalog + Google Fonts materialization endpoints for the playground.
 *
 * GET  /catalog    — safe + popular Google fonts (static; cached)
 * POST /materialize — server-side Google Fonts fetch; returns base64 sources
 *                    so the client can insert `kind: "data"` entries into the
 *                    document JSON (self-contained, survives export/reimport).
 */

import { createHash } from 'node:crypto';
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { bodyLimit } from 'hono/body-limit';
import {
  SAFE_FONTS,
  POPULAR_GOOGLE_FONTS,
  fetchGoogleFontSources,
} from '@json-to-office/shared';
import { rateLimiter } from '../middleware/hono/rate-limit.js';
import type { AppEnv } from '../types/hono.js';

export const fontsRouter = new Hono<AppEnv>();

const MATERIALIZE_FAMILY_MAX = 64;
const MATERIALIZE_WEIGHTS_MAX = 9;

// Precomputed body + ETag for /catalog. SAFE_FONTS and POPULAR_GOOGLE_FONTS
// are module-level constants, so the payload only changes on deploy. Hashing
// once at import lets every request answer with a 304 when the client
// already has the current catalog.
const CATALOG_BODY = JSON.stringify({
  safe: SAFE_FONTS,
  google: POPULAR_GOOGLE_FONTS,
});
const CATALOG_ETAG = `"${createHash('sha256')
  .update(CATALOG_BODY)
  .digest('base64')
  .slice(0, 24)}"`;

fontsRouter.get('/catalog', (c) => {
  const ifNoneMatch = c.req.header('If-None-Match');
  if (ifNoneMatch && ifNoneMatch === CATALOG_ETAG) {
    c.header('ETag', CATALOG_ETAG);
    c.header('Cache-Control', 'public, max-age=86400');
    return c.body(null, 304);
  }
  c.header('Content-Type', 'application/json');
  c.header('ETag', CATALOG_ETAG);
  c.header('Cache-Control', 'public, max-age=86400');
  return c.body(CATALOG_BODY, 200);
});

interface MaterializeBody {
  family?: string;
  weights?: number[];
  italics?: boolean;
}

fontsRouter.post(
  '/materialize',
  bodyLimit({
    // Body is just {family, weights, italics} — 16 KB is generous.
    maxSize: 16 * 1024,
    onError: () => {
      throw new HTTPException(413, { message: 'Request body too large' });
    },
  }),
  rateLimiter({
    limit: process.env.NODE_ENV === 'production' ? 20 : 1000,
    window: 15 * 60 * 1000,
    keyGenerator: (c) =>
      c.req.header('X-Real-IP') ||
      c.req.header('X-Forwarded-For')?.split(',').pop()?.trim() ||
      'anonymous',
  }),
  async (c) => {
    let body: MaterializeBody;
    try {
      body = (await c.req.json()) as MaterializeBody;
    } catch {
      return c.json({ error: 'Invalid JSON body' }, 400);
    }

    const family = body.family?.trim();
    if (!family) {
      return c.json({ error: 'Missing required field: family' }, 400);
    }
    if (family.length > MATERIALIZE_FAMILY_MAX) {
      return c.json(
        { error: `family exceeds ${MATERIALIZE_FAMILY_MAX} characters` },
        400
      );
    }
    // Dedup + cap weights so a crafted request can't fan out to thousands of
    // upstream Google fetches. 9 canonical weights (100..900) is the ceiling.
    const weights =
      Array.isArray(body.weights) && body.weights.length > 0
        ? Array.from(
            new Set(
              body.weights.filter(
                (w) => typeof w === 'number' && w >= 100 && w <= 900
              )
            )
          ).slice(0, MATERIALIZE_WEIGHTS_MAX)
        : [400, 700];
    const italics = Boolean(body.italics);

    try {
      const { sources, warnings } = await fetchGoogleFontSources({
        family,
        weights,
        italics,
      });
      return c.json({
        family,
        sources: sources.map((s) => ({
          weight: s.weight,
          italic: s.italic,
          format: s.format,
          data: s.data.toString('base64'),
        })),
        warnings,
      });
    } catch (err) {
      return c.json(
        {
          error: `Google Fonts materialize failed: ${(err as Error).message}`,
        },
        502
      );
    }
  }
);

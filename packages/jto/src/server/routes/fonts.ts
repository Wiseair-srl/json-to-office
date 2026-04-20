/**
 * Font catalog + Google Fonts materialization endpoints for the playground.
 *
 * GET  /catalog    — safe + popular Google fonts (static; cached)
 * POST /materialize — server-side Google Fonts fetch; returns base64 sources
 *                    so the client can insert `kind: "data"` entries into the
 *                    document JSON (self-contained, survives export/reimport).
 */

import { Hono } from 'hono';
import {
  SAFE_FONTS,
  POPULAR_GOOGLE_FONTS,
  fetchGoogleFontSources,
} from '@json-to-office/shared';
import type { AppEnv } from '../types/hono.js';

export const fontsRouter = new Hono<AppEnv>();

fontsRouter.get('/catalog', (c) => {
  return c.json(
    {
      safe: SAFE_FONTS,
      google: POPULAR_GOOGLE_FONTS,
    },
    200,
    {
      'Cache-Control': 'public, max-age=86400',
    }
  );
});

interface MaterializeBody {
  family?: string;
  weights?: number[];
  italics?: boolean;
}

fontsRouter.post('/materialize', async (c) => {
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
  const weights =
    Array.isArray(body.weights) && body.weights.length > 0
      ? body.weights.filter(
          (w) => typeof w === 'number' && w >= 100 && w <= 900
        )
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
});

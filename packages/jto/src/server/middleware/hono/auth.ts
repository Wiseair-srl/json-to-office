import { createHash, timingSafeEqual } from 'node:crypto';
import { MiddlewareHandler } from 'hono';
import { config } from '../../config';
import type { ApiAuthMode } from '../../config';

export interface ApiKeyAuthOptions {
  mode: ApiAuthMode;
  apiKey?: string;
  headerName?: string;
}

function keysEqual(received: string, expected: string): boolean {
  const receivedDigest = createHash('sha256').update(received).digest();
  const expectedDigest = createHash('sha256').update(expected).digest();
  return timingSafeEqual(receivedDigest, expectedDigest);
}

function readCredential(
  headers: Headers,
  headerName: string
): string | undefined {
  const direct = headers.get(headerName)?.trim();
  if (direct) {
    if (
      headerName.toLowerCase() === 'authorization' &&
      direct.toLowerCase().startsWith('bearer ')
    ) {
      return direct.slice(7).trim() || undefined;
    }
    return direct;
  }

  const authorization = headers.get('authorization')?.trim();
  if (authorization?.toLowerCase().startsWith('bearer ')) {
    return authorization.slice(7).trim() || undefined;
  }
  return undefined;
}

/**
 * Does this request carry the configured API key?
 *
 * For the rare route that must authenticate on its own account, because the
 * middleware above may never see it: `API_AUTH_MODE=disabled` does not mount
 * it at all, and `auto` with no key configured waves everyone through. A
 * route that guards something the global policy does not — making the server
 * read and import from its own disk, say — cannot lean on either.
 *
 * The presence of a header is not authentication. With no key configured
 * there is nothing to check a credential against, so the answer is no and the
 * route refuses rather than trusting whatever was sent.
 *
 * Env is read live so a deployment's key is the one in effect, not the one
 * present when this module was first imported.
 */
export function hasValidApiKey(
  headers: Headers,
  env: NodeJS.ProcessEnv = process.env
): boolean {
  const expected = env.API_KEY?.trim();
  if (!expected) return false;
  const received = readCredential(headers, env.API_KEY_HEADER || 'x-api-key');
  if (!received) return false;
  return keysEqual(received, expected);
}

/**
 * API Key authentication middleware for Hono
 */
export function createApiKeyAuthMiddleware(
  options: ApiKeyAuthOptions
): MiddlewareHandler {
  const headerName = options.headerName || 'x-api-key';

  return async (c, next) => {
    if (c.req.method === 'OPTIONS' || options.mode === 'disabled') {
      return next();
    }

    if (!options.apiKey) {
      if (options.mode === 'auto') return next();
      return c.json(
        {
          success: false,
          error: 'API authentication is not configured',
          code: 'AUTH_CONFIGURATION_ERROR',
        },
        503
      );
    }

    const apiKey = readCredential(c.req.raw.headers, headerName);

    if (!apiKey) {
      return c.json(
        {
          success: false,
          error: 'API key required',
          code: 'UNAUTHORIZED',
        },
        401
      );
    }

    if (!keysEqual(apiKey, options.apiKey)) {
      return c.json(
        {
          success: false,
          error: 'Invalid API key',
          code: 'UNAUTHORIZED',
        },
        401
      );
    }

    await next();
  };
}

export const apiKeyAuthMiddleware = createApiKeyAuthMiddleware({
  mode: config.API_AUTH_MODE,
  apiKey: config.API_KEY,
  headerName: config.API_KEY_HEADER,
});

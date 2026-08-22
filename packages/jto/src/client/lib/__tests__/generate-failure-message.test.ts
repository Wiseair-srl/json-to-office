/**
 * A failed generation has to say something an author can act on.
 *
 * The generate response was parsed as JSON unconditionally, so when the proxy
 * answered instead of the API — a 502 HTML page after the renderer exhausted
 * its container — the surfaced error was `Unexpected token '<', "<!DOCTYPE "`,
 * which describes the parser rather than the problem.
 */
import { describe, it, expect } from 'vitest';
import {
  isJsonMediaType,
  describeFailure,
} from '../../hooks/usePresentationGenerator';

const res = (status: number, statusText = '') =>
  new Response(null, { status: status === 204 ? 204 : status, statusText });

describe('isJsonMediaType', () => {
  it.each([
    ['application/json', true],
    ['application/json; charset=utf-8', true],
    // Media types are case-insensitive.
    ['Application/JSON', true],
    // The structured suffix an error body may well use.
    ['application/problem+json', true],
    ['APPLICATION/PROBLEM+JSON; charset=utf-8', true],
    ['text/html', false],
    ['text/html; charset=utf-8', false],
    // A `+json` suffix outside the application tree is not a JSON body.
    ['text/problem+json', false],
    ['', false],
    [null, false],
  ])('%s -> %s', (value, expected) => {
    expect(isJsonMediaType(value as string | null)).toBe(expected);
  });
});

describe('describeFailure', () => {
  it('prefers the API error text when there is one', () => {
    expect(
      describeFailure(res(400), { error: 'Document validation failed' })
    ).toBe('Document validation failed');
  });

  it.each([502, 503, 504])(
    'explains a %s as the server dying mid-request',
    (status) => {
      const message = describeFailure(res(status), undefined);
      expect(message).toContain('ran out of memory');
      expect(message).not.toContain('DOCTYPE');
    }
  );

  it('names the cause for 413 and 429', () => {
    expect(describeFailure(res(413), undefined)).toContain('too large');
    expect(describeFailure(res(429), undefined)).toContain('Too many requests');
  });

  it('does not report a successful response as a status failure', () => {
    // The old default branch turned a 200 whose body was not JSON into the
    // nonsensical "Generation failed (200 OK)".
    const message = describeFailure(res(200, 'OK'), undefined);
    expect(message).not.toMatch(/Generation failed \(200/);
    expect(message).toContain('not with a document');
  });

  it('falls back to the status for anything else', () => {
    expect(describeFailure(res(418, "I'm a teapot"), undefined)).toBe(
      "Generation failed (418 I'm a teapot)."
    );
  });
});

import { describe, expect, it } from 'vitest';
import {
  assertSafeOutboundSources,
  assertSafeRendererPayload,
  UnsafeOutboundSourceError,
} from '../outbound-source-policy';

const safe = (allowedHosts: string[] = []) => ({
  mode: 'safe' as const,
  allowedHosts,
});

describe('outbound source policy', () => {
  it('preserves local-file workflows in development mode', () => {
    expect(() =>
      assertSafeOutboundSources(
        { name: 'image', props: { path: './logo.png' } },
        { mode: 'development', allowedHosts: [] }
      )
    ).not.toThrow();
  });

  it('rejects local image and background paths in safe mode', () => {
    expect(() =>
      assertSafeOutboundSources(
        { name: 'image', props: { path: '/etc/passwd' } },
        safe()
      )
    ).toThrow(UnsafeOutboundSourceError);
    expect(() =>
      assertSafeOutboundSources(
        { props: { background: { image: { path: '../secret.png' } } } },
        safe()
      )
    ).toThrow(/local and relative/);
  });

  it('allows HTTPS sources only on exact or explicit wildcard hosts', () => {
    expect(() =>
      assertSafeOutboundSources(
        {
          name: 'image',
          props: { path: 'https://assets.example.com/logo.png' },
        },
        safe(['assets.example.com'])
      )
    ).not.toThrow();
    expect(() =>
      assertSafeOutboundSources(
        {
          name: 'image',
          props: { path: 'https://cdn.example.com/logo.png' },
        },
        safe(['*.example.com'])
      )
    ).not.toThrow();
    expect(() =>
      assertSafeOutboundSources(
        {
          name: 'image',
          props: { path: 'https://example.com.evil.test/logo.png' },
        },
        safe(['*.example.com'])
      )
    ).toThrow(/not in OUTBOUND_HOST_ALLOWLIST/);
  });

  it('rejects file font sources and request-controlled service URLs', () => {
    expect(() =>
      assertSafeOutboundSources(
        { kind: 'file', path: '/tmp/brand.ttf' },
        safe()
      )
    ).toThrow(/local file sources/);
    expect(() =>
      assertSafeOutboundSources(
        {
          name: 'highcharts',
          props: {
            serverUrl: 'http://169.254.169.254',
            options: {},
          },
        },
        safe()
      )
    ).toThrow(/only HTTPS/);

    expect(() =>
      assertSafeOutboundSources(
        {
          name: 'image',
          props: { path: 'https://127.0.0.1/secret' },
        },
        safe(['127.0.0.1'])
      )
    ).toThrow(/private or local host/);
    expect(() =>
      assertSafeOutboundSources(
        {
          name: 'image',
          props: { path: 'https://[::1]/secret' },
        },
        safe(['::1'])
      )
    ).toThrow(/private or local host/);
    expect(() =>
      assertSafeOutboundSources(
        {
          name: 'image',
          props: { path: 'https://[::ffff:127.0.0.1]/secret' },
        },
        safe(['::ffff:7f00:1'])
      )
    ).toThrow(/private or local host/);
  });

  it('allows inline data but rejects active or externally-referencing SVG', () => {
    expect(() =>
      assertSafeOutboundSources(
        { name: 'image', props: { base64: 'data:image/png;base64,AA==' } },
        safe()
      )
    ).not.toThrow();
    expect(() =>
      assertSafeOutboundSources(
        {
          name: 'image',
          props: { svg: '<svg><script>alert(1)</script></svg>' },
        },
        safe()
      )
    ).toThrow(/active SVG/);
    expect(() =>
      assertSafeOutboundSources(
        {
          name: 'image',
          props: { svg: '<svg><image href="/internal.png" /></svg>' },
        },
        safe()
      )
    ).toThrow(/local and relative/);
  });

  it('checks encoded SVG content before rasterization', () => {
    const activeSvg = Buffer.from(
      '<svg><image href="file:///etc/passwd" /></svg>'
    ).toString('base64');
    expect(() =>
      assertSafeOutboundSources(
        {
          name: 'image',
          props: { base64: `data:image/svg+xml;base64,${activeSvg}` },
        },
        safe()
      )
    ).toThrow(/only HTTPS/);

    const entitySvg = encodeURIComponent(
      '<!DOCTYPE svg [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><svg />'
    );
    expect(() =>
      assertSafeOutboundSources(
        {
          name: 'image',
          props: { path: `data:image/svg+xml,${entitySvg}` },
        },
        safe()
      )
    ).toThrow(/entities/);
  });

  it('blocks renderer network primitives and JavaScript resources', () => {
    expect(() =>
      assertSafeRendererPayload(
        {
          infile: { chart: { events: { load: 'fetch("/metadata")' } } },
          type: 'png',
          b64: true,
        },
        safe()
      )
    ).toThrow(/network-capable JavaScript/);
    expect(() =>
      assertSafeRendererPayload(
        {
          infile: {},
          type: 'png',
          b64: true,
          resources: { js: 'console.log("hello")' },
        },
        safe()
      )
    ).toThrow(/JavaScript resources/);
  });
});

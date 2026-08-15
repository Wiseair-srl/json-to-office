import type { OutboundSourceMode } from '../config/index.js';

export interface OutboundSourcePolicy {
  mode: OutboundSourceMode;
  allowedHosts: readonly string[];
}

export class UnsafeOutboundSourceError extends Error {
  constructor(
    readonly path: string,
    reason: string
  ) {
    super(`Unsafe outbound source at ${path}: ${reason}`);
    this.name = 'UnsafeOutboundSourceError';
  }
}

type JsonRecord = Record<string, unknown>;

const DANGEROUS_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const COMPONENT_SOURCE_NAMES = new Set(['image']);

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hostMatches(host: string, pattern: string): boolean {
  const normalized = pattern.toLowerCase().replace(/\.$/, '');
  if (normalized.startsWith('*.')) {
    const suffix = normalized.slice(1);
    return host.endsWith(suffix) && host.length > suffix.length;
  }
  return host === normalized;
}

function isPrivateIpv4(host: string): boolean {
  const parts = host.split('.');
  if (parts.length !== 4) return false;
  const octets = parts.map(Number);
  if (
    octets.some(
      (part, index) =>
        !Number.isInteger(part) ||
        part < 0 ||
        part > 255 ||
        String(part) !== parts[index]
    )
  ) {
    return false;
  }
  const [a, b] = octets;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && (b === 0 || b === 168)) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

function isPrivateHost(host: string): boolean {
  const normalized = host
    .toLowerCase()
    .replace(/^\[|\]$/g, '')
    .replace(/\.$/, '');
  if (
    normalized === 'localhost' ||
    normalized.endsWith('.localhost') ||
    normalized === '::' ||
    normalized === '::1'
  ) {
    return true;
  }
  if (isPrivateIpv4(normalized)) return true;
  if (normalized.startsWith('::ffff:')) {
    const mapped = normalized.slice('::ffff:'.length);
    if (isPrivateIpv4(mapped)) return true;
    const groups = mapped.match(/^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i);
    if (groups) {
      const value =
        Number.parseInt(groups[1], 16) * 0x1_0000 +
        Number.parseInt(groups[2], 16);
      return isPrivateIpv4(
        [
          value >>> 24,
          (value >>> 16) & 255,
          (value >>> 8) & 255,
          value & 255,
        ].join('.')
      );
    }
  }
  const firstIpv6Group = Number.parseInt(normalized.split(':')[0] || '0', 16);
  return (
    (firstIpv6Group >= 0xfc00 && firstIpv6Group <= 0xfdff) ||
    (firstIpv6Group >= 0xfe80 && firstIpv6Group <= 0xfebf)
  );
}

function assertAllowedUrl(
  source: string,
  path: string,
  allowedHosts: readonly string[]
): void {
  if (source.startsWith('data:')) return;

  let url: URL;
  try {
    url = new URL(source);
  } catch {
    throw new UnsafeOutboundSourceError(
      path,
      'local and relative file paths are disabled for HTTP requests'
    );
  }

  if (url.protocol !== 'https:') {
    throw new UnsafeOutboundSourceError(path, 'only HTTPS URLs are allowed');
  }
  if (url.username || url.password) {
    throw new UnsafeOutboundSourceError(
      path,
      'URLs containing credentials are not allowed'
    );
  }

  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  if (isPrivateHost(host)) {
    throw new UnsafeOutboundSourceError(
      path,
      `private or local host "${host}" is not allowed`
    );
  }
  if (!allowedHosts.some((pattern) => hostMatches(host, pattern))) {
    throw new UnsafeOutboundSourceError(
      path,
      `host "${host}" is not in OUTBOUND_HOST_ALLOWLIST`
    );
  }
}

function extractCssReferences(input: string): string[] {
  const references: string[] = [];
  const urlPattern = /url\(\s*(['"]?)([^)'"\s]+)\1\s*\)/gi;
  const importPattern = /@import\s+(?:url\(\s*)?(['"])([^'"]+)\1/gi;
  for (const pattern of [urlPattern, importPattern]) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(input))) references.push(match[2]);
  }
  return references;
}

function extractAbsoluteUrls(input: string): string[] {
  return input.match(/(?:https?|file):\/\/[^\s'"<>)}\]]+/gi) ?? [];
}

function assertSafeSvg(
  svg: string,
  path: string,
  allowedHosts: readonly string[]
): void {
  if (
    /<\s*script\b/i.test(svg) ||
    /<\s*(?:foreignObject|iframe|object|embed)\b/i.test(svg) ||
    /\bon[a-z]+\s*=/i.test(svg)
  ) {
    throw new UnsafeOutboundSourceError(path, 'active SVG content is disabled');
  }
  if (/<!\s*(?:DOCTYPE|ENTITY)\b/i.test(svg)) {
    throw new UnsafeOutboundSourceError(
      path,
      'SVG document types and entities are disabled'
    );
  }

  const refPattern = /\b(?:href|src)\s*=\s*(['"])(.*?)\1/gi;
  let match: RegExpExecArray | null;
  while ((match = refPattern.exec(svg))) {
    const ref = match[2].trim();
    if (!ref || ref.startsWith('#') || ref.startsWith('data:')) continue;
    assertAllowedUrl(ref, path, allowedHosts);
  }
  for (const ref of extractCssReferences(svg)) {
    if (ref.startsWith('#') || ref.startsWith('data:')) continue;
    assertAllowedUrl(ref, path, allowedHosts);
  }
}

function assertSafeEncodedImage(
  source: string,
  path: string,
  allowedHosts: readonly string[]
): void {
  let candidate = source.trim();
  let declaredSvg = false;

  if (candidate.startsWith('data:')) {
    const comma = candidate.indexOf(',');
    if (comma < 0) {
      throw new UnsafeOutboundSourceError(path, 'malformed image data URL');
    }
    const metadata = candidate.slice(5, comma);
    declaredSvg = metadata.split(';')[0].toLowerCase() === 'image/svg+xml';
    if (!declaredSvg) return;
    const payload = candidate.slice(comma + 1);
    try {
      candidate = /(?:^|;)base64(?:;|$)/i.test(metadata)
        ? Buffer.from(payload, 'base64').toString('utf8')
        : decodeURIComponent(payload);
    } catch {
      throw new UnsafeOutboundSourceError(path, 'malformed SVG data URL');
    }
  } else if (!/<\s*svg\b/i.test(candidate)) {
    // The documented `base64` shape is a data URL, but inspect raw base64 too
    // so a migration client cannot smuggle active SVG through the same field.
    candidate = Buffer.from(candidate, 'base64').toString('utf8');
  }

  const svgStart = candidate.search(/<\s*svg\b/i);
  if (svgStart < 0) {
    if (declaredSvg) {
      throw new UnsafeOutboundSourceError(path, 'malformed SVG image data');
    }
    return;
  }
  assertSafeSvg(candidate, path, allowedHosts);
}

function assertSafeResources(
  resources: JsonRecord,
  path: string,
  allowedHosts: readonly string[]
): void {
  if (typeof resources.js === 'string' && resources.js.trim()) {
    throw new UnsafeOutboundSourceError(
      `${path}.js`,
      'remote renderer JavaScript resources are disabled'
    );
  }
  if (typeof resources.css === 'string') {
    for (const ref of extractCssReferences(resources.css)) {
      if (ref.startsWith('data:')) continue;
      assertAllowedUrl(ref, `${path}.css`, allowedHosts);
    }
  }
  // Highcharts loads `resources.files` as JavaScript. Allowlisting a host for
  // fonts or stylesheets must not also grant it script execution inside the
  // renderer, so reject the field outright rather than URL-checking it.
  if (Array.isArray(resources.files) && resources.files.length > 0) {
    throw new UnsafeOutboundSourceError(
      `${path}.files`,
      'remote renderer JavaScript resources are disabled'
    );
  }
}

function assertNoRemoteReferences(
  value: unknown,
  path: string,
  allowedHosts: readonly string[],
  seen: WeakSet<object>
): void {
  if (typeof value === 'string') {
    if (
      /\b(?:fetch|XMLHttpRequest|WebSocket|EventSource)\s*\(/i.test(value) ||
      /\b(?:javascript|file):/i.test(value)
    ) {
      throw new UnsafeOutboundSourceError(
        path,
        'network-capable JavaScript and file URLs are disabled'
      );
    }
    for (const url of [
      ...extractAbsoluteUrls(value),
      ...extractCssReferences(value),
    ]) {
      if (url.startsWith('data:')) continue;
      assertAllowedUrl(url, path, allowedHosts);
    }
    if (/^\/\//.test(value.trim())) {
      throw new UnsafeOutboundSourceError(
        path,
        'protocol-relative URLs are disabled'
      );
    }
    return;
  }
  if (!value || typeof value !== 'object' || seen.has(value)) return;
  seen.add(value);
  if (Array.isArray(value)) {
    value.forEach((entry, index) =>
      assertNoRemoteReferences(entry, `${path}[${index}]`, allowedHosts, seen)
    );
    return;
  }
  for (const [key, child] of Object.entries(value as JsonRecord)) {
    assertNoRemoteReferences(child, `${path}.${key}`, allowedHosts, seen);
  }
}

function visit(
  value: unknown,
  path: string,
  containerKey: string | undefined,
  allowedHosts: readonly string[],
  seen: WeakSet<object>
): void {
  if (!value || typeof value !== 'object' || seen.has(value)) return;
  seen.add(value);

  if (Array.isArray(value)) {
    value.forEach((entry, index) =>
      visit(entry, `${path}[${index}]`, containerKey, allowedHosts, seen)
    );
    return;
  }

  const record = value as JsonRecord;
  for (const key of Object.keys(record)) {
    if (DANGEROUS_KEYS.has(key)) {
      throw new UnsafeOutboundSourceError(
        `${path}.${key}`,
        'prototype mutation keys are disabled'
      );
    }
  }

  const kind = typeof record.kind === 'string' ? record.kind : undefined;
  if (kind === 'file' && typeof record.path === 'string') {
    throw new UnsafeOutboundSourceError(
      `${path}.path`,
      'local file sources are disabled for HTTP requests'
    );
  }
  if (
    (kind === 'url' || kind === 'variable') &&
    typeof record.url === 'string'
  ) {
    assertAllowedUrl(record.url, `${path}.url`, allowedHosts);
  }

  const componentName =
    typeof record.name === 'string' ? record.name.toLowerCase() : undefined;
  const props = isRecord(record.props) ? record.props : undefined;
  if (componentName && props) {
    if (
      COMPONENT_SOURCE_NAMES.has(componentName) &&
      typeof props.path === 'string'
    ) {
      assertAllowedUrl(props.path, `${path}.props.path`, allowedHosts);
      assertSafeEncodedImage(props.path, `${path}.props.path`, allowedHosts);
    }
    if (
      COMPONENT_SOURCE_NAMES.has(componentName) &&
      typeof props.base64 === 'string'
    ) {
      assertSafeEncodedImage(
        props.base64,
        `${path}.props.base64`,
        allowedHosts
      );
    }
    if (
      (componentName === 'highcharts' || componentName === 'visual') &&
      typeof props.serverUrl === 'string'
    ) {
      assertAllowedUrl(
        props.serverUrl,
        `${path}.props.serverUrl`,
        allowedHosts
      );
    }
    if (componentName === 'highcharts') {
      if (isRecord(props.resources)) {
        assertSafeResources(
          props.resources,
          `${path}.props.resources`,
          allowedHosts
        );
      }
      assertNoRemoteReferences(
        props.options,
        `${path}.props.options`,
        allowedHosts,
        new WeakSet()
      );
    }
  }

  // Slide/template/visual canvas backgrounds store an image source in a plain
  // `{ image: { path } }` object rather than an image component.
  if (containerKey === 'image' && typeof record.path === 'string') {
    assertAllowedUrl(record.path, `${path}.path`, allowedHosts);
    assertSafeEncodedImage(record.path, `${path}.path`, allowedHosts);
  }
  if (typeof record.svg === 'string') {
    assertSafeSvg(record.svg, `${path}.svg`, allowedHosts);
  }
  if (containerKey === 'resources') {
    assertSafeResources(record, path, allowedHosts);
  }

  for (const [key, child] of Object.entries(record)) {
    visit(child, `${path}.${key}`, key, allowedHosts, seen);
  }
}

/**
 * Reject request-controlled sources capable of making the server read local
 * files or reach arbitrary network hosts. Development mode intentionally
 * preserves local playground workflows.
 */
export function assertSafeOutboundSources(
  value: unknown,
  policy: OutboundSourcePolicy,
  rootPath = 'request'
): void {
  if (policy.mode === 'development') return;

  let parsed = value;
  if (typeof value === 'string') {
    try {
      parsed = JSON.parse(value);
    } catch {
      // Structural validation owns malformed JSON reporting.
      return;
    }
  }
  visit(parsed, rootPath, undefined, policy.allowedHosts, new WeakSet());
}

/** Extra checks for payloads executed by the Chromium-based chart renderer. */
export function assertSafeRendererPayload(
  value: unknown,
  policy: OutboundSourcePolicy
): void {
  assertSafeOutboundSources(value, policy, 'export');
  if (policy.mode === 'development' || !isRecord(value)) return;
  assertNoRemoteReferences(
    value.infile,
    'export.infile',
    policy.allowedHosts,
    new WeakSet()
  );
}

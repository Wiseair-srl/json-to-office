import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { GeneratorOptions } from '@json-to-office/jto-ops';

export interface QualityCommandOptions {
  qualityProfile?: string;
  qualityPolicy?: string;
  qualityGate?: string;
}

type QualityGate = NonNullable<
  NonNullable<GeneratorOptions['quality']>['policy']
>['gate'];

function readObject(path: string, label: string): Record<string, unknown> {
  const absolute = resolve(process.cwd(), path);
  const value = JSON.parse(readFileSync(absolute, 'utf8')) as unknown;
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${label} must contain a JSON object: ${path}`);
  }
  return value as Record<string, unknown>;
}

export function parseQualityGate(value: string): QualityGate {
  if (!['none', 'error', 'warning', 'info'].includes(value)) {
    throw new Error(
      `--quality-gate must be one of: none, error, warning, info (got "${value}")`
    );
  }
  return value as 'none' | 'error' | 'warning' | 'info';
}

export function loadQualityOptions(
  options: QualityCommandOptions
): GeneratorOptions['quality'] {
  const profile = options.qualityProfile
    ? readObject(options.qualityProfile, 'Quality profile')
    : undefined;
  if (profile && typeof profile.id !== 'string') {
    throw new Error('Quality profile requires a string "id"');
  }
  const filePolicy = options.qualityPolicy
    ? readObject(options.qualityPolicy, 'Quality policy')
    : undefined;
  const gate = options.qualityGate
    ? parseQualityGate(options.qualityGate)
    : undefined;
  const policy =
    filePolicy || gate
      ? {
          ...(filePolicy ?? {}),
          ...(gate !== undefined && { gate }),
        }
      : undefined;

  return profile || policy
    ? {
        ...(profile && {
          profile: profile as unknown as NonNullable<
            GeneratorOptions['quality']
          >['profile'],
        }),
        ...(policy && {
          policy: policy as NonNullable<GeneratorOptions['quality']>['policy'],
        }),
      }
    : undefined;
}

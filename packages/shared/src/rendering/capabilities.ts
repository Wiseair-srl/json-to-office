import {
  UnknownRendererError,
  UnsupportedRendererFeatureError,
  rendererError,
  type RendererDiagnostic,
} from './diagnostics';
import type { OfficeFormat, OfficeRenderer } from './types';

/**
 * Capability checking: what an IR *requires* versus what an adapter *provides*.
 *
 * A compiler records one `FeatureRequirement` each time it emits an IR node that
 * needs a backend capability. Before rendering, `assertRendererSupports` diffs
 * those requirements against the adapter's `capabilities` set and throws a
 * single aggregated `UnsupportedRendererFeatureError` if anything is missing.
 *
 * The point is that nothing is dropped silently: a feature either appears in the
 * adapter's capability set and is rendered, or it fails loudly before bytes are
 * produced.
 */

/** One capability an IR node needs, and where in the IR it was needed. */
export interface FeatureRequirement<TFeature extends string = string> {
  feature: TFeature;
  /** IR path, e.g. `sections[0].children[3].image`. */
  path: string;
  /** Optional detail folded into the failure message. */
  detail?: string;
}

/**
 * Accumulates feature requirements during compilation.
 *
 * Deliberately per-compilation (never module-global) so concurrent generations
 * never share state.
 */
export class FeatureRequirementCollector<TFeature extends string> {
  private readonly requirements: FeatureRequirement<TFeature>[] = [];
  private readonly seen = new Set<string>();

  /**
   * Record that `feature` is needed at `path`.
   *
   * Duplicate (feature, path) pairs collapse, so a compiler can call this
   * unconditionally inside a loop without inflating the diagnostics.
   */
  require(feature: TFeature, path: string, detail?: string): void {
    const key = `${feature}\u0000${path}`;
    if (this.seen.has(key)) return;
    this.seen.add(key);
    this.requirements.push(
      detail === undefined ? { feature, path } : { feature, path, detail }
    );
  }

  /** Every recorded requirement, in first-seen order. */
  list(): readonly FeatureRequirement<TFeature>[] {
    return this.requirements;
  }

  /** Distinct required features, in first-seen order. */
  features(): readonly TFeature[] {
    return [...new Set(this.requirements.map((r) => r.feature))];
  }

  /** True when nothing has been required yet. */
  isEmpty(): boolean {
    return this.requirements.length === 0;
  }
}

/**
 * Diff required features against a capability set.
 *
 * Returns one error-severity diagnostic per unsupported requirement. An empty
 * array means the renderer can render the IR.
 */
export function diagnoseUnsupportedFeatures<TFeature extends string>(
  required: readonly FeatureRequirement<TFeature>[],
  capabilities: ReadonlySet<TFeature>,
  rendererId: string
): RendererDiagnostic<TFeature>[] {
  const diagnostics: RendererDiagnostic<TFeature>[] = [];
  for (const requirement of required) {
    if (capabilities.has(requirement.feature)) continue;
    diagnostics.push(
      rendererError(
        requirement.feature,
        requirement.path,
        buildMessage(requirement, rendererId)
      )
    );
  }
  return diagnostics;
}

function buildMessage<TFeature extends string>(
  requirement: FeatureRequirement<TFeature>,
  rendererId: string
): string {
  const base = `the "${rendererId}" renderer cannot express "${requirement.feature}"`;
  return requirement.detail ? `${base} (${requirement.detail})` : base;
}

/**
 * Throw one aggregated error if the renderer is missing any required feature.
 *
 * Call this after compiling to IR and before handing the IR to an adapter.
 */
export function assertRendererSupports<TFeature extends string>(
  required: readonly FeatureRequirement<TFeature>[],
  renderer: Pick<
    OfficeRenderer<unknown, TFeature, string>,
    'id' | 'format' | 'capabilities'
  >
): void {
  const diagnostics = diagnoseUnsupportedFeatures(
    required,
    renderer.capabilities,
    renderer.id
  );
  if (diagnostics.length === 0) return;
  throw new UnsupportedRendererFeatureError<TFeature>({
    format: renderer.format,
    rendererId: renderer.id,
    diagnostics,
  });
}

/**
 * Whether a registered renderer can actually run on this host.
 *
 * Registration says a renderer exists; it says nothing about whether its
 * backend is installed, because the factory is only invoked on selection. A
 * discovery surface that reports the ids alone therefore advertises renderers
 * that fail at the first render — which is what `jto_info` and `jto_discover`
 * used to do for `office-open` on a host that never installed it.
 */
export interface RendererStatus<TId extends string = string> {
  id: TId;
  /** The one used when a caller passes no id. */
  default: boolean;
  available: boolean;
  /** Why not, when not — the message the load failure carried. */
  reason?: string;
  /** The command that would make it available. */
  installHint?: string;
}

/**
 * A registry of renderers for a single format.
 *
 * Instances are created per format module, not per generation, and hold only
 * immutable adapter descriptors — never per-document state.
 */
export class RendererRegistry<
  TIR,
  TFeature extends string,
  TId extends string,
> {
  private readonly renderers = new Map<
    TId,
    () => Promise<OfficeRenderer<TIR, TFeature, TId>>
  >();

  constructor(
    private readonly format: OfficeFormat,
    private readonly defaultId: TId
  ) {}

  /**
   * Register a lazily-constructed renderer.
   *
   * The factory is async and only invoked on selection, so choosing one
   * renderer never imports another one's backend.
   */
  register(
    id: TId,
    factory: () => Promise<OfficeRenderer<TIR, TFeature, TId>>
  ): void {
    this.renderers.set(id, factory);
    // The probe below is memoized over the registered set, so registering into
    // an already-probed registry has to drop it — otherwise `statuses()` keeps
    // answering with a list this renderer is missing from, forever. The
    // bundled registries register everything at module load and never reach
    // this, but the class is exported and a caller registering late should not
    // have to know that.
    this.statusCache = undefined;
  }

  /** Renderer ids registered for this format, in registration order. */
  ids(): readonly TId[] {
    return [...this.renderers.keys()];
  }

  /** The id used when a caller does not pass one. */
  getDefaultId(): TId {
    return this.defaultId;
  }

  has(id: string): id is TId {
    return this.renderers.has(id as TId);
  }

  /**
   * Resolve a renderer, defaulting when `id` is omitted.
   *
   * An unknown id is `UnknownRendererError`, which carries the id asked for and
   * the ones that exist, so a caller boundary can answer "bad request" rather
   * than "the server broke". A backend that will not load is re-thrown with an
   * actionable install hint.
   */
  async resolve(id?: TId): Promise<OfficeRenderer<TIR, TFeature, TId>> {
    const selected = id ?? this.defaultId;
    const factory = this.renderers.get(selected);
    if (!factory) {
      throw new UnknownRendererError(this.format, selected, this.ids());
    }
    try {
      return await factory();
    } catch (error) {
      throw enrichLoadFailure(error, this.format, selected);
    }
  }

  /**
   * Every registered renderer, with whether it can actually be loaded here.
   *
   * Answers the question by loading each one, which is the only answer that
   * cannot be wrong — a resolver check would still miss a backend that
   * resolves and then throws on import.
   *
   * Memoized, and the promise rather than its value, so concurrent callers
   * share one probe instead of racing several. Nothing installs a package into
   * a running process, so the answer cannot go stale within one; without this
   * `jto_validate` would pay a package import on every call, which is the tool
   * an agent uses after every edit.
   */
  statuses(): Promise<RendererStatus<TId>[]> {
    this.statusCache ??= this.probeStatuses();
    return this.statusCache;
  }

  private statusCache?: Promise<RendererStatus<TId>[]>;

  private async probeStatuses(): Promise<RendererStatus<TId>[]> {
    return Promise.all(
      this.ids().map(async (id) => {
        const base = { id, default: id === this.defaultId };
        try {
          await this.resolve(id);
          return { ...base, available: true };
        } catch (error) {
          const missing =
            error instanceof Error &&
            error.name === RENDERER_DEPENDENCY_MISSING;
          const pkg =
            missing && error instanceof Error
              ? (error as { packageName?: string }).packageName
              : undefined;
          return {
            ...base,
            available: false,
            reason: error instanceof Error ? error.message : String(error),
            ...(pkg ? { installHint: `pnpm add ${pkg}` } : {}),
          };
        }
      })
    );
  }
}

/**
 * Turn a bare module-resolution failure into something a user can act on.
 *
 * Optional backends are not installed by default, so the common failure here is
 * a missing package rather than a bug.
 */
function enrichLoadFailure(
  error: unknown,
  format: OfficeFormat,
  rendererId: string
): Error {
  const message = error instanceof Error ? error.message : String(error);
  const isMissingModule =
    /Cannot find (?:module|package)|ERR_MODULE_NOT_FOUND|Failed to resolve/i.test(
      message
    );
  if (!isMissingModule) {
    return error instanceof Error ? error : new Error(message);
  }
  const pkg = missingPackageName(message);
  const named = pkg ?? `the "${rendererId}" backend`;
  const enriched = new Error(
    `The "${rendererId}" ${format} renderer requires ${named}, which is not installed. ` +
      `Install it with: pnpm add ${named}\nOriginal error: ${message}`
  );
  enriched.name = RENDERER_DEPENDENCY_MISSING;
  // Carried separately from the message so a caller can build its own install
  // line rather than parsing one back out of English.
  if (pkg) (enriched as Error & { packageName?: string }).packageName = pkg;
  return enriched;
}

/**
 * `Error.name` marking a renderer whose optional backend is not installed.
 *
 * A name rather than a subclass: the error crosses a package boundary and an
 * `instanceof` there would depend on both sides loading the same copy of this
 * module, which under a workspace layout is not something to rely on.
 */
export const RENDERER_DEPENDENCY_MISSING = 'RendererDependencyMissingError';

function missingPackageName(message: string): string | undefined {
  const match =
    /Cannot find (?:module|package) ['"]([^'"]+)['"]/.exec(message) ??
    /Failed to resolve (?:module|import)[: ]+['"]?([^'"\s]+)/.exec(message);
  return match?.[1];
}

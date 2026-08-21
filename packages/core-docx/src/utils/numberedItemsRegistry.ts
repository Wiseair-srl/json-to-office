/**
 * Numbered Item Registry
 *
 * Cross-reference targets — numbered headings and list items — resolved by the
 * document-outline pre-pass and read back while rendering inline text.
 *
 * It is a registry rather than a field on `RenderContext` because the consumer
 * is `textParser`, which is reached through `createText`/`createHeading`/
 * `createList` and never sees the context.
 */

import { AsyncLocalStorage } from 'node:async_hooks';

export interface NumberedItemInfo {
  kind: 'heading' | 'list-item';
  /** Rendered text of the target, for a `:none` (text) reference. */
  text: string;
  /** Full multilevel number ("2.1.3"), absent when the target is unnumbered. */
  full?: string;
  /** The target's own level counter ("3"), absent when unnumbered. */
  own?: string;
}

interface NumberedItemsState {
  items: Map<string, NumberedItemInfo>;
  seeded: boolean;
}

export class NumberedItemsRegistry {
  private readonly fallback: NumberedItemsState = {
    items: new Map(),
    seeded: false,
  };
  private readonly scopes = new AsyncLocalStorage<NumberedItemsState>();

  private get state(): NumberedItemsState {
    return this.scopes.getStore() ?? this.fallback;
  }

  /** Run work with an isolated registry that follows its async call chain. */
  runScoped<T>(callback: () => T): T {
    return this.scopes.run({ items: new Map(), seeded: false }, callback);
  }

  /** Replace the contents with the pre-pass result. */
  seed(items: ReadonlyMap<string, NumberedItemInfo>): void {
    const state = this.state;
    state.items = new Map(items);
    state.seeded = true;
  }

  /**
   * False outside a render (a unit test calling `createText` directly). An
   * unresolved reference is then expected rather than an authoring mistake, so
   * the caller stays quiet about it.
   */
  isSeeded(): boolean {
    return this.state.seeded;
  }

  get(id: string): NumberedItemInfo | undefined {
    return this.state.items.get(id);
  }

  clear(): void {
    this.state.items.clear();
    this.state.seeded = false;
  }
}

export const globalNumberedItemsRegistry = new NumberedItemsRegistry();

/**
 * Minimal promise pool bounding concurrent async operations. Shared by the
 * visual rasterization paths (flattenVisuals, prerasterizeVisuals) to cap
 * concurrent service calls.
 */
export function createLimiter(
  max: number
): <T>(fn: () => Promise<T>) => Promise<T> {
  let active = 0;
  const queue: Array<() => void> = [];
  const release = () => {
    active--;
    queue.shift()?.();
  };
  return async function limit<T>(fn: () => Promise<T>): Promise<T> {
    // Re-check after waking: a caller arriving between release() and this
    // waiter's microtask could otherwise barge past the limit.
    while (active >= max)
      await new Promise<void>((resolve) => queue.push(resolve));
    active++;
    try {
      return await fn();
    } finally {
      release();
    }
  };
}

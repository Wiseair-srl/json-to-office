export interface RetryOptions {
  maxRetries?: number;
  initialDelay?: number;
  maxDelay?: number;
  backoffFactor?: number;
  onRetry?: (error: Error, attempt: number) => void;
  shouldRetry?: (error: Error) => boolean;
  signal?: AbortSignal;
}

export class RetryError extends Error {
  constructor(
    message: string,
    public readonly lastError: Error,
    public readonly attempts: number
  ) {
    super(message);
    this.name = 'RetryError';
  }
}

/**
 * Retry a function with exponential backoff
 */
export async function retry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const {
    maxRetries = 3,
    initialDelay = 1000,
    maxDelay = 30000,
    backoffFactor = 2,
    onRetry,
    shouldRetry = () => true,
    signal,
  } = options;

  let lastError: Error;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      // Check if operation was cancelled
      if (signal?.aborted) {
        throw new Error('Operation cancelled');
      }

      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      // Don't retry if it's the last attempt
      if (attempt === maxRetries) {
        break;
      }

      // Check if we should retry this error
      if (!shouldRetry(lastError)) {
        throw lastError;
      }

      // Calculate delay with exponential backoff
      const delay = Math.min(
        initialDelay * Math.pow(backoffFactor, attempt),
        maxDelay
      );

      // Add some jitter to prevent thundering herd
      const jitteredDelay = delay * (0.5 + Math.random() * 0.5);

      // Call retry callback if provided
      if (onRetry) {
        onRetry(lastError, attempt + 1);
      }

      // Wait before retrying
      await new Promise((resolve) => {
        const timeoutId = setTimeout(resolve, jitteredDelay);

        // Clean up timeout if cancelled
        if (signal) {
          signal.addEventListener(
            'abort',
            () => {
              clearTimeout(timeoutId);
              resolve(undefined);
            },
            { once: true }
          );
        }
      });
    }
  }

  throw new RetryError(
    `Failed after ${maxRetries + 1} attempts`,
    lastError!,
    maxRetries + 1
  );
}

/**
 * Retry decorator for class methods
 */
export function Retryable(options: RetryOptions = {}) {
  return function (
    _target: any,
    _propertyKey: string,
    descriptor: PropertyDescriptor
  ) {
    const originalMethod = descriptor.value;

    descriptor.value = async function (...args: any[]) {
      return retry(() => originalMethod.apply(this, args), options);
    };

    return descriptor;
  };
}

/**
 * Common retry strategies
 */
export const RetryStrategies = {
  // Retry on network errors
  networkErrors: (error: Error) => {
    const networkErrorPatterns = [
      'NetworkError',
      'Failed to fetch',
      'ERR_NETWORK',
      'ECONNREFUSED',
      'ETIMEDOUT',
      'ENOTFOUND',
      'fetch failed',
    ];

    return networkErrorPatterns.some(
      (pattern) =>
        error.message.includes(pattern) || error.name.includes(pattern)
    );
  },

  // Retry on specific HTTP status codes
  httpStatusCodes: (statusCodes: number[]) => (error: any) => {
    if (error.response?.status) {
      return statusCodes.includes(error.response.status);
    }
    return false;
  },

  // Retry on temporary errors
  temporaryErrors: (error: Error) => {
    const temporaryPatterns = [
      'EBUSY',
      'EAGAIN',
      'temporarily unavailable',
      'too many requests',
      'rate limit',
    ];

    return temporaryPatterns.some((pattern) =>
      error.message.toLowerCase().includes(pattern.toLowerCase())
    );
  },

  // Combine multiple strategies
  combine:
    (...strategies: ((error: Error) => boolean)[]) =>
    (error: Error) => {
      return strategies.some((strategy) => strategy(error));
    },
};

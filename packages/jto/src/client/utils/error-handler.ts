export interface ErrorContext {
  component?: string;
  action?: string;
  metadata?: Record<string, any>;
}

export class ApplicationError extends Error {
  public readonly code: string;
  public readonly context: ErrorContext;
  public readonly timestamp: Date;
  public readonly recoverable: boolean;

  constructor(
    message: string,
    code: string,
    context: ErrorContext = {},
    recoverable = true
  ) {
    super(message);
    this.name = 'ApplicationError';
    this.code = code;
    this.context = context;
    this.timestamp = new Date();
    this.recoverable = recoverable;
  }
}

export enum ErrorCode {
  // Worker errors
  WORKER_INIT_FAILED = 'WORKER_INIT_FAILED',
  WORKER_TIMEOUT = 'WORKER_TIMEOUT',
  WORKER_CRASHED = 'WORKER_CRASHED',

  // Presentation generation errors
  DOC_PARSE_ERROR = 'DOC_PARSE_ERROR',
  DOC_BUILD_ERROR = 'DOC_BUILD_ERROR',
  DOC_RENDER_ERROR = 'DOC_RENDER_ERROR',
  DOC_INVALID_SCHEMA = 'DOC_INVALID_SCHEMA',

  // Network errors
  NETWORK_ERROR = 'NETWORK_ERROR',
  UPLOAD_FAILED = 'UPLOAD_FAILED',
  API_ERROR = 'API_ERROR',

  // Resource errors
  MEMORY_LIMIT = 'MEMORY_LIMIT',
  STORAGE_QUOTA = 'STORAGE_QUOTA',

  // UI errors
  RENDER_ERROR = 'RENDER_ERROR',
  STATE_CORRUPTION = 'STATE_CORRUPTION',
}

export interface ErrorHandler {
  handle(error: Error, context?: ErrorContext): void;
  canRecover(error: Error): boolean;
  getRecoveryStrategy(error: Error): RecoveryStrategy | null;
}

export interface RecoveryStrategy {
  name: string;
  description: string;
  execute: () => Promise<boolean>;
}

class GlobalErrorHandler implements ErrorHandler {
  private errorCount = 0;
  private lastErrorTime = 0;
  private readonly ERROR_THRESHOLD = 5;
  private readonly ERROR_WINDOW = 60000; // 1 minute

  handle(error: Error, context: ErrorContext = {}): void {
    const now = Date.now();

    // Reset counter if outside error window
    if (now - this.lastErrorTime > this.ERROR_WINDOW) {
      this.errorCount = 0;
    }

    this.errorCount++;
    this.lastErrorTime = now;

    // Convert to ApplicationError if needed
    const appError =
      error instanceof ApplicationError
        ? error
        : this.wrapError(error, context);

    // Log error
    this.logError(appError);

    // Check if we're in an error storm
    if (this.errorCount >= this.ERROR_THRESHOLD) {
      console.error('Error storm detected! Application may be unstable.');
      this.handleErrorStorm();
    }

    // Report to monitoring service
    this.reportError(appError);

    // Attempt recovery if possible
    if (this.canRecover(appError)) {
      const strategy = this.getRecoveryStrategy(appError);
      if (strategy) {
        this.executeRecovery(strategy, appError);
      }
    }
  }

  canRecover(error: Error): boolean {
    if (error instanceof ApplicationError) {
      return error.recoverable;
    }

    // Check for known recoverable errors
    const recoverablePatterns = [
      'Worker',
      'Network',
      'timeout',
      'Failed to fetch',
      'memory',
    ];

    return recoverablePatterns.some((pattern) =>
      error.message.toLowerCase().includes(pattern.toLowerCase())
    );
  }

  getRecoveryStrategy(error: Error): RecoveryStrategy | null {
    const errorMessage = error.message.toLowerCase();
    const code = error instanceof ApplicationError ? error.code : '';

    // Worker recovery strategies
    if (errorMessage.includes('worker') || code.startsWith('WORKER_')) {
      return {
        name: 'Reinitialize Worker',
        description: 'Restart the presentation generation worker',
        execute: async () => {
          console.log('Attempting to reinitialize worker...');
          // Worker reinitialization logic would go here
          return true;
        },
      };
    }

    // Network recovery strategies
    if (
      errorMessage.includes('network') ||
      errorMessage.includes('fetch') ||
      code === ErrorCode.NETWORK_ERROR
    ) {
      return {
        name: 'Retry Request',
        description: 'Retry the failed network request',
        execute: async () => {
          console.log('Retrying network request...');
          // Network retry logic would go here
          return true;
        },
      };
    }

    // Memory recovery strategies
    if (errorMessage.includes('memory') || code === ErrorCode.MEMORY_LIMIT) {
      return {
        name: 'Clear Cache',
        description: 'Clear cached data to free up memory',
        execute: async () => {
          console.log('Clearing cache to free memory...');
          // Clear any caches
          if ('caches' in window) {
            const cacheNames = await caches.keys();
            await Promise.all(cacheNames.map((name) => caches.delete(name)));
          }
          return true;
        },
      };
    }

    return null;
  }

  private wrapError(error: Error, context: ErrorContext): ApplicationError {
    // Try to determine error code from error message
    let code = ErrorCode.RENDER_ERROR;
    const message = error.message.toLowerCase();

    if (message.includes('worker')) {
      code = ErrorCode.WORKER_CRASHED;
    } else if (message.includes('network') || message.includes('fetch')) {
      code = ErrorCode.NETWORK_ERROR;
    } else if (message.includes('parse') || message.includes('json')) {
      code = ErrorCode.DOC_PARSE_ERROR;
    } else if (message.includes('memory')) {
      code = ErrorCode.MEMORY_LIMIT;
    }

    return new ApplicationError(error.message, code, context);
  }

  private logError(error: ApplicationError): void {
    const logData = {
      timestamp: error.timestamp,
      code: error.code,
      message: error.message,
      context: error.context,
      recoverable: error.recoverable,
      errorCount: this.errorCount,
    };

    if (error.recoverable) {
      console.warn('Recoverable error:', logData);
    } else {
      console.error('Critical error:', logData);
    }
  }

  private reportError(_error: ApplicationError): void {
    // In production, send to error monitoring service
    if (!import.meta.env.DEV) {
      // Example: Sentry, LogRocket, etc.
      // window.Sentry?.captureException(error);
    }
  }

  private async executeRecovery(
    strategy: RecoveryStrategy,
    _error: ApplicationError
  ): Promise<void> {
    console.log(`Attempting recovery: ${strategy.name}`);

    try {
      const success = await strategy.execute();
      if (success) {
        console.log('Recovery successful');
        this.errorCount = Math.max(0, this.errorCount - 1);
      } else {
        console.warn('Recovery failed');
      }
    } catch (recoveryError) {
      console.error('Error during recovery:', recoveryError);
    }
  }

  private handleErrorStorm(): void {
    // Take drastic measures when too many errors occur
    console.error('Taking emergency measures due to error storm');

    // Clear all caches
    if ('caches' in window) {
      caches
        .keys()
        .then((names) => Promise.all(names.map((name) => caches.delete(name))));
    }

    // Clear session storage
    try {
      sessionStorage.clear();
    } catch (e) {
      console.error('Failed to clear session storage:', e);
    }

    // Show user a warning
    const shouldReload = window.confirm(
      'The application is experiencing multiple errors. Would you like to reload the page?'
    );

    if (shouldReload) {
      window.location.reload();
    }
  }
}

// Global error handler instance
export const errorHandler = new GlobalErrorHandler();

// Install global error handlers
export function installGlobalErrorHandlers(): void {
  // Handle unhandled promise rejections
  window.addEventListener('unhandledrejection', (event) => {
    console.error('Unhandled promise rejection:', event.reason);
    errorHandler.handle(
      new Error(event.reason?.message || 'Unhandled promise rejection'),
      { component: 'global', action: 'promise-rejection' }
    );
    event.preventDefault();
  });

  // Handle global errors
  window.addEventListener('error', (event) => {
    console.error('Global error:', event.error);
    errorHandler.handle(event.error || new Error(event.message), {
      component: 'global',
      action: 'window-error',
      metadata: {
        filename: event.filename,
        lineno: event.lineno,
        colno: event.colno,
      },
    });
    event.preventDefault();
  });
}

// React error boundary integration
export function handleErrorBoundaryError(
  error: Error,
  errorInfo: React.ErrorInfo,
  componentName?: string
): void {
  errorHandler.handle(error, {
    component: componentName || 'unknown',
    action: 'react-error-boundary',
    metadata: {
      componentStack: errorInfo.componentStack,
    },
  });
}

// Utility functions for common error scenarios
export function throwWorkerError(message: string, recoverable = true): never {
  throw new ApplicationError(
    message,
    ErrorCode.WORKER_CRASHED,
    { component: 'worker' },
    recoverable
  );
}

export function throwNetworkError(message: string, url?: string): never {
  throw new ApplicationError(
    message,
    ErrorCode.NETWORK_ERROR,
    { component: 'network', metadata: { url } },
    true
  );
}

export function throwDocumentError(
  message: string,
  stage: 'parse' | 'build' | 'render',
  documentName?: string
): never {
  const codeMap = {
    parse: ErrorCode.DOC_PARSE_ERROR,
    build: ErrorCode.DOC_BUILD_ERROR,
    render: ErrorCode.DOC_RENDER_ERROR,
  };

  throw new ApplicationError(
    message,
    codeMap[stage],
    {
      component: 'document-generation',
      action: stage,
      metadata: { documentName },
    },
    true
  );
}

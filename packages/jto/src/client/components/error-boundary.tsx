import React, { Component, ErrorInfo, ReactNode } from 'react';
import { AlertCircle, RefreshCw, Home, Bug } from 'lucide-react';
import { Button } from './ui/button';
import { Alert, AlertDescription, AlertTitle } from './ui/alert';

interface Props {
  children: ReactNode;
  fallback?: (
    error: Error,
    errorInfo: ErrorInfo,
    retry: () => void
  ) => ReactNode;
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
  isolate?: boolean;
  name?: string;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
  errorCount: number;
  lastErrorTime: number;
}

export class ErrorBoundary extends Component<Props, State> {
  private retryTimeoutId: NodeJS.Timeout | null = null;
  private readonly MAX_ERROR_COUNT = 3;
  private readonly ERROR_COUNT_RESET_TIME = 60000; // 1 minute

  constructor(props: Props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
      errorCount: 0,
      lastErrorTime: 0,
    };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return {
      hasError: true,
      error,
    };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    const now = Date.now();
    const { errorCount, lastErrorTime } = this.state;

    // Reset error count if enough time has passed
    const newErrorCount =
      now - lastErrorTime > this.ERROR_COUNT_RESET_TIME ? 1 : errorCount + 1;

    this.setState({
      errorInfo,
      errorCount: newErrorCount,
      lastErrorTime: now,
    });

    // Log error details
    console.error(
      `Error Boundary (${this.props.name || 'Unknown'}):`,
      error,
      errorInfo
    );

    // Call custom error handler if provided
    if (this.props.onError) {
      this.props.onError(error, errorInfo);
    }

    // Send error to monitoring service (if configured)
    this.reportError(error, errorInfo);
  }

  componentWillUnmount() {
    if (this.retryTimeoutId) {
      clearTimeout(this.retryTimeoutId);
    }
  }

  private reportError(error: Error, errorInfo: ErrorInfo) {
    // In production, this would send to an error monitoring service
    const errorReport = {
      message: error.message,
      stack: error.stack,
      componentStack: errorInfo.componentStack,
      name: this.props.name,
      timestamp: new Date().toISOString(),
      errorCount: this.state.errorCount,
    };

    // Log structured error for debugging
    console.error('Error Report:', errorReport);
  }

  private retry = () => {
    if (this.retryTimeoutId) {
      clearTimeout(this.retryTimeoutId);
    }

    // Prevent rapid retries
    this.retryTimeoutId = setTimeout(() => {
      this.setState({
        hasError: false,
        error: null,
        errorInfo: null,
      });
    }, 100);
  };

  private reload = () => {
    window.location.reload();
  };

  private goHome = () => {
    window.location.href = '/';
  };

  private getErrorMessage(error: Error): string {
    // Provide user-friendly error messages
    if (error.message.includes('Worker')) {
      return 'The presentation generation system encountered an error. Please try again.';
    }
    if (error.message.includes('Network')) {
      return 'Network connection error. Please check your internet connection.';
    }
    if (error.message.includes('chunk')) {
      return 'Failed to load application resources. Please refresh the page.';
    }
    if (error.message.includes('Permission')) {
      return 'Permission denied. Please check your access rights.';
    }

    return error.message || 'An unexpected error occurred';
  }

  render() {
    const { hasError, error, errorInfo, errorCount } = this.state;
    const { children, fallback, isolate } = this.props;

    if (hasError && error) {
      // Use custom fallback if provided
      if (fallback) {
        return <>{fallback(error, errorInfo!, this.retry)}</>;
      }

      // Check if we've exceeded the error threshold
      const exceedsThreshold = errorCount >= this.MAX_ERROR_COUNT;
      const errorMessage = this.getErrorMessage(error);

      // Default error UI
      return (
        <div
          className={`${isolate ? '' : 'min-h-screen'} flex items-center justify-center p-4`}
        >
          <div className="max-w-md w-full space-y-4">
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>
                {exceedsThreshold
                  ? 'Multiple Errors Detected'
                  : 'Something went wrong'}
              </AlertTitle>
              <AlertDescription>
                {exceedsThreshold
                  ? 'The application is experiencing repeated errors. Please refresh the page or contact support.'
                  : errorMessage}
              </AlertDescription>
            </Alert>

            <div className="flex gap-2 justify-center">
              {!exceedsThreshold && (
                <Button
                  onClick={this.retry}
                  variant="default"
                  size="sm"
                  className="gap-2"
                >
                  <RefreshCw className="h-4 w-4" />
                  Try Again
                </Button>
              )}

              <Button
                onClick={this.reload}
                variant={exceedsThreshold ? 'default' : 'outline'}
                size="sm"
                className="gap-2"
              >
                <RefreshCw className="h-4 w-4" />
                Refresh Page
              </Button>

              {!isolate && (
                <Button
                  onClick={this.goHome}
                  variant="outline"
                  size="sm"
                  className="gap-2"
                >
                  <Home className="h-4 w-4" />
                  Go Home
                </Button>
              )}
            </div>

            {/* Development mode: show error details */}
            {process.env.NODE_ENV === 'development' && (
              <details className="mt-4 p-3 bg-muted rounded-lg text-xs">
                <summary className="cursor-pointer font-medium flex items-center gap-2">
                  <Bug className="h-3 w-3" />
                  Error Details (Development Only)
                </summary>
                <pre className="mt-2 whitespace-pre-wrap break-words overflow-auto max-h-64">
                  {error.stack}
                  {errorInfo && (
                    <>
                      {'\n\nComponent Stack:'}
                      {errorInfo.componentStack}
                    </>
                  )}
                </pre>
              </details>
            )}
          </div>
        </div>
      );
    }

    return children;
  }
}

// Higher-order component for easier usage
export function withErrorBoundary<P extends object>(
  Component: React.ComponentType<P>,
  errorBoundaryProps?: Omit<Props, 'children'>
) {
  const WrappedComponent = (props: P) => (
    <ErrorBoundary {...errorBoundaryProps}>
      <Component {...props} />
    </ErrorBoundary>
  );

  WrappedComponent.displayName = `withErrorBoundary(${Component.displayName || Component.name})`;

  return WrappedComponent;
}

// Specialized error boundaries for different parts of the app
export const EditorErrorBoundary: React.FC<{ children: ReactNode }> = ({
  children,
}) => (
  <ErrorBoundary
    name="Editor"
    isolate
    fallback={(_error, _, retry) => (
      <div className="flex flex-col items-center justify-center h-full p-4">
        <Alert variant="destructive" className="max-w-md">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Editor Error</AlertTitle>
          <AlertDescription>
            The editor encountered an error. Your work has been saved.
          </AlertDescription>
        </Alert>
        <Button onClick={retry} className="mt-4" size="sm">
          Restart Editor
        </Button>
      </div>
    )}
  >
    {children}
  </ErrorBoundary>
);

export const PreviewErrorBoundary: React.FC<{ children: ReactNode }> = ({
  children,
}) => (
  <ErrorBoundary
    name="Preview"
    isolate
    fallback={(_error, _, retry) => (
      <div className="flex flex-col items-center justify-center h-full p-4">
        <Alert variant="destructive" className="max-w-md">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Preview Error</AlertTitle>
          <AlertDescription>
            Failed to render the document preview. Try using a different
            rendering library.
          </AlertDescription>
        </Alert>
        <Button onClick={retry} className="mt-4" size="sm">
          Retry Preview
        </Button>
      </div>
    )}
  >
    {children}
  </ErrorBoundary>
);

export const WorkerErrorBoundary: React.FC<{ children: ReactNode }> = ({
  children,
}) => (
  <ErrorBoundary
    name="Worker"
    isolate
    onError={(error) => {
      // Worker errors might need special handling
      if (
        error.message.includes('Worker') ||
        error.message.includes('SharedArrayBuffer')
      ) {
        console.error(
          'Worker initialization failed. Falling back to main thread processing.'
        );
      }
    }}
    fallback={(_error, _, retry) => (
      <div className="flex flex-col items-center justify-center h-full p-4">
        <Alert variant="destructive" className="max-w-md">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Worker Error</AlertTitle>
          <AlertDescription>
            Presentation generation failed. The system will attempt to recover
            automatically.
          </AlertDescription>
        </Alert>
        <Button onClick={retry} className="mt-4" size="sm">
          Reinitialize Worker
        </Button>
      </div>
    )}
  >
    {children}
  </ErrorBoundary>
);

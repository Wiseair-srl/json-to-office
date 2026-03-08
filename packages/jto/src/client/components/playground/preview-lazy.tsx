import { lazy, Suspense } from 'react';
import { Spinner } from '../ui/spinner';

// Lazy load the Preview component
const PreviewComponent = lazy(() =>
  import('./preview').then((module) => ({
    default: module.Preview,
  }))
);

export function PreviewLazy() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center h-full">
          <div className="text-center">
            <Spinner className="w-8 h-8 mx-auto mb-2" />
            <p className="text-sm text-muted-foreground">Loading preview...</p>
          </div>
        </div>
      }
    >
      <PreviewComponent />
    </Suspense>
  );
}

export { PreviewLazy as Preview };

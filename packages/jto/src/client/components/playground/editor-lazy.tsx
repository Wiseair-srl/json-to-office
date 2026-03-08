import { lazy, Suspense } from 'react';
import { Spinner } from '../ui/spinner';

// Lazy load the Editor component
const EditorComponent = lazy(() =>
  import('./editor').then((module) => ({
    default: module.Editor,
  }))
);

export function EditorLazy() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center h-full">
          <div className="text-center">
            <Spinner className="w-8 h-8 mx-auto mb-2" />
            <p className="text-sm text-muted-foreground">Loading editor...</p>
          </div>
        </div>
      }
    >
      <EditorComponent />
    </Suspense>
  );
}

export { EditorLazy as Editor };

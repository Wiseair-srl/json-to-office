import { lazy, Suspense } from 'react';
import { Spinner } from '../ui/spinner';

// Lazy load the Monaco editor component
const EditorMonacoJsonComponent = lazy(() =>
  import('./editor-monaco-json').then((module) => ({
    default: module.EditorMonacoJsonMemoized,
  }))
);

interface EditorMonacoJsonLazyProps {
  name: string;
  defaultValue: string;
  saveDocumentDebounceWait: number;
}

export function EditorMonacoJsonLazy(props: EditorMonacoJsonLazyProps) {
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
      <EditorMonacoJsonComponent {...props} />
    </Suspense>
  );
}

export { EditorMonacoJsonLazy as EditorMonacoJsonMemoized };

import { cn } from '@/lib/utils';
import { Spinner } from './spinner';
import { Skeleton } from './skeleton';

interface LoadingOverlayProps {
  isLoading: boolean;
  children: React.ReactNode;
  message?: string;
  className?: string;
}

export function LoadingOverlay({
  isLoading,
  children,
  message = 'Loading...',
  className,
}: LoadingOverlayProps) {
  return (
    <div className={cn('relative', className)}>
      {children}
      {isLoading && (
        <div className="absolute inset-0 bg-background/80 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="flex flex-col items-center gap-2">
            <Spinner size="lg" />
            <p className="text-sm text-muted-foreground">{message}</p>
          </div>
        </div>
      )}
    </div>
  );
}

interface DocumentGenerationLoaderProps {
  className?: string;
  currentStage?: 'parsing' | 'building' | 'rendering' | 'finalizing';
  message?: string;
}

export function DocumentGenerationLoader({
  className,
  currentStage = 'parsing',
  message,
}: DocumentGenerationLoaderProps) {
  const stages = ['parsing', 'building', 'rendering', 'finalizing'];
  const stageLabels = {
    parsing: 'Validating JSON',
    building: 'Building structure',
    rendering: 'Rendering content',
    finalizing: 'Finalizing document',
  };

  const currentStageIndex = stages.indexOf(currentStage);

  return (
    <div className={cn('p-6 space-y-4', className)}>
      <div className="flex items-center gap-3">
        <Spinner size="md" />
        <div className="space-y-1">
          <p className="text-sm font-medium">Generating Document</p>
          <p className="text-xs text-muted-foreground">
            {message || `${stageLabels[currentStage]}...`}
          </p>
        </div>
      </div>

      <div className="space-y-3">
        {stages.map((stage, index) => {
          const isActive = index === currentStageIndex;
          const isCompleted = index < currentStageIndex;
          return (
            <div key={stage} className="space-y-2">
              <div className="flex justify-between text-xs">
                <span
                  className={cn(
                    isActive
                      ? 'text-primary font-medium'
                      : isCompleted
                        ? 'text-muted-foreground'
                        : 'text-muted-foreground/60'
                  )}
                >
                  {stageLabels[stage as keyof typeof stageLabels]}
                </span>
                <span className="text-muted-foreground">
                  {isCompleted ? '✓' : isActive ? '...' : '○'}
                </span>
              </div>
              <div className="w-full bg-secondary rounded-full h-1.5">
                <div
                  className={cn(
                    'h-1.5 rounded-full transition-all duration-300',
                    isCompleted
                      ? 'bg-green-500'
                      : isActive
                        ? 'bg-primary animate-pulse'
                        : 'bg-transparent'
                  )}
                  style={{
                    width: isCompleted ? '100%' : isActive ? '100%' : '0%',
                  }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

interface PreviewLoadingProps {
  renderingLibrary?: string;
  className?: string;
}

export function PreviewLoading({
  renderingLibrary,
  className,
}: PreviewLoadingProps) {
  const getLibraryInfo = (library?: string) => {
    switch (library) {
      case 'LibreOffice':
        return {
          name: 'LibreOffice',
          description: 'Converting document to PDF locally...',
        };
      case 'Office':
        return {
          name: 'Microsoft Office',
          description: 'Uploading file and loading Office viewer...',
        };
      case 'Docs':
        return {
          name: 'Google Docs',
          description: 'Uploading file and loading Docs viewer...',
        };
      default:
        return { name: 'Default', description: 'Processing document...' };
    }
  };

  const { name, description } = getLibraryInfo(renderingLibrary);

  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center h-full p-8 space-y-4',
        className
      )}
    >
      <Spinner size="lg" />
      <div className="text-center space-y-2">
        <p className="text-sm font-medium">Rendering Preview</p>
        <p className="text-xs text-muted-foreground">Using {name} renderer</p>
        <p className="text-xs text-muted-foreground/80">{description}</p>
      </div>

      <div className="w-full max-w-md space-y-3">
        <Skeleton className="h-16 w-full" />
        <div className="space-y-2">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-4 w-1/2" />
        </div>
        <Skeleton className="h-12 w-full" />
      </div>
    </div>
  );
}

interface InlineLoaderProps {
  message?: string;
  size?: 'sm' | 'md';
  className?: string;
}

export function InlineLoader({
  message = 'Loading...',
  size = 'sm',
  className,
}: InlineLoaderProps) {
  return (
    <div className={cn('flex items-center gap-2', className)}>
      <Spinner size={size} />
      <span className="text-sm text-muted-foreground">{message}</span>
    </div>
  );
}

interface FileOperationLoaderProps {
  operation: 'upload' | 'download' | 'save' | 'delete';
  fileName?: string;
  progress?: number;
  className?: string;
}

export function FileOperationLoader({
  operation,
  fileName,
  progress,
  className,
}: FileOperationLoaderProps) {
  const operationLabels = {
    upload: 'Uploading',
    download: 'Downloading',
    save: 'Saving',
    delete: 'Deleting',
  };

  return (
    <div
      className={cn(
        'flex items-center gap-3 p-3 border rounded-lg bg-muted/50',
        className
      )}
    >
      <Spinner size="sm" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">
          {operationLabels[operation]} {fileName && `"${fileName}"`}
        </p>
        {progress !== undefined && (
          <div className="mt-1">
            <div className="flex justify-between text-xs mb-1">
              <span>{progress}%</span>
              <span className="text-muted-foreground">
                {progress < 100 ? 'In progress...' : 'Complete'}
              </span>
            </div>
            <div className="w-full bg-secondary rounded-full h-1.5">
              <div
                className="bg-primary h-1.5 rounded-full transition-all duration-300"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

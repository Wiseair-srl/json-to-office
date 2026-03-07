export interface GenerationWarning {
  component: string;
  message: string;
  severity?: 'warning' | 'info';
  context?: Record<string, unknown>;
}

export type AddWarningFunction = (
  message: string,
  context?: Record<string, unknown>
) => void;

export interface ValidationError {
  path: string;
  message: string;
  code?: string;
  value?: unknown;
  suggestion?: string;
  line?: number;
  column?: number;
}

export interface ValidationResult {
  valid: boolean;
  errors?: ValidationError[];
}

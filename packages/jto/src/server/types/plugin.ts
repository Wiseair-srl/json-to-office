export interface ValidationResult {
  valid: boolean;
  errors?: ValidationError[];
}

export interface ValidationError {
  path: string;
  message: string;
  code?: string;
}

export interface BufferGenerationResult {
  buffer: Buffer;
  warnings: any[] | null;
}

export interface PluginAwareGenerator {
  validate(config: any): ValidationResult;
  generateBuffer(config: any): Promise<BufferGenerationResult>;
  getStandardComponentsDefinition(config: any): Promise<any>;
}

export function isCustomComponent(component: unknown): boolean {
  if (
    typeof component !== 'object' ||
    component === null ||
    !('name' in component) ||
    typeof (component as any).name !== 'string'
  ) {
    return false;
  }

  const versions = (component as any).versions;
  if (versions && typeof versions === 'object') {
    const entries = Object.values(versions);
    return (
      entries.length > 0 &&
      entries.some(
        (entry: any) =>
          entry &&
          typeof entry === 'object' &&
          entry.propsSchema &&
          typeof entry.propsSchema === 'object' &&
          typeof entry.render === 'function'
      )
    );
  }

  return false;
}

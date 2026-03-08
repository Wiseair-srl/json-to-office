declare module 'constrained-editor-plugin' {
  export interface RangeRestrictionObject {
    range: [number, number];
    label?: string;
    validate?: (value: string) => boolean;
  }

  export function constrainedEditor(monaco: any): {
    initializeIn: (editor: any) => void;
  };
}

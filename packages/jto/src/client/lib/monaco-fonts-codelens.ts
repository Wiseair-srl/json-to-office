/**
 * Registers a Monaco CodeLens provider for the JSON language that emits a
 * "Pick font…" lens above any string value whose property key names a font.
 * Clicking the lens opens the FontPickerDialog in contextual mode, where the
 * target path is pre-filled so the user only has to pick a family.
 *
 * Registration happens once at app boot from monaco-config.ts. The command
 * handler (jto.pickFont) dispatches to the global font-picker-store so the
 * dialog's open state stays in a single place.
 */
import type { Monaco } from '@monaco-editor/react';
import { scanFontLenses } from './font-lens-scan';
import { useFontPickerStore } from '../store/font-picker-store';

const CODELENS_COMMAND_ID = 'jto.pickFont';

let providerDisposable: { dispose(): void } | null = null;
let commandDisposable: { dispose(): void } | null = null;

export function registerFontCodeLens(monaco: Monaco): void {
  if (providerDisposable) providerDisposable.dispose();
  if (commandDisposable) commandDisposable.dispose();

  commandDisposable = monaco.editor.registerCommand(
    CODELENS_COMMAND_ID,
    (_accessor, path: (string | number)[], currentValue: string) => {
      useFontPickerStore.getState().openFor({ jsonPath: path, currentValue });
    }
  );

  providerDisposable = monaco.languages.registerCodeLensProvider('json', {
    provideCodeLenses(model) {
      const text = model.getValue();
      const lenses = scanFontLenses(text);
      return {
        lenses: lenses.map((lens) => {
          const startPos = model.getPositionAt(lens.valueStart);
          const endPos = model.getPositionAt(lens.valueEnd);
          return {
            range: {
              startLineNumber: startPos.lineNumber,
              startColumn: startPos.column,
              endLineNumber: endPos.lineNumber,
              endColumn: endPos.column,
            },
            id: `jto-pick-font-${lens.valueStart}`,
            command: {
              id: CODELENS_COMMAND_ID,
              title: lens.value
                ? `Pick font… (current: ${lens.value})`
                : 'Pick font…',
              arguments: [lens.path, lens.value],
            },
          };
        }),
        dispose: () => {},
      };
    },
    resolveCodeLens(_model, codeLens) {
      return codeLens;
    },
  });
}

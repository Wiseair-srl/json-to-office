/**
 * Lightweight global store tracking the FontPickerDialog's open state and,
 * when opened via Monaco CodeLens, the target JSON path the picker should
 * write to. `contextual === undefined` means theme-mode (the existing entry
 * point from the preview header menu — writes go to theme.fonts.heading/body).
 */
import { create } from 'zustand';

export interface FontPickerContext {
  /** JSON path within the active document to write the chosen family to. */
  jsonPath: (string | number)[];
  /** Value at that path when the picker opened, for pre-selection UX. */
  currentValue?: string;
}

interface FontPickerState {
  open: boolean;
  contextual?: FontPickerContext;
}

interface FontPickerActions {
  openFor: (contextual?: FontPickerContext) => void;
  close: () => void;
}

export type FontPickerStore = FontPickerState & FontPickerActions;

export const useFontPickerStore = create<FontPickerStore>((set) => ({
  open: false,
  contextual: undefined,
  openFor: (contextual) => set({ open: true, contextual }),
  close: () => set({ open: false, contextual: undefined }),
}));

import { devtools } from 'zustand/middleware';
import { createStore } from 'zustand/vanilla';

export interface GenerationWarning {
  component: string;
  message: string;
  severity?: 'warning' | 'info';
  context?: Record<string, unknown>;
}

/** One embedded font variant returned from /generate so previews can render it. */
export interface EmbeddedFontVariant {
  family: string;
  weight: number;
  italic: boolean;
  format: 'ttf' | 'otf' | 'woff' | 'woff2' | 'eot' | 'unknown';
  /** Base64 of the font bytes — lean enough to keep in memory per preview. */
  data: string;
}

export type OutputState = {
  name?: string; // last success => document name
  text?: string; // last success => code used to generate the document
  blob?: Blob; // last success => generated document
  fonts?: EmbeddedFontVariant[]; // embedded fonts for browser-preview @font-face injection
  globalError?: string; // last failed => global error message
  isGenerating?: boolean; // document generation in progress
  generationProgress?: {
    stage: 'parsing' | 'building' | 'rendering' | 'finalizing';
    message?: string;
  };
  cacheStatus?: 'HIT' | 'MISS' | 'UNKNOWN'; // cache hit/miss status
  cacheHitRate?: string; // cache hit rate percentage
  warnings?: GenerationWarning[] | null; // warnings from custom component processing
  isRendering?: boolean; // preview rendering in progress (iframe/LibreOffice)
  isPreviewStale?: boolean; // preview outdated (new blob generated but not yet rendered)
  editSequence?: number; // incremented on every Monaco keystroke (init 0)
  lastBuiltSequence?: number; // stamped when generation completes (init 0)
  editTimestamp?: number; // Date.now() of the last edit (for debounce countdown)
  hasValidationErrors?: boolean; // true when Monaco reports schema validation errors
  // ⚠️ name doesn't necessarily correspond to the global error message
};

export type OutputActions = {
  setOutput: (partialState: OutputState) => void;
  bumpEditSequence: () => void;
};

export type OutputStore = OutputState & OutputActions;

export const initOutputStore = (): OutputState => {
  return {
    name: undefined,
    text: undefined,
    blob: undefined,
    globalError: undefined,
    isGenerating: false,
    generationProgress: undefined,
    isRendering: false,
    isPreviewStale: false,
    editSequence: 0,
    lastBuiltSequence: 0,
    hasValidationErrors: false,
  };
};

export const defaultInitOutputState: OutputState = {
  ...initOutputStore(),
};

export const createOutputStore = (
  initState: OutputState = defaultInitOutputState
) => {
  return createStore<OutputStore>()(
    devtools((set) => ({
      ...initState,
      setOutput: (partialState) => set({ ...partialState }),
      bumpEditSequence: () =>
        set((s) => ({
          editSequence: (s.editSequence ?? 0) + 1,
          editTimestamp: Date.now(),
        })),
    }))
  );
};

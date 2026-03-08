import { devtools } from 'zustand/middleware';
import { createStore } from 'zustand/vanilla';

export interface GenerationWarning {
  component: string;
  message: string;
  severity?: 'warning' | 'info';
  context?: Record<string, unknown>;
}

export type OutputState = {
  name?: string; // last success => document name
  text?: string; // last success => code used to generate the pptx
  blob?: Blob; // last success => generated pptx
  globalError?: string; // last failed => global error message
  isGenerating?: boolean; // presentation generation in progress
  generationProgress?: {
    stage: 'parsing' | 'building' | 'rendering' | 'finalizing';
    message?: string;
  };
  cacheStatus?: 'HIT' | 'MISS' | 'UNKNOWN'; // cache hit/miss status
  cacheHitRate?: string; // cache hit rate percentage
  warnings?: GenerationWarning[] | null; // warnings from custom component processing
  // ⚠️ name doesn't necessarily correspond to the global error message
};

export type OutputActions = {
  setOutput: (partialState: OutputState) => void;
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
    }))
  );
};

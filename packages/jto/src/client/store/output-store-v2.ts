import { devtools } from 'zustand/middleware';
import { createStore } from 'zustand/vanilla';
import {
  StateMachine,
  DocumentGenerationState,
  DocumentGenerationEvent,
  DocumentGenerationContext,
  PreviewRenderState,
  PreviewRenderEvent,
  PreviewRenderContext,
  StateMachineConfig,
} from '../utils/state-machine';

// Document Generation State Machine Configuration
const documentGenerationConfig: StateMachineConfig<
  DocumentGenerationState,
  DocumentGenerationEvent,
  DocumentGenerationContext
> = {
  initial: 'idle',
  context: {
    documentName: undefined,
    documentText: undefined,
    blob: undefined,
    error: undefined,
    progress: undefined,
  },
  states: {
    idle: {
      on: {
        START: {
          target: 'preparing',
          action: (context) => {
            context.error = undefined;
            context.blob = undefined;
          },
        },
      },
    },
    preparing: {
      entry: (context) => {
        context.progress = {
          stage: 'preparing',
          message: 'Initializing presentation generation...',
        };
      },
      on: {
        PREPARE_COMPLETE: 'parsing',
        ERROR: {
          target: 'error',
          action: (context) => {
            context.progress = undefined;
          },
        },
      },
    },
    parsing: {
      entry: (context) => {
        context.progress = {
          stage: 'parsing',
          message: 'Validating JSON structure...',
        };
      },
      on: {
        PARSE_COMPLETE: 'building',
        ERROR: {
          target: 'error',
          action: (context) => {
            context.progress = undefined;
          },
        },
      },
    },
    building: {
      entry: (context) => {
        context.progress = {
          stage: 'building',
          message: 'Building presentation structure...',
        };
      },
      on: {
        BUILD_COMPLETE: 'rendering',
        ERROR: {
          target: 'error',
          action: (context) => {
            context.progress = undefined;
          },
        },
      },
    },
    rendering: {
      entry: (context) => {
        context.progress = {
          stage: 'rendering',
          message: 'Rendering presentation content...',
        };
      },
      on: {
        RENDER_COMPLETE: 'finalizing',
        ERROR: {
          target: 'error',
          action: (context) => {
            context.progress = undefined;
          },
        },
      },
    },
    finalizing: {
      entry: (context) => {
        context.progress = {
          stage: 'finalizing',
          message: 'Finalizing presentation...',
        };
      },
      on: {
        FINALIZE_COMPLETE: {
          target: 'completed',
          action: (context) => {
            context.progress = undefined;
          },
        },
        ERROR: {
          target: 'error',
          action: (context) => {
            context.progress = undefined;
          },
        },
      },
    },
    completed: {
      entry: (context) => {
        context.error = undefined;
        context.progress = undefined;
      },
      on: {
        START: 'preparing',
        RESET: 'idle',
      },
    },
    error: {
      entry: (context) => {
        context.progress = undefined;
      },
      on: {
        START: 'preparing',
        RESET: 'idle',
      },
    },
  },
};

// Preview Render State Machine Configuration
const previewRenderConfig: StateMachineConfig<
  PreviewRenderState,
  PreviewRenderEvent,
  PreviewRenderContext
> = {
  initial: 'idle',
  context: {
    documentName: undefined,
    blob: undefined,
    iframeSrc: undefined,
    error: undefined,
    retryCount: 0,
  },
  states: {
    idle: {
      on: {
        QUEUE: {
          target: 'queued',
          action: (context) => {
            context.error = undefined;
          },
        },
      },
    },
    queued: {
      on: {
        START_RENDER: 'rendering',
        CANCEL: 'idle',
      },
    },
    rendering: {
      on: {
        RENDER_SUCCESS: {
          target: 'completed',
          action: (context) => {
            context.retryCount = 0;
            context.error = undefined;
          },
        },
        RENDER_ERROR: {
          target: 'error',
          action: (context) => {
            context.retryCount++;
          },
        },
        CANCEL: 'idle',
      },
    },
    completed: {
      on: {
        QUEUE: 'queued',
        RESET: 'idle',
      },
    },
    error: {
      on: {
        QUEUE: {
          target: 'queued',
          guard: (context) => context.retryCount < 3,
        },
        RESET: {
          target: 'idle',
          action: (context) => {
            context.retryCount = 0;
          },
        },
      },
    },
  },
};

export type OutputStateV2 = {
  // Presentation generation state machine
  generationMachine: StateMachine<
    DocumentGenerationState,
    DocumentGenerationEvent,
    DocumentGenerationContext
  >;

  // Preview rendering state machine
  renderMachine: StateMachine<
    PreviewRenderState,
    PreviewRenderEvent,
    PreviewRenderContext
  >;

  // Current state
  globalError?: string;
};

export type OutputActionsV2 = {
  // Presentation generation actions
  startGeneration: (name: string, text: string) => void;
  updateGenerationProgress: (
    stage: DocumentGenerationState,
    message?: string
  ) => void;
  completeGeneration: (blob: Blob) => void;
  failGeneration: (error: string) => void;

  // Preview rendering actions
  queueRender: (name: string, blob: Blob) => void;
  startRender: () => void;
  completeRender: (iframeSrc?: string) => void;
  failRender: (error: string) => void;

  // General actions
  reset: () => void;
  setError: (error?: string) => void;
};

export type OutputStoreV2 = OutputStateV2 & OutputActionsV2;

export const createOutputStoreV2 = () => {
  const generationMachine = new StateMachine(documentGenerationConfig);
  const renderMachine = new StateMachine(previewRenderConfig);

  return createStore<OutputStoreV2>()(
    devtools((set, get) => ({
      generationMachine,
      renderMachine,

      // State
      globalError: undefined,

      // Subscribe to state machines for error handling
      _init: (() => {
        generationMachine.subscribe((state, context) => {
          if (state === 'error') {
            set({ globalError: context.error });
          }
        });

        renderMachine.subscribe((state, context) => {
          if (state === 'error') {
            set({ globalError: context.error });
          }
        });
      })(),

      // Presentation generation actions
      startGeneration: (name: string, text: string) => {
        const machine = get().generationMachine;
        machine.updateContext({ documentName: name, documentText: text });
        machine.send('START');
      },

      updateGenerationProgress: (
        stage: DocumentGenerationState,
        message?: string
      ) => {
        const machine = get().generationMachine;
        const eventMap: Record<
          DocumentGenerationState,
          DocumentGenerationEvent
        > = {
          preparing: 'PREPARE_COMPLETE',
          parsing: 'PARSE_COMPLETE',
          building: 'BUILD_COMPLETE',
          rendering: 'RENDER_COMPLETE',
          finalizing: 'FINALIZE_COMPLETE',
          idle: 'RESET',
          completed: 'RESET',
          error: 'ERROR',
        };

        if (message) {
          machine.updateContext({ progress: { stage, message } });
        }

        const event = eventMap[stage];
        if (event && machine.can(event)) {
          machine.send(event);
        }
      },

      completeGeneration: (blob: Blob) => {
        const machine = get().generationMachine;
        machine.updateContext({ blob });
        machine.send('FINALIZE_COMPLETE');
      },

      failGeneration: (error: string) => {
        const machine = get().generationMachine;
        machine.updateContext({ error });
        machine.send('ERROR');
      },

      // Preview rendering actions
      queueRender: (name: string, blob: Blob) => {
        const machine = get().renderMachine;
        machine.updateContext({
          documentName: name,
          blob,
        });
        machine.send('QUEUE');
      },

      startRender: () => {
        const machine = get().renderMachine;
        machine.send('START_RENDER');
      },

      completeRender: (iframeSrc?: string) => {
        const machine = get().renderMachine;
        machine.updateContext({ iframeSrc });
        machine.send('RENDER_SUCCESS');
      },

      failRender: (error: string) => {
        const machine = get().renderMachine;
        machine.updateContext({ error });
        machine.send('RENDER_ERROR');
      },

      // General actions
      reset: () => {
        get().generationMachine.reset();
        get().renderMachine.reset();
        set({
          globalError: undefined,
        });
      },

      setError: (error?: string) => {
        set({ globalError: error });
      },
    }))
  );
};

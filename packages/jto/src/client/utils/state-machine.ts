export type StateTransition<TState extends string, TEvent extends string> = {
  from: TState | TState[];
  event: TEvent;
  to: TState;
  guard?: () => boolean;
  action?: () => void | Promise<void>;
};

export type StateMachineConfig<
  TState extends string,
  TEvent extends string,
  TContext = any,
> = {
  initial: TState;
  states: Record<
    TState,
    {
      entry?: (context: TContext) => void | Promise<void>;
      exit?: (context: TContext) => void | Promise<void>;
      on?: Partial<
        Record<
          TEvent,
          | TState
          | {
              target: TState;
              guard?: (context: TContext) => boolean;
              action?: (context: TContext) => void | Promise<void>;
            }
        >
      >;
    }
  >;
  context?: TContext;
};

export class StateMachine<
  TState extends string,
  TEvent extends string,
  TContext = any,
> {
  private currentState: TState;
  private config: StateMachineConfig<TState, TEvent, TContext>;
  private context: TContext;
  private listeners: Set<(state: TState, context: TContext) => void> =
    new Set();
  private transitionInProgress = false;

  constructor(config: StateMachineConfig<TState, TEvent, TContext>) {
    this.config = config;
    this.currentState = config.initial;
    this.context = config.context || ({} as TContext);

    // Execute initial state entry action
    const initialStateConfig = this.config.states[this.currentState];
    if (initialStateConfig?.entry) {
      Promise.resolve(initialStateConfig.entry(this.context)).catch(
        console.error
      );
    }
  }

  get state(): TState {
    return this.currentState;
  }

  get value(): TContext {
    return this.context;
  }

  async send(event: TEvent): Promise<boolean> {
    if (this.transitionInProgress) {
      console.warn(
        `State machine: Transition already in progress, ignoring event: ${event}`
      );
      return false;
    }

    const stateConfig = this.config.states[this.currentState];
    if (!stateConfig?.on || !stateConfig.on[event]) {
      console.warn(
        `State machine: No transition for event '${event}' from state '${this.currentState}'`
      );
      return false;
    }

    const transition = stateConfig.on[event];
    if (!transition) {
      console.warn(
        `State machine: No transition defined for event '${event}' from state '${this.currentState}'`
      );
      return false;
    }

    const targetState =
      typeof transition === 'string' ? transition : transition.target;
    const guard = typeof transition === 'object' ? transition.guard : undefined;
    const action =
      typeof transition === 'object' ? transition.action : undefined;

    // Check guard condition
    if (guard && !guard(this.context)) {
      console.log(
        `State machine: Guard prevented transition from '${this.currentState}' to '${targetState}'`
      );
      return false;
    }

    this.transitionInProgress = true;

    try {
      // Execute exit action of current state
      if (stateConfig.exit) {
        await Promise.resolve(stateConfig.exit(this.context));
      }

      // Execute transition action
      if (action) {
        await Promise.resolve(action(this.context));
      }

      const previousState = this.currentState;
      this.currentState = targetState as TState;

      // Execute entry action of new state
      const newStateConfig = this.config.states[this.currentState];
      if (newStateConfig?.entry) {
        await Promise.resolve(newStateConfig.entry(this.context));
      }

      console.log(
        `State machine: Transitioned from '${previousState}' to '${this.currentState}' on event '${event}'`
      );

      // Notify listeners
      this.notifyListeners();

      return true;
    } catch (error) {
      console.error(`State machine: Error during transition:`, error);
      return false;
    } finally {
      this.transitionInProgress = false;
    }
  }

  updateContext(
    updater: Partial<TContext> | ((context: TContext) => Partial<TContext>)
  ): void {
    if (typeof updater === 'function') {
      this.context = { ...this.context, ...updater(this.context) };
    } else {
      this.context = { ...this.context, ...updater };
    }
    this.notifyListeners();
  }

  subscribe(listener: (state: TState, context: TContext) => void): () => void {
    this.listeners.add(listener);
    // Immediately call listener with current state
    listener(this.currentState, this.context);

    // Return unsubscribe function
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notifyListeners(): void {
    this.listeners.forEach((listener) => {
      try {
        listener(this.currentState, this.context);
      } catch (error) {
        console.error('State machine: Error in listener:', error);
      }
    });
  }

  can(event: TEvent): boolean {
    const stateConfig = this.config.states[this.currentState];
    if (!stateConfig?.on || !stateConfig.on[event]) {
      return false;
    }

    const transition = stateConfig.on[event];
    const guard = typeof transition === 'object' ? transition.guard : undefined;

    return !guard || guard(this.context);
  }

  reset(): void {
    const stateConfig = this.config.states[this.currentState];
    if (stateConfig?.exit) {
      Promise.resolve(stateConfig.exit(this.context)).catch(console.error);
    }

    this.currentState = this.config.initial;
    this.context = this.config.context || ({} as TContext);

    const initialStateConfig = this.config.states[this.currentState];
    if (initialStateConfig?.entry) {
      Promise.resolve(initialStateConfig.entry(this.context)).catch(
        console.error
      );
    }

    this.notifyListeners();
  }
}

// Presentation generation state machine types
export type DocumentGenerationState =
  | 'idle'
  | 'preparing'
  | 'parsing'
  | 'building'
  | 'rendering'
  | 'finalizing'
  | 'completed'
  | 'error';

export type DocumentGenerationEvent =
  | 'START'
  | 'PREPARE_COMPLETE'
  | 'PARSE_COMPLETE'
  | 'BUILD_COMPLETE'
  | 'RENDER_COMPLETE'
  | 'FINALIZE_COMPLETE'
  | 'ERROR'
  | 'RESET';

export interface DocumentGenerationContext {
  documentName?: string;
  documentText?: string;
  blob?: Blob;
  error?: string;
  progress?: {
    stage: string;
    message?: string;
  };
}

// Preview rendering state machine types
export type PreviewRenderState =
  | 'idle'
  | 'queued'
  | 'rendering'
  | 'completed'
  | 'error';

export type PreviewRenderEvent =
  | 'QUEUE'
  | 'START_RENDER'
  | 'RENDER_SUCCESS'
  | 'RENDER_ERROR'
  | 'CANCEL'
  | 'RESET';

export interface PreviewRenderContext {
  documentName?: string;
  blob?: Blob;
  iframeSrc?: string;
  error?: string;
  retryCount: number;
}

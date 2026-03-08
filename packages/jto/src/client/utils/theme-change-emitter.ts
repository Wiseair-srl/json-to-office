// Theme change event emitter for coordinating theme updates across components
export interface ThemeChangeEvent {
  themeName: string;
  timestamp: number;
  changeType: 'create' | 'update' | 'delete';
}

export class ThemeChangeEmitter extends EventTarget {
  private static instance: ThemeChangeEmitter;

  private constructor() {
    super();
  }

  static getInstance(): ThemeChangeEmitter {
    if (!ThemeChangeEmitter.instance) {
      ThemeChangeEmitter.instance = new ThemeChangeEmitter();
    }
    return ThemeChangeEmitter.instance;
  }

  emitThemeChange(event: ThemeChangeEvent): void {
    this.dispatchEvent(new CustomEvent('themechange', { detail: event }));
  }

  onThemeChange(callback: (event: ThemeChangeEvent) => void): () => void {
    const handler = (e: Event) => {
      const customEvent = e as CustomEvent<ThemeChangeEvent>;
      callback(customEvent.detail);
    };

    this.addEventListener('themechange', handler);

    // Track listener count
    (this as any)._listenerCount = ((this as any)._listenerCount || 0) + 1;

    // Return unsubscribe function
    return () => {
      this.removeEventListener('themechange', handler);
      (this as any)._listenerCount = Math.max(
        0,
        ((this as any)._listenerCount || 1) - 1
      );
    };
  }
}

export const themeChangeEmitter = ThemeChangeEmitter.getInstance();

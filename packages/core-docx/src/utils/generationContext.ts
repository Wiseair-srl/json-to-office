import { AsyncLocalStorage } from 'node:async_hooks';

const generationDateStorage = new AsyncLocalStorage<Date>();

/** Scope render-time values without leaking them across concurrent documents. */
export function runWithGenerationDate<T>(date: Date, callback: () => T): T {
  return generationDateStorage.run(date, callback);
}

/** Current document date, falling back to the wall clock outside generation. */
export function getGenerationDate(): Date {
  return generationDateStorage.getStore() ?? new Date();
}

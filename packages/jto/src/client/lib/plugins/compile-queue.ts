/**
 * The compile schedule for plugin files.
 *
 * The sync hook debounces compiles behind the editor; Run cannot wait for a
 * debounce it does not know about, so the schedule lives here where both
 * can reach it: the hook registers the runner and schedules, Run flushes
 * everything pending and awaits the queue going idle.
 */

type Runner = (docName: string) => Promise<void>;

const noopRunner: Runner = async () => {};

export class CompileQueue {
  private runner: Runner = noopRunner;
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  private inFlight = new Map<string, Promise<void>>();
  private queued = new Set<string>();
  private idleWaiters: Array<() => void> = [];

  setRunner(runner: Runner): void {
    this.runner = runner;
  }

  /** Compile after `delayMs`; a newer schedule for the same file replaces an older one. */
  schedule(docName: string, delayMs: number): void {
    this.cancel(docName);
    this.timers.set(
      docName,
      setTimeout(() => {
        this.timers.delete(docName);
        this.run(docName);
      }, delayMs)
    );
  }

  /** Drop a pending schedule (not a compile already running). */
  cancel(docName: string): void {
    const timer = this.timers.get(docName);
    if (timer) clearTimeout(timer);
    this.timers.delete(docName);
  }

  /** Compile now, or right after the compile already running for this file. */
  run(docName: string): Promise<void> {
    this.cancel(docName);
    const running = this.inFlight.get(docName);
    if (running) {
      this.queued.add(docName);
      return running.then(
        () => this.inFlight.get(docName) ?? Promise.resolve()
      );
    }
    const task = this.runner(docName)
      .catch(() => {})
      .finally(() => {
        this.inFlight.delete(docName);
        if (this.queued.delete(docName)) {
          this.run(docName);
        } else {
          this.settleIfIdle();
        }
      });
    this.inFlight.set(docName, task);
    return task;
  }

  /** Every scheduled compile, started now. */
  flush(): void {
    for (const docName of Array.from(this.timers.keys())) this.run(docName);
  }

  get isIdle(): boolean {
    return this.timers.size === 0 && this.inFlight.size === 0;
  }

  /** Resolves once nothing is scheduled or running, or after `timeoutMs`. */
  whenIdle(timeoutMs = 15_000): Promise<void> {
    if (this.isIdle) return Promise.resolve();
    return new Promise((resolve) => {
      const timer = setTimeout(done, timeoutMs);
      function done() {
        clearTimeout(timer);
        resolve();
      }
      this.idleWaiters.push(done);
    });
  }

  /** Forget everything; used when the owning hook unmounts. */
  reset(): void {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    this.queued.clear();
    this.runner = noopRunner;
    this.settleIfIdle();
  }

  private settleIfIdle(): void {
    if (!this.isIdle) return;
    const waiters = this.idleWaiters;
    this.idleWaiters = [];
    for (const waiter of waiters) waiter();
  }
}

export const compileQueue = new CompileQueue();

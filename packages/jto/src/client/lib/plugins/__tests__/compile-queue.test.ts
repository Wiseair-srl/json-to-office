import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CompileQueue } from '../compile-queue';

/** A runner whose completion the test controls. */
function controlledRunner() {
  const calls: string[] = [];
  const pending = new Map<string, () => void>();
  const runner = (docName: string) =>
    new Promise<void>((resolve) => {
      calls.push(docName);
      pending.set(docName, resolve);
    });
  const finish = (docName: string) => {
    pending.get(docName)?.();
    pending.delete(docName);
  };
  return { calls, runner, finish };
}

/** Drain the microtask queue; timers are faked, so a macrotask never fires. */
async function tick(): Promise<void> {
  for (let i = 0; i < 8; i++) await Promise.resolve();
}

describe('CompileQueue', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('debounces: a newer schedule replaces an older one', async () => {
    const queue = new CompileQueue();
    const { calls, runner, finish } = controlledRunner();
    queue.setRunner(runner);
    queue.schedule('a', 100);
    vi.advanceTimersByTime(50);
    queue.schedule('a', 100);
    vi.advanceTimersByTime(80);
    expect(calls).toEqual([]);
    vi.advanceTimersByTime(30);
    expect(calls).toEqual(['a']);
    finish('a');
    await queue.whenIdle();
    expect(queue.isIdle).toBe(true);
  });

  it('flush starts every scheduled compile now and whenIdle waits for them', async () => {
    const queue = new CompileQueue();
    const { calls, runner, finish } = controlledRunner();
    queue.setRunner(runner);
    queue.schedule('a', 400);
    queue.schedule('b', 400);
    queue.flush();
    expect(calls).toEqual(['a', 'b']);
    let idle = false;
    const waiting = queue.whenIdle().then(() => {
      idle = true;
    });
    await tick();
    expect(idle).toBe(false);
    finish('a');
    await tick();
    expect(idle).toBe(false);
    finish('b');
    await waiting;
    expect(idle).toBe(true);
  });

  it('a run requested during a compile runs again afterwards, once', async () => {
    const queue = new CompileQueue();
    const { calls, runner, finish } = controlledRunner();
    queue.setRunner(runner);
    const first = queue.run('a');
    queue.run('a');
    queue.run('a');
    expect(calls).toEqual(['a']);
    finish('a');
    await first;
    await tick();
    expect(calls).toEqual(['a', 'a']);
    finish('a');
    await queue.whenIdle();
    expect(calls).toEqual(['a', 'a']);
  });

  it('cancel drops a schedule and a runner failure does not wedge the queue', async () => {
    const queue = new CompileQueue();
    const calls: string[] = [];
    queue.setRunner(async (docName) => {
      calls.push(docName);
      throw new Error('boom');
    });
    queue.schedule('a', 100);
    queue.cancel('a');
    vi.advanceTimersByTime(200);
    expect(calls).toEqual([]);
    await queue.run('b');
    expect(calls).toEqual(['b']);
    expect(queue.isIdle).toBe(true);
  });

  it('whenIdle gives up after its timeout and reset releases waiters', async () => {
    const queue = new CompileQueue();
    const { runner } = controlledRunner();
    queue.setRunner(runner);
    queue.run('stuck');
    let released = false;
    const waiting = queue.whenIdle(1000).then(() => {
      released = true;
    });
    vi.advanceTimersByTime(1000);
    await waiting;
    expect(released).toBe(true);

    queue.schedule('later', 500);
    let afterReset = false;
    const second = queue.whenIdle(60_000).then(() => {
      afterReset = true;
    });
    // Nothing is running any more once the schedule is dropped, so the
    // waiter is released — the stuck compile is still counted, though.
    queue.reset();
    expect(afterReset).toBe(false);
    vi.advanceTimersByTime(60_000);
    await second;
    expect(afterReset).toBe(true);
  });
});

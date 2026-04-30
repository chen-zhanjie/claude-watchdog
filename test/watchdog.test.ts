import { beforeEach, describe, expect, it, vi } from "vitest";
import { ClaudeWatchdog, type Runner } from "../src/watchdog.js";
import { createWatchdogConfig } from "../src/config.js";

class FakeRunner implements Runner {
  writes: string[] = [];
  private dataHandlers: Array<(data: string) => void> = [];
  private exitHandlers: Array<(exit: { exitCode: number | null; signal?: number }) => void> = [];

  write(data: string): void {
    this.writes.push(data);
  }

  kill(): void {}

  onData(handler: (data: string) => void): void {
    this.dataHandlers.push(handler);
  }

  onExit(handler: (exit: { exitCode: number | null; signal?: number }) => void): void {
    this.exitHandlers.push(handler);
  }

  emitData(data: string): void {
    for (const handler of this.dataHandlers) {
      handler(data);
    }
  }

  emitExit(exitCode: number | null): void {
    for (const handler of this.exitHandlers) {
      handler({ exitCode });
    }
  }
}

describe("ClaudeWatchdog", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it("does nothing before the idle timeout", () => {
    const runner = new FakeRunner();
    const notify = vi.fn();
    const watchdog = new ClaudeWatchdog({
      runner,
      config: createWatchdogConfig({ idleTimeoutMs: 1000 }),
      notify
    });

    watchdog.start();
    vi.advanceTimersByTime(999);

    expect(runner.writes).toEqual([]);
    expect(notify).not.toHaveBeenCalled();
  });

  it("sends Esc, recovery text, and Enter after idle timeout", () => {
    const runner = new FakeRunner();
    const logger = vi.fn();
    const watchdog = new ClaudeWatchdog({
      runner,
      config: createWatchdogConfig({ idleTimeoutMs: 1000, recoveryText: "继续" }),
      notify: vi.fn(),
      logger
    });

    watchdog.start();
    vi.advanceTimersByTime(1000);

    expect(runner.writes).toEqual(["\x1b", "继续", "\r"]);
    expect(logger).toHaveBeenCalledWith("started: timeout=1s maxAttempts=3 recovery=Esc + 继续");
    expect(logger).toHaveBeenCalledWith("no output for 1s, sending recovery 1/3");
  });

  it("does not send Ctrl+C during recovery", () => {
    const runner = new FakeRunner();
    const watchdog = new ClaudeWatchdog({
      runner,
      config: createWatchdogConfig({ idleTimeoutMs: 1000 }),
      notify: vi.fn()
    });

    watchdog.start();
    vi.advanceTimersByTime(1000);

    expect(runner.writes).not.toContain("\x03");
  });

  it("reports status changes", () => {
    const runner = new FakeRunner();
    const reportStatus = vi.fn();
    const watchdog = new ClaudeWatchdog({
      runner,
      config: createWatchdogConfig({ idleTimeoutMs: 1000, maxAttempts: 2 }),
      notify: vi.fn(),
      reportStatus
    });

    watchdog.start();
    vi.advanceTimersByTime(1000);
    runner.emitExit(0);

    expect(reportStatus).toHaveBeenCalledWith(expect.objectContaining({ state: "running", attempts: 0 }));
    expect(reportStatus).toHaveBeenCalledWith(expect.objectContaining({ state: "recovering", attempts: 1 }));
    expect(reportStatus).toHaveBeenCalledWith(expect.objectContaining({ state: "exited", exit: { exitCode: 0 } }));
  });

  it("can skip Esc when configured", () => {
    const runner = new FakeRunner();
    const watchdog = new ClaudeWatchdog({
      runner,
      config: createWatchdogConfig({ idleTimeoutMs: 1000, sendEscBeforeRecovery: false }),
      notify: vi.fn()
    });

    watchdog.start();
    vi.advanceTimersByTime(1000);

    expect(runner.writes).toEqual(["继续", "\r"]);
  });

  it("increments recovery attempts and stops at max attempts", () => {
    const runner = new FakeRunner();
    const notify = vi.fn();
    const logger = vi.fn();
    const watchdog = new ClaudeWatchdog({
      runner,
      config: createWatchdogConfig({ idleTimeoutMs: 1000, maxAttempts: 2 }),
      notify,
      logger
    });

    watchdog.start();
    vi.advanceTimersByTime(1000);
    vi.advanceTimersByTime(1000);
    vi.advanceTimersByTime(1000);

    expect(runner.writes).toEqual(["\x1b", "继续", "\r", "\x1b", "继续", "\r"]);
    expect(notify).toHaveBeenCalledOnce();
    expect(notify).toHaveBeenCalledWith({
      reason: "attempts_exhausted",
      attempts: 2,
      command: "claude --dangerously-skip-permissions"
    });
    expect(watchdog.getState()).toBe("exhausted");
    expect(logger).toHaveBeenCalledWith("recovery attempts exhausted after 2/2");
  });

  it("does not reset the idle timer for pure terminal redraws", () => {
    const runner = new FakeRunner();
    const watchdog = new ClaudeWatchdog({
      runner,
      config: createWatchdogConfig({ idleTimeoutMs: 1000 }),
      notify: vi.fn()
    });

    watchdog.start();
    vi.advanceTimersByTime(900);
    runner.emitData("\x1b[?25l\x1b[1;1H\x1b[2K\x1b[?25h");
    vi.advanceTimersByTime(100);

    expect(runner.writes).toEqual(["\x1b", "继续", "\r"]);
  });

  it("does not reset the idle timer when tmux status redraws", () => {
    const runner = new FakeRunner();
    const watchdog = new ClaudeWatchdog({
      runner,
      config: createWatchdogConfig({ idleTimeoutMs: 1000 }),
      notify: vi.fn()
    });

    watchdog.start();
    vi.advanceTimersByTime(900);
    runner.emitData("\x1b[999;1H\x1b[2Kclaude-watchdog running · attempts 0/3 · 100s left\x1b[1;1H");
    vi.advanceTimersByTime(100);

    expect(runner.writes).toEqual(["\x1b", "继续", "\r"]);
  });

  it("resets the idle timer when output arrives", () => {
    const runner = new FakeRunner();
    const watchdog = new ClaudeWatchdog({
      runner,
      config: createWatchdogConfig({ idleTimeoutMs: 1000 }),
      notify: vi.fn()
    });

    watchdog.start();
    vi.advanceTimersByTime(900);
    runner.emitData("still alive");
    vi.advanceTimersByTime(900);

    expect(runner.writes).toEqual([]);

    vi.advanceTimersByTime(100);

    expect(runner.writes).toEqual(["\x1b", "继续", "\r"]);
  });

  it("stops timers when the child exits", () => {
    const runner = new FakeRunner();
    const watchdog = new ClaudeWatchdog({
      runner,
      config: createWatchdogConfig({ idleTimeoutMs: 1000 }),
      notify: vi.fn()
    });

    watchdog.start();
    runner.emitExit(0);
    vi.advanceTimersByTime(1000);

    expect(runner.writes).toEqual([]);
    expect(watchdog.getState()).toBe("exited");
  });
});

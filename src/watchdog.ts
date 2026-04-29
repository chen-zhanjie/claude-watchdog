import type { WatchdogConfig } from "./config.js";

export type RunnerExit = {
  exitCode: number | null;
  signal?: number;
};

export type Runner = {
  write(data: string): void;
  kill(): void;
  onData(handler: (data: string) => void): void;
  onExit(handler: (exit: RunnerExit) => void): void;
};

export type WatchdogState = "running" | "recovering" | "exhausted" | "exited";

export type NotifyEvent = {
  reason: "attempts_exhausted";
  attempts: number;
  command: string;
};

type ClaudeWatchdogOptions = {
  runner: Runner;
  config: WatchdogConfig;
  notify: (event: NotifyEvent) => void | Promise<void>;
  now?: () => number;
  setTimer?: typeof setTimeout;
  clearTimer?: typeof clearTimeout;
};

export class ClaudeWatchdog {
  private readonly runner: Runner;
  private readonly config: WatchdogConfig;
  private readonly notify: (event: NotifyEvent) => void | Promise<void>;
  private readonly now: () => number;
  private readonly setTimer: typeof setTimeout;
  private readonly clearTimer: typeof clearTimeout;
  private state: WatchdogState = "running";
  private attempts = 0;
  private lastOutputAt = 0;
  private timer?: ReturnType<typeof setTimeout>;

  constructor(options: ClaudeWatchdogOptions) {
    this.runner = options.runner;
    this.config = options.config;
    this.notify = options.notify;
    this.now = options.now ?? Date.now;
    this.setTimer = options.setTimer ?? setTimeout;
    this.clearTimer = options.clearTimer ?? clearTimeout;
  }

  start(): void {
    this.lastOutputAt = this.now();
    this.runner.onData(() => {
      this.lastOutputAt = this.now();
      if (this.state !== "exited" && this.state !== "exhausted") {
        this.state = "running";
      }
    });
    this.runner.onExit(() => {
      this.state = "exited";
      this.stopTimer();
    });
    this.scheduleNextCheck();
  }

  stop(): void {
    this.stopTimer();
  }

  getState(): WatchdogState {
    return this.state;
  }

  private scheduleNextCheck(): void {
    this.stopTimer();
    if (this.state === "exited" || this.state === "exhausted") {
      return;
    }
    const elapsed = this.now() - this.lastOutputAt;
    const delay = Math.max(this.config.idleTimeoutMs - elapsed, 0);
    this.timer = this.setTimer(() => this.checkIdle(), delay);
  }

  private checkIdle(): void {
    if (this.state === "exited" || this.state === "exhausted") {
      return;
    }

    const elapsed = this.now() - this.lastOutputAt;
    if (elapsed < this.config.idleTimeoutMs) {
      this.scheduleNextCheck();
      return;
    }

    if (this.attempts >= this.config.maxAttempts) {
      this.exhaustAttempts();
      return;
    }

    this.recover();
    this.lastOutputAt = this.now();
    this.scheduleNextCheck();
  }

  private recover(): void {
    this.state = "recovering";
    this.attempts += 1;

    if (this.config.sendEscBeforeRecovery) {
      this.runner.write("\x1b");
    }
    this.runner.write(this.config.recoveryText);
    this.runner.write("\r");
  }

  private exhaustAttempts(): void {
    this.state = "exhausted";
    this.stopTimer();
    void this.notify({
      reason: "attempts_exhausted",
      attempts: this.attempts,
      command: [this.config.command, ...this.config.args].join(" ")
    });
  }

  private stopTimer(): void {
    if (this.timer !== undefined) {
      this.clearTimer(this.timer);
      this.timer = undefined;
    }
  }
}

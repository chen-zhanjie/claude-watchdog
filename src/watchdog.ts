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

type WatchdogLogger = (message: string) => void;

export type WatchdogStatusReport = {
  state: WatchdogState;
  attempts: number;
  maxAttempts: number;
  idleTimeoutMs: number;
  command: string;
  recovery: string;
  lastOutputAt: number;
  exit?: RunnerExit;
};

export type ClaudeWatchdogOptions = {
  runner: Runner;
  config: WatchdogConfig;
  notify: (event: NotifyEvent) => void | Promise<void>;
  logger?: WatchdogLogger;
  reportStatus?: (status: WatchdogStatusReport) => void;
  now?: () => number;
  setTimer?: typeof setTimeout;
  clearTimer?: typeof clearTimeout;
};

export class ClaudeWatchdog {
  private readonly runner: Runner;
  private readonly config: WatchdogConfig;
  private readonly notify: (event: NotifyEvent) => void | Promise<void>;
  private readonly logger: WatchdogLogger;
  private readonly reportStatus: (status: WatchdogStatusReport) => void;
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
    this.logger = options.logger ?? (() => undefined);
    this.reportStatus = options.reportStatus ?? (() => undefined);
    this.now = options.now ?? Date.now;
    this.setTimer = options.setTimer ?? setTimeout;
    this.clearTimer = options.clearTimer ?? clearTimeout;
  }

  start(): void {
    this.lastOutputAt = this.now();
    this.logger(`started: timeout=${this.config.idleTimeoutMs / 1000}s maxAttempts=${this.config.maxAttempts} recovery=${this.recoveryDescription()}`);
    this.reportCurrentStatus();
    this.runner.onData((data) => {
      if (!isMeaningfulClaudeOutput(data)) {
        return;
      }

      this.lastOutputAt = this.now();
      if (this.state !== "exited" && this.state !== "exhausted") {
        this.state = "running";
        this.reportCurrentStatus();
      }
    });
    this.runner.onExit((exit) => {
      this.state = "exited";
      this.stopTimer();
      this.reportCurrentStatus(exit);
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
    this.logger(`no output for ${this.config.idleTimeoutMs / 1000}s, sending recovery ${this.attempts}/${this.config.maxAttempts}`);

    this.reportCurrentStatus();
    if (this.config.sendEscBeforeRecovery) {
      this.runner.write("\x1b");
    }
    this.runner.write(this.config.recoveryText);
    this.runner.write("\r");
  }

  private exhaustAttempts(): void {
    this.state = "exhausted";
    this.stopTimer();
    this.logger(`recovery attempts exhausted after ${this.attempts}/${this.config.maxAttempts}`);
    this.reportCurrentStatus();
    void this.notify({
      reason: "attempts_exhausted",
      attempts: this.attempts,
      command: [this.config.command, ...this.config.args].join(" ")
    });
  }

  private recoveryDescription(): string {
    return this.config.sendEscBeforeRecovery ? `Esc + ${this.config.recoveryText}` : this.config.recoveryText;
  }

  private reportCurrentStatus(exit?: RunnerExit): void {
    this.reportStatus({
      state: this.state,
      attempts: this.attempts,
      maxAttempts: this.config.maxAttempts,
      idleTimeoutMs: this.config.idleTimeoutMs,
      command: [this.config.command, ...this.config.args].join(" "),
      recovery: this.recoveryDescription(),
      lastOutputAt: this.lastOutputAt,
      exit
    });
  }

  private stopTimer(): void {
    if (this.timer !== undefined) {
      this.clearTimer(this.timer);
      this.timer = undefined;
    }
  }
}

function isMeaningfulClaudeOutput(data: string): boolean {
  const text = stripAnsiControlSequences(data).trim();
  if (text.length === 0) {
    return false;
  }

  return !text.includes("claude-watchdog running ·") && !text.includes("claude-watchdog recovering ·") && !text.includes("claude-watchdog exhausted ·");
}

function stripAnsiControlSequences(data: string): string {
  let output = "";
  for (let index = 0; index < data.length; index += 1) {
    const code = data.charCodeAt(index);

    if (code === 27) {
      index = skipEscapeSequence(data, index);
      continue;
    }

    if (code < 32 || code === 127) {
      continue;
    }

    output += data[index];
  }
  return output;
}

function skipEscapeSequence(data: string, index: number): number {
  const next = data[index + 1];
  if (next === "[") {
    return skipUntilFinalByte(data, index + 2);
  }

  if (next === "]") {
    return skipOperatingSystemCommand(data, index + 2);
  }

  return Math.min(index + 1, data.length - 1);
}

function skipUntilFinalByte(data: string, index: number): number {
  for (let current = index; current < data.length; current += 1) {
    const code = data.charCodeAt(current);
    if (code >= 64 && code <= 126) {
      return current;
    }
  }
  return data.length - 1;
}

function skipOperatingSystemCommand(data: string, index: number): number {
  for (let current = index; current < data.length; current += 1) {
    const code = data.charCodeAt(current);
    if (code === 7) {
      return current;
    }
    if (code === 27 && data[current + 1] === "\\") {
      return current + 1;
    }
  }
  return data.length - 1;
}

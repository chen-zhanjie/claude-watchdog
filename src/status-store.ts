import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { RunnerExit, WatchdogState } from "./watchdog.js";

export type WatchdogStatus = {
  version: 1;
  state: WatchdogState;
  updatedAt: number;
  attempts: number;
  maxAttempts: number;
  idleTimeoutSeconds: number;
  lastOutputAt: number;
  command: string;
  recovery: string;
  exitCode?: number | null;
};

export type StatusReport = {
  state: WatchdogState;
  attempts: number;
  maxAttempts: number;
  idleTimeoutMs: number;
  command: string;
  recovery: string;
  lastOutputAt: number;
  exit?: RunnerExit;
};

export type StatusStore = {
  path: string;
  write(status: WatchdogStatus): void;
  read(): WatchdogStatus | undefined;
};

export function createStatusStore(options: { directory?: string; sessionId?: string } = {}): StatusStore {
  const directory = options.directory ?? join(homedir(), ".claude-watchdog");
  const path = options.sessionId === undefined ? join(directory, "status.json") : join(directory, "sessions", `${options.sessionId}.json`);

  return {
    path,
    write(status) {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, `${JSON.stringify(status, null, 2)}\n`, "utf8");
    },
    read() {
      if (!existsSync(path)) {
        return undefined;
      }

      return JSON.parse(readFileSync(path, "utf8")) as WatchdogStatus;
    }
  };
}

export function createStatusReporter(store: StatusStore, now: () => number = Date.now): (report: StatusReport) => void {
  return (report) => {
    store.write({
      version: 1,
      state: report.state,
      updatedAt: now(),
      attempts: report.attempts,
      maxAttempts: report.maxAttempts,
      idleTimeoutSeconds: report.idleTimeoutMs / 1000,
      lastOutputAt: report.lastOutputAt,
      command: report.command,
      recovery: report.recovery,
      exitCode: report.exit?.exitCode
    });
  };
}

export function formatStatusLine(status: WatchdogStatus | undefined, now: () => number = Date.now): string {
  if (status === undefined) {
    return "";
  }

  if (status.state === "recovering") {
    return `claude-watchdog recovering · attempts ${status.attempts}/${status.maxAttempts} · ${status.recovery}`;
  }

  if (status.state === "exhausted") {
    return `claude-watchdog exhausted · attempts ${status.attempts}/${status.maxAttempts}`;
  }

  if (status.state === "exited") {
    return "";
  }

  return `claude-watchdog running · attempts ${status.attempts}/${status.maxAttempts} · ${getRemainingSeconds(status, now)}s left`;
}

function getRemainingSeconds(status: WatchdogStatus, now: () => number): number {
  const elapsedSeconds = Math.floor((now() - status.lastOutputAt) / 1000);
  return Math.max(status.idleTimeoutSeconds - elapsedSeconds, 0);
}

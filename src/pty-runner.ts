import pty from "node-pty";
import type { IPtyForkOptions } from "node-pty";
import type { WatchdogConfig } from "./config.js";
import { ensureNodePtySpawnHelperExecutable } from "./node-pty-permissions.js";
import type { Runner, RunnerExit } from "./watchdog.js";

export type PtyProcess = {
  write(data: string): void;
  kill(signal?: string): void;
  onData(handler: (data: string) => void): void;
  onExit(handler: (exit: RunnerExit) => void): void;
};

export type PtyFactory = {
  spawn(command: string, args: string[], options: IPtyForkOptions): PtyProcess;
};

export function createPtyRunner(config: WatchdogConfig, factory: PtyFactory = pty): Runner {
  ensureNodePtySpawnHelperExecutable();

  const child = factory.spawn(config.command, config.args, {
    name: "xterm-256color",
    cols: process.stdout.columns || 120,
    rows: process.stdout.rows || 40,
    cwd: process.cwd(),
    env: process.env
  });

  return {
    write(data) {
      child.write(data);
    },
    kill() {
      child.kill();
    },
    onData(handler) {
      child.onData(handler);
    },
    onExit(handler) {
      child.onExit(handler);
    }
  };
}

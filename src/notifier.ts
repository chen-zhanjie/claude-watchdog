import { spawn } from "node:child_process";
import type { SpawnOptions } from "node:child_process";
import type { NotifyEvent } from "./watchdog.js";

type NotificationHandler = (value: number | Error | null) => void;

export type NotificationProcess = {
  on(event: "close" | "error", handler: NotificationHandler): NotificationProcess;
};

export type SpawnNotificationProcess = (
  command: string,
  args: string[],
  options?: SpawnOptions
) => NotificationProcess;

export type Notifier = (event: NotifyEvent) => Promise<void>;

const defaultSpawnNotificationProcess: SpawnNotificationProcess = (command, args, options) => spawn(command, args, options ?? {});

export function createNotifier(script?: string, spawnProcess: SpawnNotificationProcess = defaultSpawnNotificationProcess): Notifier {
  return async (event) => {
    if (script === undefined || script.trim().length === 0) {
      return;
    }

    await new Promise<void>((resolve) => {
      const child = spawnProcess(script, [], {
        env: {
          ...process.env,
          WATCHDOG_REASON: event.reason,
          WATCHDOG_ATTEMPTS: String(event.attempts),
          WATCHDOG_COMMAND: event.command
        },
        shell: false,
        stdio: "ignore"
      });

      child.on("error", () => resolve());
      child.on("close", () => resolve());
    });
  };
}

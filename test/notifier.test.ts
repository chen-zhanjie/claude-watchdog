import { describe, expect, it, vi } from "vitest";
import { createNotifier, type SpawnNotificationProcess } from "../src/notifier.js";

function createSpawn(exitCode = 0) {
  const calls: Array<{ command: string; env?: NodeJS.ProcessEnv }> = [];
  const spawn: SpawnNotificationProcess = (command, _args, options) => {
    calls.push({ command, env: options?.env });
    const handlers = new Map<string, Array<(code: number) => void>>();

    return {
      on(event, handler) {
        const existing = handlers.get(event) ?? [];
        existing.push(handler as (code: number) => void);
        handlers.set(event, existing);
        if (event === "close") {
          queueMicrotask(() => handler(exitCode));
        }
        return this;
      }
    };
  };

  return { spawn, calls };
}

describe("createNotifier", () => {
  it("does nothing when no script is configured", async () => {
    const { spawn, calls } = createSpawn();
    const notifier = createNotifier(undefined, spawn);

    await notifier({ reason: "attempts_exhausted", attempts: 3, command: "claude" });

    expect(calls).toEqual([]);
  });

  it("runs the configured script", async () => {
    const { spawn, calls } = createSpawn();
    const notifier = createNotifier("/tmp/notify.sh", spawn);

    await notifier({ reason: "attempts_exhausted", attempts: 3, command: "claude --dangerously-skip-permissions" });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.command).toBe("/tmp/notify.sh");
  });

  it("passes watchdog details through environment variables", async () => {
    const { spawn, calls } = createSpawn();
    const notifier = createNotifier("/tmp/notify.sh", spawn);

    await notifier({ reason: "attempts_exhausted", attempts: 2, command: "claude" });

    expect(calls[0]?.env?.WATCHDOG_REASON).toBe("attempts_exhausted");
    expect(calls[0]?.env?.WATCHDOG_ATTEMPTS).toBe("2");
    expect(calls[0]?.env?.WATCHDOG_COMMAND).toBe("claude");
  });

  it("does not reject when the notification script fails", async () => {
    const { spawn } = createSpawn(1);
    const notifier = createNotifier("/tmp/notify.sh", spawn);

    await expect(notifier({ reason: "attempts_exhausted", attempts: 1, command: "claude" })).resolves.toBeUndefined();
  });

  it("does not use a shell command string", async () => {
    const spawn = vi.fn<SpawnNotificationProcess>(() => ({
      on(event, handler) {
        if (event === "close") {
          queueMicrotask(() => handler(0));
        }
        return this;
      }
    }));
    const notifier = createNotifier("/tmp/notify.sh", spawn);

    await notifier({ reason: "attempts_exhausted", attempts: 1, command: "claude" });

    expect(spawn).toHaveBeenCalledWith("/tmp/notify.sh", [], expect.objectContaining({ shell: false }));
  });
});

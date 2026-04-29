import { symlinkSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { buildConfigFromArgv, isMainModule, runCli } from "../src/cli.js";

describe("buildConfigFromArgv", () => {
  it("builds default config", () => {
    const config = buildConfigFromArgv([]);

    expect(config.command).toBe("claude");
    expect(config.args).toEqual(["--dangerously-skip-permissions"]);
  });

  it("parses watchdog options", () => {
    const config = buildConfigFromArgv([
      "--timeout-ms",
      "1000",
      "--max-attempts",
      "1",
      "--recovery-text",
      "continue",
      "--notify-script",
      "/tmp/notify.sh",
      "--no-esc"
    ]);

    expect(config.idleTimeoutMs).toBe(1000);
    expect(config.maxAttempts).toBe(1);
    expect(config.recoveryText).toBe("continue");
    expect(config.notifyScript).toBe("/tmp/notify.sh");
    expect(config.sendEscBeforeRecovery).toBe(false);
  });

  it("parses custom command after --", () => {
    const config = buildConfigFromArgv(["--timeout-ms", "1000", "--", "node", "fake.js"]);

    expect(config.command).toBe("node");
    expect(config.args).toEqual(["fake.js"]);
  });
});

describe("isMainModule", () => {
  it("recognizes npm bin symlinks as the main module", async () => {
    const directory = await mkdtemp(join(tmpdir(), "claude-watchdog-cli-"));
    const symlinkPath = join(directory, "claude-watchdog");
    symlinkSync(new URL("../src/cli.ts", import.meta.url), symlinkPath);

    expect(isMainModule(new URL("../src/cli.ts", import.meta.url).href, symlinkPath)).toBe(true);
  });
});

describe("runCli", () => {
  it("wires runner, watchdog, and notifier", async () => {
    const runner = {
      write: vi.fn(),
      kill: vi.fn(),
      onData: vi.fn(),
      onExit: vi.fn()
    };
    const createRunner = vi.fn(() => runner);
    const createNotifier = vi.fn(() => vi.fn());
    const watchdog = { start: vi.fn() };
    const createWatchdog = vi.fn(() => watchdog);

    await runCli(["--timeout-ms", "1000"], {
      createRunner,
      createNotifier,
      createWatchdog,
      stdin: createFakeStdin(),
      stdout: createFakeStdout()
    });

    expect(createRunner).toHaveBeenCalledWith(expect.objectContaining({ idleTimeoutMs: 1000 }));
    expect(createNotifier).toHaveBeenCalledWith(undefined);
    expect(createWatchdog).toHaveBeenCalledWith(expect.objectContaining({ runner }));
    expect(watchdog.start).toHaveBeenCalledOnce();
  });

  it("restores terminal mode and pauses stdin when Claude exits", async () => {
    let exitHandler: ((exit: { exitCode: number | null }) => void) | undefined;
    const runner = {
      write: vi.fn(),
      kill: vi.fn(),
      onData: vi.fn(),
      onExit: vi.fn((handler: (exit: { exitCode: number | null }) => void) => {
        exitHandler = handler;
      })
    };
    const stdin = createFakeStdin();

    await runCli([], {
      createRunner: () => runner,
      createNotifier: () => vi.fn(),
      createWatchdog: () => ({ start: vi.fn() }),
      stdin,
      stdout: createFakeStdout()
    });

    exitHandler?.({ exitCode: 0 });

    expect(stdin.setRawMode).toHaveBeenCalledWith(false);
    expect(stdin.pause).toHaveBeenCalledOnce();
  });
});

function createFakeStdin() {
  return {
    isTTY: true,
    setRawMode: vi.fn(),
    resume: vi.fn(),
    pause: vi.fn(),
    on: vi.fn()
  };
}

function createFakeStdout() {
  return {
    write: vi.fn(),
    on: vi.fn()
  };
}

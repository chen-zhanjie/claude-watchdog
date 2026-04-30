import { symlinkSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { buildConfigFromArgv, isMainModule, runCli } from "../src/cli.js";
import { createStatusStore } from "../src/status-store.js";

describe("buildConfigFromArgv", () => {
  it("builds default config", () => {
    const config = buildConfigFromArgv([]);

    expect(config.command).toBe("claude");
    expect(config.args).toEqual(["--dangerously-skip-permissions"]);
  });

  it("parses watchdog options", () => {
    const config = buildConfigFromArgv([
      "--timeout",
      "3",
      "--max-attempts",
      "1",
      "--recovery-text",
      "continue",
      "--notify-script",
      "/tmp/notify.sh",
      "--no-esc"
    ]);

    expect(config.idleTimeoutMs).toBe(3000);
    expect(config.maxAttempts).toBe(1);
    expect(config.recoveryText).toBe("continue");
    expect(config.notifyScript).toBe("/tmp/notify.sh");
    expect(config.sendEscBeforeRecovery).toBe(false);
  });

  it("parses custom command after --", () => {
    const config = buildConfigFromArgv(["--timeout", "1", "--", "node", "fake.js"]);

    expect(config.command).toBe("node");
    expect(config.args).toEqual(["fake.js"]);
    expect(config.idleTimeoutMs).toBe(1000);
  });

  it("uses a numeric first argument as timeout seconds shorthand", () => {
    const config = buildConfigFromArgv(["3"]);

    expect(config.idleTimeoutMs).toBe(3000);
    expect(config.command).toBe("claude");
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

    await runCli(["run-internal", "--timeout", "1"], {
      createRunner,
      createNotifier,
      createWatchdog,
      stdin: createFakeStdin(),
      stdout: createFakeStdout(),
      stderr: createFakeStderr()
    });

    expect(createRunner).toHaveBeenCalledWith(expect.objectContaining({ idleTimeoutMs: 1000 }));
    expect(createNotifier).toHaveBeenCalledWith(undefined);
    expect(createWatchdog).toHaveBeenCalledWith(expect.objectContaining({ runner }));
    expect(watchdog.start).toHaveBeenCalledOnce();
  });

  it("launches tmux when not already inside tmux", async () => {
    const originalTmux = process.env.TMUX;
    const launch = vi.fn();
    delete process.env.TMUX;
    try {
      await runCli(["--timeout", "1"], {
        sessionId: "test1234",
        cliPath: "/tmp/cli.js",
        launchTmux: launch,
        stdin: createFakeStdin(),
        stdout: createFakeStdout(),
        stderr: createFakeStderr()
      });
    } finally {
      process.env.TMUX = originalTmux;
    }

    expect(launch).toHaveBeenCalledWith({
      argv: ["--timeout", "1"],
      sessionId: "test1234",
      cliPath: "/tmp/cli.js"
    });
  });

  it("prints tmux status output", async () => {
    const directory = await mkdtemp(join(tmpdir(), "claude-watchdog-cli-status-"));
    const statusStore = createStatusStore({ directory });
    statusStore.write({
      version: 1,
      state: "running",
      updatedAt: 1_700_000_000_000,
      attempts: 0,
      maxAttempts: 3,
      idleTimeoutSeconds: 10,
      lastOutputAt: Date.now(),
      command: "claude --dangerously-skip-permissions",
      recovery: "Esc + 继续"
    });
    const stdout = createFakeStdout();

    await runCli(["tmux-status"], {
      statusStore,
      stdout,
      stdin: createFakeStdin(),
      stderr: createFakeStderr()
    });

    expect(stdout.write).toHaveBeenCalledWith("claude-watchdog running · attempts 0/3 · 10s left\n");
  });

  it("writes exit logs only in debug mode", async () => {
    let exitHandler: ((exit: { exitCode: number | null }) => void) | undefined;
    const runner = {
      write: vi.fn(),
      kill: vi.fn(),
      onData: vi.fn(),
      onExit: vi.fn((handler: (exit: { exitCode: number | null }) => void) => {
        exitHandler = handler;
      })
    };
    const stderr = createFakeStderr();

    await runCli(["run-internal", "--debug"], {
      createRunner: () => runner,
      createNotifier: () => vi.fn(),
      createWatchdog: () => ({ start: vi.fn() }),
      stdin: createFakeStdin(),
      stdout: createFakeStdout(),
      stderr
    });

    exitHandler?.({ exitCode: 0 });

    expect(stderr.write).toHaveBeenCalledWith("[claude-watchdog] claude exited with code 0\n");
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
    const stderr = createFakeStderr();

    await runCli(["run-internal"], {
      createRunner: () => runner,
      createNotifier: () => vi.fn(),
      createWatchdog: () => ({ start: vi.fn() }),
      stdin,
      stdout: createFakeStdout(),
      stderr
    });

    exitHandler?.({ exitCode: 0 });

    expect(stderr.write).not.toHaveBeenCalled();
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

function createFakeStderr() {
  return {
    write: vi.fn()
  };
}

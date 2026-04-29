import { describe, expect, it, vi } from "vitest";
import { createPtyRunner, type PtyProcess } from "../src/pty-runner.js";
import { createWatchdogConfig } from "../src/config.js";

function createFakePty() {
  const writes: string[] = [];
  const kills: string[] = [];
  const dataHandlers: Array<(data: string) => void> = [];
  const exitHandlers: Array<(exit: { exitCode: number | null; signal?: number }) => void> = [];

  const process: PtyProcess = {
    write(data) {
      writes.push(data);
    },
    kill(signal) {
      kills.push(signal ?? "default");
    },
    onData(handler) {
      dataHandlers.push(handler);
    },
    onExit(handler) {
      exitHandlers.push(handler);
    }
  };

  return { process, writes, kills, dataHandlers, exitHandlers };
}

describe("createPtyRunner", () => {
  it("spawns the configured command and args", () => {
    const fake = createFakePty();
    const spawn = vi.fn(() => fake.process);

    createPtyRunner(createWatchdogConfig({ commandWithArgs: ["claude", "--model", "opus"] }), { spawn });

    expect(spawn).toHaveBeenCalledWith("claude", ["--model", "opus"], expect.objectContaining({
      name: "xterm-256color",
      cwd: process.cwd()
    }));
  });

  it("writes input to the PTY process", () => {
    const fake = createFakePty();
    const runner = createPtyRunner(createWatchdogConfig(), { spawn: () => fake.process });

    runner.write("继续\r");

    expect(fake.writes).toEqual(["继续\r"]);
  });

  it("registers output and exit handlers", () => {
    const fake = createFakePty();
    const runner = createPtyRunner(createWatchdogConfig(), { spawn: () => fake.process });
    const onData = vi.fn();
    const onExit = vi.fn();

    runner.onData(onData);
    runner.onExit(onExit);
    fake.dataHandlers[0]?.("hello");
    fake.exitHandlers[0]?.({ exitCode: 0 });

    expect(onData).toHaveBeenCalledWith("hello");
    expect(onExit).toHaveBeenCalledWith({ exitCode: 0 });
  });

  it("kills the PTY process", () => {
    const fake = createFakePty();
    const runner = createPtyRunner(createWatchdogConfig(), { spawn: () => fake.process });

    runner.kill();

    expect(fake.kills).toEqual(["default"]);
  });
});

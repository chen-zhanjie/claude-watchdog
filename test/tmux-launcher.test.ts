import { describe, expect, it, vi } from "vitest";
import { buildTmuxLaunch, launchTmux } from "../src/tmux-launcher.js";

describe("tmux launcher", () => {
  it("builds a tmux session command with per-session status", () => {
    const launch = buildTmuxLaunch({
      argv: ["--timeout", "3"],
      sessionId: "cw-123",
      cliPath: "/tmp/cli.js"
    });

    expect(launch.command).toBe("tmux");
    expect(launch.create).toEqual([
      "new-session",
      "-d",
      "-s",
      "claude-watchdog-cw-123",
      "node /tmp/cli.js run-internal --session-id cw-123 --timeout 3"
    ]);
    expect(launch.setup).toEqual([
      ["set-option", "-t", "claude-watchdog-cw-123", "status", "on"],
      ["set-option", "-t", "claude-watchdog-cw-123", "status-interval", "1"],
      ["set-option", "-t", "claude-watchdog-cw-123", "status-right", "#(node /tmp/cli.js tmux-status --session-id cw-123)"]
    ]);
    expect(launch.attach).toEqual(["attach-session", "-t", "claude-watchdog-cw-123"]);
  });

  it("quotes tmux shell command arguments", () => {
    const launch = buildTmuxLaunch({
      argv: ["--recovery-text", "hello world", "--", "node", "fake script.js"],
      sessionId: "cw-123",
      cliPath: "/tmp/cli.js"
    });

    expect(launch.create.at(-1)).toBe("node /tmp/cli.js run-internal --session-id cw-123 --recovery-text 'hello world' -- node 'fake script.js'");
  });

  it("runs tmux setup commands before attaching", () => {
    const spawnSync = vi.fn(() => ({ status: 0 }));

    launchTmux({
      argv: [],
      sessionId: "cw-123",
      cliPath: "/tmp/cli.js",
      spawnSync
    });

    expect(spawnSync).toHaveBeenCalledWith("tmux", ["new-session", "-d", "-s", "claude-watchdog-cw-123", "node /tmp/cli.js run-internal --session-id cw-123"], { stdio: "ignore" });
    expect(spawnSync).toHaveBeenCalledWith("tmux", ["set-option", "-t", "claude-watchdog-cw-123", "status", "on"], { stdio: "ignore" });
    expect(spawnSync).toHaveBeenCalledWith("tmux", ["set-option", "-t", "claude-watchdog-cw-123", "status-interval", "1"], { stdio: "ignore" });
    expect(spawnSync).toHaveBeenLastCalledWith("tmux", ["attach-session", "-t", "claude-watchdog-cw-123"], { stdio: "inherit" });
  });
});

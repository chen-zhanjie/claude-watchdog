import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createStatusReporter, createStatusStore, formatStatusLine } from "../src/status-store.js";

describe("status store", () => {
  it("writes and reads the current watchdog status", async () => {
    const directory = await mkdtemp(join(tmpdir(), "claude-watchdog-status-"));
    const store = createStatusStore({ directory });
    const report = createStatusReporter(store, () => 1_700_000_000_000);

    report({
      state: "running",
      attempts: 0,
      maxAttempts: 3,
      idleTimeoutMs: 10_000,
      command: "claude --dangerously-skip-permissions",
      recovery: "Esc + 继续",
      lastOutputAt: 1_700_000_000_000
    });

    expect(store.read()).toEqual({
      version: 1,
      state: "running",
      updatedAt: 1_700_000_000_000,
      attempts: 0,
      maxAttempts: 3,
      idleTimeoutSeconds: 10,
      lastOutputAt: 1_700_000_000_000,
      command: "claude --dangerously-skip-permissions",
      recovery: "Esc + 继续"
    });
  });

  it("formats an empty line when no watchdog is active", () => {
    expect(formatStatusLine(undefined)).toBe("");
  });

  it("formats running and recovering lines", () => {
    expect(formatStatusLine({
      version: 1,
      state: "running",
      updatedAt: 1_700_000_000_000,
      attempts: 0,
      maxAttempts: 3,
      idleTimeoutSeconds: 10,
      lastOutputAt: 1_700_000_000_000,
      command: "claude --dangerously-skip-permissions",
      recovery: "Esc + 继续"
    }, () => 1_700_000_003_000)).toBe("claude-watchdog running · attempts 0/3 · 7s left");

    expect(formatStatusLine({
      version: 1,
      state: "recovering",
      updatedAt: 1_700_000_000_000,
      attempts: 1,
      maxAttempts: 3,
      idleTimeoutSeconds: 10,
      lastOutputAt: 1_700_000_000_000,
      command: "claude --dangerously-skip-permissions",
      recovery: "Esc + 继续"
    })).toBe("claude-watchdog recovering · attempts 1/3 · Esc + 继续");
  });

  it("formats exhausted and exited lines", () => {
    expect(formatStatusLine({
      version: 1,
      state: "exhausted",
      updatedAt: 1_700_000_000_000,
      attempts: 3,
      maxAttempts: 3,
      idleTimeoutSeconds: 10,
      lastOutputAt: 1_700_000_000_000,
      command: "claude --dangerously-skip-permissions",
      recovery: "Esc + 继续"
    })).toBe("claude-watchdog exhausted · attempts 3/3");

    expect(formatStatusLine({
      version: 1,
      state: "exited",
      updatedAt: 1_700_000_000_000,
      attempts: 1,
      maxAttempts: 3,
      idleTimeoutSeconds: 10,
      lastOutputAt: 1_700_000_000_000,
      command: "claude --dangerously-skip-permissions",
      recovery: "Esc + 继续",
      exitCode: 0
    })).toBe("");
  });
});

import { describe, expect, it } from "vitest";
import { createWatchdogConfig } from "../src/config.js";

describe("createWatchdogConfig", () => {
  it("uses high-permission Claude launch by default", () => {
    const config = createWatchdogConfig();

    expect(config.command).toBe("claude");
    expect(config.args).toEqual(["--dangerously-skip-permissions"]);
  });

  it("uses conservative recovery defaults", () => {
    const config = createWatchdogConfig();

    expect(config.idleTimeoutMs).toBe(5 * 60 * 1000);
    expect(config.maxAttempts).toBe(3);
    expect(config.recoveryText).toBe("继续");
    expect(config.sendEscBeforeRecovery).toBe(true);
  });

  it("lets an explicit command override the default Claude command", () => {
    const config = createWatchdogConfig({ commandWithArgs: ["claude", "--model", "opus"] });

    expect(config.command).toBe("claude");
    expect(config.args).toEqual(["--model", "opus"]);
  });

  it("accepts custom timeout, attempts, recovery text, and notification script", () => {
    const config = createWatchdogConfig({
      idleTimeoutMs: 1000,
      maxAttempts: 1,
      recoveryText: "continue",
      sendEscBeforeRecovery: false,
      notifyScript: "/tmp/notify.sh"
    });

    expect(config.idleTimeoutMs).toBe(1000);
    expect(config.maxAttempts).toBe(1);
    expect(config.recoveryText).toBe("continue");
    expect(config.sendEscBeforeRecovery).toBe(false);
    expect(config.notifyScript).toBe("/tmp/notify.sh");
  });

  it("rejects non-positive timeout values", () => {
    expect(() => createWatchdogConfig({ idleTimeoutMs: 0 })).toThrow("idleTimeoutMs must be positive");
  });

  it("rejects negative max attempts", () => {
    expect(() => createWatchdogConfig({ maxAttempts: -1 })).toThrow("maxAttempts must be zero or greater");
  });

  it("rejects blank recovery text", () => {
    expect(() => createWatchdogConfig({ recoveryText: "   " })).toThrow("recoveryText cannot be blank");
  });
});

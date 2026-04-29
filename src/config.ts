export type WatchdogConfig = {
  command: string;
  args: string[];
  idleTimeoutMs: number;
  maxAttempts: number;
  recoveryText: string;
  sendEscBeforeRecovery: boolean;
  notifyScript?: string;
};

export type WatchdogConfigInput = Partial<Omit<WatchdogConfig, "command" | "args">> & {
  commandWithArgs?: string[];
};

const defaultConfig = {
  command: "claude",
  args: ["--dangerously-skip-permissions"],
  idleTimeoutMs: 5 * 60 * 1000,
  maxAttempts: 3,
  recoveryText: "继续",
  sendEscBeforeRecovery: true
} satisfies WatchdogConfig;

export function createWatchdogConfig(input: WatchdogConfigInput = {}): WatchdogConfig {
  const [command, ...args] = input.commandWithArgs ?? [defaultConfig.command, ...defaultConfig.args];

  const config: WatchdogConfig = {
    command: command ?? defaultConfig.command,
    args,
    idleTimeoutMs: input.idleTimeoutMs ?? defaultConfig.idleTimeoutMs,
    maxAttempts: input.maxAttempts ?? defaultConfig.maxAttempts,
    recoveryText: input.recoveryText ?? defaultConfig.recoveryText,
    sendEscBeforeRecovery: input.sendEscBeforeRecovery ?? defaultConfig.sendEscBeforeRecovery,
    notifyScript: input.notifyScript
  };

  validateWatchdogConfig(config);
  return config;
}

function validateWatchdogConfig(config: WatchdogConfig): void {
  if (!Number.isFinite(config.idleTimeoutMs) || config.idleTimeoutMs <= 0) {
    throw new Error("idleTimeoutMs must be positive");
  }

  if (!Number.isInteger(config.maxAttempts) || config.maxAttempts < 0) {
    throw new Error("maxAttempts must be zero or greater");
  }

  if (config.recoveryText.trim().length === 0) {
    throw new Error("recoveryText cannot be blank");
  }

  if (config.command.trim().length === 0) {
    throw new Error("command cannot be blank");
  }
}

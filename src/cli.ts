#!/usr/bin/env node
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Command } from "commander";
import { createWatchdogConfig, type WatchdogConfig } from "./config.js";
import { createNotifier, type Notifier } from "./notifier.js";
import { createPtyRunner } from "./pty-runner.js";
import { ClaudeWatchdog, type Runner } from "./watchdog.js";

type CliStdin = {
  isTTY?: boolean;
  setRawMode?: (mode: boolean) => void;
  resume: () => void;
  pause: () => void;
  on: (event: "data", handler: (data: Buffer) => void) => void;
};

type CliStdout = {
  write: (data: string) => void;
  on: (event: "resize", handler: () => void) => void;
};

export type CliDependencies = {
  createRunner?: (config: WatchdogConfig) => Runner;
  createNotifier?: (script?: string) => Notifier;
  createWatchdog?: (options: {
    runner: Runner;
    config: WatchdogConfig;
    notify: Notifier;
  }) => Pick<ClaudeWatchdog, "start">;
  stdin?: CliStdin;
  stdout?: CliStdout;
};

type CliOptions = {
  timeoutMs?: string;
  maxAttempts?: string;
  recoveryText?: string;
  notifyScript?: string;
  esc: boolean;
};

export function buildConfigFromArgv(argv: string[]): WatchdogConfig {
  const program = new Command();
  program
    .name("claude-watchdog")
    .description("Minimal Claude Code watchdog that sends Esc + 继续 when output stalls.")
    .allowExcessArguments(true)
    .helpOption("-h, --help", "display help for command")
    .option("--timeout-ms <ms>", "milliseconds without output before sending recovery")
    .option("--max-attempts <n>", "maximum recovery attempts before notification")
    .option("--recovery-text <text>", "text to send after Esc", "继续")
    .option("--notify-script <path>", "shell script to execute when attempts are exhausted")
    .option("--no-esc", "do not send Esc before recovery text")
    .argument("[commandArgs...]", "command to launch after --");

  program.parse(argv, { from: "user" });
  const options = program.opts<CliOptions>();
  const commandArgs = program.args.length > 0 ? program.args : undefined;

  return createWatchdogConfig({
    commandWithArgs: commandArgs,
    idleTimeoutMs: parseOptionalInteger(options.timeoutMs),
    maxAttempts: parseOptionalInteger(options.maxAttempts),
    recoveryText: options.recoveryText,
    notifyScript: options.notifyScript,
    sendEscBeforeRecovery: options.esc
  });
}

export async function runCli(argv: string[], dependencies: CliDependencies = {}): Promise<void> {
  const config = buildConfigFromArgv(argv);
  const runner = (dependencies.createRunner ?? createPtyRunner)(config);
  const notify = (dependencies.createNotifier ?? createNotifier)(config.notifyScript);
  const watchdog = (dependencies.createWatchdog ?? ((options) => new ClaudeWatchdog(options)))({
    runner,
    config,
    notify
  });
  const stdin = dependencies.stdin ?? process.stdin;
  const stdout = dependencies.stdout ?? process.stdout;

  runner.onData((data) => {
    stdout.write(data);
  });

  runner.onExit((exit) => {
    restoreTerminal(stdin);
    process.exitCode = exit.exitCode ?? 0;
    stdin.pause();
  });

  if (stdin.isTTY) {
    stdin.setRawMode?.(true);
  }
  stdin.resume();
  stdin.on("data", (data: Buffer) => {
    runner.write(data.toString());
  });
  stdout.on("resize", () => {
    // node-pty resize can be added later; the runner interface intentionally stays minimal for MVP.
  });

  watchdog.start();
}

function restoreTerminal(stdin: CliStdin): void {
  if (stdin.isTTY) {
    stdin.setRawMode?.(false);
  }
}

function parseOptionalInteger(value: string | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  return Number.parseInt(value, 10);
}

export function isMainModule(metaUrl: string, argvPath: string | undefined): boolean {
  if (argvPath === undefined) {
    return false;
  }

  return realpathSync(fileURLToPath(metaUrl)) === realpathSync(argvPath);
}

if (isMainModule(import.meta.url, process.argv[1])) {
  runCli(process.argv.slice(2)).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`[watchdog] ${message}\n`);
    process.exitCode = 1;
  });
}

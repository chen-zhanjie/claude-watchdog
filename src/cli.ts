#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Command, Option } from "commander";
import { createWatchdogConfig, type WatchdogConfig } from "./config.js";
import { createNotifier, type Notifier } from "./notifier.js";
import { createPtyRunner } from "./pty-runner.js";
import { createStatusReporter, createStatusStore, formatStatusLine, type StatusStore } from "./status-store.js";
import { launchTmux } from "./tmux-launcher.js";
import { ClaudeWatchdog, type ClaudeWatchdogOptions, type Runner } from "./watchdog.js";

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

type CliStderr = {
  write: (data: string) => void;
};

export type CliDependencies = {
  createRunner?: (config: WatchdogConfig) => Runner;
  createNotifier?: (script?: string) => Notifier;
  createWatchdog?: (options: ClaudeWatchdogOptions) => Pick<ClaudeWatchdog, "start">;
  stdin?: CliStdin;
  stdout?: CliStdout;
  stderr?: CliStderr;
  statusStore?: StatusStore;
  sessionId?: string;
  cliPath?: string;
  launchTmux?: typeof launchTmux;
};

type CliOptions = {
  timeout?: string;
  maxAttempts?: string;
  recoveryText?: string;
  notifyScript?: string;
  sessionId?: string;
  debug: boolean;
  esc: boolean;
};

function createProgram(): Command {
  return new Command()
    .name("claude-watchdog")
    .description("Minimal Claude Code watchdog that sends Esc + 继续 when output stalls.")
    .allowExcessArguments(true)
    .helpOption("-h, --help", "display help for command")
    .option("--timeout <seconds>", "seconds without output before sending recovery")
    .option("--max-attempts <n>", "maximum recovery attempts before notification")
    .option("--recovery-text <text>", "text to send after Esc", "继续")
    .option("--notify-script <path>", "shell script to execute when attempts are exhausted")
    .addOption(new Option("--session-id <id>", "internal tmux watchdog session id").hideHelp())
    .option("--debug", "write watchdog events to stderr")
    .option("--no-esc", "do not send Esc before recovery text")
    .arguments("[timeoutOrCommandArgs...]");
}

export function buildConfigFromArgv(argv: string[]): WatchdogConfig {
  const program = createProgram();

  program.parse(argv, { from: "user" });
  const options = program.opts<CliOptions>();
  const parsedArguments = parseTimeoutAndCommandArgs(argv, options.timeout);

  return createWatchdogConfig({
    commandWithArgs: parsedArguments.commandArgs,
    idleTimeoutMs: parsedArguments.timeoutSeconds === undefined ? undefined : parsedArguments.timeoutSeconds * 1000,
    maxAttempts: options.maxAttempts === undefined ? undefined : parseOptionalInteger(options.maxAttempts),
    recoveryText: options.recoveryText,
    notifyScript: options.notifyScript,
    sendEscBeforeRecovery: options.esc
  });
}

export async function runCli(argv: string[], dependencies: CliDependencies = {}): Promise<void> {
  const command = argv[0];
  if (command === "tmux-status") {
    runTmuxStatus(argv.slice(1), dependencies);
    return;
  }

  if (argv.includes("--help") || argv.includes("-h")) {
    buildConfigFromArgv(argv);
    return;
  }

  if (command !== "run-internal" && process.env.TMUX === undefined) {
    (dependencies.launchTmux ?? launchTmux)({
      argv,
      sessionId: dependencies.sessionId ?? createSessionId(),
      cliPath: dependencies.cliPath ?? fileURLToPath(import.meta.url)
    });
    return;
  }

  const internalArgv = command === "run-internal" ? argv.slice(1) : argv;
  const config = buildConfigFromArgv(stripSessionIdOption(internalArgv));
  const runner = (dependencies.createRunner ?? createPtyRunner)(config);
  const notify = (dependencies.createNotifier ?? createNotifier)(config.notifyScript);
  const stderr = dependencies.stderr ?? process.stderr;
  const options = createProgram().parse(internalArgv, { from: "user" }).opts<CliOptions>();
  const statusStore = dependencies.statusStore ?? createStatusStore({ sessionId: options.sessionId });
  const watchdog = (dependencies.createWatchdog ?? ((watchdogOptions) => new ClaudeWatchdog(watchdogOptions)))({
    runner,
    config,
    notify,
    reportStatus: createStatusReporter(statusStore),
    logger: options.debug ? (message) => stderr.write(`[claude-watchdog] ${message}\n`) : undefined
  });
  const stdin = dependencies.stdin ?? process.stdin;
  const stdout = dependencies.stdout ?? process.stdout;

  runner.onData((data) => {
    stdout.write(data);
  });

  runner.onExit((exit) => {
    if (options.debug) {
      stderr.write(`[claude-watchdog] claude exited with code ${exit.exitCode ?? 0}\n`);
    }
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

function runTmuxStatus(argv: string[], dependencies: CliDependencies): void {
  const stdout = dependencies.stdout ?? process.stdout;
  const options = createProgram().parse(argv, { from: "user" }).opts<CliOptions>();
  const statusStore = dependencies.statusStore ?? createStatusStore({ sessionId: options.sessionId });
  stdout.write(`${formatStatusLine(statusStore.read())}\n`);
}

function createSessionId(): string {
  return randomUUID().slice(0, 8);
}

function restoreTerminal(stdin: CliStdin): void {
  if (stdin.isTTY) {
    stdin.setRawMode?.(false);
  }
}

function stripSessionIdOption(argv: string[]): string[] {
  const stripped: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--session-id") {
      index += 1;
      continue;
    }
    if (arg.startsWith("--session-id=")) {
      continue;
    }
    stripped.push(arg);
  }
  return stripped;
}

function parseTimeoutAndCommandArgs(argv: string[], timeoutOption: string | undefined): {
  timeoutSeconds: number | undefined;
  commandArgs: string[] | undefined;
} {
  const separatorIndex = argv.indexOf("--");
  const commandArgs = separatorIndex === -1 ? undefined : argv.slice(separatorIndex + 1);
  if (timeoutOption !== undefined) {
    return {
      timeoutSeconds: parseOptionalInteger(timeoutOption),
      commandArgs: commandArgs?.length === 0 ? undefined : commandArgs
    };
  }

  const positionalArgs = separatorIndex === -1 ? argv : argv.slice(0, separatorIndex);
  const firstPositionalArg = positionalArgs.find((arg) => !arg.startsWith("-"));
  if (firstPositionalArg !== undefined && /^\d+$/.test(firstPositionalArg)) {
    return {
      timeoutSeconds: parseOptionalInteger(firstPositionalArg),
      commandArgs: commandArgs?.length === 0 ? undefined : commandArgs
    };
  }

  return {
    timeoutSeconds: undefined,
    commandArgs: commandArgs?.length === 0 ? undefined : commandArgs
  };
}

function parseOptionalInteger(value: string): number {
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

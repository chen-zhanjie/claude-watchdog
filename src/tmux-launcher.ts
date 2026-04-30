import { spawnSync } from "node:child_process";

export type TmuxLaunch = {
  command: "tmux";
  create: string[];
  setup: string[][];
  attach: string[];
};

type SpawnSync = (command: string, args: string[], options: { stdio: "ignore" | "inherit" }) => { status: number | null };

export function buildTmuxLaunch(options: { argv: string[]; sessionId: string; cliPath: string }): TmuxLaunch {
  const sessionName = `claude-watchdog-${options.sessionId}`;
  const nodeCommand = `node ${quoteShell(options.cliPath)}`;
  const internalCommand = [nodeCommand, "run-internal", "--session-id", quoteShell(options.sessionId), ...options.argv.map(quoteShell)].join(" ");
  const statusCommand = `#(${nodeCommand} tmux-status --session-id ${quoteShell(options.sessionId)})`;

  return {
    command: "tmux",
    create: ["new-session", "-d", "-s", sessionName, internalCommand],
    setup: [
      ["set-option", "-t", sessionName, "status", "on"],
      ["set-option", "-t", sessionName, "status-interval", "1"],
      ["set-option", "-t", sessionName, "status-right", statusCommand]
    ],
    attach: ["attach-session", "-t", sessionName]
  };
}

export function launchTmux(options: { argv: string[]; sessionId: string; cliPath: string; spawnSync?: SpawnSync }): void {
  const spawn = options.spawnSync ?? spawnSync;
  const launch = buildTmuxLaunch(options);

  spawn(launch.command, launch.create, { stdio: "ignore" });
  for (const args of launch.setup) {
    spawn(launch.command, args, { stdio: "ignore" });
  }

  const result = spawn(launch.command, launch.attach, { stdio: "inherit" });
  if (typeof result.status === "number") {
    process.exitCode = result.status;
  }
}

function quoteShell(value: string): string {
  if (/^[A-Za-z0-9_./:-]+$/.test(value)) {
    return value;
  }

  return `'${value.replaceAll("'", "'\\''")}'`;
}

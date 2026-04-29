import { chmodSync, existsSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const executableBits = 0o111;

export function ensureNodePtySpawnHelperExecutable(baseDirectory = dirname(fileURLToPath(import.meta.url))): void {
  const helperPath = findSpawnHelperPath(baseDirectory);
  if (helperPath === undefined || process.platform === "win32") {
    return;
  }

  chmodSync(helperPath, 0o755);
}

function findSpawnHelperPath(baseDirectory: string): string | undefined {
  const platform = process.platform;
  const arch = process.arch;
  const candidates = [
    join(baseDirectory, "..", "node_modules", "node-pty", "prebuilds", `${platform}-${arch}`, "spawn-helper"),
    join(baseDirectory, "..", "..", "node-pty", "prebuilds", `${platform}-${arch}`, "spawn-helper")
  ];

  return candidates.find((candidate) => existsSync(candidate) && (process.platform !== "win32" || hasExecutableBits(candidate)));
}

function hasExecutableBits(path: string): boolean {
  try {
    return (process.getuid?.() ?? 0) === 0 || (statSync(path).mode & executableBits) !== 0;
  } catch {
    return false;
  }
}

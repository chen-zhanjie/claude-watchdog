import { mkdirSync, statSync, writeFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ensureNodePtySpawnHelperExecutable } from "../src/node-pty-permissions.js";

describe("ensureNodePtySpawnHelperExecutable", () => {
  it("sets executable bits on node-pty spawn-helper", async () => {
    const directory = await mkdtemp(join(tmpdir(), "node-pty-perms-"));
    const helperDirectory = join(directory, "..", "node_modules", "node-pty", "prebuilds", `${process.platform}-${process.arch}`);
    const helperPath = join(helperDirectory, "spawn-helper");
    mkdirSync(helperDirectory, { recursive: true });
    writeFileSync(helperPath, "#!/bin/sh\n");

    ensureNodePtySpawnHelperExecutable(directory);

    expect(statSync(helperPath).mode & 0o111).not.toBe(0);
  });
});

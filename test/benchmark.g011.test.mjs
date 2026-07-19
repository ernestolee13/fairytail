import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { access, mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { promisify } from "node:util";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const runFile = promisify(execFile);

test("the live G011 runner rejects a raw-artifact path inside the repository before any model call", async () => {
  const temporaryRoot = await mkdtemp(join(tmpdir(), "fairytail-g011-test-"));
  try {
    await assert.rejects(
      runFile(process.execPath, [
        join(root, "scripts", "benchmark-g011-current-build.mjs"),
        "--acknowledge-api-spend",
        "--artifacts",
        join(root, "benchmarks", "g011", "forbidden-raw"),
        "--summary",
        join(temporaryRoot, "summary.json"),
      ]),
      /Raw G011 artifacts must stay outside the repository/u,
    );
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("the live G011 runner rejects an outside path whose symlinked ancestor resolves into the repository", async () => {
  const outsideRoot = await mkdtemp(join(tmpdir(), "fairytail-g011-test-"));
  const insideTarget = await mkdtemp(join(root, ".g011-path-test-"));
  const bridge = join(outsideRoot, "bridge");
  const forbiddenRaw = join(bridge, "raw");
  try {
    await symlink(insideTarget, bridge, "dir");
    await assert.rejects(
      runFile(process.execPath, [
        join(root, "scripts", "benchmark-g011-current-build.mjs"),
        "--acknowledge-api-spend",
        "--artifacts",
        forbiddenRaw,
        "--summary",
        join(outsideRoot, "summary.json"),
      ]),
      /Raw G011 artifacts must stay outside the repository/u,
    );
    await assert.rejects(access(join(insideTarget, "raw")), {
      code: "ENOENT",
    });
  } finally {
    await rm(outsideRoot, { recursive: true, force: true });
    await rm(insideTarget, { recursive: true, force: true });
  }
});

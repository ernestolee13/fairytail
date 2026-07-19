import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const script = join(root, "scripts", "fairytail-install.mjs");

test("installer CLI defaults to a no-write plan and never prints local paths", async (context) => {
  const temporary = await mkdtemp(join(tmpdir(), "fairytail-installer-cli-"));
  context.after(() => rm(temporary, { recursive: true, force: true }));
  const configDir = join(temporary, "PRIVATE_CONFIG_CANARY");
  const workspaceRoot = join(temporary, "PRIVATE_WORKSPACE_CANARY");
  await mkdir(configDir, { recursive: true });
  await mkdir(workspaceRoot, { recursive: true });
  const result = await run([
    "plan",
    "--config-dir",
    configDir,
    "--workspace",
    workspaceRoot,
  ]);
  assert.equal(result.code, 0);
  const output = JSON.parse(result.stdout);
  assert.equal(output.operation, "install");
  assert.equal(output.overwrites_existing_files, false);
  assert.equal(output.network_required, false);
  assert.doesNotMatch(
    result.stdout,
    /PRIVATE_CONFIG_CANARY|PRIVATE_WORKSPACE_CANARY/u,
  );
});

test("installer CLI failure is one generic path-free record", async () => {
  const result = await run(["install", "--unknown", "PRIVATE_PATH_CANARY"]);
  assert.equal(result.code, 1);
  assert.deepEqual(JSON.parse(result.stdout), {
    schema_version: 1,
    status: "error",
    code: "fairytail-installer-failed-safely",
  });
  assert.doesNotMatch(result.stdout + result.stderr, /PRIVATE_PATH_CANARY/u);
});

/** @param {string[]} args */
function run(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, ...args], {
      cwd: root,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

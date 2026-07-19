#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { stderr, stdout } from "node:process";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const codexBin = process.env.FAIRYTAIL_CODEX_BIN ?? "codex";
const marketplaceSource =
  process.env.FAIRYTAIL_MARKETPLACE_SOURCE?.trim() || root;
const marketplaceRef = process.env.FAIRYTAIL_MARKETPLACE_REF?.trim();

try {
  const result = await runSmoke();
  stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  stderr.write(`Fairytail Codex smoke failed: ${message}\n`);
  process.exitCode = 1;
}

async function runSmoke() {
  const smokeHome = await mkdtemp(join(tmpdir(), "fairytail-codex-smoke-"));
  /** @type {NodeJS.ProcessEnv} */
  const environment = { ...process.env, CODEX_HOME: smokeHome };

  try {
    const version = (await runCodex(["--version"], environment)).stdout.trim();
    assert.match(version, /^codex-cli \d+\.\d+\.\d+/u);

    const marketplaceAdd = parseJson(
      (
        await runCodex(
          [
            "plugin",
            "marketplace",
            "add",
            marketplaceSource,
            ...(marketplaceRef ? ["--ref", marketplaceRef] : []),
            "--json",
          ],
          environment,
        )
      ).stdout,
    );
    assert.equal(marketplaceAdd.marketplaceName, "fairytail");
    if (marketplaceSource === root) {
      assert.equal(marketplaceAdd.installedRoot, root);
    } else {
      assert.equal(
        await exists(
          join(
            marketplaceAdd.installedRoot,
            ".agents",
            "plugins",
            "marketplace.json",
          ),
        ),
        true,
      );
    }

    const availableBefore = parseJson(
      (await runCodex(["plugin", "list", "--available", "--json"], environment))
        .stdout,
    );
    assert.deepEqual(availableBefore.installed, []);
    assert.equal(availableBefore.available.length, 1);
    assert.equal(availableBefore.available[0].pluginId, "fairytail@fairytail");
    assert.equal(availableBefore.available[0].version, "0.1.6");
    assert.equal(availableBefore.available[0].enabled, false);

    const installed = parseJson(
      (
        await runCodex(
          ["plugin", "add", "fairytail@fairytail", "--json"],
          environment,
        )
      ).stdout,
    );
    assert.equal(installed.pluginId, "fairytail@fairytail");
    assert.equal(installed.version, "0.1.6");

    const cachedManifest = JSON.parse(
      await readFile(
        join(installed.installedPath, ".codex-plugin", "plugin.json"),
        "utf8",
      ),
    );
    assert.equal(cachedManifest.name, "fairytail");
    assert.equal(cachedManifest.version, "0.1.6");
    assert.equal(cachedManifest.skills, "./skills/");

    const cachedHooks = JSON.parse(
      await readFile(
        join(installed.installedPath, "hooks", "hooks.json"),
        "utf8",
      ),
    );
    assert.deepEqual(Object.keys(cachedHooks.hooks), [
      "SessionStart",
      "PreToolUse",
      "PostToolUse",
      "PostToolUseFailure",
    ]);
    const demoArguments = [
      join(
        installed.installedPath,
        "skills",
        "fairytail-explain-concept",
        "scripts",
        "explain.mjs",
      ),
      "demo",
      "ko",
    ];
    const installedDemo = await runNode(demoArguments, {
      ...environment,
      FAIRYTAIL_DATA_DIR: "https://profile-resolution-must-not-run.invalid",
    });
    const sourceDemo = await runNode(
      [
        join(
          root,
          "skills",
          "fairytail-explain-concept",
          "scripts",
          "explain.mjs",
        ),
        "demo",
        "ko",
      ],
      environment,
    );
    assert.equal(installedDemo.stderr, "");
    assert.equal(installedDemo.stdout, sourceDemo.stdout);
    const sharedSkills = await readdir(
      join(installed.installedPath, "skills"),
      {
        withFileTypes: true,
      },
    );
    assert.equal(
      sharedSkills.filter((entry) => entry.isDirectory()).length,
      11,
    );

    const installedList = parseJson(
      (await runCodex(["plugin", "list", "--json"], environment)).stdout,
    );
    assert.equal(installedList.installed.length, 1);
    assert.equal(installedList.installed[0].enabled, true);

    const removed = parseJson(
      (
        await runCodex(
          ["plugin", "remove", "fairytail@fairytail", "--json"],
          environment,
        )
      ).stdout,
    );
    assert.equal(removed.pluginId, "fairytail@fairytail");

    const availableAfter = parseJson(
      (await runCodex(["plugin", "list", "--available", "--json"], environment))
        .stdout,
    );
    assert.deepEqual(availableAfter.installed, []);
    assert.equal(availableAfter.available[0].pluginId, "fairytail@fairytail");

    await runCodex(
      ["plugin", "marketplace", "remove", "fairytail"],
      environment,
    );
    assert.doesNotMatch(
      (await runCodex(["plugin", "marketplace", "list"], environment)).stdout,
      /^fairytail\s/mu,
    );

    return {
      status: "pass",
      codex: version,
      repositoryMarketplace: "fairytail@fairytail",
      marketplaceSource: marketplaceSource === root ? "local" : "remote",
      marketplaceRef: marketplaceRef || null,
      installedEnabled: true,
      cachedManifest: true,
      cachedHooks: 4,
      cachedSkills: 11,
      installedDemoParity: true,
      removed: true,
      disposableHomeRemoved: true,
    };
  } finally {
    await rm(smokeHome, { recursive: true, force: true });
  }
}

/** @param {string} path */
async function exists(path) {
  try {
    await readFile(path);
    return true;
  } catch {
    return false;
  }
}

/** @param {string} value */
function parseJson(value) {
  return JSON.parse(value);
}

/**
 * @param {string[]} args
 * @param {NodeJS.ProcessEnv} environment
 */
function runCodex(args, environment) {
  return runExecutable(codexBin, args, environment);
}

/**
 * @param {string[]} args
 * @param {NodeJS.ProcessEnv} environment
 */
function runNode(args, environment) {
  return runExecutable(process.execPath, args, environment);
}

/**
 * @param {string} executable
 * @param {string[]} args
 * @param {NodeJS.ProcessEnv} environment
 */
function runExecutable(executable, args, environment) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd: root,
      env: environment,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let commandStdout = "";
    let commandStderr = "";

    child.stdout.on("data", (chunk) => {
      commandStdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      commandStderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve({ stdout: commandStdout, stderr: commandStderr });
        return;
      }
      reject(
        new Error(
          `${executable} ${args.join(" ")} exited ${code}: ${commandStderr || commandStdout}`,
        ),
      );
    });
  });
}

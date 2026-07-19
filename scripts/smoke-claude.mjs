#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { stderr, stdout } from "node:process";
import { fileURLToPath } from "node:url";

import { VERIFIED_CLAUDE_CODE } from "../src/doctor.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const claudeBin = process.env.FAIRYTAIL_CLAUDE_BIN ?? "claude";
const marketplaceSource =
  process.env.FAIRYTAIL_MARKETPLACE_SOURCE?.trim() || root;

try {
  const result = await runSmoke();
  stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  stderr.write(`Fairytail Claude smoke failed: ${message}\n`);
  process.exitCode = 1;
}

async function runSmoke() {
  const smokeRoot = await mkdtemp(join(tmpdir(), "fairytail-claude-smoke-"));
  const configDir = join(smokeRoot, "config");
  const debug = {
    active: join(smokeRoot, "active.log"),
    safeMode: join(smokeRoot, "safe-mode.log"),
    disabled: join(smokeRoot, "disabled.log"),
  };
  /** @type {NodeJS.ProcessEnv} */
  const environment = { ...process.env, CLAUDE_CONFIG_DIR: configDir };
  delete environment.CLAUDE_PLUGIN_DATA;

  try {
    const version = (await runClaude(["--version"], environment)).stdout.trim();
    assert.equal(version, `${VERIFIED_CLAUDE_CODE} (Claude Code)`);

    await runClaude(["plugin", "validate", root, "--strict"], environment);
    await runClaude(
      ["plugin", "marketplace", "add", marketplaceSource, "--scope", "user"],
      environment,
    );
    await runClaude(
      ["plugin", "install", "fairytail@fairytail", "--scope", "user"],
      environment,
    );

    assert.equal(await enabledSetting(configDir), false);

    await runClaude(
      ["plugin", "enable", "fairytail@fairytail", "--scope", "user"],
      environment,
    );
    assert.equal(await enabledSetting(configDir), true);

    await runClaude(
      ["--init-only", "--debug", "hooks,plugins", "--debug-file", debug.active],
      environment,
    );
    const eventLog = await findFile(
      join(configDir, "plugins", "data"),
      "events.jsonl",
    );
    assert.ok(eventLog, "enabled SessionStart did not create events.jsonl");
    assert.equal(await lineCount(eventLog), 1);

    const activeDebug = await readFile(debug.active, "utf8");
    assert.match(activeDebug, /Registered 4 hooks from 1 plugins/);
    assert.match(activeDebug, /Total plugin skills loaded: 11/);
    assert.match(
      activeDebug,
      /Hook SessionStart:startup \(SessionStart\) success/,
    );

    let onboardSkillRoundTrip = false;
    let activeSessionStartEvents = 1;
    if (process.env.FAIRYTAIL_SMOKE_SKILLS === "1") {
      const skillResult = await runClaude(
        [
          "--print",
          "/fairytail:onboard",
          "--output-format",
          "json",
          "--no-session-persistence",
          "--permission-mode",
          "dontAsk",
          "--tools",
          "",
          "--max-budget-usd",
          "0.08",
        ],
        environment,
      );
      const result = JSON.parse(skillResult.stdout);
      const serialized = JSON.stringify(result);
      assert.equal(result.num_turns, 0);
      assert.equal(result.total_cost_usd, 0);
      assert.deepEqual(result.permission_denials, []);
      assert.doesNotMatch(serialized, /familiar_worlds|observed_experience/u);
      activeSessionStartEvents += 1;
      assert.equal(await lineCount(eventLog), activeSessionStartEvents);
      onboardSkillRoundTrip = true;
    }

    await runClaude(
      [
        "--safe-mode",
        "--init-only",
        "--debug",
        "hooks,plugins",
        "--debug-file",
        debug.safeMode,
      ],
      environment,
    );
    assert.equal(await lineCount(eventLog), activeSessionStartEvents);
    assert.match(
      await readFile(debug.safeMode, "utf8"),
      /safe mode disables plugins/,
    );

    await runClaude(
      ["plugin", "disable", "fairytail@fairytail", "--scope", "user"],
      environment,
    );
    assert.equal(await enabledSetting(configDir), false);

    await runClaude(
      [
        "--init-only",
        "--debug",
        "hooks,plugins",
        "--debug-file",
        debug.disabled,
      ],
      environment,
    );
    assert.equal(await lineCount(eventLog), activeSessionStartEvents);
    const disabledDebug = await readFile(debug.disabled, "utf8");
    assert.match(disabledDebug, /Registered 0 hooks from 0 plugins/);
    assert.match(disabledDebug, /Total plugin skills loaded: 0/);

    await runClaude(
      [
        "plugin",
        "uninstall",
        "fairytail@fairytail",
        "--scope",
        "user",
        "--keep-data",
        "--yes",
      ],
      environment,
    );
    assert.equal(await exists(eventLog), true);

    const eventText = await readFile(eventLog, "utf8");
    assert.doesNotMatch(
      eventText,
      /prompt|profile|toolInput|toolOutput|error|session_id|cwd/i,
    );

    return {
      status: "pass",
      claudeCode: version,
      strictValidation: true,
      repositoryMarketplace: "fairytail@fairytail",
      marketplaceSource: marketplaceSource === root ? "local" : "remote",
      installedDisabledByDefault: true,
      active: {
        sessionStartEvents: activeSessionStartEvents,
        hooksRegistered: 4,
        skillsLoaded: 11,
        onboardSkillRoundTrip,
      },
      optionalExplainerAgentIncluded: await exists(
        join(root, "agents", "fairytail-explainer.md"),
      ),
      optionalAnalogyMapperAgentIncluded: await exists(
        join(root, "agents", "fairytail-analogy-mapper.md"),
      ),
      optionalOutputStyleIncluded: await exists(
        join(root, "output-styles", "fairytail-friendly.md"),
      ),
      safeMode: {
        sessionStartEventsAdded: 0,
      },
      disabled: {
        sessionStartEventsAdded: 0,
        hooksRegistered: 0,
        skillsLoaded: 0,
      },
      uninstallKeepDataPreserved: true,
      privacyEnvelopeOnly: true,
      disposableConfigRemoved: true,
    };
  } finally {
    await rm(smokeRoot, { recursive: true, force: true });
  }
}

/**
 * @param {string[]} args
 * @param {NodeJS.ProcessEnv} environment
 */
function runClaude(args, environment) {
  return new Promise((resolve, reject) => {
    const child = spawn(claudeBin, args, {
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
          `${claudeBin} ${args.join(" ")} exited ${code}: ${commandStderr || commandStdout}`,
        ),
      );
    });
  });
}

/** @param {string} configDir */
async function enabledSetting(configDir) {
  const settings = JSON.parse(
    await readFile(join(configDir, "settings.json"), "utf8"),
  );
  return settings.enabledPlugins?.["fairytail@fairytail"];
}

/** @param {string} path */
async function lineCount(path) {
  const content = await readFile(path, "utf8");
  return content.split("\n").filter(Boolean).length;
}

/**
 * @param {string} directory
 * @param {string} name
 * @returns {Promise<string | undefined>}
 */
async function findFile(directory, name) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isFile() && entry.name === name) return path;
    if (entry.isDirectory()) {
      const match = await findFile(path, name);
      if (match) return match;
    }
  }
  return undefined;
}

/** @param {string} path */
async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

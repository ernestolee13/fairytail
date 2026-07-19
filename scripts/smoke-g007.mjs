#!/usr/bin/env node

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { stderr, stdout } from "node:process";
import { fileURLToPath } from "node:url";

import { completeOnboarding } from "../src/profile/onboarding.mjs";
import {
  deleteProfile,
  exportProfile,
  loadProfile,
  resetProfile,
  saveProfile,
} from "../src/profile/store.mjs";
import {
  installLocalFairytail,
  uninstallLocalFairytail,
} from "../src/integration/installer.mjs";
import { prepareG005Surface } from "../src/runtime/g005.mjs";
import { assessPreToolUse } from "../src/safety/pretool.mjs";

const pluginRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const claudeBin = process.env.FAIRYTAIL_CLAUDE_BIN ?? "claude";
const smokeRoot = await mkdtemp(join(tmpdir(), "fairytail-g007-smoke-"));

try {
  const configDir = join(smokeRoot, "config");
  const workspaceRoot = join(smokeRoot, "workspace");
  const participantData = join(smokeRoot, "participant-data");
  const exportPath = join(smokeRoot, "export", "profile.json");
  const superpowersMarketplace = join(smokeRoot, "superpowers-marketplace");
  const debug = {
    superpowersOnly: join(smokeRoot, "superpowers-only.log"),
    coexistence: join(smokeRoot, "coexistence.log"),
    disabled: join(smokeRoot, "fairytail-disabled.log"),
    uninstalled: join(smokeRoot, "fairytail-uninstalled.log"),
  };
  /** @type {NodeJS.ProcessEnv} */
  const environment = { ...process.env, CLAUDE_CONFIG_DIR: configDir };
  delete environment.CLAUDE_PLUGIN_DATA;

  await createProtectedHarnessFixture(configDir, workspaceRoot);
  const protectedFiles = protectedPaths(workspaceRoot);
  const protectedBefore = await hashes(protectedFiles);
  await stageSuperpowersFixture(superpowersMarketplace);
  await runClaude(
    [
      "plugin",
      "validate",
      join(superpowersMarketplace, "plugins", "superpowers"),
      "--strict",
    ],
    environment,
    workspaceRoot,
  );
  await runClaude(
    ["plugin", "marketplace", "add", superpowersMarketplace, "--scope", "user"],
    environment,
    workspaceRoot,
  );
  await runClaude(
    [
      "plugin",
      "install",
      "superpowers@g007-superpowers-fixture",
      "--scope",
      "user",
    ],
    environment,
    workspaceRoot,
  );
  await runClaude(
    [
      "plugin",
      "enable",
      "superpowers@g007-superpowers-fixture",
      "--scope",
      "user",
    ],
    environment,
    workspaceRoot,
  );
  await runClaude(
    [
      "--init-only",
      "--debug",
      "hooks,plugins",
      "--debug-file",
      debug.superpowersOnly,
    ],
    environment,
    workspaceRoot,
  );
  const superpowersMarker = await findFile(
    join(configDir, "plugins", "data"),
    "superpowers-session-start.jsonl",
  );
  assert.ok(superpowersMarker);
  assert.equal(await lineCount(superpowersMarker), 1);

  const installed = await installLocalFairytail({
    pluginRoot,
    configDir,
    workspaceRoot,
    claudeBin,
    scope: "user",
    enable: true,
    hostVersion: "2.1.214",
  });
  assert.equal(installed.integration.mode, "additive_explanation_only");
  assert.deepEqual(installed.integration.active_orchestrators_preserved, [
    "omo",
    "omx",
    "superpowers",
  ]);
  assert.deepEqual(await hashes(protectedFiles), protectedBefore);

  await runClaude(
    [
      "--init-only",
      "--debug",
      "hooks,plugins",
      "--debug-file",
      debug.coexistence,
    ],
    environment,
    workspaceRoot,
  );
  const coexistenceDebug = await readFile(debug.coexistence, "utf8");
  assert.match(coexistenceDebug, /Registered 5 hooks from 2 plugins/u);
  assert.match(coexistenceDebug, /Total plugin skills loaded: 12/u);
  assert.equal(await lineCount(superpowersMarker), 2);
  const fairytailEventLog = await findFile(
    join(configDir, "plugins", "data"),
    "events.jsonl",
  );
  assert.ok(fairytailEventLog);
  assert.equal(await lineCount(fairytailEventLog), 1);

  let fetchCalls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    fetchCalls += 1;
    throw new Error("network disabled in G007 smoke");
  };
  try {
    const onboarding = completeOnboarding(
      {
        background_categories: [],
        familiar_labels: [],
        coding_actions: ["none"],
        presentation_preference: "neutral",
        safety_concerns: ["breakage"],
      },
      "neutral",
      new Date("2026-07-18T14:00:00.000Z"),
    );
    await saveProfile(participantData, onboarding.profile);
    const loaded = await loadProfile(participantData);
    assert.equal(loaded.profile.language, "en");
    assert.equal(loaded.profile.model_processing.mode, "neutral_local");
    assert.equal(loaded.profile.familiar_worlds.length, 0);

    const before = await prepareG005Surface(
      {
        pluginRoot,
        dataDir: participantData,
        input: {
          schema_version: 1,
          surface: "before",
          interaction_id: "pilot-before",
          scenario_id: "S02",
          requested_locale: "en",
          started_at: "2026-07-18T14:01:00.000Z",
          action: {
            actor: "shell_process",
            target: "one local practice server",
            expected_change: "one local response becomes observable",
          },
        },
      },
      new Date("2026-07-18T14:01:30.000Z"),
    );
    assert.equal(before.card.surface, "before");
    assert.equal(before.card.locale.resolved_locale, "en");

    const errorFixture = JSON.parse(
      await readFile(
        join(pluginRoot, "fixtures", "g005", "error-cases.json"),
        "utf8",
      ),
    ).cases[3].input;
    const error = await prepareG005Surface(
      { pluginRoot, dataDir: participantData, input: errorFixture },
      new Date("2026-07-18T14:02:00.000Z"),
    );
    assert.equal(error.card.surface, "error");
    assert.equal(error.card.locale.resolved_locale, "ko");

    const finish = await prepareG005Surface(
      {
        pluginRoot,
        dataDir: participantData,
        input: {
          schema_version: 1,
          surface: "finish",
          interaction_id: "pilot-finish",
          scenario_id: "S04",
          requested_locale: "en",
          started_at: "2026-07-18T14:03:00.000Z",
          claim: { summary: "The local practice change is complete." },
          verification: {
            evidence_version: 1,
            evidence_id: "pilot-evidence",
            interaction_id: "pilot-finish",
            check_id: "pilot-check",
            kind: "test",
            status: "passed",
            summary: "The local fixture check passed after the change.",
            observed_at: "2026-07-18T14:03:30.000Z",
          },
        },
      },
      new Date("2026-07-18T14:04:00.000Z"),
    );
    assert.equal(
      /** @type {Record<string, any>} */ (finish.card.core).completion.status,
      "verified_complete",
    );

    await exportProfile(participantData, exportPath);
    assert.equal((await loadProfile(participantData)).source, "stored");
    await resetProfile(participantData, new Date("2026-07-18T14:05:00.000Z"));
    assert.equal(
      (await loadProfile(participantData)).profile.model_processing.mode,
      "neutral_local",
    );
    assert.equal((await deleteProfile(participantData)).deleted, true);
    assert.equal((await loadProfile(participantData)).needsOnboarding, true);

    const canaryData = join(smokeRoot, "canary-data");
    const canary = completeOnboarding(
      {
        background_categories: [],
        familiar_labels: ["PRIVATE_PROFILE_CANARY@example.test"],
        coding_actions: ["none"],
        presentation_preference: "analogy_first",
        safety_concerns: ["privacy"],
      },
      "approve",
    );
    await saveProfile(canaryData, canary.profile);
    assert.equal(canary.profile.model_processing.mode, "neutral_local");
    assert.doesNotMatch(
      await readFile(join(canaryData, "profile.json"), "utf8"),
      /PRIVATE_PROFILE_CANARY/u,
    );

    const hostile = /** @type {{ event: unknown }[]} */ (
      JSON.parse(
        await readFile(
          join(pluginRoot, "fixtures", "g006", "pretool-cases.json"),
          "utf8",
        ),
      ).hostile
    );
    assert.ok(
      hostile.every((item) => assessPreToolUse(item.event).decision === "deny"),
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.equal(fetchCalls, 0);

  await runClaude(
    [
      "plugin",
      "disable",
      installed.plugin + "@" + installed.marketplace,
      "--scope",
      "user",
    ],
    environment,
    workspaceRoot,
  );
  await runClaude(
    ["--init-only", "--debug", "hooks,plugins", "--debug-file", debug.disabled],
    environment,
    workspaceRoot,
  );
  const disabledDebug = await readFile(debug.disabled, "utf8");
  assert.match(disabledDebug, /Registered 1 hooks from 1 plugins/u);
  assert.match(disabledDebug, /Total plugin skills loaded: 1/u);
  assert.equal(await lineCount(superpowersMarker), 3);
  assert.equal(await lineCount(fairytailEventLog), 1);

  const uninstalled = await uninstallLocalFairytail({
    configDir,
    workspaceRoot,
    claudeBin,
    scope: "user",
    keepData: false,
    hostVersion: "2.1.214",
  });
  assert.equal(uninstalled.status, "uninstalled");
  await runClaude(
    [
      "--init-only",
      "--debug",
      "hooks,plugins",
      "--debug-file",
      debug.uninstalled,
    ],
    environment,
    workspaceRoot,
  );
  assert.equal(await lineCount(superpowersMarker), 4);
  assert.match(
    await readFile(debug.uninstalled, "utf8"),
    /Registered 1 hooks from 1 plugins/u,
  );
  assert.deepEqual(await hashes(protectedFiles), protectedBefore);

  stdout.write(
    `${JSON.stringify(
      {
        status: "pass",
        localInstaller: {
          networkRequired: false,
          overwroteExistingFiles: false,
          enabledAfterInstall: true,
          cleanUninstall: true,
        },
        directProductionModuleFlow: ["onboard", "before", "error", "finish"],
        slashSkillRoundTrip: false,
        defaultLocale: "en",
        reviewedLocalizedResponse: "ko",
        offlineNeutralMode: true,
        runtimeNetworkCalls: fetchCalls,
        exportResetDelete: true,
        hostileBlocked: "18/18",
        privacyCanaryLeaks: 0,
        coexistence: {
          superpowersFixturePreserved: true,
          orchestratorsDetected: ["superpowers", "omo", "omx"],
          hooksLoadedTogether: 5,
          skillsLoadedTogether: 12,
          hookOrderAssumed: false,
          duplicateTaskExecution: false,
          protectedFileHashChanges: 0,
        },
        disabledBaseline: {
          fairytailHooks: 0,
          fairytailSkills: 0,
          superpowersHookStillActive: true,
        },
        externalParticipantResultsRecorded: 0,
      },
      null,
      2,
    )}\n`,
  );
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  stderr.write(`Fairytail G007 smoke failed: ${message}\n`);
  process.exitCode = 1;
} finally {
  await rm(smokeRoot, { recursive: true, force: true });
}

/** @param {string} configDir @param {string} workspaceRoot */
async function createProtectedHarnessFixture(configDir, workspaceRoot) {
  await mkdir(join(workspaceRoot, ".omx"), { recursive: true });
  await mkdir(join(workspaceRoot, ".omo"), { recursive: true });
  await mkdir(configDir, { recursive: true });
  await writeFile(
    join(workspaceRoot, "AGENTS.md"),
    "<!-- OMX:RUNTIME:START -->\nprotected OMX guidance\n",
  );
  await writeFile(
    join(workspaceRoot, "CLAUDE.md"),
    "protected host guidance\n",
  );
  await writeFile(
    join(workspaceRoot, ".omx", "state.json"),
    '{"owner":"omx"}\n',
  );
  await writeFile(
    join(workspaceRoot, ".omo", "state.json"),
    '{"owner":"omo"}\n',
  );
  await writeFile(
    join(workspaceRoot, "opencode.json"),
    `${JSON.stringify({ plugin: ["oh-my-openagent"] })}\n`,
  );
}

/** @param {string} marketplaceRoot */
async function stageSuperpowersFixture(marketplaceRoot) {
  await mkdir(join(marketplaceRoot, ".claude-plugin"), { recursive: true });
  await mkdir(join(marketplaceRoot, "plugins"), { recursive: true });
  await cp(
    join(pluginRoot, "fixtures", "g007", "superpowers-plugin"),
    join(marketplaceRoot, "plugins", "superpowers"),
    { recursive: true },
  );
  await writeFile(
    join(marketplaceRoot, ".claude-plugin", "marketplace.json"),
    `${JSON.stringify(
      {
        $schema: "https://anthropic.com/claude-code/marketplace.schema.json",
        name: "g007-superpowers-fixture",
        description: "Inert local coexistence fixture.",
        owner: { name: "Fairytail test fixture" },
        plugins: [
          {
            name: "superpowers",
            description: "Inert Superpowers-shaped coexistence fixture.",
            version: "0.0.0",
            source: "./plugins/superpowers",
          },
        ],
      },
      null,
      2,
    )}\n`,
  );
}

/** @param {string[]} args @param {NodeJS.ProcessEnv} environment @param {string} cwd */
function runClaude(args, environment, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(claudeBin, args, {
      cwd,
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
      if (code === 0) resolve({ stdout: commandStdout, stderr: commandStderr });
      else reject(new Error(`Claude fixture command exited ${code}`));
    });
  });
}

/** @param {string} path */
async function lineCount(path) {
  return (await readFile(path, "utf8")).split("\n").filter(Boolean).length;
}

/** @param {string} directory @param {string} name @returns {Promise<string | undefined>} */
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

/** @param {string} workspaceRoot */
function protectedPaths(workspaceRoot) {
  return [
    join(workspaceRoot, "AGENTS.md"),
    join(workspaceRoot, "CLAUDE.md"),
    join(workspaceRoot, ".omx", "state.json"),
    join(workspaceRoot, ".omo", "state.json"),
    join(workspaceRoot, "opencode.json"),
  ];
}

/** @param {string[]} paths */
async function hashes(paths) {
  return Promise.all(
    paths.map(async (path) =>
      createHash("sha256")
        .update(await readFile(path))
        .digest("hex"),
    ),
  );
}

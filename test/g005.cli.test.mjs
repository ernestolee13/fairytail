import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const cli = join(root, "scripts", "fairytail-g005.mjs");

test("G005 CLI covers surface, observation, review, status, export, and reset without path leaks", async (context) => {
  const temporary = await mkdtemp(join(tmpdir(), "fairytail-g005-cli-"));
  context.after(() => rm(temporary, { recursive: true, force: true }));
  const dataDir = join(temporary, "data");
  const inputPath = join(temporary, "PRIVATE_PATH_CANARY.json");
  const observationPath = join(temporary, "PRIVATE_OBSERVATION_CANARY.json");
  const exportPath = join(temporary, "learning-export.json");
  await writeFile(inputPath, JSON.stringify(beforeInput()), { mode: 0o600 });

  const surface = await runCli([
    "surface",
    "--input",
    inputPath,
    "--data-dir",
    dataDir,
  ]);
  assert.equal(surface.code, 0);
  assert.equal(surface.stderr, "");
  assert.equal(JSON.parse(surface.stdout).card.surface, "before");
  assert.doesNotMatch(surface.stdout, /PRIVATE_PATH_CANARY/u);

  await writeFile(
    observationPath,
    JSON.stringify(observationInput(new Date().toISOString())),
    {
      mode: 0o600,
    },
  );
  const observed = await runCli([
    "observe",
    "--input",
    observationPath,
    "--data-dir",
    dataDir,
  ]);
  assert.equal(observed.code, 0);
  assert.equal(JSON.parse(observed.stdout).learning_state, "explained_once");
  assert.doesNotMatch(observed.stdout, /PRIVATE_OBSERVATION_CANARY/u);

  const status = JSON.parse(
    (await runCli(["status", "--data-dir", dataDir])).stdout,
  );
  assert.equal(status.concept_count, 1);
  assert.equal(status.states.explained_once, 1);
  assert.equal(status.raw_history_included, false);

  const review = JSON.parse(
    (await runCli(["review", "--data-dir", dataDir, "--locale", "ko"])).stdout,
  );
  assert.equal(review.raw_history_included, false);
  assert.equal(
    review.prompts.every(
      (/** @type {Record<string, any>} */ prompt) =>
        prompt.blocks_work === false,
    ),
    true,
  );

  assert.equal(
    (await runCli(["export", exportPath, "--data-dir", dataDir])).code,
    0,
  );
  assert.equal(
    JSON.parse(await readFile(exportPath, "utf8")).records.length,
    1,
  );
  assert.equal(
    JSON.parse((await runCli(["reset", "--data-dir", dataDir])).stdout).reset,
    true,
  );
  assert.equal(
    JSON.parse((await runCli(["status", "--data-dir", dataDir])).stdout)
      .concept_count,
    0,
  );

  const scenarios = JSON.parse((await runCli(["scenarios"])).stdout);
  assert.equal(scenarios.scenarios.length, 10);
  assert.equal(Object.hasOwn(scenarios, "profile"), false);
});

test("G005 CLI failures emit one generic JSON error", async (context) => {
  const temporary = await mkdtemp(join(tmpdir(), "fairytail-g005-cli-error-"));
  context.after(() => rm(temporary, { recursive: true, force: true }));
  const result = await runCli([
    "surface",
    "--input",
    join(temporary, "PRIVATE_PATH_CANARY.json"),
    "--data-dir",
    temporary,
    "--secret",
    "PRIVATE_SECRET_CANARY",
  ]);
  assert.equal(result.code, 1);
  assert.equal(result.stderr, "");
  assert.deepEqual(JSON.parse(result.stdout), {
    status: "error",
    code: "g005-operation-failed",
  });
  assert.doesNotMatch(result.stdout, /PRIVATE_/u);
});

function beforeInput() {
  return {
    schema_version: 1,
    surface: "before",
    interaction_id: "cli-before",
    scenario_id: "S04",
    requested_locale: "en",
    started_at: "2026-07-18T00:00:00.000Z",
    action: {
      actor: "remote_service",
      target: "one fictional read only task",
      expected_change: "one bounded response becomes observable",
    },
  };
}

/** @param {string} at */
function observationInput(at) {
  return {
    schema_version: 1,
    observation: "teachback",
    concept_id: "api-request-response",
    scenario_id: "S04",
    at,
    novel_context: false,
    rubric: {
      role_and_flow: 2,
      confusion_boundary: 2,
      analogy_limit: 2,
      safe_next_action: 2,
      fatal_misconception: false,
    },
  };
}

/** @param {string[]} args */
function runCli(args) {
  return new Promise((resolve, reject) => {
    execFile(
      process.execPath,
      [cli, ...args],
      { cwd: root },
      (error, stdout, stderr) => {
        if (error && typeof error.code !== "number") return reject(error);
        resolve({ code: error ? error.code : 0, stdout, stderr });
      },
    );
  });
}

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { loadAnalogyRuntime, resolveAnalogy } from "../src/analogy/engine.mjs";
import { createPersonalizationRequest } from "../src/analogy/personalized.mjs";
import { BUILD_LADDER } from "../src/build/contract.mjs";
import { completeOnboarding } from "../src/profile/onboarding.mjs";
import { saveProfile } from "../src/profile/store.mjs";
import { prepareG010Runtime } from "../src/runtime/g010.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const cli = join(root, "scripts", "fairytail-g010.mjs");
const now = new Date("2026-07-18T12:00:00.000Z");

test("stored approved profile produces reviewed personalized output without raw artifacts or effects", async (context) => {
  const temporary = await mkdtemp(join(tmpdir(), "fairytail-g010-runtime-"));
  context.after(() => rm(temporary, { recursive: true, force: true }));
  const dataDir = join(temporary, "data");
  const marker = join(temporary, "execution-marker");
  const checkScript = join(temporary, "must-not-run.mjs");
  await writeFile(
    checkScript,
    `import { writeFile } from "node:fs/promises"; await writeFile(${JSON.stringify(marker)}, "executed");\n`,
    "utf8",
  );
  const profile = personalizedProfile();
  await saveProfile(dataDir, profile);
  const analogyRuntime = await loadAnalogyRuntime(root, now);
  const prepared = createPersonalizationRequest(analogyRuntime, profile, "S04");
  assert.equal(prepared.status, "ready");
  if (prepared.status !== "ready") return;
  const primed = await resolveAnalogy(analogyRuntime, {
    profile,
    scenarioId: "S04",
    dataDir,
    personalizedCandidate: {
      schema_version: prepared.request.schema_version,
      request_id: prepared.request.request_id,
      source_context: prepared.request.familiar_contexts[0],
      analogy_label: "Restaurant kitchen workflow",
      role_bindings: {
        API: "Restaurant kitchen workflow",
        endpoint: "service counter",
        request: "order ticket",
        response: "prepared dish",
      },
    },
  });
  assert.equal(primed.kind, "mapped");

  const priorFetch = globalThis.fetch;
  let networkCalls = 0;
  globalThis.fetch = /** @type {typeof fetch} */ (
    async () => {
      networkCalls += 1;
      throw new Error("network forbidden in G010 runtime test");
    }
  );
  context.after(() => {
    globalThis.fetch = priorFetch;
  });

  const output = await prepareG010Runtime({
    pluginRoot: root,
    dataDir,
    input: runtimeInput(["node", checkScript]),
  });
  const serialized = JSON.stringify(output);

  assert.equal(output.status, "ready");
  assert.equal(Object.hasOwn(output, "profile_state"), false);
  assert.equal(output.analogy.kind, "mapped");
  assert.equal(output.deterministic_output.route, "deterministic");
  assert.equal(Object.hasOwn(output, "user_facing_render"), false);
  assert.deepEqual(output.route_recommendation, {
    route: "deterministic_inline",
    model: null,
    fallback: "codex-model-route-disabled",
    parent_model_changed: false,
  });
  assert.deepEqual(output.effects, {
    network_calls: 0,
    model_calls: 0,
    execution_calls: 0,
  });
  assert.equal(networkCalls, 0);
  await assert.rejects(access(marker));
  assert.equal(recursivelyFrozen(output), true);
  for (const canary of [
    "PrivateProfileCanary",
    "PRIVATE_PATH_CANARY",
    "PRIVATE_PROMPT_CANARY",
    "PRIVATE_CODE_CANARY",
    "PRIVATE_SECRET_CANARY",
    checkScript,
  ]) {
    assert.equal(serialized.includes(canary), false, canary);
  }
});

test("stored local-only profile keeps the reviewed scenario neutral", async (context) => {
  const temporary = await mkdtemp(join(tmpdir(), "fairytail-g010-neutral-"));
  context.after(() => rm(temporary, { recursive: true, force: true }));
  const dataDir = join(temporary, "data");
  await saveProfile(dataDir, neutralProfile());

  const input = runtimeInput(["node", "--test", "test/runtime.g010.test.mjs"]);
  input.routing.explicit_opt_in = false;
  const output = await prepareG010Runtime({
    pluginRoot: root,
    dataDir,
    input,
  });

  assert.equal(Object.hasOwn(output, "profile_state"), false);
  assert.equal(output.analogy.kind, "neutral");
  assert.equal(output.analogy.reason, "neutral-local");
  assert.equal(output.route_recommendation.route, "deterministic_inline");
  assert.equal(
    output.route_recommendation.fallback,
    "explicit-opt-in-required",
  );
  assert.equal(JSON.stringify(output).includes("NeutralProfileCanary"), false);
});

test("runtime input and options are closed before local preparation", async () => {
  const valid = runtimeInput(["node", "--test", "test/runtime.g010.test.mjs"]);
  await assert.rejects(
    prepareG010Runtime({ pluginRoot: root, dataDir: root, input: null }),
    /plain object/u,
  );
  await assert.rejects(
    prepareG010Runtime({
      pluginRoot: root,
      dataDir: root,
      input: { ...valid, prompt: "PRIVATE_PROMPT_CANARY" },
    }),
    /exactly/u,
  );
  await assert.rejects(
    prepareG010Runtime({
      pluginRoot: root,
      dataDir: root,
      input: {
        ...valid,
        routing: {
          ...valid.routing,
          work: { ...valid.routing.work, raw_code: "PRIVATE_CODE_CANARY" },
        },
      },
    }),
    /exactly/u,
  );
  await assert.rejects(
    prepareG010Runtime({
      pluginRoot: root,
      dataDir: root,
      input: {
        ...valid,
        build_decision: {
          ...valid.build_decision,
          secret: "PRIVATE_SECRET_CANARY",
        },
      },
    }),
    /unknown-field/u,
  );
  await assert.rejects(
    prepareG010Runtime({
      pluginRoot: root,
      dataDir: root,
      input: valid,
      extra: true,
    }),
    /exactly/u,
  );
});

test("production adapter contains no execution, model, or network invocation surface", async () => {
  const source = await readFile(
    join(root, "src", "runtime", "g010.mjs"),
    "utf8",
  );
  assert.doesNotMatch(source, /node:child_process/u);
  assert.doesNotMatch(source, /\b(?:exec|execFile|spawn|fork)\s*\(/u);
  assert.doesNotMatch(source, /\bfetch\s*\(/u);
  assert.doesNotMatch(source, /(?:anthropic|openai)\.(?:messages|responses)/iu);
});

test("prepare CLI succeeds end-to-end and emits one generic JSON error on failure", async (context) => {
  const temporary = await mkdtemp(join(tmpdir(), "fairytail-g010-cli-"));
  context.after(() => rm(temporary, { recursive: true, force: true }));
  const dataDir = join(temporary, "data");
  const inputPath = join(temporary, "PRIVATE_PATH_CANARY.json");
  await saveProfile(dataDir, neutralProfile());
  await writeFile(
    inputPath,
    JSON.stringify(
      runtimeInput(["node", "--test", "test/runtime.g010.test.mjs"]),
    ),
    "utf8",
  );

  const success = await runCli([
    "prepare",
    "--input",
    inputPath,
    "--data-dir",
    dataDir,
  ]);
  assert.equal(success.code, 0);
  assert.equal(success.stderr, "");
  assert.equal(JSON.parse(success.stdout).status, "ready");
  assert.equal(success.stdout.includes(inputPath), false);
  assert.equal(success.stdout.includes("PRIVATE_PATH_CANARY"), false);

  const failure = await runCli([
    "prepare",
    "--input",
    inputPath,
    "--data-dir",
    dataDir,
    "--extra",
    "PRIVATE_SECRET_CANARY",
  ]);
  assert.equal(failure.code, 1);
  assert.equal(failure.stderr, "");
  assert.deepEqual(JSON.parse(failure.stdout), {
    status: "error",
    code: "g010-prepare-failed",
  });
  assert.equal(failure.stdout.includes(inputPath), false);
  assert.equal(failure.stdout.includes("PRIVATE_SECRET_CANARY"), false);
});

function personalizedProfile() {
  const completed = completeOnboarding(
    {
      familiar_contexts: ["Restaurant kitchen workflow"],
      familiar_anchors: [
        "PrivateProfileCanary",
        "service counter",
        "order ticket",
        "prepared dish",
      ],
      coding_actions: ["none"],
      presentation_preference: "analogy_first",
      safety_concerns: ["privacy"],
      language: "ko",
    },
    "approve",
    now,
  );
  assert.equal(completed.approved, true);
  return completed.profile;
}

function neutralProfile() {
  return completeOnboarding(
    {
      background_categories: ["education"],
      familiar_labels: ["NeutralProfileCanary"],
      coding_actions: ["none"],
      presentation_preference: "neutral",
      safety_concerns: ["none"],
      language: "en",
    },
    "neutral",
    now,
  ).profile;
}

/** @param {string[]} argv */
function runtimeInput(argv) {
  const selected = BUILD_LADDER.indexOf("standard_library");
  return {
    schema_version: 1,
    scenario_id: "S04",
    requested_locale: "ko-KR",
    build_decision: {
      task: {
        summary: "Prepare a verified beginner explanation",
        requested_outcome: "PRIVATE_PROMPT_CANARY",
        explicit_requirements: [
          "Keep PRIVATE_CODE_CANARY out of the response",
          "Keep PRIVATE_SECRET_CANARY out of the response",
        ],
        implementation_required: true,
      },
      trace: {
        completed_before_ladder: true,
        entry_point: "src/PRIVATE_PATH_CANARY.mjs:main",
        flow: ["main -> prepare", "prepare -> render"],
        callers: ["scripts/PRIVATE_PATH_CANARY.mjs:main"],
        shared_root: "src/PRIVATE_PATH_CANARY.mjs:prepare",
        evidence: ["The production and test callers were traced"],
      },
      safety: {
        trust_boundary_validation: disposition(true),
        data_loss_prevention: disposition(false),
        security: disposition(false),
        accessibility: disposition(false),
        explicit_requirements: disposition(true),
        hardware_calibration: disposition(false),
      },
      complexity: { kinds: ["nontrivial"] },
      ladder: BUILD_LADDER.map((rung, index) => ({
        rung,
        status:
          index < selected
            ? "does_not_satisfy"
            : index === selected
              ? "satisfies"
              : "not_evaluated",
        evidence: `${rung} evidence`,
      })),
      runnable_check: {
        argv,
        expected_evidence: "The focused runtime test passes",
      },
    },
    producer: {
      role: "primary_reasoning_model",
      model_id: "gpt-5.5",
      packet_validated: true,
      parent_model_changed: false,
    },
    verified_task_result: {
      result_id: "g010-runtime",
      status: "verified",
      outcome: "changed",
      summary: "The requested runtime boundary passed its focused checks.",
      verification: {
        check_id: "runtime-tests",
        status: "passed",
        evidence_id: "runtime-run-g010",
      },
    },
    routing: {
      explicit_opt_in: true,
      host: "codex",
      capabilities: {
        pluginAgent: false,
        separatelyInstalled: true,
        agentName: "fairytail-explainer",
        model: "gpt-5.5",
      },
      work: {
        presentation_only: true,
        ambiguity_resolved: true,
        result_verified: true,
        code_decision: false,
        reasoning_decision: false,
        safety_decision: false,
        security_decision: false,
        verification_decision: false,
      },
    },
  };
}

/** @param {boolean} applicable */
function disposition(applicable) {
  return {
    applicable,
    status: applicable ? "preserved" : "not_applicable",
    evidence: "Reviewed against the traced flow",
  };
}

/** @param {unknown} value */
function recursivelyFrozen(value) {
  if (typeof value !== "object" || value === null) return true;
  return (
    Object.isFrozen(value) && Object.values(value).every(recursivelyFrozen)
  );
}

/** @param {string[]} args @returns {Promise<{ code: number, stdout: string, stderr: string }>} */
function runCli(args) {
  return new Promise((resolvePromise) => {
    execFile(
      process.execPath,
      [cli, ...args],
      { cwd: root, encoding: "utf8" },
      (error, stdout, stderr) => {
        resolvePromise({
          code:
            error && typeof error.code === "number"
              ? error.code
              : error
                ? 1
                : 0,
          stdout,
          stderr,
        });
      },
    );
  });
}

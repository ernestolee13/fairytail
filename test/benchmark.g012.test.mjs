import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { promisify } from "node:util";

import { evaluateG012ReadmeVisual } from "../src/benchmark/g012-performance.mjs";
import {
  DIRECT_CONCEPT_BUNDLE_MAX_OUTPUT_BYTES,
  DIRECT_CONCEPT_MAX_OUTPUT_BYTES,
  prepareDirectConceptBundle,
} from "../src/runtime/concept.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const runFile = promisify(execFile);

test("the committed current release report is reproducible", async () => {
  const { stdout } = await runFile(process.execPath, [
    join(root, "scripts", "verify-g012-performance.mjs"),
  ]);
  const result = JSON.parse(stdout);
  assert.equal(result.status, "pass");
  assert.equal(result.direct_explanation.rendered_cases, 52);
  assert.equal(result.direct_explanation.passed_cases, 52);
  assert.equal(result.direct_explanation.maximum_output_bytes, 1013);
  assert.equal(result.direct_explanation.output_limit_bytes, 4 * 1024);
  assert.deepEqual(result.direct_explanation.effects, {
    model_calls: 0,
    network_calls: 0,
    execution_calls: 0,
  });
  assert.deepEqual(result.activation.automatic_for_nontrivial_implementation, [
    "build",
  ]);
  assert.deepEqual(result.activation.manual_companion_workflows, [
    "before",
    "finish",
    "personalize",
  ]);
  assert.equal(result.activation.strategy, "host-semantic-skill-description");
  assert.equal(result.activation.labeled_prompts, 64);
  assert.equal(result.activation.concept_prompts, 48);
  assert.equal(result.activation.rich_concept_prompts, 24);
  assert.equal(result.activation.default_concept_prompts, 24);
  assert.equal(result.activation.build_prompts, 16);
  assert.equal(result.activation.minimal_build_prompts, 8);
  assert.equal(result.activation.default_build_prompts, 8);
  assert.deepEqual(result.activation.locales, { en: 32, ko: 32 });
  assert.equal(result.activation.user_prompt_submit_hook, false);
  assert.equal(result.activation.prompt_hook_context_bytes, 0);
  assert.ok(
    result.activation.measured_skill_description_bytes_before_host_framing > 0,
  );
  assert.ok(
    result.activation.measured_skill_description_bytes_before_host_framing <
      2_560,
  );
  assert.equal(
    result.activation.skill_description_limit_bytes_before_host_framing,
    2_560,
  );
  assert.deepEqual(result.alias_bundle_deduplication, {
    requested_aliases: 3,
    rendered_scenarios: 1,
    output_bytes: 1013,
    effects: {
      model_calls: 0,
      network_calls: 0,
      execution_calls: 0,
    },
  });
});

test("the explicit initial-design bundle remains small and local", async () => {
  const output = await prepareDirectConceptBundle({
    pluginRoot: root,
    dataDir: null,
    concepts: ["api", "server", "database"],
    requestedLocale: "ko",
  });
  assert.equal(output.items.length, 3);
  assert.ok(
    output.items.every(
      (item) => item.output_bytes <= DIRECT_CONCEPT_MAX_OUTPUT_BYTES,
    ),
  );
  assert.match(
    output.explanation,
    /앱 → API 요청 → 서버 로직 → 데이터베이스 쿼리 → 서버 응답 → 앱/u,
  );
  assert.doesNotMatch(output.explanation, /\n\n---\n\n/u);
  assert.ok(output.output_bytes <= 2_400);
  assert.ok(output.output_bytes <= DIRECT_CONCEPT_BUNDLE_MAX_OUTPUT_BYTES);
  assert.deepEqual(output.effects, {
    model_calls: 0,
    network_calls: 0,
    execution_calls: 0,
  });
});

test("the README visual rejects altered claim boundaries", async () => {
  const path = join(
    root,
    "docs",
    "assets",
    "evidence",
    "jargon-to-clarity.json",
  );
  const evidence = JSON.parse(await readFile(path, "utf8"));
  assert.equal(evaluateG012ReadmeVisual(evidence).passed, true);

  const altered = structuredClone(evidence);
  altered.production_personalization_path_exercised = true;
  altered.claim_boundary = "This proves that every beginner understands it.";
  assert.equal(evaluateG012ReadmeVisual(altered).passed, false);
});

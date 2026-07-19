#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { performance } from "node:perf_hooks";
import { stdout } from "node:process";
import { fileURLToPath } from "node:url";

import { genericAnalogyForScenario } from "../src/runtime/generic-analogy.mjs";
import {
  DIRECT_CONCEPT_ALIASES,
  DIRECT_CONCEPT_BUNDLE_MAX_OUTPUT_BYTES,
  DIRECT_CONCEPT_MAX_OUTPUT_BYTES,
  prepareDirectConcept,
  prepareDirectConceptBundle,
} from "../src/runtime/concept.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
/** @type {readonly ("en" | "ko")[]} */
const LOCALES = ["en", "ko"];
const activationFixture = JSON.parse(
  await readFile(
    join(root, "fixtures", "activation", "v2", "cases.json"),
    "utf8",
  ),
);
const hooks = JSON.parse(
  await readFile(join(root, "hooks", "hooks.json"), "utf8"),
);
const conceptSkill = await readFile(
  join(root, "skills", "fairytail-explain-concept", "SKILL.md"),
  "utf8",
);
const conceptMetadata = await readFile(
  join(root, "skills", "fairytail-explain-concept", "agents", "openai.yaml"),
  "utf8",
);
const description = conceptSkill.match(/^description:\s*(.+)$/mu)?.[1] ?? "";
const skillDescriptionBytes = await totalSkillDescriptionBytes([
  "before",
  "build",
  "doctor",
  "error",
  "fairytail-explain-concept",
  "finish",
  "onboard",
  "personalize",
  "profile",
  "review",
  "safety",
]);
const routeCounts = countBy(activationFixture.cases, "expected_route");
const localeCounts = countBy(activationFixture.cases, "locale");
const buildRouteCounts = countBy(
  activationFixture.build_cases,
  "expected_route",
);
const buildLocaleCounts = countBy(activationFixture.build_cases, "locale");
const durations = [];
let maximumOutputBytes = 0;
let modelCalls = 0;
let networkCalls = 0;
let executionCalls = 0;

invariant(activationFixture.schema_version === 3, "activation schema drifted");
invariant(activationFixture.cases.length === 48, "activation corpus drifted");
invariant(
  routeCounts.rich === 24 && routeCounts.default === 24,
  "activation routes are not balanced",
);
invariant(
  localeCounts.en === 24 && localeCounts.ko === 24,
  "activation locales are not balanced",
);
invariant(
  activationFixture.build_cases.length === 16 &&
    buildRouteCounts.minimal === 8 &&
    buildRouteCounts.default === 8 &&
    buildLocaleCounts.en === 8 &&
    buildLocaleCounts.ko === 8,
  "build activation corpus drifted",
);
invariant(
  !Object.hasOwn(hooks.hooks, "UserPromptSubmit"),
  "a duplicate prompt keyword router is installed",
);
invariant(
  Buffer.byteLength(description, "utf8") <= 1_536 &&
    /confus|do not understand/iu.test(description) &&
    /beginner|plain.language/iu.test(description) &&
    /analogy/iu.test(description) &&
    /initial.{0,20}(?:design|architecture)/iu.test(description) &&
    /ordinary.{0,20}definition/iu.test(description) &&
    /coding|implementation|fixing|reviewing/iu.test(description),
  "concept skill description lost its semantic selection boundary",
);
invariant(
  /^\s*allow_implicit_invocation: true$/mu.test(conceptMetadata),
  "Codex implicit concept selection is disabled",
);
invariant(
  skillDescriptionBytes <= 2_560,
  "shared skill descriptions exceed the fixed listing budget",
);

for (const concept of DIRECT_CONCEPT_ALIASES) {
  for (const requestedLocale of LOCALES) {
    const started = performance.now();
    const result = await prepareDirectConcept({
      pluginRoot: root,
      dataDir: null,
      concept,
      requestedLocale,
    });
    const elapsed = performance.now() - started;
    durations.push(elapsed);
    maximumOutputBytes = Math.max(maximumOutputBytes, result.output_bytes);
    modelCalls += result.effects.model_calls;
    networkCalls += result.effects.network_calls;
    executionCalls += result.effects.execution_calls;
    invariant(
      result.status === "ready",
      `${concept}/${requestedLocale} failed`,
    );
    invariant(
      result.route === "deterministic_inline",
      `${concept}/${requestedLocale} left the direct route`,
    );
    invariant(
      result.output_bytes <= DIRECT_CONCEPT_MAX_OUTPUT_BYTES,
      `${concept}/${requestedLocale} exceeded the output bound`,
    );
    invariant(elapsed < 2_000, `${concept}/${requestedLocale} exceeded 2s`);
  }
}

invariant(modelCalls === 0, "direct concept route made a model call");
invariant(networkCalls === 0, "direct concept route made a network call");
invariant(executionCalls === 0, "direct concept route executed a command");

/** @type {Record<"en" | "ko", string[]>} */
const genericLabels = { en: [], ko: [] };
for (let index = 1; index <= 10; index += 1) {
  const scenarioId = `S${String(index).padStart(2, "0")}`;
  for (const locale of LOCALES) {
    const analogy = genericAnalogyForScenario(scenarioId, locale);
    if (analogy === null) {
      throw new Error(`${scenarioId}/${locale} lost its analogy`);
    }
    genericLabels[locale].push(analogy.label);
    invariant(
      analogy.relations.length >= 2 && analogy.breakpoint.length > 40,
      `${scenarioId}/${locale} analogy is structurally incomplete`,
    );
  }
}
for (const locale of LOCALES) {
  invariant(
    new Set(genericLabels[locale]).size === 10,
    `${locale} generic analogies are not concept-specific`,
  );
}

const designBundle = await prepareDirectConceptBundle({
  pluginRoot: root,
  dataDir: null,
  concepts: ["api", "server", "database"],
  requestedLocale: "ko",
});
invariant(designBundle.items.length === 3, "design bundle lost a concept");
invariant(
  designBundle.output_bytes <= DIRECT_CONCEPT_BUNDLE_MAX_OUTPUT_BYTES,
  "design bundle exceeded the output bound",
);
invariant(
  designBundle.effects.model_calls === 0 &&
    designBundle.effects.network_calls === 0 &&
    designBundle.effects.execution_calls === 0,
  "design bundle crossed a model, network, or execution boundary",
);
const duplicateScenarioBundle = await prepareDirectConceptBundle({
  pluginRoot: root,
  dataDir: null,
  concepts: ["api-key", "access-token", "llm-token"],
  requestedLocale: "ko",
});
invariant(
  duplicateScenarioBundle.items.length === 1 &&
    duplicateScenarioBundle.concepts.length === 3 &&
    duplicateScenarioBundle.output_bytes <= DIRECT_CONCEPT_MAX_OUTPUT_BYTES,
  "same-scenario aliases were rendered more than once",
);

const buildSkill = await readFile(
  join(root, "skills", "build", "SKILL.md"),
  "utf8",
);
const buildMetadata = await readFile(
  join(root, "skills", "build", "agents", "openai.yaml"),
  "utf8",
);
invariant(
  /non-trivial implementation/u.test(buildSkill) &&
    /Design-only, explanation-only/u.test(buildSkill) &&
    /single literal, label, comment, copy/u.test(buildSkill) &&
    /^\s*allow_implicit_invocation: true$/mu.test(buildMetadata),
  "build skill lost its narrow semantic boundary",
);

for (const skillName of ["before", "finish", "personalize"]) {
  const skill = await readFile(
    join(root, "skills", skillName, "SKILL.md"),
    "utf8",
  );
  const metadata = await readFile(
    join(root, "skills", skillName, "agents", "openai.yaml"),
    "utf8",
  );
  invariant(
    /Manual command only/u.test(skill) && /manual-only/u.test(skill),
    `${skillName} does not declare its manual boundary`,
  );
  invariant(
    /^\s*allow_implicit_invocation: false$/mu.test(metadata),
    `${skillName} is not manual-only in Codex`,
  );
}

for (const skillName of ["doctor", "profile"]) {
  const skill = await readFile(
    join(root, "skills", skillName, "SKILL.md"),
    "utf8",
  );
  const metadata = await readFile(
    join(root, "skills", skillName, "agents", "openai.yaml"),
    "utf8",
  );
  invariant(
    /Manual command only/u.test(skill) &&
      /^\s*allow_implicit_invocation: false$/mu.test(metadata),
    `${skillName} management may activate implicitly`,
  );
}

invariant(
  !/src\/|schemas?\/|tests?\/|prepareG010Runtime|build_decision/u.test(
    conceptSkill,
  ),
  "concept skill invites repository discovery",
);

durations.sort((left, right) => left - right);
stdout.write(
  `${JSON.stringify({
    status: "pass",
    rendered_cases: durations.length,
    aliases: DIRECT_CONCEPT_ALIASES.length,
    locales: 2,
    median_ms: round(percentile(durations, 0.5)),
    max_ms: round(durations.at(-1) ?? 0),
    max_output_bytes: maximumOutputBytes,
    output_limit_bytes: DIRECT_CONCEPT_MAX_OUTPUT_BYTES,
    effects: {
      model_calls: modelCalls,
      network_calls: networkCalls,
      execution_calls: executionCalls,
    },
    generic_analogy_contract: {
      reviewed_concept_families: 10,
      unique_labels_per_locale: 10,
      explicit_breakpoint_per_family: true,
    },
    initial_design_bundle: {
      concepts: designBundle.concepts,
      output_bytes: designBundle.output_bytes,
      output_limit_bytes: DIRECT_CONCEPT_BUNDLE_MAX_OUTPUT_BYTES,
      effects: designBundle.effects,
    },
    alias_bundle_deduplication: {
      requested_aliases: duplicateScenarioBundle.concepts.length,
      rendered_scenarios: duplicateScenarioBundle.items.length,
      output_bytes: duplicateScenarioBundle.output_bytes,
    },
    automatic_for_nontrivial_implementation: ["build"],
    manual_workflows: ["before", "finish", "personalize"],
    activation_contract: {
      strategy: "host-semantic-skill-description",
      labeled_prompts:
        activationFixture.cases.length + activationFixture.build_cases.length,
      concept_prompts: activationFixture.cases.length,
      rich_concept_prompts: routeCounts.rich,
      default_concept_prompts: routeCounts.default,
      build_prompts: activationFixture.build_cases.length,
      minimal_build_prompts: buildRouteCounts.minimal,
      default_build_prompts: buildRouteCounts.default,
      locales: {
        en: localeCounts.en + buildLocaleCounts.en,
        ko: localeCounts.ko + buildLocaleCounts.ko,
      },
      user_prompt_submit_hook: false,
      always_on_hook_context_bytes: 0,
      shared_skill_description_bytes_before_host_framing: skillDescriptionBytes,
      shared_skill_description_limit_bytes: 2_560,
      note: "The corpus is a product intent contract; live host probes measure selection accuracy.",
    },
  })}\n`,
);

/** @param {Array<Record<string, any>>} entries @param {string} key */
function countBy(entries, key) {
  return entries.reduce((counts, entry) => {
    counts[entry[key]] = (counts[entry[key]] ?? 0) + 1;
    return counts;
  }, {});
}

/** @param {string[]} names */
async function totalSkillDescriptionBytes(names) {
  let total = 0;
  for (const name of names) {
    const skill = await readFile(
      join(root, "skills", name, "SKILL.md"),
      "utf8",
    );
    const value = skill.match(/^description:\s*(.+)$/mu)?.[1] ?? "";
    total += Buffer.byteLength(value.replace(/^"|"$/gu, ""), "utf8");
  }
  return total;
}

/** @param {boolean} condition @param {string} message */
function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

/** @param {number[]} values @param {number} quantile */
function percentile(values, quantile) {
  const index = (values.length - 1) * quantile;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return values[lower];
  const weight = index - lower;
  return values[lower] * (1 - weight) + values[upper] * weight;
}

/** @param {number} value */
function round(value) {
  return Math.round(value * 10) / 10;
}

#!/usr/bin/env node

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { evaluateG012ReadmeVisual } from "../src/benchmark/g012-performance.mjs";
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
const sharedSkillNames = [
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
];
const artifactPath = join(
  root,
  "benchmarks",
  "current",
  "output-efficiency.json",
);
const sourcePaths = [
  "README.md",
  "README.ko.md",
  "ARCHITECTURE.md",
  "docs/PERFORMANCE.md",
  "docs/PUBLIC_INSTALL_AND_SAMPLES.md",
  "docs/assets/evidence/terminal-evidence.json",
  "docs/assets/evidence/jargon-to-clarity.json",
  "src/runtime/concept.mjs",
  "src/runtime/generic-analogy.mjs",
  "src/profile/data-dir.mjs",
  "src/profile/profile.mjs",
  "src/profile/privacy.mjs",
  "src/analogy/engine.mjs",
  "src/learning/terminal.mjs",
  "src/benchmark/g012-performance.mjs",
  "src/explanation/router.mjs",
  "hooks/hooks.json",
  "skills/fairytail-explain-concept/SKILL.md",
  "skills/fairytail-explain-concept/scripts/explain.mjs",
  "skills/fairytail-explain-concept/agents/openai.yaml",
  "skills/build/SKILL.md",
  "skills/build/agents/openai.yaml",
  "skills/before/SKILL.md",
  "skills/before/agents/openai.yaml",
  "skills/finish/SKILL.md",
  "skills/finish/agents/openai.yaml",
  "skills/personalize/SKILL.md",
  "skills/personalize/agents/openai.yaml",
  "skills/doctor/SKILL.md",
  "skills/doctor/agents/openai.yaml",
  "skills/error/SKILL.md",
  "skills/onboard/SKILL.md",
  "skills/onboard/agents/openai.yaml",
  "skills/profile/SKILL.md",
  "skills/profile/agents/openai.yaml",
  "skills/review/SKILL.md",
  "skills/safety/SKILL.md",
  "scripts/verify-context-gate.mjs",
  "scripts/verify-g012-performance.mjs",
  "scripts/fairytail-profile.mjs",
  "scripts/fairytail-doctor.mjs",
  "scripts/fairytail-personalize.mjs",
  "scripts/smoke-codex-beginner.mjs",
  "fixtures/activation/v2/cases.json",
  "test/context-gate.test.mjs",
  "test/activation.contract.test.mjs",
];

const documents = Object.fromEntries(
  await Promise.all(
    [
      "README.md",
      "README.ko.md",
      "ARCHITECTURE.md",
      "docs/PERFORMANCE.md",
      "docs/PUBLIC_INSTALL_AND_SAMPLES.md",
    ].map(async (path) => [path, await readFile(join(root, path), "utf8")]),
  ),
);
const terminalEvidence = JSON.parse(
  await readFile(
    join(root, "docs", "assets", "evidence", "terminal-evidence.json"),
    "utf8",
  ),
);
const visualEvidence = JSON.parse(
  await readFile(
    join(root, "docs", "assets", "evidence", "jargon-to-clarity.json"),
    "utf8",
  ),
);
const activationFixture = JSON.parse(
  await readFile(
    join(root, "fixtures", "activation", "v2", "cases.json"),
    "utf8",
  ),
);
const hooks = JSON.parse(
  await readFile(join(root, "hooks", "hooks.json"), "utf8"),
);

const outputs = [];
for (const concept of DIRECT_CONCEPT_ALIASES) {
  for (const requestedLocale of LOCALES) {
    outputs.push(
      await prepareDirectConcept({
        pluginRoot: root,
        dataDir: null,
        concept,
        requestedLocale,
      }),
    );
  }
}
const bundle = await prepareDirectConceptBundle({
  pluginRoot: root,
  dataDir: null,
  concepts: ["api", "server", "database"],
  requestedLocale: "ko",
});
const duplicateScenarioBundle = await prepareDirectConceptBundle({
  pluginRoot: root,
  dataDir: null,
  concepts: ["api-key", "access-token", "llm-token"],
  requestedLocale: "ko",
});
const maximumOutputBytes = Math.max(
  ...outputs.map((output) => output.output_bytes),
);
const effects = outputs.reduce(
  (totals, output) => ({
    model_calls: totals.model_calls + output.effects.model_calls,
    network_calls: totals.network_calls + output.effects.network_calls,
    execution_calls: totals.execution_calls + output.effects.execution_calls,
  }),
  { model_calls: 0, network_calls: 0, execution_calls: 0 },
);
const buildSkill = await readFile(
  join(root, "skills", "build", "SKILL.md"),
  "utf8",
);
const buildMetadata = await readFile(
  join(root, "skills", "build", "agents", "openai.yaml"),
  "utf8",
);
const manualSkills = await Promise.all(
  ["before", "finish", "personalize"].map(async (name) => ({
    name,
    skill: await readFile(join(root, "skills", name, "SKILL.md"), "utf8"),
    metadata: await readFile(
      join(root, "skills", name, "agents", "openai.yaml"),
      "utf8",
    ),
  })),
);
const manualManagementSkills = await Promise.all(
  ["doctor", "profile"].map(async (name) => ({
    name,
    skill: await readFile(join(root, "skills", name, "SKILL.md"), "utf8"),
    metadata: await readFile(
      join(root, "skills", name, "agents", "openai.yaml"),
      "utf8",
    ),
  })),
);
const conceptSkill = await readFile(
  join(root, "skills", "fairytail-explain-concept", "SKILL.md"),
  "utf8",
);
const conceptMetadata = await readFile(
  join(root, "skills", "fairytail-explain-concept", "agents", "openai.yaml"),
  "utf8",
);
const conceptDescription =
  conceptSkill.match(/^description:\s*(.+)$/mu)?.[1] ?? "";
const sharedSkillDescriptionBytes = (
  await Promise.all(
    sharedSkillNames.map(async (name) =>
      readFile(join(root, "skills", name, "SKILL.md"), "utf8"),
    ),
  )
).reduce((total, skill) => {
  const value = skill.match(/^description:\s*(.+)$/mu)?.[1] ?? "";
  return total + Buffer.byteLength(value.replace(/^"|"$/gu, ""), "utf8");
}, 0);
const activationRoutes = countBy(activationFixture.cases, "expected_route");
const activationLocales = countBy(activationFixture.cases, "locale");
const buildActivationRoutes = countBy(
  activationFixture.build_cases,
  "expected_route",
);
const buildActivationLocales = countBy(activationFixture.build_cases, "locale");
/** @type {Record<"en" | "ko", string[]>} */
const genericAnalogyLabels = { en: [], ko: [] };
for (let index = 1; index <= 10; index += 1) {
  const scenarioId = `S${String(index).padStart(2, "0")}`;
  for (const locale of LOCALES) {
    const analogy = genericAnalogyForScenario(scenarioId, locale);
    if (analogy) genericAnalogyLabels[locale].push(analogy.label);
  }
}

const terminalScenarios = /** @type {Array<Record<string, any>>} */ (
  Array.isArray(terminalEvidence.scenarios) ? terminalEvidence.scenarios : []
);
const checks = {
  direct_cases_complete:
    outputs.length === DIRECT_CONCEPT_ALIASES.length * 2 &&
    outputs.every(
      (output) =>
        output.status === "ready" &&
        output.route === "deterministic_inline" &&
        output.output_bytes <= DIRECT_CONCEPT_MAX_OUTPUT_BYTES,
    ),
  direct_effects_zero:
    effects.model_calls === 0 &&
    effects.network_calls === 0 &&
    effects.execution_calls === 0,
  generic_first_use_analogy_complete: outputs.every(
    (output) =>
      output.analogy.kind === "generic" &&
      !/No familiar picture was used|익숙한 비유를 사용하지 않았습니다/u.test(
        output.explanation,
      ),
  ),
  explicit_design_bundle_bounded:
    bundle.items.length === 3 &&
    bundle.output_bytes <= DIRECT_CONCEPT_BUNDLE_MAX_OUTPUT_BYTES &&
    bundle.effects.model_calls === 0 &&
    bundle.effects.network_calls === 0,
  duplicate_scenario_bundle_compact:
    duplicateScenarioBundle.concepts.length === 3 &&
    duplicateScenarioBundle.items.length === 1 &&
    duplicateScenarioBundle.output_bytes <= DIRECT_CONCEPT_MAX_OUTPUT_BYTES &&
    duplicateScenarioBundle.effects.model_calls === 0 &&
    duplicateScenarioBundle.effects.network_calls === 0,
  nontrivial_build_semantic_selection:
    /non-trivial repository code/u.test(buildSkill) &&
    /Design-only, explanation-only/u.test(buildSkill) &&
    /single literal, label, comment, copy/u.test(buildSkill) &&
    /another harness\s+owns planning/u.test(buildSkill) &&
    !/Manual command only|manual-only/u.test(buildSkill) &&
    /^\s*allow_implicit_invocation: true$/mu.test(buildMetadata),
  companion_workflows_manual_only: manualSkills.every(
    ({ skill, metadata }) =>
      !/^disable-model-invocation: true$/mu.test(skill) &&
      /Manual command only/u.test(skill) &&
      /manual-only/u.test(skill) &&
      /^\s*allow_implicit_invocation: false$/mu.test(metadata),
  ),
  management_skills_manual_only: manualManagementSkills.every(
    ({ skill, metadata }) =>
      /Manual command only/u.test(skill) &&
      /^\s*allow_implicit_invocation: false$/mu.test(metadata),
  ),
  semantic_activation_contract_current:
    activationFixture.schema_version === 3 &&
    activationFixture.cases.length === 48 &&
    activationRoutes.rich === 24 &&
    activationRoutes.default === 24 &&
    activationLocales.en === 24 &&
    activationLocales.ko === 24 &&
    activationFixture.build_cases.length === 16 &&
    buildActivationRoutes.minimal === 8 &&
    buildActivationRoutes.default === 8 &&
    buildActivationLocales.en === 8 &&
    buildActivationLocales.ko === 8 &&
    !Object.hasOwn(hooks.hooks, "UserPromptSubmit") &&
    Buffer.byteLength(conceptDescription, "utf8") <= 1_536 &&
    /confus|do not understand/iu.test(conceptDescription) &&
    /beginner|plain.language/iu.test(conceptDescription) &&
    /ordinary.{0,20}definition/iu.test(conceptDescription) &&
    /coding|implementation|fixing|reviewing/iu.test(conceptDescription) &&
    sharedSkillDescriptionBytes <= 2_560 &&
    /^\s*allow_implicit_invocation: true$/mu.test(conceptMetadata) &&
    !/src\/|schemas?\/|tests?\/|prepareG010Runtime|build_decision/u.test(
      conceptSkill,
    ),
  generic_analogy_contract_current:
    genericAnalogyLabels.en.length === 10 &&
    genericAnalogyLabels.ko.length === 10 &&
    new Set(genericAnalogyLabels.en).size === 10 &&
    new Set(genericAnalogyLabels.ko).size === 10,
  structural_support_current:
    terminalEvidence.model_calls === 0 &&
    terminalEvidence.network_calls === 0 &&
    terminalScenarios.length === 5 &&
    terminalScenarios.every(
      (scenario) =>
        scenario.compact_formatter_support === "2/9" &&
        scenario.fairytail_formatter_support === "9/9",
    ),
  visual_contract_current: evaluateG012ReadmeVisual(visualEvidence).passed,
  documentation_current: documentationCurrent(documents),
};
const failedChecks = Object.entries(checks)
  .filter(([, passed]) => !passed)
  .map(([name]) => name);
const sourcePins = Object.fromEntries(
  await Promise.all(
    sourcePaths.map(async (path) => [
      path,
      sha256(await readFile(join(root, path))),
    ]),
  ),
);
const report = {
  artifact_version: 5,
  benchmark_id: "g012-fairytail-current-release-gate",
  verification_scope:
    "current deterministic explanation, semantic activation contract, alias deduplication, analogy diversity, visual, and source pins",
  status: failedChecks.length === 0 ? "pass" : "fail",
  source_pins: sourcePins,
  direct_explanation: {
    aliases: DIRECT_CONCEPT_ALIASES.length,
    locales: 2,
    rendered_cases: outputs.length,
    passed_cases: outputs.filter((output) => output.status === "ready").length,
    maximum_output_bytes: maximumOutputBytes,
    output_limit_bytes: DIRECT_CONCEPT_MAX_OUTPUT_BYTES,
    effects,
  },
  explicit_design_bundle: {
    concepts: bundle.concepts,
    output_bytes: bundle.output_bytes,
    output_limit_bytes: DIRECT_CONCEPT_BUNDLE_MAX_OUTPUT_BYTES,
    effects: bundle.effects,
  },
  alias_bundle_deduplication: {
    requested_aliases: duplicateScenarioBundle.concepts.length,
    rendered_scenarios: duplicateScenarioBundle.items.length,
    output_bytes: duplicateScenarioBundle.output_bytes,
    effects: duplicateScenarioBundle.effects,
  },
  activation: {
    automatic_for_nontrivial_implementation: ["build"],
    manual_companion_workflows: manualSkills.map(({ name }) => name),
    manual_management: manualManagementSkills.map(({ name }) => name),
    strategy: "host-semantic-skill-description",
    rich_concept_route:
      "explicit Fairytail, beginner or plain-language need, analogy, personalization, confusion, comparison, or initial-design intent",
    ordinary_basic_questions: "host-default-answer",
    labeled_prompts:
      activationFixture.cases.length + activationFixture.build_cases.length,
    concept_prompts: activationFixture.cases.length,
    rich_concept_prompts: activationRoutes.rich,
    default_concept_prompts: activationRoutes.default,
    build_prompts: activationFixture.build_cases.length,
    minimal_build_prompts: buildActivationRoutes.minimal,
    default_build_prompts: buildActivationRoutes.default,
    locales: {
      en: activationLocales.en + buildActivationLocales.en,
      ko: activationLocales.ko + buildActivationLocales.ko,
    },
    user_prompt_submit_hook: false,
    prompt_hook_context_bytes: 0,
    measured_skill_description_bytes_before_host_framing:
      sharedSkillDescriptionBytes,
    skill_description_limit_bytes_before_host_framing: 2_560,
    listing_note:
      "Skill descriptions remain baseline host metadata; the full skill body loads only when selected.",
  },
  generic_analogy: {
    reviewed_concept_families: 10,
    unique_labels_per_locale: 10,
    explicit_breakpoint_per_family: true,
    personalized_role_binding:
      "User-authored familiar worlds can replace the generic picture after exact-slot validation; unsupported concepts stay with the host.",
  },
  structural_explanation: {
    fixtures: terminalScenarios.length,
    compact_support: terminalEvidence.metric?.compact_formatter,
    fairytail_support: terminalEvidence.metric?.fairytail_formatter,
    model_calls: terminalEvidence.model_calls,
    network_calls: terminalEvidence.network_calls,
    limitation: "Structural field coverage is not a comprehension score.",
  },
  checks,
  failed_checks: failedChecks,
  limitations: [
    "The direct gate proves bounded local behavior, not human comprehension.",
    "The bilingual intent corpus is a product contract, not proof that either host selects the skill correctly; live release probes measure that separately.",
    "Displayed local text contains words; zero model calls means no explanation model generated them.",
    "Personalized mappings are validated for reviewed concept roles; Fairytail does not claim reviewed coverage for arbitrary new concepts.",
  ],
};

assert.equal(
  report.status,
  "pass",
  `G012 checks failed: ${failedChecks.join(", ")}`,
);
if (process.argv.includes("--write")) {
  await mkdir(dirname(artifactPath), { recursive: true });
  await writeFile(artifactPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
} else {
  assert.deepEqual(
    JSON.parse(await readFile(artifactPath, "utf8")),
    report,
    "Committed G012 report is stale",
  );
}

process.stdout.write(
  `${JSON.stringify({
    status: report.status,
    direct_explanation: report.direct_explanation,
    explicit_design_bundle: report.explicit_design_bundle,
    alias_bundle_deduplication: report.alias_bundle_deduplication,
    activation: report.activation,
    structural_explanation: report.structural_explanation,
  })}\n`,
);

/** @param {Record<string, string>} values */
function documentationCurrent(values) {
  const readmeTop = values["README.md"].split("## Install")[0];
  return (
    readmeTop.includes("52/52") &&
    readmeTop.includes("1,013 bytes") &&
    readmeTop.includes("4 KiB") &&
    readmeTop.includes("64 prompts") &&
    readmeTop.includes("2,485 bytes") &&
    readmeTop.includes("zero model calls") &&
    readmeTop.includes("ordinary definitions") &&
    values["README.ko.md"].includes("52/52") &&
    values["README.ko.md"].includes("1,013바이트") &&
    values["README.ko.md"].includes("Concept 48 + Build 16") &&
    values["README.ko.md"].includes("모델 호출 0") &&
    values["ARCHITECTURE.md"].includes("Direct concept route") &&
    values["docs/PERFORMANCE.md"].includes("52/52") &&
    values["docs/PUBLIC_INSTALL_AND_SAMPLES.md"].includes(
      "bounded natural-language smoke",
    ) &&
    !Object.values(values).some((value) =>
      /current renderer, median|current build snapshot/iu.test(value),
    )
  );
}

/** @param {Array<Record<string, any>>} entries @param {string} key */
function countBy(entries, key) {
  return entries.reduce((counts, entry) => {
    counts[entry[key]] = (counts[entry[key]] ?? 0) + 1;
    return counts;
  }, {});
}

/** @param {Buffer} value */
function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

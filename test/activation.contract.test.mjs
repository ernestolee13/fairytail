import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { DIRECT_CONCEPT_ALIASES } from "../src/runtime/concept.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const casesPath = join(root, "fixtures", "activation", "v2", "cases.json");
const explainSkill = join(root, "skills", "fairytail-explain-concept");
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

/**
 * @typedef {{
 *   id: string,
 *   locale: "en" | "ko",
 *   expected_route: "rich" | "default",
 *   signal: string,
 *   prompt: string,
 *   concepts: string[]
 * }} ActivationCase
 */

/**
 * @typedef {{
 *   id: string,
 *   locale: "en" | "ko",
 *   expected_route: "minimal" | "default",
 *   signal: string,
 *   prompt: string
 * }} BuildActivationCase
 */

test("semantic activation corpus is bilingual, balanced, and adversarial", async () => {
  const fixture =
    /** @type {{ schema_version: number, cases: ActivationCase[], build_cases: BuildActivationCase[] }} */ (
      JSON.parse(await readFile(casesPath, "utf8"))
    );
  assert.equal(fixture.schema_version, 3);
  assert.equal(fixture.cases.length, 48);

  const ids = new Set();
  const routes = { rich: 0, default: 0 };
  const locales = { en: 0, ko: 0 };
  const aliases = new Set(DIRECT_CONCEPT_ALIASES);

  for (const entry of fixture.cases) {
    assert.match(entry.id, /^(en|ko)-(positive|negative)-[a-z0-9-]+$/u);
    assert.equal(ids.has(entry.id), false, entry.id);
    ids.add(entry.id);
    assert.ok(entry.expected_route in routes, entry.id);
    assert.ok(entry.locale in locales, entry.id);
    routes[entry.expected_route] += 1;
    locales[entry.locale] += 1;
    assert.equal(entry.prompt, entry.prompt.normalize("NFC"), entry.id);
    assert.ok(entry.prompt.length >= 8, entry.id);
    assert.ok(entry.prompt.length <= 240, entry.id);
    assert.ok(Array.isArray(entry.concepts), entry.id);
    assert.ok(entry.concepts.length <= 3, entry.id);
    for (const concept of entry.concepts) {
      assert.equal(aliases.has(concept), true, `${entry.id}: ${concept}`);
    }
  }

  assert.deepEqual(routes, { rich: 24, default: 24 });
  assert.deepEqual(locales, { en: 24, ko: 24 });
  assert.ok(
    fixture.cases.some((entry) => entry.signal === "contextual_confusion"),
  );
  assert.ok(
    fixture.cases.some((entry) => entry.signal === "incidental_beginner_word"),
  );

  assert.equal(fixture.build_cases.length, 16);
  const buildRoutes = { minimal: 0, default: 0 };
  const buildLocales = { en: 0, ko: 0 };
  for (const entry of fixture.build_cases) {
    assert.match(entry.id, /^(en|ko)-build-(positive|negative)-[a-z0-9-]+$/u);
    assert.ok(entry.expected_route in buildRoutes, entry.id);
    assert.ok(entry.locale in buildLocales, entry.id);
    buildRoutes[entry.expected_route] += 1;
    buildLocales[entry.locale] += 1;
    assert.equal(entry.prompt, entry.prompt.normalize("NFC"), entry.id);
    assert.ok(entry.prompt.length >= 8 && entry.prompt.length <= 300, entry.id);
  }
  assert.deepEqual(buildRoutes, { minimal: 8, default: 8 });
  assert.deepEqual(buildLocales, { en: 8, ko: 8 });
  assert.ok(
    fixture.build_cases.some((entry) => entry.signal === "design_only"),
  );
  assert.ok(
    fixture.build_cases.some((entry) => entry.signal === "trivial_edit"),
  );
});

test("the skill description is the semantic selector and stays within host limits", async () => {
  const skill = await readFile(join(explainSkill, "SKILL.md"), "utf8");
  const metadata = await readFile(
    join(explainSkill, "agents", "openai.yaml"),
    "utf8",
  );
  const match = skill.match(/^description:\s*(.+)$/mu);
  assert.ok(match, "missing skill description");
  const description = match[1];

  assert.ok(Buffer.byteLength(description, "utf8") <= 1_536);
  assert.match(description, /Fairytail/u);
  assert.match(description, /confus|do not understand|감이 안|헷갈/iu);
  assert.match(description, /plain.language|beginner|초보|입문/iu);
  assert.match(description, /analogy|비유/iu);
  assert.match(
    description,
    /initial.{0,20}(?:design|architecture)|초기.{0,20}설계/iu,
  );
  assert.match(description, /ordinary.{0,20}definition|일반.{0,20}정의/iu);
  assert.match(description, /coding|fixing|reviewing|implementation/iu);
  assert.match(description, /trivial/iu);
  assert.match(description, /Select silently/iu);
  assert.match(metadata, /^\s*allow_implicit_invocation: true$/mu);

  let sharedDescriptionBytes = 0;
  for (const name of sharedSkillNames) {
    const sharedSkill = await readFile(
      join(root, "skills", name, "SKILL.md"),
      "utf8",
    );
    const value =
      sharedSkill
        .match(/^description:\s*(.+)$/mu)?.[1]
        .replace(/^"|"$/gu, "") ?? "";
    sharedDescriptionBytes += Buffer.byteLength(value, "utf8");
  }
  assert.ok(
    sharedDescriptionBytes <= 2_560,
    `shared skill descriptions use ${sharedDescriptionBytes} bytes`,
  );
});

test("semantic selection is not duplicated by a UserPromptSubmit keyword router", async () => {
  const hooks = JSON.parse(
    await readFile(join(root, "hooks", "hooks.json"), "utf8"),
  );
  assert.equal(Object.hasOwn(hooks.hooks, "UserPromptSubmit"), false);

  for (const path of [
    join(root, "src", "activation", "prompt.mjs"),
    join(root, "scripts", "fairytail-prompt-gate.mjs"),
  ]) {
    await assert.rejects(access(path), { code: "ENOENT" });
  }
});

test("adjacent teaching skills exclude routine code work", async () => {
  const [review, error] = await Promise.all([
    readFile(join(root, "skills", "review", "SKILL.md"), "utf8"),
    readFile(join(root, "skills", "error", "SKILL.md"), "utf8"),
  ]);

  assert.match(review, /previously explained concept/iu);
  assert.match(review, /Do not use for code/iu);
  assert.match(review, /architecture/iu);
  assert.match(review, /database-migration/iu);
  assert.match(error, /for a beginner|when beginner explanation is useful/iu);
  assert.match(error, /Do not select (?:merely|for ordinary)/iu);
  assert.match(
    error,
    /debug, fix, or implement|debugging, fixes, or implementation/iu,
  );
});

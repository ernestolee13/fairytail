import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { performance } from "node:perf_hooks";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  DIRECT_CONCEPT_BUNDLE_MAX_OUTPUT_BYTES,
  DIRECT_CONCEPT_MAX_OUTPUT_BYTES,
  prepareDirectConcept,
  prepareDirectConceptBundle,
} from "../src/runtime/concept.mjs";
import { completeOnboarding } from "../src/profile/onboarding.mjs";
import { saveProfile } from "../src/profile/store.mjs";

const execFileAsync = promisify(execFile);
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const explainSkill = join(root, "skills", "fairytail-explain-concept");
const skills = join(root, "skills");

test("direct explanation ceilings leave a small fixed context envelope", () => {
  assert.equal(DIRECT_CONCEPT_MAX_OUTPUT_BYTES, 4 * 1024);
  assert.equal(DIRECT_CONCEPT_BUNDLE_MAX_OUTPUT_BYTES, 12 * 1024);
});

test("direct concept rendering stays local, bounded, and fast in both locales", async () => {
  for (const requestedLocale of ["en", "ko"]) {
    const started = performance.now();
    const output = await prepareDirectConcept({
      pluginRoot: root,
      dataDir: null,
      concept: "api",
      requestedLocale,
    });
    const elapsedMs = performance.now() - started;

    assert.equal(output.status, "ready");
    assert.equal(output.route, "deterministic_inline");
    assert.equal(output.scenario_id, "S04");
    assert.equal(output.locale.resolved_locale, requestedLocale);
    assert.equal(output.analogy.kind, "generic");
    assert.equal(output.analogy.reason, "profile-not-set");
    assert.deepEqual(output.effects, {
      model_calls: 0,
      network_calls: 0,
      execution_calls: 0,
    });
    assert.ok(output.explanation.length > 200);
    assert.doesNotMatch(output.explanation, /No familiar picture was used/u);
    assert.doesNotMatch(
      output.explanation,
      /익숙한 비유를 사용하지 않았습니다/u,
    );
    assert.ok(
      Buffer.byteLength(output.explanation, "utf8") <=
        DIRECT_CONCEPT_MAX_OUTPUT_BYTES,
    );
    assert.ok(elapsedMs < 2_000, `direct render took ${elapsedMs}ms`);
  }
});

test("direct beginner output is compact and prioritizes the mental model", async () => {
  const cases = [
    {
      locale: "en",
      heading: "IN PLAIN LANGUAGE",
      watch: "A local MCP server",
      maxBytes: 1_400,
    },
    {
      locale: "ko",
      heading: "한 문장으로",
      watch: "로컬 MCP",
      maxBytes: 1_900,
    },
  ];

  for (const entry of cases) {
    const output = await prepareDirectConcept({
      pluginRoot: root,
      dataDir: null,
      concept: "mcp",
      requestedLocale: entry.locale,
    });
    assert.match(output.explanation, new RegExp(entry.heading, "u"));
    assert.match(output.explanation, new RegExp(entry.watch, "u"));
    assert.doesNotMatch(
      output.explanation,
      /WHY THIS CAME UP|BEFORE YOU ACT|왜 지금 알아야 하나요|실행 전 확인/u,
    );
    assert.ok(output.output_bytes <= entry.maxBytes, output.explanation);
  }
});

test("an approved profile keeps the reviewed generic analogy until its personal map exists", async (context) => {
  const dataDir = await mkdtemp(join(tmpdir(), "fairytail-map-pending-"));
  context.after(() => rm(dataDir, { recursive: true, force: true }));
  const completed = completeOnboarding(
    {
      familiar_contexts: ["Neighborhood bakery workflow"],
      familiar_anchors: ["order note", "pickup counter", "bread tray"],
      coding_actions: ["none"],
      presentation_preference: "analogy_first",
      safety_concerns: ["privacy"],
      language: "en",
    },
    "approve",
  );
  assert.equal(completed.approved, true);
  await saveProfile(dataDir, completed.profile);

  const output = await prepareDirectConcept({
    pluginRoot: root,
    dataDir,
    concept: "api",
    requestedLocale: "en",
  });

  assert.equal(output.analogy.kind, "generic");
  assert.equal(output.analogy.reason, "personalized-mapping-pending");
  assert.doesNotMatch(output.explanation, /No familiar picture was used/u);
  assert.deepEqual(output.effects, {
    model_calls: 0,
    network_calls: 0,
    execution_calls: 0,
  });
});

test("all public concept aliases resolve without model or repository inspection", async () => {
  const aliases = [
    "package",
    "server",
    "environment",
    "api",
    "token",
    "database",
    "mcp",
    "permission",
    "repository",
    "deploy",
  ];
  for (const concept of aliases) {
    const output = await prepareDirectConcept({
      pluginRoot: root,
      dataDir: null,
      concept,
      requestedLocale: "en",
    });
    assert.equal(output.status, "ready", concept);
    assert.equal(output.route, "deterministic_inline", concept);
    assert.equal(output.effects.model_calls, 0, concept);
    assert.equal(output.effects.network_calls, 0, concept);
    assert.equal(output.effects.execution_calls, 0, concept);
  }
});

test("the generic first-app walkthrough is one connected bounded map", async () => {
  for (const requestedLocale of ["en", "ko"]) {
    const output = await prepareDirectConceptBundle({
      pluginRoot: root,
      dataDir: null,
      concepts: ["api", "server", "database"],
      requestedLocale,
    });

    assert.equal(output.status, "ready");
    assert.equal(output.route, "deterministic_inline");
    assert.deepEqual(output.concepts, ["api", "server", "database"]);
    assert.equal(output.items.length, 3);
    assert.match(
      output.explanation,
      /(?:App → API request → server logic → database query → server response → app|앱 → API 요청 → 서버 로직 → 데이터베이스 쿼리 → 서버 응답 → 앱)/u,
    );
    assert.match(
      output.explanation,
      /(?:KEEP THE FIRST VERSION SMALL|첫 버전은 작게)/u,
    );
    assert.doesNotMatch(output.explanation, /\n\n---\n\n/u);
    assert.ok(output.output_bytes <= 2_400, output.explanation);
    assert.ok(output.output_bytes <= DIRECT_CONCEPT_BUNDLE_MAX_OUTPUT_BYTES);
    assert.deepEqual(output.effects, {
      model_calls: 0,
      network_calls: 0,
      execution_calls: 0,
    });
  }
});

test("a concept bundle renders each reviewed scenario only once", async () => {
  for (const requestedLocale of ["en", "ko"]) {
    for (const concepts of [
      ["api-key", "access-token", "llm-token"],
      ["mcp", "tool", "resource"],
    ]) {
      const output = await prepareDirectConceptBundle({
        pluginRoot: root,
        dataDir: null,
        concepts,
        requestedLocale,
      });

      assert.deepEqual(output.concepts, concepts);
      assert.equal(output.items.length, 1);
      assert.equal(output.explanation, output.items[0].explanation);
      assert.ok(output.output_bytes <= DIRECT_CONCEPT_MAX_OUTPUT_BYTES);
    }
  }
});

test("a saved no-analogy choice bypasses the generic connected map", async (context) => {
  const dataDir = await mkdtemp(join(tmpdir(), "fairytail-no-analogy-bundle-"));
  context.after(() => rm(dataDir, { recursive: true, force: true }));
  const completed = completeOnboarding(
    {
      familiar_contexts: ["Neighborhood bakery workflow"],
      familiar_anchors: ["order note", "pickup counter", "bread tray"],
      coding_actions: ["none"],
      presentation_preference: "analogy_first",
      safety_concerns: ["privacy"],
      language: "en",
    },
    "no-analogy",
  );
  await saveProfile(dataDir, completed.profile);

  const output = await prepareDirectConceptBundle({
    pluginRoot: root,
    dataDir,
    concepts: ["api", "server", "database"],
    requestedLocale: "en",
  });

  assert.ok(output.items.every((item) => item.analogy.kind === "none"));
  assert.match(output.explanation, /\n\n---\n\n/u);
  assert.doesNotMatch(output.explanation, /FIRST APP MAP/u);
});

test("the bundled concept command emits one bounded answer without source discovery", async () => {
  const command = join(explainSkill, "scripts", "explain.mjs");
  const { stdout, stderr } = await execFileAsync(
    process.execPath,
    [command, "--concept", "mcp", "--locale", "ko", "--json"],
    { cwd: root, timeout: 2_000, maxBuffer: 32 * 1024 },
  );
  const output = JSON.parse(stdout);

  assert.equal(stderr, "");
  assert.equal(output.status, "ready");
  assert.equal(output.scenario_id, "S07");
  assert.equal(output.route, "deterministic_inline");
  assert.equal(output.effects.model_calls, 0);
  assert.equal(output.effects.network_calls, 0);
  assert.ok(Buffer.byteLength(stdout, "utf8") <= 32 * 1024);
});

test("the closed demo command ignores stored profile data and its data path", async () => {
  const command = join(explainSkill, "scripts", "explain.mjs");

  for (const locale of ["en", "ko"]) {
    const expected = await prepareDirectConceptBundle({
      pluginRoot: root,
      dataDir: null,
      concepts: ["api", "server", "database"],
      requestedLocale: locale,
    });
    const args =
      locale === "en" ? [command, "demo"] : [command, "demo", locale];
    const { stdout, stderr } = await execFileAsync(process.execPath, args, {
      cwd: root,
      timeout: 2_000,
      maxBuffer: 64 * 1024,
      env: {
        ...process.env,
        FAIRYTAIL_DATA_DIR: "https://profile-resolution-must-not-run.invalid",
      },
    });

    assert.equal(stderr, "");
    assert.equal(stdout, `${expected.explanation.trimEnd()}\n`);
    assert.ok(Buffer.byteLength(stdout, "utf8") <= 48 * 1024);
    assert.deepEqual(expected.effects, {
      model_calls: 0,
      network_calls: 0,
      execution_calls: 0,
    });
  }
});

test("the exact public npm demo commands match the fixed bundle", async () => {
  for (const locale of ["en", "ko"]) {
    const expected = await prepareDirectConceptBundle({
      pluginRoot: root,
      dataDir: null,
      concepts: ["api", "server", "database"],
      requestedLocale: locale,
    });
    const args =
      locale === "en"
        ? ["run", "--silent", "demo"]
        : ["run", "--silent", "demo", "--", locale];
    const { stdout, stderr } = await execFileAsync("npm", args, {
      cwd: root,
      timeout: 5_000,
      maxBuffer: 64 * 1024,
      env: {
        ...process.env,
        FAIRYTAIL_DATA_DIR: "https://stored-profile-must-not-run.invalid",
      },
    });

    assert.equal(stderr, "");
    assert.equal(stdout, `${expected.explanation.trimEnd()}\n`);
  }
});

test("the closed demo command rejects unsupported arguments without diagnostics", async () => {
  const command = join(explainSkill, "scripts", "explain.mjs");

  await assert.rejects(
    execFileAsync(process.execPath, [command, "demo", "fr"], {
      cwd: root,
      timeout: 2_000,
      maxBuffer: 8 * 1024,
    }),
    (error) => {
      if (!(error instanceof Error)) return false;
      const failure =
        /** @type {Error & { code: number, stdout: string, stderr: string }} */ (
          error
        );
      assert.equal(failure.code, 1);
      assert.equal(failure.stderr, "");
      assert.equal(
        failure.stdout,
        '{"status":"error","code":"direct-concept-failed"}\n',
      );
      return true;
    },
  );
});

test("skill metadata selects non-trivial builds while keeping trivial work quiet", async () => {
  const [build, buildMetadata, manualEntries, explain, explainMetadata] =
    await Promise.all([
      readFile(join(skills, "build", "SKILL.md"), "utf8"),
      readFile(join(skills, "build", "agents", "openai.yaml"), "utf8"),
      Promise.all(
        ["before", "finish", "personalize"].map(async (name) => ({
          name,
          skill: await readFile(join(skills, name, "SKILL.md"), "utf8"),
          metadata: await readFile(
            join(skills, name, "agents", "openai.yaml"),
            "utf8",
          ),
        })),
      ),
      readFile(join(explainSkill, "SKILL.md"), "utf8"),
      readFile(join(explainSkill, "agents", "openai.yaml"), "utf8"),
    ]);

  for (const { name, skill, metadata } of manualEntries) {
    assert.doesNotMatch(skill, /^disable-model-invocation: true$/mu, name);
    assert.match(skill, /Manual command only/u, name);
    assert.match(skill, /manual-only/u, name);
    assert.match(metadata, /^\s*allow_implicit_invocation: false$/mu, name);
  }
  assert.match(build, /non-trivial implementation/u);
  assert.match(build, /Before any repository read/u);
  assert.match(build, /Design-only, explanation-only/u);
  assert.match(build, /single literal, label, comment, copy/u);
  assert.match(build, /another harness\s+owns planning/u);
  assert.doesNotMatch(build, /Manual command only|manual-only/u);
  assert.match(
    build.match(/^---\n[\s\S]*?\n---/u)?.[0] ?? "",
    /Select silently/u,
  );
  assert.match(buildMetadata, /^\s*allow_implicit_invocation: true$/mu);
  assert.match(
    manualEntries[2].skill,
    /Never select for an ordinary concept explanation/u,
  );

  assert.match(explain, /Run the bundled script as the first action/u);
  assert.match(explain, /Do not inspect the repository/u);
  assert.match(explain, /treat stdout as the final answer/u);
  assert.match(explain, /Do not summarize, translate, reorder/u);
  assert.match(explain, /semantic intent in the description/u);
  assert.match(explain, /ordinary\s+short\s+definition/u);
  assert.match(explain, /initial-design/u);
  assert.match(explain, /up to three distinct relevant aliases/u);
  assert.match(explain, /argument is exactly `demo`/u);
  assert.match(explain, /without reading a profile/u);
  const explainFrontmatter = explain.match(/^---\n[\s\S]*?\n---/u)?.[0] ?? "";
  assert.match(explainFrontmatter, /Select silently/u);
  assert.doesNotMatch(explainFrontmatter, /demo/iu);
  assert.doesNotMatch(
    explain,
    /src\/|schemas?\/|tests?\/|prepareG010Runtime|build_decision/u,
  );
  assert.match(explainMetadata, /^\s*allow_implicit_invocation: true$/mu);
});

test("Fairytail management skills are explicit and cannot leak profile preview into chat", async () => {
  const [doctor, doctorMetadata, profile, profileMetadata] = await Promise.all([
    readFile(join(skills, "doctor", "SKILL.md"), "utf8"),
    readFile(join(skills, "doctor", "agents", "openai.yaml"), "utf8"),
    readFile(join(skills, "profile", "SKILL.md"), "utf8"),
    readFile(join(skills, "profile", "agents", "openai.yaml"), "utf8"),
  ]);

  assert.match(doctorMetadata, /^\s*allow_implicit_invocation: false$/mu);
  assert.match(profileMetadata, /^\s*allow_implicit_invocation: false$/mu);
  assert.match(doctor, /Never use for project, test, dependency/u);
  assert.match(profile, /Never use for performance profiling/u);
  assert.match(
    profile,
    /`?status`? is the only operation[\s\S]*run automatically/iu,
  );
  assert.match(profile, /Never run `edit` or `preview` through a\s+host tool/u);
});

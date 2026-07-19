import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  FORBIDDEN_MUTATIONS,
  inspectClaudeEnvironment,
  resolveIntegration,
  validateCapabilitySnapshot,
} from "../src/integration/capabilities.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const fixture = /** @type {{ cases: Record<string, any>[] }} */ (
  JSON.parse(
    await readFile(
      join(root, "fixtures", "g007", "coexistence-cases.json"),
      "utf8",
    ),
  )
);

test("the coexistence matrix preserves orchestration and selects one conservative adapter", () => {
  assert.ok(fixture.cases.length >= 7);
  for (const item of fixture.cases) {
    const decision = resolveIntegration(item.snapshot);
    assert.equal(decision.mode, item.expected_mode, item.id);
    assert.equal(decision.model_route, item.expected_route, item.id);
    assert.equal(decision.status, item.expected_status, item.id);
    assert.equal(decision.owns_orchestration, false, item.id);
    assert.equal(decision.executes_tasks, false, item.id);
    assert.equal(decision.changes_parent_model, false, item.id);
    assert.equal(decision.assumes_hook_order, false, item.id);
    assert.equal(decision.writes_global_guidance, false, item.id);
    assert.equal(decision.duplicate_execution_possible, false, item.id);
    assert.deepEqual(
      decision.active_orchestrators_preserved,
      item.snapshot.orchestrators,
      item.id,
    );
    assert.deepEqual(
      decision.forbidden_mutations,
      FORBIDDEN_MUTATIONS,
      item.id,
    );
  }
});

test("dual Fairytail adapters fail closed instead of rendering twice", () => {
  const dual = fixture.cases.find(
    (item) => item.id === "opencode-dual-adapter",
  );
  assert.ok(dual);
  const decision = resolveIntegration(dual.snapshot);
  assert.equal(decision.status, "blocked");
  assert.equal(decision.reason_code, "FTI-DUPLICATE-ADAPTER");
  assert.equal(decision.optional_layer_enabled, false);
  assert.deepEqual(decision.allowed_mutations, []);
});

test("capability removal or model denial falls back to deterministic inline rendering", () => {
  for (const id of [
    "claude-standalone",
    "claude-model-denied-with-omx-marker",
  ]) {
    const item = fixture.cases.find((candidate) => candidate.id === id);
    assert.ok(item);
    assert.equal(
      resolveIntegration(item.snapshot).model_route,
      "deterministic_inline",
    );
  }
});

test("closed snapshots reject extra fields, unsafe identifiers, and duplicates", () => {
  const base = structuredClone(fixture.cases[0].snapshot);
  assert.throws(() =>
    validateCapabilitySnapshot({ ...base, raw_config: "no" }),
  );
  assert.throws(() =>
    validateCapabilitySnapshot({ ...base, enabled_plugins: ["../unsafe"] }),
  );
  assert.throws(() =>
    validateCapabilitySnapshot({
      ...base,
      orchestrators: ["omx", "omx"],
    }),
  );
});

test("local inspection returns identifiers only and detects existing harness markers", async (context) => {
  const temporary = await mkdtemp(
    join(tmpdir(), "fairytail-integration-test-"),
  );
  context.after(() => rm(temporary, { recursive: true, force: true }));
  const configDir = join(temporary, "config");
  const workspaceRoot = join(temporary, "workspace");
  await mkdir(join(workspaceRoot, ".omx"), { recursive: true });
  await mkdir(join(workspaceRoot, ".omo"), { recursive: true });
  await mkdir(configDir, { recursive: true });
  await writeFile(
    join(configDir, "settings.json"),
    `${JSON.stringify({
      enabledPlugins: {
        "superpowers@official": true,
        "fairytail@old-test": false,
      },
    })}\n`,
  );
  await writeFile(
    join(workspaceRoot, "AGENTS.md"),
    "<!-- OMX:RUNTIME:START -->\nPRIVATE_WORKSPACE_CANARY\n",
  );
  await writeFile(
    join(workspaceRoot, "opencode.json"),
    `${JSON.stringify({ plugin: ["oh-my-openagent"] })}\n`,
  );

  const result = await inspectClaudeEnvironment({
    configDir,
    workspaceRoot,
    hostVersion: "2.1.214",
  });
  assert.deepEqual(result.snapshot.enabled_plugins, ["superpowers"]);
  assert.deepEqual(result.snapshot.orchestrators, [
    "omo",
    "omx",
    "superpowers",
  ]);
  assert.deepEqual(result.snapshot.fairytail_adapters, []);
  assert.equal(result.decision.mode, "additive_explanation_only");
  assert.equal(result.decision.reason_code, "FTI-ORCHESTRATOR-PRESERVED");
  assert.doesNotMatch(
    JSON.stringify(result),
    /PRIVATE_WORKSPACE_CANARY|workspace|config/u,
  );
});

test("damaged host configuration fails closed instead of pretending no harness exists", async (context) => {
  const temporary = await mkdtemp(
    join(tmpdir(), "fairytail-integration-damaged-"),
  );
  context.after(() => rm(temporary, { recursive: true, force: true }));
  const configDir = join(temporary, "config");
  const workspaceRoot = join(temporary, "workspace");
  await mkdir(configDir, { recursive: true });
  await mkdir(workspaceRoot, { recursive: true });
  await writeFile(join(configDir, "settings.json"), "{not-json\n");

  await assert.rejects(
    inspectClaudeEnvironment({
      configDir,
      workspaceRoot,
      hostVersion: "2.1.214",
    }),
    /Claude settings/u,
  );
});

test("integration snapshot schema is closed Draft 2020-12 JSON", async () => {
  const schema = JSON.parse(
    await readFile(
      join(root, "schemas", "v1", "integration-snapshot.schema.json"),
      "utf8",
    ),
  );
  assert.equal(schema.$schema, "https://json-schema.org/draft/2020-12/schema");
  assert.equal(schema.additionalProperties, false);
  assert.equal(schema.properties.capabilities.additionalProperties, false);
});

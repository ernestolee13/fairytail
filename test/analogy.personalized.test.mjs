import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { promisify } from "node:util";

import { ANALOGY_CACHE_FILE } from "../src/analogy/cache.mjs";
import { loadAnalogyRuntime, resolveAnalogy } from "../src/analogy/engine.mjs";
import {
  PERSONALIZED_MAPPING_FILE,
  createPersonalizationRequest,
  validatePersonalizedCandidate,
} from "../src/analogy/personalized.mjs";
import { renderScenario } from "../src/analogy/render.mjs";
import { completeOnboarding } from "../src/profile/onboarding.mjs";
import { approvePersonalization } from "../src/profile/privacy.mjs";
import {
  PROJECTION_FIELDS,
  localOnlyProfile,
  validateProfile,
} from "../src/profile/profile.mjs";
import { loadProfile, saveProfile } from "../src/profile/store.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const profileCli = join(root, "scripts", "fairytail-profile.mjs");
const runFile = promisify(execFile);
const now = new Date("2026-07-19T04:00:00.000Z");
const runtime = await loadAnalogyRuntime(root, now);

function restaurantProfile() {
  const completed = completeOnboarding(
    {
      familiar_contexts: ["Restaurant kitchen workflow"],
      familiar_anchors: ["order ticket", "service counter", "prepared dish"],
      coding_actions: ["none"],
      presentation_preference: "analogy_first",
      safety_concerns: ["privacy"],
      language: "en",
    },
    "approve",
    now,
  );
  assert.equal(completed.approved, true);
  return completed.profile;
}

/** @param {Readonly<any>} request @param {string} [label] */
function apiCandidate(request, label = "Restaurant kitchen workflow") {
  return {
    schema_version: request.schema_version,
    request_id: request.request_id,
    source_context: "Restaurant kitchen workflow",
    analogy_label: label,
    role_bindings: {
      API: "Restaurant kitchen workflow",
      endpoint: "service counter",
      request: "order ticket",
      response: "prepared dish",
    },
  };
}

test("an arbitrary user-authored profile creates a consent-bound role request instead of seed classification", () => {
  const prepared = createPersonalizationRequest(
    runtime,
    restaurantProfile(),
    "S04",
  );
  assert.equal(prepared.status, "ready");
  if (prepared.status !== "ready") return;
  assert.equal(prepared.request.purpose, "bounded_analogy_role_binding_only");
  assert.deepEqual(prepared.request.familiar_contexts, [
    "Restaurant kitchen workflow",
    "order ticket",
    "service counter",
    "prepared dish",
  ]);
  assert.deepEqual(prepared.request.role_ids, [
    "API",
    "endpoint",
    "request",
    "response",
  ]);
  assert.deepEqual(
    prepared.request.required_relations.map((item) => item.relation_id),
    [
      "api-defines-endpoint",
      "request-goes-to-endpoint",
      "endpoint-returns-response",
    ],
  );
  const serialized = JSON.stringify(prepared.request);
  assert.doesNotMatch(
    serialized,
    /profile_id|observed_experience|safety_concerns|approved_at|updated_at/u,
  );
  assert.doesNotMatch(serialized, /hospital|ecommerce|humanities/u);
});

test("multi-concept encounters target the reviewed database and MCP teaching contracts without seed lookup", () => {
  const profile = restaurantProfile();
  const database = createPersonalizationRequest(runtime, profile, "S06");
  const mcp = createPersonalizationRequest(runtime, profile, "S07");
  assert.equal(database.status, "ready");
  assert.equal(mcp.status, "ready");
  if (database.status !== "ready" || mcp.status !== "ready") return;
  assert.equal(database.request.concept_id, "database-table-query");
  assert.deepEqual(database.request.role_ids, [
    "database",
    "table",
    "row",
    "column",
    "query",
    "DBMS",
  ]);
  assert.equal(mcp.request.concept_id, "mcp-tool-resource");
  assert.deepEqual(mcp.request.role_ids, [
    "host",
    "client",
    "server",
    "resource",
    "tool",
  ]);
  assert.doesNotMatch(JSON.stringify([database, mcp]), /profile_id|P[123]-S/u);
});

test("the mapper can fill only exact role slots while local code derives relations and breakpoint", () => {
  const prepared = createPersonalizationRequest(
    runtime,
    restaurantProfile(),
    "S04",
  );
  assert.equal(prepared.status, "ready");
  if (prepared.status !== "ready") return;
  const resolution = validatePersonalizedCandidate(
    runtime,
    prepared.request,
    apiCandidate(prepared.request),
  );
  assert.equal(resolution.kind, "mapped");
  assert.equal(resolution.reason, "validated-profile-binding");
  assert.equal(resolution.source, "profile-adapter");
  assert.equal(resolution.network_calls, 0);
  assert.deepEqual(
    resolution.relations.map((relation) => relation.relation_id),
    prepared.request.required_relations.map((relation) => relation.relation_id),
  );
  const rendered = renderScenario(runtime, "S04", resolution);
  assert.equal(rendered.analogy_or_neutral_fallback.kind, "mapped");
  assert.equal(
    rendered.canonical_definition.canonical_fact_set_hash,
    prepared.request.canonical_fact_set_hash,
  );
  assert.match(
    String(rendered.analogy_breakpoint.breakpoint),
    /schemas, methods, rate limits/u,
  );

  const forged = structuredClone(resolution);
  const suppressed = renderScenario(runtime, "S04", forged);
  assert.equal(suppressed.analogy_or_neutral_fallback.kind, "neutral");
  assert.equal(
    suppressed.analogy_or_neutral_fallback.reason,
    "untrusted-personalized-mapping",
  );
});

test("validated role bindings persist privately by request digest and are reused without seed matching", async (context) => {
  const dataDir = await mkdtemp(join(tmpdir(), "fairytail-personalized-"));
  context.after(() => rm(dataDir, { recursive: true, force: true }));
  const profile = restaurantProfile();
  const prepared = createPersonalizationRequest(runtime, profile, "S04");
  assert.equal(prepared.status, "ready");
  if (prepared.status !== "ready") return;

  const missing = await resolveAnalogy(runtime, {
    profile,
    scenarioId: "S04",
    dataDir,
  });
  assert.deepEqual(missing, {
    kind: "neutral",
    reason: "personalized-mapping-required",
    profile_projection_calls: 1,
    network_calls: 0,
  });

  const first = await resolveAnalogy(runtime, {
    profile,
    scenarioId: "S04",
    dataDir,
    personalizedCandidate: apiCandidate(prepared.request),
  });
  assert.equal(first.kind, "mapped");
  if (first.kind !== "mapped") return;
  const repeated = await resolveAnalogy(runtime, {
    profile,
    scenarioId: "S04",
    dataDir,
  });
  assert.equal(repeated.kind, "mapped");
  if (repeated.kind !== "mapped") return;
  assert.equal(repeated.mapping_id, first.mapping_id);
  assert.equal(
    (await stat(join(dataDir, PERSONALIZED_MAPPING_FILE))).mode & 0o777,
    0o600,
  );
  const stored = await readFile(
    join(dataDir, PERSONALIZED_MAPPING_FILE),
    "utf8",
  );
  assert.doesNotMatch(
    stored,
    /profile_id|observed_experience|safety_concerns|PRIVATE_/u,
  );

  const rejected = await resolveAnalogy(runtime, {
    profile,
    scenarioId: "S04",
    dataDir,
    choice: "unfamiliar",
    priorMappingId: repeated.mapping_id,
  });
  assert.equal(rejected.kind, "neutral");
  assert.equal(rejected.reason, "personalized-mapping-required");
});

test("tampered requests, extra claims, missing roles, and stale consent fail closed", () => {
  const profile = restaurantProfile();
  const prepared = createPersonalizationRequest(runtime, profile, "S04");
  assert.equal(prepared.status, "ready");
  if (prepared.status !== "ready") return;
  const candidate = apiCandidate(prepared.request);

  assert.throws(() =>
    validatePersonalizedCandidate(runtime, prepared.request, {
      ...candidate,
      technical_fact: "The model may rewrite the API definition",
    }),
  );
  const missingRole = structuredClone(candidate);
  delete (
    /** @type {Record<string, string>} */ (missingRole.role_bindings).response
  );
  assert.throws(() =>
    validatePersonalizedCandidate(runtime, prepared.request, missingRole),
  );
  for (const modelAuthoredText of [
    "API works every time",
    "Fully secure API",
    "access to all files",
    "Order Ticket",
  ]) {
    const unapprovedRole = structuredClone(candidate);
    unapprovedRole.role_bindings.API = modelAuthoredText;
    assert.throws(
      () =>
        validatePersonalizedCandidate(
          runtime,
          prepared.request,
          unapprovedRole,
        ),
      /role-target-not-approved/u,
    );
  }
  const modelAuthoredLabel = structuredClone(candidate);
  modelAuthoredLabel.analogy_label = "API returns every response";
  assert.throws(
    () =>
      validatePersonalizedCandidate(
        runtime,
        prepared.request,
        modelAuthoredLabel,
      ),
    /analogy-label-not-approved/u,
  );
  const duplicateRole = structuredClone(candidate);
  duplicateRole.role_bindings.response = duplicateRole.role_bindings.request;
  assert.throws(
    () =>
      validatePersonalizedCandidate(runtime, prepared.request, duplicateRole),
    /duplicate-role-target/u,
  );
  const reversedPairDuplicate = structuredClone(candidate);
  reversedPairDuplicate.role_bindings.API =
    "Restaurant kitchen workflow + order ticket";
  reversedPairDuplicate.role_bindings.response =
    "order ticket + Restaurant kitchen workflow";
  assert.throws(
    () =>
      validatePersonalizedCandidate(
        runtime,
        prepared.request,
        reversedPairDuplicate,
      ),
    /duplicate-role-target/u,
  );
  const tamperedRequest = /** @type {any} */ (
    structuredClone(prepared.request)
  );
  tamperedRequest.familiar_contexts = ["Unapproved finance workflow"];
  assert.throws(() =>
    validatePersonalizedCandidate(runtime, tamperedRequest, candidate),
  );

  const changed = structuredClone(profile);
  changed.familiar_worlds[0].label = "Orchestra rehearsal workflow";
  const stale = createPersonalizationRequest(
    runtime,
    validateProfile(changed),
    "S04",
  );
  assert.deepEqual(stale, {
    status: "fallback",
    reason: "projection-consent-mismatch",
  });
});

test("case-only duplicate user labels fail before a mapper request is created", () => {
  const completed = completeOnboarding(
    {
      familiar_contexts: ["Restaurant kitchen workflow"],
      familiar_anchors: ["order ticket", "Order Ticket"],
      coding_actions: ["none"],
      presentation_preference: "analogy_first",
      safety_concerns: ["privacy"],
      language: "en",
    },
    "approve",
    now,
  );
  assert.equal(completed.approved, true);
  assert.deepEqual(
    createPersonalizationRequest(runtime, completed.profile, "S04"),
    { status: "fallback", reason: "duplicate-familiar-context" },
  );
});

test("revocation clears personalized mappings and a later approval receives a new request identity", async (context) => {
  const dataDir = await mkdtemp(join(tmpdir(), "fairytail-reapproval-"));
  context.after(() => rm(dataDir, { recursive: true, force: true }));
  const approved = restaurantProfile();
  const firstRequest = createPersonalizationRequest(runtime, approved, "S04");
  assert.equal(firstRequest.status, "ready");
  if (firstRequest.status !== "ready") return;
  const mapped = await resolveAnalogy(runtime, {
    profile: approved,
    scenarioId: "S04",
    dataDir,
    personalizedCandidate: apiCandidate(firstRequest.request),
  });
  assert.equal(mapped.kind, "mapped");

  const revoked = localOnlyProfile(
    approved,
    new Date("2026-07-19T04:01:00.000Z"),
  );
  const neutral = await resolveAnalogy(runtime, {
    profile: revoked,
    scenarioId: "S04",
    dataDir,
  });
  assert.equal(neutral.kind, "neutral");
  assert.equal(neutral.reason, "neutral-local");
  await assert.rejects(
    stat(join(dataDir, PERSONALIZED_MAPPING_FILE)),
    /** @param {any} error */ (error) => error?.code === "ENOENT",
  );

  const reapproved = approvePersonalization(
    revoked,
    PROJECTION_FIELDS,
    new Date("2026-07-19T04:02:00.000Z"),
  );
  assert.equal(reapproved.approved, true);
  const secondRequest = createPersonalizationRequest(
    runtime,
    reapproved.profile,
    "S04",
  );
  assert.equal(secondRequest.status, "ready");
  if (secondRequest.status !== "ready") return;
  assert.equal(
    secondRequest.request.projection_digest,
    firstRequest.request.projection_digest,
  );
  assert.notEqual(
    secondRequest.request.approval_instance_digest,
    firstRequest.request.approval_instance_digest,
  );
  assert.notEqual(
    secondRequest.request.request_id,
    firstRequest.request.request_id,
  );
  const afterReapproval = await resolveAnalogy(runtime, {
    profile: reapproved.profile,
    scenarioId: "S04",
    dataDir,
  });
  assert.equal(afterReapproval.kind, "neutral");
  assert.equal(afterReapproval.reason, "personalized-mapping-required");
});

test("every profile CLI revocation command immediately clears both analogy stores", async (context) => {
  const temporaryRoot = await mkdtemp(
    join(tmpdir(), "fairytail-cli-revocation-"),
  );
  context.after(() => rm(temporaryRoot, { recursive: true, force: true }));

  for (const command of ["neutral", "no-analogy", "reset", "delete"]) {
    const dataDir = join(temporaryRoot, command);
    const profile = restaurantProfile();
    await saveProfile(dataDir, profile);
    const prepared = createPersonalizationRequest(runtime, profile, "S04");
    assert.equal(prepared.status, "ready");
    if (prepared.status !== "ready") continue;
    const mapped = await resolveAnalogy(runtime, {
      profile,
      scenarioId: "S04",
      dataDir,
      personalizedCandidate: apiCandidate(prepared.request),
    });
    assert.equal(mapped.kind, "mapped");
    await writeFile(
      join(dataDir, ANALOGY_CACHE_FILE),
      '{"legacy":"must be cleared"}\n',
      "utf8",
    );

    const result = await runFile(process.execPath, [
      profileCli,
      command,
      "--data-dir",
      dataDir,
    ]);
    assert.equal(JSON.parse(result.stdout).status, "ok");
    for (const file of [PERSONALIZED_MAPPING_FILE, ANALOGY_CACHE_FILE]) {
      await assert.rejects(
        stat(join(dataDir, file)),
        /** @param {any} error */ (error) => error?.code === "ENOENT",
      );
    }
    const loaded = await loadProfile(dataDir);
    assert.equal(loaded.profile.model_processing.mode, "neutral_local");
    if (command === "no-analogy") {
      assert.equal(loaded.profile.no_analogy, true);
    }
    if (command === "delete") assert.equal(loaded.source, "default");
  }
});

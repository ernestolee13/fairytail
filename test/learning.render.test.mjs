import assert from "node:assert/strict";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { loadAnalogyRuntime, resolveAnalogy } from "../src/analogy/engine.mjs";
import {
  LEARNING_SECTION_SLOTS,
  createLearningPacket,
} from "../src/learning/packet.mjs";
import {
  applyExplanationPatch,
  prepareLearningRender,
  stableLearningRenderBytes,
  validateExplanationPatch,
} from "../src/learning/render.mjs";
import { completeOnboarding } from "../src/profile/onboarding.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const now = new Date("2026-07-18T12:00:00.000Z");
const runtime = await loadAnalogyRuntime(root, now);

test("deterministic output is complete, repeatable, and precomputed", async () => {
  const packet = await packetFixture();
  const prepared = prepareLearningRender(packet);
  const repeated = prepareLearningRender(structuredClone(packet));

  assert.equal(prepared.deterministic_output.route, "deterministic");
  assert.equal(prepared.deterministic_output.sections.length, 8);
  assert.deepEqual(
    prepared.deterministic_output.sections.map((section) => section.slot),
    LEARNING_SECTION_SLOTS,
  );
  assert.ok(
    prepared.deterministic_output.sections.every(
      (section) => section.detail === "full",
    ),
  );
  assert.equal(
    prepared.deterministic_json,
    stableLearningRenderBytes(prepared.deterministic_output).toString("utf8"),
  );
  assert.deepEqual(
    stableLearningRenderBytes(repeated.deterministic_output),
    stableLearningRenderBytes(prepared.deterministic_output),
  );
  assert.equal(recursivelyFrozen(prepared), true);
});

test("a closed patch can reorder slots and select detail without changing protected content", async () => {
  const packet = await packetFixture();
  const prepared = prepareLearningRender(packet);
  const patch = validPatch(packet);
  const validated = validateExplanationPatch(JSON.stringify(patch), packet);
  const result = applyExplanationPatch(prepared, validated);

  assert.equal(result.status, "applied");
  assert.equal(result.fallback_reason, null);
  assert.equal(result.output.route, "isolated_presentation_patch");
  assert.deepEqual(
    result.output.sections.map((section) => section.slot),
    [...LEARNING_SECTION_SLOTS].reverse(),
  );
  for (const section of result.output.sections) {
    assert.deepEqual(
      section.content,
      packet.protected_render.content[section.slot],
      section.slot,
    );
  }
  assert.equal(result.output.packet_id, packet.packet_id);
  assert.deepEqual(result.output.producer, packet.producer);
  assert.equal(result.output.build_packet_hash, packet.build_packet_hash);
  assert.equal(
    result.output.protected_render_hash,
    packet.protected_render_hash,
  );
  assert.deepEqual(
    result.output.verified_task_result,
    packet.verified_task_result,
  );
  assert.equal(recursivelyFrozen(result), true);
});

test("a structurally valid cloned packet cannot authorize an optional-model patch", async () => {
  const packet = await packetFixture();
  const cloned = structuredClone(packet);
  const prepared = prepareLearningRender(cloned);
  const result = applyExplanationPatch(prepared, validPatch(cloned));

  assert.equal(result.status, "fallback");
  assert.equal(result.fallback_reason, "untrusted-packet");
  assert.strictEqual(result.output, prepared.deterministic_output);
});

test("empty, timeout, malformed, oversized, and mutating patches use byte-identical fallback", async () => {
  const packet = await packetFixture();
  const prepared = prepareLearningRender(packet);
  const baseline = stableLearningRenderBytes(prepared.deterministic_output);
  const valid = validPatch(packet);
  const invalidValues = [
    undefined,
    null,
    "",
    "   ",
    "{broken",
    "x".repeat(17 * 1024),
    { status: "timeout" },
    { ...valid, content: "replace protected facts" },
    { ...valid, packet_id: `fairytail.learning.v1.${"0".repeat(64)}` },
    { ...valid, protected_render_hash: "0".repeat(64) },
    {
      ...valid,
      section_order: [
        ...LEARNING_SECTION_SLOTS.slice(1),
        LEARNING_SECTION_SLOTS[1],
      ],
    },
    { ...valid, section_order: LEARNING_SECTION_SLOTS.slice(0, 7) },
    {
      ...valid,
      section_detail: {
        ...valid.section_detail,
        canonical_definition: "rewritten",
      },
    },
    {
      ...valid,
      section_detail: {
        ...valid.section_detail,
        replacement_text: "mutated",
      },
    },
  ];

  for (const value of invalidValues) {
    const result = applyExplanationPatch(prepared, value);
    assert.equal(result.status, "fallback");
    assert.deepEqual(stableLearningRenderBytes(result.output), baseline);
    assert.strictEqual(result.output, prepared.deterministic_output);
  }
});

/** @param {Awaited<ReturnType<typeof packetFixture>>} packet */
function validPatch(packet) {
  return {
    schema_version: 1,
    packet_id: packet.packet_id,
    protected_render_hash: packet.protected_render_hash,
    section_order: [...LEARNING_SECTION_SLOTS].reverse(),
    section_detail: Object.fromEntries(
      LEARNING_SECTION_SLOTS.map((slot, index) => [
        slot,
        index % 2 === 0 ? "compact" : "full",
      ]),
    ),
  };
}

async function packetFixture() {
  const completed = completeOnboarding(
    {
      background_categories: ["education"],
      familiar_labels: [],
      coding_actions: ["none"],
      presentation_preference: "analogy_first",
      safety_concerns: ["none"],
      language: "en",
    },
    "approve",
    now,
  );
  const resolution = await resolveAnalogy(runtime, {
    profile: completed.profile,
    scenarioId: "S04",
  });
  return createLearningPacket(runtime, {
    scenarioId: "S04",
    resolution,
    requestedLocale: "en-US",
    buildPacketHash: "b".repeat(64),
    producer: {
      role: "primary_reasoning_model",
      model_id: "claude-opus-4-6-20260205",
      packet_validated: true,
      parent_model_changed: false,
    },
    verifiedTaskResult: {
      result_id: "g010-render",
      status: "verified",
      outcome: "changed",
      summary: "The presentation boundary passed its focused checks.",
      verification: {
        check_id: "render-tests",
        status: "passed",
        evidence_id: "render-run-g010",
      },
    },
  });
}

/** @param {unknown} value */
function recursivelyFrozen(value) {
  if (typeof value !== "object" || value === null) return true;
  return (
    Object.isFrozen(value) && Object.values(value).every(recursivelyFrozen)
  );
}

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { loadAnalogyRuntime, resolveAnalogy } from "../src/analogy/engine.mjs";
import { renderScenarioForLocale } from "../src/locale/present.mjs";
import {
  createLearningPacket,
  stableLearningPacketBytes,
  validateLearningPacket,
} from "../src/learning/packet.mjs";
import { completeOnboarding } from "../src/profile/onboarding.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const now = new Date("2026-07-18T12:00:00.000Z");
const runtime = await loadAnalogyRuntime(root, now);

test("strong-primary output becomes an exact, hashed, deeply frozen learning packet", async () => {
  const { packet, resolution } = await packetFixture();
  assert.deepEqual(Object.keys(packet), [
    "schema_version",
    "packet_id",
    "producer",
    "build_packet_hash",
    "protected_render_hash",
    "protected_render",
    "verified_task_result",
  ]);
  assert.match(packet.packet_id, /^fairytail\.learning\.v1\.[a-f0-9]{64}$/u);
  assert.deepEqual(packet.producer, {
    role: "primary_reasoning_model",
    model_id: "claude-opus-4-6-20260205",
    packet_validated: true,
    parent_model_changed: false,
  });
  assert.equal(packet.build_packet_hash, "a".repeat(64));
  assert.deepEqual(
    packet.protected_render,
    renderScenarioForLocale(runtime, "S04", resolution, "ko-KR"),
  );
  assert.equal(packet.verified_task_result.status, "verified");
  assert.equal(packet.verified_task_result.verification.status, "passed");
  assert.equal(recursivelyFrozen(packet), true);

  const repeated = validateLearningPacket(structuredClone(packet));
  assert.deepEqual(
    stableLearningPacketBytes(repeated),
    stableLearningPacketBytes(packet),
  );
});

test("packet construction and validation reject extra artifacts, raw code, secrets, and drift", async () => {
  const fixture = await packetFixture();
  const input = fixture.input;

  assert.throws(
    () =>
      createLearningPacket(runtime, {
        ...input,
        prompt: "PRIVATE_PROMPT_CANARY",
      }),
    /exactly/u,
  );
  assert.throws(
    () =>
      createLearningPacket(runtime, {
        ...input,
        verifiedTaskResult: {
          ...input.verifiedTaskResult,
          summary: "const leaked = true",
        },
      }),
    /raw code/u,
  );
  assert.throws(
    () =>
      createLearningPacket(runtime, {
        ...input,
        verifiedTaskResult: {
          ...input.verifiedTaskResult,
          summary: "api_key=PRIVATE_CREDENTIAL_CANARY",
        },
      }),
    /credential/u,
  );

  const extra = /** @type {Record<string, any>} */ (
    structuredClone(fixture.packet)
  );
  extra.raw_code = "PRIVATE_CODE_CANARY";
  assert.throws(() => validateLearningPacket(extra), /exactly/u);

  const changedFacts = structuredClone(fixture.packet);
  changedFacts.protected_render.content.current_encounter.reason += " drift";
  assert.throws(
    () => validateLearningPacket(changedFacts),
    /protected_render_hash/u,
  );

  const changedId = /** @type {Record<string, any>} */ (
    structuredClone(fixture.packet)
  );
  changedId.packet_id = `fairytail.learning.v1.${"0".repeat(64)}`;
  assert.throws(() => validateLearningPacket(changedId), /packet_id/u);

  const serialized = stableLearningPacketBytes(fixture.packet).toString("utf8");
  assert.doesNotMatch(
    serialized,
    /PRIVATE_(?:PROMPT|PROFILE|LOG|CODE|CREDENTIAL)_CANARY/u,
  );
});

test("packet provenance accepts only a resolved strong primary producer", async () => {
  const fixture = await packetFixture();
  const { producer: _producer, ...missingProducer } = fixture.input;
  assert.throws(
    () => createLearningPacket(runtime, missingProducer),
    /exactly/u,
  );
  assert.throws(
    () =>
      createLearningPacket(runtime, {
        ...fixture.input,
        producer: {
          ...fixture.input.producer,
          role: "optional_presentation_model",
        },
      }),
    /primary_reasoning_model/u,
  );
  assert.throws(
    () =>
      createLearningPacket(runtime, {
        ...fixture.input,
        producer: {
          ...fixture.input.producer,
          model_id: "opus",
        },
      }),
    /resolved strong-model ID/u,
  );
  for (const modelId of [
    "claude-haiku-4-5-20251001",
    "gpt-5-mini-20260718",
    "gpt-5.3-codex-spark",
  ]) {
    assert.throws(
      () =>
        createLearningPacket(runtime, {
          ...fixture.input,
          producer: {
            ...fixture.input.producer,
            model_id: modelId,
          },
        }),
      /resolved strong-model ID/u,
      modelId,
    );
  }
  assert.throws(
    () =>
      createLearningPacket(runtime, {
        ...fixture.input,
        producer: {
          ...fixture.input.producer,
          optional_agent: "fairytail-explainer",
        },
      }),
    /exactly/u,
  );

  const changedProducer = structuredClone(fixture.packet);
  changedProducer.producer.model_id = "gpt-5.5-20260718";
  assert.throws(() => validateLearningPacket(changedProducer), /packet_id/u);
});

test("learning packet schema closes the packet and verified-result boundaries", async () => {
  const schema = JSON.parse(
    await readFile(
      join(root, "schemas", "v1", "learning-packet.schema.json"),
      "utf8",
    ),
  );
  assert.equal(schema.additionalProperties, false);
  assert.deepEqual(schema.required, [
    "schema_version",
    "packet_id",
    "producer",
    "build_packet_hash",
    "protected_render_hash",
    "protected_render",
    "verified_task_result",
  ]);
  assert.equal(schema.$defs.producer.additionalProperties, false);
  assert.equal(
    schema.$defs.producer.properties.role.const,
    "primary_reasoning_model",
  );
  assert.equal(schema.$defs.producer.properties.packet_validated.const, true);
  assert.equal(
    schema.$defs.producer.properties.parent_model_changed.const,
    false,
  );
  assert.match(
    schema.$defs.producer.properties.model_id.not.pattern,
    /haiku.*mini.*nano.*spark/u,
  );
  assert.equal(schema.$defs.protectedRender.additionalProperties, false);
  assert.equal(
    schema.$defs.protectedRender.properties.content.additionalProperties,
    false,
  );
  assert.equal(schema.$defs.verifiedTaskResult.additionalProperties, false);
  assert.equal(
    schema.$defs.verifiedTaskResult.properties.verification
      .additionalProperties,
    false,
  );
});

async function packetFixture() {
  const completed = completeOnboarding(
    {
      background_categories: ["healthcare"],
      familiar_labels: [],
      coding_actions: ["none"],
      presentation_preference: "analogy_first",
      safety_concerns: ["privacy"],
      language: "ko",
    },
    "approve",
    now,
  );
  assert.equal(completed.approved, true);
  const resolution = await resolveAnalogy(runtime, {
    profile: completed.profile,
    scenarioId: "S04",
  });
  const input = {
    scenarioId: "S04",
    resolution,
    requestedLocale: "ko-KR",
    buildPacketHash: "a".repeat(64),
    producer: {
      role: "primary_reasoning_model",
      model_id: "claude-opus-4-6-20260205",
      packet_validated: true,
      parent_model_changed: false,
    },
    verifiedTaskResult: {
      result_id: "g010-learning-boundary",
      status: "verified",
      outcome: "changed",
      summary: "The requested learning boundary passed its focused checks.",
      verification: {
        check_id: "targeted-tests",
        status: "passed",
        evidence_id: "test-run-g010",
      },
    },
  };
  return {
    input,
    resolution,
    packet: createLearningPacket(runtime, input),
  };
}

/** @param {unknown} value */
function recursivelyFrozen(value) {
  if (typeof value !== "object" || value === null) return true;
  return (
    Object.isFrozen(value) && Object.values(value).every(recursivelyFrozen)
  );
}

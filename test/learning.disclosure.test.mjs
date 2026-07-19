import assert from "node:assert/strict";
import test from "node:test";

import {
  applyProgressiveDisclosure,
  stableDisclosedRenderBytes,
} from "../src/learning/disclosure.mjs";
import { LEARNING_SECTION_SLOTS } from "../src/learning/packet.mjs";

test("compact disclosure removes only deterministic low-priority fields", () => {
  const full = renderFixture("full");
  const requestedCompact = renderFixture("compact");
  const disclosed = applyProgressiveDisclosure(requestedCompact);
  const sections = /** @type {Record<string, any>[]} */ (disclosed.sections);
  const bySlot = new Map(sections.map((section) => [section.slot, section]));
  const fullBySlot = new Map(
    /** @type {Record<string, any>[]} */ (full.sections).map((section) => [
      section.slot,
      section,
    ]),
  );

  const canonical = bySlot.get("canonical_definition");
  assert.ok(canonical);
  assert.equal(canonical.detail, "compact");
  assert.equal(
    canonical.content.concepts[0].canonical_definition,
    "A server receives requests and returns responses.",
  );
  assert.deepEqual(canonical.content.concepts[0].safety_boundary, {
    rule: "Authentication is still required.",
  });
  assert.equal(
    Object.hasOwn(canonical.content.concepts[0], "mechanism"),
    false,
  );

  const analogy = bySlot.get("analogy_or_neutral_fallback");
  assert.ok(analogy);
  assert.equal(analogy.detail, "compact");
  assert.equal(analogy.content.kind, "mapped");
  assert.equal(Object.hasOwn(analogy.content, "neutral_comparison"), false);
  assert.deepEqual(analogy.content.preserved_relations, [
    { relation_id: "accepts-and-responds" },
  ]);

  for (const slot of [
    "current_encounter",
    "analogy_breakpoint",
    "target_side_effect_risk_rollback",
    "one_next_action_and_evidence",
    "diagnostic_or_teachback",
    "protocol_fact_and_fairytail_policy_labels",
  ]) {
    const actual = bySlot.get(slot);
    const expected = fullBySlot.get(slot);
    assert.ok(actual, slot);
    assert.ok(expected, slot);
    assert.equal(actual.detail, "full", slot);
    assert.deepEqual(actual.content, expected.content, slot);
  }

  assert.ok(
    stableDisclosedRenderBytes(requestedCompact).length <
      stableDisclosedRenderBytes(full).length,
  );
  assert.equal(recursivelyFrozen(disclosed), true);
});

test("neutral fallback stays full even when compact was requested", () => {
  const render = renderFixture("compact");
  const analogy = render.sections.find(
    (section) => section.slot === "analogy_or_neutral_fallback",
  );
  assert.ok(analogy);
  analogy.content = {
    kind: "neutral",
    reason: "no-reviewed-world-match",
    neutral_comparison: [{ concept_id: "server", example: "A local service." }],
    controls: ["no_analogy"],
  };

  const disclosed = applyProgressiveDisclosure(render);
  const result = /** @type {Record<string, any>[]} */ (disclosed.sections).find(
    (section) => section.slot === "analogy_or_neutral_fallback",
  );
  assert.ok(result);
  assert.equal(result.detail, "full");
  assert.deepEqual(result.content, analogy.content);
});

/** @param {"full"|"compact"} detail */
function renderFixture(detail) {
  const contents = /** @type {Record<string, any>} */ ({
    canonical_definition: {
      content_version: "1.0.0",
      canonical_fact_set_hash: "a".repeat(64),
      concepts: [
        {
          concept_id: "server",
          canonical_definition:
            "A server receives requests and returns responses.",
          mechanism: ["listen", "handle", "respond"],
          safety_boundary: { rule: "Authentication is still required." },
        },
      ],
    },
    current_encounter: {
      scenario_id: "S01",
      reason: "A request reached a service.",
      fixed_criterion: "Observe the returned status.",
    },
    analogy_or_neutral_fallback: {
      kind: "mapped",
      mapping_id: "mapping-1",
      analogy_concept_id: "server",
      profile_world_id: "hospital-nursing",
      label: "A staffed reception desk",
      role_map: { server: "reception desk" },
      preserved_relations: [{ relation_id: "accepts-and-responds" }],
      neutral_comparison: [
        { concept_id: "server", example: "A local service." },
      ],
      controls: ["different", "no_analogy"],
    },
    analogy_breakpoint: {
      kind: "mapped-limit",
      non_mappings: ["A server is software, not a person."],
      breakpoint: "Queues and concurrency differ from a physical desk.",
    },
    target_side_effect_risk_rollback: {
      target: "local service",
      side_effect: "none",
      risk: "none",
      rollback: "not needed",
    },
    one_next_action_and_evidence: {
      action: "Inspect the response status.",
      evidence: "A recorded status code.",
    },
    diagnostic_or_teachback: {
      question: "What receives the request?",
    },
    protocol_fact_and_fairytail_policy_labels: [
      { kind: "protocol_fact", value: "HTTP status" },
    ],
  });
  return {
    render_version: 1,
    packet_id: `fairytail.learning.v1.${"b".repeat(64)}`,
    producer: {
      role: "primary_reasoning_model",
      model_id: "claude-sonnet-4-6",
      packet_validated: true,
      parent_model_changed: false,
    },
    build_packet_hash: "c".repeat(64),
    protected_render_hash: "d".repeat(64),
    route: detail === "full" ? "deterministic" : "isolated_presentation_patch",
    locale: {
      requested_locale: "en-US",
      resolved_locale: "en",
      source_locale: "en",
      fallback_reason: null,
      catalog_hash: null,
    },
    sections: LEARNING_SECTION_SLOTS.map((slot) => ({
      slot,
      detail,
      content: structuredClone(contents[slot]),
    })),
    verified_task_result: {
      result_id: "result-1",
      status: "verified",
      outcome: "changed",
      summary: "The focused check passed.",
      verification: {
        check_id: "check-1",
        status: "passed",
        evidence_id: "evidence-1",
      },
    },
  };
}

/** @param {unknown} value @returns {boolean} */
function recursivelyFrozen(value) {
  if (typeof value !== "object" || value === null) return true;
  if (!Object.isFrozen(value)) return false;
  return Object.values(value).every((child) => recursivelyFrozen(child));
}

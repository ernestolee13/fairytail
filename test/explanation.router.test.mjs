import assert from "node:assert/strict";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { loadAnalogyRuntime, resolveAnalogy } from "../src/analogy/engine.mjs";
import { routeExplanation } from "../src/explanation/router.mjs";
import { createLearningPacket } from "../src/learning/packet.mjs";
import { completeOnboarding } from "../src/profile/onboarding.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const now = new Date("2026-07-18T12:00:00.000Z");
const runtime = await loadAnalogyRuntime(root, now);
const packet = await packetFixture();

test("deterministic rendering is the pure default for invalid or non-opted-in input", () => {
  assert.deepEqual(routeExplanation({}), {
    route: "deterministic_inline",
    model: null,
    fallback: "invalid-packet",
    parent_model_changed: false,
  });
  assert.deepEqual(
    routeExplanation({
      packet,
      explicit_opt_in: false,
    }),
    {
      route: "deterministic_inline",
      model: null,
      fallback: "explicit-opt-in-required",
      parent_model_changed: false,
    },
  );
  assert.deepEqual(
    routeExplanation({
      ...eligibleInput("claude"),
      packet: structuredClone(packet),
      capabilities: {
        pluginAgent: true,
        agentName: "fairytail-explainer",
      },
    }),
    {
      route: "deterministic_inline",
      model: null,
      fallback: "untrusted-packet",
      parent_model_changed: false,
    },
  );
});

test("unresolved, unverified, reasoning, code, safety, and security work never delegates", () => {
  /** @type {Array<["presentation_only" | "ambiguity_resolved" | "result_verified" | "code_decision" | "reasoning_decision" | "safety_decision" | "security_decision" | "verification_decision", boolean, string]>} */
  const cases = [
    ["presentation_only", false, "presentation-only-required"],
    ["ambiguity_resolved", false, "ambiguity-must-be-resolved"],
    ["result_verified", false, "verification-must-be-complete"],
    ["code_decision", true, "protected-decision-required"],
    ["reasoning_decision", true, "protected-decision-required"],
    ["safety_decision", true, "protected-decision-required"],
    ["security_decision", true, "protected-decision-required"],
    ["verification_decision", true, "protected-decision-required"],
  ];
  for (const [field, value, fallback] of cases) {
    const input = eligibleInput("claude");
    input.work[field] = value;
    const result = routeExplanation(input);
    assert.equal(result.route, "deterministic_inline", field);
    assert.equal(result.model, null, field);
    assert.equal(result.fallback, fallback, field);
    assert.equal(result.parent_model_changed, false, field);
  }
});

test("Claude uses only the plugin agent capability and pins the isolated model", () => {
  const eligible = eligibleInput("claude");
  eligible.capabilities = {
    pluginAgent: true,
    agentName: "fairytail-explainer",
  };
  assert.deepEqual(routeExplanation(eligible), {
    route: "isolated_subagent",
    model: "claude-haiku-4-5-20251001",
    fallback: null,
    parent_model_changed: false,
  });

  const unavailable = eligibleInput("claude");
  unavailable.capabilities = { pluginAgent: false };
  assert.deepEqual(routeExplanation(unavailable), {
    route: "deterministic_inline",
    model: null,
    fallback: "claude-plugin-agent-unavailable",
    parent_model_changed: false,
  });

  const unnamed = eligibleInput("claude");
  unnamed.capabilities = { pluginAgent: true };
  assert.deepEqual(routeExplanation(unnamed), {
    route: "deterministic_inline",
    model: null,
    fallback: "claude-plugin-agent-unavailable",
    parent_model_changed: false,
  });
});

test("missing reasoning or verification decision fields fail closed", () => {
  /** @type {Array<"reasoning_decision" | "verification_decision">} */
  const fields = ["reasoning_decision", "verification_decision"];
  for (const field of fields) {
    const input = eligibleInput("claude");
    delete input.work[field];
    assert.deepEqual(routeExplanation(input), {
      route: "deterministic_inline",
      model: null,
      fallback: "invalid-work-contract",
      parent_model_changed: false,
    });
  }
});

test("Codex always uses the bounded deterministic route", () => {
  for (const capabilities of [
    {},
    {
      separatelyInstalled: false,
      agentName: "fairytail-explainer",
      model: "small",
    },
    { separatelyInstalled: true, agentName: "explainer", model: "small" },
    { separatelyInstalled: true, agentName: "fairytail-explainer" },
    {
      separatelyInstalled: true,
      agentName: "fairytail-explainer",
      model: "auto",
    },
    {
      separatelyInstalled: true,
      agentName: "fairytail-explainer",
      model: "gpt-5.5-latest",
    },
    {
      separatelyInstalled: true,
      agentName: "fairytail-explainer",
      model: "configured-small-model",
    },
  ]) {
    const input = eligibleInput("codex");
    input.capabilities = capabilities;
    assert.deepEqual(routeExplanation(input), {
      route: "deterministic_inline",
      model: null,
      fallback: "codex-model-route-disabled",
      parent_model_changed: false,
    });
  }

  const installed = eligibleInput("codex");
  installed.capabilities = {
    separatelyInstalled: true,
    agentName: "fairytail-explainer",
    model: "gpt-5.5",
  };
  assert.deepEqual(routeExplanation(installed), {
    route: "deterministic_inline",
    model: null,
    fallback: "codex-model-route-disabled",
    parent_model_changed: false,
  });
});

/** @param {string} host */
function eligibleInput(host) {
  return {
    packet,
    explicit_opt_in: true,
    host,
    capabilities: {},
    work: {
      presentation_only: true,
      ambiguity_resolved: true,
      result_verified: true,
      code_decision: false,
      reasoning_decision: false,
      safety_decision: false,
      security_decision: false,
      verification_decision: false,
    },
  };
}

async function packetFixture() {
  const completed = completeOnboarding(
    {
      background_categories: ["operations"],
      familiar_labels: [],
      coding_actions: ["none"],
      presentation_preference: "checklist",
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
    requestedLocale: "en",
    buildPacketHash: "c".repeat(64),
    producer: {
      role: "primary_reasoning_model",
      model_id: "claude-opus-4-6-20260205",
      packet_validated: true,
      parent_model_changed: false,
    },
    verifiedTaskResult: {
      result_id: "g010-router",
      status: "verified",
      outcome: "no_change",
      summary: "The verified result is ready for presentation.",
      verification: {
        check_id: "router-tests",
        status: "passed",
        evidence_id: "router-run-g010",
      },
    },
  });
}

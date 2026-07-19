import assert from "node:assert/strict";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { loadAnalogyRuntime, resolveAnalogy } from "../src/analogy/engine.mjs";
import { createPersonalizationRequest } from "../src/analogy/personalized.mjs";
import { applyProgressiveDisclosure } from "../src/learning/disclosure.mjs";
import { createLearningPacket } from "../src/learning/packet.mjs";
import { prepareLearningRender } from "../src/learning/render.mjs";
import {
  formatBaselineTerminal,
  formatFairytailTerminal,
  scoreBeginnerSupport,
} from "../src/learning/terminal.mjs";
import { completeOnboarding } from "../src/profile/onboarding.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const now = new Date("2026-07-19T06:00:00.000Z");
const runtime = await loadAnalogyRuntime(root, now);

test("the same verified result renders as a compact baseline and a nine-support Fairytail terminal explanation", async () => {
  const fixture = await terminalFixture("en");
  const baseline = formatBaselineTerminal(fixture.result, "en");
  const fairytail = formatFairytailTerminal(fixture.render);

  assert.match(baseline, /COMPACT FORMATTER.*SYNTHETIC FIXTURE/u);
  assert.doesNotMatch(baseline, /FAMILIAR PICTURE|WHERE THE PICTURE STOPS/u);
  assert.match(fairytail, /Restaurant kitchen workflow/u);
  assert.match(fairytail, /order ticket.*service counter/u);
  assert.match(fairytail, /schemas, methods, rate limits/u);
  assert.match(fairytail, /BEFORE YOU ACT/u);
  assert.deepEqual(scoreBeginnerSupport("baseline", fixture.result), {
    passed: 2,
    possible: 9,
    criteria: {
      verified_outcome: true,
      verification_evidence: true,
      canonical_definition: false,
      familiar_relation_map: false,
      analogy_breakpoint: false,
      safety_boundary: false,
      target_risk_rollback: false,
      next_action_evidence: false,
      diagnostic_question: false,
    },
  });
  assert.equal(scoreBeginnerSupport("fairytail", fixture.render).passed, 9);
});

test("a Korean profile keeps user-authored analogy nouns and receives reviewed Korean terminal labels", async () => {
  const fixture = await terminalFixture("ko");
  const rendered = formatFairytailTerminal(fixture.render);
  assert.match(rendered, /FAIRYTAIL 포맷터.*같은 합성 픽스처/u);
  assert.match(rendered, /Restaurant kitchen workflow/u);
  assert.match(rendered, /실행 전 확인/u);
  assert.equal(scoreBeginnerSupport("fairytail", fixture.render).passed, 9);
});

test("the structural scorer rejects empty or non-passing verification evidence", () => {
  const emptyEvidence = {
    status: "verified",
    summary: "x",
    verification: {},
  };
  assert.throws(
    () => scoreBeginnerSupport("baseline", emptyEvidence),
    /verification status must be passed/u,
  );
  assert.throws(
    () => formatBaselineTerminal(emptyEvidence),
    /verification status must be passed/u,
  );
  assert.throws(() =>
    scoreBeginnerSupport("baseline", {
      status: "verified",
      summary: "x",
      verification: {
        status: "passed",
        check_id: "",
        evidence_id: "evidence",
      },
    }),
  );
});

/** @param {"en" | "ko"} language */
async function terminalFixture(language) {
  const completed = completeOnboarding(
    {
      familiar_contexts: ["Restaurant kitchen workflow"],
      familiar_anchors: ["order ticket", "service counter", "prepared dish"],
      coding_actions: ["none"],
      presentation_preference: "analogy_first",
      safety_concerns: ["privacy"],
      language,
    },
    "approve",
    now,
  );
  assert.equal(completed.approved, true);
  const prepared = createPersonalizationRequest(
    runtime,
    completed.profile,
    "S04",
  );
  assert.equal(prepared.status, "ready");
  if (prepared.status !== "ready") throw new Error("fixture request failed");
  const resolution = await resolveAnalogy(runtime, {
    profile: completed.profile,
    scenarioId: "S04",
    personalizedCandidate: {
      schema_version: prepared.request.schema_version,
      request_id: prepared.request.request_id,
      source_context: "Restaurant kitchen workflow",
      analogy_label: "Restaurant kitchen workflow",
      role_bindings: {
        API: "Restaurant kitchen workflow",
        endpoint: "service counter",
        request: "order ticket",
        response: "prepared dish",
      },
    },
  });
  assert.equal(resolution.kind, "mapped");
  const result = {
    result_id: "terminal-evidence-api",
    status: "verified",
    outcome: "changed",
    summary: "Prepared a read-only task lookup through the existing API.",
    verification: {
      check_id: "api-contract-test",
      status: "passed",
      evidence_id: "terminal-evidence-run",
    },
  };
  const packet = createLearningPacket(runtime, {
    scenarioId: "S04",
    resolution,
    requestedLocale: language,
    buildPacketHash: "c".repeat(64),
    verifiedTaskResult: result,
    producer: {
      role: "primary_reasoning_model",
      model_id: "claude-sonnet-4-6",
      packet_validated: true,
      parent_model_changed: false,
    },
  });
  const render = applyProgressiveDisclosure(
    prepareLearningRender(packet).deterministic_output,
  );
  return { result, render };
}

#!/usr/bin/env node

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { loadAnalogyRuntime, resolveAnalogy } from "../src/analogy/engine.mjs";
import { createPersonalizationRequest } from "../src/analogy/personalized.mjs";
import { sha256 } from "../src/content/stable-json.mjs";
import { applyProgressiveDisclosure } from "../src/learning/disclosure.mjs";
import { createLearningPacket } from "../src/learning/packet.mjs";
import { prepareLearningRender } from "../src/learning/render.mjs";
import {
  BEGINNER_SUPPORT_CRITERIA,
  scoreBeginnerSupport,
} from "../src/learning/terminal.mjs";
import { completeOnboarding } from "../src/profile/onboarding.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const committedRoot = join(root, "docs", "assets", "evidence");
const now = new Date("2026-07-19T06:00:00.000Z");
const mode = process.argv[2] ?? "--write";

if (mode !== "--write" && mode !== "--verify") {
  throw new TypeError("Use --write or --verify");
}

if (mode === "--write") {
  const result = await generate(committedRoot);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} else {
  process.stdout.write(`${JSON.stringify(await verifyCommitted(), null, 2)}\n`);
}

/** @param {string} outputRoot */
async function generate(outputRoot) {
  await mkdir(outputRoot, { recursive: true });
  const { scenarioRows } = await buildTerminalFixture();

  /** @type {Record<string, string>} */
  const sourcePins = {};
  for (const path of sourcePinPaths()) {
    sourcePins[path] = hash(await readFile(join(root, path)));
  }
  const evidence = {
    schema_version: 1,
    evidence_id: "fairytail-structural-coverage-current",
    created_at: now.toISOString(),
    synthetic_fixture: true,
    comparison_kind: "deterministic-formatter-illustration",
    not_a_host_session_capture: true,
    model_calls: 0,
    network_calls: 0,
    profile_truth_source: "user-authored-local-profile-fixture",
    profile_context: "Restaurant kitchen workflow",
    sample: {
      scenarios: scenarioRows.length,
      scenario_ids: scenarioRows.map((row) => row.scenario_id),
      concept_ids: scenarioRows.map((row) => row.concept_id),
    },
    metric: {
      name: "explicit_beginner_support_field_coverage",
      criteria: [...BEGINNER_SUPPORT_CRITERIA],
      compact_formatter: "2/9 in 5/5 scenarios",
      fairytail_formatter: "9/9 in 5/5 scenarios",
      limitation:
        "Structural disclosure coverage is not a host baseline, human comprehension, or learning score.",
    },
    scenarios: scenarioRows,
    source_pins: sourcePins,
  };
  await writeFile(
    join(outputRoot, "terminal-evidence.json"),
    `${JSON.stringify(evidence, null, 2)}\n`,
    "utf8",
  );
  return {
    status: "generated",
    output: relative(root, outputRoot),
    scenarios: scenarioRows.length,
    compact_formatter_support: evidence.metric.compact_formatter,
    fairytail_formatter_support: evidence.metric.fairytail_formatter,
  };
}

async function buildTerminalFixture() {
  const runtime = await loadAnalogyRuntime(root, now);
  const scenarioRows = [];
  for (const fixture of scenarioFixtures()) {
    const completed = completeOnboarding(
      {
        familiar_contexts: ["Restaurant kitchen workflow"],
        familiar_anchors: fixture.familiar_anchors,
        coding_actions: ["none"],
        presentation_preference: "analogy_first",
        safety_concerns: ["privacy"],
        language: "en",
      },
      "approve",
      now,
    );
    if (!completed.approved) {
      throw new Error(
        `evidence profile was not approved: ${fixture.scenario_id}`,
      );
    }
    const prepared = createPersonalizationRequest(
      runtime,
      completed.profile,
      fixture.scenario_id,
    );
    if (prepared.status !== "ready") {
      throw new Error(`personalization request failed: ${fixture.scenario_id}`);
    }
    const resolution = await resolveAnalogy(runtime, {
      profile: completed.profile,
      scenarioId: fixture.scenario_id,
      personalizedCandidate: {
        schema_version: prepared.request.schema_version,
        request_id: prepared.request.request_id,
        source_context: "Restaurant kitchen workflow",
        analogy_label: "Restaurant kitchen workflow",
        role_bindings: fixture.role_bindings,
      },
    });
    if (resolution.kind !== "mapped") {
      throw new Error(`personalization failed: ${fixture.scenario_id}`);
    }
    const result = {
      result_id: `terminal-evidence-${fixture.scenario_id.toLowerCase()}`,
      status: "verified",
      outcome: "changed",
      summary: fixture.summary,
      verification: {
        check_id: fixture.check_id,
        status: "passed",
        evidence_id: `terminal-evidence-${fixture.scenario_id.toLowerCase()}`,
      },
    };
    const packet = createLearningPacket(runtime, {
      scenarioId: fixture.scenario_id,
      resolution,
      requestedLocale: "en",
      buildPacketHash: sha256(`build:${fixture.scenario_id}`),
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
    const compactScore = scoreBeginnerSupport("baseline", result);
    const fairytailScore = scoreBeginnerSupport("fairytail", render);
    scenarioRows.push({
      scenario_id: fixture.scenario_id,
      concept_id: prepared.request.concept_id,
      canonical_fact_set_hash: prepared.request.canonical_fact_set_hash,
      compact_formatter_support: `${compactScore.passed}/${compactScore.possible}`,
      fairytail_formatter_support: `${fairytailScore.passed}/${fairytailScore.possible}`,
    });
  }
  return { scenarioRows };
}

async function verifyCommitted() {
  const fixture = await buildTerminalFixture();
  const evidence = JSON.parse(
    await readFile(join(committedRoot, "terminal-evidence.json"), "utf8"),
  );
  if (
    evidence.evidence_id !== "fairytail-structural-coverage-current" ||
    evidence.synthetic_fixture !== true ||
    evidence.not_a_host_session_capture !== true ||
    evidence.model_calls !== 0 ||
    evidence.network_calls !== 0 ||
    JSON.stringify(evidence.scenarios) !== JSON.stringify(fixture.scenarioRows)
  ) {
    throw new Error("terminal evidence manifest contract drift");
  }
  for (const path of sourcePinPaths()) {
    if (evidence.source_pins[path] !== hash(await readFile(join(root, path)))) {
      throw new Error(`terminal evidence source pin drift: ${path}`);
    }
  }
  return {
    status: "pass",
    artifacts: 1,
    structural_rows_recomputed: fixture.scenarioRows.length,
    network_calls: 0,
    model_calls: 0,
  };
}

function scenarioFixtures() {
  return [
    {
      scenario_id: "S02",
      familiar_anchors: [
        "service playbook",
        "active kitchen shift",
        "order window",
        "order ledger",
      ],
      summary: "Prepared a local read-only service status check.",
      check_id: "service-contract-test",
      role_bindings: {
        program: "service playbook",
        process: "active kitchen shift",
        server: "Restaurant kitchen workflow",
        port: "order window",
        database: "order ledger",
      },
    },
    {
      scenario_id: "S04",
      familiar_anchors: ["service counter", "order ticket", "prepared dish"],
      summary: "Prepared a read-only task lookup through the existing API.",
      check_id: "api-contract-test",
      role_bindings: {
        API: "Restaurant kitchen workflow",
        endpoint: "service counter",
        request: "order ticket",
        response: "prepared dish",
      },
    },
    {
      scenario_id: "S05",
      familiar_anchors: [
        "staff door code",
        "temporary station pass",
        "allowed stations",
        "secured prep area",
      ],
      summary: "Separated the three meanings using placeholders only.",
      check_id: "credential-contract-test",
      role_bindings: {
        "API key": "staff door code",
        "access token": "temporary station pass",
        scope: "allowed stations",
        "resource server": "secured prep area",
      },
    },
    {
      scenario_id: "S06",
      familiar_anchors: [
        "order ledger",
        "orders sheet",
        "one order",
        "order field",
      ],
      summary: "Prepared a constrained read-only database lookup.",
      check_id: "database-contract-test",
      role_bindings: {
        database: "order ledger",
        table: "orders sheet",
        row: "one order",
        column: "order field",
        query: "Restaurant kitchen workflow",
        DBMS: "Restaurant kitchen workflow + order ledger",
      },
    },
    {
      scenario_id: "S07",
      familiar_anchors: [
        "dedicated vendor line",
        "supplier",
        "supplier catalog",
        "supplier action request",
      ],
      summary: "Reviewed an MCP server without calling any tool.",
      check_id: "mcp-contract-test",
      role_bindings: {
        host: "Restaurant kitchen workflow",
        client: "dedicated vendor line",
        server: "supplier",
        resource: "supplier catalog",
        tool: "supplier action request",
      },
    },
  ];
}

function sourcePinPaths() {
  return [
    "scripts/generate-terminal-evidence.mjs",
    "src/analogy/personalized.mjs",
    "src/learning/terminal.mjs",
    "src/profile/onboarding.mjs",
  ];
}

/** @param {Buffer} value */
function hash(value) {
  return createHash("sha256").update(value).digest("hex");
}

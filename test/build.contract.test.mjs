import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  BUILD_LADDER,
  BuildContractError,
  PONYTAIL_PROVENANCE,
  createBuildDecisionPacket,
  validateBuildDecisionPacket,
} from "../src/build/contract.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));

/** @param {string} selected */
function ladder(selected = "standard_library") {
  const selectedIndex = BUILD_LADDER.indexOf(selected);
  assert.notEqual(selectedIndex, -1);
  return BUILD_LADDER.map((rung, index) => ({
    rung,
    status:
      index < selectedIndex
        ? "does_not_satisfy"
        : index === selectedIndex
          ? "satisfies"
          : "not_evaluated",
    evidence: `${rung} evidence`,
  }));
}

/** @param {boolean} applicable @param {string} [evidence] */
function disposition(
  applicable,
  evidence = "Reviewed against the traced flow",
) {
  return {
    applicable,
    status: applicable ? "preserved" : "not_applicable",
    evidence,
  };
}

/** @param {Record<string, unknown>} [overrides] */
function input(overrides = {}) {
  return {
    task: {
      summary: "Reuse a parser helper",
      requested_outcome: "Implement the requested parser behavior",
      explicit_requirements: ["Preserve validation", "Return stable output"],
      implementation_required: true,
    },
    trace: {
      completed_before_ladder: true,
      entry_point: "src/index.mjs:handleRequest",
      flow: ["handleRequest -> parseRequest", "parseRequest -> normalizeValue"],
      callers: ["src/cli.mjs:main", "test/index.test.mjs"],
      shared_root: "src/index.mjs:handleRequest",
      evidence: ["rg found both production and test callers"],
    },
    safety: {
      trust_boundary_validation: disposition(true),
      data_loss_prevention: disposition(false),
      security: disposition(false),
      accessibility: disposition(false),
      explicit_requirements: disposition(true),
      hardware_calibration: disposition(false),
    },
    complexity: { kinds: ["parser", "branch"] },
    ladder: ladder(),
    runnable_check: {
      argv: ["node", "--test", "test/parser.test.mjs"],
      expected_evidence: "The focused parser regression test passes",
    },
    ...overrides,
  };
}

/** @param {unknown} value @param {string} code */
function throwsCode(value, code) {
  assert.throws(
    () => createBuildDecisionPacket(value),
    /** @param {unknown} error */
    (error) => error instanceof BuildContractError && error.code === code,
  );
}

test("trace-first contract selects the first working rung and freezes the packet", () => {
  const packet = createBuildDecisionPacket(input());

  assert.equal(packet.decision.selected_rung, "standard_library");
  assert.equal(packet.decision.rationale, "standard_library evidence");
  assert.deepEqual(packet.provenance, PONYTAIL_PROVENANCE);
  assert.equal(
    packet.provenance.commit,
    "16f29800fd2681bdf24f3eb4ccffe38be3baec6b",
  );
  assert.equal(packet.provenance.license, "MIT");
  assert.equal(packet.runnable_check.required, true);
  assert.deepEqual(packet.runnable_check.reason_kinds, ["branch", "parser"]);
  assert.match(packet.packet_hash, /^[a-f0-9]{64}$/u);
  assert.ok(Object.isFrozen(packet));
  assert.ok(Object.isFrozen(packet.trace.flow));
  assert.ok(Object.isFrozen(packet.safety.security));
  assert.throws(() => {
    packet.trace.flow.push("mutation");
  }, TypeError);
});

test("malformed, inherited, prototype, and unsafe-key inputs are rejected", () => {
  throwsCode(null, "not-a-plain-object");
  throwsCode({ ...input(), extra: true }, "unknown-field");

  const inherited = Object.create({ task: input().task });
  Object.assign(inherited, input());
  throwsCode(inherited, "unsafe-prototype");

  const polluted = JSON.parse(
    JSON.stringify(input()).replace(
      /"task":\{/u,
      '"task":{"__proto__":{"polluted":true},',
    ),
  );
  throwsCode(polluted, "unsafe-key");

  throwsCode(
    input({
      trace: { ...input().trace, constructor: "canary" },
    }),
    "unsafe-key",
  );
  assert.equal(/** @type {any} */ ({}).polluted, undefined);
});

test("real-flow, caller, and shared-root evidence must precede the ladder", () => {
  const invalidTrace = {
    ...input().trace,
    completed_before_ladder: false,
    callers: [],
  };
  const invalidLadder = ladder("installed_dependency");
  invalidLadder[2].status = "satisfies";

  assert.throws(
    () =>
      createBuildDecisionPacket(
        input({ trace: invalidTrace, ladder: invalidLadder }),
      ),
    /** @param {unknown} error */
    (error) =>
      error instanceof BuildContractError &&
      error.path === "$input.trace.completed_before_ladder",
  );
  throwsCode(
    input({ trace: { ...input().trace, callers: [] } }),
    "invalid-list-length",
  );
  throwsCode(
    input({ trace: { ...input().trace, shared_root: "" } }),
    "invalid-string",
  );
});

test("an installed dependency cannot be selected ahead of an earlier working rung", () => {
  const invalid = ladder("installed_dependency");
  invalid[2].status = "satisfies";
  throwsCode(input({ ladder: invalid }), "ladder-short-circuit-violation");

  const reordered = ladder();
  [reordered[2], reordered[4]] = [reordered[4], reordered[2]];
  throwsCode(input({ ladder: reordered }), "unexpected-value");
});

test("all applicable safety invariants must be preserved", () => {
  throwsCode(
    input({
      safety: {
        ...input().safety,
        explicit_requirements: disposition(false),
      },
    }),
    "explicit-requirements-must-apply",
  );
  throwsCode(
    input({
      safety: {
        ...input().safety,
        security: {
          applicable: true,
          status: "not_applicable",
          evidence: "Incorrect downgrade",
        },
      },
    }),
    "safety-status-mismatch",
  );
  const withoutHardware = { ...input().safety };
  delete (/** @type {any} */ (withoutHardware).hardware_calibration);
  throwsCode(input({ safety: withoutHardware }), "missing-field");
});

test("nontrivial checks are closed argv data and are never interpreted", async () => {
  throwsCode(
    input({
      runnable_check: { argv: null, expected_evidence: null },
    }),
    "not-an-array",
  );
  throwsCode(
    input({
      runnable_check: {
        argv: ["sh", "-c", "touch", "/tmp/canary"],
        expected_evidence: "A check passes",
      },
    }),
    "executable-not-allowlisted",
  );
  throwsCode(
    input({
      runnable_check: {
        argv: ["node", "--test", "test/x.mjs;touch-canary"],
        expected_evidence: "A check passes",
      },
    }),
    "unsafe-argv-token",
  );
  throwsCode(
    input({
      safety: { ...input().safety, security: disposition(true) },
      complexity: { kinds: ["branch"] },
    }),
    "security-kind-required",
  );

  const trivialPacket = createBuildDecisionPacket(
    input({
      complexity: { kinds: ["trivial"] },
      runnable_check: { argv: null, expected_evidence: null },
    }),
  );
  assert.deepEqual(trivialPacket.runnable_check, {
    required: false,
    reason_kinds: [],
    argv: null,
    expected_evidence: null,
  });
  throwsCode(
    input({
      complexity: { kinds: ["trivial"] },
      runnable_check: {
        argv: ["node", "--test"],
        expected_evidence: "A check passes",
      },
    }),
    "unexpected-value",
  );

  const source = await readFile(
    join(root, "src", "build", "contract.mjs"),
    "utf8",
  );
  assert.doesNotMatch(
    source,
    /node:child_process|\bspawn(?:Sync)?\s*\(|\bexec(?:File|Sync)?\s*\(/u,
  );
});

test("stable JSON hashing is independent of input object key order and detects tampering", () => {
  const first = createBuildDecisionPacket(input());
  const original = input();
  const reordered = {
    runnable_check: original.runnable_check,
    ladder: original.ladder,
    complexity: original.complexity,
    safety: original.safety,
    trace: original.trace,
    task: original.task,
  };
  const second = createBuildDecisionPacket(reordered);

  assert.equal(first.packet_hash, second.packet_hash);
  assert.deepEqual(validateBuildDecisionPacket(first), first);

  const tampered = JSON.parse(JSON.stringify(first));
  tampered.task.summary = "Tampered summary";
  assert.throws(
    () => validateBuildDecisionPacket(tampered),
    /** @param {unknown} error */
    (error) =>
      error instanceof BuildContractError && error.code === "hash-mismatch",
  );
  const extra = JSON.parse(JSON.stringify(first));
  extra.decision.prompt = "unsafe extension";
  assert.throws(() => validateBuildDecisionPacket(extra), BuildContractError);
});

test("schema and skill keep the contract closed, pinned, and build-not-talk scoped", async () => {
  const schema = JSON.parse(
    await readFile(
      join(root, "schemas", "v1", "build-decision-packet.schema.json"),
      "utf8",
    ),
  );
  assert.equal(schema.$schema, "https://json-schema.org/draft/2020-12/schema");
  assert.equal(schema.additionalProperties, false);
  assert.equal(schema.properties.provenance.additionalProperties, false);
  assert.equal(
    schema.properties.trace.properties.completed_before_ladder.const,
    true,
  );
  assert.equal(schema.properties.ladder.minItems, 7);
  assert.equal(schema.properties.ladder.maxItems, 7);

  const skill = await readFile(
    join(root, "skills", "build", "SKILL.md"),
    "utf8",
  );
  assert.match(skill, /^---\nname: build\n/u);
  assert.match(skill, /16f29800fd2681bdf24f3eb4ccffe38be3baec6b/u);
  assert.match(skill, /MIT License/u);
  assert.match(skill, /governs building, not how much explanation/u);
});

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  assertMetricEnvelope,
  invalidMetric,
  metric,
  unavailableMetric,
} from "../src/benchmark/contracts.mjs";
import {
  assertPublishableRun,
  validateBenchmarkRun,
} from "../src/benchmark/record.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));

test("metric envelopes preserve real zero and never coerce missing values", () => {
  assert.deepEqual(metric(0, "measured", "fixture"), {
    value: 0,
    status: "measured",
    source: "fixture",
    reason: null,
  });
  assert.deepEqual(unavailableMetric("fixture", "not reported").value, null);
  assert.deepEqual(invalidMetric("fixture", "malformed").value, null);
  assert.throws(() => metric(null, "measured", "fixture"));
  assert.throws(() => metric(0, "unavailable", "fixture", "missing"));
  assert.throws(() =>
    assertMetricEnvelope({
      value: null,
      status: "unavailable",
      source: "fixture",
      reason: null,
    }),
  );
});

test("the committed run schema exposes the exact metric envelope and three headline arms", async () => {
  const schema = JSON.parse(
    await readFile(
      resolve(root, "schemas", "v1", "benchmark-run.schema.json"),
      "utf8",
    ),
  );
  assert.equal(
    schema.$id,
    "https://fairytail.local/schemas/v1/benchmark-run.schema.json",
  );
  assert.deepEqual(schema.properties.arm.enum, [
    "baseline",
    "ponytail",
    "fairytail-local",
  ]);
  assert.deepEqual(schema.$defs.metric.required, [
    "value",
    "status",
    "source",
    "reason",
  ]);
});

test("synthetic records validate structurally but fail the publication guard", async () => {
  const artifact = JSON.parse(
    await readFile(
      resolve(root, "benchmarks", "g010", "results", "synthetic-selftest.json"),
      "utf8",
    ),
  );
  assert.equal(artifact.runs.length, 3);
  for (const run of artifact.runs) {
    assert.equal(validateBenchmarkRun(run), run);
    assert.throws(() => assertPublishableRun(run), /Synthetic results/u);
  }
});

import assert from "node:assert/strict";
import test from "node:test";

import { summarizeSeries } from "../src/benchmark/statistics.mjs";

test("statistics retain raw runs and report n, mean, sample SD, median, and IQR", () => {
  const summary = summarizeSeries([1, 2, 3, 4], "fixture");
  assert.deepEqual(summary.raw.value, [1, 2, 3, 4]);
  assert.equal(summary.n.value, 4);
  assert.equal(summary.mean.value, 2.5);
  assert.ok(
    Math.abs(Number(summary.sample_sd.value) - Math.sqrt(5 / 3)) < 1e-12,
  );
  assert.equal(summary.median.value, 2.5);
  assert.equal(summary.q1.value, 1.75);
  assert.equal(summary.q3.value, 3.25);
  assert.equal(summary.iqr.value, 1.5);
});

test("insufficient observations stay unavailable instead of becoming zero", () => {
  const singleton = summarizeSeries([7], "fixture");
  assert.equal(singleton.sample_sd.value, null);
  assert.equal(singleton.sample_sd.status, "unavailable");
  const empty = summarizeSeries([], "fixture");
  assert.equal(empty.n.value, 0);
  assert.equal(empty.mean.value, null);
  assert.equal(empty.mean.status, "unavailable");
});

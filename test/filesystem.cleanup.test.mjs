import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  rethrowAfterCleanup,
  unlinkIfPresent,
} from "../src/filesystem-cleanup.mjs";

test("successful cleanup preserves the exact primary failure", async () => {
  const primary = new Error("primary");
  /** @type {string[]} */
  const calls = [];
  await assert.rejects(
    rethrowAfterCleanup(
      primary,
      [async () => calls.push("first"), async () => calls.push("second")],
      "cleanup incomplete",
    ),
    (error) => error === primary,
  );
  assert.deepEqual(calls, ["first", "second"]);
});

test("cleanup failures are aggregated while absent files remain harmless", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "fairytail-cleanup-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  await unlinkIfPresent(join(root, "already-absent"));

  const primary = new Error("primary");
  const cleanup = new Error("cleanup");
  await assert.rejects(
    rethrowAfterCleanup(
      primary,
      [
        async () => {
          throw cleanup;
        },
        async () => undefined,
      ],
      "cleanup incomplete",
    ),
    (error) => {
      assert.ok(error instanceof AggregateError);
      assert.deepEqual(error.errors, [primary, cleanup]);
      assert.equal(error.cause, primary);
      return true;
    },
  );
});

import assert from "node:assert/strict";
import { dirname } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { verifyStaticBenchmarkAssets } from "../src/benchmark/verify.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));

test("the retained G010 manifest rejects current source drift without network access", async () => {
  const originalFetch = globalThis.fetch;
  let networkCalls = 0;
  globalThis.fetch = async () => {
    networkCalls += 1;
    throw new Error("network forbidden in G010 deterministic CI");
  };
  try {
    await assert.rejects(
      verifyStaticBenchmarkAssets(root),
      /Pinned file hash mismatch for skills\/build\/SKILL\.md/u,
    );
    assert.equal(networkCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { loadG002Bundle } from "../src/content/load.mjs";
import { validateG002Bundle } from "../src/content/validate.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));

test("content loading and validation make zero fetch calls", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    throw new Error("network tripwire");
  };

  try {
    const result = validateG002Bundle(await loadG002Bundle(root));
    assert.equal(result.status, "pass");
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("the G002 loader and validator import no network, process, or execution capability", async () => {
  const paths = [
    join(root, "src", "content", "load.mjs"),
    join(root, "src", "content", "stable-json.mjs"),
    join(root, "src", "content", "validate.mjs"),
    join(root, "scripts", "validate-content.mjs"),
  ];
  const forbidden = [
    /node:(?:http|https|net|tls|dns|child_process)/u,
    /\bfetch\s*\(/u,
    /\beval\s*\(/u,
    /\bFunction\s*\(/u,
    /\bimport\s*\(/u,
  ];

  for (const path of paths) {
    const source = await readFile(path, "utf8");
    for (const expression of forbidden) {
      assert.doesNotMatch(source, expression, path);
    }
  }
});

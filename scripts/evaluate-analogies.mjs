#!/usr/bin/env node

import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { evaluateGoldenCases } from "../src/analogy/evaluate.mjs";
import { loadAnalogyRuntime } from "../src/analogy/engine.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));

try {
  const runtime = await loadAnalogyRuntime(root, new Date());
  const result = await evaluateGoldenCases(runtime, new Date());
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (result.status !== "pass") process.exitCode = 1;
} catch (error) {
  const message = error instanceof Error ? error.message : "Unknown error";
  process.stderr.write(
    `${JSON.stringify({ status: "fail", error: message }, null, 2)}\n`,
  );
  process.exitCode = 1;
}

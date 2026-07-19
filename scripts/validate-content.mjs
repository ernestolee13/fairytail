#!/usr/bin/env node

import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadG002Bundle } from "../src/content/load.mjs";
import { validateG002Bundle } from "../src/content/validate.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));

try {
  const result = validateG002Bundle(await loadG002Bundle(root));
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} catch (error) {
  const message =
    error instanceof Error ? error.message : "Unknown validation error";
  process.stderr.write(
    `${JSON.stringify({ status: "fail", error: message }, null, 2)}\n`,
  );
  process.exitCode = 1;
}

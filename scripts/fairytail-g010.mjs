#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { stdout } from "node:process";
import { fileURLToPath } from "node:url";

import { parseJsonDocument } from "../src/content/load.mjs";
import { prepareG010Runtime } from "../src/runtime/g010.mjs";

const GENERIC_ERROR = Object.freeze({
  status: "error",
  code: "g010-prepare-failed",
});
const pluginRoot = dirname(dirname(fileURLToPath(import.meta.url)));

try {
  const options = parseArguments(process.argv.slice(2));
  const input = parseJsonDocument(
    await readFile(resolve(options.input)),
    "Fairytail G010 input",
  );
  const output = await prepareG010Runtime({
    pluginRoot,
    dataDir: resolve(options.dataDir),
    input,
  });
  stdout.write(`${JSON.stringify(output)}\n`);
} catch {
  stdout.write(`${JSON.stringify(GENERIC_ERROR)}\n`);
  process.exitCode = 1;
}

/** @param {string[]} args */
function parseArguments(args) {
  if (args[0] !== "prepare" || args.length !== 5) {
    throw new TypeError(
      "Expected prepare with exact local input and data paths",
    );
  }
  /** @type {{ input?: string, dataDir?: string }} */
  const parsed = {};
  for (let index = 1; index < args.length; index += 2) {
    const option = args[index];
    const value = args[index + 1];
    if (!value || value.startsWith("--")) {
      throw new TypeError("G010 option value is missing");
    }
    if (option === "--input" && parsed.input === undefined) {
      parsed.input = value;
    } else if (option === "--data-dir" && parsed.dataDir === undefined) {
      parsed.dataDir = value;
    } else {
      throw new TypeError("G010 option is unknown or duplicated");
    }
  }
  if (!parsed.input || !parsed.dataDir) {
    throw new TypeError("G010 input and data paths are required");
  }
  return { input: parsed.input, dataDir: parsed.dataDir };
}

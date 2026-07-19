#!/usr/bin/env node

import { dirname, resolve } from "node:path";
import { env, stdout } from "node:process";
import { fileURLToPath } from "node:url";

import {
  prepareDirectConcept,
  prepareDirectConceptBundle,
} from "../../../src/runtime/concept.mjs";
import { resolveFairytailDataDir } from "../../../src/profile/data-dir.mjs";

const GENERIC_ERROR = Object.freeze({
  status: "error",
  code: "direct-concept-failed",
});
const DEMO_CONCEPTS = Object.freeze(["api", "server", "database"]);
const pluginRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

try {
  const options = parseArguments(process.argv.slice(2));
  const dataDir =
    options.mode === "demo"
      ? null
      : resolveFairytailDataDir({
          dataDir: options.dataDir,
          host: options.host,
          environment: env,
        });
  const concepts =
    options.mode === "demo" ? DEMO_CONCEPTS : options.concept.split(",");
  const output =
    concepts.length === 1
      ? await prepareDirectConcept({
          pluginRoot,
          dataDir,
          concept: concepts[0],
          requestedLocale: options.locale,
        })
      : await prepareDirectConceptBundle({
          pluginRoot,
          dataDir,
          concepts,
          requestedLocale: options.locale,
        });
  stdout.write(
    options.json
      ? `${JSON.stringify(output)}\n`
      : `${output.explanation.trimEnd()}\n`,
  );
} catch {
  stdout.write(`${JSON.stringify(GENERIC_ERROR)}\n`);
  process.exitCode = 1;
}

/** @param {string[]} args */
function parseArguments(args) {
  if (args[0] === "demo") {
    if (
      args.length > 2 ||
      (args[1] !== undefined && args[1] !== "en" && args[1] !== "ko")
    ) {
      throw new TypeError("direct concept demo arguments are invalid");
    }
    return {
      mode: /** @type {const} */ ("demo"),
      locale: args[1] ?? "en",
      json: false,
    };
  }

  /** @type {{ mode: "concept", concept?: string, locale?: string, dataDir?: string, host?: "claude" | "codex", json: boolean }} */
  const result = { mode: "concept", json: false };
  for (let index = 0; index < args.length; index += 1) {
    const option = args[index];
    if (option === "--json" && result.json === false) {
      result.json = true;
      continue;
    }
    const value = args[index + 1];
    if (!value || value.startsWith("--")) {
      throw new TypeError("direct concept option is incomplete");
    }
    if (option === "--concept" && result.concept === undefined) {
      result.concept = value;
    } else if (option === "--locale" && result.locale === undefined) {
      result.locale = value;
    } else if (option === "--data-dir" && result.dataDir === undefined) {
      result.dataDir = value;
    } else if (
      option === "--host" &&
      result.host === undefined &&
      (value === "claude" || value === "codex")
    ) {
      result.host = value;
    } else {
      throw new TypeError("direct concept option is invalid or duplicated");
    }
    index += 1;
  }
  if (!result.concept || !result.locale) {
    throw new TypeError("concept and locale are required");
  }
  return result;
}

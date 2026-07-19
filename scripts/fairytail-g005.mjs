#!/usr/bin/env node

import { resolve } from "node:path";
import { dirname } from "node:path";
import { stdout } from "node:process";
import { fileURLToPath } from "node:url";

import { readJsonDocument } from "../src/content/load.mjs";
import {
  deleteLearningEvents,
  dueLearningEvidence,
  exportLearningEvidence,
  loadLearningEvidenceStore,
} from "../src/learning/store.mjs";
import {
  listG005Scenarios,
  prepareG005Surface,
  recordG005Observation,
  reviewDueG005,
} from "../src/runtime/g005.mjs";

const GENERIC_ERROR = Object.freeze({
  status: "error",
  code: "g005-operation-failed",
});
const pluginRoot = dirname(dirname(fileURLToPath(import.meta.url)));

try {
  const options = /** @type {Record<string, any>} */ (
    parseArguments(process.argv.slice(2))
  );
  let output;
  if (options.command === "surface") {
    output = await prepareG005Surface({
      pluginRoot,
      dataDir: options.dataDir,
      input: await readJsonDocument(options.input),
    });
  } else if (options.command === "observe") {
    output = await recordG005Observation({
      pluginRoot,
      dataDir: options.dataDir,
      input: await readJsonDocument(options.input),
    });
  } else if (options.command === "review") {
    output = await reviewDueG005({
      pluginRoot,
      dataDir: options.dataDir,
      requestedLocale: options.locale,
    });
  } else if (options.command === "status") {
    const [loaded, due] = await Promise.all([
      loadLearningEvidenceStore(options.dataDir),
      dueLearningEvidence(options.dataDir),
    ]);
    output = {
      schema_version: 1,
      status: "ok",
      source: loaded.source,
      store_health: loaded.reason,
      concept_count: loaded.records.length,
      due_count: due.length,
      states: countStates(loaded.records),
      raw_history_included: false,
    };
  } else if (options.command === "scenarios") {
    output = await listG005Scenarios(pluginRoot);
  } else if (options.command === "reset") {
    const deleted = await deleteLearningEvents(options.dataDir);
    output = { schema_version: 1, status: "ok", reset: deleted.deleted };
  } else {
    await exportLearningEvidence(options.dataDir, options.destination);
    output = { schema_version: 1, status: "ok", exported: true };
  }
  stdout.write(`${JSON.stringify(output)}\n`);
} catch {
  stdout.write(`${JSON.stringify(GENERIC_ERROR)}\n`);
  process.exitCode = 1;
}

/** @param {string[]} args */
function parseArguments(args) {
  const command = args[0];
  if (!command) throw new TypeError("G005 command is required");
  if (command === "scenarios") {
    if (args.length !== 1) throw new TypeError("scenarios takes no options");
    return { command };
  }
  if (command === "export") {
    if (args.length !== 4 || args[2] !== "--data-dir") {
      throw new TypeError("export requires a destination and data directory");
    }
    return {
      command,
      destination: localPath(args[1], "destination"),
      dataDir: localPath(args[3], "data directory"),
    };
  }
  if (
    !new Set(["surface", "observe", "review", "status", "reset"]).has(command)
  ) {
    throw new TypeError("unsupported G005 command");
  }
  const allowed =
    command === "surface" || command === "observe"
      ? new Set(["--input", "--data-dir"])
      : command === "review"
        ? new Set(["--data-dir", "--locale"])
        : new Set(["--data-dir"]);
  /** @type {Record<string, string>} */
  const values = {};
  for (let index = 1; index < args.length; index += 2) {
    const option = args[index];
    const value = args[index + 1];
    if (
      !allowed.has(option) ||
      !value ||
      value.startsWith("--") ||
      option in values
    ) {
      throw new TypeError("G005 option is invalid or duplicated");
    }
    values[option] = value;
  }
  if (!values["--data-dir"]) {
    throw new TypeError("G005 data directory is required");
  }
  const dataDir = localPath(values["--data-dir"], "data directory");
  if (command === "surface" || command === "observe") {
    if (!values["--input"] || Object.keys(values).length !== 2) {
      throw new TypeError("G005 input file is required");
    }
    return {
      command,
      dataDir,
      input: localPath(values["--input"], "input file"),
    };
  }
  if (command === "review") {
    const locale = values["--locale"] ?? "en";
    if (!new Set(["en", "ko"]).has(locale)) {
      throw new TypeError("G005 locale must be en or ko");
    }
    return { command, dataDir, locale };
  }
  if (Object.keys(values).length !== 1) {
    throw new TypeError("G005 command received an extra option");
  }
  return { command, dataDir };
}

/** @param {unknown[]} records */
function countStates(records) {
  const counts = {
    unseen: 0,
    exposed: 0,
    explained_once: 0,
    retrieved_delayed: 0,
    applied_novel: 0,
  };
  for (const value of records) {
    const record = /** @type {Record<string, any>} */ (value);
    const state = record.state;
    if (typeof state === "string" && Object.hasOwn(counts, state)) {
      counts[/** @type {keyof typeof counts} */ (state)] += 1;
    }
  }
  return counts;
}

/** @param {unknown} value @param {string} label */
function localPath(value, label) {
  if (
    typeof value !== "string" ||
    value.trim() !== value ||
    value.length === 0 ||
    value.includes("\0") ||
    /^[A-Za-z][A-Za-z\d+.-]*:/u.test(value)
  ) {
    throw new TypeError(`${label} must be a local filesystem path`);
  }
  return resolve(value);
}

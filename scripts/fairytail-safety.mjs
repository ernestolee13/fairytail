#!/usr/bin/env node

import { resolve } from "node:path";
import { stdout } from "node:process";

import { readJsonDocument } from "../src/content/load.mjs";
import {
  acknowledgeG006Boundary,
  assessG006Action,
  assessG006HookEvent,
} from "../src/runtime/g006.mjs";

const GENERIC_ERROR = Object.freeze({
  status: "error",
  code: "g006-safety-operation-failed",
});

try {
  const options = parseArguments(process.argv.slice(2));
  const input = await readJsonDocument(options.input);
  const output =
    options.command === "assess"
      ? assessG006Action(input)
      : options.command === "hook"
        ? assessG006HookEvent(input)
        : acknowledgeG006Boundary({
            action: input,
            retype: options.retype,
          });
  stdout.write(`${JSON.stringify(output)}\n`);
} catch {
  stdout.write(`${JSON.stringify(GENERIC_ERROR)}\n`);
  process.exitCode = 1;
}

/** @param {string[]} args */
function parseArguments(args) {
  const command = args[0];
  if (!new Set(["assess", "hook", "acknowledge"]).has(command)) {
    throw new TypeError("unsupported G006 safety command");
  }
  const allowed =
    command === "acknowledge"
      ? new Set(["--input", "--retype"])
      : new Set(["--input"]);
  /** @type {Record<string, string>} */
  const values = {};
  for (let index = 1; index < args.length; index += 2) {
    const option = args[index];
    const value = args[index + 1];
    if (
      !allowed.has(option) ||
      !value ||
      option in values ||
      (value.startsWith("--") && option !== "--retype")
    ) {
      throw new TypeError("G006 safety option is invalid or duplicated");
    }
    values[option] = value;
  }
  if (!values["--input"] || Object.keys(values).length !== allowed.size) {
    throw new TypeError("G006 safety command options are incomplete");
  }
  return {
    command,
    input: localPath(values["--input"]),
    retype: values["--retype"],
  };
}

/** @param {unknown} value */
function localPath(value) {
  if (
    typeof value !== "string" ||
    value.trim() !== value ||
    value.length === 0 ||
    value.includes("\0") ||
    /^[A-Za-z][A-Za-z\d+.-]*:/u.test(value)
  ) {
    throw new TypeError("G006 input must be a local filesystem path");
  }
  return resolve(value);
}

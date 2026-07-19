#!/usr/bin/env node

import { stdin, stdout } from "node:process";
import { handleHook } from "../src/hook.mjs";
import {
  failClosedAssessment,
  preToolUseResponse,
} from "../src/safety/pretool.mjs";

const dataDir = readOption(process.argv.slice(2), "--data-dir");
const expectedEvent = readOption(process.argv.slice(2), "--expected-event");

try {
  const body = await readStdin();
  const input = JSON.parse(body);
  if (
    expectedEvent &&
    (typeof input !== "object" ||
      input === null ||
      input.hook_event_name !== expectedEvent)
  ) {
    throw new TypeError("hook event does not match configured boundary");
  }
  const result = await handleHook(input, {
    dataDir: dataDir || process.env.CLAUDE_PLUGIN_DATA,
  });
  stdout.write(`${JSON.stringify(result.response)}\n`);
} catch {
  const response =
    expectedEvent === "PreToolUse"
      ? {
          ...preToolUseResponse(failClosedAssessment()),
          systemMessage:
            "Fairytail safety input was invalid. The exposed action was denied without storing its payload.",
        }
      : {
          continue: true,
          systemMessage:
            "Fairytail compatibility hook received invalid input and skipped the event without storing it.",
        };
  stdout.write(`${JSON.stringify(response)}\n`);
}

/** @returns {Promise<string>} */
async function readStdin() {
  const chunks = [];
  for await (const chunk of stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

/**
 * @param {string[]} args
 * @param {string} name
 */
function readOption(args, name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

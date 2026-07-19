#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { stdout } from "node:process";
import { fileURLToPath } from "node:url";

import { loadAnalogyRuntime, resolveAnalogy } from "../src/analogy/engine.mjs";
import { createPersonalizationRequest } from "../src/analogy/personalized.mjs";
import { renderScenario } from "../src/analogy/render.mjs";
import { parseJsonDocument } from "../src/content/load.mjs";
import { resolveFairytailDataDir } from "../src/profile/data-dir.mjs";
import { loadProfile } from "../src/profile/store.mjs";

const pluginRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const GENERIC_ERROR = Object.freeze({
  status: "error",
  code: "personalization-failed-safely",
});

try {
  const options = parseArguments(process.argv.slice(2));
  const loaded = await loadProfile(options.dataDir);
  if (loaded.source !== "stored") throw new Error("Profile unavailable");
  const runtime = await loadAnalogyRuntime(pluginRoot);
  const prepared = createPersonalizationRequest(
    runtime,
    loaded.profile,
    options.scenarioId,
  );
  if (prepared.status !== "ready") {
    stdout.write(
      `${JSON.stringify({ status: "fallback", reason: prepared.reason })}\n`,
    );
  } else if (options.command === "prepare") {
    stdout.write(
      `${JSON.stringify({ status: "ready", request: prepared.request })}\n`,
    );
  } else {
    const candidate = options.candidatePath
      ? parseJsonDocument(
          await readFile(options.candidatePath),
          "Fairytail personalized analogy candidate",
        )
      : undefined;
    const resolution = await resolveAnalogy(runtime, {
      profile: loaded.profile,
      scenarioId: options.scenarioId,
      dataDir: options.dataDir,
      personalizedCandidate: candidate,
    });
    const rendered = renderScenario(runtime, options.scenarioId, resolution);
    stdout.write(
      `${JSON.stringify({
        status: resolution.kind === "mapped" ? "ready" : "fallback",
        reason: resolution.reason,
        mapping_id: resolution.kind === "mapped" ? resolution.mapping_id : null,
        render: rendered,
      })}\n`,
    );
  }
} catch {
  stdout.write(`${JSON.stringify(GENERIC_ERROR)}\n`);
  process.exitCode = 1;
}

/** @param {string[]} args */
function parseArguments(args) {
  const command = args[0];
  if (command !== "prepare" && command !== "accept" && command !== "render") {
    throw new TypeError("Unsupported Fairytail personalization command");
  }
  /** @type {{ scenarioId?: string, dataDir?: string, candidatePath?: string, host?: "claude" | "codex" }} */
  const parsed = {};
  for (let index = 1; index < args.length; index += 2) {
    const option = args[index];
    const value = args[index + 1];
    if (!value || value.startsWith("--")) {
      throw new TypeError("Personalization option value is missing");
    }
    if (option === "--scenario" && parsed.scenarioId === undefined) {
      parsed.scenarioId = value;
    } else if (option === "--data-dir" && parsed.dataDir === undefined) {
      parsed.dataDir = value;
    } else if (option === "--candidate" && parsed.candidatePath === undefined) {
      parsed.candidatePath = resolve(value);
    } else if (
      option === "--host" &&
      parsed.host === undefined &&
      (value === "claude" || value === "codex")
    ) {
      parsed.host = value;
    } else {
      throw new TypeError("Unknown or duplicate personalization option");
    }
  }
  if (!parsed.scenarioId || !/^S[0-9]{2}$/u.test(parsed.scenarioId)) {
    throw new TypeError("A valid scenario is required");
  }
  const dataDir = resolveFairytailDataDir({
    dataDir: parsed.dataDir,
    host: parsed.host,
  });
  if (!dataDir) throw new TypeError("A data directory is required");
  if (command === "accept" && !parsed.candidatePath) {
    throw new TypeError("accept requires a candidate file");
  }
  if (command !== "accept" && parsed.candidatePath) {
    throw new TypeError("Only accept may read a candidate file");
  }
  return {
    command,
    scenarioId: parsed.scenarioId,
    dataDir,
    candidatePath: parsed.candidatePath,
  };
}

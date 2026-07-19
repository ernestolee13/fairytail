#!/usr/bin/env node

import { createHash } from "node:crypto";
import { mkdir, readFile, realpath, stat, writeFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { argv, stderr, stdout } from "node:process";
import { fileURLToPath } from "node:url";

const DROP_KEYS = new Set([
  "id",
  "memory_paths",
  "parent_tool_use_id",
  "request_id",
  "session_id",
  "signature",
  "timestamp",
  "tool_use_id",
  "uuid",
]);

const DROP_INIT_KEYS = new Set(["apiKeySource", "skills", "slash_commands"]);

/**
 * Create a privacy-redacted, verifier-compatible publication bundle from a
 * live G010 artifact directory. The destination must not already exist.
 * Original model usage, structured output, diffs, and summary statistics stay
 * intact; host/account identifiers and hidden reasoning do not.
 *
 * @param {string} sourceDirectory
 * @param {string} destinationDirectory
 */
export async function publishMeasuredArtifacts(
  sourceDirectory,
  destinationDirectory,
) {
  const source = resolve(sourceDirectory);
  const destination = resolve(destinationDirectory);
  await assertDirectory(source);
  await assertAbsent(destination);

  const sourceRealPath = await realpath(source);
  const sourceSuitePath = resolve(source, "suite.json");
  const sourceSuiteBytes = await readFile(sourceSuitePath);
  const suite = JSON.parse(sourceSuiteBytes.toString("utf8"));
  if (
    suite?.kind !== "live-headline-suite" ||
    suite?.synthetic !== false ||
    !Array.isArray(suite?.runs) ||
    !Array.isArray(suite?.cache_diagnostic?.variants)
  ) {
    throw new TypeError("Source must be a complete live G010 suite");
  }

  await mkdir(destination, { recursive: false });
  const records = [...suite.runs, ...suite.cache_diagnostic.variants];
  for (const record of records) {
    const artifactRoot = record?.artifacts?.root;
    if (typeof artifactRoot !== "string" || artifactRoot.length === 0) {
      throw new TypeError("Every measured record needs an artifact root");
    }
    const sourceRun = resolve(source, artifactRoot);
    const destinationRun = resolve(destination, artifactRoot);
    if (
      !isContained(source, sourceRun) ||
      !isContained(destination, destinationRun)
    ) {
      throw new Error("Measured artifact root escapes its suite directory");
    }
    await mkdir(destinationRun, { recursive: false });

    const rawPath = resolve(sourceRun, record.artifacts.raw_events);
    const stderrPath = resolve(sourceRun, record.artifacts.stderr);
    const diffPath = resolve(sourceRun, record.artifacts.diff);
    const rawText = await readFile(rawPath, "utf8");
    const stderrText = await readFile(stderrPath, "utf8");
    const diffBytes = await readFile(diffPath);

    const redactedRaw = redactJsonLines(rawText, [source, sourceRealPath]);
    const redactedStderr = redactString(stderrText, [source, sourceRealPath]);
    await Promise.all([
      writeFile(
        resolve(destinationRun, record.artifacts.raw_events),
        redactedRaw,
      ),
      writeFile(
        resolve(destinationRun, record.artifacts.stderr),
        redactedStderr,
      ),
      writeFile(resolve(destinationRun, record.artifacts.diff), diffBytes),
    ]);

    record.artifacts.raw_events_sha256 = sha256(redactedRaw);
    record.artifacts.stderr_sha256 = sha256(redactedStderr);
    record.artifacts.diff_sha256 = sha256(diffBytes);
    record.limitations = uniqueStrings([
      ...(Array.isArray(record.limitations) ? record.limitations : []),
      "Published stream events are privacy-redacted; the original bytes passed the publication verifier before redaction.",
    ]);
  }

  suite.publication_redaction = {
    applied: true,
    source_suite_sha256: sha256(sourceSuiteBytes),
    method: basename(fileURLToPath(import.meta.url)),
    removed: [
      "host home and temporary absolute paths",
      "session, message, request, tool-use, and event identifiers",
      "account rate-limit events",
      "hidden reasoning blocks and signatures",
      "host-global skill and slash-command inventory",
    ],
    retained: [
      "model and plugin evidence",
      "structured outputs",
      "token, cache, cost, and latency telemetry",
      "tool names and privacy-redacted fixture operations",
      "exact source diffs",
    ],
  };
  const publishedSuite = `${JSON.stringify(suite, null, 2)}\n`;
  await writeFile(resolve(destination, "suite.json"), publishedSuite);
  return {
    source_suite_sha256: suite.publication_redaction.source_suite_sha256,
    published_suite_sha256: sha256(publishedSuite),
    records: records.length,
    destination,
  };
}

/** @param {string} input @param {string[]} roots */
export function redactJsonLines(input, roots) {
  const output = [];
  for (const [index, line] of input.split(/\r?\n/u).entries()) {
    if (line.trim().length === 0) continue;
    let event;
    try {
      event = JSON.parse(line);
    } catch (error) {
      throw new SyntaxError(
        `Cannot publish malformed JSONL line ${index + 1}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    const redacted = redactEvent(event, roots);
    if (redacted !== null) output.push(JSON.stringify(redacted));
  }
  return output.length === 0 ? "" : `${output.join("\n")}\n`;
}

/** @param {unknown} event @param {string[]} roots */
export function redactEvent(event, roots = []) {
  if (!isRecord(event)) return redactValue(event, roots);
  if (event.type === "rate_limit_event") return null;
  if (event.type === "system" && event.subtype === "thinking_tokens") {
    return null;
  }
  const redacted = redactValue(event, roots);
  if (!isRecord(redacted)) return redacted;
  if (redacted.type === "system" && redacted.subtype === "init") {
    for (const key of DROP_INIT_KEYS) delete redacted[key];
  }
  if (
    redacted.type === "assistant" &&
    isRecord(redacted.message) &&
    Array.isArray(redacted.message.content)
  ) {
    redacted.message.content = redacted.message.content.filter(
      (/** @type {unknown} */ item) =>
        !isRecord(item) || item.type !== "thinking",
    );
    if (redacted.message.content.length === 0) return null;
  }
  return redacted;
}

/** @param {unknown} value @param {string[]} roots @returns {any} */
function redactValue(value, roots) {
  if (typeof value === "string") return redactString(value, roots);
  if (Array.isArray(value))
    return value.map((item) => redactValue(item, roots));
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !DROP_KEYS.has(key))
      .map(([key, item]) => [key, redactValue(item, roots)]),
  );
}

/** @param {string} value @param {string[]} roots */
function redactString(value, roots) {
  let result = value;
  for (const root of [...new Set(roots)].sort((a, b) => b.length - a.length)) {
    if (root.length > 0) result = result.split(root).join("<artifact-root>");
  }
  return result
    .replace(/\/Users\/[^/\s"']+(?:\/[^"'\r\n]*)?/gu, "<host-home>")
    .replace(/\/home\/[^/\s"']+(?:\/[^"'\r\n]*)?/gu, "<host-home>")
    .replace(/[A-Za-z]:\\Users\\[^\\\s"']+(?:\\[^"'\r\n]*)?/gu, "<host-home>")
    .replace(/<host-home>(?:\/[^"'\r\n]*)?/gu, "<host-home>")
    .replace(/\b(?:msg|req|toolu)_[A-Za-z0-9_-]+\b/gu, "<opaque-id>")
    .replace(
      /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/giu,
      "<uuid>",
    )
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/giu, "<email>")
    .replace(/\bsk-[A-Za-z0-9_-]{12,}\b/gu, "<secret>");
}

/** @param {string|Buffer} value */
function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

/** @param {string} parent @param {string} child */
function isContained(parent, child) {
  return child.startsWith(`${parent}/`) && child !== parent;
}

/**
 * @param {unknown} value
 * @returns {value is Record<string, any>}
 */
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** @param {string[]} values */
function uniqueStrings(values) {
  return [...new Set(values.filter((value) => typeof value === "string"))];
}

/** @param {string} path */
async function assertDirectory(path) {
  const information = await stat(path);
  if (!information.isDirectory())
    throw new TypeError(`${path} is not a directory`);
}

/** @param {string} path */
async function assertAbsent(path) {
  try {
    await stat(path);
  } catch (error) {
    if (isRecord(error) && error.code === "ENOENT") return;
    throw error;
  }
  throw new Error(`Destination already exists: ${path}`);
}

const scriptPath = fileURLToPath(import.meta.url);
if (argv[1] && resolve(argv[1]) === resolve(scriptPath)) {
  try {
    const sourceIndex = argv.indexOf("--source");
    const destinationIndex = argv.indexOf("--destination");
    const source = sourceIndex >= 0 ? argv[sourceIndex + 1] : undefined;
    const destination =
      destinationIndex >= 0 ? argv[destinationIndex + 1] : undefined;
    if (!source || !destination) {
      throw new TypeError(
        "Usage: publish-g010-measured --source DIR --destination DIR",
      );
    }
    const result = await publishMeasuredArtifacts(source, destination);
    stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    stderr.write(
      `G010 measured publication failed: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  }
}

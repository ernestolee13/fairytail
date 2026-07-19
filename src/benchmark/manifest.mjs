import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import {
  CLAUDE_CLI_VERSION,
  DIAGNOSTIC_VARIANTS,
  HEADLINE_ARMS,
  PARENT_EFFORT,
  PARENT_MODEL_ID,
  PONYTAIL_COMMIT,
  PONYTAIL_SKILL_SHA256,
  RENDERER_MODEL_ID,
  isRecord,
} from "./contracts.mjs";

/** @param {string} manifestPath */
export async function loadAndVerifyManifest(manifestPath) {
  const bytes = await readFile(manifestPath);
  const manifest = JSON.parse(bytes.toString("utf8"));
  if (!isRecord(manifest))
    throw new TypeError("Benchmark manifest must be an object");
  if (manifest.benchmark_id !== "g010" || manifest.manifest_version !== 1) {
    throw new TypeError("Unsupported G010 manifest identity/version");
  }
  if (manifest.ponytail_commit !== PONYTAIL_COMMIT) {
    throw new Error("Ponytail commit does not match the benchmark contract");
  }
  if (manifest.claude_cli_version !== CLAUDE_CLI_VERSION) {
    throw new Error(
      "Claude CLI version pin does not match the benchmark contract",
    );
  }
  if (
    !isRecord(manifest.model_pins) ||
    manifest.model_pins.parent !== PARENT_MODEL_ID ||
    manifest.model_pins.renderer !== RENDERER_MODEL_ID
  ) {
    throw new Error("Claude parent/renderer model pins drifted");
  }
  if (
    !isRecord(manifest.effort_pins) ||
    manifest.effort_pins.parent !== PARENT_EFFORT
  ) {
    throw new Error("Claude parent effort pin drifted");
  }
  if (
    !isRecord(manifest.ponytail_source_pins) ||
    manifest.ponytail_source_pins["skills/ponytail/SKILL.md"] !==
      PONYTAIL_SKILL_SHA256
  ) {
    throw new Error("Ponytail decision-surface pin drifted");
  }
  if (
    JSON.stringify(manifest.headline_arms) !== JSON.stringify(HEADLINE_ARMS)
  ) {
    throw new Error("Headline arms drifted from the three-arm contract");
  }
  if (
    JSON.stringify(manifest.diagnostic_variants) !==
    JSON.stringify(DIAGNOSTIC_VARIANTS)
  ) {
    throw new Error("Diagnostic variants drifted from the routing contract");
  }

  const root = resolve(dirname(manifestPath), "..", "..");
  const pins = manifest.file_pins;
  if (!isRecord(pins) || Object.keys(pins).length === 0) {
    throw new TypeError("Manifest file_pins must be a non-empty object");
  }
  /** @type {Record<string, string>} */
  const verifiedPins = {};
  for (const [relativePath, expectedHash] of Object.entries(pins)) {
    if (
      typeof expectedHash !== "string" ||
      !/^[a-f0-9]{64}$/u.test(expectedHash)
    ) {
      throw new TypeError(`Invalid SHA-256 pin for ${relativePath}`);
    }
    const actual = await sha256File(resolve(root, relativePath));
    if (actual !== expectedHash) {
      throw new Error(
        `Pinned file hash mismatch for ${relativePath}: expected ${expectedHash}, got ${actual}`,
      );
    }
    verifiedPins[relativePath] = actual;
  }

  return {
    manifest,
    root,
    pins: {
      manifest_sha256: createHash("sha256").update(bytes).digest("hex"),
      file_set_sha256: hashPinSet(verifiedPins),
      verified_file_count: Object.keys(verifiedPins).length,
    },
  };
}

/** @param {string} path */
export async function sha256File(path) {
  return createHash("sha256")
    .update(await readFile(path))
    .digest("hex");
}

/** @param {Record<string, string>} pins */
function hashPinSet(pins) {
  const canonical = Object.entries(pins)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([path, hash]) => `${path}\0${hash}\n`)
    .join("");
  return createHash("sha256").update(canonical).digest("hex");
}

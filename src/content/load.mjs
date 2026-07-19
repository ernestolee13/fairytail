import { readFile } from "node:fs/promises";
import { join } from "node:path";

export const MAX_JSON_BYTES = 2 * 1024 * 1024;
export const MAX_JSON_DEPTH = 64;

const DANGEROUS_KEYS = new Set(["__proto__", "constructor", "prototype"]);

export class ContentLoadError extends Error {
  /**
   * @param {string} code
   * @param {string} message
   * @param {{ cause?: unknown }} [options]
   */
  constructor(code, message, options = {}) {
    super(message, options);
    this.name = "ContentLoadError";
    this.code = code;
  }
}

/**
 * Parse JSON strictly as inert data. It never imports, evaluates, interpolates,
 * or executes any string found in the document.
 *
 * @param {string | Buffer} input
 * @param {string} [label]
 */
export function parseJsonDocument(input, label = "JSON document") {
  const bytes = Buffer.isBuffer(input) ? input : Buffer.from(input, "utf8");
  if (bytes.byteLength > MAX_JSON_BYTES) {
    throw new ContentLoadError(
      "document-too-large",
      `${label} exceeds ${MAX_JSON_BYTES} bytes`,
    );
  }

  /** @type {unknown} */
  let value;
  try {
    value = JSON.parse(bytes.toString("utf8"));
  } catch (cause) {
    throw new ContentLoadError("invalid-json", `${label} is not valid JSON`, {
      cause,
    });
  }

  inspectData(value, "$", 0);
  return value;
}

/**
 * @param {string} path
 */
export async function readJsonDocument(path) {
  let bytes;
  try {
    bytes = await readFile(path);
  } catch (cause) {
    throw new ContentLoadError("read-failed", `Unable to read ${path}`, {
      cause,
    });
  }
  return parseJsonDocument(bytes, path);
}

/**
 * @param {string} root
 */
export async function loadG002Bundle(root) {
  const schemaNames = [
    "concept-card.schema.json",
    "confusion-pair.schema.json",
    "profile.schema.json",
    "analogy-mapping.schema.json",
    "learning-evidence.schema.json",
    "scenario.schema.json",
    "golden-case.schema.json",
    "manifest.schema.json",
  ];

  const [
    manifest,
    concepts,
    confusionPairs,
    profiles,
    scenarios,
    mappings,
    cases,
    learning,
    ...schemas
  ] = await Promise.all([
    readJsonDocument(join(root, "content", "v1", "manifest.json")),
    readJsonDocument(join(root, "content", "v1", "concepts.json")),
    readJsonDocument(join(root, "content", "v1", "confusion-pairs.json")),
    readJsonDocument(join(root, "fixtures", "golden", "v1", "profiles.json")),
    readJsonDocument(join(root, "fixtures", "golden", "v1", "scenarios.json")),
    readJsonDocument(
      join(root, "fixtures", "golden", "v1", "analogy-mappings.json"),
    ),
    readJsonDocument(join(root, "fixtures", "golden", "v1", "cases.json")),
    readJsonDocument(
      join(root, "fixtures", "learning", "v1", "api-state-transition.json"),
    ),
    ...schemaNames.map((name) =>
      readJsonDocument(join(root, "schemas", "v1", name)),
    ),
  ]);

  return {
    manifest,
    concepts,
    confusionPairs,
    profiles,
    scenarios,
    mappings,
    cases,
    learning,
    schemas: Object.fromEntries(
      schemaNames.map((name, index) => [name, schemas[index]]),
    ),
  };
}

/**
 * @param {unknown} value
 * @param {string} path
 * @param {number} depth
 */
function inspectData(value, path, depth) {
  if (depth > MAX_JSON_DEPTH) {
    throw new ContentLoadError(
      "document-too-deep",
      `${path} exceeds maximum JSON depth ${MAX_JSON_DEPTH}`,
    );
  }

  if (typeof value === "string") {
    if (value !== value.normalize("NFC")) {
      throw new ContentLoadError(
        "non-nfc-string",
        `${path} must use NFC-normalized Unicode`,
      );
    }
    return;
  }

  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) {
      inspectData(item, `${path}[${index}]`, depth + 1);
    }
    return;
  }

  if (typeof value === "object" && value !== null) {
    for (const [key, item] of Object.entries(value)) {
      if (DANGEROUS_KEYS.has(key)) {
        throw new ContentLoadError(
          "dangerous-key",
          `${path}.${key} is not allowed`,
        );
      }
      if (key !== key.normalize("NFC")) {
        throw new ContentLoadError(
          "non-nfc-string",
          `${path} contains a non-NFC key`,
        );
      }
      inspectData(item, `${path}.${key}`, depth + 1);
    }
  }
}

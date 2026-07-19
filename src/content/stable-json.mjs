import { createHash } from "node:crypto";

const CANONICAL_FACT_FIELDS = [
  "schema_version",
  "card_version",
  "family_id",
  "id",
  "scope",
  "spec_revision",
  "canonical_definition",
  "mechanism",
  "misconceptions",
  "confused_with",
  "analogy_roles",
  "analogy_breakpoint",
  "safety_boundary",
  "sources",
  "verified_at",
];

/**
 * Deterministic JSON for the G002 hash contract: object keys are sorted,
 * array order is preserved, strings must already be NFC, and no whitespace is
 * emitted. This is deliberately smaller than a general RFC 8785 library.
 *
 * @param {unknown} value
 * @returns {string}
 */
export function stableStringify(value) {
  return encode(value, "$", new Set());
}

/**
 * @param {Record<string, unknown>} card
 */
export function canonicalFactBlock(card) {
  /** @type {Record<string, unknown>} */
  const block = {};

  for (const field of CANONICAL_FACT_FIELDS) {
    if (!Object.hasOwn(card, field)) {
      throw new TypeError(`Missing canonical fact field: ${field}`);
    }
    block[field] = card[field];
  }

  return block;
}

/**
 * @param {Record<string, unknown>} card
 */
export function canonicalFactBytes(card) {
  return Buffer.from(stableStringify(canonicalFactBlock(card)), "utf8");
}

/**
 * @param {Record<string, unknown>} card
 */
export function canonicalFactHash(card) {
  return sha256(canonicalFactBytes(card));
}

/**
 * @param {Record<string, unknown>[]} cards
 * @param {string} contentVersion
 */
export function canonicalFactSetBytes(cards, contentVersion) {
  return Buffer.from(
    stableStringify({
      content_version: contentVersion,
      facts: cards.map((card) => canonicalFactBlock(card)),
    }),
    "utf8",
  );
}

/**
 * @param {Record<string, unknown>[]} cards
 * @param {string} contentVersion
 */
export function canonicalFactSetHash(cards, contentVersion) {
  return sha256(canonicalFactSetBytes(cards, contentVersion));
}

/**
 * @param {string | Uint8Array} value
 */
export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

/**
 * @param {unknown} value
 * @param {string} path
 * @param {Set<object>} ancestors
 * @returns {string}
 */
function encode(value, path, ancestors) {
  if (value === null) {
    return "null";
  }

  if (typeof value === "string") {
    if (value !== value.normalize("NFC")) {
      throw new TypeError(`Non-NFC string at ${path}`);
    }
    return JSON.stringify(value);
  }

  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError(`Non-finite number at ${path}`);
    }
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    guardCycle(value, path, ancestors);
    const result = `[${value
      .map((item, index) => encode(item, `${path}[${index}]`, ancestors))
      .join(",")}]`;
    ancestors.delete(value);
    return result;
  }

  if (isRecord(value)) {
    guardCycle(value, path, ancestors);
    const entries = Object.keys(value)
      .sort()
      .map(
        (key) =>
          `${JSON.stringify(key)}:${encode(value[key], `${path}.${key}`, ancestors)}`,
      );
    ancestors.delete(value);
    return `{${entries.join(",")}}`;
  }

  throw new TypeError(`Unsupported JSON value at ${path}: ${typeof value}`);
}

/**
 * @param {object} value
 * @param {string} path
 * @param {Set<object>} ancestors
 */
function guardCycle(value, path, ancestors) {
  if (ancestors.has(value)) {
    throw new TypeError(`Cyclic value at ${path}`);
  }
  ancestors.add(value);
}

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

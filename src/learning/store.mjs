import { mkdir, open } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import {
  rethrowAfterCleanup,
  unlinkIfPresent,
} from "../filesystem-cleanup.mjs";
import {
  appendPrivateStoreFile,
  deletePrivateStoreFile,
  readPrivateStoreFile,
} from "../private-store.mjs";

import { parseJsonDocument } from "../content/load.mjs";
import { stableStringify } from "../content/stable-json.mjs";
import {
  createLearningEvidence,
  reduceLearningEvidence,
  retrievalIsDue,
  validateLearningEvent,
} from "./evidence.mjs";

export const LEARNING_EVENTS_FILE = "learning-events.jsonl";
export const MAX_LEARNING_STORE_BYTES = 1024 * 1024;
export const MAX_LEARNING_EVENT_BYTES = 2048;

const STORED_EVENT_KEYS = ["event_version", "concept_id", "event"];
const CONCEPT_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;

/**
 * Invalid or oversized local state fails to an empty store. Nothing from a
 * corrupt line is returned to the model or copied into another file.
 *
 * @param {string | undefined} dataDir
 */
export async function loadLearningEvidenceStore(dataDir) {
  if (!dataDir) return emptyStore("data-dir-unavailable");
  try {
    const body = (
      await readPrivateStoreFile(
        dataDir,
        LEARNING_EVENTS_FILE,
        MAX_LEARNING_STORE_BYTES,
        "Fairytail learning store",
      )
    ).toString("utf8");
    /** @type {Map<string, Record<string, any>>} */
    const evidenceByConcept = new Map();
    for (const [index, line] of body.split("\n").entries()) {
      if (line.length === 0) continue;
      if (Buffer.byteLength(line, "utf8") > MAX_LEARNING_EVENT_BYTES) {
        return emptyStore("invalid-store");
      }
      const stored = validateStoredEvent(
        parseJsonDocument(line, `Fairytail learning event ${index + 1}`),
      );
      const current =
        evidenceByConcept.get(stored.concept_id) ??
        createLearningEvidence(stored.concept_id);
      evidenceByConcept.set(
        stored.concept_id,
        reduceLearningEvidence(current, stored.event),
      );
    }
    return deepFreeze({
      source: "stored",
      reason: "ok",
      records: [...evidenceByConcept.values()].sort((left, right) =>
        left.concept_id.localeCompare(right.concept_id),
      ),
    });
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return emptyStore("not-found");
    }
    return emptyStore("invalid-store");
  }
}

/**
 * Append only the closed event fields. Raw teach-back, tool input/output,
 * prompts, paths, code, and error text have no representable field here.
 *
 * @param {string} dataDir
 * @param {unknown} value
 */
export async function appendLearningEvent(dataDir, value) {
  const input = plainRecord(value, "learning event append input");
  exactKeys(input, ["concept_id", "event"], "learning event append input");
  conceptIdentifier(input.concept_id, "learning event append concept_id");
  const event = validateLearningEvent(input.event);
  const loaded = await loadLearningEvidenceStore(dataDir);
  if (loaded.reason === "invalid-store") {
    throw new TypeError(
      "Fairytail learning store is invalid and was not modified",
    );
  }
  const current =
    loaded.records.find((record) => record.concept_id === input.concept_id) ??
    createLearningEvidence(input.concept_id);
  const next = reduceLearningEvidence(current, event);
  const stored = {
    event_version: 1,
    concept_id: input.concept_id,
    event,
  };
  const line = `${stableStringify(stored)}\n`;
  if (Buffer.byteLength(line, "utf8") > MAX_LEARNING_EVENT_BYTES) {
    throw new TypeError(
      "Fairytail learning event exceeds the local size limit",
    );
  }

  await appendPrivateStoreFile(
    dataDir,
    LEARNING_EVENTS_FILE,
    line,
    MAX_LEARNING_STORE_BYTES,
    "Fairytail learning store",
  );
  return deepFreeze({ ok: true, record: next });
}

/** @param {string | undefined} dataDir @param {Date} [now] */
export async function dueLearningEvidence(dataDir, now = new Date()) {
  const loaded = await loadLearningEvidenceStore(dataDir);
  return deepFreeze(
    loaded.records.filter((record) => retrievalIsDue(record, now)),
  );
}

/** @param {string} dataDir */
export async function deleteLearningEvents(dataDir) {
  try {
    const deleted = await deletePrivateStoreFile(
      dataDir,
      LEARNING_EVENTS_FILE,
      "Fairytail learning store",
    );
    return { ok: true, deleted };
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return { ok: true, deleted: false };
    }
    throw error;
  }
}

/** @param {string} dataDir @param {string} destination */
export async function exportLearningEvidence(dataDir, destination) {
  const loaded = await loadLearningEvidenceStore(dataDir);
  if (loaded.reason === "invalid-store") {
    throw new TypeError(
      "Fairytail learning store is invalid and was not exported",
    );
  }
  const path = resolve(destination);
  if (path === learningEventsPath(dataDir)) {
    throw new TypeError(
      "export destination must differ from the learning store",
    );
  }
  await mkdir(dirname(path), { recursive: true });
  const handle = await open(path, "wx", 0o600);
  try {
    await handle.writeFile(
      `${JSON.stringify(
        {
          export_version: 1,
          source: loaded.source,
          records: loaded.records,
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
    await handle.chmod(0o600);
    await handle.sync();
  } catch (error) {
    await rethrowAfterCleanup(
      error,
      [() => handle.close(), () => unlinkIfPresent(path)],
      "Fairytail learning export failed and cleanup was incomplete",
    );
  }
  await handle.close();
  return { ok: true, exported: true };
}

/** @param {string} dataDir */
export function learningEventsPath(dataDir) {
  if (typeof dataDir !== "string" || dataDir.trim().length === 0) {
    throw new TypeError("Fairytail data directory is required");
  }
  return resolve(dataDir, LEARNING_EVENTS_FILE);
}

/** @param {unknown} value */
function validateStoredEvent(value) {
  const stored = structuredClone(plainRecord(value, "stored learning event"));
  exactKeys(stored, STORED_EVENT_KEYS, "stored learning event");
  if (stored.event_version !== 1) {
    throw new TypeError("stored learning event version is invalid");
  }
  conceptIdentifier(stored.concept_id, "stored learning event concept_id");
  stored.event = validateLearningEvent(stored.event);
  return deepFreeze(stored);
}

/** @param {"data-dir-unavailable" | "not-found" | "invalid-store"} reason */
function emptyStore(reason) {
  return deepFreeze({ source: "default", reason, records: [] });
}

/** @param {unknown} value @param {string} label */
function conceptIdentifier(value, label) {
  if (typeof value !== "string" || !CONCEPT_PATTERN.test(value)) {
    throw new TypeError(`${label} must be a concept identifier`);
  }
}

/** @param {unknown} value @param {string} label */
function plainRecord(value, label) {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    throw new TypeError(`${label} must be a plain object`);
  }
  return /** @type {Record<string, any>} */ (value);
}

/** @param {Record<string, any>} value @param {ReadonlyArray<string>} keys @param {string} label */
function exactKeys(value, keys, label) {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])
  ) {
    throw new TypeError(
      `${label} must contain exactly: ${expected.join(", ")}`,
    );
  }
}

/** @param {unknown} error */
function isNodeError(error) {
  return error instanceof Error && "code" in error;
}

/** @template T @param {T} value @returns {Readonly<T>} */
function deepFreeze(value) {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) {
    return value;
  }
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

import {
  MAX_FAMILIAR_LABEL_LENGTH,
  MAX_FAMILIAR_LABELS,
  sanitizeFamiliarLabel,
} from "./sanitize.mjs";

export const PROFILE_FILE = "profile.json";
export const PROFILE_VERSION = 2;
export const PROFILE_ID = "P1";
export const PROFILE_FIELDS = [
  "profile_version",
  "profile_id",
  "language",
  "familiar_worlds",
  "observed_experience",
  "presentation_preference",
  "safety_concerns",
  "no_analogy",
  "model_processing",
  "pii_redaction_enabled",
  "updated_at",
];
export const PROJECTION_FIELDS = [
  "language",
  "presentation_preference",
  "familiar_worlds",
];
export const PRESENTATION_PREFERENCES = [
  "analogy_first",
  "try_first",
  "checklist",
  "neutral",
];
export const PERSONALIZED_PROCESSING_MODES = [
  "personalized_model",
  "personalized_claude",
];

export class ProfileValidationError extends Error {
  /**
   * @param {string} code
   * @param {string} path
   */
  constructor(code, path) {
    super(`Invalid Fairytail profile at ${path}`);
    this.name = "ProfileValidationError";
    this.code = code;
    this.path = path;
  }
}

/**
 * @typedef {{ id: string, label: string }} FamiliarWorld
 * @typedef {{
 *   mode: "neutral_local" | "personalized_model",
 *   approved_fields: string[],
 *   approved_at: string | null,
 *   approved_projection_digest: string | null
 * }} ModelProcessing
 * @typedef {{
 *   profile_version: 2,
 *   profile_id: string,
 *   language: "ko" | "en",
 *   familiar_worlds: FamiliarWorld[],
 *   observed_experience: string[],
 *   presentation_preference: "analogy_first" | "try_first" | "checklist" | "neutral",
 *   safety_concerns: string[],
 *   no_analogy: boolean,
 *   model_processing: ModelProcessing,
 *   pii_redaction_enabled: true,
 *   updated_at: string
 * }} LearnerProfile
 */

/**
 * @param {Date} [now]
 * @returns {LearnerProfile}
 */
export function defaultProfile(now = new Date()) {
  return {
    profile_version: PROFILE_VERSION,
    profile_id: PROFILE_ID,
    language: "en",
    familiar_worlds: [],
    observed_experience: [],
    presentation_preference: "neutral",
    safety_concerns: [],
    no_analogy: false,
    model_processing: {
      mode: "neutral_local",
      approved_fields: [],
      approved_at: null,
      approved_projection_digest: null,
    },
    pii_redaction_enabled: true,
    updated_at: isoDate(now),
  };
}

/**
 * Validate the local profile with an exact-key contract. Validation never
 * evaluates data and never returns unknown fields.
 *
 * @param {unknown} value
 * @returns {LearnerProfile}
 */
export function validateProfile(value) {
  const profile = record(value, "$profile");
  exactKeys(profile, PROFILE_FIELDS, "$profile");
  equal(profile.profile_version, PROFILE_VERSION, "$profile.profile_version");
  const profileId = text(profile.profile_id, "$profile.profile_id", 16);
  if (!/^P[1-9][0-9]*$/u.test(profileId)) {
    fail("invalid-profile-id", "$profile.profile_id");
  }
  const language = text(profile.language, "$profile.language", 2);
  if (language !== "ko" && language !== "en") {
    fail("unsupported-language", "$profile.language");
  }

  const worldsValue = list(profile.familiar_worlds, "$profile.familiar_worlds");
  if (worldsValue.length > MAX_FAMILIAR_LABELS) {
    fail("too-many-worlds", "$profile.familiar_worlds");
  }
  /** @type {FamiliarWorld[]} */
  const familiarWorlds = [];
  const worldIds = new Set();
  for (const [index, value] of worldsValue.entries()) {
    const path = `$profile.familiar_worlds[${index}]`;
    const world = record(value, path);
    exactKeys(world, ["id", "label"], path);
    const id = text(world.id, `${path}.id`, 64);
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(id) || worldIds.has(id)) {
      fail("invalid-world-id", `${path}.id`);
    }
    worldIds.add(id);
    const labelResult = sanitizeFamiliarLabel(world.label);
    if (!labelResult.ok) {
      fail(`unsafe-world-label:${labelResult.reason}`, `${path}.label`);
    }
    familiarWorlds.push({ id, label: labelResult.value });
  }

  const observedExperience = stringList(
    profile.observed_experience,
    "$profile.observed_experience",
    10,
    80,
  );
  const presentation = text(
    profile.presentation_preference,
    "$profile.presentation_preference",
    24,
  );
  if (!PRESENTATION_PREFERENCES.includes(presentation)) {
    fail("unsupported-presentation", "$profile.presentation_preference");
  }
  const safetyConcerns = stringList(
    profile.safety_concerns,
    "$profile.safety_concerns",
    8,
    80,
  );
  if (typeof profile.no_analogy !== "boolean") {
    fail("invalid-boolean", "$profile.no_analogy");
  }

  const processing = record(
    profile.model_processing,
    "$profile.model_processing",
  );
  exactKeys(
    processing,
    ["mode", "approved_fields", "approved_at", "approved_projection_digest"],
    "$profile.model_processing",
  );
  const mode = text(processing.mode, "$profile.model_processing.mode", 32);
  if (mode !== "neutral_local" && !isPersonalizedProcessingMode(mode)) {
    fail("unsupported-processing-mode", "$profile.model_processing.mode");
  }
  const approvedFields = stringList(
    processing.approved_fields,
    "$profile.model_processing.approved_fields",
    PROJECTION_FIELDS.length,
    32,
  );
  if (approvedFields.some((field) => !PROJECTION_FIELDS.includes(field))) {
    fail("unknown-approved-field", "$profile.model_processing.approved_fields");
  }
  const approvedAt = processing.approved_at;
  const approvedProjectionDigest = processing.approved_projection_digest;
  if (mode === "neutral_local") {
    if (
      approvedFields.length !== 0 ||
      approvedAt !== null ||
      approvedProjectionDigest !== null
    ) {
      fail("neutral-has-consent", "$profile.model_processing");
    }
  } else {
    if (approvedFields.length === 0) {
      fail(
        "personalized-without-fields",
        "$profile.model_processing.approved_fields",
      );
    }
    exactDateTime(approvedAt, "$profile.model_processing.approved_at");
    const digest = text(
      approvedProjectionDigest,
      "$profile.model_processing.approved_projection_digest",
      64,
    );
    if (!/^[a-f0-9]{64}$/u.test(digest)) {
      fail(
        "invalid-projection-digest",
        "$profile.model_processing.approved_projection_digest",
      );
    }
  }
  if (profile.no_analogy && mode !== "neutral_local") {
    fail("no-analogy-must-be-local", "$profile.no_analogy");
  }
  equal(profile.pii_redaction_enabled, true, "$profile.pii_redaction_enabled");
  const updatedAt = exactDate(profile.updated_at, "$profile.updated_at");

  return {
    profile_version: PROFILE_VERSION,
    profile_id: profileId,
    language,
    familiar_worlds: familiarWorlds,
    observed_experience: observedExperience,
    presentation_preference:
      /** @type {LearnerProfile["presentation_preference"]} */ (presentation),
    safety_concerns: safetyConcerns,
    no_analogy: profile.no_analogy,
    model_processing: {
      mode: mode === "neutral_local" ? mode : "personalized_model",
      approved_fields: approvedFields,
      approved_at: /** @type {string | null} */ (approvedAt),
      approved_projection_digest: /** @type {string | null} */ (
        approvedProjectionDigest
      ),
    },
    pii_redaction_enabled: true,
    updated_at: updatedAt,
  };
}

/**
 * Accept the host-neutral mode and the pre-v0.1.4 stored spelling. Validation
 * normalizes the legacy value so existing profiles remain usable.
 *
 * @param {unknown} mode
 */
export function isPersonalizedProcessingMode(mode) {
  return (
    typeof mode === "string" && PERSONALIZED_PROCESSING_MODES.includes(mode)
  );
}

/**
 * Revoke any outbound approval while preserving the local learning profile.
 *
 * @param {LearnerProfile} profile
 * @param {Date} [now]
 * @param {{ noAnalogy?: boolean, presentation?: LearnerProfile["presentation_preference"] }} [options]
 */
export function localOnlyProfile(profile, now = new Date(), options = {}) {
  const validated = validateProfile(profile);
  return validateProfile({
    ...validated,
    presentation_preference:
      options.presentation ?? validated.presentation_preference,
    no_analogy: options.noAnalogy ?? validated.no_analogy,
    model_processing: {
      mode: "neutral_local",
      approved_fields: [],
      approved_at: null,
      approved_projection_digest: null,
    },
    updated_at: isoDate(now),
  });
}

/** @param {Date} value */
export function isoDate(value) {
  return value.toISOString().slice(0, 10);
}

/** @param {unknown} value @param {string} path */
function record(value, path) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    fail("not-an-object", path);
  }
  return /** @type {Record<string, unknown>} */ (value);
}

/** @param {unknown} value @param {string} path */
function list(value, path) {
  if (!Array.isArray(value)) fail("not-an-array", path);
  return value;
}

/**
 * @param {unknown} value
 * @param {string} path
 * @param {number} maximum
 */
function text(value, path, maximum) {
  if (typeof value !== "string" || !value || value.length > maximum) {
    fail("invalid-string", path);
  }
  if (value !== value.normalize("NFC")) fail("non-nfc", path);
  return value;
}

/**
 * @param {unknown} value
 * @param {string} path
 * @param {number} maximumItems
 * @param {number} maximumLength
 */
function stringList(value, path, maximumItems, maximumLength) {
  const values = list(value, path);
  if (values.length > maximumItems) fail("too-many-items", path);
  const result = values.map((item, index) =>
    text(item, `${path}[${index}]`, maximumLength),
  );
  if (new Set(result).size !== result.length) fail("duplicate-items", path);
  return result;
}

/** @param {unknown} value @param {string} path */
function exactDate(value, path) {
  const result = text(value, path, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(result)) fail("invalid-date", path);
  const parsed = new Date(`${result}T00:00:00.000Z`);
  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== result
  ) {
    fail("invalid-date", path);
  }
  return result;
}

/** @param {unknown} value @param {string} path */
function exactDateTime(value, path) {
  const result = text(value, path, 40);
  const parsed = new Date(result);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== result) {
    fail("invalid-date-time", path);
  }
  return result;
}

/**
 * @param {Record<string, unknown>} value
 * @param {string[]} expected
 * @param {string} path
 */
function exactKeys(value, expected, path) {
  const actual = Object.keys(value);
  for (const key of expected) {
    if (!Object.hasOwn(value, key)) fail("missing-field", `${path}.${key}`);
  }
  for (const key of actual) {
    if (!expected.includes(key)) fail("unknown-field", `${path}.${key}`);
  }
}

/** @param {unknown} actual @param {unknown} expected @param {string} path */
function equal(actual, expected, path) {
  if (actual !== expected) fail("unexpected-value", path);
}

/** @param {string} code @param {string} path @returns {never} */
function fail(code, path) {
  throw new ProfileValidationError(code, path);
}

export { MAX_FAMILIAR_LABEL_LENGTH, MAX_FAMILIAR_LABELS };

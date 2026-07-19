import {
  PROJECTION_FIELDS,
  isPersonalizedProcessingMode,
  isoDate,
  localOnlyProfile,
  validateProfile,
} from "./profile.mjs";
import { sha256, stableStringify } from "../content/stable-json.mjs";
import { sanitizeFamiliarLabel } from "./sanitize.mjs";

export const PERSONALIZED_ANALOGY_GENERATION_ENABLED = true;
export const TRANSMISSION_DESTINATION = "configured_coding_model_service";
export const TRANSMISSION_PURPOSE = "bounded_analogy_role_binding_only";
export const LOCAL_ONLY_FIELDS = [
  "profile_id",
  "observed_experience",
  "safety_concerns",
  "no_analogy",
  "model_processing.approved_at",
  "model_processing.approved_projection_digest",
  "updated_at",
];

/**
 * @typedef {{ label: string }} ProjectedWorld
 * @typedef {{
 *   language?: "ko" | "en",
 *   presentation_preference?: "analogy_first" | "try_first" | "checklist" | "neutral",
 *   familiar_worlds?: ProjectedWorld[]
 * }} ProfileProjection
 * @typedef {{
 *   status: "ready",
 *   destination: string,
 *   purpose: string,
 *   projection: ProfileProjection,
 *   fields: string[],
 *   excluded_local_fields: string[]
 * } | {
 *   status: "fallback",
 *   reason: string,
 *   destination: string,
 *   purpose: string,
 *   projection: null,
 *   fields: never[],
 *   excluded_local_fields: string[]
 * }} TransmissionPreview
 */

/**
 * Build the user-visible outbound preview without mutating or persisting it.
 * The projection is constructed field by field; the raw profile is never
 * spread, serialized, or passed across the boundary.
 *
 * @param {unknown} profileValue
 * @param {string[]} [requestedFields]
 * @returns {TransmissionPreview}
 */
export function transmissionPreview(
  profileValue,
  requestedFields = PROJECTION_FIELDS,
) {
  let profile;
  try {
    profile = validateProfile(profileValue);
  } catch {
    return fallback("invalid-profile");
  }

  const fields = orderedApprovedFields(requestedFields);
  if (fields.length === 0) return fallback("empty-allowlist");

  /** @type {ProfileProjection} */
  const projection = {};
  if (fields.includes("language")) projection.language = profile.language;
  if (fields.includes("presentation_preference")) {
    projection.presentation_preference = profile.presentation_preference;
  }
  if (fields.includes("familiar_worlds")) {
    /** @type {ProjectedWorld[]} */
    const worlds = [];
    for (const world of profile.familiar_worlds) {
      const sanitized = sanitizeFamiliarLabel(world.label);
      if (!sanitized.ok) return fallback(`unsafe-label:${sanitized.reason}`);
      worlds.push({ label: sanitized.value });
    }
    if (worlds.length > 0) projection.familiar_worlds = worlds;
  }

  const actualFields = PROJECTION_FIELDS.filter((field) =>
    Object.hasOwn(projection, field),
  );
  if (actualFields.length === 0) return fallback("empty-projection");
  if (!projection.familiar_worlds?.length) {
    return fallback("no-approved-familiar-world");
  }
  if (projection.presentation_preference === "neutral" || profile.no_analogy) {
    return fallback("neutral-or-no-analogy");
  }

  return {
    status: "ready",
    destination: TRANSMISSION_DESTINATION,
    purpose: TRANSMISSION_PURPOSE,
    projection,
    fields: actualFields,
    excluded_local_fields: [...LOCAL_ONLY_FIELDS],
  };
}

/**
 * Record consent only after a concrete preview passes. No payload or prompt is
 * persisted—only approved field names and the approval timestamp.
 *
 * @param {unknown} profileValue
 * @param {string[]} [requestedFields]
 * @param {Date} [now]
 */
export function approvePersonalization(
  profileValue,
  requestedFields = PROJECTION_FIELDS,
  now = new Date(),
) {
  const profile = validateProfile(profileValue);
  const preview = transmissionPreview(profile, requestedFields);
  if (preview.status !== "ready") {
    return {
      profile: localOnlyProfile(profile, now),
      preview,
      approved: false,
    };
  }

  const approved = validateProfile({
    ...profile,
    model_processing: {
      mode: "personalized_model",
      approved_fields: preview.fields,
      approved_at: now.toISOString(),
      approved_projection_digest: projectionDigest(preview.projection),
    },
    no_analogy: false,
    updated_at: isoDate(now),
  });
  return { profile: approved, preview, approved: true };
}

/**
 * Construct the only profile-shaped value a future G004 model adapter may
 * receive. Neutral and no-analogy profiles never construct a projection.
 *
 * @param {unknown} profileValue
 * @returns {{ status: "ready", projection: ProfileProjection, approval_instance_digest: string } | { status: "fallback", reason: string }}
 */
export function constructApprovedProjection(profileValue) {
  let profile;
  try {
    profile = validateProfile(profileValue);
  } catch {
    return { status: "fallback", reason: "invalid-profile" };
  }
  if (profile.no_analogy) {
    return { status: "fallback", reason: "no-analogy" };
  }
  if (!isPersonalizedProcessingMode(profile.model_processing.mode)) {
    return { status: "fallback", reason: "neutral-local" };
  }
  const preview = transmissionPreview(
    profile,
    profile.model_processing.approved_fields,
  );
  if (preview.status !== "ready") {
    return { status: "fallback", reason: preview.reason };
  }
  if (
    profile.model_processing.approved_projection_digest !==
    projectionDigest(preview.projection)
  ) {
    return { status: "fallback", reason: "projection-consent-mismatch" };
  }
  return {
    status: "ready",
    projection: preview.projection,
    approval_instance_digest: sha256(
      stableStringify({
        destination: TRANSMISSION_DESTINATION,
        purpose: TRANSMISSION_PURPOSE,
        approved_at: profile.model_processing.approved_at,
        approved_projection_digest:
          profile.model_processing.approved_projection_digest,
      }),
    ),
  };
}

/**
 * Bind consent to the destination, purpose, and concrete allowlisted
 * projection. The digest never includes the raw profile or any local-only
 * field. Changing host boundary or purpose therefore requires a fresh preview.
 *
 * @param {ProfileProjection} projection
 */
export function projectionDigest(projection) {
  return sha256(
    stableStringify({
      destination: TRANSMISSION_DESTINATION,
      purpose: TRANSMISSION_PURPOSE,
      projection,
    }),
  );
}

/**
 * Boundary seam for interception tests and the future G004 adapter. Nothing in
 * G003 calls this with a network transport in production.
 *
 * @template T
 * @param {unknown} profileValue
 * @param {(projection: Readonly<ProfileProjection>) => Promise<T> | T} consumer
 * @returns {Promise<{ calls: 0, status: "fallback", reason: string } | { calls: 1, status: "delivered", result: T }>}
 */
export async function withApprovedProjection(profileValue, consumer) {
  const constructed = constructApprovedProjection(profileValue);
  if (constructed.status !== "ready") {
    return {
      calls: 0,
      status: "fallback",
      reason: constructed.reason,
    };
  }
  const projection = deepFreeze(structuredClone(constructed.projection));
  const result = await consumer(projection);
  return { calls: 1, status: "delivered", result };
}

/** @param {string[]} values */
function orderedApprovedFields(values) {
  if (!Array.isArray(values)) return [];
  const unique = new Set(values);
  if ([...unique].some((field) => !PROJECTION_FIELDS.includes(field))) {
    return [];
  }
  return PROJECTION_FIELDS.filter((field) => unique.has(field));
}

/** @param {string} reason @returns {TransmissionPreview} */
function fallback(reason) {
  return {
    status: "fallback",
    reason,
    destination: TRANSMISSION_DESTINATION,
    purpose: TRANSMISSION_PURPOSE,
    projection: null,
    fields: [],
    excluded_local_fields: [...LOCAL_ONLY_FIELDS],
  };
}

/** @template T @param {T} value @returns {Readonly<T>} */
function deepFreeze(value) {
  if (typeof value === "object" && value !== null) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

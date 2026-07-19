import { loadG002Bundle } from "../content/load.mjs";
import { stableStringify } from "../content/stable-json.mjs";
import { validateG002Bundle } from "../content/validate.mjs";
import {
  englishOnlyLocalization,
  loadPresentationCatalogs,
} from "../locale/catalog.mjs";
import { negotiateLocale } from "../locale/locale.mjs";
import {
  constructApprovedProjection,
  projectionDigest,
} from "../profile/privacy.mjs";
import {
  isPersonalizedProcessingMode,
  validateProfile,
} from "../profile/profile.mjs";
import {
  analogyCacheKey,
  clearAnalogyCache,
  findCacheReference,
  recordMappingRejection,
  rejectedMappingIds,
  saveCacheReference,
} from "./cache.mjs";
import {
  loadAnalogyAssets,
  publishedMappingHash,
  validateAnalogyAssets,
} from "./catalog.mjs";
import {
  clearPersonalizedMappings,
  createPersonalizationRequest,
  loadPersonalizedResolution,
  rejectPersonalizedCandidate,
  savePersonalizedCandidate,
  validatePersonalizedCandidate,
} from "./personalized.mjs";

export const RENDERER_VERSION = "2.0.0";
export const ANALOGY_NETWORK_CALLS = 0;
export const LIVE_ANALOGY_GENERATION_ENABLED = true;
const LOCALLY_RESOLVED_CATALOG_RESOLUTIONS = new WeakSet();

/** @param {unknown} value */
export function isLocallyResolvedCatalogResolution(value) {
  return (
    typeof value === "object" &&
    value !== null &&
    LOCALLY_RESOLVED_CATALOG_RESOLUTIONS.has(value)
  );
}

/** @typedef {{
 * status: string,
 * selectionMode: string,
 * contentVersion: string,
 * contractVersion: number,
 * catalogVersion: string,
 * candidateRegistryHash: string,
 * mappingCatalogHash: string,
 * mappingCount: number,
 * worldCount: number,
 * contracts: Record<string, unknown>[],
 * mappings: Record<string, unknown>[],
 * worlds: Record<string, unknown>[],
 * mappingHashes: Record<string, string>
 * }} RuntimePublication */

/** @typedef {{
 * source_locale: string,
 * supported_locales: string[],
 * catalogs: Record<string, Record<string, any>>,
 * catalog_hashes: Record<string, string>,
 * unavailable_locale_reasons: Record<string, string>
 * }} RuntimeLocalization */

/**
 * @typedef {{
 *   kind: "mapped",
 *   reason: "validated-catalog" | "validated-profile-binding",
 *   mapping_id: string,
 *   mapping_version: number,
 *   mapping_hash: string,
 *   profile_world_id: string,
 *   analogy_concept_id: string,
 *   analogy_label: string,
 *   role_map: Record<string, string>,
 *   relations: Array<{ relation_id: string, from_role: string, from_target: string, relation: string, to_role: string, to_target: string }>,
 *   non_mappings: string[],
 *   breakpoint: string,
 *   neutral_fallback: string,
 *   controls: string[],
 *   source: "catalog" | "cache" | "profile-adapter",
 *   profile_projection_calls: 1,
 *   network_calls: 0
 * } | {
 *   kind: "neutral",
 *   reason: string,
 *   profile_projection_calls: 0 | 1,
 *   network_calls: 0
 * } | {
 *   kind: "none",
 *   reason: string,
 *   profile_projection_calls: 0,
 *   network_calls: 0
 * }} AnalogyResolution
 */

/** @param {string} root @param {Date} [now] */
export async function loadAnalogyRuntime(
  root,
  now = new Date("2026-07-18T00:00:00.000Z"),
) {
  const bundle = await loadG002Bundle(root);
  validateG002Bundle(bundle);
  const publication = validateAnalogyAssets(
    bundle,
    await loadAnalogyAssets(root),
    now,
  );
  const baseRuntime = runtimeFromBundle(
    bundle,
    publication,
    englishOnlyLocalization("presentation-catalog-not-loaded"),
  );
  const localization = await loadPresentationCatalogs(root, baseRuntime);
  return runtimeFromBundle(bundle, publication, localization);
}

/**
 * Product-facing loader: canonical content must still validate, while a
 * damaged/expired analogy catalog degrades to neutral rendering.
 *
 * @param {string} root
 * @param {Date} [now]
 */
export async function loadAnalogyRuntimeSafe(
  root,
  now = new Date("2026-07-18T00:00:00.000Z"),
) {
  const bundle = await loadG002Bundle(root);
  validateG002Bundle(bundle);
  let publication;
  try {
    publication = validateAnalogyAssets(
      bundle,
      await loadAnalogyAssets(root),
      now,
    );
  } catch {
    const manifest = /** @type {Record<string, unknown>} */ (bundle.manifest);
    publication = {
      status: "fallback",
      selectionMode: "neutral-only",
      contentVersion: /** @type {string} */ (manifest.content_version),
      contractVersion: 0,
      catalogVersion: "0.0.0",
      candidateRegistryHash: "",
      mappingCatalogHash: "",
      mappingCount: 0,
      worldCount: 0,
      contracts: [],
      mappings: [],
      worlds: [],
      mappingHashes: {},
    };
    return {
      status: "fallback",
      reason: "invalid-or-expired-analogy-catalog",
      locale_status: "fallback",
      runtime: runtimeFromBundle(
        bundle,
        publication,
        englishOnlyLocalization("analogy-catalog-unavailable"),
      ),
    };
  }

  const baseRuntime = runtimeFromBundle(
    bundle,
    publication,
    englishOnlyLocalization("presentation-catalog-not-loaded"),
  );
  try {
    return {
      status: "ready",
      locale_status: "ready",
      runtime: runtimeFromBundle(
        bundle,
        publication,
        await loadPresentationCatalogs(root, baseRuntime),
      ),
    };
  } catch {
    return {
      status: "ready",
      locale_status: "fallback",
      reason: "invalid-presentation-catalog",
      runtime: runtimeFromBundle(
        bundle,
        publication,
        englishOnlyLocalization("invalid-presentation-catalog"),
      ),
    };
  }
}

/** @param {Record<string, unknown>} bundle @param {RuntimePublication} publication @param {RuntimeLocalization} localization */
function runtimeFromBundle(bundle, publication, localization) {
  const concepts = /** @type {Record<string, unknown>[]} */ (
    /** @type {Record<string, unknown>} */ (bundle.concepts).cards
  );
  const scenarios = /** @type {Record<string, unknown>[]} */ (
    /** @type {Record<string, unknown>} */ (bundle.scenarios).scenarios
  );
  const profiles = /** @type {Record<string, unknown>[]} */ (
    /** @type {Record<string, unknown>} */ (bundle.profiles).profiles
  );
  const cases = /** @type {Record<string, unknown>[]} */ (
    /** @type {Record<string, unknown>} */ (bundle.cases).cases
  );
  const manifest = /** @type {Record<string, unknown>} */ (bundle.manifest);
  return deepFreeze({
    content: {
      content_version: /** @type {string} */ (publication.contentVersion),
      canonical_hashes: structuredClone(manifest.canonical_hashes),
      scenario_fact_hashes: structuredClone(manifest.scenario_fact_hashes),
      concepts: structuredClone(concepts),
      scenarios: structuredClone(scenarios),
      profiles: structuredClone(profiles),
      cases: structuredClone(cases),
    },
    publication: structuredClone(publication),
    localization: structuredClone(localization),
    renderer_version: RENDERER_VERSION,
  });
}

/**
 * Resolve only a validated, bundled mapping. Canonical content is deliberately
 * absent from the selector input and output mutation surface.
 *
 * @param {Awaited<ReturnType<typeof loadAnalogyRuntime>>} runtime
 * @param {{
 * profile: unknown,
 * scenarioId: string,
 * dataDir?: string,
 * choice?: "preferred" | "different" | "unfamiliar" | "no_analogy",
 * priorMappingId?: string,
 * rejectedMappingIds?: string[],
 * personalizedCandidate?: unknown,
 * regressionCatalog?: boolean
 * }} input
 * @returns {Promise<AnalogyResolution>}
 */
export async function resolveAnalogy(runtime, input) {
  const scenario = runtime.content.scenarios.find(
    (item) => item.scenario_id === input.scenarioId,
  );
  if (!scenario) return neutral("unknown-scenario", 0);
  const choice = input.choice ?? "preferred";
  if (choice === "no_analogy") {
    await clearPersonalizationState(input.dataDir);
    return none("user-no-analogy");
  }
  if (!["preferred", "different", "unfamiliar"].includes(choice)) {
    await clearPersonalizationState(input.dataDir);
    return neutral("invalid-choice", 0);
  }

  let profile;
  try {
    profile = validateProfile(input.profile);
  } catch {
    await clearPersonalizationState(input.dataDir);
    return neutral("invalid-profile", 0);
  }
  if (profile.no_analogy) {
    await clearPersonalizationState(input.dataDir);
    return none("profile-no-analogy");
  }
  if (!isPersonalizedProcessingMode(profile.model_processing.mode)) {
    await clearPersonalizationState(input.dataDir);
    return neutral("neutral-local", 0);
  }

  const constructed = constructApprovedProjection(profile);
  if (constructed.status !== "ready") {
    await clearPersonalizationState(input.dataDir);
    return neutral(constructed.reason, 0);
  }
  const projection = constructed.projection;
  const approvedDigest = projectionDigest(projection);
  const locale = resolvedRuntimeLocale(runtime, projection.language);

  // The three reviewed worlds are retained only for explicit regression and
  // locale evaluation. Production personalization uses the user's approved
  // local profile projection as its source of truth and accepts only bounded
  // role-slot bindings validated against the reviewed relation contract.
  if (input.regressionCatalog !== true) {
    const prepared = createPersonalizationRequest(
      runtime,
      profile,
      input.scenarioId,
    );
    if (prepared.status !== "ready") {
      return neutral(prepared.reason, 1);
    }
    const request = prepared.request;
    const stored = await loadPersonalizedResolution(
      input.dataDir,
      runtime,
      request,
    );
    if (input.priorMappingId && !stored) {
      return neutral("unknown-prior-mapping", 1);
    }
    if (
      input.priorMappingId &&
      stored &&
      input.priorMappingId !== stored.mapping_id
    ) {
      return neutral("prior-mapping-outside-approved-profile", 1);
    }
    if (
      (choice === "different" || choice === "unfamiliar") &&
      !input.priorMappingId
    ) {
      return neutral(`${choice}-requires-prior-mapping`, 1);
    }
    if (choice === "different" || choice === "unfamiliar") {
      await rejectPersonalizedCandidate(input.dataDir, request.request_id);
    }
    if (input.personalizedCandidate !== undefined) {
      try {
        const resolution = input.dataDir
          ? await savePersonalizedCandidate(
              input.dataDir,
              runtime,
              request,
              input.personalizedCandidate,
            )
          : validatePersonalizedCandidate(
              runtime,
              request,
              input.personalizedCandidate,
            );
        if (
          input.priorMappingId &&
          resolution.mapping_id === input.priorMappingId
        ) {
          return neutral("personalized-candidate-not-different", 1);
        }
        return resolution;
      } catch {
        return neutral("invalid-personalized-candidate", 1);
      }
    }
    if (choice === "preferred" && stored) return stored;
    return neutral("personalized-mapping-required", 1);
  }

  const selectedProfileId = selectPublishedProfile(
    projection,
    runtime.publication.worlds,
    locale === "ko" ? runtime.localization.catalogs.ko?.worlds : undefined,
  );
  if (!selectedProfileId) return neutral("no-reviewed-world-match", 1);

  const priorMapping = input.priorMappingId
    ? findPublishedMapping(runtime, input.priorMappingId)
    : null;
  if (input.priorMappingId && !priorMapping) {
    return neutral("unknown-prior-mapping", 1);
  }
  if (
    priorMapping &&
    (priorMapping.profile_id !== selectedProfileId ||
      priorMapping.scenario_id !== input.scenarioId)
  ) {
    return neutral("prior-mapping-outside-approved-world", 1);
  }
  if (choice === "different" && !priorMapping) {
    return neutral("different-requires-prior-mapping", 1);
  }
  if (choice === "unfamiliar" && !priorMapping) {
    return neutral("unfamiliar-requires-prior-mapping", 1);
  }
  if (choice === "unfamiliar" && priorMapping && input.dataDir) {
    await recordMappingRejection(input.dataDir, {
      mapping_id: priorMapping.mapping_id,
      mapping_version: priorMapping.mapping_version,
      reason_code: "unfamiliar",
    });
  }

  const persistedRejected = await rejectedMappingIds(input.dataDir);
  const explicitRejected = normalizeRejectedIds(input.rejectedMappingIds ?? []);
  if (explicitRejected === null) {
    await clearPersonalizationState(input.dataDir);
    return neutral("invalid-rejected-mapping-id", 1);
  }
  const excluded = new Set([...persistedRejected, ...explicitRejected]);
  if (priorMapping && (choice === "different" || choice === "unfamiliar")) {
    excluded.add(/** @type {string} */ (priorMapping.mapping_id));
  }

  const scenarioFactHash = /** @type {string} */ (
    /** @type {Record<string, unknown>} */ (
      runtime.content.scenario_fact_hashes
    )[input.scenarioId]
  );
  const cacheKey = analogyCacheKey({
    contentVersion: runtime.content.content_version,
    canonicalFactSetHash: scenarioFactHash,
    contractVersion: runtime.publication.contractVersion,
    catalogVersion: runtime.publication.catalogVersion,
    rendererVersion: runtime.renderer_version,
    locale,
    scenarioId: input.scenarioId,
    projectionDigest: approvedDigest,
    choice,
    excludedMappingIds: [...excluded],
  });
  const cached = await findCacheReference(input.dataDir, cacheKey);
  if (cached) {
    const mapping = findPublishedMapping(runtime, cached.mapping_id);
    if (
      mapping &&
      mapping.profile_id === selectedProfileId &&
      cacheReferenceMatches(runtime, cached, mapping, scenarioFactHash, choice)
    ) {
      return mappedResolution(runtime, mapping, "cache");
    }
  }

  const mapping = selectMapping({
    runtime,
    scenarioId: input.scenarioId,
    selectedProfileId,
    excluded,
  });
  if (!mapping) return neutral("no-validated-alternative", 1);
  if (!mappingStillPublished(runtime, mapping)) {
    return neutral("mapping-validation-drift", 1);
  }

  const mappingHash = publishedMappingHash(mapping);
  if (input.dataDir) {
    await saveCacheReference(input.dataDir, {
      cache_key: cacheKey,
      scenario_id: input.scenarioId,
      mapping_id: mapping.mapping_id,
      mapping_version: mapping.mapping_version,
      mapping_hash: mappingHash,
      content_version: runtime.content.content_version,
      canonical_fact_set_hash: scenarioFactHash,
      contract_version: runtime.publication.contractVersion,
      catalog_version: runtime.publication.catalogVersion,
      renderer_version: runtime.renderer_version,
      locale,
      choice,
    });
  }
  return mappedResolution(runtime, mapping, "catalog");
}

/**
 * @param {import("../profile/privacy.mjs").ProfileProjection} projection
 * @param {Record<string, unknown>[]} worlds
 * @param {Record<string, unknown>[]} [localizedWorlds]
 */
export function selectPublishedProfile(projection, worlds, localizedWorlds) {
  if (!projection.familiar_worlds?.length) return null;
  const selectionWorlds = localizedWorlds?.length ? localizedWorlds : worlds;
  const labels = new Set(
    projection.familiar_worlds.map((world) => world.label),
  );
  const matches = selectionWorlds.filter((world) =>
    /** @type {string[]} */ (world.selection_aliases).some((alias) =>
      labels.has(alias),
    ),
  );
  const profileIds = [
    ...new Set(matches.map((world) => String(world.profile_id))),
  ];
  return profileIds.length === 1 ? profileIds[0] : null;
}

/** @param {Awaited<ReturnType<typeof loadAnalogyRuntime>>} runtime @param {unknown} requested */
function resolvedRuntimeLocale(runtime, requested) {
  const negotiated = negotiateLocale(requested);
  if (
    negotiated.resolved_locale === "ko" &&
    !runtime.localization.catalogs.ko
  ) {
    return "en";
  }
  return negotiated.resolved_locale;
}

/**
 * @param {{
 * runtime: Awaited<ReturnType<typeof loadAnalogyRuntime>>,
 * scenarioId: string,
 * selectedProfileId: string,
 * excluded: Set<string>
 * }} input
 */
function selectMapping(input) {
  const mappings = input.runtime.publication.mappings
    .filter(
      (mapping) =>
        mapping.scenario_id === input.scenarioId &&
        mapping.profile_id === input.selectedProfileId &&
        !input.excluded.has(/** @type {string} */ (mapping.mapping_id)),
    )
    .sort((left, right) =>
      String(left.mapping_id).localeCompare(String(right.mapping_id)),
    );
  return mappings[0] ?? null;
}

/** @param {Awaited<ReturnType<typeof loadAnalogyRuntime>>} runtime @param {string} mappingId */
function findPublishedMapping(runtime, mappingId) {
  return (
    runtime.publication.mappings.find(
      (mapping) => mapping.mapping_id === mappingId,
    ) ?? null
  );
}

/** @param {Awaited<ReturnType<typeof loadAnalogyRuntime>>} runtime @param {Record<string, unknown>} mapping @param {"catalog" | "cache"} source @returns {AnalogyResolution} */
function mappedResolution(runtime, mapping, source) {
  if (!mappingStillPublished(runtime, mapping)) {
    return neutral("mapping-validation-drift", 1);
  }
  const contract = runtime.publication.contracts.find(
    (item) => item.concept_id === mapping.concept_id,
  );
  const card = runtime.content.concepts.find(
    (item) => item.id === mapping.concept_id,
  );
  if (!contract || !card) return neutral("invalid-runtime-reference", 1);
  const roleMap = /** @type {Record<string, string>} */ (mapping.role_map);
  const relations = /** @type {Record<string, unknown>[]} */ (
    contract.required_relations
  ).map((relation) => ({
    relation_id: /** @type {string} */ (relation.relation_id),
    from_role: /** @type {string} */ (relation.from_role),
    from_target: roleMap[/** @type {string} */ (relation.from_role)],
    relation: /** @type {string} */ (relation.relation),
    to_role: /** @type {string} */ (relation.to_role),
    to_target: roleMap[/** @type {string} */ (relation.to_role)],
  }));
  /** @type {AnalogyResolution} */
  const resolution = deepFreeze({
    kind: "mapped",
    reason: "validated-catalog",
    mapping_id: /** @type {string} */ (mapping.mapping_id),
    mapping_version: /** @type {number} */ (mapping.mapping_version),
    mapping_hash: publishedMappingHash(mapping),
    profile_world_id: /** @type {string} */ (mapping.profile_world_id),
    analogy_concept_id: /** @type {string} */ (mapping.concept_id),
    analogy_label: /** @type {string} */ (mapping.analogy_label),
    role_map: structuredClone(roleMap),
    relations,
    non_mappings: structuredClone(
      /** @type {string[]} */ (mapping.non_mappings),
    ),
    breakpoint: /** @type {string} */ (card.analogy_breakpoint),
    neutral_fallback: /** @type {string} */ (card.neutral_example),
    controls: ["different", "no_analogy", "unfamiliar"],
    source,
    profile_projection_calls: 1,
    network_calls: 0,
  });
  LOCALLY_RESOLVED_CATALOG_RESOLUTIONS.add(resolution);
  return resolution;
}

/** @param {string | undefined} dataDir */
export async function clearPersonalizationState(dataDir) {
  await clearPersonalizedMappings(dataDir);
  await clearAnalogyCache(dataDir);
}

/**
 * @param {Awaited<ReturnType<typeof loadAnalogyRuntime>>} runtime
 * @param {import("./cache.mjs").CacheEntry} cached
 * @param {Record<string, unknown>} mapping
 * @param {string} scenarioFactHash
 * @param {"preferred" | "different" | "unfamiliar"} choice
 */
function cacheReferenceMatches(
  runtime,
  cached,
  mapping,
  scenarioFactHash,
  choice,
) {
  return (
    mappingStillPublished(runtime, mapping) &&
    cached.scenario_id === mapping.scenario_id &&
    cached.mapping_version === mapping.mapping_version &&
    cached.mapping_hash === publishedMappingHash(mapping) &&
    cached.content_version === runtime.content.content_version &&
    cached.canonical_fact_set_hash === scenarioFactHash &&
    cached.contract_version === runtime.publication.contractVersion &&
    cached.catalog_version === runtime.publication.catalogVersion &&
    cached.renderer_version === runtime.renderer_version &&
    cached.choice === choice
  );
}

/** @param {Awaited<ReturnType<typeof loadAnalogyRuntime>>} runtime @param {Record<string, unknown>} mapping */
function mappingStillPublished(runtime, mapping) {
  const mappingId = /** @type {string} */ (mapping.mapping_id);
  return (
    mapping.validation_status === "validated" &&
    runtime.publication.mappingHashes[mappingId] ===
      publishedMappingHash(mapping)
  );
}

/** @param {unknown} values @returns {string[] | null} */
function normalizeRejectedIds(values) {
  if (
    !Array.isArray(values) ||
    values.some((value) => typeof value !== "string")
  ) {
    return null;
  }
  const result = [...new Set(values)];
  if (
    result.some(
      (value) => !/^P[1-9][0-9]*-S[0-9]{2}-A[1-9][0-9]*$/u.test(value),
    )
  ) {
    return null;
  }
  return result;
}

/** @param {string} reason @param {0 | 1} calls @returns {AnalogyResolution} */
function neutral(reason, calls) {
  return {
    kind: "neutral",
    reason,
    profile_projection_calls: calls,
    network_calls: 0,
  };
}

/** @param {string} reason @returns {AnalogyResolution} */
function none(reason) {
  return {
    kind: "none",
    reason,
    profile_projection_calls: 0,
    network_calls: 0,
  };
}

/** @template T @param {T} value @returns {Readonly<T>} */
function deepFreeze(value) {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) {
    return value;
  }
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

/** @param {AnalogyResolution} resolution */
export function stableResolutionBytes(resolution) {
  return Buffer.from(stableStringify(resolution), "utf8");
}

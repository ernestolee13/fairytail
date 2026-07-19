import { renderScenario } from "../analogy/render.mjs";
import { stableStringify } from "../content/stable-json.mjs";
import { negotiateLocale, SOURCE_LOCALE } from "./locale.mjs";

/**
 * Render from immutable English facts, then replace presentation text through
 * a reviewed locale catalog. Stable IDs, hashes, roles, controls, and policy
 * kinds are never translated.
 *
 * @param {Awaited<ReturnType<import("../analogy/engine.mjs").loadAnalogyRuntime>>} runtime
 * @param {string} scenarioId
 * @param {import("../analogy/engine.mjs").AnalogyResolution} resolution
 * @param {unknown} requestedLocale
 */
export function renderScenarioForLocale(
  runtime,
  scenarioId,
  resolution,
  requestedLocale,
) {
  const base = renderScenario(runtime, scenarioId, resolution);
  const negotiated = negotiateLocale(requestedLocale);
  const requestedCatalog =
    negotiated.resolved_locale === SOURCE_LOCALE
      ? null
      : runtime.localization.catalogs[negotiated.resolved_locale];

  if (
    negotiated.resolved_locale === SOURCE_LOCALE ||
    requestedCatalog === null
  ) {
    return wrap(base, negotiated, null);
  }
  if (!requestedCatalog) {
    return wrap(
      base,
      {
        ...negotiated,
        resolved_locale: SOURCE_LOCALE,
        fallback_reason:
          runtime.localization.unavailable_locale_reasons[
            negotiated.resolved_locale
          ] ?? "presentation-catalog-unavailable",
      },
      null,
    );
  }

  return wrap(
    localizeContent(base, requestedCatalog),
    negotiated,
    runtime.localization.catalog_hashes[negotiated.resolved_locale],
  );
}

/** @param {ReturnType<typeof renderScenario>} base @param {Record<string, any>} catalog */
function localizeContent(base, catalog) {
  const output = /** @type {Record<string, any>} */ (structuredClone(base));
  const concepts = index(catalog.concepts, "concept_id");
  const scenarios = index(catalog.scenarios, "scenario_id");
  const contracts = index(catalog.contracts, "concept_id");
  const mappings = index(catalog.mappings, "mapping_id");
  const scenario = required(
    scenarios,
    output.current_encounter.scenario_id,
    "scenario",
  );

  const renderedConcepts = /** @type {Record<string, any>[]} */ (
    output.canonical_definition.concepts
  );
  output.canonical_definition.concepts = renderedConcepts.map((concept) => {
    const translated = required(concepts, concept.concept_id, "concept");
    return {
      concept_id: concept.concept_id,
      canonical_definition: translated.canonical_definition,
      mechanism: structuredClone(translated.mechanism),
      safety_boundary: structuredClone(translated.safety_boundary),
    };
  });
  output.current_encounter.reason = scenario.encounter;
  output.current_encounter.fixed_criterion = scenario.fixed_criterion;
  output.target_side_effect_risk_rollback = structuredClone(
    scenario.pre_action,
  );
  output.one_next_action_and_evidence = {
    action: scenario.next_action,
    evidence: scenario.evidence,
  };
  output.diagnostic_or_teachback.question = scenario.diagnostic_question;
  output.protocol_fact_and_fairytail_policy_labels = structuredClone(
    scenario.policy_labels,
  );

  const analogy = output.analogy_or_neutral_fallback;
  if (analogy.kind === "mapped") {
    // Catalog mappings receive reviewed locale strings. User-authored mappings
    // keep the learner's approved nouns while reviewed relation verbs and the
    // canonical breakpoint are localized.
    const mapping = mappings.get(analogy.mapping_id);
    const contract = required(
      contracts,
      analogy.analogy_concept_id,
      "contract",
    );
    const translatedRelations = index(contract.relations, "relation_id");
    if (mapping) {
      analogy.label = mapping.analogy_label;
      analogy.role_map = structuredClone(mapping.role_map);
    }
    const preservedRelations = /** @type {Record<string, any>[]} */ (
      analogy.preserved_relations
    );
    analogy.preserved_relations = preservedRelations.map((relation) => ({
      ...relation,
      from_target: analogy.role_map[relation.from_role],
      relation: required(translatedRelations, relation.relation_id, "relation")
        .relation,
      to_target: analogy.role_map[relation.to_role],
    }));
    if (mapping) {
      output.analogy_breakpoint.non_mappings = structuredClone(
        mapping.non_mappings,
      );
    }
    output.analogy_breakpoint.breakpoint = required(
      concepts,
      analogy.analogy_concept_id,
      "concept",
    ).analogy_breakpoint;
  }

  if (analogy.kind !== "none") {
    const neutralComparisons = /** @type {Record<string, any>[]} */ (
      analogy.neutral_comparison
    );
    analogy.neutral_comparison = neutralComparisons.map((item) => ({
      concept_id: item.concept_id,
      example: required(concepts, item.concept_id, "concept").neutral_example,
    }));
  }
  return output;
}

/** @param {Record<string, unknown>} content @param {ReturnType<typeof negotiateLocale> | Record<string, unknown>} locale @param {string | null | undefined} catalogHash */
function wrap(content, locale, catalogHash) {
  return deepFreeze({
    locale: {
      requested_locale: locale.requested_locale,
      resolved_locale: locale.resolved_locale,
      source_locale: locale.source_locale,
      fallback_reason: locale.fallback_reason,
      catalog_hash: catalogHash ?? null,
    },
    content,
  });
}

/** @param {Record<string, any>[]} entries @param {string} key */
function index(entries, key) {
  return new Map(entries.map((entry) => [entry[key], entry]));
}

/** @param {Map<unknown, Record<string, any>>} entries @param {unknown} id @param {string} kind */
function required(entries, id, kind) {
  const entry = entries.get(id);
  if (!entry) throw new TypeError(`Missing Fairytail ${kind}: ${String(id)}`);
  return entry;
}

/** @param {ReturnType<typeof renderScenarioForLocale>} output */
export function stableLocalizedRenderBytes(output) {
  return Buffer.from(stableStringify(output), "utf8");
}

/** @template T @param {T} value @returns {Readonly<T>} */
function deepFreeze(value) {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) {
    return value;
  }
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

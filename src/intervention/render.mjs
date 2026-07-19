import { sensitiveReason } from "../profile/sanitize.mjs";

export const INTERVENTION_SCHEMA_VERSION = 1;

const COMMON_KEYS = [
  "schema_version",
  "surface",
  "interaction_id",
  "scenario_id",
  "requested_locale",
  "started_at",
];
const ACTOR_VALUES = new Set([
  "claude_code_host",
  "shell_process",
  "claude_code_tool",
  "mcp_server",
  "remote_service",
  "database_engine",
  "user",
]);
const EVIDENCE_KINDS = new Set(["test", "diff", "screen", "status", "log"]);
const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/u;
const CODE_PATTERN =
  /(?:```|`|=>|\b(?:const|let|var|function|class|import|export)\b|[{}])/u;
const HOST_PATH_PATTERN =
  /(?:^|\s)(?:\/Users\/[^/\s]+|\/home\/[^/\s]+|[A-Za-z]:\\Users\\[^\\\s]+)/u;

/**
 * Render one closed intervention surface from reviewed scenario content. The
 * only caller prose accepted is bounded, sensitive-pattern checked, and never
 * passed to the optional presentation model.
 *
 * @param {Awaited<ReturnType<import("../analogy/engine.mjs").loadAnalogyRuntime>>} runtime
 * @param {ReturnType<import("../locale/present.mjs").renderScenarioForLocale>} localized
 * @param {ReturnType<import("./select.mjs").selectInterventionConcepts>} selection
 * @param {unknown} inputValue
 * @param {Date} [now]
 */
export function renderInterventionSurface(
  runtime,
  localized,
  selection,
  inputValue,
  now = new Date(),
) {
  const input = validateSurfaceInput(inputValue);
  if (Date.parse(input.started_at) > now.getTime()) {
    throw new TypeError("intervention started_at cannot be in the future");
  }
  if (
    input.surface === "error" &&
    (Date.parse(input.failure.observed_at) < Date.parse(input.started_at) ||
      Date.parse(input.failure.observed_at) > now.getTime())
  ) {
    throw new TypeError(
      "observed failure must occur during the current interaction",
    );
  }
  const localizedContent = /** @type {Record<string, any>} */ (
    localized.content
  );
  if (
    input.scenario_id !== selection.scenario_id ||
    input.scenario_id !== localizedContent.current_encounter.scenario_id
  ) {
    throw new TypeError("intervention scenario bindings do not match");
  }
  const expanded = expandedExplanation(runtime, localized, selection);
  const resolvedLocale = localized.locale.resolved_locale;
  let core;
  if (input.surface === "before") {
    core = beforeCore(localized, selection, input, String(resolvedLocale));
  } else if (input.surface === "error") {
    core = errorCore(localized, selection, input, String(resolvedLocale));
  } else {
    core = finishCore(localized, selection, input, String(resolvedLocale), now);
  }
  const measuredWords = countWords(core);
  return deepFreeze({
    schema_version: INTERVENTION_SCHEMA_VERSION,
    surface: input.surface,
    interaction_id: input.interaction_id,
    scenario_id: input.scenario_id,
    locale: structuredClone(localized.locale),
    core,
    progressive_disclosure: {
      expanded_available: true,
      expanded,
    },
    mvp_hypothesis: {
      label: selection.hypothesis.label,
      target_words: selection.hypothesis.target_words,
      measured_words: measuredWords,
      measurement_unit: "space_separated_units",
      within_target: measuredWords <= selection.hypothesis.target_words,
      max_new_concepts: selection.hypothesis.max_new_concepts,
      observed_new_concepts: selection.hypothesis.observed_new_concepts,
      safety_can_exceed_limits: true,
    },
  });
}

/** @param {unknown} value */
export function validateSurfaceInput(value) {
  const input = structuredClone(plainRecord(value, "intervention input"));
  if (input.surface === "before") {
    exactKeys(input, [...COMMON_KEYS, "action"], "before intervention input");
  } else if (input.surface === "error") {
    exactKeys(
      input,
      [...COMMON_KEYS, "failure", "cause"],
      "error intervention input",
    );
  } else if (input.surface === "finish") {
    exactKeys(
      input,
      [...COMMON_KEYS, "claim", "verification"],
      "finish intervention input",
    );
  } else {
    throw new TypeError(
      "intervention surface must be before, error, or finish",
    );
  }
  if (input.schema_version !== INTERVENTION_SCHEMA_VERSION) {
    throw new TypeError("unsupported intervention input schema version");
  }
  identifier(input.interaction_id, "interaction_id");
  if (
    typeof input.scenario_id !== "string" ||
    !/^S\d{2}$/u.test(input.scenario_id)
  ) {
    throw new TypeError("scenario_id must use the reviewed SNN identifier");
  }
  if (
    input.requested_locale !== null &&
    (typeof input.requested_locale !== "string" ||
      input.requested_locale.length === 0 ||
      input.requested_locale.length > 35)
  ) {
    throw new TypeError("requested_locale is invalid");
  }
  dateTime(input.started_at, "started_at");

  if (input.surface === "before") validateAction(input.action);
  if (input.surface === "error") {
    const failure = validateFailure(input.failure);
    const cause = validateCause(input.cause);
    if (cause.based_on_evidence_id !== failure.evidence_id) {
      throw new TypeError(
        "error cause must cite the observed failure evidence",
      );
    }
    input.failure = failure;
    input.cause = cause;
  }
  if (input.surface === "finish") {
    const claim = plainRecord(input.claim, "finish claim");
    exactKeys(claim, ["summary"], "finish claim");
    safeText(claim.summary, "finish claim.summary");
    if (input.verification !== null) {
      input.verification = validateVerificationEvidence(input.verification);
    }
  }
  return deepFreeze(input);
}

/** @param {unknown} value */
export function validateVerificationEvidence(value) {
  const evidence = structuredClone(plainRecord(value, "verification evidence"));
  exactKeys(
    evidence,
    [
      "evidence_version",
      "evidence_id",
      "interaction_id",
      "check_id",
      "kind",
      "status",
      "summary",
      "observed_at",
    ],
    "verification evidence",
  );
  if (evidence.evidence_version !== 1) {
    throw new TypeError("unsupported verification evidence version");
  }
  identifier(evidence.evidence_id, "verification evidence.evidence_id");
  identifier(evidence.interaction_id, "verification evidence.interaction_id");
  identifier(evidence.check_id, "verification evidence.check_id");
  if (!EVIDENCE_KINDS.has(evidence.kind)) {
    throw new TypeError("verification evidence.kind is invalid");
  }
  if (evidence.status !== "passed" && evidence.status !== "failed") {
    throw new TypeError(
      "verification evidence.status must be passed or failed",
    );
  }
  safeText(evidence.summary, "verification evidence.summary");
  dateTime(evidence.observed_at, "verification evidence.observed_at");
  return deepFreeze(evidence);
}

/**
 * Fresh means that the check is explicitly bound to this interaction, passed,
 * happened after work began, and is not dated in the future.
 *
 * @param {ReturnType<typeof validateSurfaceInput>} input
 * @param {Date} now
 */
export function assessFreshVerification(input, now) {
  if (input.surface !== "finish") {
    throw new TypeError("fresh verification applies only to finish input");
  }
  const evidence = input.verification;
  if (evidence === null) {
    return deepFreeze({ fresh: false, reason: "missing-verification" });
  }
  if (evidence.interaction_id !== input.interaction_id) {
    return deepFreeze({ fresh: false, reason: "interaction-mismatch" });
  }
  if (evidence.status !== "passed") {
    return deepFreeze({ fresh: false, reason: "verification-failed" });
  }
  if (Date.parse(evidence.observed_at) < Date.parse(input.started_at)) {
    return deepFreeze({ fresh: false, reason: "predates-interaction" });
  }
  if (Date.parse(evidence.observed_at) > now.getTime()) {
    return deepFreeze({ fresh: false, reason: "future-evidence" });
  }
  return deepFreeze({ fresh: true, reason: "fresh-passed-evidence" });
}

/** @param {any} localized @param {any} selection @param {any} input @param {string} locale */
function beforeCore(localized, selection, input, locale) {
  const content = localized.content;
  return {
    headline: copy(locale).before,
    concepts: coreConcepts(content, selection),
    action: structuredClone(input.action),
    safety: {
      risk: content.target_side_effect_risk_rollback.risk,
      rollback: content.target_side_effect_risk_rollback.rollback,
    },
    expected_evidence: content.one_next_action_and_evidence.evidence,
    next_action: content.one_next_action_and_evidence.action,
    worked_example: {
      label: "three_step_worked_example",
      steps: [
        `${copy(locale).inspect}: ${input.action.target}`,
        content.one_next_action_and_evidence.action,
        `${copy(locale).verify}: ${content.one_next_action_and_evidence.evidence}`,
      ],
    },
  };
}

/** @param {any} localized @param {any} selection @param {any} input @param {string} locale */
function errorCore(localized, selection, input, locale) {
  const content = localized.content;
  return {
    headline: copy(locale).error,
    stabilization: content.target_side_effect_risk_rollback.rollback,
    observed_evidence: {
      evidence_id: input.failure.evidence_id,
      summary: input.failure.summary,
      observed_at: input.failure.observed_at,
      interrupted: input.failure.interrupted,
    },
    one_evidenced_cause: structuredClone(input.cause),
    one_safe_action: content.one_next_action_and_evidence.action,
    concepts: coreConcepts(content, selection),
    misconception_check: content.diagnostic_or_teachback.question,
    safety: {
      risk: content.target_side_effect_risk_rollback.risk,
      rollback: content.target_side_effect_risk_rollback.rollback,
    },
  };
}

/** @param {any} localized @param {any} selection @param {any} input @param {string} locale @param {Date} now */
function finishCore(localized, selection, input, locale, now) {
  const content = localized.content;
  const assessment = assessFreshVerification(input, now);
  const verified = assessment.fresh === true;
  return {
    headline: verified
      ? copy(locale).finishVerified
      : copy(locale).finishPending,
    claimed_completion: input.claim.summary,
    completion: {
      status: verified ? "verified_complete" : "verification_required",
      reason: assessment.reason,
    },
    verification_evidence:
      input.verification === null ? null : structuredClone(input.verification),
    concepts: coreConcepts(content, selection),
    rollback: content.target_side_effect_risk_rollback.rollback,
    teachback: {
      optional: true,
      question: content.diagnostic_or_teachback.question,
      state_change_requires_scored_rubric: true,
    },
    mini_task: {
      duration_minutes: 10,
      prompt: content.diagnostic_or_teachback.question,
      completion_does_not_imply_learning_state: true,
    },
    safety: {
      risk: content.target_side_effect_risk_rollback.risk,
      checks_fade: false,
    },
  };
}

/** @param {any} content @param {any} selection */
function coreConcepts(content, selection) {
  const concepts = /** @type {Record<string, any>[]} */ (
    content.canonical_definition.concepts
  );
  const selectedConcepts = /** @type {Record<string, any>[]} */ (
    selection.selected
  );
  const byId = new Map(
    concepts.map((concept) => [concept.concept_id, concept]),
  );
  return selectedConcepts.map((selected) => {
    const concept = byId.get(selected.concept_id);
    if (!concept)
      throw new TypeError("selected concept is absent from canonical render");
    return {
      concept_id: selected.concept_id,
      learning_state: selected.state,
      disclosure: selected.disclosure,
      definition:
        selected.disclosure === "safety_only"
          ? null
          : concept.canonical_definition,
      safety_boundary: structuredClone(concept.safety_boundary),
    };
  });
}

/** @param {any} runtime @param {any} localized @param {any} selection */
function expandedExplanation(runtime, localized, selection) {
  const content = localized.content;
  const localizedConcepts = /** @type {Record<string, any>[]} */ (
    content.canonical_definition.concepts
  );
  const canonicalConcepts = /** @type {Record<string, any>[]} */ (
    runtime.content.concepts
  );
  const selectedConcepts = /** @type {Record<string, any>[]} */ (
    selection.selected
  );
  const localizedById = new Map(
    localizedConcepts.map((concept) => [concept.concept_id, concept]),
  );
  const canonicalById = new Map(
    canonicalConcepts.map((concept) => [concept.id, concept]),
  );
  return {
    concepts: selectedConcepts.map((selected) => {
      const localizedConcept = localizedById.get(selected.concept_id);
      const canonical = canonicalById.get(selected.concept_id);
      if (!localizedConcept || !canonical) {
        throw new TypeError("expanded concept metadata is unavailable");
      }
      const base = {
        concept_id: selected.concept_id,
        disclosure: selected.disclosure,
        content_version: runtime.content.content_version,
        scope: canonical.scope,
        spec_revision: canonical.spec_revision,
        verified_at: canonical.verified_at,
        safety_boundary: structuredClone(localizedConcept.safety_boundary),
      };
      if (selected.disclosure === "safety_only") return base;
      return {
        ...base,
        canonical_definition: localizedConcept.canonical_definition,
        mechanism:
          selected.disclosure === "full"
            ? structuredClone(localizedConcept.mechanism)
            : null,
        sources:
          selected.disclosure === "compact"
            ? []
            : structuredClone(canonical.sources),
      };
    }),
    analogy_or_neutral_fallback: structuredClone(
      content.analogy_or_neutral_fallback,
    ),
    analogy_breakpoint: structuredClone(content.analogy_breakpoint),
    protocol_fact_and_fairytail_policy_labels: structuredClone(
      content.protocol_fact_and_fairytail_policy_labels,
    ),
    faded_concept_ids: [...selection.faded_concept_ids],
    safety_detail: "full",
  };
}

/** @param {unknown} value */
function validateAction(value) {
  const action = plainRecord(value, "before action");
  exactKeys(action, ["actor", "target", "expected_change"], "before action");
  if (!ACTOR_VALUES.has(action.actor))
    throw new TypeError("before action.actor is invalid");
  safeText(action.target, "before action.target");
  safeText(action.expected_change, "before action.expected_change");
}

/** @param {unknown} value */
function validateFailure(value) {
  const failure = structuredClone(plainRecord(value, "observed failure"));
  exactKeys(
    failure,
    ["evidence_id", "observed_at", "summary", "interrupted"],
    "observed failure",
  );
  identifier(failure.evidence_id, "observed failure.evidence_id");
  dateTime(failure.observed_at, "observed failure.observed_at");
  safeText(failure.summary, "observed failure.summary");
  if (typeof failure.interrupted !== "boolean") {
    throw new TypeError("observed failure.interrupted must be boolean");
  }
  return deepFreeze(failure);
}

/** @param {unknown} value */
function validateCause(value) {
  const cause = structuredClone(plainRecord(value, "evidenced cause"));
  exactKeys(
    cause,
    ["statement", "confidence", "based_on_evidence_id"],
    "evidenced cause",
  );
  safeText(cause.statement, "evidenced cause.statement");
  if (!new Set(["low", "medium", "high"]).has(cause.confidence)) {
    throw new TypeError("evidenced cause.confidence is invalid");
  }
  identifier(
    cause.based_on_evidence_id,
    "evidenced cause.based_on_evidence_id",
  );
  return deepFreeze(cause);
}

/** @param {unknown} value @param {string} label */
function safeText(value, label) {
  if (
    typeof value !== "string" ||
    value.trim() !== value ||
    value.length === 0 ||
    [...value].length > 240 ||
    value !== value.normalize("NFC") ||
    /[\u0000-\u001f\u007f]/u.test(value) ||
    CODE_PATTERN.test(value) ||
    HOST_PATH_PATTERN.test(value) ||
    sensitiveReason(value) !== undefined
  ) {
    throw new TypeError(`${label} must be a bounded non-sensitive summary`);
  }
}

/** @param {unknown} value @param {string} label */
function identifier(value, label) {
  if (typeof value !== "string" || !IDENTIFIER_PATTERN.test(value)) {
    throw new TypeError(`${label} must be a bounded identifier`);
  }
}

/** @param {unknown} value @param {string} label */
function dateTime(value, label) {
  if (
    typeof value !== "string" ||
    !Number.isFinite(Date.parse(value)) ||
    new Date(value).toISOString() !== value
  ) {
    throw new TypeError(`${label} must be a canonical ISO date-time`);
  }
}

/** @param {unknown} value */
function countWords(value) {
  let count = 0;
  visit(value);
  return count;

  /** @param {unknown} item */
  function visit(item) {
    if (typeof item === "string") {
      count += item.trim().length === 0 ? 0 : item.trim().split(/\s+/u).length;
    } else if (Array.isArray(item)) {
      for (const child of item) visit(child);
    } else if (typeof item === "object" && item !== null) {
      for (const child of Object.values(item)) visit(child);
    }
  }
}

/** @param {string} locale */
function copy(locale) {
  return locale === "ko"
    ? {
        before: "실행 전 확인",
        error: "먼저 안정화하고 근거 하나로 복구",
        finishVerified: "새 검증 증거로 완료 확인",
        finishPending: "완료 주장은 있으나 새 검증이 필요함",
        inspect: "확인",
        verify: "검증",
      }
    : {
        before: "Before this action",
        error: "Stabilize first, then recover from one piece of evidence",
        finishVerified: "Completion verified with fresh evidence",
        finishPending:
          "Completion claimed; fresh verification is still required",
        inspect: "Inspect",
        verify: "Verify",
      };
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

/** @template T @param {T} value @returns {Readonly<T>} */
function deepFreeze(value) {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) {
    return value;
  }
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

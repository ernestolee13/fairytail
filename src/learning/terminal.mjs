export const BEGINNER_SUPPORT_CRITERIA = Object.freeze([
  "verified_outcome",
  "verification_evidence",
  "canonical_definition",
  "familiar_relation_map",
  "analogy_breakpoint",
  "safety_boundary",
  "target_risk_rollback",
  "next_action_evidence",
  "diagnostic_question",
]);

const LABELS = Object.freeze({
  en: {
    baselineTitle: "COMPACT FORMATTER — SYNTHETIC FIXTURE",
    fairytailTitle: "FAIRYTAIL FORMATTER — SAME SYNTHETIC FIXTURE",
    directTitle: "FAIRYTAIL — REVIEWED CONCEPT",
    result: "VERIFIED RESULT",
    check: "CHECK",
    plain: "IN PLAIN LANGUAGE",
    watch: "ONE THING TO WATCH",
    tryNext: "TRY THIS NEXT",
    quickCheck: "QUICK CHECK",
    encounter: "WHY THIS CAME UP",
    meaning: "WHAT THE TERM MEANS",
    safety: "SAFETY BOUNDARY",
    picture: "FAMILIAR PICTURE",
    stops: "WHERE THE PICTURE STOPS",
    before: "BEFORE YOU ACT",
    target: "Target",
    effect: "Side effect",
    risk: "Risk",
    rollback: "Rollback",
    next: "NEXT SAFE STEP",
    evidence: "Evidence",
    checkYourself: "CHECK YOURSELF",
    noAnalogy: "No familiar picture was used.",
    noBreakpoint: "No analogy was used, so there is no analogy boundary.",
  },
  ko: {
    baselineTitle: "간결 포맷터 — 합성 픽스처",
    fairytailTitle: "FAIRYTAIL 포맷터 — 같은 합성 픽스처",
    directTitle: "FAIRYTAIL — 검수된 개념 설명",
    result: "검증된 결과",
    check: "검증",
    plain: "한 문장으로",
    watch: "한 가지 주의",
    tryNext: "다음으로 확인할 것",
    quickCheck: "빠른 확인",
    encounter: "왜 지금 알아야 하나요?",
    meaning: "이 용어의 실제 뜻",
    safety: "안전 경계",
    picture: "익숙한 그림",
    stops: "비유가 멈추는 지점",
    before: "실행 전 확인",
    target: "대상",
    effect: "변화",
    risk: "위험",
    rollback: "되돌리기",
    next: "다음 안전한 단계",
    evidence: "증거",
    checkYourself: "스스로 확인하기",
    noAnalogy: "익숙한 비유를 사용하지 않았습니다.",
    noBreakpoint: "비유를 사용하지 않아 비유의 적용 한계도 없습니다.",
  },
});

/**
 * Render the deliberately compact comparison arm from the exact synthetic
 * verified-result fixture later passed into Fairytail. This is not retained
 * output from a particular coding-agent host.
 *
 * @param {unknown} value
 * @param {"en" | "ko"} [locale]
 */
export function formatBaselineTerminal(value, locale = "en") {
  const result = verifiedResult(value);
  const labels = LABELS[locale];
  return finish([
    labels.baselineTitle,
    "",
    `✓ ${result.summary}`,
    `${labels.check}: ${result.verification.status} · ${result.verification.check_id}`,
  ]);
}

/**
 * Render the actual deterministic learning object as readable terminal text.
 * No model authors, summarizes, or replaces these strings here.
 *
 * @param {unknown} value
 */
export function formatFairytailTerminal(value) {
  const render = learningRender(value);
  const locale = render.locale.resolved_locale === "ko" ? "ko" : "en";
  const labels = LABELS[locale];
  const result = verifiedResult(render.verified_task_result);
  return finish([
    labels.fairytailTitle,
    "",
    labels.result,
    `✓ ${result.summary}`,
    `${labels.check}: ${result.verification.status} · ${result.verification.check_id}`,
    "",
    ...explanationLines(sectionMap(render.sections), labels),
  ]);
}

/**
 * Render one reviewed concept directly from the localized deterministic
 * scenario object. No model authors or rearranges this presentation.
 *
 * @param {unknown} value
 */
export function formatDirectConceptTerminal(value) {
  const localized = record(value, "localized concept render");
  const localeRecord = record(
    localized.locale,
    "localized concept render locale",
  );
  const content = record(localized.content, "localized concept render content");
  const beginnerSummary = text(
    localized.beginner_summary,
    "localized concept render beginner_summary",
  );
  const locale = localeRecord.resolved_locale === "ko" ? "ko" : "en";
  const labels = LABELS[locale];
  return finish([
    labels.directTitle,
    "",
    ...directExplanationLines(
      new Map(Object.entries(content)),
      beginnerSummary,
      labels,
    ),
  ]);
}

/**
 * Compact direct output keeps the reviewed mental model, relation-preserving
 * analogy, its limit, one scenario risk, and one next/check pair. The fuller
 * disclosure formatter remains separate for benchmark and audit evidence.
 *
 * @param {Map<unknown, unknown>} sections
 * @param {string} beginnerSummary
 * @param {Record<string, string>} labels
 */
function directExplanationLines(sections, beginnerSummary, labels) {
  const analogy = record(
    sections.get("analogy_or_neutral_fallback"),
    "analogy_or_neutral_fallback",
  );
  const breakpoint = record(
    sections.get("analogy_breakpoint"),
    "analogy_breakpoint",
  );
  const preAction = record(
    sections.get("target_side_effect_risk_rollback"),
    "target_side_effect_risk_rollback",
  );
  const nextAction = record(
    sections.get("one_next_action_and_evidence"),
    "one_next_action_and_evidence",
  );
  const diagnostic = record(
    sections.get("diagnostic_or_teachback"),
    "diagnostic_or_teachback",
  );
  const lines = [labels.plain, beginnerSummary, "", labels.picture];
  if (analogy.kind === "mapped") {
    lines.push(text(analogy.label, "analogy.label"));
    for (const relation of records(
      analogy.preserved_relations,
      "analogy.preserved_relations",
    ).slice(0, 2)) {
      lines.push(
        `• ${text(relation.from_target, "relation.from_target")} → ${text(relation.relation, "relation.relation")} → ${text(relation.to_target, "relation.to_target")}`,
      );
    }
  } else {
    lines.push(labels.noAnalogy);
  }

  lines.push(
    "",
    labels.stops,
    analogy.kind === "mapped"
      ? text(breakpoint.breakpoint, "analogy_breakpoint.breakpoint")
      : labels.noBreakpoint,
  );
  lines.push(
    "",
    labels.watch,
    `• ${text(preAction.risk, "pre_action.risk")}`,
    "",
    labels.tryNext,
    text(nextAction.action, "next_action.action"),
    "",
    labels.quickCheck,
    text(diagnostic.question, "diagnostic.question"),
  );
  return lines;
}

/** @param {unknown} value */
function sectionMap(value) {
  return new Map(
    records(value, "learning render sections").map((section) => [
      section.slot,
      section.content,
    ]),
  );
}

/**
 * @param {Map<unknown, unknown>} sections
 * @param {Record<string, string>} labels
 */
function explanationLines(sections, labels) {
  const canonical = record(
    sections.get("canonical_definition"),
    "canonical_definition",
  );
  const encounter = record(
    sections.get("current_encounter"),
    "current_encounter",
  );
  const analogy = record(
    sections.get("analogy_or_neutral_fallback"),
    "analogy_or_neutral_fallback",
  );
  const breakpoint = record(
    sections.get("analogy_breakpoint"),
    "analogy_breakpoint",
  );
  const preAction = record(
    sections.get("target_side_effect_risk_rollback"),
    "target_side_effect_risk_rollback",
  );
  const nextAction = record(
    sections.get("one_next_action_and_evidence"),
    "one_next_action_and_evidence",
  );
  const diagnostic = record(
    sections.get("diagnostic_or_teachback"),
    "diagnostic_or_teachback",
  );
  const concepts = records(canonical.concepts, "canonical_definition.concepts");

  const lines = [
    labels.encounter,
    text(encounter.reason, "current_encounter.reason"),
    "",
    labels.meaning,
  ];
  for (const concept of concepts) {
    lines.push(
      `• ${text(concept.canonical_definition, "concept.canonical_definition")}`,
    );
  }

  const safety = concepts.flatMap((concept) =>
    strings(concept.safety_boundary, "concept.safety_boundary"),
  );
  if (safety.length > 0) {
    lines.push("", labels.safety, ...safety.map((item) => `• ${item}`));
  }

  lines.push("", labels.picture);
  if (analogy.kind === "mapped") {
    lines.push(text(analogy.label, "analogy.label"));
    for (const relation of records(
      analogy.preserved_relations,
      "analogy.preserved_relations",
    )) {
      lines.push(
        `• ${text(relation.from_target, "relation.from_target")} → ${text(relation.relation, "relation.relation")} → ${text(relation.to_target, "relation.to_target")}`,
      );
    }
  } else {
    lines.push(labels.noAnalogy);
  }

  lines.push(
    "",
    labels.stops,
    analogy.kind === "mapped"
      ? text(breakpoint.breakpoint, "analogy_breakpoint.breakpoint")
      : labels.noBreakpoint,
    "",
    labels.before,
    `${labels.target}: ${text(preAction.target, "pre_action.target")}`,
    `${labels.effect}: ${text(preAction.side_effect, "pre_action.side_effect")}`,
    `${labels.risk}: ${text(preAction.risk, "pre_action.risk")}`,
    `${labels.rollback}: ${text(preAction.rollback, "pre_action.rollback")}`,
    "",
    labels.next,
    text(nextAction.action, "next_action.action"),
    `${labels.evidence}: ${text(nextAction.evidence, "next_action.evidence")}`,
    "",
    labels.checkYourself,
    text(diagnostic.question, "diagnostic.question"),
  );
  return lines;
}

/**
 * Structural disclosure metric. It measures whether explicit beginner support
 * fields are present; it is deliberately not a comprehension score.
 *
 * @param {"baseline" | "fairytail"} arm
 * @param {unknown} value
 */
export function scoreBeginnerSupport(arm, value) {
  if (arm === "baseline") {
    verifiedResult(value);
    return score({
      verified_outcome: true,
      verification_evidence: true,
    });
  }
  if (arm !== "fairytail") throw new TypeError("Unsupported terminal arm");
  const render = learningRender(value);
  const sectionValues = /** @type {Record<string, any>[]} */ (render.sections);
  const sections = new Map(
    sectionValues.map((section) => [section.slot, section.content]),
  );
  const canonical = record(
    sections.get("canonical_definition"),
    "canonical_definition",
  );
  const concepts = records(canonical.concepts, "canonical_definition.concepts");
  const analogy = record(
    sections.get("analogy_or_neutral_fallback"),
    "analogy_or_neutral_fallback",
  );
  const breakpoint = record(
    sections.get("analogy_breakpoint"),
    "analogy_breakpoint",
  );
  const preAction = record(
    sections.get("target_side_effect_risk_rollback"),
    "target_side_effect_risk_rollback",
  );
  const nextAction = record(
    sections.get("one_next_action_and_evidence"),
    "one_next_action_and_evidence",
  );
  const diagnostic = record(
    sections.get("diagnostic_or_teachback"),
    "diagnostic_or_teachback",
  );
  verifiedResult(render.verified_task_result);
  return score({
    verified_outcome: true,
    verification_evidence: true,
    canonical_definition: concepts.every(
      (concept) =>
        typeof concept.canonical_definition === "string" &&
        concept.canonical_definition.length > 0,
    ),
    familiar_relation_map:
      analogy.kind === "mapped" &&
      Array.isArray(analogy.preserved_relations) &&
      analogy.preserved_relations.length > 0,
    analogy_breakpoint:
      typeof breakpoint.breakpoint === "string" &&
      breakpoint.breakpoint.length > 0,
    safety_boundary: concepts.some(
      (concept) =>
        Array.isArray(concept.safety_boundary) &&
        concept.safety_boundary.length > 0,
    ),
    target_risk_rollback: ["target", "side_effect", "risk", "rollback"].every(
      (key) => typeof preAction[key] === "string" && preAction[key].length > 0,
    ),
    next_action_evidence: ["action", "evidence"].every(
      (key) =>
        typeof nextAction[key] === "string" && nextAction[key].length > 0,
    ),
    diagnostic_question:
      typeof diagnostic.question === "string" && diagnostic.question.length > 0,
  });
}

/** @param {Record<string, boolean>} passed */
function score(passed) {
  const criteria = Object.fromEntries(
    BEGINNER_SUPPORT_CRITERIA.map((key) => [key, passed[key] === true]),
  );
  return Object.freeze({
    passed: Object.values(criteria).filter(Boolean).length,
    possible: BEGINNER_SUPPORT_CRITERIA.length,
    criteria: Object.freeze(criteria),
  });
}

/** @param {unknown} value */
function learningRender(value) {
  const render = record(value, "learning render");
  if (!Array.isArray(render.sections)) {
    throw new TypeError("learning render sections must be an array");
  }
  const locale = record(render.locale, "learning render locale");
  return /** @type {Record<string, any>} */ ({ ...render, locale });
}

/** @param {unknown} value */
function verifiedResult(value) {
  const result = record(value, "verified task result");
  if (result.status !== "verified") {
    throw new TypeError("task result must be verified");
  }
  const verification = record(result.verification, "verification");
  text(result.summary, "verified task result summary");
  if (verification.status !== "passed") {
    throw new TypeError("verification status must be passed");
  }
  text(verification.check_id, "verification check_id");
  text(verification.evidence_id, "verification evidence_id");
  return /** @type {Record<string, any>} */ ({ ...result, verification });
}

/** @param {unknown} value @param {string} label */
function record(value, label) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  return /** @type {Record<string, any>} */ (value);
}

/** @param {unknown} value @param {string} label */
function records(value, label) {
  if (!Array.isArray(value)) throw new TypeError(`${label} must be an array`);
  return value.map((item, index) => record(item, `${label}[${index}]`));
}

/** @param {unknown} value @param {string} label */
function strings(value, label) {
  if (!Array.isArray(value)) throw new TypeError(`${label} must be an array`);
  return value.map((item, index) => text(item, `${label}[${index}]`));
}

/** @param {unknown} value @param {string} label */
function text(value, label) {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`${label} must be a non-empty string`);
  }
  return value;
}

/** @param {string[]} lines */
function finish(lines) {
  return `${lines.join("\n")}\n`;
}

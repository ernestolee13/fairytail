import { stableStringify } from "../content/stable-json.mjs";
import { LEARNING_SECTION_SLOTS } from "./packet.mjs";

export const DISCLOSURE_POLICY_VERSION = 1;

const RENDER_FIELDS = [
  "render_version",
  "packet_id",
  "producer",
  "build_packet_hash",
  "protected_render_hash",
  "route",
  "locale",
  "sections",
  "verified_task_result",
];

/**
 * Materialize a progressive-disclosure plan without asking a model to
 * summarize or rewrite protected text. Only the canonical mechanism and a
 * mapped analogy's neutral comparison may be deferred. Definitions, safety
 * boundaries, breakpoints, risk/rollback, next-action evidence, diagnostics,
 * policy labels, and neutral fallbacks always remain complete.
 *
 * @param {unknown} renderValue
 */
export function applyProgressiveDisclosure(renderValue) {
  const render = structuredClone(record(renderValue, "learning render"));
  exactKeys(render, RENDER_FIELDS, "learning render");
  if (!Array.isArray(render.sections)) {
    throw new TypeError("learning render sections must be an array");
  }
  const sections = /** @type {Record<string, any>[]} */ (render.sections);
  if (
    sections.length !== LEARNING_SECTION_SLOTS.length ||
    new Set(sections.map((section) => section?.slot)).size !==
      LEARNING_SECTION_SLOTS.length ||
    !LEARNING_SECTION_SLOTS.every((slot) =>
      sections.some((section) => section?.slot === slot),
    )
  ) {
    throw new TypeError("learning render must contain every section once");
  }

  render.sections = sections.map((sectionValue, index) => {
    const section = record(sectionValue, `learning render sections[${index}]`);
    exactKeys(
      section,
      ["slot", "detail", "content"],
      `learning render sections[${index}]`,
    );
    if (!LEARNING_SECTION_SLOTS.includes(section.slot)) {
      throw new TypeError(
        `unsupported learning section: ${String(section.slot)}`,
      );
    }
    if (section.detail !== "full" && section.detail !== "compact") {
      throw new TypeError("learning section detail must be full or compact");
    }
    if (section.detail === "full") return structuredClone(section);

    const compact = compactSection(section.slot, section.content);
    return {
      slot: section.slot,
      detail: compact.applied ? "compact" : "full",
      content: compact.content,
    };
  });
  stableStringify(render);
  return deepFreeze(render);
}

/** @param {unknown} renderValue */
export function stableDisclosedRenderBytes(renderValue) {
  return Buffer.from(
    stableStringify(applyProgressiveDisclosure(renderValue)),
    "utf8",
  );
}

/** @param {string} slot @param {unknown} content */
function compactSection(slot, content) {
  if (slot === "canonical_definition") {
    const canonical = structuredClone(record(content, slot));
    if (!Array.isArray(canonical.concepts)) {
      throw new TypeError("canonical_definition.concepts must be an array");
    }
    canonical.concepts = canonical.concepts.map((conceptValue, index) => {
      const concept = structuredClone(
        record(conceptValue, `${slot}.concepts[${index}]`),
      );
      delete concept.mechanism;
      return concept;
    });
    return { applied: true, content: canonical };
  }

  if (slot === "analogy_or_neutral_fallback") {
    const analogy = structuredClone(record(content, slot));
    if (analogy.kind !== "mapped") {
      return { applied: false, content: analogy };
    }
    delete analogy.neutral_comparison;
    return { applied: true, content: analogy };
  }

  return { applied: false, content: structuredClone(content) };
}

/** @param {unknown} value @param {string} label */
function record(value, label) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
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

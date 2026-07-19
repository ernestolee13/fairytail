const EMAIL_PATTERN = /[\p{L}\d._%+-]+@[\p{L}\d.-]+\.[\p{L}]{2,}/iu;
const URL_PATTERN = /(?:https?:\/\/|www\.)\S+/iu;
const PHONE_PATTERN = /(?:\+?\d[\d\s().-]{7,}\d)/u;
const SECRET_PATTERN =
  /(?:\b(?:api[_ -]?key|access[_ -]?token|secret|password|passwd|private[_ -]?key|bearer)\b\s*[:=]?\s*\S+|\b(?:sk|ghp|github_pat)_[A-Za-z0-9_-]{8,}\b|\bAKIA[A-Z0-9]{12,}\b)/iu;
const EXPLICIT_IDENTIFIER_PATTERN =
  /(?:실명|이름|직장명|회사명|학교명|조직명|환자명|고객명|학생명|name|employer|organization|school)\s*[:=]/iu;
const ACCOUNT_PATTERN =
  /(?:주민등록번호|계좌번호|카드번호|account\s*(?:number|id))\s*[:=]?\s*[\d-]+/iu;
const LONG_IDENTIFIER_PATTERN = /\b[A-Za-z0-9_-]{24,}\b/u;
const LIKELY_ORGANIZATION_PATTERN =
  /(?:[\p{L}\d]{2,})(?:대학교|고등학교|중학교|초등학교|병원|의원|주식회사)|\b[A-Z][A-Za-z0-9&.-]+\s+(?:Inc|Corp|Ltd|LLC)\b/u;
const TITLED_PERSON_PATTERN =
  /(?:[가-힣]{2,4}(?:님|씨)|\b(?:Mr|Ms|Mrs|Dr)\.?\s+[A-Z][a-z]+\b)/u;
const CONTROL_PATTERN = /[\u0000-\u001f\u007f]/u;
const LABEL_CHARACTERS = /^[\p{L}\p{M}\p{N}\s·,:/&()+-]+$/u;

export const MAX_FAMILIAR_LABELS = 5;
export const MAX_FAMILIAR_LABEL_LENGTH = 40;

/**
 * Detect only high-confidence sensitive patterns. Anything outside the narrow
 * label character/length contract is treated as uncertain and therefore is
 * never projected to a model.
 *
 * @param {string} value
 * @returns {string | undefined}
 */
export function sensitiveReason(value) {
  if (CONTROL_PATTERN.test(value)) return "control-character";
  if (EMAIL_PATTERN.test(value)) return "email";
  if (URL_PATTERN.test(value)) return "url";
  if (PHONE_PATTERN.test(value)) return "phone";
  if (SECRET_PATTERN.test(value)) return "credential";
  if (EXPLICIT_IDENTIFIER_PATTERN.test(value)) return "explicit-identifier";
  if (ACCOUNT_PATTERN.test(value)) return "account-identifier";
  if (LONG_IDENTIFIER_PATTERN.test(value)) return "long-identifier";
  if (LIKELY_ORGANIZATION_PATTERN.test(value)) return "likely-organization";
  if (TITLED_PERSON_PATTERN.test(value)) return "likely-person-name";
  return undefined;
}

/**
 * @param {unknown} value
 * @returns {{ ok: true, value: string } | { ok: false, reason: string }}
 */
export function sanitizeFamiliarLabel(value) {
  if (typeof value !== "string") return { ok: false, reason: "not-a-string" };
  if (value !== value.normalize("NFC")) {
    return { ok: false, reason: "non-nfc" };
  }

  const normalized = value.trim().replace(/\s+/gu, " ");
  if (!normalized) return { ok: false, reason: "empty" };
  if ([...normalized].length > MAX_FAMILIAR_LABEL_LENGTH) {
    return { ok: false, reason: "too-long" };
  }
  const sensitive = sensitiveReason(normalized);
  if (sensitive) return { ok: false, reason: sensitive };
  if (!LABEL_CHARACTERS.test(normalized)) {
    return { ok: false, reason: "uncertain-characters" };
  }
  return { ok: true, value: normalized };
}

/**
 * @param {unknown[]} values
 * @returns {{ ok: true, values: string[] } | { ok: false, reason: string }}
 */
export function sanitizeFamiliarLabels(values) {
  if (values.length > MAX_FAMILIAR_LABELS) {
    return { ok: false, reason: "too-many-labels" };
  }

  /** @type {string[]} */
  const sanitized = [];
  for (const value of values) {
    const result = sanitizeFamiliarLabel(value);
    if (!result.ok) return result;
    if (!sanitized.includes(result.value)) sanitized.push(result.value);
  }
  return { ok: true, values: sanitized };
}

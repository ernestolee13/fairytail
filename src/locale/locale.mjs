export const SOURCE_LOCALE = "en";
export const SUPPORTED_LOCALES = /** @type {const} */ (["en", "ko"]);

/**
 * Negotiate the two intentionally supported MVP presentation locales without
 * retaining arbitrary user input. Region tags such as en-US and ko-KR collapse
 * to their reviewed base locale; everything else falls back to English.
 *
 * @param {unknown} value
 */
export function negotiateLocale(value) {
  if (value === undefined || value === null || value === "") {
    return localeResult(null, SOURCE_LOCALE, "unspecified-locale");
  }
  if (typeof value !== "string" || value.length > 35) {
    return localeResult(null, SOURCE_LOCALE, "invalid-locale");
  }
  const normalized = value.trim().replaceAll("_", "-").toLowerCase();
  if (!/^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/u.test(normalized)) {
    return localeResult(null, SOURCE_LOCALE, "invalid-locale");
  }
  const base = normalized.split("-")[0];
  if (base === "en" || base === "ko") {
    return localeResult(normalized, base, null);
  }
  return localeResult(normalized, SOURCE_LOCALE, "unsupported-locale");
}

/** @param {string | null} requested @param {"en" | "ko"} resolved @param {string | null} fallbackReason */
function localeResult(requested, resolved, fallbackReason) {
  return Object.freeze({
    requested_locale: requested,
    resolved_locale: resolved,
    source_locale: SOURCE_LOCALE,
    fallback_reason: fallbackReason,
  });
}

import { metric, unavailableMetric } from "./contracts.mjs";

/**
 * Deterministic descriptive statistics. These summarize the supplied runs;
 * they do not imply statistical independence or human-outcome validity.
 *
 * @param {number[]} values
 * @param {string} [source]
 */
export function summarizeSeries(values, source = "benchmark-results") {
  if (
    !Array.isArray(values) ||
    values.some((value) => !Number.isFinite(value))
  ) {
    throw new TypeError("Statistics require an array of finite numbers");
  }

  const sorted = [...values].sort((left, right) => left - right);
  const raw = metric([...values], "measured", `${source}:per-run-raw`);
  const n = metric(values.length, "measured", `${source}:count`);

  if (values.length === 0) {
    const reason = "No measured runs were supplied";
    return {
      raw,
      n,
      mean: unavailableMetric(`${source}:mean`, reason),
      sample_sd: unavailableMetric(`${source}:sample-sd`, reason),
      median: unavailableMetric(`${source}:median`, reason),
      q1: unavailableMetric(`${source}:q1`, reason),
      q3: unavailableMetric(`${source}:q3`, reason),
      iqr: unavailableMetric(`${source}:iqr`, reason),
    };
  }

  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const q1 = quantile(sorted, 0.25);
  const median = quantile(sorted, 0.5);
  const q3 = quantile(sorted, 0.75);

  return {
    raw,
    n,
    mean: metric(mean, "derived", `${source}:arithmetic-mean`),
    sample_sd:
      values.length >= 2
        ? metric(
            Math.sqrt(
              values.reduce((sum, value) => sum + (value - mean) ** 2, 0) /
                (values.length - 1),
            ),
            "derived",
            `${source}:sample-standard-deviation`,
          )
        : unavailableMetric(
            `${source}:sample-standard-deviation`,
            "Sample standard deviation requires at least two runs",
          ),
    median: metric(median, "derived", `${source}:linear-quantile`),
    q1: metric(q1, "derived", `${source}:linear-quantile`),
    q3: metric(q3, "derived", `${source}:linear-quantile`),
    iqr: metric(q3 - q1, "derived", `${source}:q3-minus-q1`),
  };
}

/**
 * Type-7/linear interpolation quantile, matching common statistical tools.
 *
 * @param {number[]} sorted
 * @param {number} probability
 */
function quantile(sorted, probability) {
  if (sorted.length === 1) return sorted[0];
  const position = (sorted.length - 1) * probability;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];
  const weight = position - lower;
  return sorted[lower] * (1 - weight) + sorted[upper] * weight;
}

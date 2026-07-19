import { unlink } from "node:fs/promises";

/**
 * Run every cleanup operation before rethrowing the primary failure. Cleanup
 * failures are preserved instead of masking either error.
 *
 * @param {unknown} primaryError
 * @param {Array<() => Promise<unknown>>} operations
 * @param {string} message
 * @returns {Promise<never>}
 */
export async function rethrowAfterCleanup(primaryError, operations, message) {
  const results = await Promise.allSettled(
    operations.map((operation) => operation()),
  );
  const cleanupErrors = results.flatMap((result) =>
    result.status === "rejected" ? [result.reason] : [],
  );
  if (cleanupErrors.length > 0) {
    throw new AggregateError([primaryError, ...cleanupErrors], message, {
      cause: primaryError,
    });
  }
  throw primaryError;
}

/** @param {string} path */
export async function unlinkIfPresent(path) {
  try {
    await unlink(path);
  } catch (error) {
    if (!isNodeError(error) || error.code !== "ENOENT") throw error;
  }
}

/** @param {unknown} error */
function isNodeError(error) {
  return error instanceof Error && "code" in error;
}

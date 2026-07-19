import { link, mkdir, open, unlink } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";

import { parseJsonDocument } from "../content/load.mjs";
import {
  rethrowAfterCleanup,
  unlinkIfPresent,
} from "../filesystem-cleanup.mjs";
import {
  deletePrivateStoreFile,
  readPrivateStoreFile,
  replacePrivateStoreFile,
} from "../private-store.mjs";
import {
  PROFILE_FILE,
  defaultProfile,
  localOnlyProfile,
  validateProfile,
} from "./profile.mjs";

export const MAX_PROFILE_BYTES = 64 * 1024;

/**
 * @param {string | undefined} dataDir
 * @param {Date} [now]
 * @returns {Promise<{
 *   profile: import("./profile.mjs").LearnerProfile,
 *   source: "stored" | "default",
 *   reason: "ok" | "not-found" | "invalid-profile",
 *   needsOnboarding: boolean
 * }>}
 */
export async function loadProfile(dataDir, now = new Date()) {
  const fallback = () => ({
    profile: defaultProfile(now),
    source: /** @type {const} */ ("default"),
    reason: /** @type {const} */ ("invalid-profile"),
    needsOnboarding: true,
  });
  if (!dataDir) return fallback();
  try {
    const bytes = await readPrivateStoreFile(
      dataDir,
      PROFILE_FILE,
      MAX_PROFILE_BYTES,
      "Fairytail profile",
    );
    const profile = validateProfile(
      parseJsonDocument(bytes, "Fairytail profile"),
    );
    return {
      profile,
      source: "stored",
      reason: "ok",
      needsOnboarding: false,
    };
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return {
        profile: defaultProfile(now),
        source: "default",
        reason: "not-found",
        needsOnboarding: true,
      };
    }
    return fallback();
  }
}

/**
 * @param {string} dataDir
 * @param {unknown} profileValue
 */
export async function saveProfile(dataDir, profileValue) {
  const profile = validateProfile(profileValue);
  const path = profilePath(dataDir);
  await atomicPrivateJson(path, profile, {
    secureParent: true,
    replaceExisting: true,
  });
  return { ok: true, path, profile };
}

/**
 * @param {string} dataDir
 * @param {Date} [now]
 */
export async function resetProfile(dataDir, now = new Date()) {
  const loaded = await loadProfile(dataDir, now);
  const reset = localOnlyProfile(defaultProfile(now), now, {
    noAnalogy: false,
    presentation: "neutral",
  });
  await saveProfile(dataDir, reset);
  return {
    ok: true,
    priorSource: loaded.source,
    profile: reset,
  };
}

/** @param {string} dataDir */
export async function deleteProfile(dataDir) {
  const path = profilePath(dataDir);
  try {
    const deleted = await deletePrivateStoreFile(
      dataDir,
      PROFILE_FILE,
      "Fairytail profile",
    );
    return { ok: true, deleted, path };
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return { ok: true, deleted: false, path };
    }
    throw error;
  }
}

/**
 * @param {string} dataDir
 * @param {string} destination
 */
export async function exportProfile(dataDir, destination) {
  const loaded = await loadProfile(dataDir);
  if (loaded.source !== "stored") {
    throw new Error("No valid stored Fairytail profile to export");
  }
  const path = resolve(destination);
  if (path === profilePath(dataDir)) {
    throw new Error("Export destination must differ from the profile store");
  }
  await atomicPrivateJson(path, loaded.profile, {
    secureParent: false,
    replaceExisting: false,
  });
  return { ok: true, path };
}

/** @param {string} dataDir */
export function profilePath(dataDir) {
  if (typeof dataDir !== "string" || dataDir.trim().length === 0) {
    throw new TypeError("Fairytail data directory is required");
  }
  return resolve(dataDir, PROFILE_FILE);
}

/**
 * @param {string} path
 * @param {unknown} value
 * @param {{ secureParent: boolean, replaceExisting: boolean }} options
 */
async function atomicPrivateJson(path, value, options) {
  const parent = dirname(path);
  const body = `${JSON.stringify(value, null, 2)}\n`;
  if (Buffer.byteLength(body) > MAX_PROFILE_BYTES) {
    throw new Error("Fairytail profile exceeds the local size limit");
  }
  if (options.secureParent) {
    await replacePrivateStoreFile(
      parent,
      PROFILE_FILE,
      body,
      MAX_PROFILE_BYTES,
      "Fairytail profile",
    );
    return;
  }

  await mkdir(parent, { recursive: true });
  const temporary = join(parent, `.${PROFILE_FILE}.${randomUUID()}.tmp`);
  const handle = await open(temporary, "wx", 0o600);
  try {
    try {
      await handle.writeFile(body, "utf8");
      await handle.chmod(0o600);
      await handle.sync();
    } finally {
      await handle.close();
    }
    if (!options.replaceExisting) {
      await link(temporary, path);
      await unlink(temporary);
    } else {
      throw new Error("Export replacement is not supported");
    }
  } catch (error) {
    await rethrowAfterCleanup(
      error,
      [() => handle.close(), () => unlinkIfPresent(temporary)],
      "Fairytail profile write failed and cleanup was incomplete",
    );
  }
}

/** @param {unknown} error */
function isNodeError(error) {
  return error instanceof Error && "code" in error;
}

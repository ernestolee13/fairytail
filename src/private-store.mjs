import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, rename, unlink } from "node:fs/promises";
import { basename, join, resolve } from "node:path";

import { rethrowAfterCleanup, unlinkIfPresent } from "./filesystem-cleanup.mjs";

const READ_FLAGS =
  constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK;
const APPEND_FLAGS =
  constants.O_WRONLY |
  constants.O_APPEND |
  constants.O_CREAT |
  constants.O_NOFOLLOW |
  constants.O_NONBLOCK;
const EXCLUSIVE_WRITE_FLAGS =
  constants.O_WRONLY |
  constants.O_CREAT |
  constants.O_EXCL |
  constants.O_NOFOLLOW;

/**
 * Read one exact Fairytail store file without following its final path.
 *
 * @param {string} dataDir
 * @param {string} fileName
 * @param {number} maxBytes
 * @param {string} label
 */
export async function readPrivateStoreFile(dataDir, fileName, maxBytes, label) {
  const root = await existingPrivateStoreRoot(dataDir, label);
  const path = exactStorePath(root, fileName);
  await assertRegularTarget(path, label, false);
  const handle = await open(path, READ_FLAGS);
  try {
    const info = await handle.stat();
    assertPrivateFileInfo(info, maxBytes, label);
    return await handle.readFile();
  } finally {
    await handle.close();
  }
}

/**
 * Append one bounded line to an exact Fairytail-owned file. Existing caller
 * directories are validated but never chmodded.
 *
 * @param {string} dataDir
 * @param {string} fileName
 * @param {string | Buffer} value
 * @param {number} maxBytes
 * @param {string} label
 */
export async function appendPrivateStoreFile(
  dataDir,
  fileName,
  value,
  maxBytes,
  label,
) {
  const valueBytes = Buffer.byteLength(value);
  if (valueBytes > maxBytes) {
    throw new Error(`${label} exceeds its local size limit`);
  }
  const root = await ensurePrivateStoreRoot(dataDir, label);
  const path = exactStorePath(root, fileName);
  await assertRegularTarget(path, label, true);
  const handle = await open(path, APPEND_FLAGS, 0o600);
  try {
    const info = await handle.stat();
    assertPrivateFileInfo(info, maxBytes, label);
    if (info.size + valueBytes > maxBytes) {
      throw new Error(`${label} would exceed its local size limit`);
    }
    await handle.chmod(0o600);
    await handle.writeFile(value);
    await handle.sync();
  } finally {
    await handle.close();
  }
  return path;
}

/**
 * Atomically replace one exact Fairytail store file. A symlink, hard link, or
 * non-regular target is rejected before any target mutation.
 *
 * @param {string} dataDir
 * @param {string} fileName
 * @param {string | Buffer} value
 * @param {number} maxBytes
 * @param {string} label
 */
export async function replacePrivateStoreFile(
  dataDir,
  fileName,
  value,
  maxBytes,
  label,
) {
  if (Buffer.byteLength(value) > maxBytes) {
    throw new Error(`${label} exceeds its local size limit`);
  }
  const root = await ensurePrivateStoreRoot(dataDir, label);
  const path = exactStorePath(root, fileName);
  await assertRegularTarget(path, label, true);
  const temporary = join(root, `.${fileName}.${randomUUID()}.tmp`);
  const handle = await open(temporary, EXCLUSIVE_WRITE_FLAGS, 0o600);
  try {
    try {
      await handle.writeFile(value);
      await handle.chmod(0o600);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temporary, path);
  } catch (error) {
    await rethrowAfterCleanup(
      error,
      [() => handle.close(), () => unlinkIfPresent(temporary)],
      `${label} write failed and cleanup was incomplete`,
    );
  }
  return path;
}

/**
 * Delete one exact regular Fairytail store file without following links.
 *
 * @param {string} dataDir
 * @param {string} fileName
 * @param {string} label
 */
export async function deletePrivateStoreFile(dataDir, fileName, label) {
  const root = await existingPrivateStoreRoot(dataDir, label);
  const path = exactStorePath(root, fileName);
  const exists = await assertRegularTarget(path, label, true);
  if (!exists) return false;
  await unlink(path);
  return true;
}

/** @param {string} dataDir @param {string} label */
async function existingPrivateStoreRoot(dataDir, label) {
  const root = privateStoreRoot(dataDir);
  const info = await lstat(root);
  if (!info.isDirectory() || info.isSymbolicLink()) {
    throw new Error(`${label} directory is invalid`);
  }
  return root;
}

/** @param {string} dataDir @param {string} label */
async function ensurePrivateStoreRoot(dataDir, label) {
  const root = privateStoreRoot(dataDir);
  await mkdir(root, { recursive: true, mode: 0o700 });
  return existingPrivateStoreRoot(root, label);
}

/** @param {string} dataDir */
function privateStoreRoot(dataDir) {
  if (typeof dataDir !== "string" || dataDir.trim().length === 0) {
    throw new TypeError("Fairytail data directory is required");
  }
  return resolve(dataDir);
}

/** @param {string} root @param {string} fileName */
function exactStorePath(root, fileName) {
  if (
    typeof fileName !== "string" ||
    fileName.length === 0 ||
    basename(fileName) !== fileName
  ) {
    throw new TypeError("Fairytail store filename is invalid");
  }
  return join(root, fileName);
}

/**
 * @param {string} path
 * @param {string} label
 * @param {boolean} allowMissing
 */
async function assertRegularTarget(path, label, allowMissing) {
  try {
    const info = await lstat(path);
    assertPrivateFileInfo(info, Number.MAX_SAFE_INTEGER, label);
    return true;
  } catch (error) {
    if (allowMissing && isNodeError(error) && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

/** @param {import("node:fs").Stats} info @param {number} maxBytes @param {string} label */
function assertPrivateFileInfo(info, maxBytes, label) {
  if (
    !info.isFile() ||
    info.isSymbolicLink() ||
    info.nlink !== 1 ||
    info.size > maxBytes
  ) {
    throw new Error(`${label} file is invalid`);
  }
}

/** @param {unknown} error */
function isNodeError(error) {
  return error instanceof Error && "code" in error;
}

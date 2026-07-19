import { isAbsolute, resolve } from "node:path";

import { isInside } from "./inside.mjs";

export function resolveNotePath(root, relativePath) {
  if (
    typeof relativePath !== "string" ||
    relativePath.length === 0 ||
    relativePath.includes("\0") ||
    isAbsolute(relativePath)
  ) {
    throw new TypeError("relativePath must be a safe relative path");
  }

  const target = resolve(root, relativePath);
  if (!isInside(root, target)) {
    throw new RangeError("note path escapes root");
  }
  return target;
}

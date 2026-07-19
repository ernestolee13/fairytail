import { isAbsolute, resolve, sep } from "node:path";

export function resolveNotePath(root, relativePath) {
  if (
    typeof relativePath !== "string" ||
    relativePath.length === 0 ||
    relativePath.includes("\0") ||
    isAbsolute(relativePath)
  ) {
    throw new TypeError("relativePath must be a safe relative path");
  }

  const base = resolve(root);
  const target = resolve(base, relativePath);
  if (!target.startsWith(`${base}${sep}`)) {
    throw new RangeError("note path escapes root");
  }
  return target;
}

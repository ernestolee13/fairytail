import { resolve, sep } from "node:path";

export function isInside(root, candidate) {
  const base = resolve(root);
  return candidate.startsWith(`${base}${sep}`);
}

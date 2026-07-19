import { resolve } from "node:path";

export function resolveNotePath(root, relativePath) {
  return resolve(root, relativePath);
}

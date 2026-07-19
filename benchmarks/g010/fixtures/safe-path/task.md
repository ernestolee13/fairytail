# Safe note path task

Implement `resolveNotePath(root, relativePath)` in `src/note-path.mjs`.

Requirements:

- Return the normalized absolute path for a note below `root`.
- Reject empty, non-string, absolute, NUL-containing, and traversal inputs.
- Do not add a runtime dependency.
- Leave one runnable regression check if you add non-trivial logic.
- Make the smallest complete change; do not modify benchmark or scorer files.

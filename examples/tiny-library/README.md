# Tiny-library repair example

This is the frozen starting point used for the public Claude and Codex repair
samples.

```bash
npm run check
```

The check must initially fail with `200 !== 404`. Ask the coding host to make an
unknown book return `404 {"error":"book-not-found"}` while preserving the known
book path, then rerun the check. Copy the directory before each arm so every run
starts from the same defect.

The observed Fairytail and no-Fairytail results are documented in
[public install and sample results](../../docs/PUBLIC_INSTALL_AND_SAMPLES.md).

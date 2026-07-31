# Coding Standards Consolidate

Deterministically merge one mechanical scanner report with zero or more
semantic per-file reports.

## Usage

```bash
bun src/cli.ts \
  --scanner-json=/run/scanner.json \
  --files-json-dir=/run/files \
  --output=/run/coding-standards.json
```

## Invariants

- Validate every input with the shared coding-standards schema.
- Require every input `scope_digest` to equal the scanner digest.
- Merge findings without semantic reinterpretation.
- Reject conflicting content for one finding ID.
- Recompute severity counts, verdict, and blocking state.
- Copy the common digest to the output.
- Validate the final output before writing.

Any invalid JSON, schema mismatch, or divergent digest is a hard protocol
failure. An absent per-file directory is valid only when no semantic subject
file was dispatched.

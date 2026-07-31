# Coding Standards Schema

Shared TypeScript types, Zod validators, severity helpers, and stable finding ID
hashing for the coding-standards producer.

## Report contract

Every report contains:

```text
skill=coding-standards
scope_digest=<64 lowercase hex characters>
verdict
findings[]
summary
blocking
```

The digest identifies the single loop-clean scope manifest used by both the
mechanical and semantic passes. Consolidation fails when report digests differ.

## Stable finding IDs

```text
sha256([source, file, String(line_start ?? ""), axis, problem.slice(0, 80)].join("|")).slice(0, 16)
```

Keep this formula synchronized across scanner, semantic agent instructions, and
producer documentation.

## Public exports

Use `src/index.ts` for report types, schemas, parsing, validation, summary
computation, blocking computation, and ID hashing. All boundary readers must
validate before consuming report fields.

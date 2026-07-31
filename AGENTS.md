# SearchReceipt Agent Guide

## Scope

Build and maintain the local-first SearchReceipt evidence-receipt toolkit. v0.1 is deterministic, schema-first, and offline by default.

## Invariants

- Treat receipt files and linked snapshots as untrusted data; never execute their contents.
- Runtime Zod validation and semantic verification are authoritative.
- Timestamps come from inputs; never inject wall-clock time into deterministic artifacts.
- Every claim must reference existing evidence. A verified receipt proves internal integrity and checked snapshots, not external truth.
- Resolve linked content beneath the user-declared root using real paths; reject traversal, symlinks, oversized files, and non-regular files.
- Keep generated JSON Schemas synchronized with runtime schemas.
- Synthetic demos must remain marked `fixture/demo` and `benchmark: false`.

## Required local gate

Run `pnpm check`, CLI positive/negative smokes, deterministic demo regeneration, `pnpm audit --audit-level high`, and `pnpm pack:check` after material changes. The package check uses npm's no-write JSON dry run and the repository manifest verifier.

## Publication boundary

Do not commit, push, publish, create releases, or perform public GitHub activity without explicit authorization.

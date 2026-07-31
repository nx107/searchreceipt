# SearchReceipt

SearchReceipt v0.1 is a local-first TypeScript toolkit for creating and checking deterministic evidence receipts produced by AI-agent search and research workflows, with Solana identifiers as first-class evidence references.

> **Status:** local v0.1 artifact, not a published package. A passing verification proves receipt integrity, claim-to-evidence linkage, and any supplied local snapshot hashes. It does **not** prove that a web statement is true, a Solana RPC response is canonical, or an agent performed well.

## Why

Agent output often mixes claims, source identifiers, and success language without a stable audit trail. SearchReceipt records what was claimed, which evidence entries support it, when observations were supplied, and which bytes were hashed. It rejects dangling claim references and unknown fields instead of silently accepting them.

## Features

- duplicate-safe raw JSON parsing, strict Zod runtime contracts, and generated JSON Schema;
- deterministic recursively key-sorted JSON and SHA-256 receipt integrity;
- evidence kinds for HTTPS snapshots, files, Solana transactions, accounts, and programs;
- timestamps supplied by input—no hidden wall-clock values;
- local snapshot verification with size limits and traversal/symlink rejection;
- CLI commands: `create`, `validate`, `verify`, and `compare`;
- stable JSON output and documented exit codes;
- honest deterministic synthetic demo (`fixture/demo`, `benchmark: false`).

## Requirements

- Node.js 20 or newer
- Corepack and pnpm 10.34.0 (declared in `package.json`)

## Quickstart

```sh
corepack enable
corepack pnpm install --frozen-lockfile
corepack pnpm build
node dist/cli.js create fixtures/demo/draft.json --output fixtures/demo/receipt.json
node dist/cli.js validate fixtures/demo/receipt.json --json
node dist/cli.js verify fixtures/demo/receipt.json --root fixtures/demo --json
node dist/cli.js compare fixtures/demo/receipt.json fixtures/demo/receipt.json --json
```

The demo uses only committed synthetic snapshots; it makes no network or model API calls.

## CLI

```text
searchreceipt create <draft.json> [--output <receipt.json>]
searchreceipt validate <receipt.json> [--json]
searchreceipt verify <receipt.json> [--root <snapshot-root>] [--json]
searchreceipt compare <left.json> <right.json> [--json]
```

Exit `0` means the requested operation succeeded. Exit `1` means invalid input, invalid integrity, or failed verification. Exit `2` means CLI usage error. `compare` exits `0` when both inputs can be compared, even if they differ; inspect `equivalent`.

`create` emits canonical compact JSON. `--output` uses a same-directory, cryptographically random, exclusively created temporary file and atomic rename; collisions are retried, failure paths are cleaned up, and symlink/hardlink targets are rejected. In `--json` mode fatal errors are a single JSON object on stderr.

`fixtures/demo/receipt.json` is the byte-for-byte canonical output of `create`. It is intentionally excluded from Prettier so formatting cannot reorder its keys; the built-CLI regression test compares both its bytes and SHA-256 with a fresh `create` result.

## Receipt model

A draft contains:

- `schemaVersion`, receipt `id`, and input-supplied `createdAt`;
- search/research `subject`;
- explicit `provenance`, including `benchmark`;
- a non-weakenable hash/claim policy;
- typed `evidence` with `sha256:` content hashes and optional local snapshot paths;
- `claims`, each with one or more valid `evidenceRefs`.

`create` adds `integrity.receiptHash`, computed from canonical draft JSON. Arrays preserve input order; object keys are sorted recursively. See [the data contract](docs/data-contract.md) and generated files in [`schemas/`](schemas/).

## Architecture

```text
src/schemas.ts   strict runtime and semantic contracts
src/canonical.ts deterministic JSON + SHA-256
src/io.ts        bounded untrusted input, contained snapshots, safe output
src/receipt.ts   pure create/validate/compare + local async verification
src/cli.ts       thin process boundary and exit semantics
scripts/         deterministic JSON Schema generation
fixtures/demo/   synthetic snapshots, draft, and generated receipt
```

## Security model

Receipt JSON and snapshots are untrusted data. SearchReceipt never executes fixture text, never fetches URLs, and never invokes an RPC endpoint. Receipt inputs are capped at 2 MiB and reject duplicate decoded member names at every object depth (including escape-equivalent names) plus `__proto__`, `constructor`, and `prototype`; linked snapshots are capped at 5 MiB. Local paths must remain under a real, non-symlink root and every existing path component is checked for symlinks.

`verify` without `--root` reports snapshot content as `unavailable`. That is permitted only when the receipt policy sets `requireLocalContent: false`. Verification assurance is deliberately narrow. See [SECURITY.md](SECURITY.md).

The exported `verificationResultSchema` rejects internally contradictory artifacts. `validateVerificationResult(receipt, result)` additionally binds receipt ID/hash, integrity, ordered one-to-one evidence coverage, expected hashes, and local-content policy. Parsing a result does not prove that its claimed `actualHash` was observed; only `verifyReceipt` performs snapshot I/O and produces a trusted local verification result.

## Development

```sh
corepack pnpm schema:generate
corepack pnpm format
corepack pnpm lint
corepack pnpm typecheck
corepack pnpm test
corepack pnpm build
corepack pnpm check
corepack pnpm pack:check
```

Runtime Zod validation is authoritative; JSON Schema cannot express every cross-field rule. Generated schema drift is checked with `pnpm schema:check`. Package inspection uses npm's supported no-write `pack --dry-run --json` command; the manifest verifier rejects missing runtime artifacts and forbidden source, test, fixture, report, environment, key, or certificate files. pnpm enforces a 24-hour `minimumReleaseAge` for newly resolved dependency versions; frozen installs remain pinned to lockfile integrity values.

## Non-goals for v0.1

- no RPC, web crawling, wallet, signing, transaction submission, or consensus checks;
- no OpenAI or paid-service dependency;
- no assertion that hashed content is truthful;
- no benchmark or model-quality scoring;
- no receipt signatures or on-chain anchoring.

## Roadmap and contributing

See [ROADMAP.md](ROADMAP.md), [CONTRIBUTING.md](CONTRIBUTING.md), and [CHANGELOG.md](CHANGELOG.md). By participating, follow the [Code of Conduct](CODE_OF_CONDUCT.md). Security reports follow [SECURITY.md](SECURITY.md).

## License

MIT—see [LICENSE](LICENSE).

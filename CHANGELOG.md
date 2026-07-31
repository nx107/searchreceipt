# Changelog

All notable project changes are documented here. This project follows Keep a Changelog; no package has been publicly released.

## [Unreleased]

### Added

- SearchReceipt v0.1 strict draft, receipt, evidence, and verification schemas.
- Deterministic canonical JSON and SHA-256 receipt integrity.
- Solana transaction, account, and program evidence references.
- Local snapshot verification with traversal, symlink, size, and output protections.
- `create`, `validate`, `verify`, and `compare` CLI commands.
- Generated JSON Schemas, tests, synthetic demo, documentation, governance, and SHA-pinned CI.

### Fixed

- Keep the stored demo receipt byte-identical to canonical CLI output across formatting and test runs, with a byte/hash regression.
- Inspect package contents in CI with supported `npm pack --dry-run --json` output and reject incomplete or unsafe manifests.
- Reject duplicate decoded JSON member names at every depth before native parsing, including escape-equivalent and prototype-sensitive names.
- Reject forged or contradictory verification results and expose receipt-aware result validation for identity, integrity, evidence coverage, hashes, and policy.
- Allocate atomic-output temporary files with cryptographic random names, exclusive creation, bounded collision retries, and cleanup on failure.

### Security

- Claims require evidence references; fixture demos cannot claim benchmark status.
- Verification output states its narrow assurance boundary.
- Pin pnpm 10.34.0 and enforce a 24-hour dependency `minimumReleaseAge`; frozen lockfile installs remain reproducible.

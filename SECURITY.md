# Security Policy

## Supported versions

v0.1 is a pre-publication local milestone. Until a later version is released, only the current `main` working tree is considered for security fixes.

## Reporting

Do not place vulnerabilities, secrets, wallet material, or exploit fixtures in a public issue. Before public hosting, report privately to the maintainer who shared this source. After GitHub hosting is approved, use the repository's **Security → Report a vulnerability** private-advisory flow. A maintainer should acknowledge a report within 7 days and provide triage status within 14 days.

## Boundaries

SearchReceipt parses untrusted JSON and reads optional local snapshots. It does not execute receipt content, access wallets, call RPC endpoints, or fetch web URLs. Important controls include decoded duplicate/prototype-key rejection before native parsing, strict runtime schemas, 2 MiB receipt limits, 5 MiB snapshot limits, real-path containment, symlink rejection, hardlink/symlink output refusal, and random exclusive same-directory atomic output with cleanup.

Verification proves internal hash/linkage properties only. It does not prove source truth, Solana finality, account ownership, program authenticity, or timestamp accuracy. Treat receipt producers and snapshot acquisition as separate trust boundaries.

Generated JSON Schema is interoperability-only for refinements it cannot express. Use the exported Zod schema for standalone result consistency, `validateVerificationResult` for receipt-aware compatibility, and `verifyReceipt` when local snapshot bytes must actually be read and hashed.

## Dependency response

High or critical advisories affecting reachable development, runtime tooling, or the pinned package manager block publication. Apply the narrowest compatible fix, refresh the lockfile, then repeat a frozen install and the complete quality gate. A 24-hour `minimumReleaseAge` applies when resolving new package versions; frozen installs remain lockfile-pinned.

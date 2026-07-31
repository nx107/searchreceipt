# Contributing

SearchReceipt welcomes focused changes that preserve its evidence and honesty boundaries.

1. Open or describe a narrowly scoped change. For security issues, use `SECURITY.md` instead.
2. Use Node.js 20+ and the package-manager version declared in `package.json`.
3. Install with `corepack pnpm install --frozen-lockfile`.
4. Add tests for positive and negative behavior. Never add live secrets, wallet material, or private RPC URLs to fixtures.
5. If runtime schemas change, run `pnpm schema:generate` and update the data contract and changelog.
6. Run `pnpm check`, `pnpm schema:check`, `pnpm audit --audit-level high`, the CLI smokes, and `pnpm pack:check`. The last command uses npm's no-write `pack --dry-run --json` manifest and the repository verifier.
7. Submit a PR explaining the assurance impact and generated-file changes.

Commits should be small and descriptive. DCO/sign-off is not required in v0.1. Contributions are licensed under MIT.

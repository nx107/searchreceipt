## Summary

<!-- Explain the focused change and why it is needed. -->

## Evidence and assurance impact

- [ ] I described what this change proves and does not prove.
- [ ] I did not add secrets, wallet material, private RPC URLs, or real user data.
- [ ] Synthetic data remains labeled `fixture/demo` and `benchmark: false`.

## Verification

- [ ] `pnpm schema:check`
- [ ] `pnpm check`
- [ ] CLI positive and negative smokes
- [ ] `pnpm audit --audit-level high`
- [ ] `pnpm pack --dry-run`

## Schema/documentation

- [ ] Runtime schemas, generated schemas, data contract, tests, and changelog are synchronized, or this change does not affect them.

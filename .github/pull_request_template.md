## Approved issue

Closes #<!-- approved issue number -->

- [ ] The linked issue has `status:approved`.
- [ ] This PR targets `develop` unless it is a maintainer release/hotfix PR.
- [ ] This PR has exactly one `type:*` label.

## Summary

- 
- 

## Checks run

Required/stable PR checks are intentionally lightweight and production-build-free:

- [ ] `frontend-install` passed (dependency installation validation).
- [ ] `rust-check` passed (`cargo fmt --check` and `cargo check`).
- [ ] Not applicable locally; docs/templates only.

Manual/experimental full checks are available for maintainer-requested validation and current debt tracking:

- `frontend-full-experimental` (`npm test`, `npm run build:types`).
- `rust-full-experimental` (`cargo clippy --workspace --all-targets -- -D warnings`, `cargo test --workspace`).

Do not mark the experimental full checks as required for this PR unless a maintainer explicitly asks.

## Documentation and provenance

- [ ] Documentation was updated or no docs change is needed.
- [ ] Data provenance was updated or no provenance change is needed.
- [ ] No unclear third-party data, generated cache, secret, signing key, or private credential is included.

## Release impact

- [ ] Changelog entry added or not needed.
- [ ] Version changes are synchronized across `package.json`, `src-tauri/Cargo.toml`, and `src-tauri/tauri.conf.json` when applicable.

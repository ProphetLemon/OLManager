# Open League Manager — Documentation Index

This directory contains the technical and governance documentation for Open League Manager, a desktop management simulation built with Tauri (Rust) and React (TypeScript).

---

## Documents

### [STATUS.md](STATUS.md)

Current project health overview. Tech stack versions, what's working/broken, technical debt, risks, roadmap, and contributor quick-start.

### [ARCHITECTURE.md](ARCHITECTURE.md)

Contributor-facing architecture map. Explains the React/Tauri boundary, frontend structure, Rust workspace crates, persistence model, testing approach, dependency direction, and how to add features without breaking architectural boundaries.

### [CONTRIBUTING.md](CONTRIBUTING.md)

Open-source governance model. Documents `main` as stable/release-only, `development` as integration, feature branches from `development`, issue-first review gates, labels, protected branch settings, release promotion, and hotfix back-merges.

### [DATA_PROVENANCE.md](DATA_PROVENANCE.md)

Provenance policy for inherited OpenFootManager assets and external data sources such as Leaguepedia. Defines required source URL, terms, attribution, extraction date, redistribution permission, and generated/cache status records.

### [STAT_RATINGS.md](STAT_RATINGS.md)

How player ratings are derived from Leaguepedia pro stats: method, results, known limits, the refresh procedure and rate-limit findings.

### [RELEASE_PROCESS.md](RELEASE_PROCESS.md)

Maintainer release workflow. Covers release PRs from `development` to `main`, version sync across `package.json`, `src-tauri/Cargo.toml`, and `tauri.conf.json`, tags, source artifacts, checksums, and unsigned/signing status rules.

### [INHERITED_DOCS_AUDIT.md](INHERITED_DOCS_AUDIT.md)

Disposition record for inherited OpenFootManager documentation. Explains which stale docs were removed, which technical references were moved under `legacy/`, and why they should not be treated as current public OLManager docs.

---

## Legacy / reference-only documents

The `legacy/` directory contains inherited or historical material kept for archaeology. These documents may be stale and are not authoritative for current OLManager behavior.

- [`legacy/simulation.rst`](legacy/simulation.rst) — original historical simulation-design article.
- [`legacy/inherited-docs/`](legacy/inherited-docs/) — preserved inherited OpenFootManager docs such as old game-system, match-simulation, save-system, definitions, getting-started, and performance notes.

---

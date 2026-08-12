# Roadmap

The project is deliberately staged around real maintainer feedback rather than feature count.

## 0.1 — Evidence protocol

- [x] configurable repository checks;
- [x] local link and explicit command verification;
- [x] inventory and lightweight impact graph;
- [x] Markdown, JSON, SARIF, MCP, and proof bundles;
- [x] safe-by-default optional model explanation.

## 0.2 — Reproducibility hardening

- [x] stable check IDs and baseline comparison between two reports;
- [x] dependency-manifest and lockfile inventory across common ecosystems;
- [x] optional GitHub Actions commit-SHA pinning signal;
- [x] self-contained HTML dashboard and deterministic remediation plan;
- [x] report and plan contract validation with published schemas;
- [ ] process-group cleanup and platform-specific timeout tests;
- [ ] reproducible fixture checkout runner with configurable network denial;
- [ ] GitHub artifact upload example with no write token.

## 0.3 — Change review evidence

- [x] bounded Git diff parser;
- [x] changed-file risk factors and test-evidence gaps;
- [x] redacted credential-like and merge-conflict signals;
- [x] review packet CLI, MCP, SARIF, HTML, and proof outputs;
- [ ] language-aware semantic diff adapters;
- [ ] review calibration against a public fixture corpus.

## 0.3 — Language and ecosystem adapters

- [ ] AST-backed JavaScript/TypeScript adapter;
- [ ] Python import and test discovery adapter;
- [ ] Rust Cargo target and workspace adapter;
- [ ] Go module and package-test adapter;
- [ ] plugin contract with versioned evidence namespaces.

## 0.4 — Maintainer operations

- [x] configurable deterministic merge gate with policy-driven exit codes and evidence;
- [ ] issue intake evidence packet;
- [ ] release-readiness report from merged changes;
- [ ] opt-in GitHub Checks annotations;
- [ ] historical report store with privacy-preserving aggregate metrics;
- [ ] evaluation corpus of false-positive and false-negative cases.

## Non-goals

- automatic merging or release publishing;
- pretending an LLM review is a security audit;
- collecting repository contents by default;
- manufacturing popularity metrics or maintainer credentials.

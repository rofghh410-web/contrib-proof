# Roadmap

The project is deliberately staged around real maintainer feedback rather than feature count.

## 0.10 — Maintainer operations

- [x] offline issue-intake evidence packets from local issue forms and structured payloads;
- [x] monorepo fixture case selection with requested/selected provenance;
- [x] preview-only and explicit-apply history retention policies with corruption refusal;
- [x] CLI, MCP, Action fixture selection, schema, documentation, and regression integration;
- [ ] isolated fixture checkout runner with configurable network denial;
- [ ] signed ledger attestations with a ledger-specific trust root;
- [ ] issue packet calibration against accepted and rejected fixture cases.

## 0.9 — Trust-boundary evidence

- [x] Ed25519 proof attestations with explicit maintainer key fingerprints;
- [x] detached attestation verification with optional proof-manifest subject matching;
- [x] CLI, schema, documentation, Action, and regression-test integration;
- [x] bounded streaming output for configured commands;
- [x] Unix process-group timeout cleanup with SIGTERM/SIGKILL escalation;
- [ ] signed ledger attestations with an explicit ledger-specific trust root;
- [ ] key rotation and revocation metadata for long-lived CI installations.

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
- [x] release-readiness report from merged changes;
- [x] historical report store with privacy-preserving aggregate metrics;
- [ ] evaluation corpus of false-positive and false-negative cases.

## 0.5 — CI feedback

- [x] opt-in GitHub Checks annotations with escaped, bounded workflow commands;
- [x] release-readiness report from merged changes;
- [x] historical report store with privacy-preserving aggregate metrics;
- [ ] evaluation corpus of false-positive and false-negative cases.

## 0.6 — Release evidence

- [x] release-readiness CLI, MCP, Action, SARIF, HTML, and proof-bundle outputs;
- [x] version, changelog, test-signal, documentation-signal, and high-risk review checks;
- [x] privacy-preserving JSONL history records and trend summaries;
- [x] nested report validation and published release schema;
- [ ] fixture corpus for release regressions and accepted exceptions;
- [ ] issue-intake evidence packet.

## 0.7 — Maintainer control plane

- [x] deterministic baseline regression budgets with JSON/Markdown decisions;
- [x] exact, time-bounded policy exceptions with audit-preserving skips;
- [x] tamper-evident summary ledger with path confinement and append refusal;
- [x] read-only doctor diagnostics for runtime and checkout failures;
- [x] CLI, Action, MCP, HTML, proof, validation, schema, and test integration;
- [ ] signed ledger attestations with an explicit maintainer trust root;
- [ ] baseline retention and fixture selection policies for monorepos;
- [ ] issue-intake evidence packet.

## 0.8 — Reproducible evidence

- [x] shared verification engine for CLI and MCP report construction;
- [x] execution-context provenance for runtime, Git checkout, configuration, and effective options;
- [x] offline proof-bundle verification with hash and path-confinement checks;
- [x] declarative fixture manifests with status and stable check-ID assertions;
- [x] fixture/proof/context schemas, validators, Action integration, MCP integration, and regression tests;
- [ ] signed attestations with an explicit maintainer trust root;
- [ ] isolated fixture checkout runner with configurable network denial;
- [ ] monorepo fixture selection and baseline retention policies.

## Non-goals

- automatic merging or release publishing;
- pretending an LLM review is a security audit;
- collecting repository contents by default;
- manufacturing popularity metrics or maintainer credentials.

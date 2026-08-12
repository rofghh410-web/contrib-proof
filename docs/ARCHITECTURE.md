# Architecture

ContribProof is organized around a one-way evidence pipeline. The important design choice is that each stage produces data for the next stage; later presentation layers do not silently re-run or reinterpret the repository. The 0.3 line adds a change-review packet, the 0.4 line adds a deterministic merge gate, the 0.6 line adds release-readiness and privacy-preserving maintenance history, and the 0.7 line adds a maintainer control plane for regression budgets, expiring exceptions, ledger integrity, and runtime diagnosis.

## Pipeline

### 1. Inventory

`src/inventory.js` walks a bounded set of repository files while skipping generated, vendored, and dependency directories. It records relative paths, sizes, language extensions, selected file hashes, package scripts, Markdown paths, workflow permission signals, and recognized dependency manifests with neighboring lockfiles.

The inventory is descriptive, not evaluative. A repository can contain no JavaScript and still be healthy; the inventory only tells policy and graph adapters what evidence is available.

### 2. Evidence graph

`src/graph.js` extracts conservative symbol and import signals for common languages. It does not claim to be a compiler or a complete dependency graph. Edges are labelled as heuristic `imports` edges, and the report records how many edges and symbols were considered.

This makes the limitations visible while still answering useful questions such as:

- which files may depend on a changed module;
- which test files look related to a changed source file;
- whether a change has any visible test signal.

Language adapters can later replace the heuristic extractor with AST-backed implementations without changing the report protocol.

### 3. Policy engine

`src/checks.js` and `src/policies.js` produce normalized checks:

```json
{
  "id": "changes:tests",
  "category": "change-policy",
  "status": "warn",
  "severity": "warning",
  "message": "Source changed without a test-file change.",
  "evidence": [{ "path": "src/feature.js" }]
}
```

The policy engine is intentionally conservative. Missing evidence becomes a warning when a human may reasonably know an exception; structural failures such as a missing configured file or broken local link become errors.

### 4. Change review

`src/review.js` parses a zero-context Git diff without invoking a shell. It summarizes additions and deletions, classifies changed paths, follows the existing heuristic graph to find impacted files and test candidates, and scans only added lines for credential-like values and merge-conflict markers. Values are redacted before they enter a packet. The score is a bounded triage signal; it is not a correctness or security verdict.

### 5. Merge gate

`src/gate.js` evaluates the existing report and review packet against `gatePolicy`. It does not inspect files a second time, reinterpret model output, or mutate checks. A gate result records the effective policy, summary counters, blocking violations, and relative evidence paths. This gives CI a stable exit-code contract while keeping `review` useful as a non-blocking analysis command.

### 6. Release readiness and history

`src/release.js` consumes the same bounded Git and review evidence to answer a narrower maintainer question: is this repository state ready to become a named release? It checks the selected commit range, semantic version metadata, changelog coverage, test and documentation signals, and unresolved high-risk review findings. It never creates tags, publishes assets, or executes additional commands.

`src/history.js` stores one JSON object per run, deliberately retaining only status, score, counts, gate/review/release summaries, timestamps, and proof identity. It does not copy source contents, command output, or finding messages. The append-only format is easy to inspect, commit, or upload as a CI artifact while keeping the privacy boundary explicit.

`src/ledger.js` provides the stronger integrity variant for teams that need an ordered maintenance record. Each JSONL entry is a canonical summary payload with a `previousHash` and an `entryHash`; verification stops at the first malformed, reordered, or tampered line. The ledger is an integrity chain, not an identity system or digital signature.

`src/baseline.js` evaluates two already-generated reports against an explicit regression budget. It never reruns repository checks and cannot silently reinterpret a check: stable check IDs and the existing status rank are the comparison boundary.

`src/exceptions.js` treats suppressions as policy data rather than a command-line escape hatch. An exception must target one exact check ID and have a future expiry. When enabled, the finding becomes `skip` while its `originalStatus`, reason, owner, and expiry remain in the report; malformed or expired policy produces a blocking check.

`src/doctor.js` diagnoses the execution environment separately from repository health. It uses Git metadata, config parsing, and PATH inspection, but does not run configured project commands.

### 7. Controlled runner

Configured commands are represented as `{ run, args }`, never as a shell expression. The current runner uses `shell: false`, bounded output, a timeout, and a reduced environment. The next hardening step is a platform-specific process-group wrapper and an optional container/VM adapter for projects that need stronger isolation.

### 8. Triage and contracts

`src/plan.js` turns non-passing checks into a deterministic maintainer queue. It adds priority, rough effort, likely owner, and the original evidence without changing the verification result. `src/validate.js` checks the stable fields that downstream consumers can rely on; the companion JSON Schema files document the same public shape for tools that already support JSON Schema.

### 9. Proof identity

`src/proof.js` canonicalizes JSON with sorted object keys and computes SHA-256 hashes for the report and small evidence files. A proof bundle is useful when a maintainer wants to say “this decision was based on exactly these inputs” without uploading the repository.

The hash is an integrity aid, not a digital signature. ContribProof does not currently provide key management or a trust root.

### 10. Shared verification and fixture contracts

`src/engine.js` owns the report pipeline used by both the CLI and MCP server: configuration, inventory, checks, optional diff/review/release evidence, exceptions, context, plans, and gates are assembled in one place. This prevents an interface-specific path from silently drifting away from the public report contract.

`src/context.js` records the execution boundary that produced a report. It includes runtime identity, exact Git-root metadata, dirty/shallow state, configuration digest, and effective options. These fields are diagnostic evidence; they do not make an untrusted checkout trusted.

`src/fixtures.js` runs declarative fixture manifests against repository-relative roots. A case asserts a status and stable check-ID constraints rather than copying an entire expected report. CLI runs may opt into configured commands; MCP runs force commands off. This gives projects a compact regression corpus while preserving the MCP read-only boundary.

`src/proof.js` now verifies its own output through `proof-verify`. Verification validates the report, confines every manifest path to the selected repository root, recalculates file byte counts and hashes, and compares the canonical report/evidence/bundle identities.

### 11. Interfaces

- CLI: local developer workflow and scripting.
- GitHub composite action: read-only CI integration.
- Markdown/JSON/SARIF/HTML: human, automation, security-tool, and offline sharing consumers.
- Review JSON/Markdown: focused PR evidence for maintainers and coding agents.
- Gate JSON/Markdown: deterministic CI decision with policy and blocking evidence.
- Release JSON/Markdown: release checklist with Git-range, metadata, test, documentation, and review evidence.
- History JSONL/Markdown: privacy-preserving maintenance trend records and summaries.
- Baseline JSON/Markdown: deterministic regression-budget decisions between two valid reports.
- Policy exception JSON: explicit, expiring suppressions that remain auditable in reports.
- Maintenance ledger JSONL: chained aggregate summaries with read-only integrity verification.
- Doctor JSON/Markdown: runtime and checkout diagnostics without project-command execution.
- Execution-context fields: runtime, Git, configuration, and effective-option provenance inside every verification report.
- Fixture manifest/suite JSON: declarative status and check-ID regression contracts.
- Proof verification JSON/Markdown: offline integrity verification of a proof bundle and its evidence files.
- GitHub workflow annotations: an opt-in, escaped presentation of report findings for Checks.
- MCP stdio server: read-only context for coding agents.
- OpenAI adapter: explicit, advisory explanation of an existing report.

## Report compatibility

The top-level `schemaVersion` is incremented only for incompatible changes. New optional fields should be added without changing existing check IDs or status meanings. Any public schema change requires a fixture, a changelog entry, and an example in the README. `validate` is intentionally not a general JSON Schema engine: repository-specific extensions are allowed, while malformed core fields are rejected.

## Extension points

Future adapters should implement one narrow interface:

```text
discover(root) -> inventory additions
analyze(root, inventory, changedFiles) -> evidence additions
render(report) -> presentation
```

Adapters must not write to the repository by default, must keep evidence paths relative, and must state their confidence and limitations.

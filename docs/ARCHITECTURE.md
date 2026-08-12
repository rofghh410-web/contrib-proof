# Architecture

ContribProof is organized around a one-way evidence pipeline. The important design choice is that each stage produces data for the next stage; later presentation layers do not silently re-run or reinterpret the repository. The 0.3 line adds a change-review packet, and the 0.4 line adds a deterministic merge gate that consumes that evidence without delegating the decision to a model.

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

### 6. Controlled runner

Configured commands are represented as `{ run, args }`, never as a shell expression. The current runner uses `shell: false`, bounded output, a timeout, and a reduced environment. The next hardening step is a platform-specific process-group wrapper and an optional container/VM adapter for projects that need stronger isolation.

### 7. Triage and contracts

`src/plan.js` turns non-passing checks into a deterministic maintainer queue. It adds priority, rough effort, likely owner, and the original evidence without changing the verification result. `src/validate.js` checks the stable fields that downstream consumers can rely on; the companion JSON Schema files document the same public shape for tools that already support JSON Schema.

### 8. Proof identity

`src/proof.js` canonicalizes JSON with sorted object keys and computes SHA-256 hashes for the report and small evidence files. A proof bundle is useful when a maintainer wants to say “this decision was based on exactly these inputs” without uploading the repository.

The hash is an integrity aid, not a digital signature. ContribProof does not currently provide key management or a trust root.

### 9. Interfaces

- CLI: local developer workflow and scripting.
- GitHub composite action: read-only CI integration.
- Markdown/JSON/SARIF/HTML: human, automation, security-tool, and offline sharing consumers.
- Review JSON/Markdown: focused PR evidence for maintainers and coding agents.
- Gate JSON/Markdown: deterministic CI decision with policy and blocking evidence.
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

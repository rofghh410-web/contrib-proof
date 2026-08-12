# Security model

ContribProof is designed for repositories that may contain untrusted pull-request text and code. It is a maintenance evidence tool, not a general-purpose code execution sandbox.

## Assets

- maintainer credentials and environment variables;
- private repository source and issue context;
- GitHub token permissions;
- integrity of generated reports;
- user trust in what a “pass” or “warning” actually means.

## Trust boundaries

| Boundary | Default behavior |
| --- | --- |
| Repository files | Read-only; treated as data, including Markdown and fixture text |
| Configured commands | Not executed unless `--execute` is explicit |
| Command invocation | Argument array, `shell: false`, timeout, bounded output |
| Environment | Safe allowlist; common tokens and API keys are not copied |
| Network | Core makes no network requests |
| GitHub workflow | Example requests `contents: read` only |
| Dependency and action inventory | Read-only local signals; no registry resolution or workflow execution |
| HTML report | Escaped, self-contained output; no external scripts or remote requests |
| MCP | Six read-only tools; no arbitrary shell or write tool |
| Merge gate | Consumes deterministic report data; no model approval path and no repository mutation |
| OpenAI adapter | Opt-in; sends a redacted report only |
| Model output | Advisory; cannot alter deterministic status or files |

## Important limitations

1. `shell: false` prevents shell parsing, but a configured executable can still be dangerous. Only run trusted configurations in a trusted checkout.
2. A local process is not a complete sandbox. Use a container, VM, or hardened runner for hostile code.
3. Filename checks are not secret scanning. Do not rely on them to detect credentials.
4. Import graphs are heuristic and can miss dynamic imports, generated code, macros, aliases, and language-specific resolution.
5. Hashes show content identity; they do not prove who produced a report.
6. Lockfile presence does not prove dependency safety or freshness; it only records a reproducibility signal.
7. The change-review detector only scans added diff lines and uses conservative patterns; it can miss encoded or split secrets and can produce false positives.
8. The optional model explanation can be wrong. It must never be used as the sole security decision.

## PR workflow guidance

The safe deployment shape is:

1. checkout and inventory in a read-only job;
2. execute only trusted, explicitly configured checks;
3. send a redacted report to an optional provider only after a human or repository policy opts in;
4. publish a report or artifact in a separate trusted job if the project needs write access.

Never execute untrusted fork code in a `pull_request_target` job that has write permissions. Keep comments, labels, merges, and releases out of the default action.

## Responsible disclosure

If a new feature changes command execution, report redaction, MCP exposure, GitHub permissions, or provider data flow, treat it as a security-sensitive change. Add a threat-model note, a regression test, and a changelog entry.

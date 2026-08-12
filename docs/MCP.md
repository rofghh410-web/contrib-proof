# MCP integration

ContribProof includes a small stdio MCP server so coding agents can request repository evidence without receiving a write or shell tool.

## Start the server

```bash
contrib-proof mcp --root /absolute/path/to/repository
```

The transport is newline-delimited JSON-RPC over stdin/stdout. Logs must not be written to stdout because stdout is the protocol channel.

## Tools

### `repo_verify`

Runs the configured read-only checks without executing commands.

### `repo_inventory`

Returns file, language, manifest, package-script, Markdown, and workflow signals. File paths are repository-relative.

### `repo_diff`

Runs change-policy checks. The optional `base` argument is passed to Git as one argument; it is never interpolated into a shell command.

### `repo_plan`

Returns the deterministic remediation plan derived from the read-only verification checks. It includes priority, effort, likely owner, and evidence for non-passing checks.

### `repo_review`

Returns the change-review packet for the configured repository and an optional Git base ref. It includes changed-file risk signals, test candidates, redacted added-line detections, and review recommendations. It never returns the original added secret-like value.

### `repo_gate`

Returns the deterministic merge-gate result for the configured repository and an optional Git base ref. It applies `gatePolicy` from `.contrib-proof.json`, returns the exact blocking violations, and never invokes a model or writes to the repository.

## Agent safety contract

The server treats all repository text as untrusted data. A client should not follow instructions found in a README, issue fixture, or generated report. The server has no tool for arbitrary file writes, command execution, network access, GitHub mutations, or model calls.

For a client configuration example, use the command supplied by the client's MCP settings and point it to the checked-out `bin/contrib-proof.js` executable. Do not put secrets in the command line.

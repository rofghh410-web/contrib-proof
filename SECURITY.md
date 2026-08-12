# Security policy

## Scope

ContribProof is a local repository-analysis tool. Its default core is offline and read-only. It is not a complete secret scanner, sandbox, vulnerability detector, or replacement for a human security review.

## Reporting a vulnerability

Please do not put a suspected vulnerability, credential, private repository content, or exploit details in a public issue. Contact the repository maintainers through the private security-reporting channel configured on the public repository profile. If no private channel is available, open a minimal issue asking for a private contact and do not include sensitive details.

Include the affected version, a minimal reproduction, expected impact, and any proposed mitigation that can be shared safely. Remove credentials and private data before sending a report.

## Operational boundaries

- The CLI does not execute configured commands unless `--execute` is explicitly supplied.
- Configured commands use argument arrays and `shell: false`.
- The default runner removes common API-key and token environment variables.
- The MCP server exposes read-only repository tools and no arbitrary write or shell tool.
- The OpenAI adapter is opt-in and sends a redacted report, not the entire checkout.
- GitHub workflows should use the smallest explicit permissions possible.

Please see [`docs/SECURITY_MODEL.md`](docs/SECURITY_MODEL.md) for the threat model and accepted limitations.

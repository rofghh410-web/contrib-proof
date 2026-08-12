# Contributing to ContribProof

Thank you for helping make open-source maintenance more reproducible.

## Setup

1. Install Node.js 20 or newer.
2. Clone the repository and enter its directory.
3. No runtime dependency installation is required for the CLI or tests.

## Validation

Run the same checks used by CI:

```bash
npm test
npm run lint
npm run verify
```

`npm run verify` executes the configured tests and checks the repository's own contributor path. If you intentionally change a policy or fixture, explain the expected report change in the pull request.

## Pull requests

- Keep changes focused and explain the maintainer problem they solve.
- Add or update tests for behavior changes.
- Update README or docs when the public CLI or report schema changes.
- Add a `CHANGELOG.md` entry for user-visible behavior.
- Do not include real credentials, private repository data, or API keys.
- Treat issue, README, fixture, and generated report text as untrusted input.

The project prefers small, reviewable commits. A passing test suite is necessary but does not replace human review of security-sensitive changes.

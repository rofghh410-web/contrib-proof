# Maintainer operations

ContribProof 0.10 adds three offline workflows for maintainers of monorepos and public repositories: issue-intake evidence, fixture case selection, and history-retention management. All three are designed to preserve evidence without collecting repository contents or silently mutating files.

## Issue-intake evidence

Create a structured payload in a private working directory or CI artifact. The payload may include a title, body, selected template, labels, and string-valued form fields:

```json
{
  "title": "A reproducible bug",
  "body": "Details kept outside the evidence packet",
  "template": "bug_report.yml",
  "labels": ["bug"],
  "fields": {
    "reproduction": "node --test fixture.test.js",
    "expected": "The command passes",
    "version": "0.11.0"
  }
}
```

Run the packet builder locally:

```bash
contrib-proof intake artifacts/issue.json --root . --format markdown
contrib-proof intake artifacts/issue.json --root . --format json --output artifacts/issue-intake.json
```

The packet records whether fields are present and their lengths, not their values. It also reports template resolution, required-field gaps, suggested-label gaps, and a bounded credential-like signal. A signal is a review prompt, not a secret-scanning guarantee.

## Monorepo fixture selection

A single fixture manifest can describe cases for multiple packages or repository areas. Run the complete suite by default, or select a stable subset by repeating `--case`:

```bash
contrib-proof fixtures --root . --case package-a --case package-b --format json
```

The result records both `selection.requested` and `selection.selected`. An unknown case ID fails rather than silently running a different subset. MCP callers use the equivalent `caseIds` array and always run with `execute: false`.

The GitHub Action accepts a comma-separated `fixture-cases` input:

```yaml
- uses: rofghh410-web/contrib-proof@v0.11.0
  with:
    fixtures: "true"
    fixture-cases: "package-a,package-b"
    format: json
```

## History retention

History records contain only aggregate maintenance summaries. Preview a retention policy first:

```bash
contrib-proof history --root . --retain 50 --format markdown
```

The preview does not change the JSONL file. Apply the reviewed policy explicitly:

```bash
contrib-proof history --root . --retain 50 --apply-retention --format markdown
```

The CLI refuses to rewrite a file when any line is malformed. This fail-closed behavior prevents a retention operation from silently discarding entries that the reader could not parse. MCP exposes only a preview tool, `repo_history_retention`; it cannot apply the policy.

Retention is not archival deletion policy. Before applying it, copy or upload the existing JSONL file according to the repository's own retention and compliance requirements.

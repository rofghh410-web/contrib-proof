# Repository trust controls

ContribProof 0.11 adds three controls for repositories that need stronger evidence than a plain report: versioned language adapters, isolated fixture execution, and signed maintenance-ledger identities.

## Language adapters

The `adapters` command is offline and dependency-free:

```bash
contrib-proof adapters --root . --format json
```

The artifact has a versioned contract and reports which built-in adapters were detected, the source/test paths they discovered, and bounded manifest facts. The adapters never install packages or execute ecosystem commands. A detected adapter is evidence about repository shape, not a compiler or security audit.

The initial built-in registry covers JavaScript/TypeScript/Vue, Python, Rust, and Go. A future adapter should preserve the `id`, `version`, `status`, `sourceFiles`, `testFiles`, `manifests`, and `facts` boundary before it is added to the public registry.

## Isolated fixture execution

Fixture commands can run from a temporary copy:

```bash
contrib-proof fixtures --root . --execute --isolate --network-policy allow --format json
```

The copy refuses source symlinks and excludes `.git`, dependency directories, virtual environments, build outputs, coverage, and artifact directories. These exclusions prevent accidental copying of large or host-coupled state. The result records the mode and whether a copy was made.

A fixture may require network denial:

```json
{
  "id": "offline-package",
  "root": "fixtures/offline-package",
  "execute": true,
  "isolation": { "mode": "copy", "network": "deny" },
  "expected": { "status": "pass" }
}
```

On Linux, ContribProof invokes the command through `unshare --net`. If namespace creation is unavailable, the fixture fails with an explicit error. It never reports `networkEnforced: true` merely because a policy was requested. On other platforms, network-deny is unavailable and must be treated as a failed isolation requirement.

MCP deliberately forces fixture execution off, so it cannot claim network denial or run an arbitrary command. The composite Action exposes `isolate-fixtures` and `network-policy` for CI jobs that intentionally execute fixture commands.

## Signed maintenance-ledger identities

The proof attestation and ledger attestation are separate trust surfaces. Generate or reuse an Ed25519 key pair, then attest the current ledger:

```bash
contrib-proof ledger-attest \
  --root . \
  --ledger-path .contrib-proof-ledger.jsonl \
  --private-key .secrets/ledger-private.pem \
  --output artifacts/ledger-attestation.json
```

Verify it against a maintainer-controlled public key:

```bash
contrib-proof ledger-attest-verify artifacts/ledger-attestation.json \
  --root . \
  --ledger-path .contrib-proof-ledger.jsonl \
  --public-key .secrets/ledger-public.pem \
  --format markdown
```

The signed subject includes the number of valid ledger entries, the chain head hash, and the raw JSONL SHA-256. Verification therefore fails if an entry is changed, appended, removed, or reformatted after signing. The private key is read from a file and is never included in the JSON artifact, command output, or MCP request.

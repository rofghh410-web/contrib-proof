# Signed proof attestations

ContribProof proof manifests provide content integrity: they bind a report and its referenced evidence files to SHA-256 identities. An **attestation** adds a maintainer-controlled Ed25519 trust root to that identity. It does not upload repository contents, grant authorization, or turn a heuristic report into a security audit.

## Trust model

The public key is the trust root. A verifier must obtain it through an independent channel such as a protected repository file, an organization configuration record, or a CI secret-management workflow. The private key must remain outside the repository. ContribProof records the SHA-256 fingerprint of the public key and includes it in the signed payload so a verifier can detect an unexpected key.

The signed canonical payload contains only the following fields:

```json
{
  "schemaVersion": 1,
  "kind": "proof-attestation",
  "algorithm": "ed25519",
  "createdAt": "2026-08-13T00:00:00.000Z",
  "subject": {
    "reportHash": "...",
    "evidenceHash": "...",
    "bundleHash": "..."
  },
  "key": {
    "keyId": "maintainer-key-1",
    "publicKeySha256": "..."
  }
}
```

The `signature` field is intentionally excluded from its own signed payload. Object keys are recursively sorted before signing, which makes the identity independent of JSON formatting or property insertion order.

## Generate a trust root

Generate keys in a directory that is not committed to Git:

```bash
contrib-proof attest-keygen \
  --private-key "$HOME/.config/contrib-proof/private.pem" \
  --public-key "$HOME/.config/contrib-proof/public.pem"
```

The private key is written with owner-only permissions. Existing files are not overwritten unless `--force` is supplied. Record the printed public-key fingerprint in the maintainer's key inventory, not in an unreviewed build log.

## Sign a bundle

First create a proof bundle, then sign its manifest:

```bash
contrib-proof proof --root . --execute --bundle artifacts/contrib-proof --format json
contrib-proof attest artifacts/contrib-proof \
  --private-key "$HOME/.config/contrib-proof/private.pem" \
  --key-id maintainer-key-1
```

The command writes `attestation.json` next to `manifest.json`. It never copies the private key into the bundle and never signs source contents directly.

## Verify

A verifier should supply both the public key and the bundle manifest:

```bash
contrib-proof attest-verify artifacts/contrib-proof/attestation.json \
  --public-key "$HOME/.config/contrib-proof/public.pem" \
  --bundle artifacts/contrib-proof \
  --format markdown
```

The result distinguishes three facts: whether the signature is cryptographically valid, whether the attestation fingerprint matches the selected public key, and whether the signed subject matches the selected proof manifest. The command exits with status `1` if any of these checks fails.

Without `--bundle`, verification still checks the signature and trust-root fingerprint, but it cannot compare the attested subject with a local manifest. This mode is useful for inspecting a detached attestation, but it is weaker evidence and should not replace bundle verification in CI.

## Rotation and revocation

ContribProof does not maintain a key registry or revocation list. To rotate a key, publish the new public-key fingerprint through the maintainer's normal trust channel, update CI configuration, and retain the old public key only for historical verification. If a private key is compromised, remove that fingerprint from the consuming workflow immediately; a valid signature alone does not prove that a key remains authorized today.

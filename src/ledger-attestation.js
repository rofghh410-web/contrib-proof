const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { canonicalJson, sha256 } = require("./proof");
const { publicKeyFingerprint } = require("./attestation");
const { resolveLedgerPath, verifyLedger } = require("./ledger");
const { validateLedgerAttestation } = require("./validate");

function readPem(file, label) {
  if (typeof file !== "string" || !file) throw new Error(`${label} path is required`);
  try {
    return fs.readFileSync(path.resolve(file), "utf8");
  } catch (error) {
    throw new Error(`could not read ${label}: ${error.message}`);
  }
}

function assertEd25519(key, label) {
  if (key.asymmetricKeyType !== "ed25519") throw new Error(`${label} must be an Ed25519 key`);
  return key;
}

function ledgerIdentity(root, ledgerPath) {
  const verification = verifyLedger(root, ledgerPath);
  if (!verification.valid) throw new Error(`cannot attest an invalid ledger: ${verification.errors.join("; ")}`);
  const file = resolveLedgerPath(root, ledgerPath);
  const bytes = fs.existsSync(file) ? fs.readFileSync(file) : Buffer.alloc(0);
  return {
    entries: verification.entries,
    headHash: verification.headHash,
    ledgerHash: sha256(bytes)
  };
}

function ledgerAttestationPayload(attestation) {
  return {
    schemaVersion: attestation.schemaVersion,
    kind: attestation.kind,
    algorithm: attestation.algorithm,
    createdAt: attestation.createdAt,
    subject: attestation.subject,
    key: attestation.key
  };
}

function createLedgerAttestation(root, ledgerPath, privateKeyPem, { createdAt = new Date().toISOString(), keyId = null } = {}) {
  const subject = ledgerIdentity(root, ledgerPath);
  const privateKey = assertEd25519(crypto.createPrivateKey(privateKeyPem), "private key");
  const publicKey = crypto.createPublicKey(privateKey);
  const publicKeySha256 = publicKeyFingerprint(publicKey);
  const attestation = {
    schemaVersion: 1,
    kind: "ledger-attestation",
    algorithm: "ed25519",
    createdAt,
    subject,
    key: {
      keyId: keyId || `ed25519:${publicKeySha256.slice(0, 16)}`,
      publicKeySha256
    }
  };
  attestation.signature = crypto.sign(null, Buffer.from(canonicalJson(ledgerAttestationPayload(attestation))), privateKey).toString("base64");
  const validation = validateLedgerAttestation(attestation);
  if (!validation.valid) throw new Error(`generated an invalid ledger attestation: ${validation.errors.join("; ")}`);
  return attestation;
}

function createLedgerAttestationFromFiles(root, ledgerPath, privateKeyPath, options = {}) {
  return createLedgerAttestation(root, ledgerPath, readPem(privateKeyPath, "private key"), options);
}

function verifyLedgerAttestation(root, ledgerPath, attestation, publicKeyPem) {
  const errors = [];
  const validation = validateLedgerAttestation(attestation);
  if (!validation.valid) errors.push(...validation.errors);
  let publicKey = null;
  try {
    publicKey = assertEd25519(crypto.createPublicKey(publicKeyPem), "public key");
  } catch (error) {
    errors.push(`could not load trusted public key: ${error.message}`);
  }
  const publicKeySha256 = publicKey ? publicKeyFingerprint(publicKey) : null;
  const keyTrusted = Boolean(publicKey && attestation?.key?.publicKeySha256 === publicKeySha256);
  if (publicKey && !keyTrusted) errors.push("attestation public-key fingerprint does not match the trusted public key");
  let signatureValid = false;
  if (publicKey && validation.valid) {
    try {
      signatureValid = crypto.verify(null, Buffer.from(canonicalJson(ledgerAttestationPayload(attestation))), publicKey, Buffer.from(attestation.signature, "base64"));
      if (!signatureValid) errors.push("signature verification failed");
    } catch (error) {
      errors.push(`could not verify signature: ${error.message}`);
    }
  }
  let subjectValid = false;
  try {
    const current = ledgerIdentity(root, ledgerPath);
    subjectValid = ["entries", "headHash", "ledgerHash"].every((field) => attestation?.subject?.[field] === current[field]);
    if (!subjectValid) errors.push("attestation subject does not match the selected ledger");
  } catch (error) {
    errors.push(error.message);
  }
  return {
    schemaVersion: 1,
    kind: "ledger-attestation-verification",
    valid: errors.length === 0,
    signatureValid,
    keyTrusted,
    subjectValid,
    keyId: attestation?.key?.keyId || null,
    publicKeySha256,
    headHash: attestation?.subject?.headHash || null,
    ledgerHash: attestation?.subject?.ledgerHash || null,
    errors
  };
}

function verifyLedgerAttestationFromFiles(root, ledgerPath, attestationPath, publicKeyPath) {
  let attestation;
  try {
    attestation = JSON.parse(fs.readFileSync(path.resolve(attestationPath), "utf8"));
  } catch (error) {
    throw new Error(`could not read ledger attestation: ${error.message}`);
  }
  return verifyLedgerAttestation(root, ledgerPath, attestation, readPem(publicKeyPath, "public key"));
}

function formatLedgerAttestationVerificationMarkdown(result) {
  const lines = [
    "# ContribProof ledger attestation verification",
    "",
    `- Status: **${result.valid ? "valid" : "invalid"}**`,
    `- Signature: **${result.signatureValid ? "valid" : "invalid"}**`,
    `- Trusted key: **${result.keyTrusted ? "matched" : "not matched"}**`,
    `- Ledger subject: **${result.subjectValid ? "matched" : "not matched"}**`,
    `- Key ID: \`${result.keyId || "unavailable"}\``,
    `- Head hash: \`${result.headHash || "empty"}\``,
    ""
  ];
  if (result.errors?.length) lines.push("## Errors", "", ...result.errors.map((error) => `- ${error}`), "");
  else lines.push("The selected Ed25519 trust root validates the ledger identity.", "");
  return `${lines.join("\n").trim()}\n`;
}

module.exports = {
  createLedgerAttestation,
  createLedgerAttestationFromFiles,
  formatLedgerAttestationVerificationMarkdown,
  ledgerAttestationPayload,
  ledgerIdentity,
  verifyLedgerAttestation,
  verifyLedgerAttestationFromFiles
};

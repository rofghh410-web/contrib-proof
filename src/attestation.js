const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { canonicalJson, sha256 } = require("./proof");
const { validateProofAttestation, validateProofManifest } = require("./validate");

function publicKeyFingerprint(publicKey) {
  const key = typeof publicKey === "string" || Buffer.isBuffer(publicKey)
    ? crypto.createPublicKey(publicKey)
    : publicKey;
  return sha256(key.export({ type: "spki", format: "der" }));
}

function derivePublicKey(privateKey) {
  return crypto.createPublicKey(privateKey);
}

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

function attestationPayload(attestation) {
  return {
    schemaVersion: attestation.schemaVersion,
    kind: attestation.kind,
    algorithm: attestation.algorithm,
    createdAt: attestation.createdAt,
    subject: attestation.subject,
    key: attestation.key
  };
}

function createProofAttestation(manifest, privateKeyPem, { createdAt = new Date().toISOString(), keyId = null } = {}) {
  const manifestValidation = validateProofManifest(manifest);
  if (!manifestValidation.valid) throw new Error(`cannot attest an invalid proof manifest: ${manifestValidation.errors.join("; ")}`);
  const privateKey = assertEd25519(crypto.createPrivateKey(privateKeyPem), "private key");
  const publicKey = derivePublicKey(privateKey);
  const publicKeySha256 = publicKeyFingerprint(publicKey);
  const attestation = {
    schemaVersion: 1,
    kind: "proof-attestation",
    algorithm: "ed25519",
    createdAt,
    subject: {
      reportHash: manifest.reportHash,
      evidenceHash: manifest.evidenceHash,
      bundleHash: manifest.bundleHash
    },
    key: {
      keyId: keyId || `ed25519:${publicKeySha256.slice(0, 16)}`,
      publicKeySha256
    }
  };
  attestation.signature = crypto.sign(null, Buffer.from(canonicalJson(attestationPayload(attestation))), privateKey).toString("base64");
  const validation = validateProofAttestation(attestation);
  if (!validation.valid) throw new Error(`generated an invalid attestation: ${validation.errors.join("; ")}`);
  return attestation;
}

function createProofAttestationFromFiles(bundleDirectory, privateKeyPath, options = {}) {
  const bundle = path.resolve(bundleDirectory || "");
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(path.join(bundle, "manifest.json"), "utf8"));
  } catch (error) {
    throw new Error(`could not read proof manifest from ${bundle}: ${error.message}`);
  }
  return createProofAttestation(manifest, readPem(privateKeyPath, "private key"), options);
}

function verifyProofAttestation(attestation, publicKeyPem, manifest = null) {
  const errors = [];
  const validation = validateProofAttestation(attestation);
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
      signatureValid = crypto.verify(null, Buffer.from(canonicalJson(attestationPayload(attestation))), publicKey, Buffer.from(attestation.signature, "base64"));
      if (!signatureValid) errors.push("signature verification failed");
    } catch (error) {
      errors.push(`could not verify signature: ${error.message}`);
    }
  }
  let subjectValid = null;
  if (manifest !== null) {
    const manifestValidation = validateProofManifest(manifest);
    if (!manifestValidation.valid) {
      subjectValid = false;
      errors.push(...manifestValidation.errors.map((item) => `manifest: ${item}`));
    } else {
      subjectValid = ["reportHash", "evidenceHash", "bundleHash"].every((field) => attestation?.subject?.[field] === manifest[field]);
      if (!subjectValid) errors.push("attestation subject does not match the selected proof manifest");
    }
  }
  return {
    schemaVersion: 1,
    kind: "proof-attestation-verification",
    valid: errors.length === 0,
    signatureValid,
    keyTrusted,
    subjectValid,
    keyId: attestation?.key?.keyId || null,
    publicKeySha256,
    bundleHash: attestation?.subject?.bundleHash || null,
    errors
  };
}

function verifyProofAttestationFromFiles(attestationPath, publicKeyPath, bundleDirectory = null) {
  let attestation;
  try {
    attestation = JSON.parse(fs.readFileSync(path.resolve(attestationPath), "utf8"));
  } catch (error) {
    throw new Error(`could not read attestation: ${error.message}`);
  }
  let manifest = null;
  if (bundleDirectory) {
    try {
      manifest = JSON.parse(fs.readFileSync(path.join(path.resolve(bundleDirectory), "manifest.json"), "utf8"));
    } catch (error) {
      throw new Error(`could not read proof manifest from ${path.resolve(bundleDirectory)}: ${error.message}`);
    }
  }
  return verifyProofAttestation(attestation, readPem(publicKeyPath, "public key"), manifest);
}

function generateAttestationKeyPair(privateKeyPath, publicKeyPath, { force = false } = {}) {
  const privatePath = path.resolve(privateKeyPath || "");
  const publicPath = path.resolve(publicKeyPath || "");
  if (!privateKeyPath || !publicKeyPath) throw new Error("both private and public key paths are required");
  if (!force && (fs.existsSync(privatePath) || fs.existsSync(publicPath))) throw new Error("refusing to overwrite existing attestation key material without --force");
  fs.mkdirSync(path.dirname(privatePath), { recursive: true });
  fs.mkdirSync(path.dirname(publicPath), { recursive: true });
  const { privateKey, publicKey } = crypto.generateKeyPairSync("ed25519");
  fs.writeFileSync(privatePath, privateKey.export({ type: "pkcs8", format: "pem" }), { encoding: "utf8", mode: 0o600 });
  fs.writeFileSync(publicPath, publicKey.export({ type: "spki", format: "pem" }), { encoding: "utf8", mode: 0o644 });
  const publicKeySha256 = publicKeyFingerprint(publicKey);
  return {
    algorithm: "ed25519",
    privateKeyPath: privatePath,
    publicKeyPath: publicPath,
    keyId: `ed25519:${publicKeySha256.slice(0, 16)}`,
    publicKeySha256
  };
}

function formatProofAttestationVerificationMarkdown(result) {
  const lines = [
    "# ContribProof proof attestation verification",
    "",
    `- Status: **${result.valid ? "valid" : "invalid"}**`,
    `- Signature: **${result.signatureValid ? "valid" : "invalid"}**`,
    `- Trusted key: **${result.keyTrusted ? "matched" : "not matched"}**`,
    `- Subject manifest: **${result.subjectValid === null ? "not checked" : (result.subjectValid ? "matched" : "not matched")}**`,
    `- Key ID: \`${result.keyId || "unavailable"}\``,
    `- Bundle hash: \`${result.bundleHash || "unavailable"}\``,
    ""
  ];
  if (result.errors?.length) lines.push("## Errors", "", ...result.errors.map((error) => `- ${error}`), "");
  else lines.push("The selected Ed25519 trust root validates the signed proof identity.", "");
  return `${lines.join("\n").trim()}\n`;
}

module.exports = {
  attestationPayload,
  createProofAttestation,
  createProofAttestationFromFiles,
  formatProofAttestationVerificationMarkdown,
  generateAttestationKeyPair,
  publicKeyFingerprint,
  verifyProofAttestation,
  verifyProofAttestationFromFiles
};

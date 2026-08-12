const fs = require("node:fs");
const path = require("node:path");
const { DEFAULT_GATE_POLICY, validateGatePolicy } = require("./gate");

const CONFIG_FILENAME = ".contrib-proof.json";

const DEFAULT_CONFIG = {
  version: 1,
  project: null,
  requiredFiles: ["README.md", "LICENSE"],
  commands: [],
  links: {
    enabled: true
  },
  dependencyPolicy: {
    requireLockfile: false,
    checkActionPinning: false,
    allowedActionRefs: []
  },
  changePolicy: {
    requireTestsForCode: true,
    requireDocsForUserFacingCode: false,
    requireChangelogForCode: false
  },
  gatePolicy: { ...DEFAULT_GATE_POLICY }
};

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function mergeConfig(base, override) {
  return {
    ...base,
    ...override,
    links: { ...base.links, ...(override.links || {}) },
    dependencyPolicy: { ...base.dependencyPolicy, ...(override.dependencyPolicy || {}) },
    changePolicy: { ...base.changePolicy, ...(override.changePolicy || {}) },
    gatePolicy: override.gatePolicy === undefined
      ? { ...base.gatePolicy }
      : (override.gatePolicy && typeof override.gatePolicy === "object" && !Array.isArray(override.gatePolicy)
        ? { ...base.gatePolicy, ...override.gatePolicy }
        : override.gatePolicy),
    commands: Array.isArray(override.commands) ? override.commands : base.commands,
    requiredFiles: Array.isArray(override.requiredFiles)
      ? override.requiredFiles
      : base.requiredFiles
  };
}

function validateConfig(config) {
  const errors = [];
  if (config.version !== 1) {
    errors.push("version must be 1");
  }
  if (!Array.isArray(config.requiredFiles) || config.requiredFiles.some((item) => typeof item !== "string")) {
    errors.push("requiredFiles must be an array of paths");
  }
  if (!Array.isArray(config.commands)) {
    errors.push("commands must be an array");
  } else {
    config.commands.forEach((command, index) => {
      if (!command || typeof command !== "object") {
        errors.push(`commands[${index}] must be an object`);
        return;
      }
      if (typeof command.id !== "string" || !command.id.trim()) {
        errors.push(`commands[${index}].id must be a non-empty string`);
      }
      if (typeof command.run !== "string" || !command.run.trim()) {
        errors.push(`commands[${index}].run must be a non-empty executable name`);
      }
      if (command.args !== undefined && (!Array.isArray(command.args) || command.args.some((arg) => typeof arg !== "string"))) {
        errors.push(`commands[${index}].args must be an array of strings`);
      }
      if (command.timeoutMs !== undefined && (!Number.isInteger(command.timeoutMs) || command.timeoutMs < 1 || command.timeoutMs > 600000)) {
        errors.push(`commands[${index}].timeoutMs must be an integer from 1 to 600000`);
      }
    });
  }
  if (typeof config.links !== "object" || config.links === null || typeof config.links.enabled !== "boolean") {
    errors.push("links.enabled must be a boolean");
  }
  if (typeof config.dependencyPolicy !== "object" || config.dependencyPolicy === null) {
    errors.push("dependencyPolicy must be an object");
  } else {
    if (typeof config.dependencyPolicy.requireLockfile !== "boolean") {
      errors.push("dependencyPolicy.requireLockfile must be a boolean");
    }
    if (typeof config.dependencyPolicy.checkActionPinning !== "boolean") {
      errors.push("dependencyPolicy.checkActionPinning must be a boolean");
    }
    if (!Array.isArray(config.dependencyPolicy.allowedActionRefs) || config.dependencyPolicy.allowedActionRefs.some((item) => typeof item !== "string")) {
      errors.push("dependencyPolicy.allowedActionRefs must be an array of strings");
    }
  }
  if (typeof config.changePolicy !== "object" || config.changePolicy === null) {
    errors.push("changePolicy must be an object");
  }
  errors.push(...validateGatePolicy(config.gatePolicy));
  return errors;
}

function loadConfig(root) {
  const configPath = path.join(root, CONFIG_FILENAME);
  if (!fs.existsSync(configPath)) {
    return {
      config: clone(DEFAULT_CONFIG),
      path: null,
      usedDefaults: true,
      errors: []
    };
  }

  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(configPath, "utf8"));
  } catch (error) {
    return {
      config: clone(DEFAULT_CONFIG),
      path: configPath,
      usedDefaults: false,
      errors: [`could not parse ${CONFIG_FILENAME}: ${error.message}`]
    };
  }

  const config = mergeConfig(clone(DEFAULT_CONFIG), parsed);
  return {
    config,
    path: configPath,
    usedDefaults: false,
    errors: validateConfig(config)
  };
}

function writeDefaultConfig(root, { force = false } = {}) {
  const configPath = path.join(root, CONFIG_FILENAME);
  if (fs.existsSync(configPath) && !force) {
    throw new Error(`${CONFIG_FILENAME} already exists; use --force to replace it`);
  }
  fs.writeFileSync(configPath, `${JSON.stringify(DEFAULT_CONFIG, null, 2)}\n`, "utf8");
  return configPath;
}

module.exports = {
  CONFIG_FILENAME,
  DEFAULT_CONFIG,
  loadConfig,
  writeDefaultConfig,
  validateConfig
};

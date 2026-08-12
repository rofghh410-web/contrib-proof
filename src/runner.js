const { spawn } = require("node:child_process");

const SAFE_ENV_KEYS = new Set([
  "PATH", "Path", "PATHEXT", "SYSTEMROOT", "WINDIR", "HOME", "USERPROFILE",
  "TMP", "TEMP", "CI", "NODE_PATH", "PYTHONPATH", "LANG", "LC_ALL"
]);

function buildSafeEnvironment(extra = {}) {
  const env = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (SAFE_ENV_KEYS.has(key)) env[key] = value;
  }
  for (const [key, value] of Object.entries(extra)) {
    if (/^(?:PATH|Path|CI|NODE_OPTIONS|NODE_ENV|PYTHONPATH|LANG|LC_ALL)$/.test(key)) env[key] = String(value);
  }
  env.CI = env.CI || "1";
  return env;
}

function truncateOutput(value, maxBytes) {
  const text = String(value || "");
  return text.length > maxBytes ? `${text.slice(0, maxBytes)}\n…[truncated]` : text;
}

function executeCommand(command, {
  cwd,
  timeoutMs = 120000,
  maxOutputBytes = 32768,
  env = {}
} = {}) {
  if (!command || typeof command.run !== "string" || !command.run.trim()) {
    return Promise.reject(new Error("command.run must be a non-empty executable name"));
  }
  const args = Array.isArray(command.args) ? command.args.map(String) : [];
  return new Promise((resolve) => {
    const child = spawn(command.run, args, {
      cwd,
      env: buildSafeEnvironment(env),
      shell: false,
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const startedAt = Date.now();
    const timer = setTimeout(() => {
      timedOut = true;
      if (process.platform !== "win32") process.kill(-child.pid, "SIGTERM");
      else child.kill("SIGTERM");
    }, timeoutMs);
    child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ ok: false, timedOut, error: error.message, exitCode: null, signal: null, elapsedMs: Date.now() - startedAt, stdout: truncateOutput(stdout, maxOutputBytes), stderr: truncateOutput(stderr || error.message, maxOutputBytes) });
    });
    child.on("close", (exitCode, signal) => {
      clearTimeout(timer);
      resolve({ ok: !timedOut && exitCode === 0, timedOut, error: null, exitCode, signal, elapsedMs: Date.now() - startedAt, stdout: truncateOutput(stdout, maxOutputBytes), stderr: truncateOutput(stderr, maxOutputBytes) });
    });
  });
}

module.exports = {
  SAFE_ENV_KEYS,
  buildSafeEnvironment,
  executeCommand,
  truncateOutput
};

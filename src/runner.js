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
  const buffer = Buffer.from(String(value || ""));
  if (buffer.length <= maxBytes) return buffer.toString();
  return `${buffer.subarray(0, maxBytes).toString()}\n…[truncated]`;
}

function createBoundedCollector(maxBytes) {
  const chunks = [];
  let storedBytes = 0;
  let truncated = false;
  return {
    append(chunk) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
      if (storedBytes >= maxBytes) {
        truncated = true;
        return;
      }
      const available = maxBytes - storedBytes;
      const selected = buffer.length > available ? buffer.subarray(0, available) : buffer;
      chunks.push(selected);
      storedBytes += selected.length;
      if (selected.length < buffer.length) truncated = true;
    },
    result() {
      const text = Buffer.concat(chunks, storedBytes).toString();
      return truncated ? `${text}\n…[truncated]` : text;
    },
    get truncated() {
      return truncated;
    }
  };
}

function positiveInteger(value, name) {
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer`);
  return value;
}

function terminateProcessGroup(child, signal) {
  if (!child || !Number.isInteger(child.pid)) return false;
  try {
    if (process.platform !== "win32") process.kill(-child.pid, signal);
    else child.kill(signal);
    return true;
  } catch (error) {
    if (error.code === "ESRCH") return false;
    return false;
  }
}

function executeCommand(command, {
  cwd,
  timeoutMs = 120000,
  maxOutputBytes = 32768,
  killGraceMs = 5000,
  env = {}
} = {}) {
  if (!command || typeof command.run !== "string" || !command.run.trim()) {
    return Promise.reject(new Error("command.run must be a non-empty executable name"));
  }
  positiveInteger(timeoutMs, "timeoutMs");
  positiveInteger(maxOutputBytes, "maxOutputBytes");
  positiveInteger(killGraceMs, "killGraceMs");
  const args = Array.isArray(command.args) ? command.args.map(String) : [];
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const stdout = createBoundedCollector(maxOutputBytes);
    const stderr = createBoundedCollector(maxOutputBytes);
    let child;
    let settled = false;
    let timedOut = false;
    let termination = null;
    let timeoutTimer = null;
    let forceKillTimer = null;

    function clearTimers() {
      if (timeoutTimer) clearTimeout(timeoutTimer);
      if (forceKillTimer) clearTimeout(forceKillTimer);
      timeoutTimer = null;
      forceKillTimer = null;
    }

    function finish(result) {
      if (settled) return;
      settled = true;
      clearTimers();
      resolve({
        ...result,
        elapsedMs: Date.now() - startedAt,
        stdout: stdout.result(),
        stderr: stderr.result(),
        outputTruncated: stdout.truncated || stderr.truncated,
        timeoutMs,
        termination
      });
    }

    try {
      child = spawn(command.run, args, {
        cwd,
        env: buildSafeEnvironment(env),
        shell: false,
        detached: process.platform !== "win32",
        stdio: ["ignore", "pipe", "pipe"]
      });
    } catch (error) {
      stderr.append(error.message);
      finish({ ok: false, timedOut: false, error: error.message, exitCode: null, signal: null });
      return;
    }

    child.stdout?.on("data", (chunk) => stdout.append(chunk));
    child.stderr?.on("data", (chunk) => stderr.append(chunk));
    child.on("error", (error) => {
      stderr.append(error.message);
      finish({ ok: false, timedOut, error: error.message, exitCode: null, signal: null });
    });
    child.on("close", (exitCode, signal) => {
      finish({ ok: !timedOut && exitCode === 0, timedOut, error: null, exitCode, signal });
    });

    timeoutTimer = setTimeout(() => {
      if (settled) return;
      timedOut = true;
      termination = "SIGTERM";
      terminateProcessGroup(child, "SIGTERM");
      forceKillTimer = setTimeout(() => {
        if (settled) return;
        termination = "SIGKILL";
        terminateProcessGroup(child, "SIGKILL");
      }, killGraceMs);
    }, timeoutMs);
  });
}

module.exports = {
  SAFE_ENV_KEYS,
  buildSafeEnvironment,
  createBoundedCollector,
  executeCommand,
  terminateProcessGroup,
  truncateOutput
};

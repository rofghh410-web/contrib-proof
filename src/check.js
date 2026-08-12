function makeCheck({ id, category, status, severity = "info", title, message, remediation, evidence = [] }) {
  return { id, category, status, severity, title, message, remediation, evidence };
}

module.exports = { makeCheck };

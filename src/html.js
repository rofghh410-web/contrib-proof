function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function safeJson(value) {
  return JSON.stringify(value).replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026");
}

function formatHtml(report) {
  const summary = report.summary || {};
  const checks = report.checks || [];
  const rows = checks.map((check) => {
    const evidence = (check.evidence || []).slice(0, 3).map((item) => `${item.path}${item.line ? `:${item.line}` : ""}`).join(", ");
    const search = [check.id, check.category, check.title, check.message, evidence].join(" ").toLowerCase();
    return `<article class="finding" data-status="${escapeHtml(check.status)}" data-search="${escapeHtml(search)}"><div class="finding-head"><span class="badge ${escapeHtml(check.status)}">${escapeHtml(check.status)}</span><code>${escapeHtml(check.id)}</code><span class="category">${escapeHtml(check.category)}</span></div><h2>${escapeHtml(check.title)}</h2><p>${escapeHtml(check.message)}</p>${check.remediation ? `<p class="next"><strong>Next step:</strong> ${escapeHtml(check.remediation)}</p>` : ""}${evidence ? `<p class="evidence"><strong>Evidence:</strong> <code>${escapeHtml(evidence)}</code></p>` : ""}</article>`;
  }).join("\n");
  const renderedRows = rows || '<p class="subtle">No checks were produced.</p>';
  const review = report.review;
  const reviewFindings = (review?.findings || []).slice(0, 12).map((finding) => `<article class="review-finding"><div class="finding-head"><span class="badge ${finding.level === "high" ? "fail" : "warn"}">${escapeHtml(finding.level)}</span><code>${escapeHtml(finding.id)}</code></div><h3>${escapeHtml(finding.title)}</h3><p>${escapeHtml(finding.message)}</p><p class="next"><strong>Next step:</strong> ${escapeHtml(finding.remediation)}</p></article>`).join("\n");
  const reviewPanel = review ? (review.available
    ? `<section class="review-panel"><div class="review-heading"><div><h2>Change review</h2><p class="subtle">A deterministic review packet from the Git diff. The risk score is a triage signal, not a correctness verdict.</p></div><div class="risk ${escapeHtml(review.risk.level)}"><strong>${escapeHtml(review.risk.level)}</strong><span>${escapeHtml(review.risk.score)}/100</span></div></div><div class="review-stats"><span><strong>${escapeHtml(review.diff.files)}</strong> files</span><span><strong>${escapeHtml(review.diff.additions)}</strong> additions</span><span><strong>${escapeHtml(review.diff.deletions)}</strong> deletions</span><span><strong>${escapeHtml(review.testPlan.candidates.length)}</strong> test candidates</span></div>${reviewFindings || '<p class="subtle">No focused review findings were produced.</p>'}</section>`
    : `<section class="review-panel"><h2>Change review unavailable</h2><p class="subtle">${escapeHtml(review.reason)}</p></section>`)
    : "";
  const gate = report.gate;
  const gateViolations = (gate?.violations || []).slice(0, 12).map((violation) => `<article class="gate-violation"><div class="finding-head"><span class="badge ${violation.level === "warning" ? "warn" : "fail"}">${escapeHtml(violation.level)}</span><code>${escapeHtml(violation.id)}</code></div><h3>${escapeHtml(violation.title)}</h3><p>${escapeHtml(violation.message)}</p><p class="next"><strong>Next step:</strong> ${escapeHtml(violation.remediation)}</p></article>`).join("\n");
  const gatePanel = gate
    ? `<section class="gate-panel ${escapeHtml(gate.status)}"><div class="review-heading"><div><h2>Merge gate</h2><p class="subtle">A deterministic policy decision for CI. It does not grant an exception or replace maintainer review.</p></div><div class="risk ${gate.status === "pass" ? "routine" : "high"}"><strong>${escapeHtml(gate.status)}</strong><span>${escapeHtml(gate.summary.violations)} violations</span></div></div><div class="review-stats"><span><strong>${escapeHtml(gate.summary.checkFailures)}</strong> check failures</span><span><strong>${escapeHtml(gate.summary.warnings)}</strong> warnings</span><span><strong>${escapeHtml(gate.summary.reviewFindings)}</strong> review findings</span><span><strong>${escapeHtml(gate.policy.maxRisk)}</strong> max risk</span></div>${gateViolations || '<p class="subtle">No merge-gate violations were produced.</p>'}</section>`
    : "";
  const release = report.release;
  const releaseChecks = (release?.checks || []).slice(0, 12).map((check) => `<article class="release-check"><div class="finding-head"><span class="badge ${escapeHtml(check.status)}">${escapeHtml(check.status)}</span><code>${escapeHtml(check.id)}</code></div><h3>${escapeHtml(check.title)}</h3><p>${escapeHtml(check.message)}</p>${check.remediation ? `<p class="next"><strong>Next step:</strong> ${escapeHtml(check.remediation)}</p>` : ""}</article>`).join("\n");
  const releasePanel = release
    ? (release.available
      ? `<section class="release-panel ${release.summary.status === "pass" ? "pass" : "attention"}"><div class="review-heading"><div><h2>Release readiness</h2><p class="subtle">Deterministic release evidence from the Git range and repository metadata.</p></div><div class="risk ${release.summary.status === "pass" ? "routine" : "elevated"}"><strong>${escapeHtml(release.summary.status)}</strong><span>${escapeHtml(release.summary.score)}/100</span></div></div><div class="review-stats"><span><strong>${escapeHtml(release.version || "n/a")}</strong> version</span><span><strong>${escapeHtml(release.commits.length)}</strong> commits</span><span><strong>${escapeHtml(release.changes.files)}</strong> changed files</span><span><strong>${escapeHtml(release.summary.fail)}</strong> blocking checks</span></div>${releaseChecks || '<p class="subtle">No release checks were produced.</p>'}</section>`
      : `<section class="release-panel"><h2>Release readiness unavailable</h2><p class="subtle">${escapeHtml(release.reason)}</p></section>`)
    : "";
  const exceptions = report.exceptions;
  const exceptionPanel = exceptions
    ? `<section class="release-panel ${exceptions.invalid || exceptions.expired ? "attention" : "pass"}"><div class="review-heading"><div><h2>Policy exceptions</h2><p class="subtle">Time-bounded, repository-local suppressions for known findings.</p></div><div class="risk ${exceptions.invalid || exceptions.expired ? "elevated" : "routine"}"><strong>${exceptions.applied ? "enabled" : "disabled"}</strong><span>${escapeHtml(exceptions.active)} active</span></div></div><div class="review-stats"><span><strong>${escapeHtml(exceptions.total)}</strong> total</span><span><strong>${escapeHtml(exceptions.active)}</strong> active</span><span><strong>${escapeHtml(exceptions.expired)}</strong> expired</span><span><strong>${escapeHtml(exceptions.invalid)}</strong> invalid</span></div>${exceptions.errors?.length ? `<p class="subtle">${escapeHtml(exceptions.errors.join("; "))}</p>` : `<p class="subtle">${exceptions.applied && exceptions.active ? "Matching findings are marked skipped and retain their original status for auditability." : "No active exception is being applied."}</p>`}</section>`
    : "";
  const context = report.context;
  const contextPanel = context
    ? `<section class="context-panel"><div class="review-heading"><div><h2>Execution context</h2><p class="subtle">Provenance recorded with this report so another checkout can compare the evidence boundary.</p></div><div class="risk ${context.git?.dirty ? "elevated" : "routine"}"><strong>${context.git?.dirty ? "dirty" : "clean"}</strong><span>${escapeHtml(context.runtime?.node || "unknown")}</span></div></div><div class="review-stats"><span><strong>${escapeHtml(context.git?.commit || "n/a")}</strong> commit</span><span><strong>${escapeHtml(context.git?.branch || "detached")}</strong> branch</span><span><strong>${escapeHtml(context.git?.shallow === null || context.git?.shallow === undefined ? "n/a" : context.git.shallow ? "yes" : "no")}</strong> shallow</span><span><strong>${escapeHtml(context.configuration?.sha256 ? context.configuration.sha256.slice(0, 12) : "n/a")}</strong> config hash</span></div><p class="subtle">${escapeHtml(context.runtime?.platform || "unknown")}/${escapeHtml(context.runtime?.arch || "unknown")} · execute: ${context.options?.execute ? "on" : "off"} · diff: ${context.options?.includeDiff ? "on" : "off"} · config: ${escapeHtml(context.configuration?.path || "defaults")}</p></section>`
    : "";
  const payload = safeJson(report);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>ContribProof report</title>
<style>
:root{color-scheme:light dark;--bg:#f6f7f9;--card:#fff;--ink:#18202a;--muted:#647180;--line:#d9dee6;--accent:#2563eb;--pass:#16794c;--warn:#a15c00;--fail:#b42318;--skip:#667085}
@media(prefers-color-scheme:dark){:root{--bg:#11151b;--card:#1a2029;--ink:#f3f5f7;--muted:#aab4c0;--line:#303946}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.55 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}main{max-width:1050px;margin:0 auto;padding:32px 20px 60px}h1{font-size:2rem;letter-spacing:-.03em;margin:0 0 8px}.subtle,.category{color:var(--muted)}.summary{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:10px;margin:26px 0}.metric,.finding{background:var(--card);border:1px solid var(--line);border-radius:12px}.metric{padding:15px}.metric strong{display:block;font-size:1.55rem}.metric span{color:var(--muted);font-size:.82rem}.toolbar{display:flex;gap:10px;flex-wrap:wrap;margin:20px 0}.toolbar input,.toolbar select{background:var(--card);border:1px solid var(--line);border-radius:8px;color:var(--ink);padding:9px 11px}.toolbar input{flex:1;min-width:220px}.finding{padding:17px 18px;margin:12px 0}.finding-head{display:flex;gap:9px;align-items:center;flex-wrap:wrap;font-size:.84rem}.finding h2{font-size:1.05rem;margin:12px 0 5px}.finding p{margin:5px 0}.badge{border-radius:999px;font-size:.75rem;font-weight:700;padding:2px 9px;text-transform:uppercase}.badge.pass{background:#d9f5e7;color:var(--pass)}.badge.warn{background:#fff0d5;color:var(--warn)}.badge.fail{background:#ffe1df;color:var(--fail)}.badge.skip{background:#eaecf0;color:var(--skip)}.next{border-left:3px solid var(--accent);padding-left:10px}.evidence{color:var(--muted)}code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.9em;overflow-wrap:anywhere}@media(max-width:700px){.summary{grid-template-columns:repeat(2,minmax(0,1fr))}}
</style>
<style>
.gate-panel,.review-panel,.release-panel,.context-panel{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:18px;margin:22px 0}.gate-panel.fail,.release-panel.attention{border-color:var(--warn)}.release-panel.pass{border-color:var(--pass)}.context-panel{border-color:var(--accent)}.review-heading{display:flex;justify-content:space-between;gap:16px;align-items:start}.review-heading h2{font-size:1.15rem;margin:0 0 4px}.review-stats{display:flex;gap:18px;flex-wrap:wrap;border-top:1px solid var(--line);border-bottom:1px solid var(--line);padding:10px 0;margin:14px 0}.review-stats strong{font-size:1.2rem}.risk{border-radius:10px;padding:10px 14px;text-align:center;text-transform:uppercase}.risk strong,.risk span{display:block}.risk strong{font-size:.85rem}.risk span{font-size:.8rem;color:var(--muted)}.risk.high{background:#ffe1df;color:var(--fail)}.risk.elevated{background:#fff0d5;color:var(--warn)}.risk.routine{background:#d9f5e7;color:var(--pass)}.risk.unavailable{background:#eaecf0;color:var(--skip)}.review-finding,.gate-violation,.release-check{border-top:1px solid var(--line);padding:12px 0}.review-finding h3,.gate-violation h3,.release-check h3{font-size:1rem;margin:10px 0 5px}.review-finding p,.gate-violation p,.release-check p{margin:5px 0}@media(max-width:700px){.review-heading{display:block}}
</style>
</head>
<body>
<main>
<h1>ContribProof report</h1>
<div class="subtle">Offline evidence dashboard · mode: <code>${escapeHtml(report.mode)}</code></div>
<section class="summary" aria-label="Summary">
<div class="metric"><strong>${escapeHtml(summary.score)}</strong><span>readiness score</span></div>
<div class="metric"><strong>${escapeHtml(summary.pass)}</strong><span>passed</span></div>
<div class="metric"><strong>${escapeHtml(summary.warn)}</strong><span>warnings</span></div>
<div class="metric"><strong>${escapeHtml(summary.fail)}</strong><span>failures</span></div>
<div class="metric"><strong>${escapeHtml(summary.skip)}</strong><span>skipped</span></div>
</section>
${gatePanel}
${reviewPanel}
${releasePanel}
${exceptionPanel}
${contextPanel}
<div class="toolbar"><input id="search" type="search" placeholder="Filter findings…" aria-label="Filter findings"><select id="status" aria-label="Filter by status"><option value="">All statuses</option><option value="fail">Failures</option><option value="warn">Warnings</option><option value="skip">Skipped</option><option value="pass">Passed</option></select></div>
<section id="findings" aria-live="polite">${renderedRows}</section>
</main>
<script type="application/json" id="report-data">${payload}</script>
<script>
const cards=[...document.querySelectorAll('.finding')];
const search=document.querySelector('#search');
const status=document.querySelector('#status');
function filter(){const needle=search.value.trim().toLowerCase();const wanted=status.value;for(const card of cards){card.hidden=Boolean((wanted&&card.dataset.status!==wanted)||(needle&&!card.dataset.search.includes(needle)));}}
search.addEventListener('input',filter);status.addEventListener('change',filter);
</script>
</body>
</html>
`;
}

module.exports = { escapeHtml, formatHtml };

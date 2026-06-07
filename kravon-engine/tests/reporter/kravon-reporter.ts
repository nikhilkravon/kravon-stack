/**
 * KRAVON Simulation Test Reporter
 * Produces the final deliverable: a self-contained HTML + JSON report.
 *
 * Output files (written to playwright-report/):
 *   kravon-simulation-report.html  — human-readable executive report
 *   kravon-simulation-report.json  — machine-readable data
 */

import type {
  Reporter,
  FullConfig,
  Suite,
  TestCase,
  TestResult,
  FullResult,
} from '@playwright/test/reporter';
import * as fs   from 'fs';
import * as path from 'path';

// ── Severity mapping ────────────────────────────────────────────────────────
// Derived from spec file names so no annotations needed in test code.
const SEVERITY_MAP: Record<string, 'P0' | 'P1' | 'P2' | 'P3'> = {
  '01-restaurant-opening':  'P0',
  '02-first-guest-scan':    'P0',
  '03-multi-guest-join':    'P0',
  '04-lunch-rush':          'P0',
  '05-live-session-feed':   'P1',
  '06-order-status-workflow': 'P1',
  '07-bill-request-stress': 'P0',
  '08-staff-bill-handling': 'P2',
  '09-session-closure':     'P0',
  '10-table-reuse':         'P0',
  '11-chaos-monkey':        'P0',
  'api-performance':        'P1',
  'frontend-performance':   'P1',
};

function getSeverity(filePath: string): 'P0' | 'P1' | 'P2' | 'P3' {
  const basename = path.basename(filePath, '.spec.ts');
  return SEVERITY_MAP[basename] ?? 'P3';
}

interface TestRecord {
  title:     string;
  suite:     string;
  severity:  'P0' | 'P1' | 'P2' | 'P3';
  status:    'passed' | 'failed' | 'skipped' | 'timedOut';
  duration:  number;
  error?:    string;
  filePath:  string;
}

// ── Reporter class ──────────────────────────────────────────────────────────

class KravonReporter implements Reporter {
  private records: TestRecord[] = [];
  private startTime = Date.now();
  private outputDir = 'playwright-report';

  onBegin(config: FullConfig, suite: Suite): void {
    this.startTime = Date.now();
    // Ensure output dir exists.
    fs.mkdirSync(this.outputDir, { recursive: true });
  }

  onTestEnd(test: TestCase, result: TestResult): void {
    const filePath = test.location.file;
    const status   = result.status as TestRecord['status'];

    const record: TestRecord = {
      title:    test.title,
      suite:    test.parent?.title ?? '',
      severity: getSeverity(filePath),
      status,
      duration: result.duration,
      filePath: path.relative(process.cwd(), filePath),
    };

    if (result.errors.length) {
      record.error = result.errors.map((e) => e.message ?? String(e)).join('\n');
    }

    this.records.push(record);
  }

  onEnd(result: FullResult): void {
    const totalDuration = Date.now() - this.startTime;

    // ── Aggregate stats ───────────────────────────────────────────────────
    const passed  = this.records.filter((r) => r.status === 'passed');
    const failed  = this.records.filter((r) => r.status === 'failed' || r.status === 'timedOut');
    const skipped = this.records.filter((r) => r.status === 'skipped');

    const total = this.records.length;
    const score = total > 0 ? Math.round((passed.length / total) * 100) : 0;

    // P0 failures determine production readiness.
    const p0Failures = failed.filter((r) => r.severity === 'P0');
    const productionReady = p0Failures.length === 0 && failed.length === 0;

    // ── Group defects by severity ─────────────────────────────────────────
    const defects: Record<'P0' | 'P1' | 'P2' | 'P3', TestRecord[]> = {
      P0: [], P1: [], P2: [], P3: [],
    };
    for (const r of failed) defects[r.severity].push(r);

    // ── JSON report ───────────────────────────────────────────────────────
    const jsonReport = {
      generatedAt:     new Date().toISOString(),
      totalDurationMs: totalDuration,
      summary: {
        total, passed: passed.length, failed: failed.length, skipped: skipped.length,
        productionReadinessScore: score,
        productionReady,
      },
      defects,
      allTests: this.records,
    };

    const jsonPath = path.join(this.outputDir, 'kravon-simulation-report.json');
    fs.writeFileSync(jsonPath, JSON.stringify(jsonReport, null, 2), 'utf8');

    // ── HTML report ───────────────────────────────────────────────────────
    const html = this.renderHtml(jsonReport);
    const htmlPath = path.join(this.outputDir, 'kravon-simulation-report.html');
    fs.writeFileSync(htmlPath, html, 'utf8');

    // ── Console summary ───────────────────────────────────────────────────
    console.log('\n╔══════════════════════════════════════════════════════╗');
    console.log('║         KRAVON SIMULATION — FINAL REPORT             ║');
    console.log('╠══════════════════════════════════════════════════════╣');
    console.log(`║  Production Ready:  ${productionReady ? '✅ YES' : '❌ NO '}                              ║`);
    console.log(`║  Score:             ${String(score).padStart(3)}%                               ║`);
    console.log(`║  Passed:            ${String(passed.length).padStart(3)} / ${total}                          ║`);
    console.log(`║  Failed:            ${String(failed.length).padStart(3)}                               ║`);
    console.log(`║    P0 (critical):   ${String(defects.P0.length).padStart(3)}                               ║`);
    console.log(`║    P1 (major):      ${String(defects.P1.length).padStart(3)}                               ║`);
    console.log(`║    P2 (minor):      ${String(defects.P2.length).padStart(3)}                               ║`);
    console.log(`║  Duration:          ${(totalDuration / 1000).toFixed(1)}s                              ║`);
    console.log('╚══════════════════════════════════════════════════════╝');
    if (defects.P0.length) {
      console.log('\n🚨 P0 FAILURES (must fix before pilot deployment):');
      for (const r of defects.P0) console.log(`   • [${r.suite}] ${r.title}`);
    }
    console.log(`\n📄 Report: ${htmlPath}`);
  }

  // ── HTML renderer ──────────────────────────────────────────────────────────
  private renderHtml(data: ReturnType<typeof Object.create>): string {
    const { summary, defects, allTests } = data;
    const readinessColor = summary.productionReady ? '#16a34a' : '#dc2626';
    const readinessLabel = summary.productionReady ? 'READY FOR PILOT' : 'NOT READY';

    const defectRows = (sev: 'P0' | 'P1' | 'P2' | 'P3') =>
      (defects[sev] as TestRecord[])
        .map(
          (r) => `
        <tr class="defect-row sev-${sev.toLowerCase()}">
          <td><span class="badge sev-${sev.toLowerCase()}">${sev}</span></td>
          <td>${escHtml(r.suite)}</td>
          <td>${escHtml(r.title)}</td>
          <td>${r.duration}ms</td>
          <td><pre class="error-msg">${escHtml(r.error?.slice(0, 400) ?? '')}</pre></td>
        </tr>`,
        )
        .join('');

    const passedRows = (allTests as TestRecord[])
      .filter((r) => r.status === 'passed')
      .map(
        (r) => `<tr>
          <td><span class="badge pass">PASS</span></td>
          <td>${escHtml(r.suite)}</td>
          <td>${escHtml(r.title)}</td>
          <td>${r.duration}ms</td>
          <td>—</td>
        </tr>`,
      )
      .join('');

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>KRAVON Simulation Report</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f8fafc;color:#1e293b;padding:2rem}
  h1{font-size:1.75rem;font-weight:800;margin-bottom:.25rem}
  .subtitle{color:#64748b;margin-bottom:2rem}
  .cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:1rem;margin-bottom:2rem}
  .card{background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:1.25rem;text-align:center}
  .card .value{font-size:2.25rem;font-weight:800;line-height:1}
  .card .label{font-size:.8rem;color:#64748b;margin-top:.35rem;text-transform:uppercase;letter-spacing:.05em}
  .ready-banner{padding:1rem 1.5rem;border-radius:12px;font-size:1.1rem;font-weight:700;color:#fff;text-align:center;margin-bottom:2rem;background:${readinessColor}}
  table{width:100%;border-collapse:collapse;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.06);margin-bottom:2rem}
  th{background:#f1f5f9;padding:.75rem 1rem;text-align:left;font-size:.8rem;text-transform:uppercase;letter-spacing:.05em;color:#64748b}
  td{padding:.65rem 1rem;border-top:1px solid #f1f5f9;font-size:.875rem;vertical-align:top}
  .badge{display:inline-block;padding:.2em .6em;border-radius:6px;font-size:.75rem;font-weight:700;text-transform:uppercase}
  .badge.sev-p0{background:#fee2e2;color:#b91c1c}
  .badge.sev-p1{background:#fef3c7;color:#b45309}
  .badge.sev-p2{background:#dbeafe;color:#1d4ed8}
  .badge.sev-p3{background:#f1f5f9;color:#475569}
  .badge.pass{background:#dcfce7;color:#15803d}
  .error-msg{font-size:.75rem;white-space:pre-wrap;word-break:break-word;max-width:500px;color:#ef4444;background:#fef2f2;padding:.5rem;border-radius:6px}
  h2{font-size:1.2rem;font-weight:700;margin-bottom:.75rem;margin-top:1.5rem}
</style>
</head>
<body>
<h1>KRAVON Restaurant Simulation — Test Report</h1>
<p class="subtitle">Generated ${new Date(data.generatedAt).toLocaleString()} &nbsp;·&nbsp; Duration: ${(data.totalDurationMs / 1000).toFixed(1)}s</p>

<div class="ready-banner">
  Production Readiness: ${readinessLabel} &nbsp; (Score: ${summary.productionReadinessScore}%)
</div>

<div class="cards">
  <div class="card"><div class="value">${summary.total}</div><div class="label">Total Tests</div></div>
  <div class="card"><div class="value" style="color:#16a34a">${summary.passed}</div><div class="label">Passed</div></div>
  <div class="card"><div class="value" style="color:#dc2626">${summary.failed}</div><div class="label">Failed</div></div>
  <div class="card"><div class="value" style="color:#b91c1c">${(defects as any).P0.length}</div><div class="label">P0 Defects</div></div>
  <div class="card"><div class="value" style="color:#b45309">${(defects as any).P1.length}</div><div class="label">P1 Defects</div></div>
  <div class="card"><div class="value" style="color:#1d4ed8">${(defects as any).P2.length}</div><div class="label">P2 Defects</div></div>
</div>

${((defects as any).P0.length + (defects as any).P1.length + (defects as any).P2.length) > 0 ? `
<h2>Defects</h2>
<table>
<thead><tr><th>Severity</th><th>Suite</th><th>Test</th><th>Duration</th><th>Error</th></tr></thead>
<tbody>
${defectRows('P0')}
${defectRows('P1')}
${defectRows('P2')}
${defectRows('P3')}
</tbody>
</table>` : '<h2 style="color:#16a34a">✅ No defects found</h2>'}

<h2>All Tests</h2>
<table>
<thead><tr><th>Result</th><th>Suite</th><th>Test</th><th>Duration</th><th>Notes</th></tr></thead>
<tbody>${passedRows}</tbody>
</table>

<h2>Recommendations</h2>
<ul style="padding-left:1.5rem;line-height:2">
${summary.productionReady
  ? '<li>All P0 checks passed. KRAVON is ready for pilot deployment in a live restaurant.</li>'
  : '<li style="color:#dc2626;font-weight:600">Resolve all P0 defects before onboarding a live restaurant.</li>'}
${(defects as any).P2.length > 0
  ? '<li>[P2] Consider adding <code>bill_request_acknowledged_at</code> / <code>bill_request_acknowledged_by</code> to sessions for response-time SLA tracking and multi-staff environments.</li>'
  : ''}
<li>Monitor JS heap growth on mobile devices over extended dining sessions (60+ min).</li>
<li>Review API p95 latencies under production database load — numbers here are from a dev/staging environment.</li>
</ul>
</body>
</html>`;
  }
}

function escHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export default KravonReporter;

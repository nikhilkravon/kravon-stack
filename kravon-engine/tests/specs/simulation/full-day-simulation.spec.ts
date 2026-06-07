/**
 * FULL DAY SIMULATION — QR Route
 *
 * Simulates a complete restaurant day through the actual customer QR flow:
 *   Staff opens session → Customer browser visits QR URL → guest popup →
 *   adds items → checkout → places order → staff closes session
 *
 * 20 tables, mixed pax, 3 service periods (breakfast / lunch / dinner).
 * Each guest gets their own Playwright browser context (separate phone scan).
 *
 * Run (from kravon-engine/tests/):
 *   KRAVON_API_URL=https://kravon-backend-production.up.railway.app \
 *   KRAVON_FRONTEND_URL=https://kravon-frontend-production.up.railway.app \
 *   KRAVON_SLUG=royal-tandoor \
 *   KRAVON_STAFF_EMAIL=rahul@spiceofindia.in \
 *   KRAVON_STAFF_PASSWORD=kravon123 \
 *   npx playwright test specs/simulation/full-day-simulation.spec.ts --workers=1
 */

import { test, Browser } from '@playwright/test';
import * as fs   from 'fs';
import * as path from 'path';

import {
  staffLogin,
  openSession,
  ensureTableClosed,
  type TableInfo,
} from '../../fixtures/api';
import { CustomerPage } from '../../fixtures/pages';
import { API_URL, SLUG, STAFF_EMAIL, STAFF_PASSWORD, tableUrl } from '../../fixtures/env';

/* ── Unique run prefix — prevents name collisions across retries ───────── */
const RUN_ID = `sim${Date.now().toString(36).slice(-4)}`;

/* ── Table floor plan: 20 tables, mixed capacity ──────────────────────── */
const TABLE_DEFS = [
  { name: `${RUN_ID}-T1`,  capacity: 2,  floor: 'Ground'  },
  { name: `${RUN_ID}-T2`,  capacity: 2,  floor: 'Ground'  },
  { name: `${RUN_ID}-T3`,  capacity: 4,  floor: 'Ground'  },
  { name: `${RUN_ID}-T4`,  capacity: 4,  floor: 'Ground'  },
  { name: `${RUN_ID}-T5`,  capacity: 4,  floor: 'Ground'  },
  { name: `${RUN_ID}-T6`,  capacity: 4,  floor: 'Ground'  },
  { name: `${RUN_ID}-T7`,  capacity: 6,  floor: 'Ground'  },
  { name: `${RUN_ID}-T8`,  capacity: 6,  floor: 'Ground'  },
  { name: `${RUN_ID}-T9`,  capacity: 8,  floor: 'Ground'  },
  { name: `${RUN_ID}-T10`, capacity: 8,  floor: 'Ground'  },
  { name: `${RUN_ID}-R1`,  capacity: 2,  floor: 'Rooftop' },
  { name: `${RUN_ID}-R2`,  capacity: 2,  floor: 'Rooftop' },
  { name: `${RUN_ID}-R3`,  capacity: 4,  floor: 'Rooftop' },
  { name: `${RUN_ID}-R4`,  capacity: 4,  floor: 'Rooftop' },
  { name: `${RUN_ID}-R5`,  capacity: 4,  floor: 'Rooftop' },
  { name: `${RUN_ID}-R6`,  capacity: 6,  floor: 'Rooftop' },
  { name: `${RUN_ID}-R7`,  capacity: 6,  floor: 'Rooftop' },
  { name: `${RUN_ID}-P1`,  capacity: 10, floor: 'Private' },
  { name: `${RUN_ID}-P2`,  capacity: 12, floor: 'Private' },
  { name: `${RUN_ID}-P3`,  capacity: 14, floor: 'Private' },
];

/* ── Service period definitions ───────────────────────────────────────── */
const RUSHES = [
  {
    name:           'Breakfast',
    emoji:          '☀️',
    time:           '08:00–11:00',
    color:          '#f59e0b',
    tableNames:     [`${RUN_ID}-T1`, `${RUN_ID}-T2`, `${RUN_ID}-T3`, `${RUN_ID}-T4`],
    paxRange:       [1, 2] as [number, number],
    ordersPerGuest: [1, 2] as [number, number],
  },
  {
    name:           'Lunch',
    emoji:          '🍽️',
    time:           '12:00–15:00',
    color:          '#2563eb',
    tableNames:     ['T1','T2','T3','T4','T5','T6','T7','T8','T9','T10','R1','R2','R3','R4','R5'].map(n => `${RUN_ID}-${n}`),
    paxRange:       [2, 5] as [number, number],
    ordersPerGuest: [1, 3] as [number, number],
  },
  {
    name:           'Dinner',
    emoji:          '🌙',
    time:           '19:00–23:00',
    color:          '#7c3aed',
    tableNames:     TABLE_DEFS.map(t => t.name),
    paxRange:       [2, 6] as [number, number],
    ordersPerGuest: [1, 3] as [number, number],
  },
];

/* ── Helpers ──────────────────────────────────────────────────────────── */
const rand  = (min: number, max: number) => Math.floor(Math.random() * (max - min + 1)) + min;
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const fmt   = (n: number)  => '₹' + Number(n || 0).toLocaleString('en-IN');

const usedPhones = new Set<string>();
function uniquePhone(): string {
  let p: string;
  do { p = `9${rand(100000000, 999999999)}`; } while (usedPhones.has(p));
  usedPhones.add(p);
  return p;
}

/* ── Types ────────────────────────────────────────────────────────────── */
interface GuestResult   { guestName: string; orders: number; placed: number; error?: string }
interface TableResult   { tableName: string; floor: string; covers: number; guests: GuestResult[]; billed: number; durationMs: number }
interface RushResult    { name: string; emoji: string; time: string; color: string; tables: TableResult[] }

/* ── Simulate one guest via real browser QR flow ─────────────────────── */
async function simulateGuest(
  browser:     Browser,
  tableId:     string,
  guestName:   string,
  guestPhone:  string,
  orderCount:  number,
): Promise<GuestResult> {
  const ctx  = await browser.newContext({
    viewport:  { width: 390, height: 844 },
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15',
    isMobile:  true,
    hasTouch:  true,
  });
  const page     = await ctx.newPage();
  const customer = new CustomerPage(page);
  let   placed   = 0;

  try {
    // 1. Land on QR URL (same URL encoded in the QR code)
    await customer.gotoTable(tableId);

    // 2. Guest identity popup
    await customer.submitGuestIdentity(guestName, guestPhone);
    await customer.waitForOrderingScreen();

    // 3. Place each order round
    for (let o = 0; o < orderCount; o++) {
      // Add 1–3 items to cart
      const items = rand(1, 3);
      for (let i = 0; i < items; i++) {
        await customer.addItemToCart();
        await sleep(150);
      }
      await customer.goToCheckout();
      await customer.placeOrder();
      placed++;

      // For subsequent rounds: go back to ordering screen
      if (o < orderCount - 1) {
        await page.evaluate(() => { location.hash = ''; });
        await customer.waitForOrderingScreen().catch(() => {});
        await sleep(300);
      }
    }
    return { guestName, orders: orderCount, placed };
  } catch (err: any) {
    return { guestName, orders: orderCount, placed, error: err.message?.slice(0, 120) };
  } finally {
    await ctx.close();
  }
}

/* ── Simulate one rush period ─────────────────────────────────────────── */
async function simulateRush(
  browser:   Browser,
  request:   any,
  token:     string,
  rush:      typeof RUSHES[0],
  tableMap:  Record<string, string>,
): Promise<RushResult> {
  const result: RushResult = { name: rush.name, emoji: rush.emoji, time: rush.time, color: rush.color, tables: [] };
  const activeDefs = TABLE_DEFS.filter(d => rush.tableNames.includes(d.name) && tableMap[d.name]);

  console.log(`\n${rush.emoji} ${rush.name} — ${activeDefs.length} tables`);

  for (const def of activeDefs) {
    const tableId    = tableMap[def.name];
    const covers     = rand(...rush.paxRange);
    const tableStart = Date.now();
    const tableResult: TableResult = { tableName: def.name, floor: def.floor, covers, guests: [], billed: 0, durationMs: 0 };

    // Staff opens session
    let sessionId: string | undefined;
    try {
      const s = await openSession(request, token, tableId, covers);
      sessionId = s.session_id;
      console.log(`  ${def.name} (${def.floor}, ${covers} pax) — session open`);
    } catch (e: any) {
      console.error(`  ${def.name} — open FAILED: ${e.message}`);
      result.tables.push(tableResult);
      continue;
    }

    // Each guest scans QR independently — run concurrently (real phones scan in parallel)
    const guestJobs = Array.from({ length: covers }, (_, g) => ({
      guestName:  `${def.name}_G${g + 1}`,
      guestPhone: uniquePhone(),
      orders:     rand(...rush.ordersPerGuest),
    }));
    const guestResults = await Promise.all(
      guestJobs.map(({ guestName, guestPhone, orders }) =>
        simulateGuest(browser, tableId, guestName, guestPhone, orders)
      )
    );
    for (const gr of guestResults) {
      tableResult.guests.push(gr);
      if (gr.placed > 0) {
        console.log(`    ✓ ${gr.guestName} — ${gr.placed}/${gr.orders} orders`);
      } else {
        console.log(`    ✗ ${gr.guestName} — failed: ${gr.error}`);
      }
    }

    // Bill request from first guest
    await request.post(`${API_URL}/v1/restaurants/${SLUG}/dine-in/session/request-bill`, {
      data: { session_id: sessionId, requested_by: `${def.name}_G1` },
    }).catch(() => {});

    // Staff closes session
    try {
      const res  = await request.post(`${API_URL}/v1/restaurants/${SLUG}/dine-in/session/close`, {
        headers: { Authorization: `Bearer ${token}` },
        data:    { session_id: sessionId },
      });
      const body = await res.json();
      tableResult.billed = Number(body.total_billed) || 0;
      console.log(`  ${def.name} — closed · ${fmt(tableResult.billed)}`);
    } catch (e: any) {
      console.error(`  ${def.name} — close FAILED: ${e.message}`);
    }

    tableResult.durationMs = Date.now() - tableStart;
    result.tables.push(tableResult);
    await sleep(300);
  }

  const orders  = result.tables.flatMap(t => t.guests).reduce((s, g) => s + g.placed, 0);
  const revenue = result.tables.reduce((s, t) => s + t.billed, 0);
  const failed  = result.tables.flatMap(t => t.guests).reduce((s, g) => s + (g.orders - g.placed), 0);
  console.log(`${rush.emoji} ${rush.name} complete — ${result.tables.length} tables · ${orders} orders · ${fmt(revenue)} · ${failed} failed`);
  return result;
}

/* ── HTML report ──────────────────────────────────────────────────────── */
function buildReport(rushResults: RushResult[], durationMs: number): string {
  const allGuests      = rushResults.flatMap(r => r.tables.flatMap(t => t.guests));
  const totalOrders    = allGuests.reduce((s, g) => s + g.placed, 0);
  const totalAttempted = allGuests.reduce((s, g) => s + g.orders, 0);
  const totalFailed    = totalAttempted - totalOrders;
  const totalRevenue   = rushResults.flatMap(r => r.tables).reduce((s, t) => s + t.billed, 0);
  const totalSessions  = rushResults.flatMap(r => r.tables).filter(t => t.durationMs > 0).length;
  const totalBills     = rushResults.flatMap(r => r.tables).length; // 1 per table
  const successRate    = totalAttempted > 0 ? ((totalOrders / totalAttempted) * 100).toFixed(1) : '100.0';

  const rushCards = rushResults.map(r => {
    const rOrders  = r.tables.flatMap(t => t.guests).reduce((s, g) => s + g.placed, 0);
    const rFailed  = r.tables.flatMap(t => t.guests).reduce((s, g) => s + (g.orders - g.placed), 0);
    const rRevenue = r.tables.reduce((s, t) => s + t.billed, 0);
    const tableRows = r.tables.map(t => {
      const tPlaced = t.guests.reduce((s, g) => s + g.placed, 0);
      const tFailed = t.guests.reduce((s, g) => s + (g.orders - g.placed), 0);
      const guestDetails = t.guests.map(g =>
        `<span class="guest-tag ${g.placed > 0 ? 'ok' : 'err'}" title="${g.error || ''}">
          ${g.guestName.split('_').pop()} ${g.placed}/${g.orders}
        </span>`
      ).join(' ');
      return `<tr>
        <td><strong>${t.tableName}</strong></td>
        <td><span class="floor-tag">${t.floor}</span></td>
        <td>${t.covers}</td>
        <td>${guestDetails}</td>
        <td>${tPlaced > 0 ? `<span class="ok-num">${tPlaced} ✓</span>` : '—'}${tFailed > 0 ? ` <span class="err-num">${tFailed} ✗</span>` : ''}</td>
        <td>${fmt(t.billed)}</td>
        <td class="dur">${(t.durationMs / 1000).toFixed(0)}s</td>
      </tr>`;
    }).join('');
    return `
    <div class="rush-card" style="--accent:${r.color}">
      <div class="rush-header">${r.emoji} ${r.name} <span class="rush-time">${r.time}</span></div>
      <div class="rush-stats">
        <div class="stat"><div class="stat-val">${r.tables.length}</div><div class="stat-lbl">Tables</div></div>
        <div class="stat"><div class="stat-val">${rOrders}</div><div class="stat-lbl">Orders</div></div>
        <div class="stat"><div class="stat-val">${fmt(rRevenue)}</div><div class="stat-lbl">Revenue</div></div>
        <div class="stat ${rFailed > 0 ? 'stat-err' : 'stat-ok'}">
          <div class="stat-val">${rFailed > 0 ? rFailed + ' ✗' : '✓ 0'}</div>
          <div class="stat-lbl">Failed</div>
        </div>
      </div>
      <table class="tbl">
        <thead><tr><th>Table</th><th>Floor</th><th>Pax</th><th>Guests</th><th>Orders</th><th>Billed</th><th>Time</th></tr></thead>
        <tbody>${tableRows}</tbody>
      </table>
    </div>`;
  }).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Royal Tandoor — Full Day QR Simulation</title>
<style>
  *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
  body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f4f4f5;color:#111;padding:32px;min-height:100vh}
  h1{font-size:26px;font-weight:800;margin-bottom:6px}
  .meta{font-size:13px;color:#777;margin-bottom:36px}
  .kpi-row{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:14px;margin-bottom:44px}
  .kpi{background:#fff;border-radius:12px;padding:20px 22px;box-shadow:0 1px 4px rgba(0,0,0,.07);border-top:3px solid var(--c,#2563eb)}
  .kpi-val{font-size:28px;font-weight:800;line-height:1;color:var(--c,#2563eb)}
  .kpi-lbl{font-size:11px;color:#999;margin-top:5px;text-transform:uppercase;letter-spacing:.5px}
  h2{font-size:15px;font-weight:700;margin-bottom:16px;color:#333;border-bottom:2px solid #e5e7eb;padding-bottom:8px}
  .rushes{display:flex;flex-direction:column;gap:28px;margin-bottom:44px}
  .rush-card{background:#fff;border-radius:12px;padding:24px;box-shadow:0 1px 4px rgba(0,0,0,.07);border-left:4px solid var(--accent,#2563eb)}
  .rush-header{font-size:16px;font-weight:800;margin-bottom:18px;color:#111}
  .rush-time{font-size:12px;font-weight:400;color:#999;margin-left:8px}
  .rush-stats{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:20px}
  .stat{background:#f9fafb;border-radius:8px;padding:12px;text-align:center}
  .stat-val{font-size:20px;font-weight:800}
  .stat-lbl{font-size:10px;color:#999;text-transform:uppercase;margin-top:3px}
  .stat-err{background:#fef2f2}.stat-err .stat-val{color:#dc2626}
  .stat-ok{background:#f0fdf4}.stat-ok .stat-val{color:#16a34a}
  .tbl{width:100%;border-collapse:collapse;font-size:12px}
  .tbl th{text-align:left;padding:7px 10px;border-bottom:2px solid #e5e7eb;font-weight:600;color:#666;font-size:11px;text-transform:uppercase;letter-spacing:.4px}
  .tbl td{padding:6px 10px;border-bottom:1px solid #f3f4f6;vertical-align:middle}
  .tbl tr:last-child td{border-bottom:none}
  .floor-tag{background:#f3f4f6;border-radius:4px;padding:1px 6px;font-size:11px;color:#555}
  .guest-tag{display:inline-block;background:#f3f4f6;border-radius:4px;padding:1px 5px;font-size:11px;margin:1px;cursor:default}
  .guest-tag.ok{background:#dcfce7;color:#166534}
  .guest-tag.err{background:#fee2e2;color:#991b1b}
  .ok-num{color:#16a34a;font-weight:700}
  .err-num{color:#dc2626;font-weight:700}
  .dur{color:#999}
  section{margin-bottom:44px}
</style>
</head>
<body>
<h1>🍽️ Royal Tandoor — Full Day QR Simulation</h1>
<p class="meta">
  Simulated at ${new Date().toLocaleString('en-IN', { dateStyle: 'full', timeStyle: 'short' })} ·
  Total duration: ${(durationMs / 1000 / 60).toFixed(1)} min ·
  20 tables · Real browser QR flow · 3 service periods
</p>

<div class="kpi-row">
  <div class="kpi" style="--c:#2563eb"><div class="kpi-val">${totalSessions}</div><div class="kpi-lbl">Sessions</div></div>
  <div class="kpi" style="--c:#2563eb"><div class="kpi-val">${totalOrders}</div><div class="kpi-lbl">Orders placed</div></div>
  <div class="kpi" style="--c:#16a34a"><div class="kpi-val">${fmt(totalRevenue)}</div><div class="kpi-lbl">Revenue</div></div>
  <div class="kpi" style="--c:#16a34a"><div class="kpi-val">${successRate}%</div><div class="kpi-lbl">Success rate</div></div>
  <div class="kpi" style="--c:#7c3aed"><div class="kpi-val">${totalBills}</div><div class="kpi-lbl">Bill requests</div></div>
  <div class="kpi" style="--c:${totalFailed > 0 ? '#dc2626' : '#16a34a'}">
    <div class="kpi-val">${totalFailed}</div><div class="kpi-lbl">Failed orders</div>
  </div>
</div>

<section>
  <h2>Service Periods</h2>
  <div class="rushes">${rushCards}</div>
</section>
</body>
</html>`;
}

/* ══════════════════════════════════════════════════════════════════════════
   THE TEST — single test, full day, generates report at the end
   ══════════════════════════════════════════════════════════════════════════ */

test('Royal Tandoor — Full Day QR Simulation', async ({ request, browser }) => {
  test.setTimeout(3 * 60 * 60 * 1000); // 3-hour ceiling

  const startMs        = Date.now();
  const createdTableIds: string[] = [];
  const tableMap:       Record<string, string> = {};
  let   token:          string;

  // ── Login ────────────────────────────────────────────────────────────
  token = await staffLogin(request);

  // ── Create 20 tables ─────────────────────────────────────────────────
  console.log('\nCreating 20 simulation tables…');
  for (const def of TABLE_DEFS) {
    try {
      const res = await request.post(`${API_URL}/v1/restaurants/${SLUG}/tables`, {
        headers: { Authorization: `Bearer ${token}` },
        data:    def,
      });
      if (res.ok()) {
        const body = await res.json();
        const id   = body.table?.id || body.table_id || body.id;
        tableMap[def.name] = id;
        createdTableIds.push(id);
        process.stdout.write('.');
      } else {
        console.error(`\n  Failed to create ${def.name}: ${res.status()}`);
      }
    } catch (e: any) {
      console.error(`\n  Error creating ${def.name}: ${e.message}`);
    }
    await sleep(120);
  }
  console.log(`\n${Object.keys(tableMap).length}/20 tables created.\n`);

  // ── Warm config cache (cold DB query takes ~9s; all guests after this get instant config) ──
  await request.get(`${API_URL}/v1/restaurants/${SLUG}/config`).catch(() => {});
  console.log('Config cache warmed.\n');

  // ── Run all rushes ────────────────────────────────────────────────────
  const rushResults: RushResult[] = [];
  try {
    for (const rush of RUSHES) {
      // Refresh token between rushes (15 min TTL)
      try { token = await staffLogin(request); } catch {}
      const result = await simulateRush(browser, request, token, rush, tableMap);
      rushResults.push(result);
      await sleep(2_000);
    }
  } finally {
    // ── Always clean up ───────────────────────────────────────────────
    console.log(`\nCleaning up ${createdTableIds.length} tables…`);
    try { token = await staffLogin(request); } catch {}
    for (const id of createdTableIds) {
      await ensureTableClosed(request, token, id).catch(() => {});
      await request.delete(`${API_URL}/v1/restaurants/${SLUG}/tables/${id}`, {
        headers: { Authorization: `Bearer ${token}` },
      }).catch(() => {});
      await sleep(100);
    }
    console.log('Cleanup done.');
  }

  // ── Generate report ───────────────────────────────────────────────────
  const durationMs  = Date.now() - startMs;
  const html        = buildReport(rushResults, durationMs);
  const reportPath  = path.join(process.cwd(), 'simulation-report.html');
  fs.writeFileSync(reportPath, html);
  console.log(`\n📄 Report: ${reportPath}`);

  // Attach to Playwright HTML report too
  await test.info().attach('simulation-report.html', {
    body:        Buffer.from(html),
    contentType: 'text/html',
  });

  // ── Final assertion ───────────────────────────────────────────────────
  const allGuests   = rushResults.flatMap(r => r.tables.flatMap(t => t.guests));
  const placed      = allGuests.reduce((s, g) => s + g.placed, 0);
  const attempted   = allGuests.reduce((s, g) => s + g.orders, 0);
  const successRate = attempted > 0 ? placed / attempted : 1;
  console.log(`\nSuccess rate: ${(successRate * 100).toFixed(1)}% (${placed}/${attempted} orders)`);
});

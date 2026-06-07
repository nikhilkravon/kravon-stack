/**
 * PERFORMANCE — API Latency & Stability
 * Captures: average latency, slowest endpoints, failure rates.
 * Results are written to the custom reporter for inclusion in the final report.
 */

import { test, expect } from '../../fixtures';
import {
  openSession,
  closeSession,
  placeDineInOrder,
  getSessionOrders,
  getSessionStatus,
  requestBill,
} from '../../fixtures/api';
import { API_URL, SLUG } from '../../fixtures/env';

const SAMPLE_SIZE = 20; // requests per endpoint
const LATENCY_P0_THRESHOLD_MS  = 2_000;  // Any P0 endpoint must respond within 2s
const LATENCY_P1_THRESHOLD_MS  = 3_000;

interface LatencyResult {
  endpoint:  string;
  samples:   number[];
  avg:       number;
  p95:       number;
  max:       number;
  errors:    number;
}

function percentile(sorted: number[], p: number): number {
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

async function measureLatency(
  fn: () => Promise<unknown>,
  n: number,
): Promise<{ samples: number[]; errors: number }> {
  const samples: number[] = [];
  let errors = 0;
  for (let i = 0; i < n; i++) {
    const t0 = Date.now();
    try {
      await fn();
      samples.push(Date.now() - t0);
    } catch {
      errors++;
    }
  }
  return { samples, errors };
}

test.describe('Performance — API Latency', () => {
  const results: LatencyResult[] = [];
  let sessionId = '';

  test.beforeAll(async ({ request, staffToken, firstTableId, menuItemId }) => {
    const s = await openSession(request, staffToken, firstTableId, 2);
    sessionId = s.session_id;

    // Seed a couple of orders so feed endpoints have data.
    await placeDineInOrder(request, sessionId, 'PerfGuest1', '9010000001', [
      { menu_item_id: menuItemId, quantity: 1 },
    ]);
    await placeDineInOrder(request, sessionId, 'PerfGuest2', '9010000002', [
      { menu_item_id: menuItemId, quantity: 1 },
    ]);
  });

  test.afterAll(async ({ request, staffToken }) => {
    if (sessionId) {
      await closeSession(request, staffToken, sessionId).catch(() => {});
    }
    // Attach results to the test report via annotation.
    console.log('\n[PERF] API Latency Results:');
    for (const r of results) {
      console.log(
        `  ${r.endpoint.padEnd(45)} avg=${r.avg}ms  p95=${r.p95}ms  max=${r.max}ms  errors=${r.errors}/${r.samples.length + r.errors}`,
      );
    }
  });

  function record(endpoint: string, samples: number[], errors: number) {
    const sorted = [...samples].sort((a, b) => a - b);
    results.push({
      endpoint,
      samples,
      avg: sorted.length ? Math.round(sorted.reduce((s, v) => s + v, 0) / sorted.length) : 0,
      p95: sorted.length ? percentile(sorted, 95) : 0,
      max: sorted.length ? sorted[sorted.length - 1] : 0,
      errors,
    });
  }

  test('GET /config — p95 < 500ms', async ({ request }) => {
    const { samples, errors } = await measureLatency(
      () => request.get(`${API_URL}/v1/restaurants/${SLUG}/config`),
      SAMPLE_SIZE,
    );
    record(`GET /config`, samples, errors);
    const sorted = [...samples].sort((a, b) => a - b);
    expect(errors).toBe(0);
    expect(percentile(sorted, 95)).toBeLessThan(500);
  });

  test('GET /dine-in/session/status — p95 < 400ms (P0 poll path)', async ({
    request,
    firstTableId,
  }) => {
    const { samples, errors } = await measureLatency(
      () => getSessionStatus(request, firstTableId),
      SAMPLE_SIZE,
    );
    record(`GET /dine-in/session/status`, samples, errors);
    const sorted = [...samples].sort((a, b) => a - b);
    expect(errors).toBe(0);
    expect(percentile(sorted, 95)).toBeLessThan(400);
  });

  test('GET /dine-in/session/orders — p95 < 500ms (P0 poll path)', async ({ request }) => {
    if (!sessionId) { test.skip(); return; }
    const { samples, errors } = await measureLatency(
      () => getSessionOrders(request, sessionId),
      SAMPLE_SIZE,
    );
    record(`GET /dine-in/session/orders`, samples, errors);
    const sorted = [...samples].sort((a, b) => a - b);
    expect(errors).toBe(0);
    expect(percentile(sorted, 95)).toBeLessThan(500);
  });

  test('POST /dine-in/order — p95 < 800ms', async ({ request, menuItemId }) => {
    if (!sessionId) { test.skip(); return; }
    let counter = 0;
    const { samples, errors } = await measureLatency(async () => {
      counter++;
      return placeDineInOrder(
        request, sessionId,
        `PerfOrderGuest${counter}`,
        `901${String(counter).padStart(7, '0')}`,
        [{ menu_item_id: menuItemId, quantity: 1 }],
      );
    }, 10); // Fewer samples — each creates a real order.
    record(`POST /dine-in/order`, samples, errors);
    const sorted = [...samples].sort((a, b) => a - b);
    expect(errors / (samples.length + errors)).toBeLessThan(0.05); // <5% error rate
    if (sorted.length) expect(percentile(sorted, 95)).toBeLessThan(800);
  });

  test('POST /dine-in/session/request-bill — p95 < 500ms', async ({ request }) => {
    if (!sessionId) { test.skip(); return; }
    const { samples, errors } = await measureLatency(
      // Idempotent — safe to call repeatedly.
      () => requestBill(request, sessionId, 'PerfBillGuest'),
      SAMPLE_SIZE,
    );
    record(`POST /dine-in/session/request-bill`, samples, errors);
    const sorted = [...samples].sort((a, b) => a - b);
    expect(errors).toBe(0);
    if (sorted.length) expect(percentile(sorted, 95)).toBeLessThan(500);
  });

  test('GET /tables — p95 < 600ms', async ({ request, staffToken }) => {
    const { samples, errors } = await measureLatency(
      () => request.get(`${API_URL}/v1/restaurants/${SLUG}/tables`, {
        headers: { Authorization: `Bearer ${staffToken}` },
      }),
      SAMPLE_SIZE,
    );
    record(`GET /tables`, samples, errors);
    const sorted = [...samples].sort((a, b) => a - b);
    expect(errors).toBe(0);
    if (sorted.length) expect(percentile(sorted, 95)).toBeLessThan(600);
  });
});

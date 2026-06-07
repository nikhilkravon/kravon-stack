# KRAVON Simulation Test Suite

Playwright-based end-to-end simulation of a full restaurant business day.

## Prerequisites

- Node.js ≥ 18
- Both servers running:
  - Backend:  `cd kravon-engine/backend  && npm start`   → `http://localhost:3000`
  - Frontend: `cd kravon-engine/frontend && npm start`   → `http://localhost:8000`
- Restaurant seeded: at least 1 table and 1 menu item in the `demo` tenant

## Setup

```bash
cd kravon-engine/tests
npm install
npx playwright install chromium
```

## Environment variables

| Variable               | Default                    | Description                     |
|------------------------|----------------------------|---------------------------------|
| `KRAVON_FRONTEND_URL`  | `http://localhost:8000`    | Static frontend origin          |
| `KRAVON_API_URL`       | `http://localhost:3000`    | Express backend origin          |
| `KRAVON_SLUG`          | `demo`                     | Restaurant slug                 |
| `KRAVON_STAFF_EMAIL`   | `owner@demo.com`           | Dashboard login email           |
| `KRAVON_STAFF_PASSWORD`| `password123`              | Dashboard login password        |

## Running the tests

```bash
# Full simulation (all scenarios + performance)
npm test

# Headed mode (watch the browsers)
npm run test:headed

# Single scenario
npx playwright test specs/scenarios/02-first-guest-scan

# Generate & view HTML report
npm test && npm run report
```

## Output

After a run, two files are written to `playwright-report/`:

| File                                 | Contents                                     |
|--------------------------------------|----------------------------------------------|
| `kravon-simulation-report.html`      | Executive HTML report with defect table      |
| `kravon-simulation-report.json`      | Machine-readable JSON for CI integration     |
| `index.html`                         | Standard Playwright HTML report              |

## Test structure

```
specs/
  scenarios/
    01-restaurant-opening.spec.ts    P0 — clean startup state
    02-first-guest-scan.spec.ts      P0 — session creation, bill owner
    03-multi-guest-join.spec.ts      P0 — concurrency, attribution
    04-lunch-rush.spec.ts            P0 — load (10 tables × 4 guests)
    05-live-session-feed.spec.ts     P1 — order feed visibility
    06-order-status-workflow.spec.ts P1 — full order lifecycle
    07-bill-request-stress.spec.ts   P0 — idempotency under spam
    08-staff-bill-handling.spec.ts   P2 — bill review, acknowledgement gap
    09-session-closure.spec.ts       P0 — state machine correctness
    10-table-reuse.spec.ts           P0 — session isolation between covers
    11-chaos-monkey.spec.ts          P0 — adversarial real-world behaviour
  performance/
    api-performance.spec.ts          P1 — endpoint latency (p95 thresholds)
    frontend-performance.spec.ts     P1 — polling stability, memory, LCP
```

## Success criteria

KRAVON passes if:

- No P0 defects
- No lost or duplicate orders
- No session ownership corruption
- No bill request duplication
- No customer data leakage between sessions
- Dashboard remains operational throughout
- Table lifecycle remains consistent

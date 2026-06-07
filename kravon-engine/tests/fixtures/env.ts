/** Central place for all environment-derived constants used across the suite. */

export const FRONTEND_URL  = process.env.KRAVON_FRONTEND_URL  || 'http://localhost:8000';
export const API_URL       = process.env.KRAVON_API_URL        || 'http://localhost:3000';
export const SLUG          = process.env.KRAVON_SLUG           || 'demo';
export const STAFF_EMAIL   = process.env.KRAVON_STAFF_EMAIL    || 'owner@demo.com';
export const STAFF_PASSWORD= process.env.KRAVON_STAFF_PASSWORD || 'password123';

/** URL the customer browser opens when they scan a table QR code. */
export function tableUrl(tableId: string): string {
  return `${FRONTEND_URL}/tables/?slug=${SLUG}&table_id=${tableId}`;
}

/** Staff dashboard tables view URL. */
export const DASHBOARD_URL = `${FRONTEND_URL}/dashboard/?slug=${SLUG}`;

#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════════
   KRAVON V9 — CONFIG VALIDATOR
   Run: node scripts/validate-config.js --slug <restaurant-slug>
        node scripts/validate-config.js --slug burger-house --api http://localhost:3000

   Fetches the live config from GET /config and validates against V9 spec.
   Exits 0 on pass, 1 on failures.

   Checks:
     1. Required top-level keys
     2. Brand completeness
     3. Contact (waNumber format)
     4. Products flags
     5. Tables config (if has_tables)
     6. Menu — categories, items, prices
     7. Deployment readiness
   ═══════════════════════════════════════════════════════════════════ */

'use strict';

const G = s => `\x1b[32m${s}\x1b[0m`;
const R = s => `\x1b[31m${s}\x1b[0m`;
const Y = s => `\x1b[33m${s}\x1b[0m`;
const D = s => `\x1b[2m${s}\x1b[0m`;
const B = s => `\x1b[1m${s}\x1b[0m`;

let passed = 0, failed = 0, warned = 0;
function pass(name, detail) { passed++; console.log(`  ${G('✓')} ${name}${detail ? D(' · ' + detail) : ''}`); }
function fail(name, detail) { failed++; console.log(`  ${R('✗')} ${B(name)}${detail ? ' — ' + R(detail) : ''}`); }
function warn(name, detail) { warned++; console.log(`  ${Y('!')} ${name}${detail ? ' — ' + Y(detail) : ''}`); }
function section(t) { console.log(`\n${B(t)}\n${'─'.repeat(56)}`); }

function arg(name, def) {
  const idx = process.argv.indexOf(`--${name}`);
  return idx !== -1 && process.argv[idx + 1] ? process.argv[idx + 1] : def;
}

const slug    = arg('slug', '');
const apiBase = arg('api', process.env.KRAVON_API_URL || 'https://api.kravon.in');

if (!slug) {
  console.error('Usage: node scripts/validate-config.js --slug <restaurant-slug>');
  process.exit(1);
}

async function main() {
  const url = `${apiBase}/v1/restaurants/${slug}/config`;
  console.log(D(`\nFetching: ${url}`));
  const res = await fetch(url);
  if (!res.ok) { console.error(R(`HTTP ${res.status}`)); process.exit(1); }
  const data = await res.json();
  if (!data.ok || !data.config) { console.error(R('Invalid config response')); process.exit(1); }
  const C = data.config;

  console.log(`\n${B('KRAVON V10 — Config Validator')}  ${D(C.brand?.name || slug)}`);

  section('1 · Required top-level keys');
  ['brand', 'contact', 'hours', 'products', 'menu'].forEach(k => {
    C[k] != null ? pass(`"${k}" present`) : fail(`"${k}" missing`);
  });

  section('2 · Brand');
  ['name', 'tagline'].forEach(k =>
    C.brand?.[k] ? pass(`brand.${k}`) : fail(`brand.${k} missing`)
  );
  C.brand?.year ? pass('brand.year', C.brand.year) : warn('brand.year not set');
  if (C.brand?.accent) {
    /^#[0-9a-fA-F]{6}$/.test(C.brand.accent)
      ? pass('brand.accent valid', C.brand.accent)
      : fail('brand.accent not valid hex', C.brand.accent);
  } else {
    warn('brand.accent not set — using default');
  }

  section('3 · Contact');
  C.contact?.phone ? pass('contact.phone') : fail('contact.phone missing');
  const wa = C.contact?.waNumber;
  if (wa) {
    /^\d{10,13}$/.test(wa)
      ? pass('contact.waNumber valid', wa)
      : fail('contact.waNumber must be digits only, no +, 10–13 chars', wa);
  } else {
    fail('contact.waNumber missing — WhatsApp will not fire');
  }
  C.contact?.address ? pass('contact.address') : warn('contact.address not set');

  section('4 · Products flags');
  const p = C.products || {};
  ['presence', 'tables', 'orders', 'catering', 'insights'].forEach(k =>
    typeof p[k] === 'boolean'
      ? pass(`products.${k}`, String(p[k]))
      : warn(`products.${k} not set`)
  );
  if (!p.presence && !p.tables && !p.orders && !p.catering) {
    fail('No products enabled — nothing will be served');
  }

  if (p.tables) {
    section('5 · Tables config');
    const t = C.tables;
    if (!t) {
      fail('tables block missing from /config response');
    } else {
      ['offline', 'razorpay'].includes(t.paymentMode)
        ? pass('tables.paymentMode valid', t.paymentMode)
        : fail('tables.paymentMode must be "offline" or "razorpay"', String(t.paymentMode));

      if (t.paymentMode === 'razorpay') {
        t.razorpayKeyId && /^rzp_(live|test)_/.test(t.razorpayKeyId)
          ? pass('tables.razorpayKeyId valid format')
          : fail('tables.razorpayKeyId missing or wrong format (rzp_live_... or rzp_test_...)');
      }

      const thresh = t.reviewThreshold;
      Number.isInteger(thresh) && thresh >= 1 && thresh <= 5
        ? pass('tables.reviewThreshold valid', String(thresh))
        : fail('tables.reviewThreshold must be integer 1–5', String(thresh));

      if (t.googleReviewUrl) {
        try { new URL(t.googleReviewUrl); pass('tables.googleReviewUrl valid URL'); }
        catch { fail('tables.googleReviewUrl not a valid URL', t.googleReviewUrl); }
      } else {
        warn('tables.googleReviewUrl not set — above-threshold ratings skip Google nudge');
      }
    }
  } else {
    section('5 · Tables config');
    console.log(D('  (skipped — has_tables is false)'));
  }

  section('6 · Menu');
  const menu = C.menu || [];
  menu.length > 0 ? pass(`${menu.length} categories`) : fail('no categories');

  let totalItems = 0, priceErrors = 0, nameErrors = 0;
  menu.forEach(cat => {
    if (!cat.name) fail(`category id=${cat.id} has no name`);
    (cat.items || []).forEach(item => {
      totalItems++;
      if (!item.name) nameErrors++;
      if (!Number.isInteger(item.price) || item.price <= 0) priceErrors++;
    });
  });

  totalItems > 0 ? pass(`${totalItems} total items`) : fail('no items in any category');
  priceErrors === 0 ? pass('all prices valid') : fail(`${priceErrors} item(s) have invalid price`);
  nameErrors  === 0 ? pass('all items have names') : fail(`${nameErrors} item(s) missing name`);

  section('7 · Deployment readiness');
  const demoPhones = ['9999999999', '1234567890', '0000000000'];
  const phoneDigits = (C.contact?.phone || '').replace(/\D/g, '');
  demoPhones.includes(phoneDigits)
    ? warn('contact.phone looks like a demo number')
    : pass('contact.phone not demo');

  const waDigits = C.contact?.waNumber || '';
  demoPhones.some(d => waDigits.endsWith(d.slice(-7)))
    ? warn('contact.waNumber looks like a demo number')
    : pass('contact.waNumber not demo');

  C.hours?.display ? pass('hours.display set') : warn('hours.display not set');

  console.log(`\n${'═'.repeat(56)}`);
  console.log(`  ${G(passed + ' passed')}  ${failed > 0 ? R(failed + ' failed') : D('0 failed')}  ${warned > 0 ? Y(warned + ' warnings') : D('0 warnings')}`);

  if (failed === 0) { console.log(`\n  ${G('✓')} ${B('Ready to deploy.')}\n`); process.exit(0); }
  else              { console.log(`\n  ${R('✗')} ${B('Fix failures before deploying.')}\n`); process.exit(1); }
}

main().catch(err => { console.error(R(`\nValidator error: ${err.message}`)); process.exit(1); });

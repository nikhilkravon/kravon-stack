'use strict';
// Quick targeted run: just place the online order and screenshot confirmation
const pw = require('C:/Users/Nikhil/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/playwright');
const { chromium } = pw;
const { mkdirSync } = require('fs');
const { join } = require('path');

const BASE  = 'http://localhost:8000';
const SHOTS = 'C:/Users/Nikhil/KravonSAAS/kravon-stack/scenario_screenshots';
mkdirSync(SHOTS, { recursive: true });

let idx = 28;
async function shot(page, label) {
  const file = join(SHOTS, `${String(++idx).padStart(3,'0')}_${label}.png`);
  await page.screenshot({ path: file, fullPage: false });
  console.log(`  📸 ${idx}. ${label}`);
}

(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const ctx  = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();

  console.log('Loading orders page…');
  await page.goto(`${BASE}/orders/?slug=royal-tandoor`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => !document.body.hasAttribute('data-loading'), { timeout: 10000 });
  await page.waitForTimeout(800);

  // Add items via JS
  const added = await page.evaluate(() => {
    const items = window.MENU?.flatMap(c => c.items) || [];
    let count = 0;
    for (const item of items) {
      if (count >= 2) break;
      window.Cart.addItem(item.id, item.name, item.price, '');
      count++;
    }
    window.UI.renderCart();
    return items.slice(0,2).map(i => i.name + ' ₹'+i.price);
  });
  console.log('Added:', added);
  await page.waitForTimeout(400);

  // Fill form
  await page.evaluate(() => {
    document.getElementById('fieldName').value = 'Rahul Sharma';
    document.getElementById('fieldPhone').value = '9876543210';
    document.getElementById('fieldAddress').value = '42 MG Road, Flat 3B';
    document.getElementById('fieldLocality').value = 'Indiranagar';
  });

  // Click checkout
  await page.evaluate(() => document.querySelector('[data-action="go-to-checkout"]').click());
  await page.waitForTimeout(600);
  await page.evaluate(() => window.scrollTo(0,0));
  await shot(page, 'A_checkout_screen');

  // Select COD
  await page.evaluate(() => {
    const opts = Array.from(document.querySelectorAll('.pay-opt'));
    const cod = opts.find(o => /cod/i.test(o.dataset.paymentId));
    (cod || opts[opts.length-1]).click();
  });
  await page.waitForTimeout(200);

  // Place order
  console.log('Placing order…');
  await page.evaluate(() => document.querySelector('[data-action="place-order"]').click());
  await page.waitForTimeout(5000);
  await page.evaluate(() => window.scrollTo(0,0));

  const confirmed = await page.locator('#screenConfirm').isVisible().catch(() => false);
  const orderId   = await page.locator('#confirmOrderId').textContent().catch(() => '—');
  console.log(`Confirmed: ${confirmed}  ID: ${orderId?.trim()}`);
  await shot(page, 'A_confirmation_screen');

  if (confirmed) {
    // Rate 5 stars
    await page.evaluate(() => {
      const stars = document.querySelectorAll('.confirm-star');
      if (stars[4]) stars[4].click();
    });
    await page.waitForTimeout(500);
    await shot(page, 'A_review_stars');

    // Check google review prompt
    const googleVisible = await page.locator('#confirmReviewGoogle').isVisible().catch(() => false);
    console.log(`Google review prompt: ${googleVisible}`);
    if (googleVisible) await shot(page, 'A_google_review_nudge');
  }

  await browser.close();
  console.log('Done.');
})();

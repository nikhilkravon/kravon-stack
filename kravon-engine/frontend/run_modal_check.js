'use strict';
// Quick check: open customisation modal for an item with variants, screenshot it
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

  // ── Orders modal check ──
  {
    const ctx  = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await ctx.newPage();
    console.log('\n[Orders] Loading…');
    await page.goto(`${BASE}/orders/?slug=royal-tandoor`, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => !document.body.hasAttribute('data-loading'), { timeout:10000 });
    await page.waitForTimeout(600);

    // Find item with open-modal trigger (Tandoori Chicken has variants)
    const modalBtns = await page.locator('[data-action="open-modal"]').count();
    console.log(`  Modal-trigger items: ${modalBtns}`);
    if (modalBtns > 0) {
      // Click first one (likely Chicken Tikka or similar)
      await page.locator('[data-action="open-modal"]').first().click();
      await page.waitForTimeout(1000); // async fetch
      const isOpen = await page.locator('#customModal.open').count() > 0;
      console.log(`  Modal open: ${isOpen}`);
      const variants = await page.locator('#modalVariants .option-row').count();
      const customs  = await page.locator('#modalCustomizations .modal-group').count();
      console.log(`  Variants: ${variants}  Customization groups: ${customs}`);
      await shot(page, 'MODAL_orders_variants');
      // Select second variant if exists
      if (variants > 1) {
        await page.locator('#modalVariants input[type=radio]').nth(1).click();
        const btnText = await page.locator('#modalAddBtn').textContent().catch(()=>'');
        console.log(`  After selecting variant 2: "${btnText?.trim()}"`);
        await shot(page, 'MODAL_orders_variant_selected');
      }
    }

    // Also place full COD order
    console.log('\n[Orders] Placing full order…');
    await page.evaluate(() => {
      const items = (typeof MENU !== 'undefined' ? MENU : window.MENU)?.flatMap(c => c.items) || [];
      const cart  = typeof Cart !== 'undefined' ? Cart : window.Cart;
      const ui    = typeof UI   !== 'undefined' ? UI   : window.UI;
      for (const item of items.slice(0,2)) {
        cart.addItem(item.id, item.name, item.price, '');
      }
      ui.renderCart();
    });
    await page.evaluate(() => {
      ['fieldName','fieldPhone','fieldAddress','fieldLocality'].forEach((id,i) => {
        const el = document.getElementById(id);
        if (el) el.value = ['Rahul Sharma','9876543210','42 MG Road','Indiranagar'][i];
      });
    });
    await page.evaluate(() => document.querySelector('[data-action="go-to-checkout"]')?.click());
    await page.waitForTimeout(600);
    await page.evaluate(() => {
      const opts = Array.from(document.querySelectorAll('.pay-opt'));
      const cod = opts.find(o=>/cod/i.test(o.dataset.paymentId));
      (cod||opts[opts.length-1])?.click();
    });
    await page.evaluate(() => document.querySelector('[data-action="place-order"]')?.click());
    await page.waitForTimeout(4000);
    await page.evaluate(() => window.scrollTo(0,0));
    const confirmed = await page.locator('#confirmOrderId').isVisible().catch(()=>false);
    const orderId   = await page.locator('#confirmOrderId').textContent().catch(()=>'—');
    console.log(`  Order confirmed: ${confirmed}  ID: ${orderId?.trim()}`);
    await shot(page, 'ORDER_confirmed');
    if (confirmed) {
      await page.evaluate(() => document.querySelectorAll('.confirm-star')[4]?.click());
      await page.waitForTimeout(500);
      await shot(page, 'ORDER_review_5stars');
    }
    await ctx.close();
  }

  // ── Tables modal check ──
  {
    const ctx  = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await ctx.newPage();
    console.log('\n[Tables] Loading…');
    await page.goto(`${BASE}/tables/?slug=royal-tandoor&table=5`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1500);

    // Click Dining In
    const diningIn = page.locator('[data-action="select-dining-mode"], button', { hasText: /dining in/i }).first();
    if (await diningIn.isVisible().catch(()=>false)) {
      await diningIn.click();
      await page.waitForTimeout(600);
      console.log('  Clicked Dining In');
    }
    await shot(page, 'TABLES_after_dining_in_click');

    // Add customisable item via JS
    const addedCustom = await page.evaluate(() => {
      const items = (window.MENU||[]).flatMap(c=>c.items);
      const custom = items.find(i=>i.customise||i.is_customizable);
      if (!custom) return null;
      // Trigger the modal open
      const btn = document.querySelector(`[data-action="tables-open-modal"][data-item-id="${custom.id}"]`);
      if (btn) { btn.click(); return custom.name; }
      return 'btn-not-found:'+custom.name;
    });
    console.log(`  Opening modal for: "${addedCustom}"`);
    await page.waitForTimeout(1200); // async fetch
    const tablesModalOpen = await page.locator('#tablesCustomModal.open').count() > 0;
    console.log(`  Tables modal open: ${tablesModalOpen}`);
    if (tablesModalOpen) {
      const variants = await page.locator('#tablesModalVariants .option-row').count();
      const customs  = await page.locator('#tablesModalCustomizations .modal-group').count();
      console.log(`  Variants: ${variants}  Groups: ${customs}`);
      await shot(page, 'TABLES_modal_with_variants');
    } else {
      await shot(page, 'TABLES_modal_closed');
    }
    await ctx.close();
  }

  await browser.close();
  console.log('\nDone.');
})();

/**
 * Royal Tandoor — end-to-end ordering scenarios
 * Scenario A: Online delivery order
 * Scenario B: Dine-in (tables) order
 *
 * Run from: kravon-engine/frontend/
 *   node run_scenarios.mjs
 */

import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

const BASE  = 'http://localhost:8000';
const SHOTS = 'C:/Users/Nikhil/KravonSAAS/kravon-stack/scenario_screenshots';
mkdirSync(SHOTS, { recursive: true });

let shotIdx = 0;
async function shot(page, label) {
  const file = join(SHOTS, `${String(++shotIdx).padStart(3,'0')}_${label.replace(/[^a-z0-9]/gi,'_')}.png`);
  await page.screenshot({ path: file, fullPage: false });
  console.log(`  📸 ${file}`);
}

async function waitForContent(page, timeout = 8000) {
  await page.waitForFunction(() => !document.body.hasAttribute('data-loading'), { timeout });
}

// ─── SCENARIO A: Online Delivery Order ────────────────────────────────────────
async function scenarioOnlineOrder(browser) {
  console.log('\n══════════════════════════════════════════');
  console.log(' SCENARIO A — Online Delivery Order');
  console.log('══════════════════════════════════════════');

  const ctx  = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();

  // ── 1. Land on the orders page ──
  console.log('\n[1] Customer opens orders page…');
  await page.goto(`${BASE}/orders/?slug=royal-tandoor`, { waitUntil: 'networkidle' });
  await waitForContent(page);
  await shot(page, 'A01_orders_landing');

  const title = await page.title();
  console.log(`    Page title: "${title}"`);

  // ── 2. Verify hero is visible ──
  console.log('\n[2] Checking hero section…');
  const heroText = await page.locator('.orders-headline').first().textContent().catch(() => null);
  console.log(`    Hero headline: "${heroText?.trim()}"`);
  await shot(page, 'A02_hero_visible');

  // ── 3. Scroll through categories ──
  console.log('\n[3] Customer browses categories…');
  const cats = await page.locator('.cat-btn').allTextContents();
  console.log(`    Categories found: ${cats.map(c => c.trim()).join(', ')}`);
  await shot(page, 'A03_categories_sidebar');

  // ── 4. Click on a category ──
  console.log('\n[4] Customer clicks "Mains"…');
  const mainsBtn = page.locator('.cat-btn', { hasText: /main/i }).first();
  const hasMains = await mainsBtn.count();
  if (hasMains) {
    await mainsBtn.click();
    await page.waitForTimeout(600);
    await shot(page, 'A04_mains_category');
  } else {
    console.log('    (no Mains category, using first)');
    await page.locator('.cat-btn').first().click();
    await page.waitForTimeout(600);
    await shot(page, 'A04_first_category_click');
  }

  // ── 5. Add a non-customisable item to cart ──
  console.log('\n[5] Customer adds an item to cart…');
  // Find the first "Add" button visible in the menu grid
  const addBtn = page.locator('.add-btn').first();
  const addBtnVisible = await addBtn.isVisible().catch(() => false);
  let addedItemName = 'unknown';
  if (addBtnVisible) {
    const card = addBtn.locator('..').locator('..');  // up to item-footer → item-card
    addedItemName = await page.locator('.item-card').first().locator('.item-name').textContent().catch(() => 'item');
    console.log(`    Adding: "${addedItemName?.trim()}"`);
    await addBtn.click();
    await page.waitForTimeout(400);
    await shot(page, 'A05_item_added_to_cart');
  } else {
    console.log('    No add-btn found; checking for open-modal items…');
  }

  // ── 6. Add a second item ──
  console.log('\n[6] Customer adds a second item…');
  const addBtns = page.locator('.add-btn');
  const btnCount = await addBtns.count();
  console.log(`    Add buttons visible: ${btnCount}`);
  if (btnCount >= 2) {
    const secondItem = await page.locator('.item-card').nth(1).locator('.item-name').textContent().catch(() => 'item2');
    console.log(`    Adding: "${secondItem?.trim()}"`);
    await addBtns.nth(1).click();
    await page.waitForTimeout(400);
    await shot(page, 'A06_second_item_added');
  }

  // ── 7. Check cart state ──
  console.log('\n[7] Checking cart panel…');
  const cartCount = await page.locator('#cartCount').textContent().catch(() => '0');
  const cartTotal = await page.locator('#cartTotal').textContent().catch(() => '₹0');
  console.log(`    Cart items: ${cartCount}, Total: ${cartTotal}`);
  await shot(page, 'A07_cart_state');

  // ── 8. Try an item with customisation (open-modal) ──
  console.log('\n[8] Looking for customisable item…');
  const customBtns = page.locator('[data-action="open-modal"]');
  const customCount = await customBtns.count();
  console.log(`    Customisable items (modal trigger): ${customCount}`);
  if (customCount > 0) {
    const itemName = await customBtns.first().getAttribute('aria-label');
    console.log(`    Opening modal for: "${itemName}"`);
    await customBtns.first().click();
    await page.waitForTimeout(600);
    const modalOpen = await page.locator('#customModal.open').count();
    console.log(`    Modal opened: ${modalOpen > 0 ? 'YES ✓' : 'NO ✗'}`);
    await shot(page, 'A08_customisation_modal_open');

    if (modalOpen > 0) {
      // Interact with modal
      const modalTitle = await page.locator('.modal-title').first().textContent().catch(() => '');
      console.log(`    Modal item: "${modalTitle?.trim()}"`);

      // Check spice options
      const spiceBtns = await page.locator('.spice-btn').count();
      console.log(`    Spice buttons: ${spiceBtns}`);
      if (spiceBtns > 1) {
        await page.locator('.spice-btn').nth(1).click();
        console.log('    Selected spice level 2');
      }

      // Increase quantity
      await page.locator('[data-action="modal-qty-inc"]').click();
      const qty = await page.locator('#modalQty').textContent();
      console.log(`    Quantity set to: ${qty}`);
      await shot(page, 'A09_modal_customised');

      // Confirm add
      await page.locator('[data-action="modal-confirm"]').click();
      await page.waitForTimeout(400);
      const modalClosed = await page.locator('#customModal.open').count();
      console.log(`    Modal closed after confirm: ${modalClosed === 0 ? 'YES ✓' : 'NO ✗'}`);
      await shot(page, 'A10_modal_confirmed');
    }
  } else {
    console.log('    No customisable items found (all items use add-item action)');
    await shot(page, 'A08_no_custom_items');
  }

  // ── 9. Check min-order threshold ──
  console.log('\n[9] Checking min-order threshold…');
  const checkoutBtn = page.locator('#checkoutBtn');
  const checkoutVisible = await checkoutBtn.isVisible().catch(() => false);
  const checkoutDisabled = checkoutVisible ? await checkoutBtn.isDisabled().catch(() => false) : null;
  const minNote = await page.locator('#minOrderNote').textContent().catch(() => '');
  console.log(`    Checkout button visible: ${checkoutVisible}, disabled: ${checkoutDisabled}`);
  console.log(`    Min order note: "${minNote?.trim()}"`);
  await shot(page, 'A09_checkout_eligibility');

  // Add more items to clear min order if needed
  const remainingAddBtns = await page.locator('.add-btn').count();
  if (remainingAddBtns > 0 && checkoutDisabled) {
    console.log('    Adding more items to clear min order…');
    for (let i = 0; i < Math.min(3, remainingAddBtns); i++) {
      const visibleBtns = page.locator('.add-btn');
      const cnt = await visibleBtns.count();
      if (cnt > 0) {
        await visibleBtns.first().click();
        await page.waitForTimeout(200);
      }
    }
    await shot(page, 'A09b_more_items_added');
  }

  // ── 10. Proceed to checkout ──
  console.log('\n[10] Proceeding to checkout…');
  await page.waitForTimeout(500);
  const canCheckout = await checkoutBtn.isVisible().catch(() => false);
  const isDisabled  = canCheckout ? await checkoutBtn.isDisabled().catch(() => true) : true;
  if (canCheckout && !isDisabled) {
    await checkoutBtn.click();
    await page.waitForTimeout(700);
    const checkoutScreen = await page.locator('#screenCheckout.active').count().catch(() => 0) +
                           await page.locator('#screenCheckout').isVisible().catch(() => false);
    console.log(`    Checkout screen reached: ${checkoutScreen ? 'YES ✓' : 'checking…'}`);
    await shot(page, 'A10_checkout_screen');

    // ── 11. Fill delivery form ──
    console.log('\n[11] Filling delivery form…');
    await page.locator('#fieldName').fill('Rahul Sharma');
    await page.locator('#fieldPhone').fill('9876543210');
    await page.locator('#fieldAddress').fill('42 MG Road, Flat 3B');
    await page.locator('#fieldLocality').fill('Indiranagar');
    await shot(page, 'A11_form_filled');
    console.log('    Form filled: Rahul Sharma, 9876543210, 42 MG Road');

    // ── 12. Select delivery option ──
    console.log('\n[12] Selecting delivery option…');
    const deliveryOpts = await page.locator('.delivery-opt').count();
    console.log(`    Delivery options: ${deliveryOpts}`);
    if (deliveryOpts > 1) {
      await page.locator('.delivery-opt').nth(0).click();
      await shot(page, 'A12_delivery_selected');
    }

    // ── 13. Select payment method ──
    console.log('\n[13] Selecting payment method…');
    const payOpts = await page.locator('.pay-opt').allTextContents();
    console.log(`    Payment options: ${payOpts.map(p => p.trim().split('\n')[0]).join(', ')}`);
    // Select COD if available
    const codOpt = page.locator('.pay-opt', { hasText: /cash|cod/i }).first();
    const hasCOD = await codOpt.count();
    if (hasCOD) {
      await codOpt.click();
      console.log('    Selected: Cash on Delivery');
    } else {
      await page.locator('.pay-opt').first().click();
      console.log('    Selected: first payment option');
    }
    await shot(page, 'A13_payment_selected');

    // ── 14. Summary review ──
    console.log('\n[14] Reviewing order summary…');
    const summaryItems = await page.locator('#summaryItems').textContent().catch(() => '');
    const summaryTotal = await page.locator('#summaryTotal').textContent().catch(() => '');
    console.log(`    Summary total: ${summaryTotal}`);
    await shot(page, 'A14_order_summary');

    // ── 15. Place order ──
    console.log('\n[15] Placing order…');
    const placeBtn = page.locator('[data-action="place-order"]');
    const placeBtnVisible = await placeBtn.isVisible().catch(() => false);
    console.log(`    Place Order button visible: ${placeBtnVisible}`);
    if (placeBtnVisible) {
      await placeBtn.click();
      // Wait for either confirmation screen or error
      await page.waitForTimeout(3000);
      const confirmScreen = await page.locator('#screenConfirm').isVisible().catch(() => false);
      const orderId = await page.locator('#confirmOrderId').textContent().catch(() => '—');
      console.log(`    Confirmation screen: ${confirmScreen ? 'YES ✓' : 'NO (payment gateway or error)'}`);
      console.log(`    Order ID: ${orderId}`);
      await shot(page, 'A15_order_placed');
    }
  } else {
    console.log(`    Cannot proceed — checkout button not ready (visible: ${canCheckout}, disabled: ${isDisabled})`);
    await shot(page, 'A10_checkout_blocked');
  }

  await ctx.close();
  console.log('\n✓ Scenario A complete');
}

// ─── SCENARIO B: Dine-in (Tables) Order ───────────────────────────────────────
async function scenarioDineIn(browser) {
  console.log('\n══════════════════════════════════════════');
  console.log(' SCENARIO B — Dine-in (Tables) Order');
  console.log('══════════════════════════════════════════');

  const ctx  = await browser.newContext({ viewport: { width: 390, height: 844 } }); // mobile
  const page = await ctx.newPage();

  // ── 1. Customer scans QR → lands on tables page with table param ──
  console.log('\n[1] Customer scans QR code → tables page for Table 5…');
  await page.goto(`${BASE}/tables/?slug=royal-tandoor&table=5`, { waitUntil: 'networkidle' });
  await waitForContent(page).catch(() => {});
  await page.waitForTimeout(1500);
  await shot(page, 'B01_tables_landing');

  const title = await page.title();
  console.log(`    Page title: "${title}"`);

  // Check if there's a dine-in session check happening
  const bodyAttr = await page.evaluate(() => document.body.getAttribute('data-loading'));
  console.log(`    data-loading: ${bodyAttr}`);

  // ── 2. Check the ordering screen ──
  console.log('\n[2] Checking ordering screen loads…');
  const screenOrdering = await page.locator('#screenOrdering').isVisible().catch(() => false);
  console.log(`    Ordering screen visible: ${screenOrdering}`);
  await shot(page, 'B02_ordering_screen');

  // ── 3. Browse menu ──
  console.log('\n[3] Customer browses menu on mobile…');
  const cats = await page.locator('.cat-btn').allTextContents().catch(() => []);
  console.log(`    Categories: ${cats.map(c => c.trim()).filter(Boolean).slice(0, 5).join(', ')}`);

  // Scroll down to see items
  await page.evaluate(() => window.scrollBy(0, 300));
  await page.waitForTimeout(400);
  await shot(page, 'B03_menu_browsing');

  // ── 4. Check table context display ──
  console.log('\n[4] Checking table context display…');
  const tableCtxEls = await page.locator('[id*="table"],[class*="table-ctx"],[class*="table-id"]').allTextContents().catch(() => []);
  console.log(`    Table context elements: ${tableCtxEls.filter(Boolean).slice(0, 3).join(' | ')}`);

  // ── 5. Add item to cart ──
  console.log('\n[5] Customer adds items to cart…');
  const addBtns = page.locator('.add-btn');
  const addCount = await addBtns.count();
  console.log(`    Add buttons visible: ${addCount}`);

  if (addCount > 0) {
    const itemName = await page.locator('.item-card').first().locator('.item-name').textContent().catch(() => 'item');
    console.log(`    Adding: "${itemName?.trim()}"`);
    await addBtns.first().click();
    await page.waitForTimeout(400);
    await shot(page, 'B05_item_added');
  }

  // Add second item
  const addBtns2 = await page.locator('.add-btn').count();
  if (addBtns2 > 0) {
    const item2 = await page.locator('.item-card').nth(1).locator('.item-name').textContent().catch(() => 'item2');
    console.log(`    Adding: "${item2?.trim()}"`);
    await page.locator('.add-btn').first().click();
    await page.waitForTimeout(300);
  }

  // ── 6. Check mobile cart bar ──
  console.log('\n[6] Checking mobile cart bar…');
  const mobileCartBar = page.locator('#mobileCartBar');
  const cartBarVisible = await mobileCartBar.isVisible().catch(() => false);
  console.log(`    Mobile cart bar visible: ${cartBarVisible}`);
  if (cartBarVisible) {
    const cartLabel = await page.locator('#mobileCartLabel').textContent().catch(() => '');
    const cartTotal = await page.locator('#mobileCartTotal').textContent().catch(() => '');
    console.log(`    Cart: ${cartLabel?.trim()} — ${cartTotal?.trim()}`);
    await shot(page, 'B06_mobile_cart_bar');

    // Tap cart bar to open cart
    console.log('\n[7] Tapping cart bar to open cart panel…');
    await mobileCartBar.click();
    await page.waitForTimeout(500);
    await shot(page, 'B07_cart_panel_open');
  } else {
    await shot(page, 'B06_cart_bar_check');
  }

  // ── 8. Check for customisable items ──
  console.log('\n[8] Checking for customisable items…');
  const customBtns = page.locator('[data-action="tables-open-modal"]');
  const customCount = await customBtns.count();
  console.log(`    Customisable items: ${customCount}`);
  if (customCount > 0) {
    console.log('    Opening tables modal…');
    await customBtns.first().click();
    await page.waitForTimeout(600);
    const modalOpen = await page.locator('#tablesCustomModal.open').count();
    console.log(`    Tables modal opened: ${modalOpen > 0 ? 'YES ✓' : 'NO ✗'}`);
    await shot(page, 'B08_tables_modal');
    if (modalOpen > 0) {
      await page.locator('[data-action="tables-modal-confirm"]').click().catch(() =>
        page.locator('[data-action="tables-close-modal"]').click()
      );
    }
  } else {
    console.log('    No customisable items (or action name differs)');
    await shot(page, 'B08_no_custom_items');
  }

  // ── 9. Proceed to checkout ──
  console.log('\n[9] Scrolling to checkout button…');
  await page.evaluate(() => document.querySelector('#checkoutBtn, [data-action="go-to-checkout"]')?.scrollIntoView());
  await page.waitForTimeout(400);
  await shot(page, 'B09_pre_checkout');

  const checkoutBtn = page.locator('[data-action="go-to-checkout"]').first();
  const canCheckout = await checkoutBtn.isVisible().catch(() => false);
  const isDisabled  = canCheckout ? await checkoutBtn.isDisabled().catch(() => true) : true;
  console.log(`    Checkout button: visible=${canCheckout}, disabled=${isDisabled}`);

  if (canCheckout && !isDisabled) {
    await checkoutBtn.click();
    await page.waitForTimeout(700);
    await shot(page, 'B10_checkout_screen');
    console.log('    ✓ Reached checkout screen');

    // ── 10. Fill minimal dine-in form ──
    console.log('\n[10] Filling dine-in form…');
    const nameField = page.locator('#fieldName, [id*="Name"]').first();
    const phoneField = page.locator('#fieldPhone, [id*="Phone"]').first();
    if (await nameField.isVisible().catch(() => false)) {
      await nameField.fill('Priya Mehta');
      console.log('    Name: Priya Mehta');
    }
    if (await phoneField.isVisible().catch(() => false)) {
      await phoneField.fill('9123456780');
      console.log('    Phone: 9123456780');
    }
    await shot(page, 'B10_form_filled');

    // ── 11. Select payment (offline for dine-in) ──
    console.log('\n[11] Selecting payment…');
    const payOpts = page.locator('.pay-opt');
    const payCount = await payOpts.count();
    console.log(`    Payment options: ${payCount}`);
    if (payCount > 0) {
      // Try to pick offline/cash
      const offlineOpt = page.locator('.pay-opt', { hasText: /cash|offline|pay at/i }).first();
      const hasOffline = await offlineOpt.count();
      if (hasOffline) {
        await offlineOpt.click();
        console.log('    Selected: Pay at table');
      } else {
        await payOpts.first().click();
      }
      await shot(page, 'B11_payment_selected');
    }

    // ── 12. Place order ──
    console.log('\n[12] Placing dine-in order…');
    const placeBtn = page.locator('[data-action="place-order"]');
    if (await placeBtn.isVisible().catch(() => false)) {
      await placeBtn.click();
      await page.waitForTimeout(3000);
      const confirmVisible = await page.locator('#screenConfirm').isVisible().catch(() => false);
      const orderId = await page.locator('#confirmOrderId').textContent().catch(() => '—');
      console.log(`    Confirmation: ${confirmVisible ? 'YES ✓' : 'pending/gateway'}`);
      console.log(`    Order ID: ${orderId}`);
      await shot(page, 'B12_order_confirmed');
    }
  } else {
    console.log('    Checkout blocked — adding more items…');
    const extraBtns = await page.locator('.add-btn').count();
    for (let i = 0; i < Math.min(3, extraBtns); i++) {
      await page.locator('.add-btn').first().click().catch(() => {});
      await page.waitForTimeout(200);
    }
    await shot(page, 'B09b_extra_items');
  }

  await ctx.close();
  console.log('\n✓ Scenario B complete');
}

// ─── Main ─────────────────────────────────────────────────────────────────────
(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });

  try {
    await scenarioOnlineOrder(browser);
    await scenarioDineIn(browser);
  } finally {
    await browser.close();
    console.log(`\n📁 Screenshots saved to: ${SHOTS}`);
    console.log('   Done.\n');
  }
})();

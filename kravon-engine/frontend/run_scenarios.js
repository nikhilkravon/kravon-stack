/**
 * Royal Tandoor — end-to-end ordering scenarios
 * Scenario A: Online delivery order
 * Scenario B: Dine-in (tables) order
 */

'use strict';

const pw    = require('C:/Users/Nikhil/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/playwright');
const { chromium } = pw;
const { mkdirSync } = require('fs');
const { join } = require('path');

const BASE  = 'http://localhost:8000';
const SHOTS = 'C:/Users/Nikhil/KravonSAAS/kravon-stack/scenario_screenshots';
mkdirSync(SHOTS, { recursive: true });

let shotIdx = 0;
async function shot(page, label) {
  const file = join(SHOTS, `${String(++shotIdx).padStart(3,'0')}_${label.replace(/[^a-z0-9]/gi,'_')}.png`);
  await page.screenshot({ path: file, fullPage: false });
  console.log(`  📸 ${shotIdx}. ${label}`);
}

async function waitForContent(page, timeout = 10000) {
  await page.waitForFunction(() => !document.body.hasAttribute('data-loading'), { timeout });
}

// ─── SCENARIO A: Online Delivery Order ────────────────────────────────────────
async function scenarioOnlineOrder(browser) {
  console.log('\n══════════════════════════════════════════');
  console.log(' SCENARIO A — Online Delivery Order');
  console.log('══════════════════════════════════════════');

  const ctx  = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();

  // ── 1. Land on orders page ──
  console.log('\n[1] Customer opens Royal Tandoor orders page…');
  await page.goto(`${BASE}/orders/?slug=royal-tandoor`, { waitUntil: 'networkidle' });
  await waitForContent(page).catch(() => {});
  await page.waitForTimeout(1000);
  await shot(page, 'A01_orders_landing');
  console.log(`    Title: "${await page.title()}"`);

  // ── 2. Hero + brand ──
  console.log('\n[2] Reading hero content…');
  const headline = await page.locator('.orders-headline').first().textContent().catch(() => '—');
  const navBrand  = await page.locator('.nav-logo').first().textContent().catch(() => '—');
  console.log(`    Brand: "${navBrand?.trim()}"  Headline: "${headline?.trim()}"`);
  await shot(page, 'A02_hero_and_nav');

  // ── 3. Categories sidebar ──
  console.log('\n[3] Customer reads menu categories…');
  await page.waitForSelector('.cat-btn', { timeout: 5000 }).catch(() => {});
  const cats = await page.locator('.cat-btn').allTextContents();
  console.log(`    Categories (${cats.length}): ${cats.map(c => c.trim()).join(' | ')}`);
  await shot(page, 'A03_categories');

  // ── 4. Scroll to Biryani or Mains ──
  console.log('\n[4] Customer taps "Biryani" category…');
  const biryaniBtn = page.locator('.cat-btn', { hasText: /biryani|main/i }).first();
  const hasBiryani = await biryaniBtn.count();
  if (hasBiryani) {
    await biryaniBtn.click();
    await page.waitForTimeout(700);
    await shot(page, 'A04_biryani_section');
    console.log('    Scrolled to Biryani section');
  } else {
    await page.locator('.cat-btn').nth(1).click();
    await page.waitForTimeout(700);
    await shot(page, 'A04_second_category');
    console.log('    Scrolled to second category');
  }

  // ── 5. Read menu items visible ──
  console.log('\n[5] Reading menu items in view…');
  const itemNames = await page.locator('.item-name').allTextContents();
  console.log(`    Items visible: ${itemNames.slice(0,5).map(n=>n.trim()).join(', ')}…`);
  const prices    = await page.locator('.item-price').allTextContents();
  console.log(`    Prices: ${prices.slice(0,5).map(p=>p.trim()).join(', ')}`);

  // ── 6. Add first item ──
  console.log('\n[6] Customer adds "Paneer Tikka" (or first add-btn item)…');
  const addBtns = page.locator('.add-btn');
  const addCount = await addBtns.count();
  console.log(`    Add buttons: ${addCount}`);

  if (addCount > 0) {
    const firstCard = page.locator('.item-card').first();
    const firstName = await firstCard.locator('.item-name').textContent().catch(() => 'item');
    console.log(`    Adding: "${firstName?.trim()}"`);
    await addBtns.first().click();
    await page.waitForTimeout(400);
    await shot(page, 'A06_first_item_added');

    // Check the card updated (qty stepper should appear)
    const hasQtyCtrl = await firstCard.locator('.item-qty-ctrl').count();
    console.log(`    Qty stepper appeared: ${hasQtyCtrl > 0 ? 'YES ✓' : 'NO'}`);
  }

  // ── 7. Add a second item ──
  console.log('\n[7] Adding a second item…');
  const addBtns2 = page.locator('.add-btn');
  const cnt2 = await addBtns2.count();
  if (cnt2 > 0) {
    const secondCard = page.locator('.item-card').filter({ has: page.locator('.add-btn') }).first();
    const name2 = await secondCard.locator('.item-name').textContent().catch(() => 'item2');
    console.log(`    Adding: "${name2?.trim()}"`);
    await addBtns2.first().click();
    await page.waitForTimeout(300);
  }

  // ── 8. Try customisable item ──
  console.log('\n[8] Looking for customisable item (modal trigger)…');
  const modalBtns = page.locator('[data-action="open-modal"]');
  const modalCount = await modalBtns.count();
  console.log(`    Items with modal: ${modalCount}`);

  if (modalCount > 0) {
    const label = await modalBtns.first().getAttribute('aria-label').catch(() => 'item');
    console.log(`    Opening: "${label}"`);
    await modalBtns.first().click();
    await page.waitForTimeout(800);
    const modalOpen = await page.locator('#customModal.open').count();
    console.log(`    Modal open: ${modalOpen > 0 ? '✓ YES' : '✗ NO'}`);
    await shot(page, 'A08_customisation_modal');

    if (modalOpen > 0) {
      const mTitle = await page.locator('#modalItemName').textContent().catch(() => '');
      const mPrice = await page.locator('#modalItemPrice').textContent().catch(() => '');
      console.log(`    Item: "${mTitle?.trim()}" @ ${mPrice?.trim()}`);

      // Check spice levels
      const spiceBtns = await page.locator('.spice-btn').count();
      console.log(`    Spice options: ${spiceBtns}`);
      if (spiceBtns > 1) {
        await page.locator('.spice-btn').nth(1).click();
        console.log('    → Spice level 2 selected');
      }

      // Check add-ons
      const addonRows = await page.locator('#modalAddons .option-row').count();
      console.log(`    Add-on rows: ${addonRows}`);
      if (addonRows > 0) {
        await page.locator('#modalAddons .option-row').first().click();
        console.log('    → First add-on toggled');
      }

      // Bump qty
      await page.locator('[data-action="modal-qty-inc"]').click();
      const qty = await page.locator('#modalQty').textContent().catch(() => '1');
      console.log(`    Qty: ${qty}`);

      const btnText = await page.locator('#modalAddBtn').textContent().catch(() => '');
      console.log(`    Add btn text: "${btnText?.trim()}"`);
      await shot(page, 'A09_modal_with_options');

      await page.locator('[data-action="modal-confirm"]').click();
      await page.waitForTimeout(500);
      const closed = (await page.locator('#customModal.open').count()) === 0;
      console.log(`    Modal closed: ${closed ? '✓' : '✗'}`);
      await shot(page, 'A10_back_to_menu');
    }
  } else {
    await shot(page, 'A08_no_custom_items');
    console.log('    No customisable items found');
  }

  // ── 9. Cart summary ──
  console.log('\n[9] Cart state…');
  const cartCount = await page.locator('#cartCount').textContent().catch(() => '0');
  const cartTotal = await page.locator('#cartTotal').textContent().catch(() => '?');
  const subtotal  = await page.locator('#cartSubtotal').textContent().catch(() => '?');
  console.log(`    Items: ${cartCount}  Subtotal: ${subtotal}  Total: ${cartTotal}`);

  const minNote = await page.locator('#minOrderNote').textContent().catch(() => '');
  if (minNote.trim()) console.log(`    Min order note: "${minNote.trim()}"`);
  await shot(page, 'A11_cart_summary');

  // ── 10. Fill delivery form in cart panel FIRST (validation runs before screen switch) ──
  console.log('\n[10] Filling delivery form in cart panel…');
  await page.locator('#fieldName').fill('Rahul Sharma').catch(() => {});
  await page.locator('#fieldPhone').fill('9876543210').catch(() => {});
  await page.locator('#fieldAddress').fill('42 MG Road, Flat 3B').catch(() => {});
  await page.locator('#fieldLocality').fill('Indiranagar').catch(() => {});
  await page.locator('#fieldLandmark').fill('Near HDFC Bank').catch(() => {});
  console.log('    Filled: Rahul Sharma | 9876543210 | 42 MG Road, Indiranagar');
  await shot(page, 'A12_form_in_cart_panel');

  // ── 11. Now click Checkout (transitions to screenCheckout) ──
  console.log('\n[11] Clicking "Proceed to Checkout"…');
  const checkoutBtn = page.locator('[data-action="go-to-checkout"]').first();
  const btnVisible  = await checkoutBtn.isVisible().catch(() => false);
  const btnDisabled = btnVisible ? await checkoutBtn.isDisabled().catch(() => false) : true;
  console.log(`    Checkout btn: visible=${btnVisible} disabled=${btnDisabled}`);

  if (btnVisible && !btnDisabled) {
    await checkoutBtn.click();
    await page.waitForTimeout(800);
    // showScreen() calls window.scrollTo(0,0) itself, but ensure we're at top
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
    await page.waitForTimeout(300);
    const onCheckout = await page.locator('#screenCheckout.active').count();
    console.log(`    screenCheckout active: ${onCheckout > 0 ? '✓' : '✗'}`);
    await shot(page, 'A13_checkout_screen');

    // ── 12. Delivery option ──
    console.log('\n[12] Selecting delivery type…');
    const delivOpts = await page.locator('.delivery-opt').allTextContents();
    console.log(`    Options: ${delivOpts.map(o => o.trim().split('\n').filter(Boolean)[0]).join(' | ')}`);
    await page.locator('.delivery-opt').first().click().catch(() => {});
    await shot(page, 'A14_delivery_option');

    // ── 13. Payment ──
    console.log('\n[13] Selecting payment…');
    await page.evaluate(() => {
      const el = document.querySelector('#paymentOptions');
      if (el) el.scrollIntoView({ behavior: 'instant', block: 'center' });
    });
    await page.waitForTimeout(300);
    const payTexts = await page.locator('.pay-opt').allTextContents();
    console.log(`    Options: ${payTexts.map(p => p.trim().split('\n').filter(Boolean)[0]).join(' | ')}`);

    const clicked = await page.evaluate(() => {
      const opts = Array.from(document.querySelectorAll('.pay-opt'));
      const cod = opts.find(o => /cash|cod/i.test(o.textContent));
      const target = cod || opts[opts.length - 1];
      if (target) { target.click(); return target.dataset.paymentId || 'clicked'; }
      return null;
    });
    console.log(`    Payment selected: "${clicked}"`);
    await shot(page, 'A15_payment_selected');

    // ── 14. Order summary ──
    console.log('\n[14] Order summary…');
    await page.evaluate(() => {
      const el = document.querySelector('#summaryItems');
      if (el) el.scrollIntoView({ behavior: 'instant', block: 'start' });
    });
    const summItems = await page.locator('#summaryItems .summary-item').count();
    const summTotal = await page.locator('#summaryTotal').textContent().catch(() => '?');
    console.log(`    Summary items: ${summItems}  Total: ${summTotal?.trim()}`);
    await shot(page, 'A16_order_summary');

    // ── 15. Place order ──
    console.log('\n[15] Placing order (COD)…');
    const placeBtn = page.locator('[data-action="place-order"]');
    await page.evaluate(() => {
      const el = document.querySelector('[data-action="place-order"]');
      if (el) el.scrollIntoView({ behavior: 'instant', block: 'center' });
    });
    await page.waitForTimeout(300);
    if (await placeBtn.isVisible().catch(() => false)) {
      await placeBtn.click();
      // COD → immediate confirmation screen (no Razorpay modal)
      await page.waitForTimeout(4000);
      await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
      const confirmVisible = await page.locator('#screenConfirm.active').count() > 0
        || await page.locator('#screenConfirm').isVisible().catch(() => false);
      const orderId = await page.locator('#confirmOrderId').textContent().catch(() => '—');
      console.log(`    Confirmation screen: ${confirmVisible ? '✓' : '✗'}`);
      console.log(`    Order ID: "${orderId?.trim()}"`);
      await shot(page, 'A17_confirmation');

      if (confirmVisible) {
        const confName  = await page.locator('#confirmName').textContent().catch(() => '');
        const confTotal = await page.locator('#confirmTotal').textContent().catch(() => '');
        const confETA   = await page.locator('#confirmETA').textContent().catch(() => '');
        console.log(`    For: ${confName?.trim()} | Total: ${confTotal?.trim()} | ETA: ${confETA?.trim()}`);

        const waBtn = await page.locator('[data-action="track-order"]').isVisible().catch(() => false);
        console.log(`    Track on WhatsApp: ${waBtn ? '✓' : '✗'}`);

        const reviewVisible = await page.locator('#confirmReview').isVisible().catch(() => false);
        console.log(`    Review prompt: ${reviewVisible ? '✓' : '✗'}`);
        if (reviewVisible) {
          await page.locator('.confirm-star[data-stars="5"]').click().catch(() => {});
          await page.waitForTimeout(500);
          await shot(page, 'A18_5star_review');
        }
      }
    } else {
      console.log('    Place Order button not visible');
      await shot(page, 'A15_place_order_missing');
    }
  } else {
    console.log('    Checkout button not clickable — showing cart state');
    await shot(page, 'A12_cart_blocked');
  }

  await ctx.close();
  console.log('\n✅ Scenario A complete');
}

// ─── SCENARIO B: Dine-in (Tables) ─────────────────────────────────────────────
async function scenarioDineIn(browser) {
  console.log('\n══════════════════════════════════════════');
  console.log(' SCENARIO B — Dine-in / Tables');
  console.log('══════════════════════════════════════════');

  // Use mobile viewport — dine-in is mostly used on phones
  const ctx  = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();

  // ── 1. Customer scans QR → lands on tables ──
  console.log('\n[1] Customer scans QR → tables page, Table 5…');
  await page.goto(`${BASE}/tables/?slug=royal-tandoor&table=5`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);
  await shot(page, 'B01_tables_landing');
  console.log(`    Title: "${await page.title()}"`);

  // ── 2. Check session / ordering screen ──
  console.log('\n[2] Ordering screen loads…');
  const orderingVisible = await page.locator('#screenOrdering').isVisible().catch(() => false);
  console.log(`    Ordering screen: ${orderingVisible ? '✓' : '✗'}`);
  await shot(page, 'B02_ordering_loaded');

  // ── 3. Browse categories ──
  console.log('\n[3] Customer browses categories on mobile…');
  const cats = await page.locator('.cat-btn').allTextContents().catch(() => []);
  console.log(`    Categories: ${cats.map(c => c.trim()).filter(Boolean).join(' | ')}`);

  // Check for floating FAB (mobile category launcher)
  const fab = page.locator('#catFab');
  const fabVisible = await fab.isVisible().catch(() => false);
  console.log(`    Category FAB visible: ${fabVisible}`);
  if (fabVisible) {
    await shot(page, 'B03_cat_fab_visible');
    await fab.click();
    await page.waitForTimeout(400);
    await shot(page, 'B03b_cat_sheet_open');
    // Close it
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
  } else {
    await shot(page, 'B03_categories');
  }

  // ── 4. Scroll through menu ──
  console.log('\n[4] Customer scrolls through menu…');
  await page.evaluate(() => window.scrollBy(0, 400));
  await page.waitForTimeout(500);
  await shot(page, 'B04_menu_scroll');

  // ── 5. Add first item via JS (mobile viewport may hide buttons off-screen) ──
  console.log('\n[5] Customer adds first item…');
  const added1 = await page.evaluate(() => {
    const btn = document.querySelector('.add-btn[data-action="add-item"]');
    if (!btn) return null;
    const card = btn.closest('.item-card');
    const name = card?.querySelector('.item-name')?.textContent?.trim() || 'item';
    btn.click();
    return name;
  });
  console.log(`    Added: "${added1}"`);
  await page.waitForTimeout(500);
  await shot(page, 'B05_first_item_added');

  // ── 6. Add second item ──
  console.log('\n[6] Adding second item…');
  const added2 = await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('.add-btn[data-action="add-item"]'));
    const btn = btns[0]; // first remaining add-btn (first item now has stepper)
    if (!btn) return null;
    const card = btn.closest('.item-card');
    const name = card?.querySelector('.item-name')?.textContent?.trim() || 'item2';
    btn.click();
    return name;
  });
  console.log(`    Added: "${added2}"`);
  await page.waitForTimeout(400);
  await shot(page, 'B06_two_items_in_cart');

  // ── 7. Mobile cart bar ──
  console.log('\n[7] Mobile cart bar…');
  const cartBar = page.locator('#mobileCartBar');
  const barVisible = await cartBar.isVisible().catch(() => false);
  const cartLabel  = await page.locator('#mobileCartLabel').textContent().catch(() => '');
  const cartTotal  = await page.locator('#mobileCartTotal').textContent().catch(() => '');
  console.log(`    Cart bar: ${barVisible ? '✓' : '✗'}  "${cartLabel?.trim()}"  ${cartTotal?.trim()}`);
  await shot(page, 'B07_mobile_cart_bar');

  // Open cart
  if (barVisible) {
    await cartBar.click();
    await page.waitForTimeout(500);
    const cartOpen = await page.locator('.cart-panel.open, #cartPanel.open').count();
    console.log(`    Cart panel opened: ${cartOpen > 0 ? '✓' : 'checking…'}`);
    await shot(page, 'B07b_cart_panel_open');
    // Close cart
    const closeBtn = page.locator('[data-action="close-mobile-cart"]').first();
    if (await closeBtn.isVisible().catch(() => false)) {
      await closeBtn.click();
      await page.waitForTimeout(300);
    }
  }

  // ── 8. Try customisable item ──
  console.log('\n[8] Looking for customisable items…');
  const customBtns = page.locator('[data-action="tables-open-modal"]');
  const customCount = await customBtns.count();
  console.log(`    Items with customisation: ${customCount}`);
  if (customCount > 0) {
    await customBtns.first().click();
    await page.waitForTimeout(600);
    const modalOpen = await page.locator('#tablesCustomModal.open').count();
    console.log(`    Tables modal: ${modalOpen > 0 ? '✓ open' : '✗ closed'}`);
    await shot(page, 'B08_tables_modal');
    if (modalOpen > 0) {
      // Interact
      const spiceBtns = await page.locator('#tablesCustomModal .spice-btn').count();
      if (spiceBtns > 0) {
        await page.locator('#tablesCustomModal .spice-btn').last().click();
        console.log('    Spice: hottest option selected');
      }
      // Special instructions
      const specialInput = page.locator('#tablesSpecialInput, [id*="special"]').first();
      if (await specialInput.isVisible().catch(() => false)) {
        await specialInput.fill('Extra gravy please');
        console.log('    Special instructions: "Extra gravy please"');
      }
      await shot(page, 'B08b_modal_customised');
      await page.locator('[data-action="tables-modal-confirm"]').click().catch(() =>
        page.locator('[data-action="tables-close-modal"]').click().catch(() => {})
      );
      await page.waitForTimeout(400);
    }
  } else {
    await shot(page, 'B08_no_custom_items');
    console.log('    No customisable items');
  }

  // ── 9. Fill name+phone (tables form is always visible in cart panel) ──
  // Tables checkout only needs name + phone (no address for dine-in)
  console.log('\n[9] Filling name & phone for dine-in…');
  const nameFilled = await page.evaluate(() => {
    const el = document.getElementById('fieldName');
    if (!el) return false;
    el.value = 'Priya Mehta';
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  });
  const phoneFilled = await page.evaluate(() => {
    const el = document.getElementById('fieldPhone');
    if (!el) return false;
    el.value = '9123456780';
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  });
  console.log(`    Name filled: ${nameFilled}  Phone filled: ${phoneFilled}`);
  await shot(page, 'B09_form_filled');

  // ── Click Checkout (tables uses 'go-checkout' action) ──
  console.log('\n[10] Clicking Checkout…');
  const chkResult = await page.evaluate(() => {
    // Tables uses data-action="go-checkout", orders uses "go-to-checkout"
    const btn = document.querySelector('[data-action="go-checkout"], [data-action="go-to-checkout"]');
    if (!btn) return 'not found';
    if (btn.disabled) return 'disabled';
    btn.click();
    return btn.dataset.action;
  });
  console.log(`    Checkout action: ${chkResult}`);
  await page.waitForTimeout(800);
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  await page.waitForTimeout(300);
  const onCheckoutB = await page.locator('#screenCheckout.active').count();
  console.log(`    screenCheckout active: ${onCheckoutB > 0 ? '✓' : '✗'}`);
  await shot(page, 'B11_checkout_screen');

  if (chkResult && chkResult !== 'not found' && chkResult !== 'disabled') {
    // ── 12. Payment ──
    console.log('\n[12] Payment selection…');
    const payTextsB = await page.locator('.pay-opt').allTextContents();
    console.log(`    Options: ${payTextsB.map(p => p.trim().split('\n').filter(Boolean)[0]).join(' | ')}`);
    const dineClicked = await page.evaluate(() => {
      const opts = Array.from(document.querySelectorAll('.pay-opt'));
      const offline = opts.find(o => /pay at|offline|cash/i.test(o.textContent));
      const target = offline || opts[opts.length - 1];
      if (target) { target.click(); return target.dataset.paymentId || 'clicked'; }
      return null;
    });
    console.log(`    Payment: "${dineClicked}"`);
    await shot(page, 'B12_payment_selected');

    // ── 13. Place order ──
    console.log('\n[13] Placing dine-in order…');
    const placed = await page.evaluate(() => {
      const btn = document.querySelector('[data-action="place-order"]');
      if (!btn) return 'not found';
      btn.click();
      return 'clicked';
    });
    console.log(`    Place order: ${placed}`);
    await page.waitForTimeout(4000);
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
    await page.waitForTimeout(300);
    const confirmed = await page.locator('#screenConfirm.active').count() > 0
      || await page.locator('#confirmOrderId').isVisible().catch(() => false);
    const orderId   = await page.locator('#confirmOrderId').textContent().catch(() => '—');
    console.log(`    Confirmation: ${confirmed ? '✓' : '✗'}`);
    console.log(`    Order ID: "${orderId?.trim()}"`);
    await shot(page, 'B13_order_confirmed');

    if (confirmed) {
      const confTotal = await page.locator('#confirmTotal').textContent().catch(() => '');
      console.log(`    Total: ${confTotal?.trim()}`);

      // Stars
      const starCount = await page.locator('.confirm-star').count();
      if (starCount > 0) {
        await page.evaluate(() => {
          const stars = document.querySelectorAll('.confirm-star');
          if (stars[4]) stars[4].click();
        });
        await page.waitForTimeout(500);
        console.log('    ⭐⭐⭐⭐⭐ 5-star review given');
        await shot(page, 'B14_5star_review');
      }
    }
  } else {
    await shot(page, 'B11_checkout_blocked');
  }

  await ctx.close();
  console.log('\n✅ Scenario B complete');
}

// ─── Main ─────────────────────────────────────────────────────────────────────
(async () => {
  console.log('Launching browser…');
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });

  try {
    await scenarioOnlineOrder(browser);
    await scenarioDineIn(browser);
  } catch (err) {
    console.error('\n❌ Fatal error:', err.message);
    console.error(err.stack);
  } finally {
    await browser.close();
    console.log(`\n📁 Screenshots: ${SHOTS}`);
    console.log('   Done.\n');
  }
})();

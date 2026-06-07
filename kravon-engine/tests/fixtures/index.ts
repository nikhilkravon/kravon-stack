/**
 * Custom Playwright fixtures.
 * Extend the base `test` object with:
 *   - staffToken:     a valid JWT for staff API calls
 *   - tables:         live table list from the API
 *   - firstTableId:   convenience shorthand
 *   - menuItemId:     first available menu item UUID
 *   - customerPage:   CustomerPage POM bound to a fresh browser context
 *   - dashboardPage:  DashboardPage POM bound to a fresh browser context
 */

import { test as base, expect } from '@playwright/test';
import {
  staffLogin,
  getTables,
  getFirstAvailableItem,
  TableInfo,
} from './api';
import { CustomerPage, DashboardPage } from './pages';
import { SLUG, STAFF_EMAIL, STAFF_PASSWORD } from './env';

export { expect };

type KravonFixtures = {
  staffToken:    string;
  tables:        TableInfo[];
  firstTableId:  string;
  menuItemId:    string;
  customerPage:  CustomerPage;
  dashboardPage: DashboardPage;
};

export const test = base.extend<KravonFixtures>({
  staffToken: async ({ request }, use) => {
    const token = await staffLogin(request);
    await use(token);
  },

  tables: async ({ request, staffToken }, use) => {
    const t = await getTables(request, staffToken);
    if (!t.length) throw new Error('No tables configured — seed the restaurant first.');
    await use(t);
  },

  firstTableId: async ({ tables }, use) => {
    await use(tables[0].id);
  },

  menuItemId: async ({ request }, use) => {
    const id = await getFirstAvailableItem(request);
    await use(id);
  },

  customerPage: async ({ page }, use) => {
    await use(new CustomerPage(page));
  },

  dashboardPage: async ({ page }, use) => {
    const dp = new DashboardPage(page);
    await dp.login(SLUG, STAFF_EMAIL, STAFF_PASSWORD);
    await dp.goToTablesView();
    await use(dp);
  },
});

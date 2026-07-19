// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 etzhayyim Japan株式会社 / etzhayyim. All rights reserved.
// Licensed under the Apache License, Version 2.0 — see LICENSE at repo root.

import { test, expect, type Page } from '@playwright/test';

const APPS = [
  { id: 'overview', label: 'Overview' },
  { id: 'appview', label: 'AppView' },
  { id: 'projector', label: 'Projector' },
  { id: 'calendar', label: 'Calendar' },
  { id: 'drive', label: 'Drive' },
  { id: 'mailer', label: 'Mailer' },
  { id: 'organizer', label: 'Organizer' }
];

async function settle(page: Page) {
  // Wait for fonts + design-system spring animations to settle
  await page.evaluate(() => document.fonts?.ready);
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(400);
}

test.describe('kyber.etzhayyim.com — visual', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText('Kyber Command Center')).toBeVisible();
    await settle(page);
  });

  for (const app of APPS) {
    test(`@visual ${app.id}`, async ({ page }, info) => {
      await page.getByRole('button', { name: app.label, exact: false }).first().click();
      await settle(page);
      await expect(page).toHaveScreenshot(`${app.id}-${info.project.name}.png`, {
        fullPage: true,
        animations: 'disabled'
      });
    });
  }

  test('@visual mailer-compose', async ({ page }, info) => {
    await page.getByRole('button', { name: 'Mailer', exact: false }).first().click();
    await settle(page);
    await page.getByRole('button', { name: /Compose/ }).click();
    await settle(page);
    await expect(page).toHaveScreenshot(`mailer-compose-${info.project.name}.png`, {
      fullPage: false,
      animations: 'disabled'
    });
  });

  test('@visual calendar-create', async ({ page }, info) => {
    await page.getByRole('button', { name: 'Calendar', exact: false }).first().click();
    await settle(page);
    await page.getByRole('button', { name: /Create/ }).first().click();
    await settle(page);
    await expect(page).toHaveScreenshot(`calendar-create-${info.project.name}.png`, {
      fullPage: false,
      animations: 'disabled'
    });
  });

  test('@visual drive-grid-view', async ({ page }, info) => {
    await page.getByRole('button', { name: 'Drive', exact: false }).first().click();
    await settle(page);
    await page.locator('button[title="Grid view"]').click();
    await settle(page);
    await expect(page).toHaveScreenshot(`drive-grid-${info.project.name}.png`, {
      fullPage: true,
      animations: 'disabled'
    });
  });

  test('@visual projector-chat', async ({ page }, info) => {
    await page.getByRole('button', { name: 'Projector', exact: false }).first().click();
    await settle(page);
    await page.getByRole('button', { name: 'chat', exact: true }).click();
    await settle(page);
    await expect(page).toHaveScreenshot(`projector-chat-${info.project.name}.png`, {
      fullPage: true,
      animations: 'disabled'
    });
  });
});

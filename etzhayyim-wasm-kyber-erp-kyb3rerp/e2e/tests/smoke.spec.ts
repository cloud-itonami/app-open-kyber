// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 etzhayyim Japan株式会社 / etzhayyim. All rights reserved.
// Licensed under the Apache License, Version 2.0 — see LICENSE at repo root.

import { test, expect, type Page } from '@playwright/test';

const APPS = [
  { id: 'overview', label: 'Overview', expected: 'Corporate ERP Intelligence' },
  { id: 'appview', label: 'AppView', expected: 'Quick Queries' },
  { id: 'projector', label: 'Projector', expected: 'New project' },
  { id: 'calendar', label: 'Calendar', expected: 'Today' },
  { id: 'drive', label: 'Drive', expected: 'My Drive' },
  { id: 'mailer', label: 'Mailer', expected: 'Compose' },
  { id: 'organizer', label: 'Organizer', expected: 'Vault' }
];

async function gotoShell(page: Page) {
  await page.goto('/');
  await expect(page.getByText('Kyber Command Center')).toBeVisible();
}

async function selectApp(page: Page, label: string) {
  // Left rail buttons use title + label text; click via accessible name
  await page.getByRole('button', { name: label, exact: false }).first().click();
}

test.describe('kyber.etzhayyim.com — smoke', () => {
  test('shell loads with health metadata', async ({ page }) => {
    await gotoShell(page);
    await expect(page.locator('header')).toContainText('kyber.etzhayyim.com');
  });

  test('left rail exposes all 7 apps', async ({ page }) => {
    await gotoShell(page);
    for (const app of APPS) {
      await expect(page.getByRole('button', { name: app.label, exact: false }).first()).toBeVisible();
    }
  });

  for (const app of APPS) {
    test(`app: ${app.id} — renders ${app.expected}`, async ({ page }) => {
      await gotoShell(page);
      await selectApp(page, app.label);
      await expect(page.getByText(app.expected, { exact: false }).first()).toBeVisible({ timeout: 10_000 });
    });
  }

  test('appview — dashboard XRPC POST returns 200', async ({ page }) => {
    await gotoShell(page);
    await selectApp(page, 'AppView');
    const responsePromise = page.waitForResponse(
      (r) => r.url().includes('/xrpc/com.etzhayyim.apps.kyber.dashboard') && r.request().method() === 'POST',
      { timeout: 15_000 }
    );
    await page.getByRole('button', { name: 'Dashboard', exact: false }).first().click();
    const res = await responsePromise;
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.modules).toBeTruthy();
  });

  test('appview — listInvoices returns envelope', async ({ page }) => {
    await gotoShell(page);
    await selectApp(page, 'AppView');
    const responsePromise = page.waitForResponse(
      (r) => r.url().includes('/xrpc/com.etzhayyim.apps.kyber.listInvoices'),
      { timeout: 15_000 }
    );
    await page.getByRole('button', { name: 'Invoices', exact: false }).first().click();
    const res = await responsePromise;
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, invoices: expect.any(Array), total: expect.any(Number) });
  });

  test('mailer — Compose dialog opens', async ({ page }) => {
    await gotoShell(page);
    await selectApp(page, 'Mailer');
    await page.getByRole('button', { name: /Compose/ }).click();
    await expect(page.getByText('New message')).toBeVisible();
    await expect(page.getByPlaceholder('To (email or DID)')).toBeVisible();
  });

  test('drive — `+ New` menu opens with folder/upload', async ({ page }) => {
    await gotoShell(page);
    await selectApp(page, 'Drive');
    await page.getByRole('button', { name: /New$/ }).first().click();
    await expect(page.getByText('New folder')).toBeVisible();
    await expect(page.getByText('File upload')).toBeVisible();
  });

  test('calendar — month grid + view switcher present', async ({ page }) => {
    await gotoShell(page);
    await selectApp(page, 'Calendar');
    await expect(page.getByRole('button', { name: /Today/ })).toBeVisible();
    for (const v of ['day', 'week', 'month', 'schedule']) {
      await expect(page.getByRole('button', { name: v, exact: true })).toBeVisible();
    }
  });

  test('projector — tree + Overview/Tasks/Chat tabs', async ({ page }) => {
    await gotoShell(page);
    await selectApp(page, 'Projector');
    await expect(page.getByRole('heading', { name: 'Kyber FY26 Close' })).toBeVisible();
    for (const v of ['overview', 'tasks', 'chat', 'reflections']) {
      await expect(page.getByRole('button', { name: v, exact: true })).toBeVisible();
    }
  });

  test('no critical console errors on initial load', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    await gotoShell(page);
    // Allow expected XRPC errors (cross-origin calendar/organizer 404/CORS) but flag unexpected throws
    const fatal = errors.filter(
      (e) =>
        !/CORS/i.test(e) &&
        !/XRPC_UNKNOWN_METHOD/i.test(e) &&
        !/Failed to fetch/i.test(e) &&
        !/404/.test(e)
    );
    expect(fatal, fatal.join('\n')).toEqual([]);
  });
});

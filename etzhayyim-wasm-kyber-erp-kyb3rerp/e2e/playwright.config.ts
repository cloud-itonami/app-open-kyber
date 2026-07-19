// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 etzhayyim Japan株式会社 / etzhayyim. All rights reserved.
// Licensed under the Apache License, Version 2.0 — see LICENSE at repo root.

import { defineConfig, devices } from '@playwright/test';

const BASE = process.env.KYBER_BASE_URL ?? 'https://kyber.etzhayyim.com';

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: BASE,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure'
  },
  expect: {
    // Loose threshold — UI is not pixel-stable yet (animations, gradients, dynamic dates)
    toHaveScreenshot: { maxDiffPixelRatio: 0.05 }
  },
  projects: [
    {
      name: 'chromium-desktop',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } }
    },
    {
      name: 'chromium-tablet',
      use: { ...devices['iPad Pro 11'] }
    }
  ]
});

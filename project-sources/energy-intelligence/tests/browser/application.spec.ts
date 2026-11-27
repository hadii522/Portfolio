import { test, expect } from '@playwright/test';

test('real-data overview, chart filtering, export and theme', async ({ page, request }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Market overview', exact: true })).toBeVisible();
  await expect(page.getByText('PostgreSQL connected')).toBeVisible();
  await expect(page.locator('.kpi-value').first()).not.toHaveText('—MW');
  await expect(page.locator('.recharts-surface').first()).toBeVisible();
  const response = page.waitForResponse((r) => r.url().includes('/series?metric=demand&days=2'));
  await page.getByRole('button', { name: '48H', exact: true }).click();
  await response;
  const csv = await request.get('/api/v1/export?metric=demand&days=2');
  expect(csv.status()).toBe(200);
  expect((await csv.text()).split('\n').length).toBeGreaterThan(20);
  await page.getByRole('button', { name: 'Switch to light theme' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.getByRole('link', { name: 'Market explorer', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.getByRole('button', { name: 'Switch to dark theme' }).click();
  await page.goto('/');
  await expect(page.locator('.recharts-surface').first()).toBeVisible();
  await page.screenshot({ path: 'work/screenshots/overview-desktop.png', fullPage: true });
  expect(errors).toEqual([]);
});

test('forecast evidence, historical test and keyboard navigation', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('PostgreSQL connected')).toBeVisible();
  await page.keyboard.press('Control+k');
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('textbox', { name: 'Search workspace views' }).fill('forecast');
  await page.locator('.command-result').click();
  await expect(page).toHaveURL('/forecasts');
  await expect(page.getByRole('heading', { name: 'Forecast laboratory', exact: true })).toBeVisible();
  await expect(page.locator('.champion-row')).toHaveCount(1);
  await expect(page.getByText('Ridge regression', { exact: true }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Backtest', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Held-out historical predictions' })).toBeVisible();
  await expect(page.locator('.recharts-line').first()).toBeVisible();
  await page.screenshot({ path: 'work/screenshots/forecasts-desktop.png', fullPage: true });
});

test('research, source provenance, operations and issue register', async ({ page }) => {
  await page.goto('/research');
  await expect(page.getByRole('heading', { name: 'Demand meets imbalance price' })).toBeVisible();
  await expect(page.locator('.heatmap-row')).toHaveCount(7);
  await page.goto('/market');
  await page.getByRole('button', { name: 'Imbalance price', exact: true }).click();
  await expect(page.locator('tbody tr').first()).toBeVisible();
  await expect(page.locator('tbody tr').first()).toContainText('GBP/MWh');
  await page.goto('/operations');
  await page.getByRole('button', { name: 'Data quality', exact: true }).click();
  await expect(page.locator('.coverage-cell').first()).toBeVisible();
  await page.getByRole('button', { name: /Problems & improvements/ }).click();
  await page.locator('.issue-card').first().locator('summary').click();
  await expect(page.getByText('Fix / improvement', { exact: true }).first()).toBeVisible();
  await page.screenshot({ path: 'work/screenshots/operations-desktop.png', fullPage: true });
});

test('reports expose evidence and automation settings persist', async ({ page, request }) => {
  await page.goto('/reports');
  await expect(page.locator('.report-body')).toBeVisible();
  await expect(page.locator('.evidence-chips').first()).toBeVisible();
  await page.getByText('Inspect workflow & validation trace', { exact: true }).click();
  await expect(page.locator('.trace-details pre')).toContainText('validate');
  const settings = await (await request.get('/api/v1/settings')).json();
  await page.goto('/settings');
  await expect(page.locator('.source-card')).toHaveCount(4);
  const toggle = page.getByRole('switch', { name: 'Automatic source updates' });
  await expect(toggle).toHaveAttribute('aria-checked', String(settings.automation.enabled));
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-checked', String(!settings.automation.enabled));
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-checked', String(settings.automation.enabled));
});

test('mobile layout has usable navigation and no page overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Market overview', exact: true })).toBeVisible();
  await expect(page.locator('.recharts-surface').first()).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  await page.screenshot({ path: 'work/screenshots/overview-mobile.png', fullPage: true });
  await page.getByRole('button', { name: 'Open navigation' }).click();
  await page.getByRole('link', { name: 'Data & operations', exact: true }).click();
  await expect(page).toHaveURL('/operations');
  await expect(page.getByRole('heading', { name: 'Data & operations', exact: true })).toBeVisible();
});

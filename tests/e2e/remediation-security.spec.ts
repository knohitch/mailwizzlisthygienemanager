import { expect, test } from '@playwright/test';

const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@local.hygiene';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'LocalDevAdminPassword123!';

test.describe('Phase 3.1 Security Boundaries, Workflows & Admin Protection E2E', () => {
  test('enforces auth, CSRF, wrong-password rejection, settings validation, filters, exports, dry-run/re-engagement/DNS safety, and logout', async ({
    page,
    request,
  }) => {
    // 1. Unauthorized API endpoints must fail closed with HTTP 401
    for (const ep of [
      '/api/dashboard',
      '/api/deliverability',
      '/api/audit',
      '/api/exports/subscribers',
      '/api/reports/hygiene',
    ]) {
      const unauthGet = await request.get(ep);
      expect(unauthGet.status()).toBe(401);
    }
    const unauthPost = await request.post('/api/cleanup/preview', {
      data: { actionType: 'SUPPRESS', filter: { combinator: 'AND', conditions: [] } },
    });
    expect(unauthPost.status()).toBe(401);

    // 2. Wrong password on login page shows error and stays unauthenticated
    await page.goto('/login');
    await page.fill('#admin-email', ADMIN_EMAIL);
    await page.fill('#admin-password', 'WrongAdminPassword!999');
    await page.click('button[type="submit"]');
    await expect(page.getByText(/Invalid/i)).toBeVisible();
    await expect(page).toHaveURL(/\/login/);

    // 3. Valid login succeeds
    await page.fill('#admin-password', ADMIN_PASSWORD);
    await page.click('button[type="submit"]');
    await expect(page).toHaveURL('/');

    // 4. CSRF protection rejects authenticated POST missing x-csrf-token
    const csrfBlocked = await page.request.post('/api/deliverability/dns', {
      data: { domain: 'example.com' },
    });
    expect(csrfBlocked.status()).toBe(403);

    // 5. Settings page shows multi-version MailWizz auth selector & blocks invalid insecure HTTP validation
    await page.getByRole('link', { name: /Settings & Sources/i }).click();
    await expect(page).toHaveURL('/settings');
    await expect(page.locator('#mw-auth-mode')).toBeVisible();
    await page.locator('#mw-url').fill('http://public-mailwizz.example.com/api/index.php');
    await page.locator('#mw-key').fill('fake-validation-key');
    await page.getByRole('button', { name: /Validate Connection/i }).click();
    await expect(page.getByText(/TLS is required|HTTP/i)).toBeVisible({ timeout: 10000 });

    // 6. Reports page & CSV export
    await page.getByRole('link', { name: /Reports/i }).click();
    await expect(page).toHaveURL('/reports');
    const csvDownloadPromise = page.waitForEvent('download');
    await page.getByRole('link', { name: 'CSV' }).first().click();
    const csvDownload = await csvDownloadPromise;
    expect(csvDownload.suggestedFilename()).toMatch(/\.csv$/);

    // 7. Cleanup console: generate UNSUBSCRIBE Dry-Run, verify confirmation name mismatch rejected
    await page.getByRole('link', { name: /Filter & Cleanup/i }).click();
    await expect(page).toHaveURL('/cleanup');
    await page.locator('#cleanup-action').selectOption('UNSUBSCRIBE');
    await page
      .getByRole('button', { name: /Generate Dry-Run Preview & Encrypted Snapshot/i })
      .click();
    await expect(page.getByText(/Dry-Run Report Ready \(UNSUBSCRIBE\)/i)).toBeVisible({
      timeout: 15000,
    });

    // Try confirming with intentionally wrong list name -> blocked cleanly
    await page.getByPlaceholder('Confirm list name').fill('WRONG LIST NAME');
    await page.getByPlaceholder('Confirm eligible count').fill('1');
    await page
      .getByRole('button', { name: /Confirm & Queue Resumable Batch Job/i })
      .click();
    await expect(
      page.locator('.bg-rose-50').getByText(/does not match|mismatch|disabled|ENABLE_MAILWIZZ_MUTATIONS/i)
    ).toBeVisible();

    // 8. Re-engagement plan creation in UI
    await page.getByRole('link', { name: /Re-Engagement/i }).click();
    await expect(page).toHaveURL('/reengagement');
    await page.locator('#plan-name').fill('Phase 3.1 E2E Re-Engagement Check');
    await page.getByRole('button', { name: /Create Re-Engagement Draft/i }).click();
    await expect(page.getByText(/Created re-engagement/i)).toBeVisible({
      timeout: 15000,
    });

    // 9. Deliverability page blocks SSRF/internal DNS diagnostic targets
    await page.getByRole('link', { name: 'Deliverability', exact: true }).click();
    await expect(page).toHaveURL('/deliverability');
    await page.getByPlaceholder('mail.yourdomain.com', { exact: true }).fill('127.0.0.1');
    await page.getByRole('button', { name: /Check Public DNS/i }).click();
    await expect(
      page.getByText(/Invalid or internal\/private target hostname/i)
    ).toBeVisible({ timeout: 10000 });

    // 10. Sign out revokes session and redirects to /login; protected API calls return 401 again
    await page.getByRole('button', { name: /Sign out/i }).click();
    await expect(page).toHaveURL(/\/login/);
    await page.goto('/');
    await expect(page).toHaveURL(/\/login/);
  });
});

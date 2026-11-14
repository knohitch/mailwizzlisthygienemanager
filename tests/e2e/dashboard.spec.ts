import { expect, test } from '@playwright/test';

const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@local.hygiene';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'LocalDevAdminPassword123!';

test.describe('MailWizz List Hygiene Manager E2E', () => {
  test('authenticates admin, renders 1,800-subscriber demo dashboard, filters list table, updates settings, and verifies Phase 1 mutation lock', async ({
    page,
  }) => {
    // Unauthenticated access redirects to /login
    await page.goto('/');
    await expect(page).toHaveURL(/\/login/);

    // Sign in
    await page.fill('#admin-email', ADMIN_EMAIL);
    await page.fill('#admin-password', ADMIN_PASSWORD);
    await page.click('button[type="submit"]');
    await expect(page).toHaveURL('/');

    // Verify Phase 1 Read-Only & Demo Data banners
    await expect(page.getByText('Phase 1 Read-Only').first()).toBeVisible();
    await expect(page.getByText(/SYNTHETIC DEMO DATA ACTIVE/i)).toBeVisible();

    // Verify KPI metrics and 1,800-subscriber demo list
    await expect(
      page.locator('tr', { hasText: 'Main Product Newsletter (Demo)' })
    ).toBeVisible();
    await expect(page.getByText('1,800').first()).toBeVisible();
    await expect(page.getByText('Strong Engagement (Click+)')).toBeVisible();
    await expect(page.getByText('Open-Only Engagement')).toBeVisible();
    await expect(page.getByText('UNKNOWN History')).toBeVisible();

    // Verify encrypted export download
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('link', { name: /Encrypted Export/i }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/\.enc\.json$/);

    // Verify API Capability Matrix tab
    await page.getByRole('tab', { name: /MailWizz 3\.0\.5 API Matrix/i }).click();
    await expect(page.getByText(/Per-subscriber historical open log endpoint/i)).toBeVisible();

    // Verify Phase 2 mutation gate lock on Jobs & Audit tab
    await page.getByRole('tab', { name: /Jobs & Audit/i }).click();
    await page.getByRole('button', { name: /Verify Mutation Gate Block/i }).click();
    await expect(page.getByText(/Phase 1 Gate Verified \(HTTP 403\)/i)).toBeVisible();

    // Navigate into the 1,800-subscriber list dashboard
    await page.getByRole('tab', { name: /Mailing Lists/i }).click();
    await page
      .locator('tr', { hasText: 'Main Product Newsletter (Demo)' })
      .getByRole('link', { name: /Open List/i })
      .click();
    await expect(page).toHaveURL(/\/lists\//);

    // Search & filter subscribers
    await page.getByPlaceholder(/Search email, name, or subscriber UID/i).fill('demo.user.1.1@');
    await expect(page.getByText('demo.user.1.1@vipclient.com')).toBeVisible();

    // Navigate to Settings & verify configuration persistence
    await page.getByRole('link', { name: /Settings & Sources/i }).click();
    await expect(page).toHaveURL('/settings');
    await expect(page.locator('#min-campaigns')).toHaveValue('5');
    await page.getByRole('button', { name: /Save Configuration/i }).click();
    await expect(page.getByText(/Settings saved and encrypted/i)).toBeVisible({
      timeout: 15000,
    });

    // Navigate to Phase 2 Filter & Cleanup console
    await page.getByRole('link', { name: /Filter & Cleanup/i }).click();
    await expect(page).toHaveURL('/cleanup');
    await page.getByRole('button', { name: /Preview Exact Match Count/i }).click();
    await expect(page.getByTestId('matched-count')).toBeVisible();
    await page
      .getByRole('button', { name: /Generate Dry-Run Preview & Encrypted Snapshot/i })
      .click();
    await expect(page.getByText(/Dry-Run Report Ready/i)).toBeVisible();

    // Navigate to Re-Engagement & Reports pages
    await page.getByRole('link', { name: /Re-Engagement/i }).click();
    await expect(page).toHaveURL('/reengagement');
    await expect(
      page.getByText(/Re-Engagement Workflow \(Manual Campaign Approval\)/i)
    ).toBeVisible();

    await page.getByRole('link', { name: /Reports/i }).click();
    await expect(page).toHaveURL('/reports');
    await expect(
      page.getByText(/Before & After Audience Comparison/i)
    ).toBeVisible();

    // Navigate to Phase 3 Deliverability Diagnostics page
    await page.getByRole('link', { name: 'Deliverability', exact: true }).click();
    await expect(page).toHaveURL('/deliverability');
    await expect(
      page.getByRole('heading', { name: /Email Deliverability Diagnostics/i })
    ).toBeVisible();
    await expect(
      page.getByText(/SMTP Acceptance vs\. Delivery vs\. Inbox Placement/i)
    ).toBeVisible();
    await expect(
      page.getByText(/Sending Volume vs\. Open Rate & Click Rate/i)
    ).toBeVisible();

    // Switch date window and log a controlled seed inbox test
    await page.getByRole('button', { name: '90d', exact: true }).click();
    await page.getByLabel('Test sending domain').fill('e2e-seed.example.test');
    await page.getByLabel('Seed Campaign UID').fill('demo-camp-0-5');
    await page.getByLabel('Seed Test Notes').fill('Playwright E2E verified seed test');
    await page.getByRole('button', { name: /Record Seed Test Result/i }).click();
    await expect(
      page.getByText(/Recorded seed inbox placement \(GMAIL: PRIMARY\)/i)
    ).toBeVisible();
    await expect(
      page.getByText('Playwright E2E verified seed test').first()
    ).toBeVisible();
  });
});

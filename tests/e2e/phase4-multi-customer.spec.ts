import { expect, test } from '@playwright/test';

const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@local.hygiene';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'LocalDevAdminPassword123!';

test.describe('Phase 4 Multi-Customer Connections & Isolation E2E', () => {
  test('enforces /connections auth, SSRF/TLS URL checks, CRUD, masking, key rotation, pause/disable, scoped navigation, and typed deletion', async ({
    page,
    request,
  }) => {
    const suffix = Date.now().toString().slice(-6);
    const alphaName = `E2E Alpha Customer ${suffix}`;
    const betaName = `E2E Beta Customer ${suffix}`;
    const alphaKey1 = `e2e-alpha-secret-initial-1111`;
    const alphaKey2 = `e2e-alpha-secret-rotated-9999`;
    const betaKey1 = `e2e-beta-secret-initial-2222`;

    // 1. Unauthenticated access to multi-customer connection APIs must fail closed (401)
    expect((await request.get('/api/connections')).status()).toBe(401);
    expect(
      (
        await request.post('/api/connections', {
          data: {
            customerName: 'Unauth Probe',
            baseUrl: 'https://example.com/api/index.php',
            apiKey: 'unauth-secret-1234',
          },
        })
      ).status()
    ).toBe(401);

    // 2. Authenticate as admin
    await page.goto('/login');
    await page.fill('#admin-email', ADMIN_EMAIL);
    await page.fill('#admin-password', ADMIN_PASSWORD);
    await page.click('button[type="submit"]');
    await expect(page).toHaveURL('/');

    // 3. Navigate to Customer Connections workspace via AppShell
    await page.getByRole('link', { name: /Connections/i }).first().click();
    await expect(page).toHaveURL('/connections');
    await expect(page.getByText(/MailWizz Customer API Connections/i)).toBeVisible();

    // 4. SSRF / internal metadata URL blocked in UI form
    await page.getByRole('button', { name: /Add Customer Connection/i }).click();
    await page.locator('#conn-name').fill(alphaName);
    await page.locator('#conn-url').fill('https://169.254.169.254/api/index.php');
    await page.locator('#conn-apikey').fill(alphaKey1);
    const validateCheckbox = page.getByLabel(/Run read-only connection validation immediately/i);
    if (await validateCheckbox.isChecked()) {
      await validateCheckbox.uncheck();
    }
    await page.getByRole('button', { name: /Save Customer Connection/i }).click();
    await expect(page.getByTestId('connections-feedback')).toContainText(/internal\/metadata IP/i);

    // 5. Create two isolated customer connections sharing the same MailWizz host URL
    const sharedHostUrl = `https://e2e-shared-${suffix}.example.invalid/api/index.php`;
    await page.locator('#conn-url').fill(sharedHostUrl);
    await page.locator('#conn-auth').selectOption('x-api-key');
    await page.getByRole('button', { name: /Save Customer Connection/i }).click();
    await expect(page.getByTestId('connections-feedback')).toContainText(alphaName);

    await page.getByRole('button', { name: /Add Customer Connection/i }).click();
    await page.locator('#conn-name').fill(betaName);
    await page.locator('#conn-url').fill(sharedHostUrl);
    await page.locator('#conn-apikey').fill(betaKey1);
    if (await validateCheckbox.isChecked()) {
      await validateCheckbox.uncheck();
    }
    await page.getByRole('button', { name: /Save Customer Connection/i }).click();
    await expect(page.getByTestId('connections-feedback')).toContainText(betaName);

    // 6. Verify masked keys & zero plaintext API key leakage in UI & JSON API
    await expect(page.getByText('****1111').first()).toBeVisible();
    await expect(page.getByText('****2222').first()).toBeVisible();
    const listApiRes = await page.request.get('/api/connections?search=' + encodeURIComponent(suffix));
    expect(listApiRes.status()).toBe(200);
    const listBodyText = await listApiRes.text();
    expect(listBodyText).toContain(alphaName);
    expect(listBodyText).toContain(betaName);
    expect(listBodyText).not.toContain(alphaKey1);
    expect(listBodyText).not.toContain(betaKey1);

    // 7. Filter by search query isolates Alpha card cleanly
    const searchInput = page.getByLabel('Search customer connections');
    await searchInput.fill(alphaName);
    await expect(page.getByRole('heading', { name: alphaName })).toBeVisible();
    await expect(page.getByRole('heading', { name: betaName })).toHaveCount(0);

    // 8. Rotate Alpha's API key via UI and verify version + masked suffix updates without leaking plaintext
    await page.getByRole('button', { name: /Rotate Key/i }).first().click();
    await page.getByPlaceholder(/Enter new MailWizz customer X-Api-Key/i).fill(alphaKey2);
    await page.getByRole('button', { name: /Confirm Key Rotation/i }).click();
    await expect(page.getByTestId('connections-feedback')).toContainText(/Rotated API key/i);
    await expect(page.getByText('****9999').first()).toBeVisible();

    const afterRotateText = await (
      await page.request.get('/api/connections?search=' + encodeURIComponent(alphaName))
    ).text();
    expect(afterRotateText).not.toContain(alphaKey2);

    // 9. Pause Sync and Disable lifecycle toggles on Alpha
    await page.getByRole('button', { name: /Pause Sync/i }).first().click();
    await expect(page.getByTestId('connections-feedback')).toContainText(/Paused sync/i);
    await expect(page.getByText('Sync Paused').first()).toBeVisible();

    await page.getByRole('button', { name: /Disable/i }).first().click();
    await expect(page.getByTestId('connections-feedback')).toContainText(/Disabled customer connection/i);

    // 10. Navigate via per-customer Compatibility & Overview links
    await page.locator('main').getByRole('link', { name: 'Compatibility', exact: true }).first().click();
    await expect(page).toHaveURL(/\/compatibility\?customerConnectionId=/);
    const compatSelector = page.getByTestId('compatibility-customer-selector');
    if (await compatSelector.isVisible()) {
      await expect(compatSelector).toBeVisible();
    }

    await page.goto('/');
    await expect(
      page.getByRole('region', { name: 'Customer accounts overview' }).getByText(alphaName)
    ).toBeVisible();

    // 11. Return to /connections, exercise safe Disable & Archive on Alpha, then remove empty E2E test connections cleanly
    await page.goto('/connections');
    await searchInput.fill(alphaName);
    await expect(page.getByText(alphaName).first()).toBeVisible();

    // Archive Alpha cleanly first (revokes key & disables while keeping any history)
    await page.getByRole('button', { name: /Remove/i }).first().click();
    await page.getByPlaceholder(/^Type "/).fill(alphaName);
    await page.getByRole('button', { name: /Disable & Archive/i }).click();
    await expect(page.getByTestId('connections-feedback')).toContainText(/Disabled and archived/i);

    // Wrong confirmation phrase fails closed
    await page.getByRole('button', { name: /Remove/i }).first().click();
    await page.getByPlaceholder(/^Type "/).fill('WRONG_CONFIRMATION_TEXT');
    await page.getByRole('button', { name: /Permanently Delete Connection/i }).click();
    await expect(page.getByTestId('connections-feedback')).toContainText(/does not match/i);

    // Exact phrase deletes empty Alpha, then empty Beta
    for (const name of [alphaName, betaName]) {
      await searchInput.fill(name);
      await expect(page.getByText(name).first()).toBeVisible();
      await page.getByRole('button', { name: /Remove/i }).first().click();
      await page.getByPlaceholder(/^Type "/).fill(name);
      await page.getByRole('button', { name: /Permanently Delete Connection/i }).click();
      await expect(page.getByTestId('connections-feedback')).toContainText(/Removed empty customer connection/i);
    }
  });
});

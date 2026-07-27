import { expect, test, type Page } from '@playwright/test';

const e2eOrigin = process.env.ORBITSTART_E2E_BASE_URL ?? 'http://127.0.0.1:1422';
const snapshotKey = 'orbitstart.browser.snapshot';
const onboardingKey = 'orbitstart_onboarding_v1';

test.use({
  storageState: {
    cookies: [],
    origins: [
      {
        origin: e2eOrigin,
        localStorage: [
          {
            name: onboardingKey,
            value: JSON.stringify({ completed: true })
          }
        ]
      }
    ]
  }
});

function themeCard(page: Page, name: string) {
  return page.locator('.theme-card').filter({ has: page.locator('strong', { hasText: name }) }).first();
}

async function openThemeSettings(page: Page) {
  await page.goto('/?view=settings&panel=themes');
  await expect(page.locator('.app-shell')).toBeVisible();
  await expect(page.locator('.settings-shell')).toBeVisible();
  await expect(page.locator('.theme-settings')).toBeVisible();
}

async function selectTheme(page: Page, name: string, id: string) {
  const card = themeCard(page, name);
  await expect(card).toBeVisible();
  await card.click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', id);
  await expect(card).toHaveClass(/(?:^|\s)selected(?:\s|$)/);
}

async function readRootTokens(page: Page) {
  return page.evaluate(() => {
    const styles = window.getComputedStyle(document.documentElement);
    return {
      bg: styles.getPropertyValue('--bg').trim(),
      surface: styles.getPropertyValue('--surface').trim(),
      accent: styles.getPropertyValue('--accent').trim(),
      accent2: styles.getPropertyValue('--accent-2').trim(),
      fontTitle: styles.getPropertyValue('--font-title').trim(),
      radius: styles.getPropertyValue('--radius').trim(),
      shadowCard: styles.getPropertyValue('--shadow-card').trim()
    };
  });
}

test.describe('Atelier Zero theme E2E', () => {
  test('opens the theme catalog directly with onboarding state on the active test origin', async ({ page }) => {
    await openThemeSettings(page);

    await expect(themeCard(page, 'Local Galaxy')).toBeVisible();
    await expect(themeCard(page, 'Atelier Zero')).toBeVisible();
    await expect(themeCard(page, 'Local Galaxy')).toHaveClass(/(?:^|\s)selected(?:\s|$)/);
    expect(await page.locator('.theme-card').count()).toBeGreaterThanOrEqual(2);
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'local-galaxy');
  });

  test('applies Atelier Zero through the settings UI and updates live design tokens', async ({ page }) => {
    await openThemeSettings(page);
    await selectTheme(page, 'Atelier Zero', 'atelier-zero');

    const tokens = await readRootTokens(page);
    expect(tokens).toMatchObject({
      bg: '#fbf6ee',
      surface: '#fffdf8',
      accent: '#9b5b32',
      accent2: '#2f5b4f',
      radius: '16px',
      shadowCard: 'none'
    });
    expect(tokens.fontTitle).toContain('Georgia');
    await expect(page.locator('html')).toHaveAttribute('data-theme-style', 'atelier');
    await expect(page.locator('.app-shell')).toHaveCSS('background-color', 'rgb(251, 246, 238)');
  });

  test('persists an Atelier Zero selection after a reload', async ({ page }) => {
    await openThemeSettings(page);
    await selectTheme(page, 'Atelier Zero', 'atelier-zero');

    await page.reload();
    await expect(page.locator('.theme-settings')).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'atelier-zero');
    await expect(themeCard(page, 'Atelier Zero')).toHaveClass(/(?:^|\s)selected(?:\s|$)/);

    const persistedTheme = await page.evaluate((key) => {
      const snapshot = JSON.parse(window.localStorage.getItem(key) ?? '{}');
      return snapshot.settings?.activeThemeId;
    }, snapshotKey);
    expect(persistedTheme).toBe('atelier-zero');
  });

  test('falls back to Local Galaxy when persisted theme data is invalid', async ({ page }) => {
    await page.addInitScript(({ initialSnapshotKey, initialOnboardingKey }) => {
      window.localStorage.setItem(initialSnapshotKey, JSON.stringify({
        settings: { activeThemeId: 'missing-theme-for-e2e' }
      }));
      window.localStorage.setItem(initialOnboardingKey, JSON.stringify({ completed: true }));
    }, { initialSnapshotKey: snapshotKey, initialOnboardingKey: onboardingKey });

    await openThemeSettings(page);

    await expect(page.locator('html')).toHaveAttribute('data-theme', 'local-galaxy');
    await expect(page.locator('html')).not.toHaveAttribute('data-theme-style');
    expect((await readRootTokens(page)).bg).toBe('#050812');
  });

  test('switches deterministically between supported themes without stale selected state', async ({ page }) => {
    await openThemeSettings(page);

    const sequence = [
      { name: 'Atelier Zero', id: 'atelier-zero', bg: '#fbf6ee' },
      { name: 'Atelier Charcoal', id: 'atelier-charcoal', bg: '#eceff3' },
      { name: 'Atelier Zero', id: 'atelier-zero', bg: '#fbf6ee' }
    ];

    for (const theme of sequence) {
      await selectTheme(page, theme.name, theme.id);
      expect((await readRootTokens(page)).bg).toBe(theme.bg);
    }

    await expect(themeCard(page, 'Atelier Charcoal')).not.toHaveClass(/(?:^|\s)selected(?:\s|$)/);
    await expect(themeCard(page, 'Atelier Zero')).toHaveClass(/(?:^|\s)selected(?:\s|$)/);
  });

  test('cleans up Atelier markers and restores the default tokens when switching back', async ({ page }) => {
    await openThemeSettings(page);
    await selectTheme(page, 'Atelier Zero', 'atelier-zero');
    await selectTheme(page, 'Local Galaxy', 'local-galaxy');

    await expect(page.locator('html')).toHaveAttribute('data-theme', 'local-galaxy');
    await expect(page.locator('html')).not.toHaveAttribute('data-theme-style');
    expect((await readRootTokens(page)).bg).toBe('#050812');
    await expect(themeCard(page, 'Local Galaxy')).toHaveClass(/(?:^|\s)selected(?:\s|$)/);
  });
});

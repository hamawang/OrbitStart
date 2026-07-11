import { test, expect } from '@playwright/test';

test.use({
  storageState: {
    cookies: [],
    origins: [
      {
        origin: 'http://127.0.0.1:1420',
        localStorage: [
          {
            name: 'orbitstart_onboarding_v1',
            value: JSON.stringify({ completed: true })
          }
        ]
      }
    ]
  }
});

test.describe('OrbitStart E2E Basic Verification', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.app-shell', { timeout: 10000 });
  });

  test('should load the workspace and display core branding', async ({ page }) => {
    const brandTitle = page.locator('.brand-mark strong');
    await expect(brandTitle).toBeVisible();
    await expect(brandTitle).toHaveText('OrbitStart');

    await expect(page.locator('.rail-button')).not.toHaveCount(0);
  });

  test('should route both dedicated floating-bubble windows without rendering the main app', async ({ page }) => {
    await page.goto('/?label=floating-bubble');
    const mainBubble = page.locator('.main-bubble');
    await expect(mainBubble).toBeVisible({ timeout: 5000 });
    await expect(mainBubble).not.toHaveAttribute('title');
    await expect(page.locator('body')).toHaveClass(/bubble-body/);
    await expect(page.locator('.app-shell')).toHaveCount(0);

    await page.setViewportSize({ width: 372, height: 104 });
    await page.goto('/?label=floating-bubble-menu');
    const bubbleMenu = page.locator('.bubble-menu-shell');
    await expect(bubbleMenu).toBeVisible({ timeout: 5000 });
    await expect(bubbleMenu).toHaveCSS('width', '340px');
    await expect(bubbleMenu).toHaveCSS('height', '72px');
    await expect(page.locator('#root')).toHaveCSS('width', '372px');
    await expect(bubbleMenu).toHaveCSS('margin-left', '16px');
    await expect(page.locator('.bubble-menu-action')).toHaveCount(5);
    await expect(page.locator('.app-shell')).toHaveCount(0);
  });

  test('should route the floating bubble from the Tauri window label without a URL query', async ({ page }) => {
    await page.addInitScript(() => {
      (window as typeof window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {
        metadata: { currentWindow: { label: 'floating-bubble' } }
      };
    });

    await page.goto('/');
    await expect(page.locator('.main-bubble')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('.app-shell')).toHaveCount(0);
  });

  test('should read computed CSS variables on document root', async ({ page }) => {
    const styles = await page.evaluate(() => {
      const el = document.documentElement;
      const computed = window.getComputedStyle(el);
      return {
        bg: computed.getPropertyValue('--bg').trim(),
        accent: computed.getPropertyValue('--accent').trim(),
        fontUi: computed.getPropertyValue('--font-ui').trim(),
      };
    });

    expect(styles.bg).not.toBe('');
    expect(styles.accent).not.toBe('');
    expect(styles.fontUi).not.toBe('');
  });

  test('should render nested subdirectories and collapse them from aligned buttons', async ({ page }) => {
    await page.evaluate(() => {
      window.localStorage.setItem('orbitstart.browser.items', JSON.stringify([
        {
          id: 'root-app',
          title: 'Root App',
          subtitle: 'Stored directly under apps',
          kind: 'app',
          group: 'apps',
          target: 'C:\\Test\\root.exe',
          aliases: [],
          tags: ['manual'],
          subTag: '',
          icon: 'AppWindow',
          accent: '#5cc8ff',
          favorite: false,
          launchCount: 0
        },
        {
          id: 'media-app',
          title: 'Media App',
          subtitle: 'Stored under media tools',
          kind: 'app',
          group: 'apps',
          target: 'C:\\Test\\media.exe',
          aliases: [],
          tags: ['manual'],
          subTag: '影音工具',
          icon: 'AppWindow',
          accent: '#5cc8ff',
          favorite: false,
          launchCount: 0
        },
        {
          id: 'player-app',
          title: 'Player App',
          subtitle: 'Stored under media players',
          kind: 'app',
          group: 'apps',
          target: 'C:\\Test\\player.exe',
          aliases: [],
          tags: ['manual'],
          subTag: '影音工具/播放器',
          icon: 'AppWindow',
          accent: '#5cc8ff',
          favorite: false,
          launchCount: 0
        }
      ]));
    });

    await page.reload();
    await page.waitForSelector('.app-shell', { timeout: 10000 });
    await page.locator('[data-group-id="apps"] .group-tab-btn').click();

    await expect(page.locator('.resource-row[data-resource-id="root-app"]')).toBeVisible();
    await expect(page.locator('.subtag-resource-block')).toBeVisible();
    await expect(page.locator('.subtag-resource-title', { hasText: '影音工具' })).toBeVisible();
    await expect(page.locator('.subtag-resource-title', { hasText: '播放器' })).toBeVisible();
    await expect(page.locator('.resource-row[data-resource-id="media-app"]')).toBeVisible();
    await expect(page.locator('.resource-row[data-resource-id="player-app"]')).toBeVisible();

    const alignment = await page.locator('.subtag-collapse-button').first().evaluate((button) => {
      const icon = button.querySelector('svg');
      if (!icon) return { dx: 99, dy: 99 };
      const buttonBox = button.getBoundingClientRect();
      const iconBox = icon.getBoundingClientRect();
      return {
        dx: Math.abs((buttonBox.left + buttonBox.width / 2) - (iconBox.left + iconBox.width / 2)),
        dy: Math.abs((buttonBox.top + buttonBox.height / 2) - (iconBox.top + iconBox.height / 2))
      };
    });
    expect(alignment.dx).toBeLessThan(1.5);
    expect(alignment.dy).toBeLessThan(1.5);

    await page.locator('.subtag-collapse-button').first().click();
    await expect(page.locator('.resource-row[data-resource-id="media-app"]')).toHaveCount(0);
    await expect(page.locator('.resource-row[data-resource-id="player-app"]')).toHaveCount(0);

    await page.locator('.subtag-collapse-button').first().click();
    await expect(page.locator('.resource-row[data-resource-id="media-app"]')).toBeVisible();
    await expect(page.locator('.resource-row[data-resource-id="player-app"]')).toBeVisible();
  });

  test('should expose the reveal-location action from resource context menu', async ({ page }) => {
    await page.evaluate(() => {
      window.localStorage.setItem('orbitstart.browser.items', JSON.stringify([
        {
          id: 'context-menu-test',
          title: 'Context Menu Test',
          subtitle: 'C:\\Windows\\System32\\notepad.exe',
          kind: 'app',
          group: 'apps',
          target: 'C:\\Windows\\System32\\notepad.exe',
          aliases: [],
          tags: ['manual'],
          subTag: '',
          icon: 'AppWindow',
          accent: '#5cc8ff',
          favorite: false,
          launchCount: 0
        }
      ]));
    });

    await page.reload();
    await page.waitForSelector('.app-shell', { timeout: 10000 });
    await page.locator('[data-group-id="apps"] .group-tab-btn').click();

    const resource = page.locator('.resource-row[data-resource-id="context-menu-test"]').first();
    await expect(resource).toBeVisible();
    const box = await resource.boundingBox();
    expect(box).not.toBeNull();
    await resource.dispatchEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      button: 2,
      clientX: Math.round(box!.x + 12),
      clientY: Math.round(box!.y + 12)
    });

    await expect(page.locator('.context-menu')).toContainText('打开所在位置');
  });

  test('should control the workbench from the group tab row and settings page', async ({ page }) => {
    await expect(page.locator('.window-resource-toggle')).toHaveCount(0);
    await expect(page.locator('.group-tabs-row .group-tabs-toggle')).toBeVisible();
    await expect(page.locator('.resource-detail-panel')).toBeVisible();

    await page.locator('.group-tabs-row .group-tabs-toggle').click();
    await expect(page.locator('.resource-detail-panel')).toHaveCount(0);
    await expect(page.locator('.dashboard-grid')).toHaveClass(/workbench-collapsed/);

    await page.locator('.group-tabs-row .group-tabs-toggle').click();
    await expect(page.locator('.resource-detail-panel')).toBeVisible();

    await page.goto('/?panel=settings');
    await page.waitForSelector('.settings-shell', { timeout: 10000 });
    await page.locator('.settings-menu button', { hasText: '工作台' }).click();
    await expect(page.locator('.workbench-settings')).toBeVisible();
    await expect(page.locator('label', { hasText: '显示工作台' }).locator('input')).toBeChecked();
    await expect(page.locator('label', { hasText: '显示常用操作' }).locator('input')).toBeChecked();
  });

  test('should progressively render large resource collections', async ({ page }) => {
    const items = Array.from({ length: 250 }, (_, index) => ({
      id: `performance-item-${index}`,
      title: `Performance Item ${String(index).padStart(3, '0')}`,
      subtitle: `C:\\Performance\\item-${index}.exe`,
      kind: 'app',
      group: 'apps',
      target: `C:\\Performance\\item-${index}.exe`,
      aliases: [],
      tags: ['performance'],
      subTag: '',
      icon: 'AppWindow',
      accent: '#5cc8ff',
      favorite: false,
      launchCount: 0,
      sortOrder: index
    }));
    await page.evaluate((largeCollection) => {
      window.localStorage.setItem('orbitstart.browser.items', JSON.stringify(largeCollection));
    }, items);
    await page.reload();
    await page.waitForSelector('.app-shell', { timeout: 10000 });
    await page.locator('[data-group-id="apps"] .group-tab-btn').click();

    await expect(page.locator('.resource-panel .section-head h2')).toContainText('250 个资源');
    await expect(page.locator('.resource-row')).toHaveCount(120);
    await expect(page.locator('.resource-progressive-load')).toContainText('120 / 250');

    await page.locator('.resource-progressive-load button').click();
    await expect(page.locator('.resource-row')).toHaveCount(240);
    await expect(page.locator('.resource-progressive-load')).toContainText('240 / 250');
  });

  test('should show version 0.7.8 on the about page', async ({ page }) => {
    await page.goto('/?panel=about');
    await page.waitForSelector('.app-shell', { timeout: 10000 });
    await expect(page.locator('.about-card')).toContainText('0.7.8');
  });

  test('should display and interact with the sub-directory selection modal', async ({ page }) => {
    await page.evaluate(() => {
      window.localStorage.setItem('orbitstart.browser.items', JSON.stringify([
        {
          id: 'test-app-1',
          title: 'Test App 1',
          subtitle: 'C:\\Test\\1.exe',
          kind: 'app',
          group: 'apps',
          target: 'C:\\Test\\1.exe',
          aliases: [],
          tags: ['manual'],
          subTag: '工具/编辑器',
          icon: 'AppWindow',
          accent: '#5cc8ff',
          favorite: false,
          launchCount: 0
        },
        {
          id: 'test-app-2',
          title: 'Test App 2',
          subtitle: 'C:\\Test\\2.exe',
          kind: 'app',
          group: 'apps',
          target: 'C:\\Test\\2.exe',
          aliases: [],
          tags: ['manual'],
          subTag: '游戏/角色扮演',
          icon: 'AppWindow',
          accent: '#5cc8ff',
          favorite: false,
          launchCount: 0
        }
      ]));
    });

    await page.reload();
    await page.waitForSelector('.app-shell', { timeout: 10000 });
    await page.locator('[data-group-id="apps"] .group-tab-btn').click();

    // Open context menu and select '编辑资源'
    const resource = page.locator('.resource-row[data-resource-id="test-app-1"]').first();
    const box = await resource.boundingBox();
    expect(box).not.toBeNull();
    await resource.dispatchEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      button: 2,
      clientX: Math.round(box!.x + 12),
      clientY: Math.round(box!.y + 12)
    });
    await page.locator('.context-menu button', { hasText: '编辑资源' }).click();
    await expect(page.locator('.modal-panel h2', { hasText: '编辑资源' })).toBeVisible();

    // Click select subtag button
    await page.locator('.modal-panel button', { hasText: '选择子目录' }).click();
    await expect(page.locator('.dialog-panel h3', { hasText: '选择子目录' })).toBeVisible();

    // Verify list
    await expect(page.locator('.dialog-body button', { hasText: '工具/编辑器' })).toBeVisible();
    await expect(page.locator('.dialog-body button', { hasText: '游戏/角色扮演' })).toBeVisible();

    // Test search
    await page.locator('input[placeholder="搜索已创建的子目录..."]').fill('编辑器');
    await expect(page.locator('.dialog-body button', { hasText: '工具/编辑器' })).toBeVisible();
    await expect(page.locator('.dialog-body button', { hasText: '游戏/角色扮演' })).toHaveCount(0);

    // Select the option
    await page.locator('.dialog-body button', { hasText: '工具/编辑器' }).click();
    await expect(page.locator('.dialog-panel h3', { hasText: '选择子目录' })).toHaveCount(0);

    // Cancel edit
    await page.locator('.modal-actions button', { hasText: '取消' }).click();
  });
});

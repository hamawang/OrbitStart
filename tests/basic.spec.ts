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

  test('should assign externally dropped resources to the destination group', async ({ page }) => {
    await page.evaluate(() => {
      const target = document.querySelector<HTMLElement>('[data-resource-drop-group-id="apps"] .group-tab-btn');
      if (!target) throw new Error('Apps group drop target not found');
      const box = target.getBoundingClientRect();
      const dataTransfer = new DataTransfer();
      const file = new File([''], 'DroppedProjectFolder', { type: 'application/octet-stream' });
      Object.defineProperty(file, 'path', { value: 'C:\\DropTest\\DroppedProjectFolder' });
      dataTransfer.items.add(file);
      const eventInit: DragEventInit = {
        bubbles: true,
        cancelable: true,
        clientX: box.left + box.width / 2,
        clientY: box.top + box.height / 2,
        dataTransfer
      };
      target.dispatchEvent(new DragEvent('dragenter', eventInit));
      target.dispatchEvent(new DragEvent('dragover', eventInit));
      target.dispatchEvent(new DragEvent('drop', eventInit));
    });

    await expect(page.locator('[data-resource-drop-group-id="apps"] .group-tab-btn')).toHaveClass(/selected/);
    const droppedResource = page.locator('.resource-row', { hasText: 'DroppedProjectFolder' });
    await expect(droppedResource).toBeVisible();
    const storedGroup = await page.evaluate(() => {
      const items = JSON.parse(window.localStorage.getItem('orbitstart.browser.items') ?? '[]');
      return items.find((item: { title?: string }) => item.title === 'DroppedProjectFolder')?.group;
    });
    expect(storedGroup).toBe('apps');
  });

  test('should show version 0.8.2 on the about page', async ({ page }) => {
    await page.goto('/?panel=about');
    await page.waitForSelector('.app-shell', { timeout: 10000 });
    await expect(page.locator('.about-card')).toContainText('0.8.2');
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

  test('should display and interact with the batch remove tag dialog', async ({ page }) => {
    await page.evaluate(() => {
      window.localStorage.setItem('orbitstart.browser.items', JSON.stringify([
        {
          id: 'batch-test-1',
          title: 'Batch Test 1',
          subtitle: 'C:\\Test\\1.exe',
          kind: 'app',
          group: 'apps,web,scripts',
          target: 'C:\\Test\\1.exe',
          aliases: [],
          tags: ['manual'],
          subTag: '',
          icon: 'AppWindow',
          accent: '#5cc8ff',
          favorite: false,
          launchCount: 0
        },
        {
          id: 'batch-test-2',
          title: 'Batch Test 2',
          subtitle: 'C:\\Test\\2.exe',
          kind: 'app',
          group: 'apps,web',
          target: 'C:\\Test\\2.exe',
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

    // Click "批量管理" to enter batch mode
    await page.locator('button', { hasText: '批量管理' }).click();

    // Select both resources by clicking on them
    await page.locator('.resource-row[data-resource-id="batch-test-1"]').click();
    await page.locator('.resource-row[data-resource-id="batch-test-2"]').click();

    // Verify "已选 2 个" is visible in toolbar
    await expect(page.locator('.batch-toolbar strong')).toContainText('已选 2 个');

    // Click "批量移除标签" button
    await page.locator('.batch-toolbar button', { hasText: '批量移除标签' }).click();

    // Verify the dialog "批量移除标签" is visible
    await expect(page.locator('.dialog-panel h2', { hasText: '批量移除标签' })).toBeVisible();

    // Verify select input options
    const select = page.locator('.dialog-body select');
    await expect(select).toBeVisible();

    // Select the option "web"
    await select.selectOption('web');

    // Click confirm button
    await page.locator('.modal-actions button', { hasText: '移除标签' }).click();

    // Dialog should close
    await expect(page.locator('.dialog-panel h2', { hasText: '批量移除标签' })).toHaveCount(0);

    // Verify that 'web' is removed from both resources in localStorage
    const items = await page.evaluate(() => {
      return JSON.parse(window.localStorage.getItem('orbitstart.browser.items') ?? '[]');
    });

    const item1 = items.find((item: { id: string }) => item.id === 'batch-test-1');
    const item2 = items.find((item: { id: string }) => item.id === 'batch-test-2');

    expect(item1.group.split(',')).not.toContain('web');
    expect(item1.group.split(',')).toContain('apps');
    expect(item1.group.split(',')).toContain('scripts');

    expect(item2.group.split(',')).not.toContain('web');
    expect(item2.group.split(',')).toContain('apps');
  });

  test('should keep browser preview storage behavior without a Tauri bridge', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const bridgeDescriptor = Object.getOwnPropertyDescriptor(window, '__TAURI_INTERNALS__');
      if (bridgeDescriptor) delete (window as typeof window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;

      try {
        const native = await import('/src/lib/native.ts');
        const input = {
          title: 'Browser fallback item',
          subtitle: 'C:\\Preview\\browser-fallback.exe',
          kind: 'app' as const,
          group: 'apps',
          target: 'C:\\Preview\\browser-fallback.exe',
          aliases: ['browser fallback'],
          tags: ['fallback-test'],
          icon: 'AppWindow',
          accent: '#5cc8ff',
          favorite: false
        };

        const snapshot = await native.loadSnapshot();
        const created = await native.createItem(input);
        const updated = await native.updateItem({ ...created, title: 'Browser fallback item updated' });
        await native.deleteItem(updated.id);
        const imported = await native.importCatalogJson(JSON.stringify({ items: [{ ...created, id: 'browser-imported-item' }] }));
        const themed = await native.setActiveTheme('atelier-zero');
        const pluginSnapshot = await native.setPluginEnabled('core-items', false);
        const storedItems = JSON.parse(window.localStorage.getItem('orbitstart.browser.items') ?? '[]') as Array<{ id: string }>;

        return {
          snapshotHasItems: snapshot.items.length > 0,
          deletedItemIsAbsent: !storedItems.some((item) => item.id === updated.id),
          importedItemIsPresent: storedItems.some((item) => item.id === 'browser-imported-item'),
          imported: imported.imported,
          activeThemeId: themed.activeThemeId,
          pluginEnabled: pluginSnapshot.plugins.find((plugin) => plugin.id === 'core-items')?.enabled
        };
      } finally {
        if (bridgeDescriptor) {
          Object.defineProperty(window, '__TAURI_INTERNALS__', bridgeDescriptor);
        }
      }
    });

    expect(result.snapshotHasItems).toBe(true);
    expect(result.deletedItemIsAbsent).toBe(true);
    expect(result.importedItemIsPresent).toBe(true);
    expect(result.imported).toBe(1);
    expect(result.activeThemeId).toBe('atelier-zero');
    expect(result.pluginEnabled).toBe(false);
  });

  test('should surface Tauri invocation failures without mutating browser fallback storage', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const native = await import('/src/lib/native.ts');
      const item = {
        id: 'native-command-error-item',
        title: 'Native command error item',
        subtitle: 'C:\\Native\\error.exe',
        kind: 'app' as const,
        group: 'apps',
        target: 'C:\\Native\\error.exe',
        aliases: [],
        tags: [],
        icon: 'AppWindow',
        accent: '#5cc8ff',
        favorite: false,
        launchCount: 0
      };
      const storageKeys = [
        'orbitstart.browser.items',
        'orbitstart.browser.snapshot',
        'orbitstart.browser.trips',
        'orbitstart.browser.obsidian.vaults',
        'orbitstart.browser.obsidian.notes',
        'orbitstart.browser.obsidian.tasks'
      ];
      const initialStorage = Object.fromEntries(storageKeys.map((key) => [key, window.localStorage.getItem(key)]));
      const bridgeDescriptor = Object.getOwnPropertyDescriptor(window, '__TAURI_INTERNALS__');

      Object.defineProperty(window, '__TAURI_INTERNALS__', {
        configurable: true,
        value: {
          invoke: async (command: string) => {
            if (command === 'log_frontend_error') return undefined;
            throw new Error(`IPC failed for ${command}`);
          }
        }
      });

      const commands: Array<[string, () => Promise<unknown>]> = [
        ['catalog_snapshot', () => native.loadSnapshot()],
        ['create_item', () => native.createItem(item)],
        ['update_item', () => native.updateItem(item)],
        ['delete_item', () => native.deleteItem(item.id)],
        ['import_catalog_json', () => native.importCatalogJson(JSON.stringify({ items: [] }))],
        ['set_active_theme', () => native.setActiveTheme('atelier-zero')],
        ['set_plugin_enabled', () => native.setPluginEnabled('core-items', false)]
      ];

      try {
        const failures = [] as Array<{ expectedCommand: string; name: string; command?: string }>;
        for (const [expectedCommand, invoke] of commands) {
          try {
            await invoke();
            failures.push({ expectedCommand, name: 'resolved' });
          } catch (error) {
            const nativeError = error as { name?: string; command?: string };
            failures.push({
              expectedCommand,
              name: nativeError.name ?? 'UnknownError',
              command: nativeError.command
            });
          }
        }

        const finalStorage = Object.fromEntries(storageKeys.map((key) => [key, window.localStorage.getItem(key)]));
        return { failures, storageUnchanged: JSON.stringify(initialStorage) === JSON.stringify(finalStorage) };
      } finally {
        if (bridgeDescriptor) {
          Object.defineProperty(window, '__TAURI_INTERNALS__', bridgeDescriptor);
        } else {
          delete (window as typeof window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
        }
      }
    });

    expect(result.storageUnchanged).toBe(true);
    expect(result.failures).toEqual([
      { expectedCommand: 'catalog_snapshot', name: 'NativeCommandError', command: 'catalog_snapshot' },
      { expectedCommand: 'create_item', name: 'NativeCommandError', command: 'create_item' },
      { expectedCommand: 'update_item', name: 'NativeCommandError', command: 'update_item' },
      { expectedCommand: 'delete_item', name: 'NativeCommandError', command: 'delete_item' },
      { expectedCommand: 'import_catalog_json', name: 'NativeCommandError', command: 'import_catalog_json' },
      { expectedCommand: 'set_active_theme', name: 'NativeCommandError', command: 'set_active_theme' },
      { expectedCommand: 'set_plugin_enabled', name: 'NativeCommandError', command: 'set_plugin_enabled' }
    ]);
  });
});

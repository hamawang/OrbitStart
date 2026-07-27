import { expect, test } from "@playwright/test";

test.use({
  storageState: {
    cookies: [],
    origins: [
      {
        origin: "http://127.0.0.1:1422",
        localStorage: [
          {
            name: "orbitstart_onboarding_v1",
            value: JSON.stringify({ completed: true })
          }
        ]
      }
    ]
  }
});

test("keeps prefix replacement bounded for drive and UNC paths and rejects relative-path repair", async ({ page }) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const repair = await import("/src/features/catalog/resourcePathRepair.ts");
    const missingReport = {
      pathMode: "absolute" as const,
      target: "C:\\OldRoot\\Tools\\tool.exe",
      status: "missing" as const
    };
    const relativeItem = {
      id: "relative",
      title: "Portable item",
      subtitle: "resources\\tool.exe",
      kind: "app" as const,
      group: "apps",
      target: "resources\\tool.exe",
      aliases: [],
      tags: [],
      icon: "AppWindow",
      accent: "#5cc8ff",
      favorite: false,
      launchCount: 0,
      pathMode: "data-relative" as const
    };
    return {
      driveReplacement: repair.replaceAbsolutePathPrefix("C:\\OldRoot\\Tools\\tool.exe", "c:/oldroot", "D:/NewRoot"),
      driveBoundaryCollision: repair.replaceAbsolutePathPrefix("C:\\OldRootBackup\\tool.exe", "C:\\OldRoot", "D:\\NewRoot"),
      uncReplacement: repair.replaceAbsolutePathPrefix("\\\\old-host\\share\\Tools\\tool.exe", "\\\\old-host\\share", "\\\\new-host\\share"),
      invalidRelativeTarget: repair.replaceAbsolutePathPrefix("resources\\tool.exe", "C:\\OldRoot", "D:\\NewRoot"),
      traversalPrefix: repair.normalizeAbsolutePathPrefix("C:\\OldRoot\\..\\Elsewhere"),
      rawDevicePrefix: repair.normalizeAbsolutePathPrefix("\\\\?\\C:\\OldRoot"),
      relativeIsRepairable: repair.isPathPrefixRepairable(relativeItem),
      relativePreview: repair.buildResourcePathRepairPreview([relativeItem], { relative: { ...missingReport, pathMode: "data-relative", target: relativeItem.target } }, "C:\\OldRoot", "D:\\NewRoot")[0]
    };
  });

  expect(result.driveReplacement).toBe("D:\\NewRoot\\Tools\\tool.exe");
  expect(result.driveBoundaryCollision).toBeNull();
  expect(result.uncReplacement).toBe("\\\\new-host\\share\\Tools\\tool.exe");
  expect(result.invalidRelativeTarget).toBeNull();
  expect(result.traversalPrefix).toBeNull();
  expect(result.rawDevicePrefix).toBeNull();
  expect(result.relativeIsRepairable).toBe(false);
  expect(result.relativePreview.eligible).toBe(false);
  expect(result.relativePreview.reason).toContain("相对路径");
});

test("inspects paths, previews only bounded missing absolute-path replacements, and requires confirmation", async ({ page }) => {
  await page.goto("/");
  await page.waitForSelector(".app-shell", { timeout: 10000 });
  await page.evaluate(() => {
    window.localStorage.setItem("orbitstart.browser.items", JSON.stringify([
      {
        id: "repair-missing",
        title: "Moved tool",
        subtitle: "C:\\OldRoot\\Tools\\tool.exe",
        kind: "app",
        group: "apps",
        target: "C:\\OldRoot\\Tools\\tool.exe",
        aliases: [],
        tags: [],
        icon: "AppWindow",
        accent: "#5cc8ff",
        favorite: false,
        launchCount: 0,
        pathMode: "absolute"
      },
      {
        id: "repair-prefix-collision",
        title: "Must not match a partial prefix",
        subtitle: "C:\\OldRootBackup\\tool.exe",
        kind: "app",
        group: "apps",
        target: "C:\\OldRootBackup\\tool.exe",
        aliases: [],
        tags: [],
        icon: "AppWindow",
        accent: "#5cc8ff",
        favorite: false,
        launchCount: 0,
        pathMode: "absolute"
      },
      {
        id: "repair-available",
        title: "Still available",
        subtitle: "C:\\OldRoot\\Tools\\present.exe",
        kind: "app",
        group: "apps",
        target: "C:\\OldRoot\\Tools\\present.exe",
        aliases: [],
        tags: [],
        icon: "AppWindow",
        accent: "#5cc8ff",
        favorite: false,
        launchCount: 0,
        pathMode: "absolute"
      },
      {
        id: "repair-relative",
        title: "Portable relative tool",
        subtitle: "resources\\tool.exe",
        kind: "app",
        group: "apps",
        target: "resources\\tool.exe",
        aliases: [],
        tags: [],
        icon: "AppWindow",
        accent: "#5cc8ff",
        favorite: false,
        launchCount: 0,
        pathMode: "data-relative"
      }
    ]));
  });
  await page.reload();
  await page.waitForSelector(".app-shell", { timeout: 10000 });
  await page.goto("/?panel=settings");
  await page.waitForSelector(".settings-shell", { timeout: 10000 });

  await page.evaluate(() => {
    const updates: Array<{ id: string; target: string }> = [];
    const operations: string[] = [];
    Object.defineProperty(window, "__TAURI_INTERNALS__", {
      configurable: true,
      value: {
        invoke: async (command: string, args?: { id?: string; item?: { id: string; target: string } }) => {
          if (command === "log_frontend_error") return undefined;
          if (command === "get_item_path_status") {
            const id = args?.id;
            if (id === "repair-available") {
              return { pathMode: "absolute", target: "C:\\OldRoot\\Tools\\present.exe", resolvedPath: "C:\\OldRoot\\Tools\\present.exe", status: "available" };
            }
            return {
              pathMode: id === "repair-relative" ? "data-relative" : "absolute",
              target: id === "repair-relative" ? "resources\\tool.exe" : id === "repair-prefix-collision" ? "C:\\OldRootBackup\\tool.exe" : "C:\\OldRoot\\Tools\\tool.exe",
              status: "missing"
            };
          }
          if (command === "export_catalog_json") {
            operations.push("backup");
            return { path: "C:\\OrbitStart.Data\\backups\\repair-before.json", json: "{}" };
          }
          if (command === "update_item") {
            if (!args?.item) throw new Error("Expected an item update");
            operations.push(`update:${args.item.id}`);
            updates.push({ id: args.item.id, target: args.item.target });
            return args.item;
          }
          throw new Error(`Unexpected native command: ${command}`);
        }
      }
    });
    (window as typeof window & { __repairUpdates?: Array<{ id: string; target: string }> }).__repairUpdates = updates;
    (window as typeof window & { __repairOperations?: string[] }).__repairOperations = operations;
  });

  await page.locator(".settings-menu button", { hasText: "数据备份" }).click();
  await page.getByRole("button", { name: "检查并预览路径修复" }).click();

  const dialog = page.getByRole("dialog", { name: "资源路径修复" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "检查失效资源" }).click();
  await expect(dialog).toContainText("已检查 4 / 4 项");
  await expect(dialog).toContainText("发现 3 项不存在");

  await dialog.getByLabel("旧路径前缀").fill("C:\\OldRoot");
  await dialog.getByLabel("新路径前缀").fill("D:\\NewRoot");
  await expect(dialog).toContainText("可预览替换 1 项");
  await expect(dialog).toContainText("预览：D:\\NewRoot\\Tools\\tool.exe");
  await expect(dialog).toContainText("相对路径保留其数据目录或工作区根目录");

  const saveButton = dialog.getByRole("button", { name: /确认并保存所选路径/ });
  await expect(saveButton).toBeDisabled();
  await dialog.getByRole("button", { name: "选择全部可修复项" }).click();
  await dialog.locator(".checkbox-field input").check();
  await expect(saveButton).toBeEnabled();
  await saveButton.click();
  await expect(dialog).toHaveCount(0);

  const updates = await page.evaluate(() => (window as typeof window & { __repairUpdates?: Array<{ id: string; target: string }> }).__repairUpdates ?? []);
  expect(updates).toEqual([{ id: "repair-missing", target: "D:\\NewRoot\\Tools\\tool.exe" }]);
  const operations = await page.evaluate(() => (window as typeof window & { __repairOperations?: string[] }).__repairOperations ?? []);
  expect(operations).toEqual(["backup", "update:repair-missing"]);
});

import { expect, test, type Page } from "@playwright/test";

const STORAGE_KEYS = {
  items: "orbitstart.browser.items",
  snapshot: "orbitstart.browser.snapshot",
  workspaces: "orbitstart.plugin.workspaces.storage.workspaces",
  steps: "orbitstart.plugin.workspaces.storage.steps",
  onboarding: "orbitstart_onboarding_v1"
} as const;

const workspaceFixture = {
  items: [
    {
      id: "workspace-browser-resource",
      title: "Workspace Browser Resource",
      subtitle: "A resource supplied by the browser fixture",
      kind: "app",
      group: "apps",
      target: "C:\\BrowserFixture\\resource.exe",
      aliases: [],
      tags: ["e2e"],
      icon: "AppWindow",
      accent: "#5cc8ff",
      favorite: false,
      launchCount: 0
    }
  ],
  plugins: [
    {
      id: "workspaces",
      name: "Workspaces",
      version: "0.8.4-test",
      description: "Browser-only Workspaces fixture",
      enabled: true,
      builtin: false,
      permissions: [],
      contributes: { commands: 0, searchProviders: 0, themes: 0, views: 1 }
    }
  ],
  workspaces: [
    {
      id: "e2e-workspace",
      name: "Browser Workspace",
      description: "Persisted browser-only workspace",
      icon: "Briefcase",
      color: "#5cc8ff",
      enabled: true,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      launchCount: 2
    }
  ],
  steps: [
    {
      id: "e2e-step-resource",
      workspaceId: "e2e-workspace",
      order: 1,
      type: "item",
      title: "Unlinked workspace resource",
      target: "",
      enabled: true,
      dependsOn: [],
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z"
    },
    {
      id: "e2e-step-docs",
      workspaceId: "e2e-workspace",
      order: 2,
      type: "website",
      title: "Browser Docs",
      target: "https://example.test/docs",
      enabled: true,
      dependsOn: ["e2e-step-resource"],
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z"
    }
  ]
};

async function openWorkspaceEditor(page: Page) {
  const workspaceCard = page.locator(".workspace-card", { hasText: "Browser Workspace" });
  await expect(workspaceCard).toBeVisible();
  await workspaceCard.locator(".action-buttons .icon-button").first().click();
  await expect(page.locator(".workspace-editor")).toBeVisible();
}

test.describe("Workspaces browser regression coverage", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript((fixture) => {
      localStorage.setItem("orbitstart_onboarding_v1", JSON.stringify({ completed: true }));
      localStorage.setItem("orbitstart.browser.items", JSON.stringify(fixture.items));
      localStorage.setItem("orbitstart.browser.snapshot", JSON.stringify({ plugins: fixture.plugins }));
      localStorage.setItem("orbitstart.plugin.workspaces.storage.workspaces", JSON.stringify(fixture.workspaces));
      localStorage.setItem("orbitstart.plugin.workspaces.storage.steps", JSON.stringify(fixture.steps));
    }, workspaceFixture);

    await page.goto("/");
    await expect(page.locator(".app-shell")).toBeVisible();

    // The browser fixture enables only Workspaces, so this is the stable second rail entry.
    const railButtons = page.locator("nav.rail .rail-button");
    await expect(railButtons).toHaveCount(4);
    await railButtons.nth(1).click();
    await expect(page.locator(".workspace-panel")).toBeVisible();
  });

  test("opens a saved workspace and persists an editor change without native IPC", async ({ page }) => {
    await openWorkspaceEditor(page);

    const nameInput = page.locator(".workspace-editor .meta-section .input-group input[type='text']").first();
    await expect(nameInput).toHaveValue("Browser Workspace");
    await nameInput.fill("Renamed Browser Workspace");
    await page.locator(".editor-footer .primary-action").click();

    await expect(page.locator(".workspaces-list-view")).toBeVisible();
    await expect(page.locator(".workspace-card h4")).toHaveText("Renamed Browser Workspace");

    const savedName = await page.evaluate((storageKey) => {
      const workspaces = JSON.parse(localStorage.getItem(storageKey) ?? "[]") as Array<{ name?: string }>;
      return workspaces[0]?.name;
    }, STORAGE_KEYS.workspaces);
    expect(savedName).toBe("Renamed Browser Workspace");
  });

  test("selects a browser resource from the workspace editor", async ({ page }) => {
    await openWorkspaceEditor(page);

    // Card mode exposes the resource-picker action for an unlinked item step.
    await page.locator(".steps-header button").nth(1).click();
    const firstStep = page.locator(".step-item").first();
    await firstStep.locator(".step-collapsed-summary").click();
    await firstStep.locator(".select-resource-btn").click();

    const selector = page.locator(".resource-selector-modal");
    await expect(selector).toBeVisible();
    await selector.locator(".selector-result-item", { hasText: "Workspace Browser Resource" }).click();
    await expect(selector).toHaveCount(0);
    await expect(firstStep.locator(".step-preview-title")).toHaveText("Workspace Browser Resource");

    await page.locator(".editor-footer .primary-action").click();
    const selectedItemId = await page.evaluate((storageKey) => {
      const steps = JSON.parse(localStorage.getItem(storageKey) ?? "[]") as Array<{ id?: string; itemId?: string }>;
      return steps.find((step) => step.id === "e2e-step-resource")?.itemId;
    }, STORAGE_KEYS.steps);
    expect(selectedItemId).toBe("workspace-browser-resource");
  });

  test("supports graph selection and a list-view switch for persisted steps", async ({ page }) => {
    await openWorkspaceEditor(page);

    const graph = page.locator(".graph-viewport");
    await expect(graph).toBeVisible();
    await graph.getByText("Browser Docs", { exact: true }).dispatchEvent("click");
    const detailsDrawer = page.locator(".graph-node-details-drawer");
    await expect(detailsDrawer).toBeVisible();
    await expect(detailsDrawer.locator("input[type='text']").first()).toHaveValue("Browser Docs");

    await page.locator(".steps-header button").nth(2).click();
    await expect(page.locator(".steps-list-table")).toBeVisible();
    await expect(page.locator(".steps-list-table tbody tr")).toHaveCount(2);
    await expect(page.locator(".steps-list-table")).toContainText("Browser Docs");
  });

  test("opens the workspace right-click menu and safely enters edit mode", async ({ page }) => {
    const workspaceCard = page.locator(".workspace-card", { hasText: "Browser Workspace" });
    const box = await workspaceCard.boundingBox();
    expect(box).not.toBeNull();

    await workspaceCard.dispatchEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
      button: 2,
      clientX: Math.round(box!.x + 12),
      clientY: Math.round(box!.y + 12)
    });

    const contextMenu = page.locator(".workspace-custom-contextmenu");
    await expect(contextMenu).toBeVisible();
    await expect(contextMenu.locator(".contextmenu-item")).toHaveCount(3);
    await contextMenu.locator(".contextmenu-item").nth(1).click();
    await expect(page.locator(".workspace-editor")).toBeVisible();
  });
});

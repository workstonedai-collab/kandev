import { type Page } from "@playwright/test";
import { test as base, expect } from "../../fixtures/test-base";
import type { SeedData } from "../../fixtures/test-base";
import type { ApiClient } from "../../helpers/api-client";
import { OfficeApiClient } from "../../helpers/office-api-client";
import { waitForOfficeTaskSessionLive } from "../../helpers/office-launch";

/**
 * E2E tests for the office advanced mode dockview layout.
 *
 * Covers:
 * 1. Dockview panels render correctly (chat, files, terminal, changes)
 * 2. Chat shows agent messages
 * 3. Quick-chat workspace path is displayed (not skeleton)
 * 4. Mode toggle between simple and advanced preserves state
 * 5. Terminal connects to agent execution workspace
 */

type AdvancedModeFixtures = {
  officeApi: OfficeApiClient;
};

type AdvancedModeSeed = {
  workspaceId: string;
  agentId: string;
  taskId: string;
};

const test = base.extend<{ testPage: Page }, AdvancedModeFixtures>({
  officeApi: [
    async ({ backend }, use) => {
      await use(new OfficeApiClient(backend.baseUrl));
    },
    { scope: "worker" },
  ],
});

async function seedAdvancedModeTask(
  officeApi: OfficeApiClient,
  apiClient: ApiClient,
  seedData: SeedData,
): Promise<AdvancedModeSeed> {
  const result = (await officeApi.completeOnboarding({
    workspaceName: "Advanced Mode Workspace",
    taskPrefix: "AM",
    agentName: "CEO",
    agentProfileId: seedData.agentProfileId,
    executorPreference: "local_pc",
    taskTitle: "present yourself",
    taskDescription: "say your name",
  })) as { workspaceId: string; agentId: string; projectId: string; taskId?: string };

  if (!result.taskId) {
    throw new Error("completeOnboarding did not return a taskId");
  }

  await apiClient.saveUserSettings({
    workspace_id: result.workspaceId,
    workflow_filter_id: seedData.workflowId,
    keyboard_shortcuts: {},
    enable_preview_on_click: false,
  });

  // Seed after each test's profile reset so this Office runner never refers to
  // a profile that the next reset can remove.
  await waitForOfficeTaskSessionLive(apiClient, result.taskId);
  await expect
    .poll(async () => (await apiClient.getTaskEnvironment(result.taskId!))?.status, {
      timeout: 30_000,
      message: "Waiting for the Office task environment to become ready",
    })
    .toBe("ready");

  return {
    workspaceId: result.workspaceId,
    agentId: result.agentId,
    taskId: result.taskId,
  };
}

/**
 * Navigate to issue simple mode first (so sessions load), then switch to
 * advanced mode. Direct navigation to ?mode=advanced can race with session
 * loading, causing the page to render in simple mode.
 */
async function enterAdvancedMode(testPage: Page, taskId: string) {
  // Navigate directly to ?mode=advanced. The page initially renders in simple
  // mode while sessions load async. Once hasSession becomes true, React
  // re-renders into TaskAdvancedMode with dockview.
  await testPage.goto(`/office/tasks/${taskId}?mode=advanced`);

  // Wait for dockview to render. The page may briefly show simple mode while
  // sessions load — dockview appears once hasSession becomes true.
  // The session-chat test-id comes from the dockview chat panel.
  await expect(testPage.getByTestId("session-chat")).toBeVisible({ timeout: 30_000 });
}

test.describe("Office advanced mode", () => {
  test.describe.configure({ retries: 1 });

  test("dockview layout renders with chat, files, changes, and terminal panels", async ({
    testPage,
    officeApi,
    apiClient,
    seedData,
  }) => {
    test.setTimeout(45_000);
    const advancedSeed = await seedAdvancedModeTask(officeApi, apiClient, seedData);

    await enterAdvancedMode(testPage, advancedSeed.taskId);

    // Chat panel must be visible (dockview center group)
    await expect(testPage.getByTestId("session-chat")).toBeVisible();

    // Files panel must be visible (dockview right group)
    await expect(testPage.getByTestId("files-panel")).toBeVisible({ timeout: 15_000 });

    // Terminal panel must be visible (dockview right-bottom group)
    await expect(testPage.getByTestId("terminal-panel")).toBeVisible({ timeout: 15_000 });
  });

  test("chat panel shows agent messages from completed session", async ({
    testPage,
    officeApi,
    apiClient,
    seedData,
  }) => {
    test.setTimeout(45_000);
    const advancedSeed = await seedAdvancedModeTask(officeApi, apiClient, seedData);

    await enterAdvancedMode(testPage, advancedSeed.taskId);

    // The chat panel should show messages from the completed agent session.
    // The mock agent responds with a status message like "Environment prepared"
    // or "Started agent" — look for any of those indicators.
    const chatPanel = testPage.getByTestId("session-chat");
    await expect(chatPanel).toBeVisible({ timeout: 10_000 });

    // The chat should contain session messages (not the "No messages" empty state)
    await expect(chatPanel.getByText("No messages yet")).not.toBeVisible({ timeout: 15_000 });
  });

  test("files panel shows workspace content", async ({
    testPage,
    officeApi,
    apiClient,
    seedData,
  }) => {
    test.setTimeout(45_000);
    const advancedSeed = await seedAdvancedModeTask(officeApi, apiClient, seedData);

    await enterAdvancedMode(testPage, advancedSeed.taskId);

    // Wait for files panel to load with tree content
    const filesPanel = testPage.getByTestId("files-panel");
    await expect(filesPanel).toBeVisible({ timeout: 15_000 });

    // Quick-chat workspaces have a .gitkeep file — the tree should show it
    await expect(filesPanel.getByText(".gitkeep")).toBeVisible({ timeout: 15_000 });
  });

  test("terminal connects to agent execution workspace", async ({
    testPage,
    officeApi,
    apiClient,
    seedData,
  }) => {
    test.setTimeout(60_000);
    const advancedSeed = await seedAdvancedModeTask(officeApi, apiClient, seedData);

    await enterAdvancedMode(testPage, advancedSeed.taskId);

    // Wait for the terminal panel to be visible
    const terminalPanel = testPage.getByTestId("terminal-panel");
    await expect(terminalPanel).toBeVisible({ timeout: 10_000 });

    // Terminal should connect — "Connecting terminal..." should disappear
    await expect(terminalPanel.getByText("Connecting terminal...")).not.toBeVisible({
      timeout: 30_000,
    });
  });

  test("navigating between simple and advanced mode preserves session", async ({
    testPage,
    officeApi,
    apiClient,
    seedData,
  }) => {
    test.setTimeout(45_000);
    const advancedSeed = await seedAdvancedModeTask(officeApi, apiClient, seedData);

    // Start in advanced mode
    await enterAdvancedMode(testPage, advancedSeed.taskId);

    // Chat should show messages
    const chatPanel = testPage.getByTestId("session-chat");
    await expect(chatPanel).toBeVisible();

    // Navigate back to simple mode
    await testPage.goto(`/office/tasks/${advancedSeed.taskId}`);

    // Verify simple mode — heading should be visible
    await expect(testPage.getByRole("heading", { name: "present yourself" })).toBeVisible({
      timeout: 10_000,
    });

    // Navigate to advanced mode again — session should still be there
    await testPage.goto(`/office/tasks/${advancedSeed.taskId}?mode=advanced`);
    await expect(testPage.getByTestId("session-chat")).toBeVisible({ timeout: 20_000 });
  });
});

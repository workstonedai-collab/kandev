import { describe, expect, it, vi } from "vitest";
import type { ApiClient } from "./api-client";
import { createStandardProfile } from "./git-helper";

describe("createStandardProfile", () => {
  it("uses the enabled E2E mock agent instead of the first registered agent", async () => {
    const createAgentProfile = vi.fn().mockResolvedValue({ id: "profile-1" });
    const apiClient = {
      listAgents: vi.fn().mockResolvedValue({
        agents: [
          { id: "disabled-codex", name: "codex" },
          { id: "e2e-mock-agent", name: "mock-agent" },
        ],
      }),
      createAgentProfile,
    } as unknown as ApiClient;

    await createStandardProfile(apiClient, "E2E profile");

    expect(createAgentProfile).toHaveBeenCalledWith("e2e-mock-agent", "E2E profile", {
      model: "mock-fast",
      auto_approve: true,
      cli_passthrough: false,
    });
  });
});

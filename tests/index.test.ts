import { describe, it, expect } from "bun:test"
import { SessionContextPlugin } from "../src/index"

describe("SessionContextPlugin", () => {
  it("should export a plugin function", () => {
    expect(typeof SessionContextPlugin).toBe("function")
  })

  it("should have correct plugin structure when inactive", async () => {
    const mockClient = {
      app: {
        log: async () => {},
      },
    }

    const mockProject = {
      id: "test-project",
      worktree: "/tmp/test-project",
      time: { created: Date.now() },
    }

    const pluginHooks = await SessionContextPlugin({
      project: mockProject,
      client: mockClient,
      directory: "/tmp/test-project",
      worktree: "/tmp/test-project",
      serverUrl: new URL("http://localhost"),
      $: {} as any,
    })

    expect(typeof pluginHooks).toBe("object")
  })

  it("should handle missing config gracefully", async () => {
    const mockClient = {
      app: {
        log: async () => {},
      },
    }

    const mockProject = {
      id: "test-project",
      worktree: "/tmp/test-project",
      time: { created: Date.now() },
    }

    const pluginHooks = await SessionContextPlugin({
      project: mockProject,
      client: mockClient,
      directory: "/tmp/nonexistent",
      worktree: "/tmp/nonexistent",
      serverUrl: new URL("http://localhost"),
      $: {} as any,
    })

    expect(typeof pluginHooks).toBe("object")
  })
})

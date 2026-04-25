import { describe, it, expect } from "bun:test"
import { SessionContextPlugin } from "../src/plugin"

describe("SessionContextPlugin", () => {
  it("should export a plugin function", () => {
    expect(typeof SessionContextPlugin).toBe("function")
  })

  it("should return hook object when inactive (no DB)", async () => {
    const mockClient = {
      app: {
        log: async () => {},
      },
    }

    const pluginHooks = await SessionContextPlugin({
      project: { id: "test", worktree: "/tmp/test", time: { created: Date.now() } },
      client: mockClient,
      directory: "/tmp/nonexistent-dir-" + Date.now(),
      worktree: "/tmp/nonexistent-dir-" + Date.now(),
      serverUrl: new URL("http://localhost"),
      $: {} as any,
    })

    expect(typeof pluginHooks).toBe("object")
    expect(typeof pluginHooks["experimental.session.compacting"]).toBe("function")
  })

  it("should handle missing config gracefully", async () => {
    const mockClient = {
      app: {
        log: async () => {},
      },
    }

    const pluginHooks = await SessionContextPlugin({
      project: { id: "test", worktree: "/tmp/test", time: { created: Date.now() } },
      client: mockClient,
      directory: "/tmp/nonexistent",
      worktree: "/tmp/nonexistent",
      serverUrl: new URL("http://localhost"),
      $: {} as any,
    })

    expect(typeof pluginHooks).toBe("object")
  })
})

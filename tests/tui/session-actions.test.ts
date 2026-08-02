import { describe, expect, it, vi } from "vitest";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import {
  handleSessionActions,
  readSessionDetails,
  renameCurrentSession,
  startSessionCompaction,
} from "../../src/tui/session-actions.ts";

function commandContext(overrides: Record<string, unknown> = {}) {
  return {
    mode: "tui",
    cwd: "/work/pi-status",
    model: { provider: "anthropic", id: "claude-sonnet-4" },
    sessionManager: {
      getSessionId: () => "session-123",
      getSessionFile: () => "/tmp/session-123.jsonl",
    },
    ui: {
      select: vi.fn(),
      input: vi.fn(),
      confirm: vi.fn(),
      notify: vi.fn(),
    },
    compact: vi.fn(),
    ...overrides,
  } as unknown as ExtensionCommandContext;
}

function extensionApi(overrides: Record<string, unknown> = {}) {
  return {
    getSessionName: vi.fn(() => "Original name"),
    setSessionName: vi.fn(),
    ...overrides,
  } as unknown as ExtensionAPI;
}

describe("handleSessionActions", () => {
  it("trims and applies a renamed session through Pi", async () => {
    const ctx = commandContext();
    vi.mocked(ctx.ui.select).mockResolvedValue("Rename session");
    vi.mocked(ctx.ui.input).mockResolvedValue("  Release work  ");
    let currentName = "Original name";
    const pi = extensionApi({
      getSessionName: vi.fn(() => currentName),
      setSessionName: vi.fn((next: string) => {
        currentName = next;
      }),
    });

    await handleSessionActions(pi, ctx);

    expect(ctx.ui.select).toHaveBeenCalledWith(
      [
        "Session details",
        "Name: Original name",
        "ID: session-123",
        "File: /tmp/session-123.jsonl",
        "Directory: /work/pi-status",
        "Model: anthropic/claude-sonnet-4",
      ].join("\n"),
      ["Rename session", "Compact session", "Close"],
    );
    expect(pi.setSessionName).toHaveBeenCalledWith("Release work");
    expect(ctx.ui.notify).toHaveBeenCalledWith("Session renamed to Release work", "info");
  });

  it.each([undefined, "   "])("does not rename for input %j", async (input) => {
    const ctx = commandContext();
    vi.mocked(ctx.ui.select).mockResolvedValue("Rename session");
    vi.mocked(ctx.ui.input).mockResolvedValue(input);
    const pi = extensionApi();

    await handleSessionActions(pi, ctx);

    expect(pi.setSessionName).not.toHaveBeenCalled();
  });

  it("compacts only after explicit confirmation", async () => {
    const compact = vi.fn();
    const ctx = commandContext({ compact });
    vi.mocked(ctx.ui.select).mockResolvedValue("Compact session");
    vi.mocked(ctx.ui.confirm).mockResolvedValue(true);

    await handleSessionActions(extensionApi(), ctx);

    expect(ctx.ui.confirm).toHaveBeenCalledWith(
      "Compact session?",
      "Pi will summarize older context for session session-123. Continue?",
    );
    expect(compact).toHaveBeenCalledOnce();
    const options = compact.mock.calls[0]?.[0] as {
      onComplete: () => void;
    };
    options.onComplete();
    expect(ctx.ui.notify).toHaveBeenCalledWith("Session compacted", "info");
  });

  it("reports a compaction callback failure without throwing", async () => {
    const compact = vi.fn();
    const ctx = commandContext({ compact });
    vi.mocked(ctx.ui.select).mockResolvedValue("Compact session");
    vi.mocked(ctx.ui.confirm).mockResolvedValue(true);

    await handleSessionActions(extensionApi(), ctx);

    const options = compact.mock.calls[0]?.[0] as {
      onError: (error: Error) => void;
    };
    options.onError(new Error("compact failed"));
    expect(ctx.ui.notify).toHaveBeenCalledWith("compact failed", "warning");
  });

  it("keeps deferred compaction notifications nonfatal after the context becomes stale", async () => {
    const compact = vi.fn();
    const ctx = commandContext({ compact });
    vi.mocked(ctx.ui.select).mockResolvedValue("Compact session");
    vi.mocked(ctx.ui.confirm).mockResolvedValue(true);

    await handleSessionActions(extensionApi(), ctx);

    const options = compact.mock.calls[0]?.[0] as {
      onComplete: () => void;
      onError: (error: Error) => void;
    };
    vi.mocked(ctx.ui.notify).mockImplementation(() => {
      throw new Error("stale context");
    });

    expect(() => options.onComplete()).not.toThrow();
    expect(() => options.onError(new Error("compact failed"))).not.toThrow();
  });

  it("reports a synchronous compaction-start failure", async () => {
    const ctx = commandContext({
      compact: vi.fn(() => {
        throw new Error("compact unavailable");
      }),
    });
    vi.mocked(ctx.ui.select).mockResolvedValue("Compact session");
    vi.mocked(ctx.ui.confirm).mockResolvedValue(true);

    await handleSessionActions(extensionApi(), ctx);

    expect(ctx.ui.notify).toHaveBeenCalledWith(
      "Session action failed: compact unavailable",
      "warning",
    );
  });

  it("does not compact when confirmation is declined", async () => {
    const ctx = commandContext();
    vi.mocked(ctx.ui.select).mockResolvedValue("Compact session");
    vi.mocked(ctx.ui.confirm).mockResolvedValue(false);

    await handleSessionActions(extensionApi(), ctx);

    expect(ctx.compact).not.toHaveBeenCalled();
  });

  it("does nothing when the menu is closed", async () => {
    const ctx = commandContext();
    vi.mocked(ctx.ui.select).mockResolvedValue(undefined);
    const pi = extensionApi();

    await handleSessionActions(pi, ctx);

    expect(pi.setSessionName).not.toHaveBeenCalled();
    expect(ctx.compact).not.toHaveBeenCalled();
  });

  it("reads dashboard session details without opening a selector", () => {
    const ctx = commandContext();
    const pi = extensionApi();

    expect(readSessionDetails(pi, ctx)).toEqual({
      name: "Original name",
      id: "session-123",
      file: "/tmp/session-123.jsonl",
      directory: "/work/pi-status",
      model: "anthropic/claude-sonnet-4",
    });
    expect(ctx.ui.select).not.toHaveBeenCalled();
  });

  it("trims a rename and returns refreshed session details", () => {
    const ctx = commandContext();
    let name = "Original name";
    const pi = extensionApi({
      getSessionName: vi.fn(() => name),
      setSessionName: vi.fn((next: string) => {
        name = next;
      }),
    });

    expect(renameCurrentSession(pi, ctx, "  Release work  ").name).toBe("Release work");
    expect(pi.setSessionName).toHaveBeenCalledWith("Release work");
  });

  it("leaves a blank rename unchanged", () => {
    const ctx = commandContext();
    const pi = extensionApi();

    expect(renameCurrentSession(pi, ctx, "   ").name).toBe("Original name");
    expect(pi.setSessionName).not.toHaveBeenCalled();
  });

  it("starts compaction with stale-safe callbacks", () => {
    const ctx = commandContext();
    startSessionCompaction(ctx);

    expect(ctx.compact).toHaveBeenCalledOnce();
    const options = vi.mocked(ctx.compact).mock.calls[0]?.[0] as {
      onComplete(): void;
      onError(error: Error): void;
    };
    options.onComplete();
    options.onError(new Error("compact failed"));
    expect(ctx.ui.notify).toHaveBeenCalledWith("Session compacted", "info");
    expect(ctx.ui.notify).toHaveBeenCalledWith("compact failed", "warning");
  });

  it("rejects RPC mode without opening native prompts", async () => {
    const ctx = commandContext({ mode: "rpc" });

    await handleSessionActions(extensionApi(), ctx);

    expect(ctx.ui.select).not.toHaveBeenCalled();
    expect(ctx.ui.notify).toHaveBeenCalledWith(
      "/statusline session requires interactive TUI",
      "warning",
    );
  });

  it("reports a rename failure without throwing", async () => {
    const ctx = commandContext();
    vi.mocked(ctx.ui.select).mockResolvedValue("Rename session");
    vi.mocked(ctx.ui.input).mockResolvedValue("Release work");
    const pi = extensionApi({
      setSessionName: vi.fn(() => {
        throw new Error("rename failed");
      }),
    });

    await handleSessionActions(pi, ctx);

    expect(ctx.ui.notify).toHaveBeenCalledWith("Session action failed: rename failed", "warning");
  });

  it("reports a session metadata failure without throwing", async () => {
    const ctx = commandContext();
    const pi = extensionApi({
      getSessionName: vi.fn(() => {
        throw new Error("metadata unavailable");
      }),
    });

    await handleSessionActions(pi, ctx);

    expect(ctx.ui.select).not.toHaveBeenCalled();
    expect(ctx.ui.notify).toHaveBeenCalledWith(
      "Session action failed: metadata unavailable",
      "warning",
    );
  });

  it("reports a native prompt failure without throwing", async () => {
    const ctx = commandContext();
    vi.mocked(ctx.ui.select).mockRejectedValue(new Error("prompt unavailable"));

    await handleSessionActions(extensionApi(), ctx);

    expect(ctx.ui.notify).toHaveBeenCalledWith(
      "Session action failed: prompt unavailable",
      "warning",
    );
  });
});

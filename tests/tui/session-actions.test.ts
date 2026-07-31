import { describe, expect, it, vi } from "vitest";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { formatSessionDetails, handleSessionActions } from "../../src/tui/session-actions.ts";

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

describe("formatSessionDetails", () => {
  it("renders stable details and explicit missing-value fallbacks", () => {
    expect(
      formatSessionDetails({
        name: undefined,
        id: "session-123",
        file: undefined,
        cwd: "/work/pi-status",
        model: undefined,
      }),
    ).toBe(
      "Session details\nName: Untitled\nID: session-123\nFile: In memory\nDirectory: /work/pi-status\nModel: None",
    );
  });
});

describe("handleSessionActions", () => {
  it("trims and applies a renamed session through Pi", async () => {
    const ctx = commandContext();
    vi.mocked(ctx.ui.select).mockResolvedValue("Rename session");
    vi.mocked(ctx.ui.input).mockResolvedValue("  Release work  ");
    const pi = extensionApi();

    await handleSessionActions(pi, ctx);

    expect(pi.setSessionName).toHaveBeenCalledWith("Release work");
    expect(ctx.ui.notify).toHaveBeenCalledWith("Session renamed to Release work", "info");
  });

  it("does not rename on cancel or whitespace-only input", async () => {
    const ctx = commandContext();
    vi.mocked(ctx.ui.select).mockResolvedValue("Rename session");
    vi.mocked(ctx.ui.input).mockResolvedValue("   ");
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
});

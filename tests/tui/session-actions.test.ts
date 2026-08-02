import { describe, expect, it, vi } from "vitest";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import {
  readSessionDetails,
  renameCurrentSession,
  startSessionCompaction,
} from "../../src/tui/session-actions.ts";

const ctx = () =>
  ({
    cwd: "/work",
    model: { provider: "p", id: "m" },
    sessionManager: { getSessionId: () => "id", getSessionFile: () => "/file" },
    ui: { notify: vi.fn() },
    compact: vi.fn(),
  }) as unknown as ExtensionCommandContext;
const pi = () =>
  ({ getSessionName: vi.fn(() => "Old"), setSessionName: vi.fn() }) as unknown as ExtensionAPI;

describe("dashboard session helpers", () => {
  it("extracts session details", () =>
    expect(readSessionDetails(pi(), ctx())).toEqual({
      name: "Old",
      id: "id",
      file: "/file",
      directory: "/work",
      model: "p/m",
    }));
  it("trims rename without rereading details", () => {
    const api = pi();
    expect(renameCurrentSession(api, ctx(), " New ").name).toBe("New");
    expect(api.setSessionName).toHaveBeenCalledWith("New");
    expect(api.getSessionName).toHaveBeenCalledOnce();
  });
  it("ignores blank rename", () => {
    const api = pi();
    expect(renameCurrentSession(api, ctx(), "   ").name).toBe("Old");
    expect(api.setSessionName).not.toHaveBeenCalled();
  });
  it("starts compaction synchronously with notification callbacks", () => {
    const context = ctx();
    startSessionCompaction(context);
    const options = vi.mocked(context.compact).mock.calls[0]?.[0];
    expect(options).toBeDefined();
    options?.onComplete?.({} as never);
    expect(context.ui.notify).toHaveBeenCalledWith("Session compacted", "info");

    options?.onError?.(new Error("compact failed"));
    expect(context.ui.notify).toHaveBeenCalledWith("compact failed", "warning");
  });
  it("contains stale notification contexts", () => {
    const context = ctx();
    vi.mocked(context.ui.notify).mockImplementation(() => {
      throw new Error("stale context");
    });
    startSessionCompaction(context);
    const options = vi.mocked(context.compact).mock.calls[0]?.[0];

    expect(() => options?.onComplete?.({} as never)).not.toThrow();
    expect(() => options?.onError?.(new Error("ignored"))).not.toThrow();
  });
});

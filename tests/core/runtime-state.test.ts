import { describe, expect, it, vi } from "vitest";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { createRuntimeStateMachine } from "../../src/core/runtime-state.ts";
import { BUILTIN_SIDEBAR_PANEL_IDS, type PiStatusConfig } from "../../src/shared/types.ts";

const defaultConfig: PiStatusConfig = {
  zones: {
    topLeft: ["model-with-reasoning"],
    topRight: [],
    bottomLeft: ["current-dir"],
    bottomRight: [],
  },
  extensionSegments: { hidden: [] },
    sidebarExtensionSegments: { hidden: [] },
    extensionStatusZone: "bottomRight",
  completionNotifications: false,
  showSidebarToolNames: false,
  sidebarPanelLayout: BUILTIN_SIDEBAR_PANEL_IDS.map((id) => ({ id, visible: true })),
};

function stubCtx(cwd = "/test"): ExtensionContext {
  return { cwd } as unknown as ExtensionContext;
}

describe("RuntimeStateMachine", () => {
  it("returns initial snapshot with only durable state fields", () => {
    const sm = createRuntimeStateMachine(defaultConfig, "high");
    const s = sm.snapshot();
    expect(s.ctx).toBeUndefined();
    expect(s.config).toEqual(defaultConfig);
    expect(s.thinkingLevel).toBe("high");
    expect(Object.keys(s).sort()).toEqual(["config", "ctx", "thinkingLevel"]);
  });

  it("stores ctx on session_start", () => {
    const sm = createRuntimeStateMachine(defaultConfig, "medium");
    const ctx = stubCtx("/project");
    sm.update({ type: "session_start", ctx });
    expect(sm.snapshot().ctx).toBe(ctx);
  });

  it("stores ctx on session_tree", () => {
    const sm = createRuntimeStateMachine(defaultConfig, "medium");
    const ctx = stubCtx("/other");
    sm.update({ type: "session_tree", ctx });
    expect(sm.snapshot().ctx).toBe(ctx);
  });

  it("stores ctx on model_select", () => {
    const sm = createRuntimeStateMachine(defaultConfig, "medium");
    const ctx = stubCtx();
    sm.update({ type: "model_select", ctx });
    expect(sm.snapshot().ctx).toBe(ctx);
  });

  it("stores ctx and level on thinking_level_changed", () => {
    const sm = createRuntimeStateMachine(defaultConfig, "medium");
    const ctx = stubCtx();
    sm.update({ type: "thinking_level_changed", ctx, level: "high" });
    const s = sm.snapshot();
    expect(s.ctx).toBe(ctx);
    expect(s.thinkingLevel).toBe("high");
  });

  it("clears ctx on session_shutdown but preserves config and thinkingLevel", () => {
    const sm = createRuntimeStateMachine(defaultConfig, "medium");
    sm.update({ type: "session_start", ctx: stubCtx() });
    sm.update({ type: "thinking_level_changed", ctx: stubCtx(), level: "high" });
    sm.update({ type: "session_shutdown" });
    const s = sm.snapshot();
    expect(s.ctx).toBeUndefined();
    expect(s.config).toEqual(defaultConfig);
    expect(s.thinkingLevel).toBe("high");
  });

  it("updates config on config_reload", () => {
    const sm = createRuntimeStateMachine(defaultConfig, "medium");
    const newConfig: PiStatusConfig = {
      zones: { topLeft: ["git-branch"], topRight: [], bottomLeft: [], bottomRight: [] },
      extensionSegments: { hidden: ["x"] },
    sidebarExtensionSegments: { hidden: [] },
    extensionStatusZone: "bottomRight",
      completionNotifications: false,
      showSidebarToolNames: false,
      sidebarPanelLayout: BUILTIN_SIDEBAR_PANEL_IDS.map((id) => ({ id, visible: true })),
    };
    sm.update({ type: "config_reload", config: newConfig });
    expect(sm.snapshot().config).toEqual(newConfig);
  });

  it("fires onInvalidate on every update", () => {
    const sm = createRuntimeStateMachine(defaultConfig, "medium");
    const cb = vi.fn();
    sm.onInvalidate(cb);
    sm.update({ type: "thinking_level_changed", ctx: stubCtx(), level: "low" });
    expect(cb).toHaveBeenCalledOnce();
    sm.update({ type: "config_reload", config: defaultConfig });
    expect(cb).toHaveBeenCalledTimes(2);
  });

  it("does not fire after onInvalidate(undefined)", () => {
    const sm = createRuntimeStateMachine(defaultConfig, "medium");
    const cb = vi.fn();
    sm.onInvalidate(cb);
    sm.onInvalidate(undefined);
    sm.update({ type: "config_reload", config: defaultConfig });
    expect(cb).not.toHaveBeenCalled();
  });

  it("dispose removes listener", () => {
    const sm = createRuntimeStateMachine(defaultConfig, "medium");
    const cb = vi.fn();
    sm.onInvalidate(cb);
    sm.dispose();
    sm.update({ type: "config_reload", config: defaultConfig });
    expect(cb).not.toHaveBeenCalled();
  });
});

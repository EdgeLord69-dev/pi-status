import type { Component, OverlayHandle, TUI } from "@earendil-works/pi-tui";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BUILTIN_SIDEBAR_PANEL_IDS,
  DEFAULT_ZONES,
  type PiStatusConfig,
  type SidebarPanelId,
} from "../src/shared/types.ts";
import {
  SIDEBAR_PANEL_CHANNEL,
  SIDEBAR_PANEL_PROTOCOL_VERSION,
} from "../src/tui/sidebar-panels.ts";
import { noTheme } from "../src/tui/theme.ts";
import { buildPiWithHandlers, createContext } from "./helpers.ts";

function configWithModelIn(panelId: SidebarPanelId): PiStatusConfig {
  return {
    zones: structuredClone(DEFAULT_ZONES),
    extensionSegments: { hidden: [] },
    extensionStatusZone: "bottomRight",
    completionNotifications: false,
    sidebarPanelLayout: BUILTIN_SIDEBAR_PANEL_IDS.map((id) => ({
      id,
      visible: id === panelId,
      segments: id === panelId ? ["builtin:model"] : [],
    })),
    sidebarHiddenSegments: [],
  };
}

function sidebarHost() {
  const components: Component[] = [];
  const requestRender = vi.fn();
  const tui = {
    terminal: { columns: 120, rows: 30 },
    requestRender,
    render: vi.fn(),
  } as unknown as TUI;
  const handle = {
    hide: vi.fn(),
    setHidden: vi.fn(),
    isHidden: vi.fn(() => false),
    focus: vi.fn(),
    unfocus: vi.fn(),
    isFocused: vi.fn(() => false),
  } as unknown as OverlayHandle;
  const custom = vi.fn(async (factory, options) => {
    components.push(factory(tui, noTheme));
    options?.onHandle?.(handle);
    return undefined;
  });
  return { components, custom, requestRender };
}

afterEach(() => {
  vi.doUnmock("../src/core/config.ts");
  vi.resetModules();
});

describe("sidebar layout lifecycle", () => {
  it("renders a persisted built-in assignment from its destination panel", async () => {
    const current = configWithModelIn("usage");
    vi.doMock("../src/core/config.ts", () => ({
      loadConfig: vi.fn(() => structuredClone(current)),
      normalizeSidebarPanelLayout: vi.fn((value) => value),
      saveConfig: vi.fn(),
    }));
    const { default: createExtension } = await import("../src/index.ts");
    const { pi, handlers } = buildPiWithHandlers();
    const host = sidebarHost();
    const ctx = createContext({
      ui: { ...createContext().ui, custom: host.custom as never },
    });

    createExtension(pi);
    for (const handler of handlers.get("session_start") ?? []) handler({}, ctx);
    const text = host.components.at(-1)?.render(44).join("\n") ?? "";

    expect(text).toContain("USAGE");
    expect(text).toContain("GPT-5");
    expect(text).not.toContain("AGENT");
  });

  it("reconciles explicit contributed rows across registry churn", async () => {
    const current = configWithModelIn("agent");
    current.sidebarPanelLayout.push({
      id: "vendor:queue",
      visible: true,
      segments: ["contribution:vendor%3Aqueue:ready"],
    });
    vi.doMock("../src/core/config.ts", () => ({
      loadConfig: vi.fn(() => structuredClone(current)),
      normalizeSidebarPanelLayout: vi.fn((value) => value),
      saveConfig: vi.fn(),
    }));
    const { default: createExtension } = await import("../src/index.ts");
    const { pi, handlers, events } = buildPiWithHandlers();
    const host = sidebarHost();
    const ctx = createContext({
      ui: { ...createContext().ui, custom: host.custom as never },
    });

    createExtension(pi);
    for (const handler of handlers.get("session_start") ?? []) handler({}, ctx);
    const component = host.components.at(-1);
    expect(component?.render(44).join("\n")).not.toContain("queued");
    const rendersBeforeRegister = host.requestRender.mock.calls.length;

    events.emit(SIDEBAR_PANEL_CHANNEL, {
      version: SIDEBAR_PANEL_PROTOCOL_VERSION,
      type: "register",
      source: "vendor",
      revision: 1,
      panel: {
        id: "vendor:queue",
        title: "Queue",
        rows: [{ id: "ready", text: "queued" }],
      },
    });
    expect(host.requestRender.mock.calls.length).toBeGreaterThan(rendersBeforeRegister);
    expect(component?.render(44).join("\n")).toContain("queued");

    events.emit(SIDEBAR_PANEL_CHANNEL, {
      version: SIDEBAR_PANEL_PROTOCOL_VERSION,
      type: "unregister",
      source: "vendor",
      revision: 2,
      id: "vendor:queue",
    });
    expect(component?.render(44).join("\n")).not.toContain("queued");
  });

  it("preserves layout on session_tree and reloads it on session_start", async () => {
    let current = configWithModelIn("usage");
    const loadConfig = vi.fn(() => structuredClone(current));
    vi.doMock("../src/core/config.ts", () => ({
      loadConfig,
      normalizeSidebarPanelLayout: vi.fn((value) => value),
      saveConfig: vi.fn(),
    }));
    const { default: createExtension } = await import("../src/index.ts");
    const { pi, handlers } = buildPiWithHandlers();
    const host = sidebarHost();
    const first = createContext({
      ui: { ...createContext().ui, custom: host.custom as never },
    });

    createExtension(pi);
    for (const handler of handlers.get("session_start") ?? []) handler({}, first);
    current = configWithModelIn("agent");
    for (const handler of handlers.get("session_tree") ?? []) handler({}, first);
    expect(host.components.at(-1)?.render(44).join("\n")).toContain("USAGE");

    const second = createContext({
      ui: { ...createContext().ui, custom: host.custom as never },
    });
    for (const handler of handlers.get("session_start") ?? []) handler({}, second);
    const resetText = host.components.at(-1)?.render(44).join("\n") ?? "";
    expect(resetText).toContain("AGENT");
    expect(resetText).not.toContain("USAGE");
  });
});

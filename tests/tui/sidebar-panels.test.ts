import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createSidebarPanelRegistry,
  SIDEBAR_PANEL_CHANNEL,
  SIDEBAR_PANEL_MAX_ID_CHARS,
  SIDEBAR_PANEL_MAX_PANELS,
  SIDEBAR_PANEL_MAX_RAW_ROW_CODE_UNITS,
  SIDEBAR_PANEL_MAX_RAW_TITLE_CODE_UNITS,
  SIDEBAR_PANEL_MAX_ROW_CHARS,
  SIDEBAR_PANEL_MAX_ROWS,
  SIDEBAR_PANEL_MAX_SOURCE_CHARS,
  SIDEBAR_PANEL_MAX_TITLE_CHARS,
  SIDEBAR_PANEL_MAX_TRACKED_SOURCES,
  SIDEBAR_PANEL_PROTOCOL_VERSION,
  type SidebarPanelContribution,
  type SidebarPanelContribution as SidebarPanelContributionType,
  type SidebarPanelData,
  type SidebarPanelDiscoveryEvent,
  type SidebarPanelEventTransport,
  type SidebarPanelRegisterEvent,
  type SidebarPanelRegistry,
  type SidebarPanelRole,
  type SidebarPanelUnregisterEvent,
} from "../../src/tui/sidebar-panels.js";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("sidebar panel protocol constants", () => {
  it("exposes the exact channel and protocol version for the public seam", () => {
    expect(SIDEBAR_PANEL_CHANNEL).toBe("pi-status:sidebar-panels");
    expect(SIDEBAR_PANEL_PROTOCOL_VERSION).toBe(1);
  });

  it("publishes the documented bounds for Task 2", () => {
    expect(SIDEBAR_PANEL_MAX_TITLE_CHARS).toBe(48);
    expect(SIDEBAR_PANEL_MAX_ROWS).toBe(24);
    expect(SIDEBAR_PANEL_MAX_ROW_CHARS).toBe(160);
    expect(SIDEBAR_PANEL_MAX_ID_CHARS).toBe(128);
    expect(SIDEBAR_PANEL_MAX_SOURCE_CHARS).toBe(128);
    expect(SIDEBAR_PANEL_MAX_PANELS).toBe(64);
    expect(SIDEBAR_PANEL_MAX_TRACKED_SOURCES).toBe(64);
  });

  it("checks raw UTF-16 limits before sanitization for both title and row strings", () => {
    expect(SIDEBAR_PANEL_MAX_RAW_TITLE_CODE_UNITS).toBe(SIDEBAR_PANEL_MAX_TITLE_CHARS * 8);
    expect(SIDEBAR_PANEL_MAX_RAW_ROW_CODE_UNITS).toBe(SIDEBAR_PANEL_MAX_ROW_CHARS * 8);
  });
});

describe("sidebar panel contribution data shape", () => {
  const ROLES: SidebarPanelRole[] = [
    "primary",
    "accent",
    "muted",
    "dim",
    "ready",
    "working",
    "warning",
    "error",
    "input",
    "output",
    "cache",
    "context",
  ];

  it("accepts the documented contribution shape with optional role", () => {
    const contribution: SidebarPanelContribution = {
      id: "vendor:queue",
      title: "Queue",
      rows: ["queued 2", { text: "running", role: "working" }],
      role: "primary",
    };
    const registry = createSidebarPanelRegistry();
    expect(registry.register(contribution)).toBe(true);
    registry.dispose();
  });

  it("accepts all twelve documented roles on rows and on the panel", () => {
    const registry = createSidebarPanelRegistry();
    for (const role of ROLES) {
      expect(
        registry.register({
          id: `vendor:role-${role}`,
          title: `Role ${role}`,
          rows: [{ text: "row", role }],
          role,
        }),
      ).toBe(true);
    }
    const stored = registry.getAvailable();
    expect(stored).toHaveLength(ROLES.length);
    for (const panel of stored) {
      expect(ROLES).toContain(panel.role);
    }
    registry.dispose();
  });
});

describe("sidebar panel registry direct operations", () => {
  it("registers, updates, and unregisters contributed panels through the direct seam", () => {
    const changed = vi.fn();
    const registry = createSidebarPanelRegistry({ onChange: changed });
    expect(registry.register({ id: "vendor:queue", title: "Queue", rows: ["one"] }, "vendor")).toBe(
      true,
    );
    expect(changed).toHaveBeenCalledTimes(1);
    expect(registry.get("vendor:queue")).toMatchObject({
      id: "vendor:queue",
      title: "Queue",
      rows: [{ text: "one" }],
      source: "vendor",
      available: true,
    });

    // Equal re-registration is a no-op for onChange; material changes fire it.
    changed.mockClear();
    expect(registry.register({ id: "vendor:queue", title: "Queue", rows: ["one"] }, "vendor")).toBe(
      false,
    );
    expect(changed).not.toHaveBeenCalled();
    expect(
      registry.register(
        { id: "vendor:queue", title: "Queue", rows: ["two"], role: "working" },
        "vendor",
      ),
    ).toBe(true);
    expect(changed).toHaveBeenCalledTimes(1);
    expect(registry.get("vendor:queue")?.rows[0]?.text).toBe("two");
    expect(registry.get("vendor:queue")?.role).toBe("working");

    expect(registry.unregister("vendor:queue", "vendor")).toBe(true);
    expect(changed).toHaveBeenCalledTimes(2);
    expect(registry.get("vendor:queue")).toBeUndefined();
    expect(registry.unregister("vendor:queue", "vendor")).toBe(false);
    registry.dispose();
  });

  it("derives the source from the namespace when one is not provided", () => {
    const registry = createSidebarPanelRegistry();
    expect(registry.register({ id: "vendor:queue", title: "Queue", rows: [] })).toBe(true);
    expect(registry.get("vendor:queue")?.source).toBe("vendor");
    registry.dispose();
  });

  it("preserves first-source ownership against later writers", () => {
    const registry = createSidebarPanelRegistry();
    expect(
      registry.register({ id: "vendor:queue", title: "Queue", rows: ["one"] }, "owner-a"),
    ).toBe(true);
    expect(
      registry.register({ id: "vendor:queue", title: "Hijack", rows: ["bad"] }, "owner-b"),
    ).toBe(false);
    expect(registry.get("vendor:queue")?.source).toBe("owner-a");
    expect(registry.unregister("vendor:queue", "owner-b")).toBe(false);
    expect(registry.unregister("vendor:queue", "owner-a")).toBe(true);
    expect(registry.get("vendor:queue")).toBeUndefined();
    registry.dispose();
  });

  it("rejects built-in IDs through the direct contribution API", () => {
    const registry = createSidebarPanelRegistry();
    // @ts-expect-error Built-in IDs are intentionally rejected by the contributed-panel API.
    expect(registry.register({ id: "agent", title: "Spoofed", rows: [] })).toBe(false);
    // @ts-expect-error Built-in IDs are intentionally rejected by the contributed-panel API.
    expect(registry.register({ id: "tools", title: "Spoofed", rows: [] })).toBe(false);
    expect(registry.getAvailable()).toEqual([]);
    registry.dispose();
  });

  it("rejects malformed and oversized direct contributions without throwing", () => {
    const registry = createSidebarPanelRegistry();
    const panel = (id: string) => ({
      id: id as `${string}:${string}`,
      title: "Panel",
      rows: [],
    });
    expect(
      registry.register({
        id: "Vendor:queue",
        title: "Panel",
        rows: [],
      } as unknown as SidebarPanelContribution),
    ).toBe(false);
    expect(registry.register(panel("vendor:"))).toBe(false);
    expect(registry.register(panel(`vendor:${"x".repeat(SIDEBAR_PANEL_MAX_ID_CHARS)}`))).toBe(
      false,
    );
    expect(
      registry.register({
        id: "vendor:queue",
        title: "t".repeat(SIDEBAR_PANEL_MAX_TITLE_CHARS + 1),
        rows: [],
      } as unknown as SidebarPanelContribution),
    ).toBe(false);
    expect(
      registry.register({
        id: "vendor:queue",
        title: "Title",
        rows: Array.from({ length: SIDEBAR_PANEL_MAX_ROWS + 1 }, () => "row"),
      } as unknown as SidebarPanelContribution),
    ).toBe(false);
    expect(
      registry.register({
        id: "vendor:queue",
        title: "Title",
        rows: ["r".repeat(SIDEBAR_PANEL_MAX_ROW_CHARS + 1)],
      } as unknown as SidebarPanelContribution),
    ).toBe(false);
    expect(registry.register(panel("vendor:queue"), "")).toBe(false);
    expect(registry.register(panel("vendor:queue"), " ".repeat(8))).toBe(false);
    expect(
      registry.register(panel("vendor:queue"), "s".repeat(SIDEBAR_PANEL_MAX_SOURCE_CHARS + 1)),
    ).toBe(false);
    expect(registry.getAvailable()).toEqual([]);
    registry.dispose();
  });

  it("sanitizes titles and rows for ANSI OSC, CSI, C1 controls, and Unicode counts", () => {
    const registry = createSidebarPanelRegistry();
    expect(
      registry.register({
        id: "vendor:safe",
        title: "\u001b[31mQueue\nready\u001b]0;title\u0007\u009b2J",
        rows: ["one\n two", { text: "\u001b[33mtwo\u001b[0m", role: "warning" }],
      }),
    ).toBe(true);
    expect(registry.get("vendor:safe")).toMatchObject({
      title: "Queue ready",
      rows: [{ text: "one two" }, { text: "two", role: "warning" }],
    });
    expect(
      registry.register({
        id: "vendor:unicode",
        title: "é界🙂".repeat(12),
        rows: [{ text: "é界🙂".repeat(40), role: "ready" }],
      }),
    ).toBe(true);
    expect(registry.get("vendor:unicode")).toMatchObject({
      title: "é界🙂".repeat(12),
      rows: [{ text: "é界🙂".repeat(40), role: "ready" }],
    });
    registry.dispose();
  });

  it("bounds raw UTF-16 code units before sanitization and rejects oversized inputs", () => {
    const registry = createSidebarPanelRegistry();
    expect(
      registry.register({
        id: "vendor:huge-title",
        title: "x".repeat(1_000_000),
        rows: [],
      } as unknown as SidebarPanelContribution),
    ).toBe(false);
    expect(
      registry.register({
        id: "vendor:huge-row-string",
        title: "Valid",
        rows: ["x".repeat(1_000_000)],
      } as unknown as SidebarPanelContribution),
    ).toBe(false);
    expect(
      registry.register({
        id: "vendor:huge-row-object",
        title: "Valid",
        rows: [{ text: "x".repeat(1_000_000) }],
      } as unknown as SidebarPanelContribution),
    ).toBe(false);
    expect(registry.getAvailable()).toEqual([]);
    registry.dispose();
  });

  it("returns defensive copies so callers cannot mutate stored panels", () => {
    const registry = createSidebarPanelRegistry();
    registry.register({ id: "vendor:queue", title: "Queue", rows: ["one"] });
    const first = registry.get("vendor:queue") as SidebarPanelData;
    const listFirst = registry.getAvailable()[0] as SidebarPanelData;
    expect(first).not.toBe(listFirst);
    expect(first.rows).not.toBe(listFirst.rows);
    (first.rows[0] as { text: string }).text = "mutated";
    const refetched = registry.get("vendor:queue") as SidebarPanelData;
    expect(refetched.rows[0]?.text).toBe("one");
    registry.dispose();
  });

  it("enforces capacity while allowing updates to refresh existing IDs at the cap", () => {
    const registry = createSidebarPanelRegistry();
    const panel = (id: string, title = id) => ({
      id: id as `${string}:${string}`,
      title,
      rows: [],
    });
    for (let index = 0; index < SIDEBAR_PANEL_MAX_PANELS; index += 1) {
      expect(registry.register(panel(`vendor:panel-${index}`))).toBe(true);
    }
    expect(registry.getAvailable()).toHaveLength(SIDEBAR_PANEL_MAX_PANELS);
    expect(registry.register(panel("vendor:overflow"))).toBe(false);
    expect(
      registry.register({
        id: "vendor:panel-0",
        title: "Updated",
        rows: [],
      } as SidebarPanelContribution),
    ).toBe(true);
    expect(registry.get("vendor:panel-0")?.title).toBe("Updated");
    registry.dispose();
  });

  it("isolates onChange callback failures from registry state", () => {
    const registry = createSidebarPanelRegistry({
      onChange: () => {
        throw new Error("callback failed");
      },
    });
    expect(registry.register({ id: "vendor:queue", title: "Queue", rows: [] })).toBe(true);
    expect(registry.get("vendor:queue")?.title).toBe("Queue");
    registry.dispose();
  });

  it("makes disposal idempotent and clears panels while leaving no active subscription", () => {
    const listeners = new Set<(data: unknown) => void>();
    const events: SidebarPanelEventTransport = {
      on: (_channel: string, handler: (data: unknown) => void) => {
        listeners.add(handler);
        return () => listeners.delete(handler);
      },
      emit: (_channel: string, _data: unknown) => undefined,
    };
    const registry = createSidebarPanelRegistry({ events });
    registry.register({ id: "vendor:queue", title: "Queue", rows: [] });
    registry.dispose();
    expect(registry.get("vendor:queue")).toBeUndefined();
    expect(listeners.size).toBe(0);
    registry.dispose();
    // Operations after disposal are no-ops; they never throw.
    expect(registry.register({ id: "vendor:queue", title: "Queue", rows: [] })).toBe(false);
    expect(registry.unregister("vendor:queue", "vendor")).toBe(false);
  });
});

describe("sidebar panel public protocol types", () => {
  it("defines the protocol event shapes for Task 3 to fill", () => {
    const register: SidebarPanelRegisterEvent = {
      version: SIDEBAR_PANEL_PROTOCOL_VERSION,
      type: "register",
      source: "vendor",
      revision: 1,
      panel: {
        id: "vendor:queue",
        title: "Queue",
        rows: ["ready"],
      },
    };
    const unregister: SidebarPanelUnregisterEvent = {
      version: SIDEBAR_PANEL_PROTOCOL_VERSION,
      type: "unregister",
      source: "vendor",
      revision: 2,
      id: "vendor:queue",
    };
    const discovery: SidebarPanelDiscoveryEvent = {
      version: SIDEBAR_PANEL_PROTOCOL_VERSION,
      type: "discover",
      requestId: "pi-status-1",
    };
    expect(register.type).toBe("register");
    expect(unregister.type).toBe("unregister");
    expect(discovery.type).toBe("discover");
  });

  it("exposes the registry seam methods required by the protocol", () => {
    const registry: SidebarPanelRegistry = createSidebarPanelRegistry();
    expect(typeof registry.register).toBe("function");
    expect(typeof registry.unregister).toBe("function");
    expect(typeof registry.getAvailable).toBe("function");
    expect(typeof registry.get).toBe("function");
    expect(typeof registry.handleEvent).toBe("function");
    expect(typeof registry.requestDiscovery).toBe("function");
    expect(typeof registry.dispose).toBe("function");
    registry.dispose();
  });
});

describe("sidebar panel protocol seam calls", () => {
  it("ignores malformed events before consuming revisions", () => {
    const registry = createSidebarPanelRegistry();
    // Direct registry operations should not throw on any unknown payload
    // at the seam; Task 3 will add revision-aware event validation.
    expect(() => registry.handleEvent(undefined)).not.toThrow();
    expect(() => registry.handleEvent(null)).not.toThrow();
    expect(() => registry.handleEvent({})).not.toThrow();
    expect(() => registry.handleEvent({ version: 999 })).not.toThrow();
    expect(registry.getAvailable()).toEqual([]);
    registry.dispose();
  });

  it("keeps requestDiscovery a safe no-op when no transport is configured", () => {
    const registry = createSidebarPanelRegistry();
    expect(() => registry.requestDiscovery()).not.toThrow();
    registry.dispose();
  });

  it("isolates the registry when multiple direct registries are created", () => {
    const first = createSidebarPanelRegistry();
    const second = createSidebarPanelRegistry();
    first.register({ id: "vendor:queue", title: "Queue", rows: [] });
    expect(first.get("vendor:queue")).toBeDefined();
    expect(second.get("vendor:queue")).toBeUndefined();
    first.dispose();
    second.dispose();
  });

  it("validates the contribution ID type at the type seam without runtime widening", () => {
    // Compile-time assertion: SidebarPanelContribution requires a namespaced ID.
    // The runtime seam rejects anything else via strict validation.
    const valid: SidebarPanelContributionType = {
      id: "vendor:queue",
      title: "Queue",
      rows: [],
    };
    const registry = createSidebarPanelRegistry();
    expect(registry.register(valid)).toBe(true);
    registry.dispose();
  });
});

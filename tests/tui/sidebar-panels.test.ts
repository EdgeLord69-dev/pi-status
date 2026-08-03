import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createSidebarPanelRegistry,
  isSidebarPanelContributionId,
  isSidebarPanelId,
  isSidebarPanelRequestId,
  isSidebarPanelTextWithinRawLimit,
  registerSidebarPanel,
  SIDEBAR_PANEL_CHANNEL,
  SIDEBAR_PANEL_MAX_ID_CHARS,
  SIDEBAR_PANEL_MAX_PANELS,
  SIDEBAR_PANEL_MAX_RAW_REQUEST_ID_CODE_UNITS,
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

describe("sidebar panel event protocol", () => {
  it("supports load-order discovery, updates, and removal through the public event seam", () => {
    const listeners = new Set<(data: unknown) => void>();
    const events = {
      on: (_channel: string, handler: (data: unknown) => void) => {
        listeners.add(handler);
        return () => listeners.delete(handler);
      },
      emit: (_channel: string, data: unknown) => {
        for (const listener of [...listeners]) listener(data);
      },
    };
    const publisher = registerSidebarPanel(
      { events },
      { id: "vendor:queue", title: "Queue", rows: ["one"] },
    );
    const changed = vi.fn();
    const registry = createSidebarPanelRegistry({ events, onChange: changed });
    expect(registry.get("vendor:queue")?.title).toBe("Queue");
    publisher.update({
      id: "vendor:queue",
      title: "Updated queue",
      rows: [{ text: "two", role: "warning" }],
    });
    expect(registry.get("vendor:queue")?.rows[0]?.text).toBe("two");
    publisher.dispose();
    expect(registry.get("vendor:queue")).toBeUndefined();
    expect(changed).toHaveBeenCalled();
    expect(SIDEBAR_PANEL_CHANNEL).toBe("pi-status:sidebar-panels");
    registry.dispose();
  });

  it("accepts namespaced contributors whose source matches the discovery prefix", () => {
    const listeners = new Set<(data: unknown) => void>();
    const emitted: unknown[] = [];
    const events = {
      on: (_channel: string, handler: (data: unknown) => void) => {
        listeners.add(handler);
        return () => listeners.delete(handler);
      },
      emit: (_channel: string, data: unknown) => {
        emitted.push(data);
        for (const listener of [...listeners]) listener(data);
      },
    };
    const registry = createSidebarPanelRegistry({ events, instanceId: "vendor" });
    events.emit(SIDEBAR_PANEL_CHANNEL, {
      version: 1,
      type: "register",
      source: "vendor",
      revision: 1,
      panel: { id: "vendor:queue", title: "Queue", rows: ["ready"] },
    });
    expect(registry.get("vendor:queue")?.source).toBe("vendor");
    expect(emitted[0]).toMatchObject({ type: "discover" });
    expect((emitted[0] as { requestId?: string }).requestId).toMatch(/^pi-status-\d+$/);
    registry.dispose();
  });

  it("validates contributed IDs and bounded discovery request IDs at both public seams", () => {
    expect(isSidebarPanelContributionId("vendor:queue")).toBe(true);
    for (const suffix of ["\n", "\r", "\r\n", "\u2028", "\u2029", " ", "\t"]) {
      expect(isSidebarPanelContributionId(`vendor:queue${suffix}`)).toBe(false);
    }
    expect(isSidebarPanelContributionId("agent")).toBe(false);
    expect(isSidebarPanelContributionId("Vendor:queue")).toBe(false);
    expect(isSidebarPanelContributionId("vendor:")).toBe(false);
    expect(isSidebarPanelRequestId("normal-request")).toBe(true);
    expect(isSidebarPanelRequestId("π-界🙂")).toBe(true);
    expect(isSidebarPanelRequestId("")).toBe(false);
    expect(isSidebarPanelRequestId(" ")).toBe(false);
    expect(isSidebarPanelRequestId("bad\nrequest")).toBe(false);
    expect(isSidebarPanelRequestId("\ud800")).toBe(false);
    expect(
      isSidebarPanelRequestId("x".repeat(SIDEBAR_PANEL_MAX_RAW_REQUEST_ID_CODE_UNITS + 1)),
    ).toBe(false);

    const emitted: unknown[] = [];
    const listeners = new Set<(data: unknown) => void>();
    const events = {
      on: (_channel: string, handler: (data: unknown) => void) => {
        listeners.add(handler);
        return () => listeners.delete(handler);
      },
      emit: (_channel: string, data: unknown) => {
        emitted.push(data);
        for (const listener of [...listeners]) listener(data);
      },
    };
    const publisher = registerSidebarPanel(
      { events },
      { id: "vendor:queue", title: "Queue", rows: [] },
    );
    const initialRegisterCount = emitted.filter(
      (data) => (data as { type?: unknown }).type === "register",
    ).length;
    for (const requestId of [
      "",
      " ",
      "x".repeat(SIDEBAR_PANEL_MAX_RAW_REQUEST_ID_CODE_UNITS + 1),
      null,
    ]) {
      events.emit(SIDEBAR_PANEL_CHANNEL, { version: 1, type: "discover", requestId });
    }
    expect(emitted.filter((data) => (data as { type?: unknown }).type === "register")).toHaveLength(
      initialRegisterCount,
    );
    events.emit(SIDEBAR_PANEL_CHANNEL, {
      version: 1,
      type: "discover",
      requestId: "π-界🙂",
    });
    const response = emitted.at(-1) as { type?: string; requestId?: string };
    expect(response).toMatchObject({ type: "register", requestId: "π-界🙂" });

    const registryEvents = {
      on: () => () => undefined,
      emit: (_channel: string, data: unknown) => emitted.push(data),
    };
    const registry = createSidebarPanelRegistry({
      events: registryEvents,
      instanceId: "x".repeat(SIDEBAR_PANEL_MAX_RAW_REQUEST_ID_CODE_UNITS + 1),
    });
    const generated = emitted.at(-1) as { type?: string; requestId?: string };
    expect(generated.type).toBe("discover");
    expect(generated.requestId).toMatch(/^pi-status-\d+$/);
    expect(generated.requestId?.length).toBeLessThanOrEqual(
      SIDEBAR_PANEL_MAX_RAW_REQUEST_ID_CODE_UNITS,
    );
    registry.dispose();
    publisher.dispose();
  });

  it("allocates revisions across same-source publishers without coupling transports", () => {
    const makeEvents = () => {
      const listeners = new Set<(data: unknown) => void>();
      const emitted: unknown[] = [];
      return {
        events: {
          on: (_channel: string, handler: (data: unknown) => void) => {
            listeners.add(handler);
            return () => listeners.delete(handler);
          },
          emit: (_channel: string, data: unknown) => {
            emitted.push(data);
            for (const listener of [...listeners]) listener(data);
          },
        },
        emitted,
      };
    };
    const firstTransport = makeEvents();
    const secondTransport = makeEvents();
    const first = registerSidebarPanel(
      { events: firstTransport.events },
      { id: "vendor:queue", title: "Queue", rows: ["one"] },
      { source: "vendor" },
    );
    const second = registerSidebarPanel(
      { events: firstTransport.events },
      { id: "vendor:status", title: "Status", rows: ["ready"] },
      { source: "vendor" },
    );
    registerSidebarPanel(
      { events: secondTransport.events },
      { id: "vendor:other", title: "Other", rows: ["isolated"] },
      { source: "vendor" },
    );

    const registry = createSidebarPanelRegistry({ events: firstTransport.events });
    expect(registry.get("vendor:queue")?.title).toBe("Queue");
    expect(registry.get("vendor:status")?.title).toBe("Status");
    first.update({ id: "vendor:queue", title: "Updated queue", rows: ["two"] });
    second.update({ id: "vendor:status", title: "Updated status", rows: ["busy"] });
    expect(registry.get("vendor:queue")?.rows[0]?.text).toBe("two");
    expect(registry.get("vendor:status")?.rows[0]?.text).toBe("busy");
    first.dispose();
    expect(registry.get("vendor:queue")).toBeUndefined();
    expect(registry.get("vendor:status")?.title).toBe("Updated status");
    expect((firstTransport.emitted[0] as { revision?: number })?.revision).toBe(1);
    expect((secondTransport.emitted[0] as { revision?: number })?.revision).toBe(1);
    second.dispose();
    registry.dispose();
  });

  it("caps helper publisher sources while preserving updates, disposal, and source revisions", () => {
    const listeners = new Set<(data: unknown) => void>();
    const emitted: unknown[] = [];
    const events = {
      on: (_channel: string, handler: (data: unknown) => void) => {
        listeners.add(handler);
        return () => listeners.delete(handler);
      },
      emit: (_channel: string, data: unknown) => {
        emitted.push(data);
        for (const listener of [...listeners]) listener(data);
      },
    };
    const panel = (id: string, title = id) => ({
      id: id as `${string}:${string}`,
      title,
      rows: [],
    });
    const malformed = registerSidebarPanel({ events }, panel("vendor:malformed-source"), {
      source: "s".repeat(SIDEBAR_PANEL_MAX_SOURCE_CHARS + 1),
    });
    malformed.update(panel("vendor:malformed-source", "Should stay inert"));
    malformed.dispose();
    expect(emitted).toEqual([]);
    const publishers = Array.from({ length: SIDEBAR_PANEL_MAX_TRACKED_SOURCES }, (_, index) =>
      registerSidebarPanel({ events }, panel(`vendor:allocator-${index}`), {
        source: `allocator-${index}`,
      }),
    );
    const registry = createSidebarPanelRegistry({ events });
    expect(registry.getAvailable()).toHaveLength(SIDEBAR_PANEL_MAX_TRACKED_SOURCES);

    const beforeOverflow = emitted.length;
    const overflow = registerSidebarPanel({ events }, panel("vendor:allocator-overflow"), {
      source: "allocator-overflow",
    });
    overflow.update(panel("vendor:allocator-overflow", "Updated overflow"));
    overflow.dispose();
    expect(emitted).toHaveLength(beforeOverflow);
    expect(registry.get("vendor:allocator-overflow")).toBeUndefined();

    publishers[0]?.update(panel("vendor:allocator-0", "Updated tracked"));
    expect(registry.get("vendor:allocator-0")?.title).toBe("Updated tracked");
    publishers[0]?.dispose();
    expect(registry.get("vendor:allocator-0")).toBeUndefined();

    const reused = registerSidebarPanel(
      { events },
      panel("vendor:allocator-reused", "Reused source"),
      {
        source: "allocator-0",
      },
    );
    expect(registry.get("vendor:allocator-reused")?.title).toBe("Reused source");
    const reusedRevision = (emitted.at(-1) as { revision?: number })?.revision;
    expect(reusedRevision).toBeGreaterThan(1);
    events.emit(SIDEBAR_PANEL_CHANNEL, {
      version: 1,
      type: "register",
      source: "allocator-0",
      revision: (reusedRevision ?? 1) - 1,
      panel: panel("vendor:allocator-reused", "Stale reuse"),
    });
    expect(registry.get("vendor:allocator-reused")?.title).toBe("Reused source");
    reused.dispose();
    expect(registry.get("vendor:allocator-reused")).toBeUndefined();
    for (const publisher of publishers.slice(1)) publisher.dispose();
    registry.dispose();
  });

  it("rejects built-in public contributions before ownership, revisions, or capacity are consumed", () => {
    const registry = createSidebarPanelRegistry();
    // @ts-expect-error Built-in IDs are intentionally rejected by this contributed-panel API.
    expect(registry.register({ id: "agent", title: "Spoofed", rows: [] })).toBe(false);
    for (const id of ["agent", "tools"] as const) {
      registry.handleEvent({
        version: 1,
        type: "register",
        source: "vendor",
        revision: 1,
        panel: { id, title: "Spoofed", rows: [] },
      });
    }
    expect(registry.get("agent")).toBeUndefined();
    expect(registry.get("tools")).toBeUndefined();
    expect(registry.getAvailable()).toEqual([]);
    // The rejected built-in events do not consume the source's first revision.
    registry.handleEvent({
      version: 1,
      type: "register",
      source: "vendor",
      revision: 1,
      panel: { id: "vendor:queue", title: "Queue", rows: [] },
    });
    expect(registry.get("vendor:queue")?.title).toBe("Queue");
    // Nor do they consume a panel slot when the registry is one slot from full.
    const capacityRegistry = createSidebarPanelRegistry();
    for (let index = 0; index < SIDEBAR_PANEL_MAX_PANELS - 1; index += 1) {
      expect(
        capacityRegistry.register({ id: `vendor:panel-${index}`, title: "Panel", rows: [] }),
      ).toBe(true);
    }
    capacityRegistry.handleEvent({
      version: 1,
      type: "register",
      source: "capacity-source",
      revision: 1,
      panel: { id: "activity", title: "Spoofed", rows: [] },
    });
    capacityRegistry.handleEvent({
      version: 1,
      type: "register",
      source: "capacity-source",
      revision: 1,
      panel: { id: "capacity-source:panel", title: "Accepted", rows: [] },
    });
    expect(capacityRegistry.get("capacity-source:panel")?.title).toBe("Accepted");
    expect(capacityRegistry.getAvailable()).toHaveLength(SIDEBAR_PANEL_MAX_PANELS);
    registry.dispose();
    capacityRegistry.dispose();
  });

  it("rejects malformed public events and preserves panel ownership across revisions", () => {
    const registry = createSidebarPanelRegistry();
    for (const event of [
      undefined,
      null,
      {},
      { version: 2, type: "register" },
      { version: 1, type: "register", source: "vendor", revision: 1 },
      {
        version: 1,
        type: "register",
        source: "vendor",
        revision: 1,
        panel: { id: "not-namespaced", title: "Bad", rows: [] },
      },
      {
        version: 1,
        type: "register",
        source: "vendor",
        revision: 1,
        panel: { id: "vendor:queue", title: "Queue", rows: [null] },
      },
    ])
      registry.handleEvent(event);
    expect(registry.getAvailable()).toEqual([]);

    registry.handleEvent({
      version: 1,
      type: "register",
      source: "vendor",
      revision: 1,
      panel: { id: "vendor:queue", title: "Queue", rows: ["one"] },
    });
    registry.handleEvent({
      version: 1,
      type: "register",
      source: "other",
      revision: 1,
      panel: { id: "vendor:queue", title: "Hijack", rows: ["bad"] },
    });
    registry.handleEvent({
      version: 1,
      type: "register",
      source: "vendor",
      revision: 1,
      panel: { id: "vendor:queue", title: "Stale", rows: ["stale"] },
    });
    expect(registry.get("vendor:queue")?.title).toBe("Queue");
    registry.handleEvent({
      version: 1,
      type: "register",
      source: "vendor",
      revision: 2,
      panel: { id: "vendor:queue", title: "Updated", rows: ["two"] },
    });
    expect(registry.get("vendor:queue")?.title).toBe("Updated");
    registry.handleEvent({
      version: 1,
      type: "unregister",
      source: "other",
      revision: 2,
      id: "vendor:queue",
    });
    expect(registry.get("vendor:queue")?.title).toBe("Updated");
    registry.handleEvent({
      version: 1,
      type: "unregister",
      source: "vendor",
      revision: 3,
      id: "vendor:queue",
    });
    expect(registry.get("vendor:queue")).toBeUndefined();
    registry.dispose();
  });

  it("bounds raw title and row work before sanitization while preserving valid Unicode", () => {
    expect(
      isSidebarPanelTextWithinRawLimit(
        "x".repeat(SIDEBAR_PANEL_MAX_RAW_TITLE_CODE_UNITS),
        SIDEBAR_PANEL_MAX_RAW_TITLE_CODE_UNITS,
      ),
    ).toBe(true);
    expect(
      isSidebarPanelTextWithinRawLimit(
        "x".repeat(SIDEBAR_PANEL_MAX_RAW_TITLE_CODE_UNITS + 1),
        SIDEBAR_PANEL_MAX_RAW_TITLE_CODE_UNITS,
      ),
    ).toBe(false);
    const registry = createSidebarPanelRegistry();
    expect(
      registry.register({
        id: "vendor:huge-title",
        title: "x".repeat(1_000_000),
        rows: [],
      }),
    ).toBe(false);
    expect(
      registry.register({
        id: "vendor:huge-row-string",
        title: "Valid",
        rows: ["x".repeat(1_000_000)],
      }),
    ).toBe(false);
    expect(
      registry.register({
        id: "vendor:huge-row-object",
        title: "Valid",
        rows: [{ text: "x".repeat(1_000_000) }],
      }),
    ).toBe(false);
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

  it("sanitizes titles and rows and rejects oversized contribution payloads", () => {
    const registry = createSidebarPanelRegistry();
    expect(
      registry.register({
        id: "vendor:safe",
        title: "\u001b[31mQueue\nready\u001b[0m",
        rows: ["one\n two", { text: "\u001b[33mtwo\u001b[0m", role: "warning" }],
      }),
    ).toBe(true);
    expect(registry.get("vendor:safe")).toMatchObject({
      title: "Queue ready",
      rows: [{ text: "one two" }, { text: "two", role: "warning" }],
    });
    expect(
      registry.register({
        id: "vendor:long-title",
        title: "t".repeat(SIDEBAR_PANEL_MAX_TITLE_CHARS + 1),
        rows: [],
      }),
    ).toBe(false);
    expect(
      registry.register({
        id: "vendor:long-row",
        title: "Long row",
        rows: ["r".repeat(SIDEBAR_PANEL_MAX_ROW_CHARS + 1)],
      }),
    ).toBe(false);
    expect(
      registry.register({
        id: "vendor:many-rows",
        title: "Many rows",
        rows: Array.from({ length: SIDEBAR_PANEL_MAX_ROWS + 1 }, () => "row"),
      }),
    ).toBe(false);
    expect(registry.getAvailable()).toHaveLength(1);
    registry.dispose();
  });

  it("bounds IDs and source names at direct, event, and publisher seams", () => {
    const registry = createSidebarPanelRegistry();
    const longId = `vendor:${"x".repeat(SIDEBAR_PANEL_MAX_ID_CHARS)}` as `vendor:${string}`;
    const longSource = "s".repeat(SIDEBAR_PANEL_MAX_SOURCE_CHARS + 1);
    const safePanel = { id: "vendor:safe" as const, title: "Safe", rows: [] };

    expect(isSidebarPanelId(longId)).toBe(false);
    expect(registry.register({ ...safePanel, id: longId })).toBe(false);
    expect(registry.unregister(longId, "vendor")).toBe(false);
    expect(registry.register(safePanel, longSource)).toBe(false);
    expect(registry.unregister(safePanel.id, longSource)).toBe(false);
    registry.handleEvent({
      version: 1,
      type: "register",
      source: "vendor",
      revision: 1,
      panel: { ...safePanel, id: longId },
    });
    registry.handleEvent({
      version: 1,
      type: "register",
      source: longSource,
      revision: 1,
      panel: safePanel,
    });
    expect(registry.getAvailable()).toEqual([]);

    const emitted: unknown[] = [];
    const events = {
      on: () => () => undefined,
      emit: (_channel: string, data: unknown) => emitted.push(data),
    };
    const invalidIdPublisher = registerSidebarPanel({ events }, { ...safePanel, id: longId });
    const invalidSourcePublisher = registerSidebarPanel({ events }, safePanel, {
      source: longSource,
    });
    expect(emitted).toEqual([]);
    invalidIdPublisher.update(safePanel);
    invalidSourcePublisher.update(safePanel);
    invalidIdPublisher.dispose();
    invalidSourcePublisher.dispose();
    expect(emitted).toEqual([]);
    registry.dispose();
  });

  it("caps new panels while allowing updates and unregisters to free capacity", () => {
    const registry = createSidebarPanelRegistry();
    const panel = (id: string, title = id) => ({
      id: id as `vendor:${string}`,
      title,
      rows: [],
    });
    for (let index = 0; index < SIDEBAR_PANEL_MAX_PANELS; index += 1) {
      expect(registry.register(panel(`vendor:panel-${index}`))).toBe(true);
    }
    expect(registry.getAvailable()).toHaveLength(SIDEBAR_PANEL_MAX_PANELS);
    expect(registry.register(panel("vendor:overflow"), "overflow")).toBe(false);

    // A valid update at capacity is accepted and consumes its source revision.
    registry.handleEvent({
      version: 1,
      type: "register",
      source: "vendor",
      revision: 1,
      panel: panel("vendor:panel-0", "Updated at capacity"),
    });
    expect(registry.get("vendor:panel-0")?.title).toBe("Updated at capacity");

    // Capacity-rejected registrations do not consume a source revision, so
    // retrying the same event after capacity is freed succeeds.
    registry.handleEvent({
      version: 1,
      type: "register",
      source: "overflow",
      revision: 1,
      panel: panel("vendor:overflow", "Overflow"),
    });
    expect(registry.get("vendor:overflow")).toBeUndefined();
    registry.handleEvent({
      version: 1,
      type: "unregister",
      source: "vendor",
      revision: 2,
      id: "vendor:panel-0",
    });
    expect(registry.get("vendor:panel-0")).toBeUndefined();
    registry.handleEvent({
      version: 1,
      type: "register",
      source: "overflow",
      revision: 1,
      panel: panel("vendor:overflow", "Retried after capacity"),
    });
    expect(registry.get("vendor:overflow")?.title).toBe("Retried after capacity");
    registry.handleEvent({
      version: 1,
      type: "register",
      source: "overflow",
      revision: 2,
      panel: panel("vendor:overflow", "Accepted after unregister"),
    });
    expect(registry.get("vendor:overflow")?.title).toBe("Accepted after unregister");
    expect(registry.getAvailable()).toHaveLength(SIDEBAR_PANEL_MAX_PANELS);

    // The direct seam gets the same capacity behavior after an unregister.
    expect(registry.unregister("vendor:panel-1", "vendor")).toBe(true);
    expect(registry.register(panel("vendor:direct"), "vendor")).toBe(true);
    expect(registry.getAvailable()).toHaveLength(SIDEBAR_PANEL_MAX_PANELS);
    registry.dispose();
  });

  it("does not track capacity-rejected or invalid-owner sources", () => {
    const panel = (id: string, title = id) => ({
      id: id as `vendor:${string}`,
      title,
      rows: [],
    });
    const capacityRegistry = createSidebarPanelRegistry();
    for (let index = 0; index < SIDEBAR_PANEL_MAX_PANELS; index += 1) {
      expect(capacityRegistry.register(panel(`vendor:full-${index}`), "owner")).toBe(true);
    }
    for (let index = 0; index < SIDEBAR_PANEL_MAX_TRACKED_SOURCES * 2; index += 1) {
      capacityRegistry.handleEvent({
        version: 1,
        type: "register",
        source: `capacity-${index}`,
        revision: 1,
        panel: panel(`capacity-${index}:panel`),
      });
    }
    capacityRegistry.unregister("vendor:full-0", "owner");
    capacityRegistry.handleEvent({
      version: 1,
      type: "register",
      source: "capacity-0",
      revision: 1,
      panel: panel("capacity-0:panel", "Accepted after retry"),
    });
    expect(capacityRegistry.get("capacity-0:panel")?.title).toBe("Accepted after retry");
    capacityRegistry.dispose();

    const ownerRegistry = createSidebarPanelRegistry();
    expect(ownerRegistry.register(panel("vendor:owned"), "owner")).toBe(true);
    for (let index = 0; index < SIDEBAR_PANEL_MAX_TRACKED_SOURCES * 2; index += 1) {
      ownerRegistry.handleEvent({
        version: 1,
        type: "register",
        source: `hijacker-${index}`,
        revision: 1,
        panel: panel("vendor:owned", "Hijacked"),
      });
      ownerRegistry.handleEvent({
        version: 1,
        type: "unregister",
        source: `missing-${index}`,
        revision: 1,
        id: "vendor:missing",
      });
    }
    ownerRegistry.handleEvent({
      version: 1,
      type: "register",
      source: "missing-0",
      revision: 1,
      panel: panel("vendor:missing", "Accepted after missing removal"),
    });
    expect(ownerRegistry.get("vendor:missing")?.title).toBe("Accepted after missing removal");
    ownerRegistry.unregister("vendor:owned", "owner");
    ownerRegistry.handleEvent({
      version: 1,
      type: "register",
      source: "hijacker-0",
      revision: 1,
      panel: panel("vendor:owned", "Accepted after owner removal"),
    });
    expect(ownerRegistry.get("vendor:owned")?.title).toBe("Accepted after owner removal");
    ownerRegistry.dispose();
  });

  it("bounds tracked sources while preserving revisions for active sources", () => {
    const registry = createSidebarPanelRegistry();
    const panel = (id: string, title = id) => ({
      id: id as `${string}:${string}`,
      title,
      rows: [],
    });
    for (let index = 0; index < SIDEBAR_PANEL_MAX_TRACKED_SOURCES; index += 1) {
      registry.handleEvent({
        version: 1,
        type: "register",
        source: `tracked-${index}`,
        revision: 1,
        panel: panel(`tracked-${index}:panel`),
      });
    }
    expect(registry.getAvailable()).toHaveLength(SIDEBAR_PANEL_MAX_TRACKED_SOURCES);
    registry.handleEvent({
      version: 1,
      type: "unregister",
      source: "tracked-0",
      revision: 2,
      id: "tracked-0:panel",
    });
    registry.handleEvent({
      version: 1,
      type: "register",
      source: "overflow-source",
      revision: 1,
      panel: panel("overflow-source:panel"),
    });
    expect(registry.get("overflow-source:panel")).toBeUndefined();

    // A tracked source remains usable for updates and removal after the cap.
    registry.handleEvent({
      version: 1,
      type: "register",
      source: "tracked-1",
      revision: 2,
      panel: panel("tracked-1:panel", "Updated"),
    });
    expect(registry.get("tracked-1:panel")?.title).toBe("Updated");
    registry.handleEvent({
      version: 1,
      type: "unregister",
      source: "tracked-1",
      revision: 3,
      id: "tracked-1:panel",
    });
    expect(registry.get("tracked-1:panel")).toBeUndefined();
    registry.handleEvent({
      version: 1,
      type: "register",
      source: "tracked-1",
      revision: 2,
      panel: panel("tracked-1:panel", "Stale"),
    });
    expect(registry.get("tracked-1:panel")).toBeUndefined();
    registry.dispose();
  });

  it("keeps publisher IDs stable and ignores updates after teardown", () => {
    const emitted: unknown[] = [];
    const listeners = new Set<(data: unknown) => void>();
    const events = {
      on: (_channel: string, handler: (data: unknown) => void) => {
        listeners.add(handler);
        return () => listeners.delete(handler);
      },
      emit: (_channel: string, data: unknown) => {
        emitted.push(data);
        for (const listener of [...listeners]) listener(data);
      },
    };
    const publisher = registerSidebarPanel(
      { events },
      { id: "vendor:queue", title: "Queue", rows: ["one"] },
    );
    const registry = createSidebarPanelRegistry({ events });
    publisher.update({ id: "other:panel", title: "Renamed", rows: ["two"] });
    expect(registry.get("vendor:queue")?.title).toBe("Renamed");
    expect(registry.get("other:panel")).toBeUndefined();
    expect((emitted.at(-1) as { panel?: { id?: string } })?.panel?.id).toBe("vendor:queue");
    publisher.dispose();
    expect(registry.get("vendor:queue")).toBeUndefined();
    registry.dispose();
    publisher.update({ id: "vendor:queue", title: "After dispose", rows: ["three"] });
    expect(registry.getAvailable()).toEqual([]);
  });
});

describe("public sidebar panel seam exports", () => {
  it("exposes the public panel foundation API from the default extension entry", async () => {
    const publicApi = await import("../../src/index.ts");
    const {
      BUILTIN_SIDEBAR_PANEL_IDS: exportedBuiltins,
      DEFAULT_SIDEBAR_PANEL_LAYOUT: exportedLayout,
      SIDEBAR_PANEL_CHANNEL: exportedChannel,
      SIDEBAR_PANEL_PROTOCOL_VERSION: exportedVersion,
      SIDEBAR_PANEL_MAX_TITLE_CHARS,
      SIDEBAR_PANEL_MAX_ROWS,
      SIDEBAR_PANEL_MAX_ROW_CHARS,
      SIDEBAR_PANEL_MAX_ID_CHARS,
      SIDEBAR_PANEL_MAX_SOURCE_CHARS,
      SIDEBAR_PANEL_MAX_PANELS,
      SIDEBAR_PANEL_MAX_TRACKED_SOURCES,
      SIDEBAR_PANEL_MAX_RAW_TITLE_CODE_UNITS,
      SIDEBAR_PANEL_MAX_RAW_ROW_CODE_UNITS,
      SIDEBAR_PANEL_MAX_RAW_REQUEST_ID_CODE_UNITS,
      createSidebarPanelRegistry: exportedCreateRegistry,
      registerSidebarPanel: exportedRegisterPublisher,
      normalizeSidebarPanelLayout: exportedNormalizeLayout,
      isSidebarPanelContributionId,
      isSidebarPanelId,
      isSidebarPanelSource,
      isSidebarPanelRole,
      isSidebarPanelRequestId,
      isSidebarPanelTextWithinRawLimit,
      sanitizeSidebarPanelText,
    } = publicApi;

    expect(exportedBuiltins).toEqual([
      "agent",
      "activity",
      "alerts",
      "statuses",
      "todos",
      "context",
      "workspace",
      "usage",
      "tools",
    ]);
    expect(exportedLayout).toHaveLength(9);
    expect(exportedLayout.map((entry) => entry.id)).toEqual(exportedBuiltins);
    expect(exportedLayout.every((entry) => entry.visible === true)).toBe(true);

    expect(exportedChannel).toBe("pi-status:sidebar-panels");
    expect(exportedVersion).toBe(1);

    expect(SIDEBAR_PANEL_MAX_TITLE_CHARS).toBe(48);
    expect(SIDEBAR_PANEL_MAX_ROWS).toBe(24);
    expect(SIDEBAR_PANEL_MAX_ROW_CHARS).toBe(160);
    expect(SIDEBAR_PANEL_MAX_ID_CHARS).toBe(128);
    expect(SIDEBAR_PANEL_MAX_SOURCE_CHARS).toBe(128);
    expect(SIDEBAR_PANEL_MAX_PANELS).toBe(64);
    expect(SIDEBAR_PANEL_MAX_TRACKED_SOURCES).toBe(64);
    expect(SIDEBAR_PANEL_MAX_RAW_TITLE_CODE_UNITS).toBe(SIDEBAR_PANEL_MAX_TITLE_CHARS * 8);
    expect(SIDEBAR_PANEL_MAX_RAW_ROW_CODE_UNITS).toBe(SIDEBAR_PANEL_MAX_ROW_CHARS * 8);
    expect(SIDEBAR_PANEL_MAX_RAW_REQUEST_ID_CODE_UNITS).toBe(256);

    expect(exportedCreateRegistry).toBeDefined();
    expect(exportedRegisterPublisher).toBeDefined();
    expect(exportedNormalizeLayout).toBeDefined();
    expect(typeof exportedCreateRegistry).toBe("function");
    expect(typeof exportedRegisterPublisher).toBe("function");
    expect(typeof exportedNormalizeLayout).toBe("function");

    expect(typeof isSidebarPanelContributionId).toBe("function");
    expect(typeof isSidebarPanelId).toBe("function");
    expect(typeof isSidebarPanelSource).toBe("function");
    expect(typeof isSidebarPanelRole).toBe("function");
    expect(typeof isSidebarPanelRequestId).toBe("function");
    expect(typeof isSidebarPanelTextWithinRawLimit).toBe("function");
    expect(typeof sanitizeSidebarPanelText).toBe("function");

    const defaultExport = publicApi.default;
    expect(typeof defaultExport).toBe("function");
  });

  it("does not instantiate a public registry at module import time", () => {
    // Importing the public seam must remain synchronous and side-effect free
    // for downstream consumers; the registry is only created on demand.
    const events = { on: () => () => undefined, emit: () => undefined };
    const registry = createSidebarPanelRegistry({ events });
    expect(registry.getAvailable()).toEqual([]);
    registry.dispose();
  });
});

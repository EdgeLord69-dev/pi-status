import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import type { OverlayHandle, TUI } from "@earendil-works/pi-tui";
import { noTheme } from "../../src/tui/theme.ts";
import { buildSnapshot } from "../../src/core/resolve-footer.ts";
import type { PiStatusConfig } from "../../src/shared/types.ts";
import type { FooterRenderInput } from "../../src/tui/render.ts";
import {
  StatusLineDashboardComponent,
  type StatusLineDashboardOptions,
} from "../../src/tui/dashboard.ts";
import { isDashboardDirty } from "../../src/tui/dashboard-state.ts";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function config(): PiStatusConfig {
  return {
    zones: {
      topLeft: ["model-with-reasoning"],
      topRight: [],
      bottomLeft: ["current-dir"],
      bottomRight: [],
    },
    extensionSegments: { hidden: [] },
    completionNotifications: false,
  };
}

const preview = buildSnapshot({
  model: { name: "GPT-5" },
  cwd: "/work/pi-status",
  thinkingLevel: "medium",
  gitBranch: null,
  isIdle: true,
  hasPendingMessages: false,
  entries: [],
  accessType: undefined,
  sessionId: "session-1",
  extensionStatuses: new Map(),
});

interface DashboardOverrides {
  piOverrides?: Partial<ExtensionAPI>;
  ctxOverrides?: Partial<ExtensionCommandContext>;
  tuiOverrides?: Partial<TUI>;
  input?: Promise<string | undefined>;
  confirm?: boolean;
  toolCount?: number;
  activeTools?: string[];
  compact?: (options?: unknown) => void;
}

interface DashboardHarness {
  component: StatusLineDashboardComponent;
  pi: ExtensionAPI;
  ctx: ExtensionCommandContext;
  tui: TUI;
  done: ReturnType<typeof vi.fn>;
  handle: OverlayHandle;
  save: ReturnType<typeof vi.fn>;
  order: string[];
  setTerminalDims: (dims: { rows?: number; columns?: number }) => void;
}

function makeDashboard(overrides: DashboardOverrides = {}): DashboardHarness {
  const order: string[] = [];
  const toolCount = overrides.toolCount ?? 2;
  const activeTools = overrides.activeTools ?? ["read", "bash"];
  const pi = {
    getAllTools: vi.fn(() =>
      Array.from({ length: toolCount }, (_, index) => ({
        name: index === 0 ? "read" : index === 1 ? "bash" : `tool-${index}`,
        description: `Tool ${index}`,
        parameters: {} as never,
      })),
    ),
    getActiveTools: vi.fn(() => activeTools.slice(0, toolCount)),
    setActiveTools: vi.fn(),
    getSessionName: vi.fn(() => "Untitled"),
    setSessionName: vi.fn(),
    ...overrides.piOverrides,
  } as unknown as ExtensionAPI;

  const ctx = {
    mode: "tui",
    cwd: "/work/pi-status",
    model: { provider: "anthropic", id: "gpt-5" } as never,
    sessionManager: {
      getSessionId: () => "session-1",
      getSessionFile: () => "/sessions/session-1.jsonl",
    } as never,
    ui: {
      input: vi.fn(() => overrides.input ?? Promise.resolve(undefined)),
      confirm: vi.fn(() => Promise.resolve(overrides.confirm ?? false)),
      notify: vi.fn(),
      custom: vi.fn(async () => undefined),
    },
    compact: overrides.compact
      ? vi.fn(overrides.compact)
      : vi.fn((options?: { onComplete?: () => void; onError?: (e: Error) => void }) => {
          order.push("compact");
          try {
            options?.onComplete?.();
          } catch {}
        }),
    ...overrides.ctxOverrides,
  } as unknown as ExtensionCommandContext;

  const terminal = { columns: 80, rows: 30 };
  const tui = {
    terminal: {
      get columns() {
        return terminal.columns;
      },
      get rows() {
        return terminal.rows;
      },
    },
    requestRender: vi.fn(),
    ...overrides.tuiOverrides,
  } as unknown as TUI;
  const setTerminalDims = ({ rows, columns }: { rows?: number; columns?: number }) => {
    if (rows !== undefined) terminal.rows = rows;
    if (columns !== undefined) terminal.columns = columns;
  };

  const handle = {
    focus: vi.fn(() => order.push("handle.focus")),
    hide: vi.fn(() => order.push("handle.hide")),
    setHidden: vi.fn(() => order.push("handle.setHidden")),
    isHidden: vi.fn(() => false),
    unfocus: vi.fn(() => order.push("handle.unfocus")),
    isFocused: vi.fn(() => true),
  } as unknown as OverlayHandle;

  let componentRef: StatusLineDashboardComponent | undefined;
  const done = vi.fn(() => {
    order.push("done");
    componentRef?.dispose();
    order.push("dispose");
  });
  const save = vi.fn();
  const options: StatusLineDashboardOptions = {
    pi,
    ctx,
    tui,
    theme: noTheme,
    config: config(),
    discoveredStatuses: ["build", "review"],
    usageAvailable: true,
    getPreviewInput: () => preview as Omit<FooterRenderInput, "zones" | "extensionSegments">,
    save,
    done,
  };
  const component = new StatusLineDashboardComponent(options);
  componentRef = component;
  component.setOverlayHandle(handle);

  return { component, pi, ctx, tui, done, handle, save, order, setTerminalDims };
}

describe("StatusLineDashboardComponent", () => {
  it("loads tool and session snapshots independently", () => {
    const { component } = makeDashboard();
    expect(component.getState().tools.map(({ name }) => name)).toEqual(["read", "bash"]);
    expect(component.getState().session?.id).toBe("session-1");
  });

  it("keeps Session available when the tool snapshot fails", () => {
    const { component, ctx } = makeDashboard({
      piOverrides: {
        getAllTools: () => {
          throw new Error("tools unavailable");
        },
      },
    });
    expect(component.getState().tools).toEqual([]);
    expect(component.getState().session?.id).toBe("session-1");
    expect(ctx.ui.notify).toHaveBeenCalledWith(
      "Could not load Pi tools: tools unavailable",
      "warning",
    );
  });

  it("keeps Tools available when the session snapshot fails", () => {
    const { component, ctx } = makeDashboard({
      ctxOverrides: {
        sessionManager: {
          getSessionId: () => {
            throw new Error("session unavailable");
          },
        } as never,
      },
    });
    expect(component.getState().tools).toHaveLength(2);
    expect(component.getState().session).toBeUndefined();
    expect(ctx.ui.notify).toHaveBeenCalledWith(
      "Could not load session details: session unavailable",
      "warning",
    );
  });

  it("uses current terminal rows on every render and stores the derived offset", () => {
    const { component, setTerminalDims } = makeDashboard({ toolCount: 40 });
    component.handleInput("\t");
    component.handleInput("\t");
    component.handleInput("\t");
    for (let index = 0; index < 30; index += 1) component.handleInput("\x1b[B");

    setTerminalDims({ rows: 18 });
    const short = component.render(80);
    setTerminalDims({ rows: 40 });
    const tall = component.render(80);

    expect(short.length).toBeLessThan(tall.length);
    expect(component.getState().navigation.tools.offset).toBeGreaterThanOrEqual(0);
  });

  it.each(["q", "\x1b[113u"])("treats %j as query text on searchable tabs", (input) => {
    const { component, done } = makeDashboard();
    component.handleInput("\t");
    component.handleInput(input);
    expect(component.getState().navigation.statuses.query).toBe("q");
    expect(done).not.toHaveBeenCalled();
  });

  it.each(["q", "\x1b[113u"])("treats %j as close outside searchable tabs", (input) => {
    const { component, done } = makeDashboard();
    component.handleInput(input);
    expect(done).toHaveBeenCalledOnce();
  });

  it("clears a Tools query before Esc closes", () => {
    const { component, done } = makeDashboard();
    for (let index = 0; index < 3; index += 1) component.handleInput("\t");
    component.handleInput("r");
    component.handleInput("\x1b");
    expect(component.getState().navigation.tools.query).toBe("");
    expect(done).not.toHaveBeenCalled();
  });

  it("saves the whole draft and marks clean only after success", () => {
    const { component, save } = makeDashboard();
    // Move to Settings via Shift+Tab from Layout (Shift+Tab prev tab from Layout = Settings)
    component.handleInput("\x1b[Z");
    component.handleInput("\r"); // Toggle notifications (first row)
    component.handleInput("\x1b[B"); // Move to Save
    component.handleInput("\r"); // Activate Save
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({ completionNotifications: true }),
    );
    expect(component.getState().draft.completionNotifications).toBe(true);
    expect(component.getState().baseline.completionNotifications).toBe(true);
  });

  it("keeps a failed save dirty", () => {
    const { component, ctx, save } = makeDashboard();
    save.mockImplementationOnce(() => {
      throw new Error("disk full");
    });
    component.handleInput("\x1b[Z");
    component.handleInput("\r");
    component.handleInput("\x1b[B");
    component.handleInput("\r");
    expect(ctx.ui.notify).toHaveBeenCalledWith("Failed to save statusline config", "warning");
  });

  it("replaces confirmed tool rows after an applied toggle", () => {
    const { component, pi } = makeDashboard();
    for (let index = 0; index < 3; index += 1) component.handleInput("\t");
    component.handleInput("\r");
    expect(pi.setActiveTools).toHaveBeenCalledWith(["bash"]);
    expect(component.getState().tools.find(({ name }) => name === "read")?.enabled).toBe(false);
  });

  it("keeps confirmed rows and warns when the final tool is rejected", () => {
    const { component, ctx, pi } = makeDashboard({ activeTools: ["read"] });
    for (let index = 0; index < 3; index += 1) component.handleInput("\t");
    component.handleInput("\r");
    expect(pi.setActiveTools).not.toHaveBeenCalled();
    expect(component.getState().tools[0]?.enabled).toBe(true);
    expect(ctx.ui.notify).toHaveBeenCalledWith("At least one tool must remain active", "warning");
  });

  it("closes cleanly via q", () => {
    const { component, done, order } = makeDashboard();
    component.handleInput("q");
    expect(done).toHaveBeenCalledTimes(1);
    expect(order).toEqual(["done", "dispose"]);
  });

  it("preserves state on cancelled dirty close", async () => {
    const { component, handle, order } = makeDashboard();
    component.handleInput("\x1b[Z"); // Settings
    component.handleInput("\r"); // toggle notifications
    expect(isDashboardDirty(component.getState())).toBe(true);
    component.handleInput("q"); // request close
    await Promise.resolve();
    await Promise.resolve();
    expect(handle.focus).toHaveBeenCalled();
    expect(order).toEqual(["handle.focus"]);
    expect(isDashboardDirty(component.getState())).toBe(true);
  });

  it("closes after dirty confirmation", async () => {
    const { component, handle, order } = makeDashboard({ confirm: true });
    component.handleInput("\x1b[Z");
    component.handleInput("\r");
    component.handleInput("q");
    await Promise.resolve();
    await Promise.resolve();
    expect(order).toContain("done");
    expect(handle.focus).not.toHaveBeenCalled();
  });

  it("idempotent close/invalidate/dispose", () => {
    const { component, done, handle } = makeDashboard();
    component.close();
    component.close();
    component.close();
    component.invalidate();
    component.invalidate();
    component.dispose();
    component.dispose();
    expect(done).toHaveBeenCalledTimes(1);
    expect(handle.focus).not.toHaveBeenCalled();
  });

  it("renames the session snapshot and restores overlay focus", async () => {
    const input = deferred<string | undefined>();
    const { component, ctx, pi, handle } = makeDashboard({ input: input.promise });
    component.handleInput("\t"); // Statuses
    component.handleInput("\t"); // Session
    component.handleInput("\r"); // Rename (first row)
    input.resolve("  Release work  ");
    await input.promise;
    await Promise.resolve();
    await Promise.resolve();
    expect(pi.setSessionName).toHaveBeenCalledWith("Release work");
    expect(component.getState().session?.name).toBe("Release work");
    expect(ctx.ui.notify).toHaveBeenCalledWith("Session renamed to Release work", "info");
    expect(handle.focus).toHaveBeenCalled();
  });

  it("closes and disposes before confirmed compaction starts", async () => {
    const { component, ctx, order } = makeDashboard({ confirm: true });
    component.handleInput("\t"); // Statuses
    component.handleInput("\t"); // Session
    component.handleInput("\x1b[B"); // Compact
    component.handleInput("\r"); // Activate
    await Promise.resolve();
    await Promise.resolve();
    expect(ctx.compact).toHaveBeenCalledOnce();
    expect(order).toEqual(["done", "dispose", "compact"]);
  });

  it("focuses the overlay when rename is cancelled", async () => {
    const input = deferred<string | undefined>();
    const { component, handle, ctx } = makeDashboard({ input: input.promise });
    component.handleInput("\t");
    component.handleInput("\t");
    component.handleInput("\r");
    input.resolve(undefined);
    await input.promise;
    await Promise.resolve();
    await Promise.resolve();
    expect(handle.focus).toHaveBeenCalled();
    expect(ctx.ui.notify).not.toHaveBeenCalledWith(
      expect.stringContaining("renamed"),
      "info",
    );
  });

  it("keeps the dashboard open when rename input is blank", async () => {
    const input = deferred<string | undefined>();
    const { component, pi, handle } = makeDashboard({ input: input.promise });
    component.handleInput("\t");
    component.handleInput("\t");
    component.handleInput("\r");
    input.resolve("   ");
    await input.promise;
    await Promise.resolve();
    await Promise.resolve();
    expect(pi.setSessionName).not.toHaveBeenCalled();
    expect(handle.focus).toHaveBeenCalled();
  });

  it("warns and keeps open when setSessionName throws", async () => {
    const input = deferred<string | undefined>();
    const { component, ctx, pi, handle } = makeDashboard({
      input: input.promise,
      piOverrides: {
        setSessionName: vi.fn(() => {
          throw new Error("rename failed");
        }),
      },
    });
    component.handleInput("\t");
    component.handleInput("\t");
    component.handleInput("\r");
    input.resolve("New name");
    await input.promise;
    await Promise.resolve();
    await Promise.resolve();
    expect(pi.setSessionName).toHaveBeenCalledWith("New name");
    expect(ctx.ui.notify).toHaveBeenCalledWith("rename failed", "warning");
    expect(handle.focus).toHaveBeenCalled();
  });

  it("warns but does not focus when compact throws after close", async () => {
    const { component, ctx, handle, order } = makeDashboard({
      confirm: true,
      compact: () => {
        order.push("compact");
        throw new Error("compact boom");
      },
    });
    component.handleInput("\t");
    component.handleInput("\t");
    component.handleInput("\x1b[B");
    component.handleInput("\r");
    await Promise.resolve();
    await Promise.resolve();
    expect(ctx.compact).toHaveBeenCalledOnce();
    expect(ctx.ui.notify).toHaveBeenCalledWith("compact boom", "warning");
    expect(order).toContain("done");
    expect(handle.focus).not.toHaveBeenCalled();
  });

  it("ignores stale rename when closed before dialog resolves", async () => {
    const input = deferred<string | undefined>();
    const { component, pi, ctx, handle, order } = makeDashboard({ input: input.promise });
    component.handleInput("\t");
    component.handleInput("\t");
    component.handleInput("\r");
    component.close();
    expect(order).toEqual(["done", "dispose"]);
    input.resolve("Late");
    await input.promise;
    await Promise.resolve();
    await Promise.resolve();
    expect(pi.setSessionName).not.toHaveBeenCalled();
    expect(ctx.ui.notify).not.toHaveBeenCalledWith(
      expect.stringContaining("renamed"),
      "info",
    );
    expect(handle.focus).not.toHaveBeenCalled();
  });

  it("ignores stale compact when closed before dialog resolves", async () => {
    const { component, ctx, handle, order } = makeDashboard();
    component.handleInput("\t");
    component.handleInput("\t");
    component.handleInput("\x1b[B");
    component.handleInput("\r");
    component.close();
    expect(order).toEqual(["done", "dispose"]);
    await Promise.resolve();
    await Promise.resolve();
    expect(ctx.compact).not.toHaveBeenCalled();
    expect(handle.focus).not.toHaveBeenCalled();
  });
});

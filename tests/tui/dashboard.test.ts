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
    compact:
      overrides.compact ??
      ((options?: { onComplete?: () => void; onError?: (e: Error) => void }) => {
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
});

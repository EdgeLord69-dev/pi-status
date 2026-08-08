import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import createExtension from "../src/index.ts";
import { BUILTIN_SIDEBAR_PANEL_IDS } from "../src/shared/types.ts";
import type { StatusLineDashboardComponent } from "../src/tui/dashboard.ts";

let agentDir: string;

beforeEach(() => {
  agentDir = mkdtempSync(join(tmpdir(), "pi-status-index-"));
  vi.stubEnv("PI_CODING_AGENT_DIR", agentDir);
});

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(agentDir, { recursive: true, force: true });
});
import {
  buildPiWithHandlers,
  buildSetFooterSpy,
  createBus,
  createContext,
  getRegisteredCommand,
  renderWithFactory,
} from "./helpers.ts";
import { SIDEBAR_PANEL_CHANNEL } from "../src/tui/sidebar-panels.ts";

describe("extension wiring", () => {
  it("builds live telemetry from all session entries and OAuth access", () => {
    mkdirSync(join(agentDir, "extensions"), { recursive: true });
    writeFileSync(
      join(agentDir, "extensions", "statusline.json"),
      JSON.stringify({
        zones: {
          topLeft: ["session-cost", "access-type"],
          topRight: [],
          bottomLeft: [],
          bottomRight: [],
        },
        extensionSegments: { hidden: [] },
      }),
      "utf8",
    );
    const { pi, handlers } = buildPiWithHandlers();
    const footerSpy = buildSetFooterSpy();
    const getEntries = vi.fn(() => [{ type: "compaction", usage: { cost: { total: 0.01 } } }]);
    const getBranch = vi.fn(() => []);

    createExtension(pi);
    const ctx = createContext({
      sessionManager: {
        getSessionId: () => "abcdef123456",
        getBranch,
        getEntries,
      } as unknown as ExtensionContext["sessionManager"],
      modelRegistry: { isUsingOAuth: () => true } as unknown as ExtensionContext["modelRegistry"],
      ui: { ...createContext().ui, setFooter: footerSpy.setFooter },
    });
    for (const handler of handlers.get("session_start") ?? []) handler({}, ctx);

    expect(renderWithFactory(footerSpy.calls[0])).toContain("$0.0100");
    expect(renderWithFactory(footerSpy.calls[0])).toContain("SUBSCRIPTION");
    expect(getEntries).toHaveBeenCalled();
    expect(getBranch).not.toHaveBeenCalled();
  });

  it("classifies Kimi as subscription, other models as metered, and omits access without a model", () => {
    mkdirSync(join(agentDir, "extensions"), { recursive: true });
    writeFileSync(
      join(agentDir, "extensions", "statusline.json"),
      JSON.stringify({
        zones: { topLeft: ["access-type"], topRight: [], bottomLeft: [], bottomRight: [] },
        extensionSegments: { hidden: [] },
      }),
      "utf8",
    );
    const renderAccess = (model: ExtensionContext["model"], oauth: boolean) => {
      const { pi, handlers } = buildPiWithHandlers();
      const footerSpy = buildSetFooterSpy();
      createExtension(pi);
      const ctx = createContext({
        model,
        modelRegistry: {
          isUsingOAuth: () => oauth,
        } as unknown as ExtensionContext["modelRegistry"],
        ui: { ...createContext().ui, setFooter: footerSpy.setFooter },
      });
      for (const handler of handlers.get("session_start") ?? []) handler({}, ctx);
      return renderWithFactory(footerSpy.calls[0]);
    };

    expect(
      renderAccess(
        { id: "kimi", name: "Kimi", provider: "kimi-coding", reasoning: false } as never,
        false,
      ),
    ).toContain("SUBSCRIPTION");
    expect(
      renderAccess(
        { id: "gpt-5", name: "GPT-5", provider: "openai", reasoning: false } as never,
        false,
      ),
    ).toContain("METERED");
    expect(renderAccess(undefined, false)).not.toContain("Access:");
  });

  it("renders telemetry into the dashboard Layout preview", async () => {
    mkdirSync(join(agentDir, "extensions"), { recursive: true });
    writeFileSync(
      join(agentDir, "extensions", "statusline.json"),
      JSON.stringify({
        zones: {
          topLeft: ["session-cost", "access-type"],
          topRight: [],
          bottomLeft: [],
          bottomRight: [],
        },
        extensionSegments: { hidden: [] },
      }),
      "utf8",
    );
    const { pi, handlers, registerCommandCalls } = buildPiWithHandlers();
    let preview = "";
    let resolveCustom!: (value: unknown) => void;
    const customPromise = new Promise((resolve) => {
      resolveCustom = resolve;
    });
    const custom = vi.fn((factory: (...args: unknown[]) => unknown) => {
      const component = (
        factory as (...args: unknown[]) => { render: (width: number) => string[] }
      )({ terminal: { columns: 80, rows: 80 }, requestRender: () => {} }, null, {}, () => {});
      preview = component.render(120).join("\n");
      return customPromise;
    });
    createExtension(pi);
    const ctx = createContext({
      sessionManager: {
        getSessionId: () => "abcdef123456",
        getBranch: () => [],
        getEntries: () => [{ type: "compaction", usage: { cost: { total: 0.01 } } }],
      } as unknown as ExtensionContext["sessionManager"],
      modelRegistry: { isUsingOAuth: () => true } as unknown as ExtensionContext["modelRegistry"],
      ui: { ...createContext().ui, custom: custom as ExtensionContext["ui"]["custom"] },
    });
    for (const handler of handlers.get("session_start") ?? []) handler({}, ctx);
    const commandPromise = getRegisteredCommand(registerCommandCalls, "statusline").handler(
      "",
      ctx,
    );
    await new Promise((resolve) => setImmediate(resolve));
    resolveCustom?.(undefined);
    await commandPromise;

    expect(preview).toContain("$0.0100");
    expect(preview).toContain("SUBSCRIPTION");
  });

  it("does not call action methods during extension loading", () => {
    const { pi } = buildPiWithHandlers();
    const getThinkingLevel = vi.fn(() => {
      throw new Error(
        "Extension runtime not initialized. Action methods cannot be called during extension loading.",
      );
    });
    Object.assign(pi, { getThinkingLevel });

    expect(() => createExtension(pi)).not.toThrow();
    expect(getThinkingLevel).not.toHaveBeenCalled();
  });

  it("uses noTheme for the live footer and dashboard whenever NO_COLOR is present", async () => {
    vi.stubEnv("NO_COLOR", "");
    const { pi, handlers, registerCommandCalls } = buildPiWithHandlers();
    let footerFactory: ((...args: unknown[]) => { render(width: number): string[] }) | undefined;
    const custom = vi.fn(
      async (factory: (...args: unknown[]) => { render(width: number): string[] }) => {
        factory({ requestRender() {} }, { fg, bold }, {}, () => {}).render(100);
        return null;
      },
    );
    const fg = vi.fn((_color: string, text: string) => `<${text}>`);
    const bold = vi.fn((text: string) => `**${text}**`);
    createExtension(pi);
    const ctx = createContext({
      ui: {
        ...createContext().ui,
        custom: custom as unknown as ExtensionContext["ui"]["custom"],
        setFooter: (value: unknown) => (footerFactory = value as never),
      },
    });
    for (const handler of handlers.get("session_start") ?? []) handler({}, ctx);
    footerFactory?.(
      {},
      { fg, bold },
      { getGitBranch: () => null, getExtensionStatuses: () => new Map() },
    ).render(100);
    await getRegisteredCommand(registerCommandCalls, "statusline").handler("", ctx);

    expect(fg).not.toHaveBeenCalled();
    expect(bold).not.toHaveBeenCalled();
  });

  it("installs footer and registers /statusline", () => {
    const handlers = new Map<string, Array<(event: unknown, ctx: ExtensionContext) => void>>();
    let footerFactory:
      | ((...args: unknown[]) => { render: (width: number) => string[] })
      | undefined;
    const requestRender = vi.fn();
    const events = createBus();
    const registerCommand = vi.fn();

    const pi = {
      events,
      on(event: string, handler: (event: unknown, ctx: ExtensionContext) => void) {
        handlers.set(event, [...(handlers.get(event) ?? []), handler]);
      },
      registerCommand,
      registerShortcut: vi.fn(),
      getThinkingLevel: () => "medium",
    } as unknown as ExtensionAPI;

    createExtension(pi);
    expect(registerCommand).toHaveBeenCalledWith(
      "statusline",
      expect.objectContaining({ handler: expect.any(Function) }),
    );

    const ctx = createContext({
      ui: { ...createContext().ui, setFooter: (x: unknown) => (footerFactory = x as never) },
    });

    for (const h of handlers.get("session_start") ?? []) h({}, ctx);

    const footer = footerFactory?.(
      { requestRender },
      { fg: (_c: string, t: string) => t },
      {
        getGitBranch: () => "main",
        getExtensionStatuses: () => new Map(),
        onBranchChange: (cb: () => void) => {
          cb();
          return () => {};
        },
      },
    );

    expect(footer?.render(200).join("\n")).toContain("GPT-5 [med]");
    expect(requestRender).toHaveBeenCalled();
  });

  it("shows extension statuses on initial render without waiting for onBranchChange", () => {
    const handlers = new Map<string, Array<(event: unknown, ctx: ExtensionContext) => void>>();
    let footerFactory:
      | ((...args: unknown[]) => { render: (width: number) => string[] })
      | undefined;
    const requestRender = vi.fn();
    const events = createBus();
    const registerCommand = vi.fn();

    const pi = {
      events,
      on(event: string, handler: (event: unknown, ctx: ExtensionContext) => void) {
        handlers.set(event, [...(handlers.get(event) ?? []), handler]);
      },
      registerCommand,
      registerShortcut: vi.fn(),
      getThinkingLevel: () => "medium",
    } as unknown as ExtensionAPI;

    createExtension(pi);

    const ctx = createContext({
      ui: { ...createContext().ui, setFooter: (x: unknown) => (footerFactory = x as never) },
    });

    for (const h of handlers.get("session_start") ?? []) h({}, ctx);

    const footer = footerFactory?.(
      { requestRender },
      { fg: (_c: string, t: string) => t, rainbow: (t: string) => t },
      {
        getGitBranch: () => "main",
        getExtensionStatuses: () => new Map([["alpha", "alpha: ready"]]),
        onBranchChange: () => () => {},
      },
    );

    expect(footer?.render(200).join("\n")).toContain("ready");
    expect(requestRender).not.toHaveBeenCalled();
  });

  it("passes cached extension statuses into the dashboard discovery after footer render", async () => {
    const handlers = new Map<string, Array<(event: unknown, ctx: ExtensionContext) => void>>();
    let footerFactory:
      | ((...args: unknown[]) => { render: (width: number) => string[] })
      | undefined;
    const events = createBus();
    const registerCommand = vi.fn();
    let resolveCustom!: (value: unknown) => void;
    const customPromise = new Promise((resolve) => {
      resolveCustom = resolve;
    });
    let preview = "";
    const customMock = vi.fn((factory: (...args: unknown[]) => unknown) => {
      const component = (
        factory as (...args: unknown[]) => {
          render: (width: number) => string[];
          handleInput: (data: string) => void;
        }
      )({ terminal: { columns: 80, rows: 30 }, requestRender: () => {} }, null, {}, () => {});
      // Default tab is statusbar; two forward cycles reach the statuses tab.
      component.handleInput("\t");
      component.handleInput("\t");
      preview = component.render(200).join("\n");
      return customPromise;
    });

    const pi = {
      events,
      on(event: string, handler: (event: unknown, ctx: ExtensionContext) => void) {
        handlers.set(event, [...(handlers.get(event) ?? []), handler]);
      },
      registerCommand,
      registerShortcut: vi.fn(),
      getThinkingLevel: () => "medium",
    } as unknown as ExtensionAPI;

    createExtension(pi);

    const ctx = createContext({
      ui: {
        ...createContext().ui,
        setFooter: (x: unknown) => (footerFactory = x as never),
        custom: customMock as unknown as ExtensionContext["ui"]["custom"],
      },
    });

    for (const h of handlers.get("session_start") ?? []) h({}, ctx);

    const footer = footerFactory?.(
      { requestRender: () => {} },
      { fg: (_c: string, t: string) => t, rainbow: (t: string) => t },
      {
        getGitBranch: () => "main",
        getExtensionStatuses: () =>
          new Map([
            ["beta-status", "beta-status: syncing"],
            ["alpha-status", "alpha-status: ready"],
          ]),
        onBranchChange: () => () => {},
      },
    );

    expect(footer?.render(200).join("\n")).toContain("ready");

    const { handler } = getRegisteredCommand(registerCommand.mock.calls, "statusline");
    const commandPromise = handler("", ctx);
    await new Promise((resolve) => setImmediate(resolve));
    resolveCustom?.(undefined);
    await commandPromise;

    expect(preview).toContain("alpha-status");
    expect(preview).toContain("beta-status");
  });

  it("re-renders with updated extension statuses after onBranchChange fires", () => {
    const handlers = new Map<string, Array<(event: unknown, ctx: ExtensionContext) => void>>();
    let footerFactory:
      | ((...args: unknown[]) => { render: (width: number) => string[] })
      | undefined;
    const requestRender = vi.fn();
    const events = createBus();
    const registerCommand = vi.fn();
    let branchListener: (() => void) | undefined;
    let statusEntries: Array<[string, string]> = [["alpha", "alpha: ready"]];

    const pi = {
      events,
      on(event: string, handler: (event: unknown, ctx: ExtensionContext) => void) {
        handlers.set(event, [...(handlers.get(event) ?? []), handler]);
      },
      registerCommand,
      registerShortcut: vi.fn(),
      getThinkingLevel: () => "medium",
    } as unknown as ExtensionAPI;

    createExtension(pi);

    const ctx = createContext({
      ui: { ...createContext().ui, setFooter: (x: unknown) => (footerFactory = x as never) },
    });

    for (const h of handlers.get("session_start") ?? []) h({}, ctx);

    const footer = footerFactory?.(
      { requestRender },
      { fg: (_c: string, t: string) => t, rainbow: (t: string) => t },
      {
        getGitBranch: () => "main",
        getExtensionStatuses: () => new Map(statusEntries),
        onBranchChange: (cb: () => void) => {
          branchListener = cb;
          return () => {
            branchListener = undefined;
          };
        },
      },
    );

    expect(footer?.render(200).join("\n")).toContain("ready");

    statusEntries = [["alpha", "alpha: done"]];
    branchListener?.();

    expect(requestRender).toHaveBeenCalledTimes(1);
    expect(footer?.render(200).join("\n")).toContain("done");
  });

  it("does not leak cached extension statuses across sessions before the next dashboard render", async () => {
    const handlers = new Map<string, Array<(event: unknown, ctx: ExtensionContext) => void>>();
    let footerFactory:
      | ((...args: unknown[]) => { render: (width: number) => string[] })
      | undefined;
    const events = createBus();
    const registerCommand = vi.fn();
    let preview = "";
    let resolveCustom!: (value: unknown) => void;
    const customPromise = new Promise((resolve) => {
      resolveCustom = resolve;
    });
    const customMock = vi.fn((factory: (...args: unknown[]) => unknown) => {
      const component = (
        factory as (...args: unknown[]) => { render: (width: number) => string[] }
      )({ terminal: { columns: 80, rows: 30 }, requestRender: () => {} }, null, {}, () => {});
      preview = component.render(200).join("\n");
      return customPromise;
    });

    const pi = {
      events,
      on(event: string, handler: (event: unknown, ctx: ExtensionContext) => void) {
        handlers.set(event, [...(handlers.get(event) ?? []), handler]);
      },
      registerCommand,
      registerShortcut: vi.fn(),
      getThinkingLevel: () => "medium",
    } as unknown as ExtensionAPI;

    createExtension(pi);

    const ctxA = createContext({
      ui: { ...createContext().ui, setFooter: (x: unknown) => (footerFactory = x as never) },
    });

    for (const h of handlers.get("session_start") ?? []) h({}, ctxA);

    const footer = footerFactory?.(
      { requestRender: () => {} },
      { fg: (_c: string, t: string) => t, rainbow: (t: string) => t },
      {
        getGitBranch: () => "main",
        getExtensionStatuses: () => new Map([["alpha-status", "alpha-status: ready"]]),
        onBranchChange: () => () => {},
      },
    );

    expect(footer?.render(200).join("\n")).toContain("ready");

    for (const h of handlers.get("session_shutdown") ?? []) h({}, ctxA);

    const ctxB = createContext({
      ui: {
        ...createContext().ui,
        setFooter: (x: unknown) => (footerFactory = x as never),
        custom: customMock as unknown as ExtensionContext["ui"]["custom"],
      },
    });

    for (const h of handlers.get("session_start") ?? []) h({}, ctxB);

    const { handler } = getRegisteredCommand(registerCommand.mock.calls, "statusline");
    const commandPromise = handler("", ctxB);
    await new Promise((resolve) => setImmediate(resolve));
    resolveCustom?.(undefined);
    await commandPromise;

    expect(preview).not.toContain("alpha-status");
  });

  it("re-renders the live footer when usage-core updates arrive after startup", () => {
    const handlers = new Map<string, Array<(event: unknown, ctx: ExtensionContext) => void>>();
    let footerFactory:
      | ((...args: unknown[]) => { render: (width: number) => string[] })
      | undefined;
    const requestRender = vi.fn();
    const events = createBus();
    const registerCommand = vi.fn();

    const pi = {
      events,
      on(event: string, handler: (event: unknown, ctx: ExtensionContext) => void) {
        handlers.set(event, [...(handlers.get(event) ?? []), handler]);
      },
      registerCommand,
      registerShortcut: vi.fn(),
      getThinkingLevel: () => "medium",
    } as unknown as ExtensionAPI;

    createExtension(pi);

    const ctx = createContext({
      ui: { ...createContext().ui, setFooter: (x: unknown) => (footerFactory = x as never) },
    });

    for (const h of handlers.get("session_start") ?? []) h({}, ctx);

    footerFactory?.(
      { requestRender },
      { fg: (_c: string, t: string) => t },
      {
        getGitBranch: () => "main",
        getExtensionStatuses: () => new Map(),
      },
    );

    requestRender.mockClear();
    events.emit("usage-core:update-current", {
      state: {
        compatibility: {
          currentLiveProviderSnapshot: {
            providerId: "minimax",
            windows: [{ key: "fiveHour", usedPercent: 20 }],
          },
        },
      },
    });

    expect(requestRender).toHaveBeenCalledTimes(1);
  });

  it("reloads persisted config on session events", () => {
    const project = join(agentDir, "project");
    const configPath = join(agentDir, "extensions", "statusline.json");
    mkdirSync(join(agentDir, "extensions"), { recursive: true });
    mkdirSync(join(project, ".git"), { recursive: true });
    writeFileSync(
      configPath,
      JSON.stringify({
        zones: { topLeft: ["model"], topRight: [], bottomLeft: [], bottomRight: [] },
        extensionSegments: { hidden: [] },
      }),
      "utf8",
    );

    const handlers = new Map<string, Array<(event: unknown, ctx: ExtensionContext) => void>>();
    let footerFactory:
      | ((...args: unknown[]) => { render: (width: number) => string[] })
      | undefined;
    const events = createBus();
    const registerCommand = vi.fn();
    const pi = {
      events,
      on(event: string, handler: (event: unknown, ctx: ExtensionContext) => void) {
        handlers.set(event, [...(handlers.get(event) ?? []), handler]);
      },
      registerCommand,
      registerShortcut: vi.fn(),
      getThinkingLevel: () => "medium",
    } as unknown as ExtensionAPI;

    createExtension(pi);
    const ctx = createContext({
      cwd: project,
      ui: { ...createContext().ui, setFooter: (x: unknown) => (footerFactory = x as never) },
    });
    for (const h of handlers.get("session_start") ?? []) h({}, ctx);
    const footer = footerFactory?.(
      {},
      { fg: (_c: string, t: string) => t },
      { getGitBranch: () => "main", getExtensionStatuses: () => new Map() },
    );
    expect(footer?.render(200).join("\n")).toBe("GPT-5");

    writeFileSync(
      configPath,
      JSON.stringify({
        zones: { topLeft: ["project-name"], topRight: [], bottomLeft: [], bottomRight: [] },
        extensionSegments: { hidden: [] },
      }),
      "utf8",
    );
    for (const h of handlers.get("session_tree") ?? []) h({}, ctx);
    expect(footer?.render(200).join("\n")).toBe("project");
  });

  it("declares only pi-status in pi.extensions", () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf8")) as {
      pi: { extensions: string[] };
    };
    expect(pkg.pi.extensions).toEqual(["./src/index.ts"]);
  });

  it("persists /statusline result to the direct config file when user saves", async () => {
    const { pi, handlers, registerCommandCalls } = buildPiWithHandlers();
    const customMock = vi.fn();
    createExtension(pi);
    const ctx = createContext({ ui: { ...createContext().ui, custom: customMock } });
    for (const handler of handlers.get("session_start") ?? []) handler({}, ctx);

    let resolveCustom!: (value: unknown) => void;
    const customPromise = new Promise((resolve) => {
      resolveCustom = resolve;
    });
    customMock.mockImplementationOnce((factory: (...args: unknown[]) => unknown) => {
      const component = (
        factory as (...args: unknown[]) => { handleInput: (data: string) => void }
      )({ terminal: { columns: 80, rows: 30 }, requestRender: () => {} }, null, {}, () => {});
      // Default tab is statusbar; five forward tabs reach the settings tab.
      component.handleInput("\t");
      component.handleInput("\t");
      component.handleInput("\t");
      component.handleInput("\t");
      component.handleInput("\t");
      component.handleInput("\r"); // toggle notifications (row 0)
      component.handleInput("\x1b[B"); // → sidebar_tool_names (row 1)
      component.handleInput("\x1b[B"); // → Save (row 2)
      component.handleInput("\r"); // open dialog
      component.handleInput("\x1b[B"); // → Save
      component.handleInput("\r"); // confirm Save
      return customPromise;
    });

    const commandPromise = getRegisteredCommand(registerCommandCalls, "statusline").handler(
      "",
      ctx,
    );
    await new Promise((resolve) => setImmediate(resolve));
    resolveCustom?.(undefined);
    await commandPromise;
    expect(
      JSON.parse(readFileSync(join(agentDir, "extensions", "statusline.json"), "utf8")),
    ).toEqual({
      zones: {
        topLeft: ["model-with-reasoning"],
        topRight: [],
        bottomLeft: ["current-dir"],
        bottomRight: [],
      },
      extensionSegments: { hidden: [] },
      sidebarExtensionSegments: { hidden: [] },
      extensionStatusZone: "bottomRight",
      completionNotifications: true,
      showSidebarToolNames: false,
      sidebarPanelLayout: BUILTIN_SIDEBAR_PANEL_IDS.map((id) => ({ id, visible: true })),
    });
  });

  it("does not persist /statusline result when user cancels", async () => {
    const path = join(agentDir, "extensions", "statusline.json");
    const beforeContent = JSON.stringify({
      zones: { topLeft: ["model"], topRight: [], bottomLeft: [], bottomRight: [] },
      extensionSegments: { hidden: [] },
    });
    mkdirSync(join(agentDir, "extensions"), { recursive: true });
    writeFileSync(path, beforeContent, "utf8");
    const { pi, handlers, registerCommandCalls } = buildPiWithHandlers();
    const customMock = vi.fn();
    createExtension(pi);
    const ctx = createContext({ ui: { ...createContext().ui, custom: customMock } });
    for (const handler of handlers.get("session_start") ?? []) handler({}, ctx);

    let resolveCustom!: (value: unknown) => void;
    const customPromise = new Promise((resolve) => {
      resolveCustom = resolve;
    });
    customMock.mockImplementationOnce((factory: (...args: unknown[]) => unknown) => {
      const component = (
        factory as (...args: unknown[]) => { handleInput: (data: string) => void }
      )({ terminal: { columns: 80, rows: 30 }, requestRender: () => {} }, null, {}, () => {});
      component.handleInput("q"); // close cleanly
      return customPromise;
    });

    const commandPromise = getRegisteredCommand(registerCommandCalls, "statusline").handler(
      "",
      ctx,
    );
    await new Promise((resolve) => setImmediate(resolve));
    resolveCustom?.(undefined);
    await commandPromise;
    expect(readFileSync(path, "utf8")).toBe(beforeContent);
  });

  it("keeps the prior runtime config when saving malformed config fails", async () => {
    const path = join(agentDir, "extensions", "statusline.json");
    mkdirSync(join(agentDir, "extensions"), { recursive: true });
    writeFileSync(
      path,
      JSON.stringify({
        zones: { topLeft: ["model"], topRight: [], bottomLeft: [], bottomRight: [] },
        extensionSegments: { hidden: [] },
      }),
      "utf8",
    );
    const { pi, handlers, registerCommandCalls } = buildPiWithHandlers();
    const customMock = vi.fn();
    const notify = vi.fn();
    const footerSpy = buildSetFooterSpy();
    createExtension(pi);
    const ctx = createContext({
      ui: { ...createContext().ui, custom: customMock, notify, setFooter: footerSpy.setFooter },
    });
    for (const handler of handlers.get("session_start") ?? []) handler({}, ctx);
    writeFileSync(path, "{ bad", "utf8");

    let resolveCustom!: (value: unknown) => void;
    const customPromise = new Promise((resolve) => {
      resolveCustom = resolve;
    });
    customMock.mockImplementationOnce((factory: (...args: unknown[]) => unknown) => {
      const component = (
        factory as (...args: unknown[]) => { handleInput: (data: string) => void }
      )({ terminal: { columns: 80, rows: 30 }, requestRender: () => {} }, null, {}, () => {});
      // Navigate to the Settings tab (5 forward tabs from statusbar), open the
      // Save dialog, and confirm. Matches the old 2-step "open then confirm" flow.
      component.handleInput("\t");
      component.handleInput("\t");
      component.handleInput("\t");
      component.handleInput("\t");
      component.handleInput("\t");
      component.handleInput("\x1b[B");
      component.handleInput("\x1b[B");
      component.handleInput("\r"); // activate Save → opens dialog
      component.handleInput("\x1b[B"); // → Save button in dialog
      component.handleInput("\r"); // confirm Save
      return customPromise;
    });

    const commandPromise = getRegisteredCommand(registerCommandCalls, "statusline").handler(
      "",
      ctx,
    );
    await new Promise((resolve) => setImmediate(resolve));
    expect(notify).toHaveBeenCalledWith("Failed to save statusline config", "warning");
    resolveCustom?.(undefined);
    await commandPromise;
    expect(renderWithFactory(footerSpy.calls.at(-1))).toContain("GPT-5");
  });

  it("uses the host thinking level initially and event level over a stale getter", () => {
    const { pi, handlers } = buildPiWithHandlers({ thinkingLevel: "high" });
    const footerSpy = buildSetFooterSpy();

    createExtension(pi);

    const ctx = createContext({
      ui: { ...createContext().ui, setFooter: footerSpy.setFooter },
    });
    for (const h of handlers.get("session_start") ?? []) h({}, ctx);
    expect(renderWithFactory(footerSpy.calls[0])).toContain("GPT-5 [high]");

    for (const h of handlers.get("thinking_level_select") ?? []) h({ level: "low" }, ctx);
    expect(renderWithFactory(footerSpy.calls[0])).toContain("GPT-5 [low]");
  });

  it("skips footer APIs for RPC contexts with a UI", async () => {
    const { pi, handlers, registerCommandCalls } = buildPiWithHandlers();
    const footerSpy = buildSetFooterSpy();
    const custom = vi.fn();
    const notify = vi.fn();

    createExtension(pi);

    const ctx = createContext({
      mode: "rpc",
      ui: {
        ...createContext().ui,
        setFooter: footerSpy.setFooter,
        custom,
        notify,
      },
    });
    for (const h of handlers.get("session_start") ?? []) h({}, ctx);

    const { handler } = getRegisteredCommand(registerCommandCalls, "statusline");
    await handler("", ctx);

    for (const h of handlers.get("session_shutdown") ?? []) h({}, ctx);

    expect(footerSpy.calls).toEqual([]);
    expect(custom).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith("/statusline requires interactive UI", "warning");
  });

  it("session_shutdown clears the footer and session_start reinstalls it", () => {
    const { pi, handlers } = buildPiWithHandlers();
    const footerSpy = buildSetFooterSpy();

    createExtension(pi);

    const ctx = createContext({
      ui: { ...createContext().ui, setFooter: footerSpy.setFooter },
    });

    for (const h of handlers.get("session_start") ?? []) h({}, ctx);
    expect(footerSpy.calls).toHaveLength(1);
    expect(renderWithFactory(footerSpy.calls[0])).toContain("GPT-5 [med]");

    for (const h of handlers.get("session_shutdown") ?? []) h({}, ctx);
    expect(footerSpy.calls).toHaveLength(2);
    expect(footerSpy.calls[1]).toBeUndefined();

    for (const h of handlers.get("session_start") ?? []) h({}, ctx);
    expect(footerSpy.calls).toHaveLength(3);
    expect(renderWithFactory(footerSpy.calls[2])).toContain("GPT-5 [med]");
  });

  it.each([
    "tools",
    "session",
    "notifications",
    "notifications on",
    "preset",
    "preset minimal",
    "unknown",
    "  Tools  ",
  ])("rejects non-empty arguments %j without opening UI", async (args) => {
    const { pi, handlers, registerCommandCalls } = buildPiWithHandlers();
    const custom = vi.fn().mockResolvedValue(null),
      select = vi.fn(),
      input = vi.fn(),
      confirm = vi.fn(),
      notify = vi.fn();
    createExtension(pi);
    const baseUi = createContext().ui;
    const ctx = createContext({
      ui: {
        ...baseUi,
        custom: custom as never,
        select: select as never,
        input: input as never,
        confirm: confirm as never,
        notify: notify as never,
      },
    });
    for (const h of handlers.get("session_start") ?? []) h({}, ctx);
    await getRegisteredCommand(registerCommandCalls, "statusline").handler(args, ctx);
    // Sidebar mounts via custom (1 call); the dashboard should NOT open.
    expect(custom).toHaveBeenCalledTimes(1);
    expect(select).not.toHaveBeenCalled();
    expect(input).not.toHaveBeenCalled();
    expect(confirm).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledExactlyOnceWith("Usage: /statusline", "warning");
  });

  it("rejects arguments before the RPC warning", async () => {
    const { pi, handlers, registerCommandCalls } = buildPiWithHandlers();
    const notify = vi.fn();
    createExtension(pi);
    const ctx = createContext({
      mode: "rpc",
      ui: { ...createContext().ui, notify: notify as never },
    });
    for (const h of handlers.get("session_start") ?? []) h({}, ctx);
    await getRegisteredCommand(registerCommandCalls, "statusline").handler("tools", ctx);
    expect(notify).toHaveBeenCalledExactlyOnceWith("Usage: /statusline", "warning");
  });
});

describe("/statusline theme adaptation", () => {
  it("uses the Pi-like theme inside the dashboard", async () => {
    vi.stubEnv("NO_COLOR", undefined);
    const { pi, handlers, registerCommandCalls } = buildPiWithHandlers();
    const customMock = vi.fn();
    const fgCalls: Array<[string, string]> = [];
    const piLikeTheme = {
      fg: (color: string, text: string) => {
        fgCalls.push([color, text]);
        return `<fg:${color}:${text}>`;
      },
      bold: (text: string) => `<bold:${text}>`,
    };

    createExtension(pi);

    const ctx = createContext({
      ui: { ...createContext().ui, custom: customMock },
    });
    for (const h of handlers.get("session_start") ?? []) h({}, ctx);

    const { handler } = getRegisteredCommand(registerCommandCalls, "statusline");
    let resolveCustom!: (value: unknown) => void;
    const customPromise = new Promise((resolve) => {
      resolveCustom = resolve;
    });
    customMock.mockImplementationOnce((factory: (...args: unknown[]) => unknown) => {
      const component = (
        factory as (...args: unknown[]) => { render: (width: number) => string[] }
      )(
        { terminal: { columns: 80, rows: 30 }, requestRender: () => {} },
        piLikeTheme,
        {},
        () => {},
      );
      component.render(200);
      return customPromise;
    });

    const commandPromise = handler("", ctx);
    await new Promise((resolve) => setImmediate(resolve));
    resolveCustom?.(undefined);
    await commandPromise;

    expect(fgCalls.length).toBeGreaterThan(0);
    expect(fgCalls.some(([color]) => color === "borderAccent")).toBe(true);
  });

  it.each([
    ["missing fg", { bold: (_text: string) => "should-not-be-called" }],
    ["missing bold", { fg: (_color: string, text: string) => text }],
    ["null", null],
  ])("falls back to noTheme for a %s runtime theme", async (_case, runtimeTheme) => {
    const { pi, handlers, registerCommandCalls } = buildPiWithHandlers();
    const customMock = vi.fn();
    createExtension(pi);

    const ctx = createContext({ ui: { ...createContext().ui, custom: customMock } });
    for (const h of handlers.get("session_start") ?? []) h({}, ctx);

    let renderOutput: string[] = [];
    let resolveCustom!: (value: unknown) => void;
    const customPromise = new Promise((resolve) => {
      resolveCustom = resolve;
    });
    customMock.mockImplementationOnce((factory: (...args: unknown[]) => unknown) => {
      const component = (
        factory as (...args: unknown[]) => { render: (width: number) => string[] }
      )(
        { terminal: { columns: 80, rows: 30 }, requestRender: () => {} },
        runtimeTheme,
        {},
        () => {},
      );
      renderOutput = component.render(200);
      return customPromise;
    });

    const { handler } = getRegisteredCommand(registerCommandCalls, "statusline");
    const commandPromise = handler("", ctx);
    await new Promise((resolve) => setImmediate(resolve));
    resolveCustom?.(undefined);
    await commandPromise;
    expect(renderOutput.length).toBeGreaterThan(0);
  });
});

describe("extension wiring — completion notifications", () => {
  function enableNotifications(): void {
    const configPath = join(agentDir, "extensions", "statusline.json");
    mkdirSync(join(agentDir, "extensions"), { recursive: true });
    writeFileSync(
      configPath,
      JSON.stringify({
        zones: { topLeft: [], topRight: [], bottomLeft: [], bottomRight: [] },
        extensionSegments: { hidden: [] },
        completionNotifications: true,
        showSidebarToolNames: false,
        sidebarPanelLayout: BUILTIN_SIDEBAR_PANEL_IDS.map((id) => ({ id, visible: true })),
      }),
      "utf8",
    );
  }

  function installNotificationSpawn(pi: ExtensionAPI, calls: string[], kill = vi.fn()): void {
    (pi as unknown as { spawn: () => unknown }).spawn = () => {
      calls.push("spawn");
      return { kill, once: () => undefined, unref: () => {} };
    };
    (pi as unknown as { platform: NodeJS.Platform }).platform = "darwin";
  }

  it("does not launch a native process when the preference is disabled", () => {
    const { pi, handlers } = buildPiWithHandlers();
    const spawn = vi.fn();
    (pi as unknown as { spawn: () => unknown }).spawn = spawn;
    createExtension(pi);
    const ctx = createContext({ mode: "tui" });
    for (const h of handlers.get("session_start") ?? []) h({}, ctx);
    for (const h of handlers.get("agent_start") ?? []) h({}, ctx);
    for (const h of handlers.get("agent_settled") ?? []) h({}, ctx);
    expect(spawn).not.toHaveBeenCalled();
  });

  it("notifies for fresh event contexts from the active TUI session", () => {
    enableNotifications();
    const { pi, handlers } = buildPiWithHandlers();
    const calls: string[] = [];
    installNotificationSpawn(pi, calls);
    createExtension(pi);
    const sessionManager = createContext().sessionManager;
    const startCtx = createContext({ sessionManager });
    const eventCtx = createContext({ sessionManager });
    for (const h of handlers.get("session_start") ?? []) h({}, startCtx);
    for (const h of handlers.get("agent_start") ?? []) h({}, eventCtx);
    for (const h of handlers.get("agent_settled") ?? []) h({}, eventCtx);

    expect(calls).toEqual(["spawn"]);
  });

  it("ignores agent_settled callbacks for stale session contexts", () => {
    enableNotifications();
    const { pi, handlers } = buildPiWithHandlers();
    const calls: string[] = [];
    installNotificationSpawn(pi, calls);
    createExtension(pi);
    const oldSessionManager = createContext().sessionManager;
    const currentSessionManager = createContext().sessionManager;
    for (const h of handlers.get("session_start") ?? []) {
      h({}, createContext({ sessionManager: oldSessionManager }));
      h({}, createContext({ sessionManager: currentSessionManager }));
    }
    for (const h of handlers.get("agent_start") ?? []) {
      h({}, createContext({ sessionManager: currentSessionManager }));
    }
    for (const h of handlers.get("agent_settled") ?? []) {
      h({}, createContext({ sessionManager: oldSessionManager }));
    }
    expect(calls).toEqual([]);
  });

  it("forwards only once per questionnaire interval", () => {
    enableNotifications();
    const { pi, handlers, events } = buildPiWithHandlers();
    const calls: string[] = [];
    installNotificationSpawn(pi, calls);
    createExtension(pi);
    const ctx = createContext({ mode: "tui" });
    for (const h of handlers.get("session_start") ?? []) h({}, ctx);

    events.emit("pi-vault:questionnaire:status", { active: true, label: "Choose tool" });
    events.emit("pi-vault:questionnaire:status", { active: true, label: "Choose model" });
    events.emit("pi-vault:questionnaire:status", { active: false });
    events.emit("pi-vault:questionnaire:status", { active: true, label: "New wait" });

    expect(calls.length).toBe(2);
  });

  it("ignores malformed questionnaire requests without a label", () => {
    enableNotifications();
    const { pi, handlers, events } = buildPiWithHandlers();
    const calls: string[] = [];
    installNotificationSpawn(pi, calls);
    createExtension(pi);
    const ctx = createContext({ mode: "tui" });
    for (const h of handlers.get("session_start") ?? []) h({}, ctx);

    events.emit("pi-vault:questionnaire:status", { active: true });

    expect(calls).toEqual([]);
  });

  it("does not listen for questionnaire requests in RPC sessions", () => {
    enableNotifications();
    const { pi, handlers, events } = buildPiWithHandlers();
    const calls: string[] = [];
    installNotificationSpawn(pi, calls);
    createExtension(pi);
    const ctx = createContext({ mode: "rpc" });
    for (const h of handlers.get("session_start") ?? []) h({}, ctx);

    events.emit("pi-vault:questionnaire:status", { active: true, label: "Choose tool" });

    expect(calls).toEqual([]);
  });

  it("rearms questionnaires without clearing the settled-run dedupe", () => {
    enableNotifications();
    const { pi, handlers, events } = buildPiWithHandlers();
    const calls: string[] = [];
    const kill = vi.fn(() => true);
    installNotificationSpawn(pi, calls, kill);
    createExtension(pi);
    const ctx = createContext({ mode: "tui" });
    for (const h of handlers.get("session_start") ?? []) h({}, ctx);
    for (const h of handlers.get("agent_start") ?? []) h({}, ctx);
    for (const h of handlers.get("agent_settled") ?? []) h({}, ctx);

    events.emit("pi-vault:questionnaire:status", { active: false });
    for (const h of handlers.get("agent_settled") ?? []) h({}, ctx);

    expect(calls).toEqual(["spawn"]);
    expect(kill).not.toHaveBeenCalled();
  });
});

describe("/statusline dashboard wiring", () => {
  interface DeferredCustomHost {
    custom: ReturnType<typeof vi.fn>;
    resolveCustom: (value: unknown) => void;
    component: () => StatusLineDashboardComponent;
    capturedOptions: () => Record<string, unknown> | undefined;
    done: ReturnType<typeof vi.fn>;
    order: string[];
  }

  function deferredCustomHost(): DeferredCustomHost {
    let capturedOptions: Record<string, unknown> | undefined;
    let resolveCustom!: (value: unknown) => void;
    let component!: StatusLineDashboardComponent;
    const order: string[] = [];
    const customPromise = new Promise((resolve) => {
      resolveCustom = resolve;
    });
    const done = vi.fn((value: unknown) => {
      order.push("done");
      component.dispose();
      order.push("dispose");
      resolveCustom(value);
    });
    const custom = vi.fn((factory, options) => {
      capturedOptions = options as Record<string, unknown>;
      component = factory(
        { terminal: { columns: 80, rows: 30 }, requestRender: vi.fn() },
        null,
        {},
        done,
      ) as StatusLineDashboardComponent;
      return customPromise;
    });
    return {
      custom,
      resolveCustom: (value) => done(value),
      component: () => component,
      capturedOptions: () => capturedOptions,
      done,
      order,
    };
  }

  it("opens whitespace-only input with exact overlay options without replacing the live footer", async () => {
    const { pi, handlers, registerCommandCalls } = buildPiWithHandlers();
    const footerSpy = buildSetFooterSpy();
    createExtension(pi);
    const host = deferredCustomHost();
    const select = vi.fn();
    const input = vi.fn();
    const confirm = vi.fn();
    const editor = vi.fn();
    const ctx = createContext({
      ui: {
        ...createContext().ui,
        setFooter: footerSpy.setFooter,
        select: select as never,
        input: input as never,
        confirm: confirm as never,
        editor: editor as never,
        custom: host.custom as unknown as ExtensionContext["ui"]["custom"],
      },
    });
    for (const h of handlers.get("session_start") ?? []) h({}, ctx);
    const footerCallsBeforeOpen = footerSpy.calls.length;
    const commandPromise = getRegisteredCommand(registerCommandCalls, "statusline").handler(
      " \t ",
      ctx,
    );
    await new Promise((resolve) => setImmediate(resolve));
    // First custom call is the sidebar mount; the second is the dashboard open.
    expect(host.custom).toHaveBeenCalledTimes(2);
    expect(host.capturedOptions()).toEqual({
      overlay: true,
      overlayOptions: { anchor: "center", maxHeight: "85%", width: "92%" },
    });
    expect(footerSpy.calls).toHaveLength(footerCallsBeforeOpen);
    host.resolveCustom(undefined);
    await commandPromise;
    expect(footerSpy.calls).toHaveLength(footerCallsBeforeOpen);
    expect(renderWithFactory(footerSpy.calls.at(-1))).toContain("GPT-5 [med]");
    expect(select).not.toHaveBeenCalled();
    expect(input).not.toHaveBeenCalled();
    expect(confirm).not.toHaveBeenCalled();
    expect(editor).not.toHaveBeenCalled();
  });

  it("ignores a second plain invocation while the dashboard is pending", async () => {
    const { pi, handlers, registerCommandCalls } = buildPiWithHandlers();
    const footerSpy = buildSetFooterSpy();
    createExtension(pi);
    const host = deferredCustomHost();
    const ctx = createContext({
      ui: {
        ...createContext().ui,
        setFooter: footerSpy.setFooter,
        custom: host.custom as unknown as ExtensionContext["ui"]["custom"],
      },
    });
    for (const h of handlers.get("session_start") ?? []) h({}, ctx);
    const first = getRegisteredCommand(registerCommandCalls, "statusline").handler("", ctx);
    await new Promise((resolve) => setImmediate(resolve));
    await getRegisteredCommand(registerCommandCalls, "statusline").handler("", ctx);
    // Sidebar mount + dashboard open; the second invocation is ignored.
    expect(host.custom).toHaveBeenCalledTimes(2);
    host.resolveCustom(undefined);
    await first;
  });

  it("warns and skips when the host is not TUI", async () => {
    const { pi, handlers, registerCommandCalls } = buildPiWithHandlers();
    const footerSpy = buildSetFooterSpy();
    createExtension(pi);
    const host = deferredCustomHost();
    const ctx = createContext({
      mode: "rpc",
      ui: {
        ...createContext().ui,
        setFooter: footerSpy.setFooter,
        custom: host.custom as unknown as ExtensionContext["ui"]["custom"],
      },
    });
    for (const h of handlers.get("session_start") ?? []) h({}, ctx);
    await getRegisteredCommand(registerCommandCalls, "statusline").handler("", ctx);
    expect(host.custom).not.toHaveBeenCalled();
    expect(ctx.ui.notify).toHaveBeenCalledWith("/statusline requires interactive UI", "warning");
  });

  it("warns on custom rejection and retries without replacing the footer", async () => {
    const { pi, handlers, registerCommandCalls } = buildPiWithHandlers();
    const footerSpy = buildSetFooterSpy();
    const custom = vi
      .fn()
      .mockResolvedValueOnce(null)
      .mockRejectedValueOnce(new Error("Overlay rejected"))
      .mockResolvedValue(null);
    createExtension(pi);
    const ctx = createContext({
      ui: {
        ...createContext().ui,
        setFooter: footerSpy.setFooter,
        custom: custom as unknown as ExtensionContext["ui"]["custom"],
      },
    });
    for (const h of handlers.get("session_start") ?? []) h({}, ctx);
    const footerCallsBeforeOpen = footerSpy.calls.length;
    await getRegisteredCommand(registerCommandCalls, "statusline").handler("", ctx);
    expect(ctx.ui.notify).toHaveBeenCalledWith(
      "Could not open statusline dashboard: Overlay rejected",
      "warning",
    );
    await getRegisteredCommand(registerCommandCalls, "statusline").handler("", ctx);
    // 1 sidebar mount + 2 dashboard attempts (rejected, then retried).
    expect(custom).toHaveBeenCalledTimes(3);
    expect(footerSpy.calls).toHaveLength(footerCallsBeforeOpen);
    expect(renderWithFactory(footerSpy.calls.at(-1))).toContain("GPT-5 [med]");
  });

  it.each([
    ["session_start", "rename"],
    ["session_start", "compact"],
    ["session_tree", "rename"],
    ["session_tree", "compact"],
    ["session_shutdown", "rename"],
    ["session_shutdown", "compact"],
  ] as const)("closes the hosted dashboard before %s with pending %s", async (event, action) => {
    const { pi, handlers, registerCommandCalls } = buildPiWithHandlers();
    const footerSpy = buildSetFooterSpy();
    const host = deferredCustomHost();
    createExtension(pi);
    const ctx = createContext({
      ui: {
        ...createContext().ui,
        setFooter: footerSpy.setFooter,
        custom: host.custom as unknown as ExtensionContext["ui"]["custom"],
      },
    });
    for (const h of handlers.get("session_start") ?? []) h({}, ctx);
    const { handler } = getRegisteredCommand(registerCommandCalls, "statusline");
    const commandPromise = handler("", ctx);
    await new Promise((resolve) => setImmediate(resolve));

    const component = host.component();
    component.handleInput("\t");
    component.handleInput("\t");
    if (action === "compact") component.handleInput("\x1b[B");
    component.handleInput("\r");

    const eventCtx = event === "session_shutdown" ? ctx : createContext();
    for (const h of handlers.get(event) ?? []) h({}, eventCtx);
    if (action === "rename") {
      component.handleInput("Late");
      component.handleInput("\r");
    } else {
      component.handleInput("\x1b[B");
      component.handleInput("\r");
    }
    await commandPromise;

    expect(host.done).toHaveBeenCalledTimes(1);
    expect(host.order).toEqual(["done", "dispose"]);
    expect(pi.setSessionName).not.toHaveBeenCalled();
    expect(ctx.compact).not.toHaveBeenCalled();
    expect(ctx.ui.notify).not.toHaveBeenCalledWith(expect.stringContaining("renamed"), "info");

    const reopenCustom = vi.fn(async () => undefined);
    ctx.ui.custom = reopenCustom as unknown as ExtensionContext["ui"]["custom"];
    await handler("", ctx);
    expect(reopenCustom).toHaveBeenCalledOnce();
  });

  it("ignores stale unrelated session_shutdown", async () => {
    const { pi, handlers, registerCommandCalls } = buildPiWithHandlers();
    const footerSpy = buildSetFooterSpy();
    createExtension(pi);
    const host = deferredCustomHost();
    const unrelatedSessionManager = {
      getSessionId: () => "stale",
      getSessionFile: () => undefined,
      getBranch: () => [],
      getEntries: () => [],
    };
    const ctx = createContext({
      ui: {
        ...createContext().ui,
        setFooter: footerSpy.setFooter,
        custom: host.custom as unknown as ExtensionContext["ui"]["custom"],
      },
    });
    for (const h of handlers.get("session_start") ?? []) h({}, ctx);
    const commandPromise = getRegisteredCommand(registerCommandCalls, "statusline").handler(
      "",
      ctx,
    );
    await new Promise((resolve) => setImmediate(resolve));
    for (const h of handlers.get("session_shutdown") ?? [])
      h({}, createContext({ sessionManager: unrelatedSessionManager as never }));
    // 1 sidebar mount + 1 dashboard open; the stale shutdown must not reopen.
    expect(host.custom).toHaveBeenCalledTimes(2);
    host.resolveCustom(undefined);
    await commandPromise;
  });
});

describe("sidebar lifecycle", () => {
  function trackDiscoverCount(events: ReturnType<typeof buildPiWithHandlers>["events"]): {
    count: number;
  } {
    const tracker = { count: 0 };
    events.on(SIDEBAR_PANEL_CHANNEL, (payload) => {
      if (
        typeof payload === "object" &&
        payload !== null &&
        (payload as { type?: unknown }).type === "discover"
      ) {
        tracker.count += 1;
      }
    });
    return tracker;
  }

  it("creates one registry and one controller on session_start, and the registry auto-emits exactly one discover request", async () => {
    const { pi, handlers, events } = buildPiWithHandlers();
    const discover = trackDiscoverCount(events);
    createExtension(pi);
    const ctx = createContext();
    for (const handler of handlers.get("session_start") ?? []) handler({}, ctx);
    await new Promise((resolve) => setImmediate(resolve));
    expect(discover.count).toBe(1);
  });

  it("mounts the sidebar overlay on session_start", async () => {
    const { pi, handlers } = buildPiWithHandlers();
    const customMock = vi.fn(async () => null);
    createExtension(pi);
    const ctx = createContext({
      ui: { ...createContext().ui, custom: customMock as never },
    });
    for (const handler of handlers.get("session_start") ?? []) handler({}, ctx);
    await new Promise((resolve) => setImmediate(resolve));
    const sidebarMounted = customMock.mock.calls.some(
      (call: unknown[]) =>
        Array.isArray(call) &&
        call[1] !== undefined &&
        typeof call[1] === "object" &&
        (call[1] as { overlay?: unknown }).overlay === true,
    );
    expect(sidebarMounted).toBe(true);
  });

  it("does not recreate the registry or controller on session_tree", async () => {
    const { pi, handlers, events } = buildPiWithHandlers();
    const discover = trackDiscoverCount(events);
    createExtension(pi);
    const ctx = createContext();
    for (const handler of handlers.get("session_start") ?? []) handler({}, ctx);
    await new Promise((resolve) => setImmediate(resolve));
    const afterStart = discover.count;
    for (const handler of handlers.get("session_tree") ?? []) handler({}, ctx);
    expect(discover.count).toBe(afterStart);
  });

  it("ignores a nonmatching session_shutdown", () => {
    const { pi, handlers } = buildPiWithHandlers();
    const footerSpy = buildSetFooterSpy();
    createExtension(pi);
    const ctx = createContext({
      ui: { ...createContext().ui, setFooter: footerSpy.setFooter },
    });
    for (const handler of handlers.get("session_start") ?? []) handler({}, ctx);
    for (const handler of handlers.get("session_shutdown") ?? []) handler({}, createContext());
    expect(typeof footerSpy.calls.at(-1)).toBe("function");
  });

  it("matching session_shutdown closes the dashboard, disposes sidebar resources, and restores the default footer", () => {
    const { pi, handlers } = buildPiWithHandlers();
    const footerSpy = buildSetFooterSpy();
    createExtension(pi);
    const ctx = createContext({
      ui: { ...createContext().ui, setFooter: footerSpy.setFooter },
    });
    for (const handler of handlers.get("session_start") ?? []) handler({}, ctx);
    for (const handler of handlers.get("session_shutdown") ?? []) handler({}, ctx);
    expect(footerSpy.calls.at(-1)).toBeUndefined();
  });

  it("registers ctrl+shift+r exactly once across two session_starts", () => {
    const { pi, handlers, registeredShortcuts } = buildPiWithHandlers();
    createExtension(pi);
    for (const handler of handlers.get("session_start") ?? []) handler({}, createContext());
    for (const handler of handlers.get("session_start") ?? []) handler({}, createContext());
    expect(registeredShortcuts).toHaveLength(1);
    expect(registeredShortcuts[0]?.key).toBe("ctrl+shift+r");
  });

  it("threads the sidebar effective width into the dashboard overlay options when /statusline runs", async () => {
    const { pi, handlers, registerCommandCalls } = buildPiWithHandlers();
    let dashboardOptions: unknown;
    let callIndex = 0;
    const custom = vi
      .fn()
      .mockImplementation((factory: (...args: unknown[]) => unknown, customOptions: unknown) => {
        const current = callIndex;
        callIndex += 1;
        if (current === 0) {
          // First overlay call: sidebar mount. Invoke the factory so the controller
          // captures a wide terminal and is effectively visible.
          const component = (
            factory as (...args: unknown[]) => { render: (width: number) => string[] }
          )({ terminal: { columns: 120, rows: 30 }, requestRender: vi.fn() }, null, {}, () => {});
          if (typeof component === "object" && component !== null && "render" in component) {
            (component as { render: (w: number) => string[] }).render(44);
          }
          return Promise.resolve(null);
        }
        // Second overlay call: dashboard open. Capture options and resolve immediately.
        dashboardOptions = customOptions;
        const component = (
          factory as (...args: unknown[]) => {
            render: (width: number) => string[];
            close: () => void;
          }
        )({ terminal: { columns: 80, rows: 30 }, requestRender: vi.fn() }, null, {}, () => {});
        if (typeof component === "object" && component !== null && "close" in component) {
          (component as { close: () => void }).close();
        }
        return Promise.resolve(null);
      });
    createExtension(pi);
    const ctx = createContext({
      ui: { ...createContext().ui, custom: custom as never },
    });
    for (const handler of handlers.get("session_start") ?? []) handler({}, ctx);
    await new Promise((resolve) => setImmediate(resolve));
    await getRegisteredCommand(registerCommandCalls, "statusline").handler("", ctx);
    expect(dashboardOptions).toMatchObject({
      overlay: true,
      overlayOptions: expect.objectContaining({ offsetX: -22 }),
    });
  });
});

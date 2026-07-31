import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  initTheme,
  type ExtensionAPI,
  type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import createExtension from "../src/index.ts";

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

    expect(renderWithFactory(footerSpy.calls[0])).toContain("Cost: $0.0100");
    expect(renderWithFactory(footerSpy.calls[0])).toContain("Access: subscription");
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
    ).toContain("Access: subscription");
    expect(
      renderAccess(
        { id: "gpt-5", name: "GPT-5", provider: "openai", reasoning: false } as never,
        false,
      ),
    ).toContain("Access: metered");
    expect(renderAccess(undefined, false)).not.toContain("Access:");
  });

  it("uses telemetry in the statusline editor preview", async () => {
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
    const custom = vi.fn(
      async (factory: (...args: unknown[]) => { render: (width: number) => string[] }) => {
        preview = factory(
          { requestRender: () => {} },
          { fg: (_color: string, text: string) => text, bold: (text: string) => text },
          {},
          () => {},
        )
          .render(200)
          .join("\n");
        return null;
      },
    );
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
    await getRegisteredCommand(registerCommandCalls, "statusline").handler("", ctx);

    expect(preview).toContain("Cost: $0.0100");
    expect(preview).toContain("Access: subscription");
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

  it("uses noTheme for live footer and editor whenever NO_COLOR is present", async () => {
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

  it("passes cached extension statuses into /statusline discovery after footer render", async () => {
    const handlers = new Map<string, Array<(event: unknown, ctx: ExtensionContext) => void>>();
    let footerFactory:
      | ((...args: unknown[]) => { render: (width: number) => string[] })
      | undefined;
    const events = createBus();
    const registerCommand = vi.fn();
    const customMock = vi.fn(async (..._args: unknown[]) => null);

    const pi = {
      events,
      on(event: string, handler: (event: unknown, ctx: ExtensionContext) => void) {
        handlers.set(event, [...(handlers.get(event) ?? []), handler]);
      },
      registerCommand,
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

    await handler("", ctx);

    const factory = customMock.mock.calls[0]?.[0] as
      | ((...args: unknown[]) => { render: (width: number) => string[] })
      | undefined;
    const component = factory?.(
      { requestRender: () => {} },
      {
        fg: (_c: string, t: string) => t,
        bold: (t: string) => t,
        dim: (t: string) => t,
        rainbow: (t: string) => t,
      },
      {},
      () => {},
    );
    const lines = component?.render(200).join("\n") ?? "";

    expect(lines).toContain("alpha-status");
    expect(lines).toContain("beta-status");
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

  it("does not leak cached extension statuses across sessions before the next footer render", async () => {
    const handlers = new Map<string, Array<(event: unknown, ctx: ExtensionContext) => void>>();
    let footerFactory:
      | ((...args: unknown[]) => { render: (width: number) => string[] })
      | undefined;
    const events = createBus();
    const registerCommand = vi.fn();
    const customMock = vi.fn(async (..._args: unknown[]) => null);

    const pi = {
      events,
      on(event: string, handler: (event: unknown, ctx: ExtensionContext) => void) {
        handlers.set(event, [...(handlers.get(event) ?? []), handler]);
      },
      registerCommand,
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

    await handler("", ctxB);

    const factory = customMock.mock.calls[0]?.[0] as
      | ((...args: unknown[]) => { render: (width: number) => string[] })
      | undefined;
    const component = factory?.(
      { requestRender: () => {} },
      {
        fg: (_c: string, t: string) => t,
        bold: (t: string) => t,
        dim: (t: string) => t,
        rainbow: (t: string) => t,
      },
      {},
      () => {},
    );
    const lines = component?.render(200).join("\n") ?? "";

    expect(lines).not.toContain("alpha-status");
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

  it("invokes /statusline via ctx.ui.custom without overlay mode", async () => {
    const handlers = new Map<string, Array<(event: unknown, ctx: ExtensionContext) => void>>();
    const events = createBus();
    const registerCommand = vi.fn();
    const customMock = vi.fn(async (..._args: unknown[]) => null);

    const pi = {
      events,
      on(event: string, handler: (event: unknown, ctx: ExtensionContext) => void) {
        handlers.set(event, [...(handlers.get(event) ?? []), handler]);
      },
      registerCommand,
      getThinkingLevel: () => "medium",
    } as unknown as ExtensionAPI;

    createExtension(pi);

    const ctx = createContext({
      ui: {
        ...createContext().ui,
        custom: customMock as unknown as ExtensionContext["ui"]["custom"],
      },
    });

    for (const h of handlers.get("session_start") ?? []) h({}, ctx);

    const { handler } = getRegisteredCommand(registerCommand.mock.calls, "statusline");

    await handler("", ctx);

    expect(customMock).toHaveBeenCalledTimes(1);
    const callArgs = customMock.mock.calls[0] as unknown[];
    expect(typeof callArgs[0]).toBe("function");
    expect(callArgs[1]).toBeUndefined();
  });

  it("persists /statusline result to the direct config file when user saves", async () => {
    const { pi, handlers, registerCommandCalls } = buildPiWithHandlers();
    const customMock = vi.fn();
    createExtension(pi);
    const ctx = createContext({ ui: { ...createContext().ui, custom: customMock } });
    for (const handler of handlers.get("session_start") ?? []) handler({}, ctx);

    customMock.mockImplementationOnce(async (factory: (...args: unknown[]) => unknown) => {
      let savedResult: unknown;
      const component = (
        factory as (...args: unknown[]) => { handleInput: (data: string) => void }
      )(
        { requestRender: () => {} },
        { fg: (_c: string, text: string) => text },
        {},
        (result: unknown) => (savedResult = result),
      );
      component.handleInput("\r");
      return savedResult;
    });

    await getRegisteredCommand(registerCommandCalls, "statusline").handler("", ctx);
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
      completionNotifications: false,
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

    customMock.mockImplementationOnce(async (factory: (...args: unknown[]) => unknown) => {
      const component = (
        factory as (...args: unknown[]) => { handleInput: (data: string) => void }
      )({ requestRender: () => {} }, { fg: (_c: string, text: string) => text }, {}, () => {});
      component.handleInput("\x1b");
      return null;
    });

    await getRegisteredCommand(registerCommandCalls, "statusline").handler("", ctx);
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

    customMock.mockImplementationOnce(async (factory: (...args: unknown[]) => unknown) => {
      let savedResult: unknown;
      const component = (
        factory as (...args: unknown[]) => { handleInput: (data: string) => void }
      )(
        { requestRender: () => {} },
        { fg: (_c: string, text: string) => text },
        {},
        (result: unknown) => (savedResult = result),
      );
      component.handleInput("\r");
      return savedResult;
    });

    await getRegisteredCommand(registerCommandCalls, "statusline").handler("", ctx);
    expect(notify).toHaveBeenCalledWith("Failed to save statusline config", "warning");
    expect(renderWithFactory(footerSpy.calls[footerSpy.calls.length - 1])).toBe("GPT-5");
  });

  it("swaps to empty footer during /statusline editor and restores live footer on save", async () => {
    const { pi, handlers, registerCommandCalls } = buildPiWithHandlers();
    const customMock = vi.fn();
    const footerSpy = buildSetFooterSpy();
    createExtension(pi);
    const ctx = createContext({
      ui: { ...createContext().ui, setFooter: footerSpy.setFooter, custom: customMock },
    });
    for (const handler of handlers.get("session_start") ?? []) handler({}, ctx);
    const { handler } = getRegisteredCommand(registerCommandCalls, "statusline");

    customMock.mockImplementationOnce(async (factory: (...args: unknown[]) => unknown) => {
      expect(renderWithFactory(footerSpy.calls[1])).toBe("");
      let savedResult: unknown;
      const component = (
        factory as (...args: unknown[]) => { handleInput: (data: string) => void }
      )(
        { requestRender: () => {} },
        { fg: (_c: string, text: string) => text },
        {},
        (result: unknown) => (savedResult = result),
      );
      component.handleInput("\r");
      return savedResult;
    });
    await handler("", ctx);
    expect(renderWithFactory(footerSpy.calls[2])).toContain("GPT-5 [med]");
  });

  it("swaps to empty footer during /statusline editor and restores live footer on cancel", async () => {
    const { pi, handlers, registerCommandCalls } = buildPiWithHandlers();
    const customMock = vi.fn();
    const footerSpy = buildSetFooterSpy();
    createExtension(pi);
    const ctx = createContext({
      ui: { ...createContext().ui, setFooter: footerSpy.setFooter, custom: customMock },
    });
    for (const handler of handlers.get("session_start") ?? []) handler({}, ctx);
    const { handler } = getRegisteredCommand(registerCommandCalls, "statusline");

    customMock.mockImplementationOnce(async (factory: (...args: unknown[]) => unknown) => {
      expect(renderWithFactory(footerSpy.calls[1])).toBe("");
      const component = (
        factory as (...args: unknown[]) => { handleInput: (data: string) => void }
      )({ requestRender: () => {} }, { fg: (_c: string, text: string) => text }, {}, () => {});
      component.handleInput("\x1b");
      return null;
    });
    await handler("", ctx);
    expect(renderWithFactory(footerSpy.calls[2])).toContain("GPT-5 [med]");
  });

  it("restores live footer when ctx.ui.custom throws during /statusline", async () => {
    const handlers = new Map<string, Array<(event: unknown, ctx: ExtensionContext) => void>>();
    const events = createBus();
    const registerCommand = vi.fn();
    const customMock = vi.fn();
    const footerSpy = buildSetFooterSpy();

    const pi = {
      events,
      on(event: string, handler: (event: unknown, ctx: ExtensionContext) => void) {
        handlers.set(event, [...(handlers.get(event) ?? []), handler]);
      },
      registerCommand,
      getThinkingLevel: () => "medium",
    } as unknown as ExtensionAPI;

    createExtension(pi);

    const ctx = createContext({
      ui: {
        ...createContext().ui,
        setFooter: footerSpy.setFooter,
        custom: customMock as unknown as ExtensionContext["ui"]["custom"],
      },
    });

    for (const h of handlers.get("session_start") ?? []) h({}, ctx);

    expect(footerSpy.calls).toHaveLength(1);
    expect(renderWithFactory(footerSpy.calls[0])).toContain("GPT-5 [med]");

    const { handler } = getRegisteredCommand(registerCommand.mock.calls, "statusline");

    let customObservedFooterState = -1;
    customMock.mockImplementationOnce(async () => {
      customObservedFooterState = footerSpy.calls.length;
      expect(renderWithFactory(footerSpy.calls[footerSpy.calls.length - 1])).toBe("");
      throw new Error("custom UI failed");
    });

    await expect(handler("", ctx)).rejects.toThrow("custom UI failed");

    expect(customObservedFooterState).toBe(2);
    expect(footerSpy.calls).toHaveLength(3);
    expect(renderWithFactory(footerSpy.calls[0])).toContain("GPT-5 [med]");
    expect(renderWithFactory(footerSpy.calls[1])).toBe("");
    expect(renderWithFactory(footerSpy.calls[2])).toContain("GPT-5 [med]");
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

  it("routes /statusline session to the session menu without opening the editor", async () => {
    const { pi, handlers, registerCommandCalls } = buildPiWithHandlers();
    const select = vi.fn(async () => "Close");
    const custom = vi.fn(async () => null);

    createExtension(pi);

    const ctx = createContext({
      ui: {
        ...createContext().ui,
        select: select as unknown as ExtensionContext["ui"]["select"],
        custom: custom as unknown as ExtensionContext["ui"]["custom"],
      },
    });
    for (const h of handlers.get("session_start") ?? []) h({}, ctx);

    const { handler } = getRegisteredCommand(registerCommandCalls, "statusline");
    await handler("session", ctx);

    expect(select).toHaveBeenCalledTimes(1);
    const title = (select.mock.calls[0] as unknown[] | undefined)?.[0] as string;
    expect(title).toContain("Session details");
    expect(title).toContain("abcdef123456");
    expect(custom).not.toHaveBeenCalled();
  });

  it("warns on unknown /statusline commands without opening UI", async () => {
    const { pi, handlers, registerCommandCalls } = buildPiWithHandlers();
    const select = vi.fn();
    const custom = vi.fn();
    const notify = vi.fn();

    createExtension(pi);

    const ctx = createContext({
      ui: {
        ...createContext().ui,
        select: select as unknown as ExtensionContext["ui"]["select"],
        custom: custom as unknown as ExtensionContext["ui"]["custom"],
        notify: notify as unknown as ExtensionContext["ui"]["notify"],
      },
    });
    for (const h of handlers.get("session_start") ?? []) h({}, ctx);

    const { handler } = getRegisteredCommand(registerCommandCalls, "statusline");
    await handler("widgets", ctx);

    expect(select).not.toHaveBeenCalled();
    expect(custom).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith("Unknown /statusline command: widgets", "warning");
  });

  it("rejects /statusline session in RPC mode without opening prompts", async () => {
    const { pi, handlers, registerCommandCalls } = buildPiWithHandlers();
    const select = vi.fn();
    const notify = vi.fn();

    createExtension(pi);

    const ctx = createContext({
      mode: "rpc",
      ui: {
        ...createContext().ui,
        select: select as unknown as ExtensionContext["ui"]["select"],
        notify: notify as unknown as ExtensionContext["ui"]["notify"],
      },
    });
    for (const h of handlers.get("session_start") ?? []) h({}, ctx);

    const { handler } = getRegisteredCommand(registerCommandCalls, "statusline");
    await handler("session", ctx);

    expect(select).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith("/statusline session requires interactive TUI", "warning");
  });

  it("routes /statusline tools to the tool controls overlay", async () => {
    const { pi, handlers, registerCommandCalls } = buildPiWithHandlers();
    Object.assign(pi, {
      getAllTools: () => [
        { name: "read", description: "Read files" },
        { name: "write", description: "Write files" },
        { name: "bash", description: "Run shell commands" },
      ],
      getActiveTools: () => ["read", "write"],
      setActiveTools: vi.fn(),
    });
    let preview = "";
    const custom = vi.fn(
      async (factory: (...args: unknown[]) => { render: (width: number) => string[] }) => {
        preview = factory({ requestRender: () => {} }, {}, {}, () => {})
          .render(100)
          .join("\n");
        return null;
      },
    );

    createExtension(pi);
    initTheme("dark", false);

    const ctx = createContext({
      ui: {
        ...createContext().ui,
        custom: custom as unknown as ExtensionContext["ui"]["custom"],
      },
    });
    for (const h of handlers.get("session_start") ?? []) h({}, ctx);

    const { handler } = getRegisteredCommand(registerCommandCalls, "statusline");
    await handler("tools", ctx);

    expect(custom).toHaveBeenCalledTimes(1);
    const callArgs = custom.mock.calls[0] as unknown[];
    expect(typeof callArgs[0]).toBe("function");
    expect(callArgs[1]).toEqual({
      overlay: true,
      overlayOptions: {
        anchor: "center",
        width: "70%",
        minWidth: 32,
        maxHeight: "80%",
        margin: 1,
      },
    });
    expect(preview).toContain("read");
    expect(preview).toContain("write");
  });
});

describe("/statusline theme adaptation", () => {
  it("wraps a Pi-like theme before creating the editor", async () => {
    vi.stubEnv("NO_COLOR", undefined);
    const { pi, handlers, registerCommandCalls } = buildPiWithHandlers();
    const customMock = vi.fn();
    const fgCalls: Array<[string, string]> = [];
    const boldCalls: string[] = [];
    const piLikeTheme = {
      fg: (color: string, text: string) => {
        fgCalls.push([color, text]);
        return `<fg:${color}:${text}>`;
      },
      bold: (text: string) => {
        boldCalls.push(text);
        return `<bold:${text}>`;
      },
    };

    createExtension(pi);

    const ctx = createContext({
      ui: { ...createContext().ui, custom: customMock },
    });
    for (const h of handlers.get("session_start") ?? []) h({}, ctx);

    const { handler } = getRegisteredCommand(registerCommandCalls, "statusline");

    let receivedTheme: unknown;
    customMock.mockImplementationOnce(async (factory: (...args: unknown[]) => unknown) => {
      const component = (
        factory as unknown as (...args: unknown[]) => {
          handleInput: (data: string) => void;
          render: (width: number) => string[];
        }
      )({ requestRender: () => {} }, piLikeTheme, {}, (result: unknown) => {
        receivedTheme = result;
      });
      component.render(200);
      component.handleInput("\x1b");
      return null;
    });

    await handler("", ctx);

    expect(fgCalls.length).toBeGreaterThan(0);
    expect(fgCalls.some(([color]) => color === "accent")).toBe(true);
    expect(fgCalls.some(([color]) => color === "borderMuted")).toBe(true);
    expect(boldCalls).toContain("Configure Status Line");
    expect(receivedTheme).toBeNull();
  });

  it("falls back to noTheme when the runtime theme is missing fg", async () => {
    const { pi, handlers, registerCommandCalls } = buildPiWithHandlers();
    const customMock = vi.fn();
    const incompleteTheme = {
      bold: (_text: string) => "should-not-be-called",
    };

    createExtension(pi);

    const ctx = createContext({
      ui: { ...createContext().ui, custom: customMock },
    });
    for (const h of handlers.get("session_start") ?? []) h({}, ctx);

    const { handler } = getRegisteredCommand(registerCommandCalls, "statusline");

    let renderOutput: string[] = [];
    let didThrow = false;
    customMock.mockImplementationOnce(async (factory: (...args: unknown[]) => unknown) => {
      const component = (
        factory as unknown as (...args: unknown[]) => {
          handleInput: (data: string) => void;
          render: (width: number) => string[];
        }
      )({ requestRender: () => {} }, incompleteTheme, {}, () => {});
      try {
        renderOutput = component.render(200);
      } catch (error) {
        didThrow = true;
        throw error;
      }
      component.handleInput("\x1b");
      return null;
    });

    await expect(handler("", ctx)).resolves.toBeUndefined();
    expect(didThrow).toBe(false);
    expect(renderOutput[0]).toBe("Configure Status Line");
  });

  it("falls back to noTheme when the runtime theme is missing bold", async () => {
    const { pi, handlers, registerCommandCalls } = buildPiWithHandlers();
    const customMock = vi.fn();
    const incompleteTheme = {
      fg: (_color: string, text: string) => text,
    };

    createExtension(pi);

    const ctx = createContext({
      ui: { ...createContext().ui, custom: customMock },
    });
    for (const h of handlers.get("session_start") ?? []) h({}, ctx);

    const { handler } = getRegisteredCommand(registerCommandCalls, "statusline");

    let didThrow = false;
    customMock.mockImplementationOnce(async (factory: (...args: unknown[]) => unknown) => {
      const component = (
        factory as unknown as (...args: unknown[]) => {
          handleInput: (data: string) => void;
          render: (width: number) => string[];
        }
      )({ requestRender: () => {} }, incompleteTheme, {}, () => {});
      try {
        component.render(200);
      } catch (error) {
        didThrow = true;
        throw error;
      }
      component.handleInput("\x1b");
      return null;
    });

    await expect(handler("", ctx)).resolves.toBeUndefined();
    expect(didThrow).toBe(false);
  });

  it("falls back to noTheme when ctx.ui.custom passes null as the theme", async () => {
    const { pi, handlers, registerCommandCalls } = buildPiWithHandlers();
    const customMock = vi.fn();

    createExtension(pi);

    const ctx = createContext({
      ui: { ...createContext().ui, custom: customMock },
    });
    for (const h of handlers.get("session_start") ?? []) h({}, ctx);

    const { handler } = getRegisteredCommand(registerCommandCalls, "statusline");

    let didThrow = false;
    customMock.mockImplementationOnce(async (factory: (...args: unknown[]) => unknown) => {
      const component = (
        factory as unknown as (...args: unknown[]) => {
          handleInput: (data: string) => void;
          render: (width: number) => string[];
        }
      )({ requestRender: () => {} }, null, {}, () => {});
      try {
        component.render(200);
      } catch (error) {
        didThrow = true;
        throw error;
      }
      component.handleInput("\x1b");
      return null;
    });

    await expect(handler("", ctx)).resolves.toBeUndefined();
    expect(didThrow).toBe(false);
  });
});

describe("/statusline notifications command", () => {
  function setup() {
    const harness = buildPiWithHandlers();
    createExtension(harness.pi);
    return { ...harness, pi: harness.pi as ExtensionAPI & { events: typeof harness.events } };
  }

  it("reports the current state on /statusline notifications", () => {
    const { registerCommandCalls, handlers } = setup();
    const notify = vi.fn();
    const ctx = createContext({ ui: { ...createContext().ui, notify } });
    for (const h of handlers.get("session_start") ?? []) h({}, ctx);

    const { handler } = getRegisteredCommand(registerCommandCalls, "statusline");
    handler("notifications", ctx);

    expect(notify).toHaveBeenCalledWith("Completion notifications: off", "info");
  });

  it("writes the new state and updates runtime when /statusline notifications on is invoked", async () => {
    const { registerCommandCalls, handlers } = setup();
    const configPath = join(agentDir, "extensions", "statusline.json");
    mkdirSync(join(agentDir, "extensions"), { recursive: true });
    const notify = vi.fn();
    const ctx = createContext({ ui: { ...createContext().ui, notify } });
    for (const h of handlers.get("session_start") ?? []) h({}, ctx);
    const { handler } = getRegisteredCommand(registerCommandCalls, "statusline");

    await handler("notifications on", ctx);

    expect(JSON.parse(readFileSync(configPath, "utf8")).completionNotifications).toBe(true);
    expect(notify).toHaveBeenCalledWith("Completion notifications: on", "info");
  });

  it("rolls back to the previous runtime config when saveConfig throws", async () => {
    const { registerCommandCalls, handlers } = setup();
    const configPath = join(agentDir, "extensions", "statusline.json");
    mkdirSync(join(agentDir, "extensions"), { recursive: true });
    writeFileSync(configPath, "{ bad", "utf8");
    const notify = vi.fn();
    const ctx = createContext({ ui: { ...createContext().ui, notify } });
    for (const h of handlers.get("session_start") ?? []) h({}, ctx);
    const { handler } = getRegisteredCommand(registerCommandCalls, "statusline");

    await handler("notifications on", ctx);

    expect(notify).toHaveBeenCalledWith("Failed to save statusline config", "warning");
  });

  it("rejects /statusline notifications in RPC mode", () => {
    const { registerCommandCalls, handlers } = setup();
    const notify = vi.fn();
    const ctx = createContext({
      mode: "rpc",
      ui: { ...createContext().ui, notify },
    });
    for (const h of handlers.get("session_start") ?? []) h({}, ctx);
    const { handler } = getRegisteredCommand(registerCommandCalls, "statusline");

    handler("notifications on", ctx);

    expect(notify).toHaveBeenCalledWith("/statusline requires interactive UI", "warning");
  });

  it.each(["notifications", "notifications maybe"])(
    "rejects /statusline %s in RPC mode before parsing the action",
    (args) => {
      const { registerCommandCalls, handlers } = setup();
      const notify = vi.fn();
      const ctx = createContext({
        mode: "rpc",
        ui: { ...createContext().ui, notify },
      });
      for (const h of handlers.get("session_start") ?? []) h({}, ctx);
      const { handler } = getRegisteredCommand(registerCommandCalls, "statusline");

      handler(args, ctx);

      expect(notify).toHaveBeenCalledWith("/statusline requires interactive UI", "warning");
    },
  );

  it("reports the usage string for an invalid notifications invocation", () => {
    const { registerCommandCalls, handlers } = setup();
    const notify = vi.fn();
    const ctx = createContext({ ui: { ...createContext().ui, notify } });
    for (const h of handlers.get("session_start") ?? []) h({}, ctx);
    const { handler } = getRegisteredCommand(registerCommandCalls, "statusline");

    handler("notifications maybe", ctx);

    expect(notify).toHaveBeenCalledWith("Usage: /statusline notifications [on|off]", "warning");
  });
});

describe("/statusline preset command", () => {
  function setup(): { pi: ExtensionAPI; handlers: Map<string, Array<(event: unknown, ctx: ExtensionContext) => void>>; registerCommandCalls: unknown[][] } {
    const harness = buildPiWithHandlers();
    createExtension(harness.pi);
    return harness;
  }

  it("persists the balanced preset to the global config file when the user confirms", async () => {
    const configPath = join(agentDir, "extensions", "statusline.json");
    mkdirSync(join(agentDir, "extensions"), { recursive: true });
    const select = vi.fn(async () => "balanced");
    const confirm = vi.fn(async () => true);
    const notify = vi.fn();
    const { handlers, registerCommandCalls } = setup();
    const ctx = createContext({
      ui: {
        ...createContext().ui,
        select: select as unknown as ExtensionContext["ui"]["select"],
        confirm: confirm as unknown as ExtensionContext["ui"]["confirm"],
        notify: notify as unknown as ExtensionContext["ui"]["notify"],
      },
    });
    for (const h of handlers.get("session_start") ?? []) h({}, ctx);
    const { handler } = getRegisteredCommand(registerCommandCalls, "statusline");

    await handler("preset", ctx);

    expect(JSON.parse(readFileSync(configPath, "utf8"))).toMatchObject({
      zones: {
        topLeft: ["model-with-reasoning", "run-state"],
        topRight: ["context-remaining"],
        bottomLeft: ["current-dir", "git-branch"],
        bottomRight: ["five-hour-limit", "weekly-limit"],
      },
      completionNotifications: false,
    });
    expect(notify).toHaveBeenCalledWith("Applied balanced display preset.", "info");
  });

  it("preserves existing config fields when a preset is saved", async () => {
    const configPath = join(agentDir, "extensions", "statusline.json");
    mkdirSync(join(agentDir, "extensions"), { recursive: true });
    writeFileSync(
      configPath,
      JSON.stringify({
        zones: { topLeft: ["model"], topRight: [], bottomLeft: [], bottomRight: [] },
        extensionSegments: { hidden: ["alpha-status"] },
        completionNotifications: true,
      }),
      "utf8",
    );
    const confirm = vi.fn(async () => true);
    const { handlers, registerCommandCalls } = setup();
    const ctx = createContext({
      ui: {
        ...createContext().ui,
        confirm: confirm as unknown as ExtensionContext["ui"]["confirm"],
      },
    });
    for (const h of handlers.get("session_start") ?? []) h({}, ctx);
    const { handler } = getRegisteredCommand(registerCommandCalls, "statusline");

    await handler("preset telemetry", ctx);

    const saved = JSON.parse(readFileSync(configPath, "utf8"));
    expect(saved.extensionSegments).toEqual({ hidden: ["alpha-status"] });
    expect(saved.completionNotifications).toBe(true);
    expect(saved.zones).toMatchObject({
      topLeft: [
        "model-with-reasoning",
        "run-state",
        "turn-progress",
        "response-performance",
      ],
      topRight: ["context-used", "context-remaining"],
    });
  });

  it("warns and keeps the live footer when saving over a malformed config fails", async () => {
    const configPath = join(agentDir, "extensions", "statusline.json");
    mkdirSync(join(agentDir, "extensions"), { recursive: true });
    writeFileSync(
      configPath,
      JSON.stringify({
        zones: { topLeft: ["model"], topRight: [], bottomLeft: [], bottomRight: [] },
        extensionSegments: { hidden: [] },
      }),
      "utf8",
    );
    const confirm = vi.fn(async () => true);
    const notify = vi.fn();
    const footerSpy = buildSetFooterSpy();
    const { handlers, registerCommandCalls } = setup();
    const ctx = createContext({
      ui: {
        ...createContext().ui,
        confirm: confirm as unknown as ExtensionContext["ui"]["confirm"],
        notify: notify as unknown as ExtensionContext["ui"]["notify"],
        setFooter: footerSpy.setFooter,
      },
    });
    for (const h of handlers.get("session_start") ?? []) h({}, ctx);
    writeFileSync(configPath, "{ bad", "utf8");

    const { handler } = getRegisteredCommand(registerCommandCalls, "statusline");
    await handler("preset minimal", ctx);

    expect(notify).toHaveBeenCalledWith("Failed to apply display preset", "warning");
    expect(notify).not.toHaveBeenCalledWith(
      "Applied minimal display preset.",
      "info",
    );
    expect(renderWithFactory(footerSpy.calls[footerSpy.calls.length - 1])).toBe("GPT-5");
  });

  it("writes the preset name literally when called without a selector", async () => {
    const configPath = join(agentDir, "extensions", "statusline.json");
    mkdirSync(join(agentDir, "extensions"), { recursive: true });
    const confirm = vi.fn(async () => true);
    const select = vi.fn();
    const { handlers, registerCommandCalls } = setup();
    const ctx = createContext({
      ui: {
        ...createContext().ui,
        select: select as unknown as ExtensionContext["ui"]["select"],
        confirm: confirm as unknown as ExtensionContext["ui"]["confirm"],
      },
    });
    for (const h of handlers.get("session_start") ?? []) h({}, ctx);
    const { handler } = getRegisteredCommand(registerCommandCalls, "statusline");

    await handler("preset balanced", ctx);

    expect(select).not.toHaveBeenCalled();
    expect(
      JSON.parse(readFileSync(configPath, "utf8")).zones.bottomRight,
    ).toEqual(["five-hour-limit", "weekly-limit"]);
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

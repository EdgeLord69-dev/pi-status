import { afterEach, describe, expect, it, vi } from "vitest";
import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import type { OverlayHandle, TUI } from "@earendil-works/pi-tui";
import type { PiStatusConfig } from "../src/shared/types.ts";
import {
  buildPiWithHandlers,
  buildSetFooterSpy,
  createContext,
  getRegisteredCommand,
  renderWithFactory,
} from "./helpers.ts";

afterEach(() => {
  vi.doUnmock("../src/core/config.ts");
  vi.resetModules();
});

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
}

function deferred<T>(): Deferred<T> {
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

interface DeferredCustomHost {
  custom: ReturnType<typeof vi.fn>;
  resolveCustom: (value: unknown) => void;
  capturedFactory: () => unknown;
  capturedOptions: () => Record<string, unknown> | undefined;
  handle: OverlayHandle;
}

function deferredCustomHost(): DeferredCustomHost {
  const handle = {
    focus: vi.fn(),
    hide: vi.fn(),
    setHidden: vi.fn(),
    isHidden: vi.fn(() => false),
    unfocus: vi.fn(),
    isFocused: vi.fn(() => true),
  } as unknown as OverlayHandle;
  let capturedFactory: DeferredCustomHost["capturedFactory"];
  let capturedOptions: Record<string, unknown> | undefined;
  let resolveCustom: (value: unknown) => void;
  const customPromise = new Promise((resolve) => {
    resolveCustom = resolve;
  });
  const custom = vi.fn((factory, options) => {
    capturedFactory = factory as DeferredCustomHost["capturedFactory"];
    capturedOptions = options as Record<string, unknown>;
    const fakeTui = {
      terminal: { columns: 80, rows: 30 },
      requestRender: vi.fn(),
    } as unknown as TUI;
    const component = (
      capturedFactory as (
        tui: TUI,
        theme: unknown,
        keys: unknown,
        done: (value: unknown) => void,
      ) => { handleInput: (data: string) => void; dispose: () => void }
    )(fakeTui, null, {}, (value: unknown) => {
      component.dispose();
      resolveCustom(value);
    });
    if (
      options &&
      typeof options === "object" &&
      "onHandle" in options &&
      typeof (options as { onHandle?: (h: OverlayHandle) => void }).onHandle === "function"
    ) {
      (options as { onHandle: (h: OverlayHandle) => void }).onHandle(handle);
    }
    return customPromise;
  });
  return {
    custom: custom as unknown as ReturnType<typeof vi.fn>,
    resolveCustom: (value) => resolveCustom(value),
    capturedFactory: () => capturedFactory,
    capturedOptions: () => capturedOptions,
    handle,
  };
}

describe("/statusline persistence", () => {
  it("saves the dashboard draft and keeps the footer factory in sync", async () => {
    const initial: PiStatusConfig = {
      zones: { topLeft: ["model"], topRight: [], bottomLeft: ["current-dir"], bottomRight: [] },
      extensionSegments: { hidden: [] },
      completionNotifications: false,
    };
    const loadConfig = vi.fn(() => initial);
    const saveConfig = vi.fn();
    vi.doMock("../src/core/config.ts", () => ({ loadConfig, saveConfig }));

    const { default: createExtension } = await import("../src/index.ts");
    const { pi, handlers, registerCommandCalls } = buildPiWithHandlers();
    const footerSpy = buildSetFooterSpy();
    createExtension(pi);

    const host = deferredCustomHost();
    const ctx = createContext({
      ui: {
        ...createContext().ui,
        setFooter: footerSpy.setFooter,
        custom: host.custom as unknown as ExtensionCommandContext["ui"]["custom"],
      },
    });
    for (const h of handlers.get("session_start") ?? []) h({}, ctx);
    const commandPromise = getRegisteredCommand(registerCommandCalls, "statusline").handler(
      "",
      ctx,
    );

    await new Promise((resolve) => setImmediate(resolve));
    const component = (
      host.capturedFactory() as (
        tui: TUI,
        theme: unknown,
        keys: unknown,
        done: (value: unknown) => void,
      ) => { handleInput: (data: string) => void; dispose: () => void }
    )(
      { terminal: { columns: 80, rows: 30 } as never, requestRender: () => {} } as unknown as TUI,
      null,
      {},
      () => {},
    );

    // Settings tab via Shift+Tab
    component.handleInput("\x1b[Z");
    component.handleInput("\r"); // toggle notifications
    component.handleInput("\x1b[B"); // Save
    component.handleInput("\r");

    expect(saveConfig).toHaveBeenCalledWith(
      expect.objectContaining({ completionNotifications: true }),
    );
    expect(renderWithFactory(footerSpy.calls.at(-1))).toContain("project");

    host.resolveCustom(undefined);
    await commandPromise;
  });

  it("keeps the draft dirty when saveConfig throws", async () => {
    const initial: PiStatusConfig = config();
    const loadConfig = vi.fn(() => initial);
    const saveConfig = vi.fn(() => {
      throw new Error("disk full");
    });
    vi.doMock("../src/core/config.ts", () => ({ loadConfig, saveConfig }));

    const { default: createExtension } = await import("../src/index.ts");
    const { pi, handlers, registerCommandCalls } = buildPiWithHandlers();
    const footerSpy = buildSetFooterSpy();
    createExtension(pi);

    const host = deferredCustomHost();
    const ctx = createContext({
      ui: {
        ...createContext().ui,
        setFooter: footerSpy.setFooter,
        custom: host.custom as unknown as ExtensionCommandContext["ui"]["custom"],
      },
    });
    for (const h of handlers.get("session_start") ?? []) h({}, ctx);
    const commandPromise = getRegisteredCommand(registerCommandCalls, "statusline").handler(
      "",
      ctx,
    );

    await new Promise((resolve) => setImmediate(resolve));
    const component = (
      host.capturedFactory() as (
        tui: TUI,
        theme: unknown,
        keys: unknown,
        done: (value: unknown) => void,
      ) => { handleInput: (data: string) => void; dispose: () => void }
    )(
      { terminal: { columns: 80, rows: 30 } as never, requestRender: () => {} } as unknown as TUI,
      null,
      {},
      () => {},
    );
    component.handleInput("\x1b[Z");
    component.handleInput("\r");
    component.handleInput("\x1b[B");
    component.handleInput("\r");
    expect(ctx.ui.notify).toHaveBeenCalledWith("Failed to save statusline config", "warning");

    host.resolveCustom(undefined);
    await commandPromise;
  });
});

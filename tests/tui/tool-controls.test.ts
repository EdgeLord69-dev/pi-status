import { describe, expect, it, vi } from "vitest";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import type { SettingsListTheme } from "@earendil-works/pi-tui";
import { calculateToolChange } from "../../src/tui/tool-controls.ts";
import { openToolControls } from "../../src/tui/tool-controls.ts";

// ── Theme mock ───────────────────────────────────────────────────────────────

const mockTheme: SettingsListTheme = {
  label: (text) => text,
  value: (text) => text,
  description: (text) => text,
  cursor: "> ",
  hint: (text) => `[${text}]`,
};

vi.mock("@earendil-works/pi-coding-agent", async (importOriginal) => {
  const original = await importOriginal<typeof import("@earendil-works/pi-coding-agent")>();
  return {
    ...original,
    getSettingsListTheme: () => mockTheme,
  };
});

function makePi() {
  let tools = [
    { name: "read", description: "Read files" },
    { name: "write", description: "Write files" },
    { name: "bash", description: "Run shell commands" },
  ];
  let active = ["read", "write"];
  const setActiveTools = vi.fn((names: string[]) => {
    active = [...names];
  });
  const pi = {
    getAllTools: vi.fn(() => [...tools]),
    getActiveTools: vi.fn(() => [...active]),
    setActiveTools,
  } as unknown as ExtensionAPI;
  return {
    pi,
    setActiveTools,
    setHostTools(next: typeof tools) {
      tools = [...next];
    },
    setHostActive(next: string[]) {
      active = [...next];
    },
  };
}

function makeContext(opts?: { custom?: ExtensionCommandContext["ui"]["custom"]; mode?: string }) {
  const mode = opts?.mode ?? "tui";
  let component: { handleInput(data: string): void; render(width: number): string[] } | undefined;
  const done = vi.fn();
  const requestRender = vi.fn();
  // Use a looser type so the mock accepts (factory, options) like the real API
  const customImpl =
    opts?.custom ??
    vi.fn(async (factory: (...args: unknown[]) => unknown, _options?: unknown) => {
      component = factory({ requestRender }, {}, {}, done) as typeof component;
    });
  const ctx = {
    mode,
    ui: { custom: customImpl, notify: vi.fn() },
  } as unknown as ExtensionCommandContext;
  const getComponent = () => {
    if (!component) throw new Error("custom component was not created");
    return component;
  };
  return { ctx, custom: customImpl, done, requestRender, getComponent };
}

function row(component: { render(width: number): string[] }, name: string) {
  return component.render(100).find((line) => line.includes(name));
}

// ── calculateToolChange ──────────────────────────────────────────────────────

const all = ["read", "write", "bash"];

describe("calculateToolChange", () => {
  it("keeps catalog order while enabling and disabling", () => {
    expect(calculateToolChange(all, ["read"], "bash", "enabled")).toEqual({
      type: "apply",
      names: ["read", "bash"],
    });
    expect(calculateToolChange(all, ["read", "bash"], "read", "disabled")).toEqual({
      type: "apply",
      names: ["bash"],
    });
  });

  it("filters stale and duplicate active names", () => {
    expect(calculateToolChange(all, ["bash", "removed", "bash"], "read", "enabled")).toEqual({
      type: "apply",
      names: ["read", "bash"],
    });
  });

  it("ignores unknown names and values", () => {
    expect(calculateToolChange(all, ["read"], "invented", "enabled")).toEqual({ type: "ignore" });
    expect(calculateToolChange(all, ["read"], "read", "other")).toEqual({ type: "ignore" });
  });

  it("rejects disabling the final valid active tool", () => {
    expect(calculateToolChange(all, ["read"], "read", "disabled")).toEqual({
      type: "reject-last-active",
    });
  });

  it("allows enabling from an empty host active set", () => {
    expect(calculateToolChange(all, [], "read", "enabled")).toEqual({
      type: "apply",
      names: ["read"],
    });
  });
});

// ── openToolControls ─────────────────────────────────────────────────────────

const OVERLAY_OPTIONS = {
  overlay: true,
  overlayOptions: {
    anchor: "center",
    width: "70%",
    minWidth: 32,
    maxHeight: "80%",
    margin: 1,
  },
};

describe("openToolControls", () => {
  it("opens with overlay and correct options", async () => {
    const { pi } = makePi();
    const { ctx, custom, getComponent } = makeContext();
    await openToolControls(pi, ctx);
    expect(custom).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining(OVERLAY_OPTIONS),
    );
    const comp = getComponent();
    expect(comp).toBeDefined();
    expect(comp.render(100).join("\n")).toContain("read");
    expect(comp.render(100).join("\n")).toContain("write");
  });

  it("search filters items and toggle disables the visible tool", async () => {
    const { pi, setActiveTools } = makePi();
    const { ctx, getComponent, requestRender } = makeContext();
    await openToolControls(pi, ctx);
    const comp = getComponent();
    // type "write" to filter - intermediate "wr"/"wri"/"writ" have no exact match
    for (const char of "write") comp.handleInput(char);
    // after "write" the only visible tool is write
    expect(comp.render(100).join("\n")).toContain("write");
    // press Enter to toggle write → disabled
    comp.handleInput("\r");
    expect(setActiveTools).toHaveBeenCalledWith(["read"]);
    expect(requestRender).toHaveBeenCalled();
  });

  it("toggling enables a disabled tool", async () => {
    const { pi, setActiveTools, setHostActive } = makePi();
    setHostActive(["read"]); // write and bash are disabled
    const { ctx, getComponent } = makeContext();
    await openToolControls(pi, ctx);
    const comp = getComponent();
    // navigate to write (2 up arrows from read) and toggle to enabled
    comp.handleInput("\x1b[A"); // up → bash
    comp.handleInput("\x1b[A"); // up → write
    comp.handleInput("\r");
    expect(setActiveTools).toHaveBeenCalledWith(["read", "write"]);
  });

  it("restores the final active row and warns on rejection", async () => {
    const { pi, setActiveTools, setHostActive } = makePi();
    setHostActive(["read"]);
    const { ctx, getComponent } = makeContext();
    await openToolControls(pi, ctx);
    const comp = getComponent();
    comp.handleInput("\r"); // try to disable the only active tool
    expect(setActiveTools).not.toHaveBeenCalled();
    expect(ctx.ui.notify).toHaveBeenCalledWith("At least one tool must remain active", "warning");
    // row should still show enabled
    expect(comp.render(100).join("\n")).toContain("enabled");
  });

  it("restores rejected rows from the latest host state", async () => {
    const { pi, setHostActive } = makePi();
    const { ctx, getComponent } = makeContext();
    await openToolControls(pi, ctx);
    setHostActive(["read"]);

    const comp = getComponent();
    comp.handleInput("\r");

    expect(row(comp, "read")).toContain("enabled");
    expect(row(comp, "write")).toContain("disabled");
  });

  it("updates every visible row after the live catalog changes", async () => {
    const { pi, setHostActive, setHostTools } = makePi();
    const { ctx, getComponent } = makeContext();
    await openToolControls(pi, ctx);
    setHostTools([
      { name: "read", description: "Read files" },
      { name: "bash", description: "Run shell commands" },
    ]);
    setHostActive(["read", "bash"]);

    const comp = getComponent();
    comp.handleInput("\r");

    expect(row(comp, "read")).toContain("disabled");
    expect(row(comp, "write")).toContain("disabled");
    expect(row(comp, "bash")).toContain("enabled");
  });

  it("preserves tools activated by another runtime participant", async () => {
    const { pi, setActiveTools, setHostActive, setHostTools } = makePi();
    const { ctx, getComponent } = makeContext();
    await openToolControls(pi, ctx);
    setHostTools([
      { name: "read", description: "Read files" },
      { name: "write", description: "Write files" },
      { name: "bash", description: "Run shell commands" },
      { name: "dynamic", description: "Added later" },
    ]);
    setHostActive(["read", "dynamic"]);

    getComponent().handleInput("\r");

    expect(setActiveTools).toHaveBeenCalledWith(["dynamic"]);
    expect(row(getComponent(), "read")).toContain("disabled");
    expect(row(getComponent(), "write")).toContain("disabled");
  });

  it("allows enabling from an empty host active set", async () => {
    const { pi, setHostActive, setActiveTools } = makePi();
    setHostActive([]);
    const { ctx, getComponent } = makeContext();
    await openToolControls(pi, ctx);
    const comp = getComponent();
    comp.handleInput("\r"); // enable first tool (read)
    expect(setActiveTools).toHaveBeenCalledWith(["read"]);
  });

  it("escaping closes without mutation", async () => {
    const { pi, setActiveTools } = makePi();
    const { ctx, done, getComponent } = makeContext();
    await openToolControls(pi, ctx);
    const comp = getComponent();
    comp.handleInput("\x1b"); // Escape
    expect(done).toHaveBeenCalledWith(undefined);
    expect(setActiveTools).not.toHaveBeenCalled();
  });

  it("rejects non-TUI mode with a warning", async () => {
    const { pi } = makePi();
    const { ctx, custom } = makeContext({ mode: "rpc" });
    await openToolControls(pi, ctx);
    expect(custom).not.toHaveBeenCalled();
    expect(ctx.ui.notify).toHaveBeenCalledWith(
      "/statusline tools requires interactive TUI",
      "warning",
    );
  });

  it("contains a stale non-TUI notification context", async () => {
    const { pi } = makePi();
    const { ctx } = makeContext({ mode: "rpc" });
    vi.mocked(ctx.ui.notify).mockImplementation(() => {
      throw new Error("stale context");
    });

    await expect(openToolControls(pi, ctx)).resolves.toBeUndefined();
  });

  it("warns when tool discovery fails", async () => {
    const { pi } = makePi();
    vi.mocked(pi.getAllTools).mockImplementationOnce(() => {
      throw new Error("Discovery failed");
    });
    const { ctx, custom } = makeContext();
    await openToolControls(pi, ctx);
    expect(ctx.ui.notify).toHaveBeenCalledWith(
      "Could not load Pi tools: Discovery failed",
      "warning",
    );
    expect(custom).not.toHaveBeenCalled();
  });

  it("warns when no tools are available", async () => {
    const { pi, setActiveTools } = makePi();
    vi.mocked(pi.getAllTools).mockReturnValue([]);
    const { ctx, custom } = makeContext();

    await openToolControls(pi, ctx);

    expect(custom).not.toHaveBeenCalled();
    expect(setActiveTools).not.toHaveBeenCalled();
    expect(ctx.ui.notify).toHaveBeenCalledWith("No tools are available", "warning");
  });

  it("warns when active-tools fetch fails", async () => {
    const { pi } = makePi();
    vi.mocked(pi.getActiveTools).mockImplementationOnce(() => {
      throw new Error("Active tools unavailable");
    });
    const { ctx, custom } = makeContext();
    await openToolControls(pi, ctx);
    expect(ctx.ui.notify).toHaveBeenCalledWith(
      "Could not load Pi tools: Active tools unavailable",
      "warning",
    );
    expect(custom).not.toHaveBeenCalled();
  });

  it("warns and restores rows when live refresh fails", async () => {
    const { pi } = makePi();
    vi.mocked(pi.getAllTools)
      .mockReturnValueOnce([
        { name: "read", description: "Read files" },
        { name: "write", description: "Write files" },
        { name: "bash", description: "Run shell commands" },
      ] as never)
      .mockImplementationOnce(() => {
        throw new Error("Refresh failed");
      });
    const { ctx, getComponent } = makeContext();
    await openToolControls(pi, ctx);

    const comp = getComponent();
    comp.handleInput("\r");

    expect(ctx.ui.notify).toHaveBeenCalledWith(
      "Could not refresh Pi tools: Refresh failed",
      "warning",
    );
    expect(row(comp, "read")).toContain("enabled");
  });

  it("warns when setActiveTools throws", async () => {
    const { pi, setHostActive } = makePi();
    vi.mocked(pi.setActiveTools).mockImplementationOnce(() => {
      throw new Error("Apply failed");
    });
    const { ctx, getComponent } = makeContext();
    await openToolControls(pi, ctx);
    setHostActive(["read", "bash"]);
    getComponent().handleInput("\r");
    expect(ctx.ui.notify).toHaveBeenCalledWith(
      "Could not update Pi tools: Apply failed",
      "warning",
    );
    expect(row(getComponent(), "read")).toContain("enabled");
    expect(row(getComponent(), "write")).toContain("disabled");
    expect(row(getComponent(), "bash")).toContain("enabled");
  });

  it("contains notify throwing during rejection warning", async () => {
    const { pi, setHostActive } = makePi();
    setHostActive(["read"]);
    const { ctx, getComponent } = makeContext();
    vi.mocked(ctx.ui.notify).mockImplementation(() => {
      throw new Error("notify throws");
    });
    await openToolControls(pi, ctx);

    expect(() => getComponent().handleInput("\r")).not.toThrow();
    expect(row(getComponent(), "read")).toContain("enabled");
  });

  it("warns when overlay opening fails", async () => {
    const { pi } = makePi();
    const { ctx } = makeContext({
      custom: vi.fn(async () => {
        throw new Error("Overlay rejected");
      }),
    });
    await openToolControls(pi, ctx);
    expect(ctx.ui.notify).toHaveBeenCalledWith(
      "Could not open tool controls: Overlay rejected",
      "warning",
    );
  });
});

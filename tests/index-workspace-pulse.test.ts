import { execFile } from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Component, OverlayHandle, TUI } from "@earendil-works/pi-tui";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import createExtension from "../src/index.ts";
import { BUILTIN_SIDEBAR_PANEL_IDS } from "../src/shared/types.ts";
import type { StatusLineDashboardComponent } from "../src/tui/dashboard.ts";
import { selectableRows } from "../src/tui/dashboard-state.ts";
import { noTheme } from "../src/tui/theme.ts";
import {
  buildSetFooterSpy,
  createContext,
  buildPiWithHandlers,
  getRegisteredCommand,
} from "./helpers.ts";

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  type ExecCb = (err: unknown, stdout: string, stderr: string) => void;
  return {
    ...actual,
    execFile: vi.fn(
      (_file: string, _args: readonly string[], _options: unknown, cb: ExecCb): EventEmitter => {
        const child = new EventEmitter() as EventEmitter & {
          stdout: EventEmitter;
          stderr: EventEmitter;
        };
        child.stdout = new EventEmitter();
        child.stderr = new EventEmitter();
        process.nextTick(() => cb(null, "", ""));
        return child;
      },
    ),
  };
});

let agentDir: string;

beforeEach(() => {
  agentDir = mkdtempSync(join(tmpdir(), "pi-status-wsp-wiring-"));
  vi.stubEnv("PI_CODING_AGENT_DIR", agentDir);
});

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(agentDir, { recursive: true, force: true });
  vi.mocked(execFile).mockReset();
});

const execFileMock = vi.mocked(execFile);

function fakeChild(): EventEmitter {
  const child = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
  };
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  return child;
}

function writeConfig(zones: unknown): void {
  // dynamically import to avoid circular hoist issues
  const { writeFileSync, mkdirSync } = require("node:fs") as typeof import("node:fs");
  mkdirSync(join(agentDir, "extensions"), { recursive: true });
  writeFileSync(
    join(agentDir, "extensions", "statusline.json"),
    JSON.stringify({ zones, extensionSegments: { hidden: [] } }),
    "utf8",
  );
}

function withEnabledZone(zones: Record<string, readonly string[]>) {
  writeConfig({
    topLeft: zones.topLeft ?? [],
    topRight: zones.topRight ?? [],
    bottomLeft: zones.bottomLeft ?? [],
    bottomRight: zones.bottomRight ?? [],
  });
}

describe("workspace pulse wiring", () => {
  it("does not create a runtime or run git for RPC sessions", () => {
    const { pi, handlers } = buildPiWithHandlers();
    const footerSpy = buildSetFooterSpy();
    createExtension(pi);
    const ctx = createContext({
      mode: "rpc",
      ui: { ...createContext().ui, setFooter: footerSpy.setFooter },
    });
    for (const h of handlers.get("session_start") ?? []) h({}, ctx);
    expect(execFileMock).not.toHaveBeenCalled();
  });

  it("does not run git when the segment is not in any zone", () => {
    withEnabledZone({ topLeft: ["model"], bottomLeft: [] });
    const { pi, handlers } = buildPiWithHandlers();
    createExtension(pi);
    const ctx = createContext();
    for (const h of handlers.get("session_start") ?? []) h({}, ctx);
    expect(execFileMock).not.toHaveBeenCalled();
  });

  it("starts one inspection when workspace-pulse is enabled in a zone", async () => {
    withEnabledZone({ bottomLeft: ["workspace-pulse"] });
    fourCommandMock((options) => options.cwd);

    const { pi, handlers } = buildPiWithHandlers();
    createExtension(pi);
    const ctx = createContext();
    for (const h of handlers.get("session_start") ?? []) h({}, ctx);

    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
    expect(execFileMock).toHaveBeenCalledTimes(4);
  });

  it("creates a fresh runtime for a replacement session cwd", async () => {
    withEnabledZone({ bottomLeft: ["workspace-pulse"] });
    const nextInspection = fourCommandMock((options) => options.cwd);

    const { pi, handlers } = buildPiWithHandlers();
    createExtension(pi);
    const first = createContext({ cwd: "/repo/one" });
    const second = createContext({ cwd: "/repo/two" });

    for (const h of handlers.get("session_start") ?? []) h({}, first);
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
    nextInspection();
    for (const h of handlers.get("session_start") ?? []) h({}, second);
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));

    const rootCwds = execFileMock.mock.calls
      .filter(([, args]) => {
        const argv = args as readonly string[];
        return argv[0] === "rev-parse" && argv[1] === "--show-toplevel";
      })
      .map(([, , options]) => (options as { cwd: string }).cwd);
    expect(rootCwds).toEqual(["/repo/one", "/repo/two"]);
  });

  it("does not restart the inspection when the segment moves between zones", async () => {
    withEnabledZone({ bottomLeft: ["workspace-pulse"] });
    fourCommandMock(() => "/repo");

    const { pi, handlers } = buildPiWithHandlers();
    createExtension(pi);
    const ctx = createContext();
    for (const h of handlers.get("session_start") ?? []) h({}, ctx);
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
    const callsAfterStart = execFileMock.mock.calls.length;

    writeConfig({
      topLeft: ["workspace-pulse"],
      topRight: [],
      bottomLeft: [],
      bottomRight: [],
    });
    for (const h of handlers.get("session_tree") ?? []) h({}, ctx);
    await new Promise((r) => setImmediate(r));
    expect(execFileMock.mock.calls.length).toBe(callsAfterStart);
  });

  it("preserves the current pulse configuration across a session-tree update", async () => {
    withEnabledZone({ bottomLeft: ["workspace-pulse"] });
    const refreshableMock = fourCommandMock((options) => options.cwd);

    const { pi, handlers } = buildPiWithHandlers();
    createExtension(pi);
    const ctx = createContext();
    for (const h of handlers.get("session_start") ?? []) h({}, ctx);
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));

    withEnabledZone({ bottomLeft: ["model"] });
    for (const h of handlers.get("session_tree") ?? []) h({}, ctx);
    const callsAfterRemoval = execFileMock.mock.calls.length;
    refreshableMock();

    for (const h of handlers.get("turn_start") ?? []) {
      h({ turnIndex: 0, timestamp: Date.now() }, ctx);
    }
    for (const h of handlers.get("tool_execution_end") ?? []) {
      h({ toolCallId: "t1", isError: false }, ctx);
    }
    await new Promise((r) => setTimeout(r, 260));
    expect(execFileMock.mock.calls.length).toBeGreaterThan(callsAfterRemoval);
  });

  it("schedules a debounced refresh on tool_execution_end", async () => {
    withEnabledZone({ bottomLeft: ["workspace-pulse"] });
    const refreshableMock = fourCommandMock(() => "/repo");

    const { pi, handlers } = buildPiWithHandlers();
    createExtension(pi);
    const ctx = createContext();
    for (const h of handlers.get("session_start") ?? []) h({}, ctx);
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
    const callsBeforeTool = execFileMock.mock.calls.length;
    refreshableMock();

    for (const h of handlers.get("tool_execution_end") ?? []) {
      h({ toolCallId: "t1", isError: false }, ctx);
    }
    await new Promise((r) => setTimeout(r, 260));
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
    expect(execFileMock.mock.calls.length).toBe(callsBeforeTool + 4);
  });

  it("refreshes immediately on turn_start", async () => {
    withEnabledZone({ bottomLeft: ["workspace-pulse"] });
    const nextInspection = fourCommandMock(() => "/repo");

    const { pi, handlers } = buildPiWithHandlers();
    createExtension(pi);
    const ctx = createContext();
    for (const h of handlers.get("session_start") ?? []) h({}, ctx);
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
    const callsBeforeTurn = execFileMock.mock.calls.length;
    nextInspection();

    for (const h of handlers.get("turn_start") ?? []) {
      h({ turnIndex: 0, timestamp: Date.now() }, ctx);
    }
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
    expect(execFileMock.mock.calls.length).toBe(callsBeforeTurn + 4);
  });

  it("disposes the runtime on session_shutdown", async () => {
    withEnabledZone({ bottomLeft: ["workspace-pulse"] });
    fourCommandMock(() => "/repo");

    const { pi, handlers } = buildPiWithHandlers();
    createExtension(pi);
    const ctx = createContext();
    for (const h of handlers.get("session_start") ?? []) h({}, ctx);
    await new Promise((r) => setImmediate(r));

    for (const h of handlers.get("session_shutdown") ?? []) h({}, ctx);
    const callsAfterShutdown = execFileMock.mock.calls.length;

    for (const h of handlers.get("tool_execution_end") ?? []) {
      h({ toolCallId: "t1", isError: false }, ctx);
    }
    await new Promise((r) => setTimeout(r, 260));
    expect(execFileMock.mock.calls.length).toBe(callsAfterShutdown);
  });
});

describe("workspace pulse sidebar demand", () => {
  function dashboardHost() {
    const components: Component[] = [];
    const tui = {
      terminal: { columns: 120, rows: 30 },
      requestRender: vi.fn(),
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
      const component = factory(tui, noTheme, {}, () => {});
      components.push(component);
      options?.onHandle?.(handle);
      return undefined;
    });
    return {
      custom,
      dashboard: () => components.at(-1) as StatusLineDashboardComponent,
    };
  }

  function writeSidebarLayout(workspaceVisible: boolean): void {
    const { writeFileSync, mkdirSync } = require("node:fs") as typeof import("node:fs");
    mkdirSync(join(agentDir, "extensions"), { recursive: true });
    writeFileSync(
      join(agentDir, "extensions", "statusline.json"),
      JSON.stringify({
        zones: { topLeft: [], topRight: [], bottomLeft: [], bottomRight: [] },
        extensionSegments: { hidden: [] },
        extensionStatusZone: "bottomRight",
        sidebarPanelLayout: BUILTIN_SIDEBAR_PANEL_IDS.map((id) => ({
          id,
          visible: id === "workspace" ? workspaceVisible : true,
        })),
      }),
      "utf8",
    );
  }

  it("starts Workspace Pulse when the sidebar workspace panel is visible without any footer zone", async () => {
    writeSidebarLayout(true);
    fourCommandMock(() => "/repo");
    const { pi, handlers } = buildPiWithHandlers();
    // Custom mock invokes the factory so the sidebar controller's isSupported() returns true.
    const customMock = vi.fn(<T>(factory: (...args: unknown[]) => T) => {
      factory(
        { terminal: { columns: 120, rows: 30 }, requestRender: () => {} },
        null,
        {},
        () => {},
      );
      return Promise.resolve(null) as Promise<unknown>;
    });
    createExtension(pi);
    const ctx = createContext({
      ui: { ...createContext().ui, custom: customMock as never },
    });
    for (const h of handlers.get("session_start") ?? []) h({}, ctx);
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
    expect(execFileMock).toHaveBeenCalled();
  });

  it("does not start Workspace Pulse when the visible sidebar has no pulse-demanding assignment", () => {
    const { writeFileSync, mkdirSync } = require("node:fs") as typeof import("node:fs");
    mkdirSync(join(agentDir, "extensions"), { recursive: true });
    writeFileSync(
      join(agentDir, "extensions", "statusline.json"),
      JSON.stringify({
        zones: { topLeft: [], topRight: [], bottomLeft: [], bottomRight: [] },
        extensionSegments: { hidden: [] },
        sidebarPanelLayout: BUILTIN_SIDEBAR_PANEL_IDS.map((id) => ({
          id,
          visible: id === "workspace",
          segments: id === "workspace" ? ["builtin:project"] : [],
        })),
        sidebarHiddenSegments: [
          "builtin:directory",
          "builtin:branch",
          "builtin:changes",
          "builtin:sync-state",
        ],
      }),
      "utf8",
    );
    const { pi, handlers } = buildPiWithHandlers();
    const customMock = vi.fn(<T>(factory: (...args: unknown[]) => T) => {
      factory(
        { terminal: { columns: 120, rows: 30 }, requestRender: () => {} },
        null,
        {},
        () => {},
      );
      return Promise.resolve(null) as Promise<unknown>;
    });
    createExtension(pi);
    const ctx = createContext({ ui: { ...createContext().ui, custom: customMock as never } });
    for (const h of handlers.get("session_start") ?? []) h({}, ctx);
    expect(execFileMock).not.toHaveBeenCalled();
  });

  it("does not start Workspace Pulse when the sidebar workspace panel is hidden", () => {
    writeSidebarLayout(false);
    const { pi, handlers } = buildPiWithHandlers();
    createExtension(pi);
    const ctx = createContext();
    for (const h of handlers.get("session_start") ?? []) h({}, ctx);
    expect(execFileMock).not.toHaveBeenCalled();
  });

  it("stops Workspace Pulse only after a successful dashboard replacement", async () => {
    const { writeFileSync, mkdirSync } = require("node:fs") as typeof import("node:fs");
    mkdirSync(join(agentDir, "extensions"), { recursive: true });
    writeFileSync(
      join(agentDir, "extensions", "statusline.json"),
      JSON.stringify({
        zones: { topLeft: [], topRight: [], bottomLeft: [], bottomRight: [] },
        extensionSegments: { hidden: [] },
        extensionStatusZone: "bottomRight",
        sidebarPanelLayout: BUILTIN_SIDEBAR_PANEL_IDS.map((id) => ({
          id,
          visible: id === "agent",
          segments: id === "agent" ? ["builtin:branch"] : [],
        })),
        sidebarHiddenSegments: [],
      }),
      "utf8",
    );
    const queueInspection = fourCommandMock(() => "/repo");
    const { pi, handlers, registerCommandCalls } = buildPiWithHandlers();
    const host = dashboardHost();
    createExtension(pi);
    const ctx = createContext({
      ui: { ...createContext().ui, custom: host.custom as never },
    });
    for (const handler of handlers.get("session_start") ?? []) handler({}, ctx);
    for (let index = 0; index < 4; index += 1) {
      await new Promise((resolve) => setImmediate(resolve));
    }
    expect(execFileMock).toHaveBeenCalled();

    await getRegisteredCommand(registerCommandCalls, "statusline").handler("", ctx);
    const dashboard = host.dashboard();
    dashboard.handleInput("\t");
    for (const char of "branch") dashboard.handleInput(char);
    const branchIndex = selectableRows(dashboard.getState()).findIndex(
      (row) => row.type === "sidebar_segment" && row.id === "builtin:branch",
    );
    for (let index = 0; index < branchIndex; index += 1) dashboard.handleInput("\x1b[B");
    dashboard.handleInput("\r"); // disable the active producer
    const saveIndex = selectableRows(dashboard.getState()).length - 1;
    while (dashboard.getState().navigation.sidebar.selectedIndex < saveIndex) {
      dashboard.handleInput("\x1b[B");
    }
    dashboard.handleInput("\r");

    const extensionsDir = join(agentDir, "extensions");
    rmSync(extensionsDir, { recursive: true, force: true });
    writeFileSync(extensionsDir, "block config writes", "utf8");
    dashboard.handleInput("\x1b[B");
    dashboard.handleInput("\r");

    expect(ctx.ui.notify).toHaveBeenCalledWith("Failed to save statusline config", "warning");
    expect(dashboard.getState().draftSidebarLayout.hiddenSegments).toContain("builtin:branch");

    const callsAfterFailedSave = execFileMock.mock.calls.length;
    queueInspection();
    for (const handler of handlers.get("tool_execution_end") ?? []) {
      handler({ toolCallId: "after-failed-save", isError: false }, ctx);
    }
    await new Promise((resolve) => setTimeout(resolve, 260));
    expect(execFileMock.mock.calls.length).toBe(callsAfterFailedSave + 4);

    rmSync(extensionsDir, { force: true });
    mkdirSync(extensionsDir, { recursive: true });
    dashboard.handleInput("\r");
    dashboard.handleInput("\x1b[B");
    dashboard.handleInput("\r");

    const callsAfterSuccessfulSave = execFileMock.mock.calls.length;
    queueInspection();
    for (const handler of handlers.get("tool_execution_end") ?? []) {
      handler({ toolCallId: "after-successful-save", isError: false }, ctx);
    }
    await new Promise((resolve) => setTimeout(resolve, 260));
    expect(execFileMock.mock.calls.length).toBe(callsAfterSuccessfulSave);
  });
});

function fourCommandMock(resolveRoot: (options: { cwd: string }) => string): () => void {
  const expand = () => {
    for (let i = 0; i < 4; i += 1) {
      execFileMock.mockImplementationOnce(((
        _file: string,
        args: readonly string[],
        options: unknown,
        cb: (err: unknown, stdout: string, stderr: string) => void,
      ) => {
        const argv = args as readonly string[];
        const opts = options as { cwd: string };
        let stdout = "";
        if (argv[0] === "rev-parse" && argv[1] === "--show-toplevel") {
          stdout = `${resolveRoot(opts)}\n`;
        } else if (argv[0] === "status") {
          stdout = ["# branch.oid abc", "# branch.head main", "# branch.ab +0 -0", ""].join("\0");
        } else if (argv[0] === "diff") {
          stdout = "";
        } else {
          stdout = "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef\n";
        }
        cb(null, stdout, "");
        return fakeChild();
      }) as never);
    }
  };
  expand();
  return expand;
}
